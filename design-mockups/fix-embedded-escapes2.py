# fix-embedded-escapes2.py - normalize backslash runs in embedded tmLanguage:
# 奇数长度反斜杠串（非法 JSON 或退格语义）加倍为偶数；偶数串保持不变。
import io
import json
import re

p = "tests/GitUI.Render.Tests/HighlightingTests.cs"
raw = open(p, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")

B = chr(92)

i = s.index("PythonTmLanguage = \"\"\"") + len("PythonTmLanguage = \"\"\"")
j = s.index('"""', i)
tm = s[i:j]

run_pattern = "(" + B + B + "+)"        # 一段连续反斜杠
fixed, n = re.subn(run_pattern, lambda m: m.group(0) + m.group(0), tm)
print("runs doubled:", n)

try:
    d = json.loads(fixed)
    print("JSON OK; fileTypes:", d.get("fileTypes"), "; patterns:", len(d.get("patterns", [])))
except json.JSONDecodeError as e:
    lines = fixed.split(chr(10))
    bad = lines[e.lineno - 1]
    print("JSON ERR:", e.msg, "line", e.lineno, "col", e.colno)
    print("ctx:", repr(bad[max(0, e.colno - 15):e.colno + 10]))
    raise SystemExit(1)

s = s[:i] + fixed + s[j:]
open(p, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
print("written back")
