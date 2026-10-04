# fix-embedded-escapes.py - double single backslashes inside the test's embedded tmLanguage JSON
import io
import json
import re

p = "tests/GitUI.Render.Tests/HighlightingTests.cs"
raw = open(p, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")

i = s.index("PythonTmLanguage = \"\"\"") + len("PythonTmLanguage = \"\"\"")
j = s.index("\"\"\"", i)
tm = s[i:j]

# 单反斜杠+字母 → 双反斜杠（JSON 转义修复；\b/\f 当前语义为退格/换页，同样纠正）
fixed = re.sub(r"\\([a-zA-Z])", r"\\\\\\\\\\1", tm)

d = json.loads(fixed)  # 校验合法
json.dumps(d)          # 校验可序列化

s = s[:i] + fixed + s[j:]
open(p, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
print("escapes doubled")
