/**
 * 侧栏（真实 Sidebar 组件）宽度行为 harness（开发用，不随应用分发）：
 * 挂 Shell.tsx 的 Sidebar + .main grid 骨架，浏览器里点击导航项，
 * 探针实时显示 .main 列宽与 Office 标签是否被裁切（scrollWidth > clientWidth）。
 */
import "../src/styles.css";
import "../src/builtinPages"; // 模块副作用：registerBuiltinPages
import { createRoot } from "react-dom/client";
import { Sidebar } from "../src/components/Shell";
import { setState, useApp } from "../src/state/store";

// zh-Hans 导航词表（抄 app/resources/Strings.tsv）
setState({
  booted: true,
  i18n: {
    lang: "zh-Hans",
    strings: {
      Nav_Projects: "项目",
      Nav_Log: "日志",
      Nav_Changes: "更改",
      Nav_Branches: "分支",
      Nav_Tasks: "任务",
      Nav_Terminal: "终端",
      Nav_Files: "文件",
      Nav_Office: "Office 文档",
      Nav_Settings: "设置",
      Common_ToggleSidebar: "切换侧栏",
      Main_WindowTitle: "Gitter — {0}",
      Palette_Title: "命令面板",
    },
  },
  repo: { workDir: "D:/Code/Gitter", name: "Gitter" },
});

function Content() {
  const { page } = useApp();
  return <div className="content">当前页：{page}</div>;
}

createRoot(document.getElementById("root")!).render(
  <div className="main" id="main">
    <Sidebar />
    <Content />
  </div>,
);

// ---- 探针：每次点击/动画帧后汇报列宽与各标签裁切情况 ----
const probe = document.getElementById("probe")!;
function report() {
  const main = document.querySelector<HTMLElement>(".main");
  const cols = main?.style.gridTemplateColumns || getComputedStyle(main!).gridTemplateColumns;
  const lines: string[] = [`列宽: ${cols.split(" ")[0]}`];
  for (const el of document.querySelectorAll<HTMLElement>(".nav-label")) {
    const name = el.textContent ?? "";
    const clipped = el.scrollWidth > el.offsetWidth;
    if (clipped || name.includes("Office")) {
      lines.push(`${name}: scroll=${el.scrollWidth} box=${el.offsetWidth}${clipped ? "  ← 被裁切" : ""}`);
    }
  }
  probe.textContent = lines.join("\n");
}
document.addEventListener("click", () => setTimeout(report, 350)); // 等 300ms 过渡结束
new MutationObserver(report).observe(document.querySelector(".main")!, { attributes: true, attributeFilter: ["style"] });
setInterval(report, 1000);
report();
