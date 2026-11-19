/* ==========================================================================
   知行测评 · 答题页顶栏
   --------------------------------------------------------------------------
   原型 .exam-bar 的 React 实现：标题 / 进度说明 / 计时 / 标记 / 交卷。
   ========================================================================== */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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

/**
 * 分钟级播报。
 *
 * 视觉倒计时每秒都在变，交给读屏会一直刷屏——所以视觉部分对读屏隐藏，
 * 这里只在**整分钟数变化**时更新一次播报文本（设计文档 §9「倒计时不播报」）。
 */
function useMinuteAnnouncement(remainingSec: number | undefined): string {
  const [announcement, setAnnouncement] = useState("");
  const announcedMinute = useRef<number | null>(null);

  useEffect(() => {
    if (remainingSec === undefined) return;
    const minute = Math.max(0, Math.ceil(remainingSec / 60));
    if (minute === announcedMinute.current) return;
    announcedMinute.current = minute;
    setAnnouncement(minute === 0 ? "考试时间已到" : `剩余 ${minute} 分钟`);
  }, [remainingSec]);

  return announcement;
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
  const announcement = useMinuteAnnouncement(remainingSec);

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
          {/* 视觉倒计时对读屏隐藏：每秒变化会一直刷屏。 */}
          <div className={`timer${warn ? " is-warn" : ""}`} aria-hidden="true">
            {formatClock(remainingSec)}
          </div>
          <div className="timer-note">剩余时间</div>
        </div>
      ) : null}
      {remainingSec !== undefined ? (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
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
