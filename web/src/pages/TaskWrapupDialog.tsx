/**
 * 任务收尾闭环（task-page-wrapup-and-list-design.md 工作流 B/C）：
 * - TaskWrapupDialog：合并回基线分支（mergeCheck 预检 → squash/--no-ff → 清理 worktree+分支）
 * - TaskFeedbackDialog：验收反馈（agent.task.feedback 受限提示开新轮）
 * 由 TasksPage 消费；主 worktree 任务不走合并（改动已在工作区）。
 */
import { useEffect, useState } from "react";
import { call } from "../bridge/client";
import type { AgentMergeCheckDTO, AgentMergeResultDTO, AgentTaskDTO } from "../bridge/types";
import { TlIcon } from "./taskIcons";

export function TaskWrapupDialog(props: {
  task: AgentTaskDTO;
  onClose: () => void;
  setError: (e: string) => void;
  /** 合并成功后回调（父级 reload + bump tick + 通知仓库变更） */
  onMerged: (r: AgentMergeResultDTO) => void;
}) {
  const { task } = props;
  const [check, setCheck] = useState<AgentMergeCheckDTO | null>(null);
  const [checking, setChecking] = useState(true);
  const [strategy, setStrategy] = useState<"squash" | "merge">("squash");
  const [message, setMessage] = useState(task.title);
  const [cleanup, setCleanup] = useState(true);
  const [busy, setBusy] = useState(false);

  const runCheck = (silent = false) => {
    if (!silent) setChecking(true);
    void call<AgentMergeCheckDTO>("agent.task.mergeCheck", { taskId: task.taskId })
      .then((c) => setCheck(c))
      .catch((e) => props.setError((e as Error).message))
      .finally(() => setChecking(false));
  };
  useEffect(() => { runCheck(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.taskId]);

  const noWorktree = check && !check.ok && check.reason === "NO_WORKTREE";
  const conflicts = check?.conflicts && check.conflicts.length > 0 ? check.conflicts : null;
  const canMerge = !!check?.ok && check.ahead > 0 && !conflicts && !check.mainDirty && !busy;

  const doMerge = async () => {
    if (!canMerge) return;
    setBusy(true);
    try {
      const r = await call<AgentMergeResultDTO>("agent.task.merge", { taskId: task.taskId, strategy, message: message.trim() || undefined, cleanup });
      if (r.ok) props.onMerged(r);
      else if (r.conflicts) { props.setError(`合并撞上冲突（${r.conflicts.length} 个文件），已恢复现场——可让 Agent 解决后重试`); runCheck(true); }
    } catch (e) { props.setError((e as Error).message); }
    finally { setBusy(false); }
  };

  // 冲突出路 ①：让 Agent 在任务 worktree 内合并基线分支并解决冲突（受限提示续跑）
  const askAgentResolve = async () => {
    if (!check) return;
    try {
      await call("agent.task.resume", {
        taskId: task.taskId,
        prompt: [
          `基线分支 ${check.baseBranch} 已前进，与任务分支产生冲突（文件：${(conflicts ?? []).join("、")}）。`,
          "请在任务 worktree 内执行 git merge " + check.baseBranch + "，逐个解决冲突（以基线侧为准除非任务侧有意修改），完成后提交并简要汇报解决方式。",
        ].join("\n"),
      });
      props.onClose();
    } catch (e) { props.setError((e as Error).message); }
  };

  return (
    <div className="tk-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <span className="t">合并任务改动</span>
          <span className="tk-monochip">{task.branch}</span>
          {conflicts && <span className="tk-pill amber" style={{ marginLeft: "auto" }}><span className="tk-pill-dot" />有冲突</span>}
        </div>

        {checking && <div className="tk-modal-sec" style={{ color: "var(--c-text3)", fontSize: 12 }}>预检中…</div>}

        {noWorktree && (
          <div className="tk-modal-sec">
            <div className="tk-mhint"><TlIcon name="shield" size={12} />当前分支模式（主 worktree）没有独立分支可合并——改动已直接在工作区，请到变更页提交。</div>
          </div>
        )}

        {check?.ok && (
          <>
            <div className="tk-modal-sec">
              <div className="lb">合并到分支</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="tk-monochip" style={{ color: "var(--c-text)" }}>{check.baseBranch}</span>
                <span style={{ color: "var(--c-text3)", fontSize: 11 }}>
                  任务领先 <b style={{ color: "var(--c-text2)" }}>{check.ahead}</b> 提交 · 基线领先 {check.behind} 提交
                  {check.uncommitted > 0 ? ` · worktree 未提交 ${check.uncommitted} 个文件` : ""}
                </span>
              </div>
              {check.mainBranch && check.mainBranch !== check.baseBranch && (
                <div className="tk-mhint"><TlIcon name="branch" size={12} />主 worktree 当前在 {check.mainBranch}，合并时会切回 {check.baseBranch}</div>
              )}
              {check.mainDirty && (
                <div className="tk-mhint"><TlIcon name="shield" size={12} />主 worktree 有未提交改动——请先在变更页处理再合并</div>
              )}
              {!check.mainDirty && check.uncommitted > 0 && (
                <div className="tk-mhint ok"><TlIcon name="check" size={12} />任务 worktree 的未提交改动将在合并前自动创建「收尾提交」检查点</div>
              )}
            </div>

            <div className="tk-modal-sec">
              <div className="lb">合并策略</div>
              <div style={{ display: "flex" }}>
                {[["squash", "squash 单提交（默认）"], ["merge", "merge --no-ff"]].map(([v, label]) => (
                  <button key={v} className={"tk-fchip" + (strategy === v ? " on" : "")}
                    style={{ borderRadius: v === "squash" ? "8px 0 0 8px" : "0 8px 8px 0", padding: "4px 10px", flex: 1, justifyContent: "center" }}
                    onClick={() => setStrategy(v as "squash" | "merge")}>{label}</button>
                ))}
              </div>
              <div className="tk-mdesc">{strategy === "squash"
                ? "压成 1 个干净提交进入基线；消息带 Assisted-by / Gitter-Session trailer。"
                : "保留全部 checkpoint 提交 + merge 节点；之后可在 Log 页按 Gitter-Session 归组 squash。"}</div>
            </div>

            <div className="tk-modal-sec">
              <div className="lb">提交消息</div>
              <textarea className="tk-minput" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className="tk-mtrailer">Assisted-by: gitter-agent{"\n"}Gitter-Session: {task.taskId}</div>
            </div>

            {check.diffStat && (
              <div className="tk-modal-sec">
                <details className="tk-mdetails">
                  <summary>差异预览 · diff --stat（{check.ahead} 个提交）</summary>
                  <div className="dbody">{check.diffStat}</div>
                </details>
              </div>
            )}

            {conflicts && (
              <div className="tk-modal-sec">
                <div className="tk-conflict">
                  <div className="ct"><TlIcon name="shield" size={13} />预检发现 {conflicts.length} 个冲突文件（git merge-tree）</div>
                  {conflicts.map((f) => (
                    <div key={f} className="cf"><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f}</span><span className="b">双方修改</span></div>
                  ))}
                  <div className="cnote">两条出路：① 让 Agent 在任务 worktree 内合并 {check.baseBranch} 并解决冲突，完成后重开此对话框重检；② 放弃合并，任务保持原状。</div>
                </div>
              </div>
            )}

            <div className="tk-modal-sec">
              <label className="tk-mcheck">
                <input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} />
                合并后清理 worktree 与 {task.branch} 分支，并归档任务
              </label>
            </div>

            <div className="tk-modal-foot">
              <span className="left">合并前会重跑预检（防竞态）；主 worktree 必须干净</span>
              <button className="tool-btn" onClick={props.onClose}>取消</button>
              {conflicts && <button className="tool-btn" onClick={() => void askAgentResolve()}>让 Agent 解决冲突</button>}
              <button className="tool-btn" disabled={!canMerge} style={canMerge ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : undefined}
                onClick={() => void doMerge()}>
                <TlIcon name="branch" size={12} />合并
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function TaskFeedbackDialog(props: {
  task: AgentTaskDTO;
  onClose: () => void;
  setError: (e: string) => void;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await call("agent.task.feedback", { taskId: props.task.taskId, feedback: text.trim() });
      props.onSent();
      props.onClose();
    } catch (e) { props.setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="tk-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="tk-modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <span className="t">验收反馈</span>
          <span className="tk-monochip" style={{ marginLeft: "auto" }}>{props.task.branch}</span>
        </div>
        <div className="tk-modal-sec">
          <div className="lb">对上一轮改动的验收意见（必填）</div>
          <textarea className="tk-minput" rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder="例：导出按钮 hover 态不对；build 过了但 e2e 里 files.spec 超时，请修复…" />
          <div className="tk-mdesc">反馈将作为新一轮启动（受限提示：Agent 只处理这些条目，不自由发挥）；任务会脱离归档并回到运行态，结果回到对话时间线。</div>
        </div>
        <div className="tk-modal-foot">
          <button className="tool-btn" onClick={props.onClose}>取消</button>
          <button className="tool-btn" disabled={!text.trim() || busy} style={text.trim() && !busy ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : undefined}
            onClick={() => void send()}>提交反馈</button>
        </div>
      </div>
    </div>
  );
}
