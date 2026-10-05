using System.Security.Cryptography;
using System.Text;

namespace GitUI.App.Platform;

/// <summary>
/// API key 的 DPAPI 保护（ai-native-redesign.md §8.1：Gitter 不托管 key，
/// 密钥以 CurrentUser 范围加密后存设置 JSON，明文只在内存短暂存在）。
/// blob 不是 base64 的封装串时原样返回 null（兼容明文旧值的判定由调用方处理——本项目从一开始就是密文，无旧值）。
/// </summary>
public static class SecretProtector
{
    private static readonly byte[] Entropy = "GitUI.Ai.Key.v1"u8.ToArray();

    public static string? Protect(string? plain)
    {
        if (string.IsNullOrEmpty(plain)) return null;
        var blob = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Entropy, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(blob);
    }

    public static string? Unprotect(string? blob)
    {
        if (string.IsNullOrEmpty(blob)) return null;
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(blob), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (CryptographicException)
        {
            // 换用户/换机器后旧密文解不开：视为未配置 key（用户重新填写）
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
