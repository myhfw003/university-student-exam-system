// 压测公共配置：阈值、环境变量与登录助手。
//
// 阈值来自设计文档《08-deployment-operations.md》§6.2，CI 强制：
//   答卷丢失率必须为 0；HTTP 错误率 < 0.1%；p95 < 500ms；p99 < 1500ms。

import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

/** 考生账号前缀与数量：压测前用种子数据铺好。 */
export const STUDENT_PREFIX = __ENV.STUDENT_PREFIX || 'load';
export const STUDENT_COUNT = Number(__ENV.STUDENT_COUNT || 1000);

/** 考试场次 ID（压测前建好并发布）。 */
export const EXAM_SESSION_ID = Number(__ENV.EXAM_SESSION_ID || 0);

/** 题目 ID 列表：逗号分隔。 */
export const QUESTION_IDS = (__ENV.QUESTION_IDS || '')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => v > 0);

export const thresholds = {
  http_req_failed: ['rate<0.001'],
  http_req_duration: ['p(95)<500', 'p(99)<1500'],
  http_reqs: ['count>=30000'],
  checks: ['rate>0.999'],
};

export const options = {
  thresholds,
  discardResponseBodies: false,
};

/** 取第 i 个虚拟用户的账号。 */
export function usernameOf(vu) {
  return `${STUDENT_PREFIX}${String(vu).padStart(5, '0')}`;
}

/** 登录并返回访问令牌。 */
export function login(vu) {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username: usernameOf(vu), password: __ENV.STUDENT_PASSWORD || 'Passw0rd!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const ok = check(response, { '登录成功': (r) => r.status === 200 });
  if (!ok) {
    return null;
  }

  return response.json('accessToken');
}

/** 带令牌的请求头。 */
export function authHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}
