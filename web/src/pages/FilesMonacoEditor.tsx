/**
 * Monaco 编辑器 React 封装（inline-editor-plan.md §4.4）：
 * 单编辑器实例 + 多 ITextModel 切换（VS Code 编辑器组语义）——keep-alive：
 * 每个打开的文件持有独立 model（编辑态/撤销栈随 model 存活），切标签换 model 不重建编辑器，
 * 大文件不重复 tokenize；视图状态（滚动/光标/选区）按 model.id 存取，切回即恢复。
 * model 的创建与销毁归调用方（FilesEditorPane），本组件只挂载/切换。
 */
import { useEffect, useRef } from "react";
import * as MonacoNs from "monaco-editor";
import { useAppState } from "../pageSdk";
import { applyMonacoTheme, createEditor, markerCounts } from "./filesMonaco";

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
}

export function FilesMonacoEditor(props: FilesMonacoEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const edRef = useRef<MonacoEditor | null>(null);
  const viewStates = useRef(new Map<string, MonacoNs.editor.ICodeEditorViewState>());
  const cbRef = useRef(props);
  cbRef.current = props;

  const theme = useAppState().theme;

  // 创建一次（组件生命周期 = 编辑区生命周期；卸载只 dispose 编辑器，model 归调用方）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ed = createEditor(host);
    edRef.current = ed;
    return () => {
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

  // model 挂载/切换：保存旧视图状态 → 换 model → 恢复新视图状态 → 重订内容变更
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;

    const prev = ed.getModel() as MonacoModel | null;
    if (prev) {
      const vs = ed.saveViewState();
      if (vs) viewStates.current.set(prev.id, vs);
    }

    const model = props.model as MonacoModel | null;
    ed.setModel(model);
    if (model) {
      const vs = viewStates.current.get(model.id);
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
    return () => sub.dispose();
  }, [props.model]);

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
}
