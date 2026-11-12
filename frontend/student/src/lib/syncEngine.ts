/* ==========================================================================
   知行测评 · 上行同步引擎（L3 上行队列 → L4 服务端持久化）
   --------------------------------------------------------------------------
   对应 docs/design/06-frontend.md §4.2–4.6。

   核心不变量：
   1. clientSeq 在批次创建时分配并落盘，重放时不变 —— 服务端按 clientSeq 幂等。
   2. 服务端返回 acceptedClientSeq 后，删除 clientSeq ≤ accepted 的批次。
   3. 重放严格按 clientSeq 升序，保证服务端看到的顺序与创建顺序一致。
   4. 网络失败按 1s/2s/4s/8s 指数退避，最多 5 次；耗尽后留在队列，下次触发继续。

   传输层通过 AnswerTransport 注入：当前接本地 mock，后端就绪后换 HTTP 实现，
   引擎逻辑不变。
   ========================================================================== */

import type { AnswerBatch, AnswerPayload } from "@exam/shared/domain/attempt";
import {
  countPending,
  deleteBatchesUpTo,
  enqueueBatch,
  listBatches,
  loadDraft,
  saveDraft,
  updateBatch,
} from "../stores/draftQueue";

/** 上行传输接口。 */
export interface AnswerTransport {
  /**
   * 上行一批答案。
   * @returns 服务端已接受的 clientSeq。
   */
  send(batch: AnswerBatch): Promise<number>;
  /**
   * 拉取服务端当前状态，用于断点恢复时对账。
   */
  fetchRemote(attemptId: string): Promise<RemoteAttemptState>;
}

/** 服务端会话状态（对账用）。 */
export interface RemoteAttemptState {
  /** 服务端已接收的最大 clientSeq。 */
  lastClientSeq: number;
  /** 服务端已有的答案（权威值）。 */
  answers: Record<string, AnswerPayload>;
  /** 是否已提交。 */
  submitted: boolean;
}

/** 网络不可达时抛出，由引擎识别为「需要重试」。 */
export class NetworkUnavailableError extends Error {
  constructor(message = "网络不可用") {
    super(message);
    this.name = "NetworkUnavailableError";
  }
}

/** 退避序列（毫秒）。 */
const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

/** 最大重试次数。 */
const MAX_RETRIES = 5;

/** L2 写 IndexedDB 的防抖时长。 */
const DRAFT_DEBOUNCE_MS = 300;

/** L2 防抖上限：持续作答时最多 1s 落一次盘。 */
const DRAFT_MAX_WAIT_MS = 1000;

/** L3/L4 上行防抖时长。 */
const UPLOAD_DEBOUNCE_MS = 3000;

/** 同步引擎状态。 */
export interface SyncStatus {
  /** 待同步批次数。 */
  pending: number;
  /** 是否离线。 */
  offline: boolean;
  /** 是否正在上行。 */
  syncing: boolean;
  /** 最近一次错误文案。 */
  lastError: string | null;
}

/** 同步引擎配置。 */
export interface SyncEngineOptions {
  attemptId: string;
  transport: AnswerTransport;
  /** 状态变化回调。 */
  onStatusChange?: (status: SyncStatus) => void;
  /** 批次上行成功回调（用于清理内存态）。 */
  onBatchAccepted?: (acceptedClientSeq: number) => void;
}

/**
 * 同步引擎。
 *
 * 典型用法：
 * ```ts
 * const engine = new SyncEngine({ attemptId, transport });
 * engine.recordAnswer(questionId, payload);   // L1 已更新，这里负责 L2/L3/L4
 * engine.flush();                              // 立即上行（离开题目 / 页面隐藏时）
 * ```
 */
export class SyncEngine {
  private readonly attemptId: string;
  private readonly transport: AnswerTransport;
  private readonly onStatusChange: ((status: SyncStatus) => void) | undefined;
  private readonly onBatchAccepted: ((acceptedClientSeq: number) => void) | undefined;

  /** 已写入但尚未形成批次的答案（等待防抖成批）。 */
  private pendingItems = new Map<string, AnswerPayload>();

  /** 下一个待分配的 clientSeq。 */
  private nextSeq = 1;

  /** L2 落盘定时器。 */
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  /** L2 防抖起点（用于实现 1s 上限）。 */
  private draftStartedAt = 0;

  /** L3/L4 上行定时器。 */
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;

  /** 上行进行中的标志，避免并发上行。 */
  private syncing = false;

  /** 离线标志。 */
  private offline = false;

  /** 重放中的定时器。 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SyncEngineOptions) {
    this.attemptId = options.attemptId;
    this.transport = options.transport;
    this.onStatusChange = options.onStatusChange;
    this.onBatchAccepted = options.onBatchAccepted;
  }

  /* ---------------------------------------------------------------- 状态 */

  /** 当前状态快照。 */
  async status(): Promise<SyncStatus> {
    return {
      pending: await countPending(this.attemptId),
      offline: this.offline,
      syncing: this.syncing,
      lastError: null,
    };
  }

  /** 通知外部状态变化。 */
  private async emitStatus(extra?: Partial<SyncStatus>): Promise<void> {
    if (!this.onStatusChange) return;
    const pending = await countPending(this.attemptId);
    this.onStatusChange({
      pending,
      offline: this.offline,
      syncing: this.syncing,
      lastError: null,
      ...extra,
    });
  }

  /* ------------------------------------------------------------ L2 落盘 */

  /**
   * 记录一次作答：立即进入待成批集合，300ms 后落 IndexedDB。
   *
   * 上行另行按 3s 防抖触发；题目切换时调用 flush 立即上行。
   */
  recordAnswer(questionId: string, payload: AnswerPayload): void {
    this.pendingItems.set(questionId, payload);
    this.scheduleDraftWrite();
    this.scheduleUpload();
  }

  /** L2 防抖落盘（300ms，且最多等待 1s）。 */
  private scheduleDraftWrite(): void {
    const now = Date.now();
    if (this.draftTimer === null) {
      this.draftStartedAt = now;
    }
    const elapsed = now - this.draftStartedAt;
    const wait = Math.max(0, Math.min(DRAFT_DEBOUNCE_MS, DRAFT_MAX_WAIT_MS - elapsed));

    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      const items = new Map(this.pendingItems);
      this.pendingItems.clear();
      void this.writeDraft(items);
    }, wait);
  }

  /**
   * 把待落盘条目写入 IndexedDB 草稿。
   *
   * 显式接收条目而非读取 pendingItems：调用方可能已经取走过这些条目
   * （flush 会先取题再落盘），再从 pendingItems 读会拿到空集。
   */
  private async writeDraft(items: ReadonlyMap<string, AnswerPayload>): Promise<void> {
    const draft = await loadDraft(this.attemptId);
    const answers = { ...(draft?.answers ?? {}) };
    for (const [questionId, payload] of items) {
      answers[questionId] = payload;
    }

    await saveDraft({
      attemptId: this.attemptId,
      answers,
      marked: draft?.marked ?? [],
      currentQuestionId: draft?.currentQuestionId ?? null,
      clientSeq: Math.max(draft?.clientSeq ?? 1, this.nextSeq),
      updatedAt: new Date().toISOString(),
    });
  }

  /* ------------------------------------------------------------ L3 队列 */

  /** L3/L4 上行防抖（3s）。 */
  private scheduleUpload(): void {
    if (this.uploadTimer !== null) clearTimeout(this.uploadTimer);
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      void this.flush();
    }, UPLOAD_DEBOUNCE_MS);
  }

  /**
   * 立即上行：把待成批答案固化为批次并发送。
   *
   * 在「切换题目」「页面隐藏」「心跳」「交卷前」调用。
   */
  async flush(): Promise<void> {
    if (this.uploadTimer !== null) {
      clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
    }
    if (this.draftTimer !== null) {
      // flush 内部会直接落盘，取消待执行的防抖落盘，避免重复写。
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }

    if (this.pendingItems.size > 0) {
      // 先取走条目（避免落盘时清空 pendingItems 把题目也带走），再落盘。
      const pending = new Map(this.pendingItems);
      this.pendingItems.clear();

      // 先落盘，保证即使上行失败，本地也不丢。
      await this.writeDraft(pending);

      const items = [...pending.entries()].map(([questionId, payload]) => ({
        questionId,
        payload,
      }));

      const clientSeq = this.nextSeq;
      this.nextSeq += 1;
      await enqueueBatch(this.attemptId, clientSeq, items);
      await this.emitStatus();
    }

    await this.replay();
  }

  /**
   * 按 clientSeq 升序重放待上行批次。
   *
   * 失败按指数退避重试（1s/2s/4s/8s），最多 5 次；耗尽后批次留在队列，
   * 下次触发时继续。离线时直接标记为离线，等待恢复事件。
   */
  async replay(): Promise<void> {
    if (this.syncing) return;
    const batches = await listBatches(this.attemptId);
    if (batches.length === 0) {
      await this.emitStatus();
      return;
    }

    this.syncing = true;
    await this.emitStatus();

    try {
      for (const batch of batches) {
        if (batch.nextRetryAt && Date.parse(batch.nextRetryAt) > Date.now()) {
          // 未到重试时间，安排一次延迟重放后停止本轮。
          this.scheduleRetry(batch.nextRetryAt);
          break;
        }

        try {
          const accepted = await this.transport.send({
            attemptId: this.attemptId,
            clientSeq: batch.clientSeq,
            items: batch.items,
            createdAt: batch.createdAt,
          });
          await deleteBatchesUpTo(this.attemptId, accepted);
          this.nextSeq = Math.max(this.nextSeq, accepted + 1);
          this.onBatchAccepted?.(accepted);
          this.offline = false;
        } catch (error) {
          if (error instanceof NetworkUnavailableError) {
            this.offline = true;
            await this.emitStatus({ lastError: "网络不可用，答案已排队待同步。" });
            break;
          }

          const retries = batch.retries + 1;
          if (retries > MAX_RETRIES) {
            // 重试耗尽：留在队列，下次触发时继续。
            await this.emitStatus({ lastError: "答案同步失败，已保留在本地队列中。" });
            break;
          }
          const delay = BACKOFF_MS[Math.min(retries - 1, BACKOFF_MS.length - 1)] ?? 8000;
          const nextRetryAt = new Date(Date.now() + delay).toISOString();
          await updateBatch({ ...batch, retries, nextRetryAt });
          this.scheduleRetry(nextRetryAt);
          await this.emitStatus({ lastError: `答案同步失败，${Math.round(delay / 1000)} 秒后重试。` });
          break;
        }
      }
    } finally {
      this.syncing = false;
      await this.emitStatus();
    }
  }

  /** 安排延迟重放。 */
  private scheduleRetry(at: string): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    const delay = Math.max(0, Date.parse(at) - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.replay();
    }, delay);
  }

  /** 标记离线状态。 */
  async setOffline(offline: boolean): Promise<void> {
    this.offline = offline;
    if (!offline) {
      // 恢复在线：立刻重放队列。
      await this.replay();
    } else {
      await this.emitStatus({ lastError: "网络不可用，答案已排队待同步。" });
    }
  }

  /* ---------------------------------------------------------- 断点恢复 */

  /**
   * 断点恢复与对账。
   *
   * 对账方向很重要：**服务端是权威**。
   * - 本地有、服务端没有 → 上次没传上去，必须重放；
   * - 服务端有、本地没有 → 本地被清掉了，以服务端为准并回填本地。
   */
  async reconcile(): Promise<{
    answers: Record<string, AnswerPayload>;
    submitted: boolean;
    pending: number;
  }> {
    const local = await loadDraft(this.attemptId);
    if (local) {
      this.nextSeq = Math.max(this.nextSeq, local.clientSeq);
    }

    const remote = await this.transport.fetchRemote(this.attemptId);
    this.nextSeq = Math.max(this.nextSeq, remote.lastClientSeq + 1);

    // 服务端有的答案以服务端为准，回填本地。
    const answers: Record<string, AnswerPayload> = { ...(local?.answers ?? {}) };
    for (const [questionId, payload] of Object.entries(remote.answers)) {
      answers[questionId] = payload;
    }

    await saveDraft({
      attemptId: this.attemptId,
      answers,
      marked: local?.marked ?? [],
      currentQuestionId: local?.currentQuestionId ?? null,
      clientSeq: this.nextSeq,
      updatedAt: new Date().toISOString(),
    });

    await this.emitStatus();
    return { answers, submitted: remote.submitted, pending: await countPending(this.attemptId) };
  }

  /* -------------------------------------------------------- 关闭页面 */

  /**
   * 页面关闭前的最后一搏：用 sendBeacon 上行最后一批。
   *
   * sendBeacon 不支持自定义 Authorization 头，因此该端点额外接受
   * `?access_token=` 查询参数（仅限此端点，且令牌有效期短）。
   * beacon 不可用时依赖 L2 的 IndexedDB —— 刷新后依然不丢。
   */
  async flushWithBeacon(accessToken: string | null, endpoint: string): Promise<boolean> {
    if (this.pendingItems.size === 0) return false;

    const pending = new Map(this.pendingItems);
    this.pendingItems.clear();

    await this.writeDraft(pending);
    const items = [...pending.entries()].map(([questionId, payload]) => ({
      questionId,
      payload,
    }));

    const clientSeq = this.nextSeq;
    this.nextSeq += 1;
    const batch: AnswerBatch = {
      attemptId: this.attemptId,
      clientSeq,
      items,
      createdAt: new Date().toISOString(),
    };

    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      // beacon 不可用：退回普通上行（失败也不丢，队列里还有）。
      await enqueueBatch(this.attemptId, clientSeq, items);
      void this.replay();
      return false;
    }

    const url = `${endpoint}?access_token=${encodeURIComponent(accessToken ?? "")}`;
    const blob = new Blob([JSON.stringify(batch)], { type: "application/json" });
    const sent = navigator.sendBeacon(url, blob);
    if (!sent) {
      await enqueueBatch(this.attemptId, clientSeq, items);
      void this.replay();
    }
    return sent;
  }

  /** 释放定时器。 */
  dispose(): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    if (this.uploadTimer !== null) clearTimeout(this.uploadTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.draftTimer = null;
    this.uploadTimer = null;
    this.retryTimer = null;
  }
}
