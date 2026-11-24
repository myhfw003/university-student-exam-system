// 场景三：持续作答。1000 VU，每 8 秒保存一批答案，持续 10 分钟。
//
// 目标：保存答案这条最高频的链路在持续压力下的 p95 与丢答率。
// 每个虚拟用户维护自己的 clientSeq 序列（递增），服务端据此判断有没有丢批。
//
// 负载模型：常量虚拟用户持续跑，迭代间隔 8 秒
// ——对应设计文档 §2.1 的「1000 人 ÷ 8 秒/题 = 125 QPS」。
import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  authHeaders,
  steadyModel,
  thresholdsFor,
  login,
  jsonField,
  buildAnswerItems,
  rejectedCount,
  EXAM_SESSION_ID,
  QUESTION_IDS,
  VUS,
} from './common.js';

/** 每个虚拟用户各自的会话、令牌、卷面与序列号（k6 里每个 VU 一份）。 */
const state = { attemptId: 0, token: null, clientSeq: 0, questions: [] };

export const options = {
  ...steadyModel('10m'),
  thresholds: thresholdsFor(VUS * 10),
};

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
      // 开考失败就不再重试登录，留给下一次迭代重试。
      state.token = null;
      return;
    }

    state.attemptId = jsonField(start, 'attemptId');
    // 序列号从服务端记的进度续接：已经保存过的批次不重复提交。
    state.clientSeq = Math.max(state.clientSeq, jsonField(start, 'lastClientSeq') ?? 0);
    // 卷面随开考响应一起返回：载荷按题型生成，选项键取卷面给的原始键。
    state.questions = jsonField(start, 'questions') || [];
  }

  state.clientSeq += 1;

  const items = buildAnswerItems(state.questions, QUESTION_IDS);

  const response = http.post(
    `${BASE_URL}/api/v1/attempts/${state.attemptId}/answers`,
    JSON.stringify({ clientSeq: state.clientSeq, items }),
    authHeaders(state.token, __VU),
  );

  check(response, {
    '保存答案成功': (r) => r.status === 200,
    // 接口 200 不等于题存上了：被拒的题要单独查，
    // 否则「简答题没存上」这类缺陷在压测里看不出来。
    '答案全部被接受': (r) => r.status === 200 && rejectedCount(r) === 0,
  });

  sleep(8);
}
