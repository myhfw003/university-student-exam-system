// 场景一：认证链路。1000 VU，30 秒。
//
// 目标：登录接口在开考前的高并发下不会成为瓶颈。
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, options, usernameOf } from './common.js';

export { options };

export const setup = () => ({
  baseUrl: BASE_URL,
});

export default function (data) {
  const response = http.post(
    `${data.baseUrl}/api/v1/auth/login`,
    JSON.stringify({
      username: usernameOf(__VU),
      password: __ENV.STUDENT_PASSWORD || 'Passw0rd!',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, {
    '登录返回 200': (r) => r.status === 200,
    '返回了访问令牌': (r) => r.status !== 200 || r.body('accessToken') !== undefined,
  });

  sleep(0.03);
}
