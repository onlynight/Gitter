# gen-grammars.py - regenerate all grammar files (single source of truth, verified escapes)
import json
import os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

CS_KEYWORDS = ["abstract","as","async","await","base","break","byte","case","catch","char","checked","class","const","continue","decimal","default","delegate","do","double","else","enum","event","explicit","extern","false","finally","fixed","float","for","foreach","get","goto","if","implicit","in","init","int","interface","internal","is","lock","long","namespace","new","null","object","operator","out","override","params","private","protected","public","readonly","record","ref","return","sealed","set","short","sizeof","stackalloc","static","string","struct","switch","this","throw","true","try","typeof","uint","ulong","unchecked","unsafe","ushort","using","var","virtual","void","volatile","when","where","while"]
CS_BUILTIN_TYPES = ["bool","byte","char","decimal","double","dynamic","float","int","long","nint","nuint","object","sbyte","short","string","uint","ulong","ushort","void","var"]
PS_KEYWORDS = ["if","elseif","else","foreach","for","while","switch","return","function","filter","param","begin","process","end","try","catch","finally","throw","break","continue","in","do","until","trap","class","enum"]
PY_KEYWORDS = ["def","class","if","elif","else","for","while","import","from","as","return","pass","break","continue","lambda","with","in","is","not","and","or","None","True","False","try","except","finally","raise","global","nonlocal","yield","assert","del","async","await"]

files = {}

files["src/GitUI.App/Packages/GitUI.syntax.builtin/syntax/highlighters.json"] = {
    "highlighters": [
        {"id": "builtin.csharp", "language": "csharp", "extensions": [".cs", ".csx"], "rules": [
            {"style": "comment", "blockStart": r"/\*", "blockEnd": r"\*/"},
            {"style": "comment", "pattern": r"//.*$"},
            {"style": "string", "pattern": "\"(?:\\\\.|[^\"\\\\])*\""},
            {"style": "string", "pattern": r"'(?:\\.|[^'\\])'"},
            {"style": "keyword", "keywords": CS_KEYWORDS + CS_BUILTIN_TYPES},
            {"style": "number", "pattern": r"\b(?:0[xX][0-9A-Fa-f_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)[fFdDmMuUlL]*\b"},
            {"style": "type", "pattern": r"\b[A-Z][A-Za-z0-9_]*\b"},
        ]},
        {"id": "builtin.json", "language": "json", "extensions": [".json", ".jsonc"], "rules": [
            {"style": "string", "pattern": "\"(?:\\\\.|[^\"\\\\])*\""},
            {"style": "keyword", "pattern": r"\b(?:true|false|null)\b"},
            {"style": "number", "pattern": r"-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b"},
        ]},
        {"id": "builtin.powershell", "language": "powershell", "extensions": [".ps1", ".psm1", ".psd1"], "rules": [
            {"style": "comment", "pattern": r"#.*$"},
            {"style": "string", "pattern": r"\"[^\"]*\""},
            {"style": "string", "pattern": r"'[^']*'"},
            {"style": "variable", "pattern": r"\$[A-Za-z_][A-Za-z0-9_]*"},
            {"style": "keyword", "keywords": PS_KEYWORDS},
            {"style": "number", "pattern": r"\b0x[0-9A-Fa-f]+\b|\b\d+(?:\.\d+)?\b"},
        ]},
        {"id": "builtin.markdown", "language": "markdown", "extensions": [".md", ".markdown"], "rules": [
            {"style": "string", "pattern": r"`[^`]+`"},
            {"style": "type", "pattern": r"\*\*[^*]+\*\*"},
            {"style": "variable", "pattern": r"\[[^\]]*\]\([^)]*\)"},
            {"style": "keyword", "pattern": r"^#{1,6} .*$"},
        ]},
        {"id": "builtin.xml", "language": "xml", "extensions": [".xml", ".xaml", ".csproj", ".props", ".targets", ".config"], "rules": [
            {"style": "comment", "pattern": r"<!--.*?(?:-->|$)"},
            {"style": "type", "pattern": r"</?[A-Za-z][A-Za-z0-9:.-]*|/?>"},
            {"style": "string", "pattern": r"\"[^\"]*\""},
        ]},
    ]
}

files["src/GitUI.App/Packages/VsCodeDark/syntax/highlighters.json"] = {
    "highlighters": [
        {"id": "vscode.csharp", "language": "csharp", "extensions": [".cs", ".csx"], "rules": [
            {"style": "comment", "blockStart": r"/\*", "blockEnd": r"\*/"},
            {"style": "comment", "pattern": r"//.*$"},
            {"style": "keyword", "pattern": r"^\s*#\w+.*$"},
            {"style": "string", "pattern": "(?:\\$@|@\\$)?@\"(?:\"\"|[^\"])*\""},
            {"style": "string", "pattern": r"\$\"(?:\\.|[^\"\\])*\""},
            {"style": "string", "pattern": "\"(?:\\\\.|[^\"\\\\])*\""},
            {"style": "string", "pattern": r"'(?:\\.|[^'\\])'"},
            {"style": "keyword", "keywords": CS_KEYWORDS + CS_BUILTIN_TYPES},
            {"style": "function", "pattern": r"\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()"},
            {"style": "number", "pattern": r"\b(?:0[xX][0-9A-Fa-f_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)[fFdDmMuUlL]*\b"},
            {"style": "type", "pattern": r"\b[A-Z][A-Za-z0-9_]*\b"},
        ]},
    ]
}

files["src/GitUI.App/Packages/GitUI.syntax.builtin/syntax/python.tmLanguage.json"] = {
    "name": "Python",
    "fileTypes": ["py", "pyw"],
    "patterns": [
        {"include": "#comments"},
        {"include": "#triple-strings"},
        {"include": "#strings"},
        {"match": r"\b(?:def|class|if|elif|else|for|while|import|from|as|return|pass|break|continue|lambda|with|in|is|not|and|or|None|True|False|try|except|finally|raise|global|nonlocal|yield|assert|del|async|await)\b", "name": "keyword.control.python"},
        {"match": r"\b\d+(?:\.\d+)?\b", "name": "constant.numeric.python"},
        {"match": r"\b[A-Z][A-Za-z0-9_]*\b", "name": "entity.name.type.python"},
        {"match": r"\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()", "name": "entity.name.function.python"},
    ],
    "repository": {
        "comments": {"match": r"#.*$", "name": "comment.line.number-sign.python"},
        "strings": {"match": "(?:[fFrRbBuU]{0,2})\"(?:\\\\.|[^\"\\\\])*\"", "name": "string.quoted.double.python"},
        "triple-strings": {"begin": "(?:[fFrRbBuU]{0,2})('''|\"\"\")", "end": "(?:'''|\"\"\")", "name": "string.quoted.triple.python"},
    },
}

for path, doc in files.items():
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    json.loads(text)  # 自校验合法（正则行为由 HighlightingTests 加载断言）
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", path)
