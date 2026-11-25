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

# 后端侧（不是 k6 的环境变量）：直连后端压测时，后端要信任压测客户端带来的
# X-Forwarded-For，否则每个虚拟用户的来源地址会被算成同一个，
# 登录按 IP 的限流会把整场压测限掉。走 nginx 时 nginx 就在受信任网段里，不用额外配。
# 局域网部署时每台机器各有地址，所以压测也按「每个虚拟用户一个地址」建模。
#   ForwardedHeaders__KnownNetworks__0=127.0.0.1/32
#   ForwardedHeaders__KnownNetworks__1=10.0.0.0/8

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

两条判据，脚本都以非零码退出表示失败：

1. **序列号**：会话上记下的最大 `client_seq` 必须等于库里落库的最大 `client_seq`；
   会话说收到了、库里没有，就是丢了一批答案。
2. **答题覆盖率**：每个已交卷会话答过的题数必须等于卷面题数。序列号照样前进、
   但题被服务端拒了（题型对不上的载荷），序列号对账查不出来，只有覆盖率能查出来。

压测只答卷面的一部分时，用 `SKIP_COVERAGE=1` 跳过第二条。

> 载荷按题型生成：简答题用 `text`、综合题用 `steps`、客观题用 `selectedOptionKeys`
> （选项键取卷面给的原始键）。题型对不上时服务端会拒掉那道题——接口照样返回 200，
> 题却没存上，只看 HTTP 成功率是发现不了的。

同一套判据在生产里由 `Exam.Worker` 的 **答卷对账作业**（`AnswerReconciliationJob`）定时执行：
考试期间每 10 分钟一轮，发现差异就写审计流水并报警。
