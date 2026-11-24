// 场景二：开考突发。1000 VU 同时 POST /attempts，30 秒窗口。
//
// 目标：开考瞬间的会话创建洪峰不压垮数据库。
//
// 负载模型：每个虚拟用户开考一次，全部同时起跑。
// 设计文档 §2.1 要求会话创建吞吐 ≥ 300 次/秒，这里 1000 VU 同时起跑，
// 瞬时并发就是 1000——比要求更狠。
import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL,
  authHeaders,
  burstModel,
  thresholdsFor,
  login,
  jsonField,
  EXAM_SESSION_ID,
  VUS,
} from './common.js';

export const options = {
  ...burstModel('30s'),
  thresholds: thresholdsFor(VUS),
};

export default function () {
  const token = login(__VU);
  if (!token) {
    return;
  }

  const response = http.post(
    `${BASE_URL}/api/v1/attempts`,
    JSON.stringify({ examSessionId: EXAM_SESSION_ID }),
    authHeaders(token, __VU),
  );

  check(response, {
    '开考成功': (r) => r.status === 200,
    '拿到了会话 ID': (r) => r.status !== 200 || jsonField(r, 'attemptId') > 0,
  });
}
