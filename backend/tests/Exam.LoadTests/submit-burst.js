// 场景四：交卷突发。1000 VU 在最后 60 秒集中交卷。
//
// 目标：交卷链路里的判分与落库在集中爆发下不出现半截状态。
import http from 'k6/http';
import { check } from 'k6';
import { authHeaders, login, options, EXAM_SESSION_ID, QUESTION_IDS } from './common.js';

export { options };

const state = { attemptId: 0, clientSeq: 0 };

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
  const token = login(__VU);
  if (!token) {
    return;
  }

  if (state.attemptId === 0) {
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

  state.clientSeq += 1;

  const items = QUESTION_IDS.map((questionId) => ({
    questionId,
    payload: { selectedOptionKeys: ['A'] },
  }));

  http.post(
    `${baseUrl}/api/v1/attempts/${state.attemptId}/answers`,
    JSON.stringify({ clientSeq: state.clientSeq, items }),
    authHeaders(token),
  );

  const submit = http.post(
    `${baseUrl}/api/v1/attempts/${state.attemptId}/submit`,
    JSON.stringify({ reason: 'manual' }),
    authHeaders(token),
  );

  check(submit, { '交卷成功': (r) => r.status === 200 });
}
