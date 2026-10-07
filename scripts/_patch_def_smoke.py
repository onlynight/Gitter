import io

p = 'app/src/smoke-seams-def.ts'
s = io.open(p, encoding='utf-8').read()

# 1) fixture manifest 补 emptyHints
old = '''    skills: [{
      id: "concise", name: "简洁回答", description: "保持三句以内",
      instructions: "回答必须以「按技能：」开头，且不超过三句话。", tools: [],
    }],'''
new = '''    skills: [{
      id: "concise", name: "简洁回答", description: "保持三句以内",
      instructions: "回答必须以「按技能：」开头，且不超过三句话。", tools: [],
    }],
    emptyHints: [{ slot: "changes.empty", text: "工作区很干净——试试侧栏的插件面板？" }],'''
assert s.count(old) == 1, "t1"
s = s.replace(old, new)

# 2) mock LLM：第 2 次调用返回 SSE 流
old = '''    if (llmCallCount === 1) {
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "repo.status", arguments: "{}" } }] } }],
      }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "最终回答：仓库状态已查询。" } }] }));
    }'''
new = '''    if (llmCallCount === 1) {
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "repo.status", arguments: "{}" } }] } }],
      }));
    } else {
      // SSE 流式（D 残留收口验收）：delta 分片 + [DONE]
      res.setHeader("Content-Type", "text/event-stream");
      const chunks = ["最终", "回答：", "仓库状态已", "查询。"];
      for (const c of chunks) {
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: c } }] }) + "\\n\\n");
      }
      res.write("data: [DONE]\\n\\n");
      res.end();
    }'''
assert s.count(old) == 1, "t2"
s = s.replace(old, new)

# 3) 循环调用带 onDelta 收集
old = '''  const result = await runRegisteredLoop("builtin.tools", {
    workDir: repo,
    system: "You are a git assistant.",
    user: "检查仓库状态",
    skills: skills.map((k) => ({ name: k.name, instructions: k.instructions })),
    maxSteps: 6,
    requestApproval: async () => false,
  }, { provider: "openai", endpoint: `http://127.0.0.1:${addr.port}`, model: "mock", cliCommand: null, apiKey: null });
  check("工具循环端到端（tool_call → 执行 → 终答）", result.text.includes("最终回答") && result.steps.length === 2 &&
    result.steps[0].kind === "tool" && result.steps[0].tool === "repo.status" && (result.steps[0].result ?? "").includes("clean"),
    JSON.stringify(result.steps.map((s) => s.kind)));'''
new = '''  const deltas: string[] = [];
  const result = await runRegisteredLoop("builtin.tools", {
    workDir: repo,
    system: "You are a git assistant.",
    user: "检查仓库状态",
    skills: skills.map((k) => ({ name: k.name, instructions: k.instructions })),
    maxSteps: 6,
    requestApproval: async () => false,
    onDelta: (d) => deltas.push(d),
  }, { provider: "openai", endpoint: `http://127.0.0.1:${addr.port}`, model: "mock", cliCommand: null, apiKey: null });
  check("工具循环端到端（tool_call → 执行 → 终答）", result.text.includes("最终回答") && result.steps.length === 2 &&
    result.steps[0].kind === "tool" && result.steps[0].tool === "repo.status" && (result.steps[0].result ?? "").includes("clean"),
    JSON.stringify(result.steps.map((s) => s.kind)));
  check("SSE 流式（delta 透传 + 终文一致）", deltas.join("") === result.text && deltas.length === 4,
    `deltas=${deltas.length} joined=${deltas.join("")}`);'''
assert s.count(old) == 1, "t3"
s = s.replace(old, new)

# 6) emptyHints 断言（skills 断言后）
old = '''  check("技能包列举（ext.<pkg>.<id>）", skills.length === 1 && skills[0].id === "ext.com.def.demo.concise" &&
    skills[0].instructions.includes("按技能"), JSON.stringify(skills.map((s) => s.id)));'''
new = '''  check("技能包列举（ext.<pkg>.<id>）", skills.length === 1 && skills[0].id === "ext.com.def.demo.concise" &&
    skills[0].instructions.includes("按技能"), JSON.stringify(skills.map((s) => s.id)));
  const hints = store.emptyHintsOf("changes.empty");
  check("空状态提示接缝（changes.empty）", hints.length === 1 && hints[0].text.includes("插件面板") &&
    store.emptyHintsOf("log.empty").length === 0, JSON.stringify(hints));'''
assert s.count(old) == 1, "t6"
s = s.replace(old, new)

# 7) catalog 生成断言（面板断言后、llm.close 前）
old = '''  llm.close();'''
new = '''  // G：catalog 生成器（宿主侧目录清单）
  const catalogPath = path.join(tmp, "catalog.json");
  execFileSync(process.execPath, [path.resolve(__dirname, "../../scripts/gen-catalog.mjs"), userRoot, catalogPath], { stdio: "pipe" });
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const demoEntry = (catalog.packages ?? []).find((x) => x.id === "com.def.demo");
  check("catalog 生成器（宿主同源校验 + checksum）", !!demoEntry && demoEntry.state === "ok" &&
    demoEntry.kinds.includes("skills") && String(demoEntry.checksum).startsWith("sha256:") &&
    (catalog.packages ?? []).some((x) => x.state === "error"),
    JSON.stringify(catalog.packages?.map((x) => [x.id ?? x.dir, x.state])));

  llm.close();'''
assert s.count(old) == 1, "t7"
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('seams-def 扩展 ✓')
