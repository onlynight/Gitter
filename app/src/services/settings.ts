import * as fs from "fs";
import * as path from "path";
import type { ProjectDTO, SettingsDTO } from "../shared/types";

/**
 * 设置存储（对齐 AppSettings 字段子集，winui3-to-web-migration.md §十三）。
 * 位置：Electron userData/settings.json（与旧 WinUI 应用的 %APPDATA%/GitUI 分离，不互相覆盖）。
 */
export class SettingsStore {
  private data: SettingsDTO;
  private readonly filePath: string;
  private readonly listeners = new Set<() => void>();

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "settings.json");
    this.data = SettingsStore.defaults();
    this.load();
  }

  static defaults(): SettingsDTO {
    return {
      theme: "system",
      themePackageId: null,
      language: "system",
      projects: [],
      currentProjectPath: null,
      externalEditor: null,
      diffMode: "sideBySide",
      sidebarCollapsed: false,
      bashPath: null,
      terminalFontFamily: "Cascadia Mono",
      terminalFontSize: 13,
      terminalFollowRepo: true,
      terminalShell: "powershell",
      watchWorktree: true,
      autoFetch: true,
      autoFetchIntervalMinutes: 5,
      recentCommands: [],
      aiProvider: "off",
      aiEndpoint: null,
      aiModel: null,
      aiCliCommand: null,
      aiPrivacy: "metadataOnly",
      aiAppendTrailer: true,
      aiApiKeyProtected: null,
      safetyNet: "warn",
      mcpEnabled: true,
      logSplitterFraction: null,
      changesSplitterFraction: null,
    };
  }

  get current(): SettingsDTO {
    return this.data;
  }

  onChanged(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 白名单式补丁更新（渲染层传部分字段），未知字段忽略。 */
  update(patch: Partial<SettingsDTO>): SettingsDTO {
    const allowed: (keyof SettingsDTO)[] = [
      "theme", "themePackageId", "language", "projects", "currentProjectPath",
      "externalEditor", "diffMode", "sidebarCollapsed", "bashPath",
      "terminalFontFamily", "terminalFontSize", "terminalFollowRepo", "terminalShell",
      "watchWorktree", "autoFetch", "autoFetchIntervalMinutes", "recentCommands",
      "aiProvider", "aiEndpoint", "aiModel", "aiCliCommand", "aiPrivacy", "aiAppendTrailer",
      "aiApiKeyProtected", "safetyNet", "mcpEnabled",
      "logSplitterFraction", "changesSplitterFraction",
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        (this.data as unknown as Record<string, unknown>)[key] = patch[key];
      }
    }
    this.save();
    for (const fn of this.listeners) fn();
    return this.data;
  }

  /** 记录最近使用命令（命令面板"最近使用"组，去重置顶，上限 8）。 */
  rememberCommand(id: string) {
    this.data.recentCommands = [id, ...this.data.recentCommands.filter((c) => c !== id)].slice(0, 8);
    this.save();
  }

  private load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      this.data = { ...SettingsStore.defaults(), ...JSON.parse(raw) };
    } catch {
      // 文件不存在/损坏：用默认值（与 C# JsonSettingsStore 行为一致）
    }
  }

  save(): boolean {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  /** 添加/置顶项目并设为当前（项目页"打开"语义）。 */
  setCurrentProject(p: ProjectDTO) {
    this.data.projects = [p, ...this.data.projects.filter((x) => x.path !== p.path)].slice(0, 20);
    this.data.currentProjectPath = p.path;
    this.save();
    for (const fn of this.listeners) fn();
  }

  removeProject(pathToRemove: string) {
    this.data.projects = this.data.projects.filter((x) => x.path !== pathToRemove);
    if (this.data.currentProjectPath === pathToRemove) this.data.currentProjectPath = null;
    this.save();
    for (const fn of this.listeners) fn();
  }
}
