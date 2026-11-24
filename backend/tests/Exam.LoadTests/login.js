// 场景一：认证链路。1000 VU，30 秒。
//
// 目标：登录接口在开考前的高并发下不会成为瓶颈。
//
// 负载模型：每个虚拟用户登录一次，全部同时起跑（突发）——
// 对应「开考前 1000 人同时登录」的形态，不是持续轮询。
import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL,
  burstModel,
  thresholdsFor,
  usernameOf,
  jsonField,
  ipHeaders,
  VUS,
} from './common.js';

export const options = {
  ...burstModel('30s'),
  thresholds: thresholdsFor(VUS),
};

export default function () {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      username: usernameOf(__VU),
      password: __ENV.STUDENT_PASSWORD || 'Passw0rd!',
    }),
    { headers: ipHeaders(__VU) },
  );

  check(response, {
    '登录返回 200': (r) => r.status === 200,
    // response.json('accessToken') 是 k6 v2 的写法；旧写法 body('accessToken') 会抛异常。
    '返回了访问令牌': (r) => r.status !== 200 || jsonField(r, 'accessToken') !== undefined,
  });
}
