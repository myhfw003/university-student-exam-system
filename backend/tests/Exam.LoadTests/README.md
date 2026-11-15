# 压测（k6）

四个场景对应设计文档《08-deployment-operations.md》§6.1：

| 脚本 | 目标 | 负载模型 |
|---|---|---|
| `login.js` | 认证链路 | 1000 VU，30 秒 |
| `start-exam.js` | 开考突发 | 1000 VU 同时 `POST /attempts`，30 秒窗口 |
| `answer-submit.js` | 持续作答 | 1000 VU，每 8 秒保存一批答案，持续 10 分钟 |
| `submit-burst.js` | 交卷突发 | 1000 VU 在最后 60 秒集中交卷 |

## 阈值（CI 强制）

| 指标 | 阈值 |
|---|---|
| 答卷丢失率 | **必须为 0** |
| HTTP 错误率 | < 0.1% |
| p95 延迟 | < 500 ms |
| p99 延迟 | < 1500 ms |
| 请求数 | ≥ 30000 |

阈值写在 `common.js` 的 `thresholds` 里，k6 在退出时按阈值判定成败。

## 运行

```bash
# 1. 铺账号：压测前用种子数据准备 1000 个考生账号（load00001…load01000）
# 2. 建一场考试并发布，记下场次 ID 与题目 ID
export BASE_URL=http://localhost:8080
export STUDENT_PREFIX=load
export STUDENT_COUNT=1000
export STUDENT_PASSWORD='Passw0rd!'
export EXAM_SESSION_ID=30
export QUESTION_IDS='501,502,503,504,505'

# 3. 跑场景
k6 run tests/Exam.LoadTests/login.js
k6 run tests/Exam.LoadTests/start-exam.js
k6 run tests/Exam.LoadTests/answer-submit.js
k6 run tests/Exam.LoadTests/submit-burst.js
```

## 零丢答对账

压测不能只看 HTTP 成功率——**成功响应不等于答案落库了**。跑完场景后必须做端到端对账：

```bash
DATABASE_URL=postgres://exam_owner:exam_owner_password@localhost:5432/exam \
  ./tests/Exam.LoadTests/reconcile.sh
```

判据：会话上记下的最大 `client_seq` 必须等于库里落库的最大 `client_seq`；
会话说收到了、库里没有，就是丢了一批答案，脚本以非零码退出。

同一套判据在生产里由 `Exam.Worker` 的 **答卷对账作业**（`AnswerReconciliationJob`）定时执行：
考试期间每 10 分钟一轮，发现差异就写审计流水并报警。
