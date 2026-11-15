// 场景三：持续作答。1000 VU，每 8 秒保存一批答案，持续 10 分钟。
//
// 目标：保存答案这条最高频的链路在持续压力下的 p95 与丢答率。
// 每个虚拟用户维护自己的 clientSeq 序列（递增），服务端据此判断有没有丢批。
import http from 'k6/http';
import { check, sleep } from 'k6';
import { authHeaders, login, options, EXAM_SESSION_ID, QUESTION_IDS } from './common.js';

export { options };

/** 每个虚拟用户的会话与序列号。 */
const state = { attemptId: 0, clientSeq: 0 };

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';

  if (state.attemptId === 0) {
    const token = login(__VU);
    if (!token) {
      return;
    }

    const start = http.post(
      `${baseUrl}/api/v1/attempts`,
      JSON.stringify({ examSessionId: EXAM_SESSION_ID }),
      authHeaders(token),
    );

    if (start.status !== 200) {
      return;
    }

    state.attemptId = start.json('attemptId');
  }

  const token = login(__VU);
  if (!token) {
    return;
  }

  state.clientSeq += 1;

  const items = QUESTION_IDS.map((questionId) => ({
    questionId,
    payload: { selectedOptionKeys: ['A'] },
  }));

  const response = http.post(
    `${baseUrl}/api/v1/attempts/${state.attemptId}/answers`,
    JSON.stringify({ clientSeq: state.clientSeq, items }),
    authHeaders(token),
  );

  check(response, { '保存答案成功': (r) => r.status === 200 });

  sleep(8);
}
