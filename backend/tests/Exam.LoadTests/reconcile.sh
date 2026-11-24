#!/usr/bin/env bash
# 端到端零丢答对账。
#
# 两条判据：
#   1. 序列号（与 AnswerReconciler 一致）：
#      会话上记下的最大 clientSeq，必须等于库里落库的最大 clientSeq。
#      会话说收到了、库里却没有 —— 就是丢了一批答案。
#   2. 答题覆盖率：
#      每个已交卷会话答过的题数，必须等于卷面题数。
#      序列号照样前进、但题被服务端拒了（题型对不上的载荷），序列号对账查不出来，
#      只有覆盖率能查出来。压测答的是整卷，所以覆盖率必须满。
#
# 只查丢答、压测只答了卷面的一部分时：SKIP_COVERAGE=1 ./reconcile.sh
#
# 只查某一轮压测的场次时：SESSION_ID=92 ./reconcile.sh
# （库里往往留着更早几轮压测的数据，那几轮的问题不该算在今天这一轮头上。）
#
# 用法：
#   DATABASE_URL=postgres://exam_owner:...@localhost:5432/exam ./reconcile.sh
#
# 有差异时打印清单并以非零码退出：丢答率必须为 0。

set -euo pipefail

: "${DATABASE_URL:?请设置 DATABASE_URL（postgres://...）}"

SESSION_FILTER=""
if [ -n "${SESSION_ID:-}" ]; then
    SESSION_FILTER="AND a.exam_session_id = ${SESSION_ID}"
fi

GAPS=$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -At -F'|' <<SQL
SELECT a.id,
       a.last_client_seq AS session_seq,
       COALESCE(MAX(ans.client_seq), 0) AS stored_seq
FROM delivery.attempt a
LEFT JOIN delivery.answer ans ON ans.attempt_id = a.id
WHERE a.status IN ('submitted', 'auto_submitted', 'force_submitted')
  AND a.deleted_at IS NULL
  AND a.last_client_seq > 0
  ${SESSION_FILTER}
GROUP BY a.id, a.last_client_seq
HAVING a.last_client_seq > COALESCE(MAX(ans.client_seq), 0)
ORDER BY a.id;
SQL
)

if [ -n "${GAPS}" ]; then
    echo "对账失败：发现丢答（会话序列号 > 落库序列号）。"
    echo "attempt_id|session_seq|stored_seq"
    echo "${GAPS}"
    exit 1
fi

echo "对账通过（序列号）：没有丢答。"

if [ "${SKIP_COVERAGE:-0}" = "1" ]; then
    echo "跳过覆盖率对账（SKIP_COVERAGE=1）。"
    exit 0
fi

COVERAGE_GAPS=$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -At -F'|' <<SQL
SELECT a.id,
       COUNT(DISTINCT ans.question_id) AS answered_questions,
       (SELECT COUNT(*) FROM authoring.snapshot_item si WHERE si.snapshot_id = s.snapshot_id) AS paper_questions
FROM delivery.attempt a
JOIN delivery.exam_session s ON s.id = a.exam_session_id
LEFT JOIN delivery.answer ans ON ans.attempt_id = a.id
WHERE a.status IN ('submitted', 'auto_submitted', 'force_submitted')
  AND a.deleted_at IS NULL
  AND a.last_client_seq > 0
  ${SESSION_FILTER}
GROUP BY a.id, s.snapshot_id
HAVING COUNT(DISTINCT ans.question_id) <
       (SELECT COUNT(*) FROM authoring.snapshot_item si WHERE si.snapshot_id = s.snapshot_id)
ORDER BY a.id;
SQL
)

if [ -n "${COVERAGE_GAPS}" ]; then
    echo "对账失败：答题没覆盖全卷（有题被服务端拒了或压根没存上）。"
    echo "attempt_id|answered_questions|paper_questions"
    echo "${COVERAGE_GAPS}"
    exit 1
fi

echo "对账通过（覆盖率）：每个交卷会话都答满了整卷。"
