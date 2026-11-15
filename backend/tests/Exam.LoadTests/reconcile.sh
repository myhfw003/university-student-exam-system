#!/usr/bin/env bash
# 端到端零丢答对账。
#
# 判据（与 AnswerReconciler 一致）：
#   会话上记下的最大 clientSeq，必须等于库里落库的最大 clientSeq。
#   会话说收到了、库里却没有 —— 就是丢了一批答案。
#
# 用法：
#   DATABASE_URL=postgres://exam_owner:...@localhost:5432/exam ./reconcile.sh
#
# 有差异时打印清单并以非零码退出：丢答率必须为 0。

set -euo pipefail

: "${DATABASE_URL:?请设置 DATABASE_URL（postgres://...）}"

GAPS=$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -At -F'|' <<'SQL'
SELECT a.id,
       a.last_client_seq AS session_seq,
       COALESCE(MAX(ans.client_seq), 0) AS stored_seq
FROM delivery.attempt a
LEFT JOIN delivery.answer ans ON ans.attempt_id = a.id
WHERE a.status IN ('submitted', 'auto_submitted', 'force_submitted')
  AND a.deleted_at IS NULL
  AND a.last_client_seq > 0
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

echo "对账通过：没有丢答。"
