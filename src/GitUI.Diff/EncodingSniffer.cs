using System.Text;

namespace GitUI.Diff;

/// <summary>文本编码探测结果。Decode 用；二进制判定由 <see cref="BinaryDetector"/> 负责，不在此枚举内。</summary>
public enum TextEncodingKind
{
    /// <summary>UTF-8（无 BOM）。探测失败时的兜底编码。</summary>
    Utf8,

    /// <summary>UTF-8 带 BOM。</summary>
    Utf8Bom,

    /// <summary>UTF-16 LE（小端，带 BOM）。</summary>
    Utf16Le,

    /// <summary>UTF-16 BE（大端，带 BOM）。</summary>
    Utf16Be,

    /// <summary>GBK / CP936（中文 Windows 传统编码）。</summary>
    Gbk,

    /// <summary>ISO-8859-1（Latin1）。任何字节序列都合法，是 GBK 判定失败时的兜底。</summary>
    Latin1,
}

/// <summary>
/// 编码探测（S2，design.md §8；对应 §3.3 Infrastructure 层的 EncodingSniffer）。
/// 判定顺序：
/// 1. BOM 直接判定（UTF-8/UTF-16 LE/BE）；
/// 2. 严格 UTF-8 校验通过（含多字节序列合法性、拒绝超长编码与代理区）→ Utf8；
/// 3. 所有高位字节都能组成合法 GBK 双字节序列且 ≥ 2 对 → Gbk
///    （≥ 2 对的阈值避免把 Latin1 的单个重音字符误判成 GBK，如 "café"）；
/// 4. 兜底 Latin1（任何字节都合法，不会抛异常）。
/// </summary>
public static class EncodingSniffer
{
    private static readonly Encoding GbkEncoding = CreateGbkEncoding();

    public static TextEncodingKind Detect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length == 0) return TextEncodingKind.Utf8;

        // 1. BOM
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return TextEncodingKind.Utf8Bom;
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
            return TextEncodingKind.Utf16Le;
        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
            return TextEncodingKind.Utf16Be;

        // 2. 严格 UTF-8
        if (IsValidUtf8(bytes)) return TextEncodingKind.Utf8;

        // 3. GBK 启发式
        if (LooksLikeGbk(bytes)) return TextEncodingKind.Gbk;

        // 4. 兜底
        return TextEncodingKind.Latin1;
    }

    /// <summary>按探测（或指定）编码解码为字符串；返回文本不含 BOM。</summary>
    public static string Decode(ReadOnlySpan<byte> bytes, TextEncodingKind? kind = null)
    {
        var detected = kind ?? Detect(bytes);
        var encoding = ToEncoding(detected);

        int bomLength = detected switch
        {
            TextEncodingKind.Utf8Bom => 3,
            TextEncodingKind.Utf16Le or TextEncodingKind.Utf16Be => 2,
            _ => 0,
        };
        var payload = bomLength > 0 && bytes.Length >= bomLength ? bytes[bomLength..] : bytes;

        var text = encoding.GetString(payload);
        return text.Length > 0 && text[0] == '\uFEFF' ? text[1..] : text;
    }

    public static Encoding ToEncoding(TextEncodingKind kind) => kind switch
    {
        TextEncodingKind.Utf8 or TextEncodingKind.Utf8Bom => Encoding.UTF8,
        TextEncodingKind.Utf16Le => Encoding.Unicode,
        TextEncodingKind.Utf16Be => Encoding.BigEndianUnicode,
        TextEncodingKind.Gbk => GbkEncoding,
        _ => Encoding.Latin1,
    };

    private static Encoding CreateGbkEncoding()
    {
        // .NET 默认不带 CP936，需要注册 CodePagesEncodingProvider（运行时自带程序集）。
        Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(936);
    }

    /// <summary>严格 UTF-8 校验：多字节序列完整、无超长编码、无 UTF-16 代理区（0xED 0xA0..）。</summary>
    private static bool IsValidUtf8(ReadOnlySpan<byte> b)
    {
        int i = 0;
        while (i < b.Length)
        {
            byte c = b[i];
            if (c <= 0x7F) { i++; continue; }

            int need;          // 后续continuation字节数
            byte lo = 0x80, hi = 0xBF; // 首个 continuation 的合法范围
            if (c is >= 0xC2 and <= 0xDF) { need = 1; }
            else if (c == 0xE0) { need = 2; lo = 0xA0; }
            else if (c is >= 0xE1 and <= 0xEC or 0xEE or 0xEF) { need = 2; }
            else if (c == 0xED) { need = 2; hi = 0x9F; }   // 排除代理区 D800-DFFF
            else if (c == 0xF0) { need = 3; lo = 0x90; }
            else if (c is >= 0xF1 and <= 0xF3) { need = 3; }
            else if (c == 0xF4) { need = 3; hi = 0x8F; }   // 最大 U+10FFFF
            else return false;                              // 0x80-0xC1、0xF5-0xFF 非法

            if (b.Length - i - 1 < need) return false;
            for (int k = 1; k <= need; k++)
            {
                byte cc = b[i + k];
                var (cLo, cHi) = k == 1 ? (lo, hi) : (0x80, 0xBF);
                if (cc < cLo || cc > cHi) return false;
            }
            i += need + 1;
        }
        return true;
    }

    /// <summary>
    /// GBK 启发式：每个高位字节（0x81-0xFE）必须后随合法尾字节（0x40-0x7E 或 0x80-0xFE），
    /// 且双字节序列至少 2 对。低位单字节（Latin1 重音字母）走不到第 2 对 → 判 Latin1。
    /// </summary>
    private static bool LooksLikeGbk(ReadOnlySpan<byte> b)
    {
        int pairs = 0;
        int i = 0;
        while (i < b.Length)
        {
            byte c = b[i];
            if (c <= 0x7F) { i++; continue; }
            if (c is < 0x81 or > 0xFE) return false;     // 0x80 / 0xFF 在 GBK 中不作为首字节
            if (i + 1 >= b.Length) return false;         // 首字节悬空
            byte t = b[i + 1];
            if (t is < 0x40 or > 0xFE or 0x7F) return false;
            pairs++;
            i += 2;
        }
        return pairs >= 2;
    }
}
