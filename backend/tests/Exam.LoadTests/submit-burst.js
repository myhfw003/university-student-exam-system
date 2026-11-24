// 场景四：交卷突发。1000 VU 在最后 60 秒集中交卷。
//
// 目标：交卷链路里的判分与落库在集中爆发下不出现半截状态。
//
// 交卷必须发生在考试窗口的最后 60 秒，所以这里用 startTime 把场景挂在
// 整轮压测的末尾：SUBMIT_START_TIME=9m 时，交卷正好落在第 10 分钟。
// 默认 0s，方便单独跑这个场景。
import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL,
  authHeaders,
  thresholdsFor,
  login,
  jsonField,
  buildAnswerItems,
  rejectedCount,
  EXAM_SESSION_ID,
  QUESTION_IDS,
  VUS,
} from './common.js';

export const options = {
  discardResponseBodies: false,
  thresholds: thresholdsFor(VUS),
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: __ENV.DURATION || '60s',
      startTime: __ENV.SUBMIT_START_TIME || '0s',
    },
  },
};

const state = { attemptId: 0, token: null, clientSeq: 0, questions: [] };

export default function () {
  if (!state.token) {
    const token = login(__VU);
    if (!token) {
      return;
    }
    state.token = token;
  }

  if (state.attemptId === 0) {
    const start = http.post(
      `${BASE_URL}/api/v1/attempts`,
      JSON.stringify({ examSessionId: EXAM_SESSION_ID }),
      authHeaders(state.token, __VU),
    );

    if (start.status !== 200) {
      state.token = null;
      return;
    }

    state.attemptId = jsonField(start, 'attemptId');
    state.clientSeq = Math.max(state.clientSeq, jsonField(start, 'lastClientSeq') ?? 0);
    state.questions = jsonField(start, 'questions') || [];
  }

  state.clientSeq += 1;

  const items = buildAnswerItems(state.questions, QUESTION_IDS);

  const answers = http.post(
    `${BASE_URL}/api/v1/attempts/${state.attemptId}/answers`,
    JSON.stringify({ clientSeq: state.clientSeq, items }),
    authHeaders(state.token, __VU),
  );

  check(answers, {
    '保存答案成功': (r) => r.status === 200,
    '答案全部被接受': (r) => r.status === 200 && rejectedCount(r) === 0,
  });

  const submit = http.post(
    `${BASE_URL}/api/v1/attempts/${state.attemptId}/submit`,
    JSON.stringify({ reason: 'manual' }),
    authHeaders(state.token, __VU),
  );

  check(submit, { '交卷成功': (r) => r.status === 200 });
}
