/**
 * Monaco 编辑器 React 封装（inline-editor-plan.md §4.4）：
 * 单编辑器实例 + 多 ITextModel 切换（VS Code 编辑器组语义）——keep-alive：
 * 每个打开的文件持有独立 model（编辑态/撤销栈随 model 存活），切标签换 model 不重建编辑器，
 * 大文件不重复 tokenize；视图状态（滚动/光标/选区）存模块级 store（filesMonaco，
 * 按 model.id）——预览↔编辑切换会卸载本组件，实例内缓存会丢位置，模块级使切回即恢复。
 * model 的创建与销毁归调用方（FilesEditorPane），本组件只挂载/切换。
 *
 * 另持有：字号缩放（Ctrl+滚轮 / Ctrl+=/-/0，localStorage 持久化）、
 * 定位到行（全局搜索结果点击）、imperative 动作面（quickOutline 等 editor action）。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as MonacoNs from "monaco-editor";
import { useAppState } from "../pageSdk";
import { applyMonacoTheme, createEditor, markerCounts, saveViewState, viewStateOf } from "./filesMonaco";
import { updateGitGutter } from "./filesGitGutter";

type MonacoEditor = MonacoNs.editor.IStandaloneCodeEditor;
type MonacoModel = MonacoNs.editor.ITextModel;

export interface FilesMonacoEditorProps {
  /** 文本模型（调用方用 createTextModel 创建并持有；null = 暂无可编辑内容） */
  model: unknown | null;
  /** 内容变更回调（用户输入；程序性 setValue——如冲突重新加载——经 isFlush 过滤） */
  onChange?: (value: string) => void;
  /** 光标位置变更（页脚 Ln/Col；model 切换恢复视图状态后也会回报一次） */
  onPosition?: (pos: { line: number; col: number }) => void;
  /** 诊断计数变更（页脚「问题」段） */
  onMarkers?: (counts: { errors: number; warnings: number }) => void;
  /** 只读模式 */
  readOnly?: boolean;
  /** git gutter 基线（HEAD 版本全文）：null = 未就绪；"" = 未跟踪新文件 */
  gitBase?: string | null;
  /** git 行级 diff 高亮开关（false = 清除高亮；基线保留，重开即时恢复） */
  showDiff?: boolean;
  /** 外部定位请求（全局搜索结果点击；ts 防同值去重） */
  revealLine?: { line: number; ts: number } | null;
  /** 是否持有全局字号快捷键（分屏双实例时仅主实例持有，避免一次按键缩两档） */
  ownsKeys?: boolean;
}

export interface FilesMonacoEditorHandle {
  /** 运行编辑器内置 action（quickOutline / format 等；action 不存在返回 false） */
  runAction(actionId: string): boolean;
  /** 当前字号（分屏实例与主实例保持一致时读） */
  fontSize(): number;
}

const FONT_KEY = "gitter.files.fontSize";
const FONT_MIN = 9;
const FONT_MAX = 32;

function loadFontSize(): number {
  const n = Number(window.localStorage.getItem(FONT_KEY));
  return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : 13;
}

export const FilesMonacoEditor = forwardRef<FilesMonacoEditorHandle, FilesMonacoEditorProps>(
  function FilesMonacoEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const edRef = useRef<MonacoEditor | null>(null);
    const fontSizeRef = useRef(loadFontSize());
    const cbRef = useRef(props);
    cbRef.current = props;

    const theme = useAppState().theme;

    // 创建一次（组件生命周期 = 编辑区生命周期；卸载只 dispose 编辑器，model 归调用方）。
    // 卸载前把当前视图状态存入模块级 store——预览接管画布（md/html 切预览）走的就是
    // 这条卸载路径，不存则切回编辑时丢位置
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const ed = createEditor(host, { fontSize: fontSizeRef.current });
      edRef.current = ed;
      return () => {
        const m = ed.getModel() as MonacoModel | null;
        if (m) {
          const vs = ed.saveViewState();
          if (vs) saveViewState(m, vs);
        }
        ed.dispose();
        edRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 主题（亮暗/syntax 表）变化 → 重定义并应用
    useEffect(() => {
      applyMonacoTheme(theme);
    }, [theme]);

    // readOnly 切换
    useEffect(() => {
      edRef.current?.updateOptions({ readOnly: !!props.readOnly });
    }, [props.readOnly]);

    // 字号缩放：Ctrl+滚轮（画布上）+ Ctrl+=/-/0（全局键盘）；跨实例经 storage 事件同步
    const applyFont = (px: number) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
      fontSizeRef.current = next;
      window.localStorage.setItem(FONT_KEY, String(next));
      edRef.current?.updateOptions({ fontSize: next });
    };
    useEffect(() => {
      const host = hostRef.current;
      const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        applyFont(fontSizeRef.current + (e.deltaY < 0 ? 1 : -1));
      };
      const onKey = (e: KeyboardEvent) => {
        if (!cbRef.current.ownsKeys) return;
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        if (e.key === "=" || e.key === "+") { e.preventDefault(); applyFont(fontSizeRef.current + 1); }
        else if (e.key === "-") { e.preventDefault(); applyFont(fontSizeRef.current - 1); }
        else if (e.key === "0") { e.preventDefault(); applyFont(13); }
      };
      host?.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKey);
      return () => {
        host?.removeEventListener("wheel", onWheel);
        window.removeEventListener("keydown", onKey);
      };
    }, []);

    // 外部定位（搜索结果点击/问题面板）：reveal 居中 + 光标落位 + 焦点；
    // 依赖含 model——搜索打开新文件时定位先于 model 就绪到达，model 挂载后需补触发
    useEffect(() => {
      const ed = edRef.current;
      const r = props.revealLine;
      if (!ed || !r || !props.model) return;
      ed.revealLineInCenter(r.line);
      ed.setPosition({ lineNumber: r.line, column: 1 });
      ed.focus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.revealLine?.ts, props.model]);

    useImperativeHandle(ref, () => ({
      runAction: (actionId: string) => {
        const ed = edRef.current;
        if (!ed) return false;
        const a = ed.getAction(actionId);
        if (!a) return false;
        a.run();
        return true;
      },
      fontSize: () => fontSizeRef.current,
    }), []);

    // model 挂载/切换：保存旧视图状态（模块级 store）→ 换 model → 恢复新视图状态 → 重订内容变更
    useEffect(() => {
      const ed = edRef.current;
      if (!ed) return;

      const prev = ed.getModel() as MonacoModel | null;
      if (prev) {
        const vs = ed.saveViewState();
        if (vs) saveViewState(prev, vs);
      }

      const model = props.model as MonacoModel | null;
      ed.setModel(model);
      if (model) {
        const vs = viewStateOf(model);
        if (vs) ed.restoreViewState(vs);
        ed.focus();
      }

      // 切换后立即回报一次光标/诊断（页脚随标签切换刷新）
      const pos = ed.getPosition();
      if (pos) cbRef.current.onPosition?.({ line: pos.lineNumber, col: pos.column });
      cbRef.current.onMarkers?.(markerCounts(model));

      const sub = ed.onDidChangeModelContent((e) => {
        if (e.isFlush) return; // 程序性 setValue（重新加载）不算用户编辑
        cbRef.current.onChange?.(model ? model.getValue() : "");
      });

      // git 行级 diff 高亮：model 就绪即算；内容任何变化（含 isFlush 重载）防抖重算；
      // showDiff=false 一律清空（基线仍在 props 里，切回「变更」模式即时恢复）
      let gutterTimer = 0;
      const rerunGutter = () => {
        window.clearTimeout(gutterTimer);
        gutterTimer = window.setTimeout(() => {
          const m = ed.getModel() as MonacoModel | null;
          if (m && m === model) {
            updateGitGutter(m, cbRef.current.showDiff ? (cbRef.current.gitBase ?? null) : null);
          }
        }, 250);
      };
      if (model) {
        updateGitGutter(model, cbRef.current.showDiff ? (cbRef.current.gitBase ?? null) : null);
      }
      const subGutter = model ? model.onDidChangeContent(rerunGutter) : null;

      return () => {
        sub.dispose();
        subGutter?.dispose();
        window.clearTimeout(gutterTimer);
      };
    }, [props.model]);

    // 基线异步到达 / 模式开关切换 → 对当前 model 重算
    useEffect(() => {
      const m = edRef.current?.getModel() as MonacoModel | null;
      if (m) updateGitGutter(m, props.showDiff ? (props.gitBase ?? null) : null);
    }, [props.gitBase, props.showDiff]);

    // 光标/诊断订阅（编辑器级事件，跨 model 切换存活；全局 marker 变化按当前 model 过滤）
    useEffect(() => {
      const ed = edRef.current;
      if (!ed) return;
      const reportMarkers = () => cbRef.current.onMarkers?.(markerCounts(ed.getModel()));
      const d1 = ed.onDidChangeCursorPosition((e) => {
        cbRef.current.onPosition?.({ line: e.position.lineNumber, col: e.position.column });
      });
      const d2 = MonacoNs.editor.onDidChangeMarkers(reportMarkers);
      return () => {
        d1.dispose();
        d2.dispose();
      };
    }, []);

    return <div ref={hostRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
  },
);
