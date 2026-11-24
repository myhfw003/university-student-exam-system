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

/** 并发虚拟用户数：各场景默认 1000，本机缩小规模压测用 VUS 覆盖。 */
export const VUS = Number(__ENV.VUS || 1000);

/**
 * 阈值。请求数下限按场景给：突发场景只有 VUS 次请求，
 * 持续作答场景才有几万次。MIN_REQUESTS 可整体覆盖。
 */
export function thresholdsFor(defaultMinRequests) {
  const minRequests = Number(__ENV.MIN_REQUESTS || defaultMinRequests);
  return {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_reqs: [`count>=${minRequests}`],
    checks: ['rate>0.999'],
  };
}

/**
 * 突发场景的负载模型：每个虚拟用户只跑一次迭代，全部同时起跑。
 *
 * 对应设计文档 §2.1 的「开考瞬间 1000 人同时 POST /attempts，
 * 1000 请求 / 30 秒窗口」——是**一次**请求，不是连续循环。
 * 以前脚本用 sleep(0.03) 循环 30 秒，1000 VU 打出 13000 req/s，
 * 测的既不是文档里的负载模型，也不是系统真实能承受的形态。
 *
 * @param {string} defaultDuration 迭代必须在这段时间内跑完（超了算失败）。
 */
export function burstModel(defaultDuration) {
  return {
    discardResponseBodies: false,
    scenarios: {
      default: {
        executor: 'per-vu-iterations',
        vus: VUS,
        iterations: 1,
        maxDuration: __ENV.DURATION || defaultDuration,
      },
    },
  };
}

/**
 * 持续场景的负载模型：常量虚拟用户，固定时长。
 *
 * 对应设计文档 §2.1 的「1000 人 ÷ 8 秒/题 = 125 QPS」这类持续负载。
 */
export function steadyModel(defaultDuration) {
  return {
    discardResponseBodies: false,
    scenarios: {
      default: {
        executor: 'constant-vus',
        vus: VUS,
        duration: __ENV.DURATION || defaultDuration,
      },
    },
  };
}

/**
 * 从 JSON 响应里取字段，取不到返回 undefined。
 *
 * k6 v2 的 response.body('field') 这种「选择器」写法已经不能用了
 * （会抛 TypeError: Value is not an object），只有 response.json('field') 可用。
 * 响应体不是合法 JSON 时 json() 会抛异常，包一层好让检查判成「没拿到」，
 * 而不是把整条检查炸掉。
 */
export function jsonField(response, field) {
  try {
    return response.json(field);
  } catch (_) {
    return undefined;
  }
}

/**
 * 给第 i 个虚拟用户分配的「出口 IP」。
 *
 * 真实部署里考生各走各的出口：限流按来源 IP 分区（见 Program.cs 的
 * 分区键），所有人共用一个 IP 时限流桶是共用的——那正是机房 NAT 的形态，
 * 会把整场考试一起限掉。压测要按真实形态建模，所以每个虚拟用户一个不同 IP。
 *
 * 走 nginx 反代时这个 IP 由 nginx 通过 X-Forwarded-For 传给后端；
 * 直连后端时（压测常用）就自己带上这个头——前提是后端信任反代头，
 * 见 Program.cs 的 UseForwardedHeaders 配置。
 */
export function clientIpFor(vu) {
  return `10.${Math.floor(vu / 65536) % 256}.${Math.floor(vu / 256) % 256}.${vu % 256}`;
}

/** 带客户端 IP 的请求头（限流分区键靠它）。 */
export function ipHeaders(vu) {
  return {
    'Content-Type': 'application/json',
    'X-Forwarded-For': clientIpFor(vu),
  };
}

/** 取第 i 个虚拟用户的账号。 */
export function usernameOf(vu) {
  return `${STUDENT_PREFIX}${String(vu).padStart(5, '0')}`;
}

/** 登录并返回访问令牌。 */
export function login(vu) {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username: usernameOf(vu), password: __ENV.STUDENT_PASSWORD || 'Passw0rd!' }),
    { headers: ipHeaders(vu) },
  );

  const ok = check(response, { '登录成功': (r) => r.status === 200 });
  if (!ok) {
    return null;
  }

  return jsonField(response, 'accessToken');
}

/** 带令牌的请求头。 */
export function authHeaders(token, vu) {
  return {
    headers: {
      ...ipHeaders(vu),
      Authorization: `Bearer ${token}`,
    },
  };
}
