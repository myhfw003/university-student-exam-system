/* ==========================================================================
   知行测评 · 传输层实现
   --------------------------------------------------------------------------
   上行引擎（syncEngine）只依赖 AnswerTransport 接口，这里给出两种实现：

   1. HttpAnswerTransport —— 对接后端 /api/v1/attempts/{id}/answers。
      后端作答接口在 P4 阶段落地，届时把 createTransport() 切到它即可，
      引擎逻辑不动。

   2. MockAnswerTransport —— 本地模拟服务端语义（接收批次、维护 lastClientSeq、
      存储答案、模拟网络故障），让前端在无后端时也能完整跑通
      「作答 → 上行 → 断网排队 → 恢复重放 → 对账」全链路。
   ========================================================================== */

import type { AnswerBatch, AnswerPayload } from "@exam/shared/domain/attempt";
import {
  NetworkUnavailableError,
  type AnswerTransport,
  type RemoteAttemptState,
} from "./syncEngine";

/** HTTP 传输实现。 */
export class HttpAnswerTransport implements AnswerTransport {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly getAccessToken: () => string | null = () => null,
  ) {}

  /** 上行一批答案。 */
  async send(batch: AnswerBatch): Promise<number> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/attempts/${batch.attemptId}/answers`, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });
    } catch {
      throw new NetworkUnavailableError();
    }

    if (!response.ok) {
      // 5xx 视为可重试；4xx 视为不可恢复，交由引擎报错。
      if (response.status >= 500) throw new NetworkUnavailableError();
      throw new Error(`答案上行失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as { acceptedClientSeq?: number };
    return data.acceptedClientSeq ?? batch.clientSeq;
  }

  /** 拉取服务端会话状态，用于对账。 */
  async fetchRemote(attemptId: string): Promise<RemoteAttemptState> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/attempts/${attemptId}`, { headers });
    } catch {
      throw new NetworkUnavailableError();
    }

    if (!response.ok) throw new NetworkUnavailableError();

    const data = (await response.json()) as {
      lastClientSeq?: number;
      answers?: Record<string, AnswerPayload>;
      submitted?: boolean;
    };

    const answers: Record<string, AnswerPayload> = {};
    for (const [key, value] of Object.entries(data.answers ?? {})) {
      answers[key] = value;
    }

    return {
      lastClientSeq: data.lastClientSeq ?? 0,
      answers,
      submitted: data.submitted ?? false,
    };
  }
}

/** 模拟服务端状态。 */
interface MockServerState {
  lastClientSeq: number;
  answers: Record<string, AnswerPayload>;
  submitted: boolean;
}

/** 模拟传输实现：本地维护一份「服务端」状态。 */
export class MockAnswerTransport implements AnswerTransport {
  private readonly states = new Map<string, MockServerState>();

  constructor(private readonly options: { failureRate?: number } = {}) {}

  /** 上行一批答案。 */
  async send(batch: AnswerBatch): Promise<number> {
    // 模拟网络抖动：按概率抛出网络不可用。
    const failureRate = this.options.failureRate ?? 0;
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new NetworkUnavailableError();
    }

    const state = this.ensureState(batch.attemptId);
    // 幂等：重复投递同一 clientSeq 不改变结果。
    if (batch.clientSeq <= state.lastClientSeq) {
      return state.lastClientSeq;
    }

    for (const item of batch.items) {
      state.answers[item.questionId] = item.payload;
    }
    state.lastClientSeq = batch.clientSeq;
    return state.lastClientSeq;
  }

  /** 拉取服务端会话状态。 */
  async fetchRemote(attemptId: string): Promise<RemoteAttemptState> {
    const state = this.ensureState(attemptId);
    return {
      lastClientSeq: state.lastClientSeq,
      answers: { ...state.answers },
      submitted: state.submitted,
    };
  }

  /** 标记会话已提交（供交卷流程调用）。 */
  markSubmitted(attemptId: string): void {
    this.ensureState(attemptId).submitted = true;
  }

  /** 重置某会话的服务端状态。 */
  reset(attemptId: string): void {
    this.states.delete(attemptId);
  }

  private ensureState(attemptId: string): MockServerState {
    let state = this.states.get(attemptId);
    if (!state) {
      state = { lastClientSeq: 0, answers: {}, submitted: false };
      this.states.set(attemptId, state);
    }
    return state;
  }
}
