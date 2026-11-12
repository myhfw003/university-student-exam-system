/* ==========================================================================
   知行测评 · 交卷确认
   --------------------------------------------------------------------------
   原型 #dlg-submit 的 React 实现。文案逐字对齐原型。
   ========================================================================== */

import { Dialog } from "@exam/shared";
import { formatClock } from "@exam/shared";

/** 交卷确认属性。 */
export interface SubmitDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** 试卷名。 */
  examName: string;
  /** 卷型名。 */
  variantLabel: string;
  /** 已作答题数。 */
  answered: number;
  /** 总题数。 */
  total: number;
  /** 剩余秒数。 */
  remainingSec: number;
}

/** 交卷确认弹窗。 */
export function SubmitDialog({
  open,
  onClose,
  onConfirm,
  examName,
  variantLabel,
  answered,
  total,
  remainingSec,
}: SubmitDialogProps) {
  const blank = Math.max(0, total - answered);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="确认交卷"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            继续作答
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            确认交卷
          </button>
        </>
      }
    >
      <dl className="kv">
        <dt>试卷</dt>
        <dd>{examName}</dd>
        <dt>卷型</dt>
        <dd>{variantLabel}</dd>
        <dt>已作答</dt>
        <dd>
          {answered} / {total} 题
        </dd>
        <dt>未作答</dt>
        <dd>{blank} 题</dd>
        <dt>剩余时间</dt>
        <dd>{formatClock(remainingSec)}</dd>
      </dl>

      {blank > 0 ? (
        <div className="callout is-warn" style={{ marginTop: "var(--sp-4)" }}>
          <span className="callout-title">仍有 {blank} 题未作答</span>
          <span>交卷后未作答题目按 0 分计，客观题立即判分，主观题进入阅卷队列。</span>
        </div>
      ) : (
        <div className="callout" style={{ marginTop: "var(--sp-4)" }}>
          <span className="callout-title">全部题目已作答</span>
          <span>确认交卷后本次作答不可再修改。</span>
        </div>
      )}
    </Dialog>
  );
}
