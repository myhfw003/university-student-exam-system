// 场景二：开考突发。1000 VU 同时 POST /attempts，30 秒窗口。
//
// 目标：开考瞬间的会话创建洪峰不压垮数据库。
import http from 'k6/http';
import { check, sleep } from 'k6';
import { authHeaders, login, options, EXAM_SESSION_ID } from './common.js';

export { options };

export default function () {
  const token = login(__VU);
  if (!token) {
    return;
  }

  const response = http.post(
    `${__ENV.BASE_URL || 'http://localhost:8080'}/api/v1/attempts`,
    JSON.stringify({ examSessionId: EXAM_SESSION_ID }),
    authHeaders(token),
  );

  check(response, {
    '开考成功': (r) => r.status === 200,
    '拿到了会话 ID': (r) => r.status !== 200 || r.body('attemptId') > 0,
  });

  sleep(0.03);
}
