/* ==========================================================================
   知行测评 · 考试答题页
   --------------------------------------------------------------------------
   对应原型 student.exam.session。相对原型新增（设计文档要求）：
   - 服务端权威倒计时（绝对 deadlineAt，不受本机改时间影响）
   - 切屏检测与反馈（FocusGuard，500ms 窗口去重）
   - 水印
   - 离线与待同步提示
   ========================================================================== */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnswerSheet, Button, Empty, RuleList, formatDateTime, toast } from "@exam/shared";
import { Icon } from "@/app/Icon";
import { useStudentStore } from "@/stores/studentStore";
import { useExamSessionStore } from "@/stores/examSessionStore";
import { ExamBar } from "./ExamBar";
import { OfflineBadge } from "./OfflineBadge";
import { QuestionPane } from "./QuestionPane";
import { SubmitDialog } from "./SubmitDialog";
import { Watermark } from "./Watermark";
import { useExamSession } from "./useExamSession";

/** 考试答题页。 */
export function ExamSessionPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const studentId = useStudentStore((state) => state.studentId);
  const controller = useExamSession(sessionId);
  const [submitOpen, setSubmitOpen] = useState(false);

  const {
    exam,
    paper,
    current,
    responses,
    flags,
    answeredCount,
    remainingSec,
    focusLossCount,
    maxFocusLoss,
    offline,
    pending,
    syncing,
    blocked,
  } = controller;

  /* --------------------------------------------------- 阻断态（空状态） */

  if (blocked === "not_found") {
    return (
      <div className="card">
        <Empty
          title="考试不存在"
          body="该考试可能尚未发布，或不在你的名单范围内。"
          action={
            <Button onClick={() => navigate("/exams")}>返回考试安排</Button>
          }
        />
      </div>
    );
  }

  if (blocked === "already_submitted") {
    return (
      <div className="card">
        <Empty
          title="本场考试已交卷"
          body={`交卷时间 ${formatDateTime(controller.submittedAt)}，可前往成绩报告查看详情。${
            exam?.allowRetake ? "本场考试允许重考，成绩按最高分计入。" : ""
          }`}
          action={
            <>
              <Button variant="primary" onClick={() => navigate(`/exams/${sessionId}/report`)}>
                查看成绩报告
              </Button>
              {exam?.allowRetake ? (
                <Button
                  onClick={() => {
                    // 重考：先清空本次作答与计时，否则重新进入会命中「已交卷」。
                    useExamSessionStore.getState().resetForRetake({
                      examId: sessionId,
                      studentId,
                      durationMin: exam?.durationMin ?? 0,
                    });
                    // 原型 student.js:1836：开启重考后提示「已开启重考，成绩按最高分计入」。
                    toast.ok("已开启重考，成绩按最高分计入");
                    navigate(`/exams/${sessionId}`);
                  }}
                >
                  重新作答
                </Button>
              ) : null}
              <Button onClick={() => navigate("/exams")}>返回考试安排</Button>
            </>
          }
        />
      </div>
    );
  }

  if (blocked === "ended") {
    return (
      <div className="card">
        <Empty
          title="考试已结束"
          body="本场考试已关闭作答入口，可前往成绩报告回顾试卷与解析。"
          action={
            <>
              <Button variant="primary" onClick={() => navigate(`/exams/${sessionId}/report`)}>
                回顾试卷
              </Button>
              <Button onClick={() => navigate("/exams")}>返回考试安排</Button>
            </>
          }
        />
      </div>
    );
  }

  if (blocked === "time_up") {
    return (
      <div className="card">
        <Empty
          title="考试时间已到"
          body="系统已自动交卷，正在生成成绩报告。"
          action={
            <Button variant="primary" onClick={() => navigate(`/exams/${sessionId}/report`)}>
              查看成绩报告
            </Button>
          }
        />
      </div>
    );
  }

  if (!exam || !paper || !current) {
    return (
      <div className="card">
        <Empty title="页面加载中" body="正在载入视图模块…" />
      </div>
    );
  }

  /* ------------------------------------------------------------ 主体 */

  const total = paper.items.length;
  const marked = Boolean(flags[current.qid]);

  const cells = paper.items.map((item) => ({
    slot: item.slot,
    qid: item.qid,
    answered: controller.questionMap.get(item.qid)
      ? isAnswered(item.qid, responses, controller.questionMap)
      : false,
    marked: Boolean(flags[item.qid]),
  }));

  return (
    <>
      <ExamBar
        title={exam.name}
        note={
          <>
            {paper.mode === "standard" ? "标准卷" : paper.mode === "small" ? "小梅花" : "大梅花"} ·
            卷号 {paper.variantLabel} · 已答{" "}
            <span className="answer-count" data-fmt="exam">
              {answeredCount}/{total}
            </span>{" "}
            题
          </>
        }
        remainingSec={remainingSec}
        flagLabel={marked ? "取消标记" : "标记"}
        onToggleFlag={() => controller.toggleFlag(current.qid)}
        submitLabel="交卷"
        onSubmit={() => setSubmitOpen(true)}
      >
        <OfflineBadge offline={offline} pending={pending} syncing={syncing} />
      </ExamBar>

      {/* 切屏反馈横幅（第 1 次普通提示，第 2 次升级为警告色） */}
      {focusLossCount > 0 && focusLossCount < maxFocusLoss ? (
        <div
          className={`callout ${focusLossCount >= 2 ? "is-warn" : "is-info"}`}
          style={{ marginBottom: "var(--sp-4)" }}
          role="status"
        >
          <span className="callout-title">
            检测到切屏（第 {focusLossCount}/{maxFocusLoss} 次），请勿离开考试页面
          </span>
        </div>
      ) : null}

      <div className="split">
        <section className="card" style={{ position: "relative", overflow: "hidden" }}>
          <Watermark displayName={studentName(exam, studentId)} username={studentId} />
          <div className="card-body" style={{ position: "relative", zIndex: 1 }}>
            <QuestionPane
              item={current}
              question={current.question}
              response={responses[current.qid]}
              onChoiceChange={(keys) => controller.choose(current.qid, keys)}
              onTextChange={(text) => controller.writeText(current.qid, text)}
              onStepChange={(stepId, text) => controller.writeStep(current.qid, stepId, text)}
            />

            <hr className="divider" />

            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={controller.current === null || paper.items.indexOf(current) === 0}
                onClick={() => controller.goto(paper.items.indexOf(current) - 1)}
              >
                <Icon name="chevronLeft" />
                上一题
              </button>
              <div className="spacer" />
              <span className="text-sm text-3">答案自动保存</span>
              <button
                type="button"
                className="btn"
                disabled={paper.items.indexOf(current) === total - 1}
                onClick={() => controller.goto(paper.items.indexOf(current) + 1)}
              >
                下一题
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
        </section>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">答题卡</h2>
              <span className="text-sm text-3 answer-count" data-fmt="exam">
                {answeredCount}/{total}
              </span>
            </div>
            <div className="card-body">
              <AnswerSheet
                cells={cells}
                currentSlot={current.slot}
                onSelect={(cell) => controller.goto(cell.slot - 1)}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">考试须知</h2>
            </div>
            <div className="card-body">
              <RuleList
                marker="dot"
                items={[
                  exam.note,
                  "本页作答即时保存，关闭浏览器不会丢失。",
                  "交卷前请在答题卡确认未答题目的数量。",
                ]}
              />
            </div>
          </section>
        </aside>
      </div>

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onConfirm={() => {
          setSubmitOpen(false);
          controller.submit();
        }}
        examName={exam.name}
        variantLabel={`${paper.mode === "standard" ? "标准卷" : paper.mode === "small" ? "小梅花" : "大梅花"} · ${paper.variantLabel}`}
        answered={answeredCount}
        total={total}
        remainingSec={remainingSec}
      />
    </>
  );
}

/** 本地判定的「已作答」——按题型分别判定。 */
function isAnswered(
  qid: string,
  responses: Record<string, { choice?: string[]; text?: string; steps?: Record<string, string> }>,
  questionMap: Map<string, { type: string }>,
): boolean {
  const response = responses[qid];
  if (!response) return false;
  const type = questionMap.get(qid)?.type;
  if (type === "short") return (response.text ?? "").trim().length > 0;
  if (type === "comprehensive") {
    return Object.values(response.steps ?? {}).some((text) => text.trim().length > 0);
  }
  return (response.choice ?? []).length > 0;
}

/** 水印用的显示名。 */
function studentName(exam: { name: string }, studentId: string): string {
  void exam;
  return studentId.slice(-4);
}
