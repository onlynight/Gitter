import * as fs from "fs";
import * as path from "path";

// agent → 人 的审查反馈存取（C# AgentFeedbackStore 移植）：
// 存 <repo>/.git/gitter/feedback.json（仓库本地、不入版本控制），变更页读出展示。

export interface AgentFeedback {
  note: string;
  path: string | null;
  createdAt: string;
}

function fileOf(workDir: string): string {
  return path.join(workDir, ".git", "gitter", "feedback.json");
}

export function writeFeedback(workDir: string, note: string, filePath: string | null): void {
  const dir = path.dirname(fileOf(workDir));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    fileOf(workDir),
    // PascalCase 与 C# AgentFeedbackStore 序列化格式互通
    JSON.stringify({ Note: note, Path: filePath, CreatedAt: new Date().toISOString() }),
  );
}

export function readFeedback(workDir: string): AgentFeedback | null {
  try {
    const file = fileOf(workDir);
    if (!fs.existsSync(file)) return null;
    const root = JSON.parse(fs.readFileSync(file, "utf8"));
    const note = root.Note ?? root.note;
    if (typeof note !== "string") return null;
    return {
      note,
      path: typeof (root.Path ?? root.path) === "string" ? root.Path ?? root.path : null,
      createdAt: typeof root.CreatedAt === "string" ? root.CreatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearFeedback(workDir: string): void {
  try {
    fs.unlinkSync(fileOf(workDir));
  } catch {
    // 不存在/占用：忽略
  }
}
