/* ==========================================================================
   知行测评 · 答题页顶栏
   --------------------------------------------------------------------------
   原型 .exam-bar 的 React 实现：标题 / 进度说明 / 计时 / 标记 / 交卷。
   ========================================================================== */

import type { ReactNode } from "react";
import { formatClock } from "@exam/shared";
import { Icon } from "@/app/Icon";

/** 顶栏属性。 */
export interface ExamBarProps {
  /** 标题。 */
  title: string;
  /** 副说明（进度、卷型等）。 */
  note: ReactNode;
  /** 倒计时秒数；缺省则不显示计时（练习不计时）。 */
  remainingSec?: number;
  /** 最后 5 分钟转警告色。 */
  warnThreshold?: number;
  /** 标记按钮。 */
  flagLabel: string;
  onToggleFlag: () => void;
  /** 提交按钮。 */
  submitLabel: string;
  onSubmit: () => void;
  /** 附加内容（离线提示等）。 */
  children?: ReactNode;
}

/** 答题页顶栏。 */
export function ExamBar({
  title,
  note,
  remainingSec,
  warnThreshold = 300,
  flagLabel,
  onToggleFlag,
  submitLabel,
  onSubmit,
  children,
}: ExamBarProps) {
  const warn = remainingSec !== undefined && remainingSec <= warnThreshold;

  return (
    <div className="exam-bar">
      <div>
        <div className="exam-bar-title">{title}</div>
        <div className="timer-note">{note}</div>
      </div>
      <div className="spacer" />
      {children}
      {remainingSec !== undefined ? (
        <div className="right">
          <div className={`timer${warn ? " is-warn" : ""}`} role="timer" aria-live="off">
            {formatClock(remainingSec)}
          </div>
          <div className="timer-note">剩余时间</div>
        </div>
      ) : null}
      <button type="button" className="btn" onClick={onToggleFlag}>
        <Icon name="flag" />
        {flagLabel}
      </button>
      <button type="button" className="btn btn-primary" onClick={onSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}
