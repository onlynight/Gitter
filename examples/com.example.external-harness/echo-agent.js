#!/usr/bin/env node
// Echo Agent——外部 harness 示例的最小占位实现（manifest.spawn 指向仓库根的该脚本副本）。
// 协议：stdin 收任务描述；stdout 逐行 JSONL 事件（映射规则见 manifest.contributes.harnesses[0].events）。
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "assistant", text: `echo-agent 收到任务：${prompt.trim().slice(0, 120)}` }));
  console.log(JSON.stringify({ sessionId: "echo-1" }));
  console.log(JSON.stringify({ type: "done", outcome: "completed" }));
});
