# 完工审计：渲染层引用 vs 宿主提供 / i18n 引用 vs 词条表 / TODO 残留
import io, os, re, json

root = os.getcwd()
web = os.path.join(root, "web", "src")
app = os.path.join(root, "app", "src")

# 1) 渲染层调用的 RPC 清单
rpc_used = set()
for dirpath, _, files in os.walk(web):
    for f in files:
        if not f.endswith((".ts", ".tsx")):
            continue
        s = io.open(os.path.join(dirpath, f), encoding="utf-8").read()
        rpc_used |= set(re.findall(r'call<[^>]*>\(\s*"([\w.]+)"', s))
        rpc_used |= set(re.findall(r'call\(\s*"([\w.]+)"', s))

# 2) bridge 注册的 RPC 清单
bridge = io.open(os.path.join(app, "bridge.ts"), encoding="utf-8").read()
rpc_provided = set(re.findall(r'R\("([\w.]+)"', bridge))
# preload 直连通道不算
missing_rpc = sorted(rpc_used - rpc_provided)
extra_rpc = sorted(rpc_provided - rpc_used)

# 3) i18n：渲染层引用的 key vs TSV 词条
tsv = io.open(os.path.join(root, "app", "resources", "Strings.tsv"), encoding="utf-8").read()
tsv_keys = set()
for line in tsv.split("\n"):
    if line and not line.startswith("#"):
        k = line.split("\t")[0].strip()
        if k:
            tsv_keys.add(k.replace(".", "_"))
keys_used = set()
for dirpath, _, files in os.walk(web):
    for f in files:
        if not f.endswith((".tsx", ".ts")):
            continue
        s = io.open(os.path.join(dirpath, f), encoding="utf-8").read()
        keys_used |= set(re.findall(r'\bt\("([A-Za-z0-9_]+)"', s))
        keys_used |= set(re.findall(r'titleKey: "([A-Za-z0-9_]+)"', s))
        keys_used |= set(re.findall(r'categoryKey: "([A-Za-z0-9_]+)"', s))
        keys_used |= set(re.findall(r'labelKey: "([A-Za-z0-9_]+)"', s))
missing_keys = sorted(keys_used - tsv_keys)

# 4) TODO/FIXME/未实现 残留
todos = []
for base in (web, app):
    for dirpath, _, files in os.walk(base):
        for f in files:
            if not f.endswith((".ts", ".tsx")):
                continue
            s = io.open(os.path.join(dirpath, f), encoding="utf-8").read()
            for i, ln in enumerate(s.split("\n"), 1):
                if re.search(r'\b(TODO|FIXME|HACK|未实现|待实现)\b', ln) and "node_modules" not in dirpath:
                    todos.append(f"{os.path.relpath(os.path.join(dirpath, f), root)}:{i}: {ln.strip()[:90]}")

print("== 渲染层调用但 bridge 未注册 ==")
for m in missing_rpc: print(" -", m)
print("== bridge 注册但渲染层未调用（可能为主进程内部/预留） ==")
print(" ", len(extra_rpc), "个:", ", ".join(extra_rpc[:20]))
print("== 渲染层引用但 TSV 缺失的 i18n key ==")
for m in missing_keys: print(" -", m)
print("== TODO/FIXME 残留 ==")
for t in todos: print(" -", t)
print("== 统计 ==")
print(f"rpc_used={len(rpc_used)} provided={len(rpc_provided)} missing={len(missing_rpc)}")
print(f"keys_used={len(keys_used)} missing_keys={len(missing_keys)} todos={len(todos)}")
