/* ==========================================================================
   能力画像的端到端夹具
   --------------------------------------------------------------------------
   能力画像是**定分驱动**的：交卷 → 成绩定分 → 领域事件 → Outbox →
   Worker 派发 → 更新画像。所以造出画像要走完整的一条链：

     建能力标签 → 建挂了这个标签的题 → 组卷 → 发布 → 建场次 → 学生作答交卷

   中间那一段（Worker 派发）**没有 HTTP 入口**——派发只在 Worker 进程里做。
   因此这条夹具在「只起了 API、没起 Worker」的环境里造不出画像，
   画像永远是空的；用例里要用轮询等 Worker 把事件派发出去。

   **为什么夹具放在 setup/ 下**：api 组（只打接口）与 ui-http 组（真浏览器）
   都要用它——两边验的是同一条链路，只是断言落在接口上还是页面上。
   ========================================================================== */

import { expect } from "@playwright/test";
import { apiRoot, adminPassword, adminUsername, login, type Session } from "./api";

/** 一次请求：带上令牌，返回状态与解析后的 JSON（失败时把原文带出来）。 */
export async function api(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; raw: string }> {
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }

  return { status: response.status, json, raw };
}

/** 断言成功，并把响应体带进失败信息。 */
export function expectOk(result: { status: number; raw: string }, what: string) {
  expect(result.status, `${what} → HTTP ${result.status}: ${result.raw}`).toBeLessThan(300);
}

/** 服务端给的能力画像（字段与 OpenAPI 契约一致）。 */
export interface AbilityProfileItem {
  abilityTagId: number;
  tagName: string;
  masteryRate: number;
  sampleSize: number;
  correctCount: number;
  sampleSufficient: boolean;
  masteryLabel: string;
}

export interface AbilityProfileResponse {
  items: AbilityProfileItem[];
  total: number;
  insufficientCount: number;
}

/** 一条「能力 → 题 → 卷 → 场次」的链路。 */
export interface AbilityTrack {
  /** 能力标签名（服务端给的标签名，页面上应当看得到这个名字）。 */
  tagName: string;
  /** 能力标签 ID。 */
  abilityTagId: number;
  /** 题目 ID。 */
  questionId: number;
  /** 场次 ID。 */
  sessionId: number;
}

/** 造出来的夹具。 */
export interface AbilityFixture {
  /** 管理员会话。 */
  admin: Session;
  /** 答题的学生（浏览器登录也用这个账号）。 */
  student: Session;
  /** 学生的登录账号与口令（浏览器里登录要用）。 */
  studentCredentials: { username: string; password: string };
  /** 另一个学生（用来验「别人的画像看不到」）。 */
  otherStudent: Session;
  /**
   * 本次运行的唯一标记。
   *
   * 标签编码、题号、账号名都要全局唯一，而端到端用例**要能反复跑**：
   * 库里留着上一次跑的数据，编码撞了服务端会判「已存在」（422）。
   * 所以编码里带上这个标记，每次跑都不一样。
   */
  runId: string;
}

/** 端到端用的口令。 */
export const ABILITY_PASSWORD = "Passw0rd!";

/** 本次运行的唯一标记：时间戳 + 进程内自增，避免同一毫秒内两次调用撞上。 */
let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `${Date.now().toString(36)}${runCounter.toString(36)}`;
}

/** 造一个学生账号并登录。 */
export async function createStudent(
  admin: Session,
  username: string,
  password: string,
): Promise<Session> {
  const roles = await api(admin, "GET", "/api/v1/roles");
  expectOk(roles, "读取角色目录");

  const studentRole = (roles.json ?? []).find((role: any) => role.code === "student");
  expect(studentRole, "角色目录里应当有「学生」角色").toBeTruthy();

  const created = await api(admin, "POST", "/api/v1/users", {
    username,
    displayName: "能力画像端到端学生",
    password,
    roleIds: [studentRole.id],
  });
  expectOk(created, `建学生账号 ${username}`);

  return login(apiRoot, username, password);
}

/**
 * 造一份完整夹具：一个管理员、一个答题的学生、一个对照的学生。
 *
 * 学生账号每次跑都用新的（带运行标记）：画像是**按人**存的，共用账号会互相污染。
 */
export async function prepareAbilityFixture(): Promise<AbilityFixture> {
  const runId = nextRunId();
  const admin = await login(apiRoot, adminUsername, adminPassword);

  const studentUsername = `e2eability${runId}a`;
  const student = await createStudent(admin, studentUsername, ABILITY_PASSWORD);
  const otherStudent = await createStudent(admin, `e2eability${runId}b`, ABILITY_PASSWORD);

  return {
    admin,
    student,
    studentCredentials: { username: studentUsername, password: ABILITY_PASSWORD },
    otherStudent,
    runId,
  };
}

/**
 * 造一条完整的能力画像链路：能力标签 + 挂了这个标签的题 + 卷 + 场次。
 *
 * 标签名带运行标记，避免与既有数据重名。
 */
export async function createAbilityTrack(
  fixture: AbilityFixture,
  index: number,
): Promise<AbilityTrack> {
  const { admin, student, runId } = fixture;

  // 1. 难度标签：建题必须挂一个（种子里预置了三档）。
  const tags = await api(admin, "GET", "/api/v1/tags");
  expectOk(tags, "读取标签");
  const difficulty = (tags.json?.groups ?? [])
    .flatMap((group: any) => group.tags ?? [])
    .find((tag: any) => tag.code === "difficulty.basic");
  expect(difficulty, "种子里的「基础」难度标签不见了").toBeTruthy();

  // 2. 能力标签：**能力维度**的标签才进画像（知识点标签不进）。
  const tagName = `画像验证能力${index}-${runId}`;
  const tag = await api(admin, "POST", "/api/v1/tags", {
    code: `e2e.ability.tag.${index}.${runId}`,
    name: tagName,
    group: "ability",
    sortOrder: 0,
  });
  expectOk(tag, "建能力标签");
  const abilityTagId = Number(tag.json?.id);
  expect(abilityTagId, "能力标签要有 ID").toBeGreaterThan(0);

  // 3. 建挂了这个能力标签的题并发布。
  const question = await api(admin, "POST", "/api/v1/questions", {
    code: `E2E-ABILITY-${index}-${runId}`,
    type: "single",
    stem: `端到端题目：能力画像验证 ${index} ${runId}，1 + 1 = ?`,
    defaultScore: 10,
    tagIds: [abilityTagId],
    difficultyTagId: Number(difficulty.id),
    options: [
      { key: "A", text: "2", isCorrect: true },
      { key: "B", text: "3", isCorrect: false },
    ],
    analysis: "能力画像端到端用例的解析。",
  });
  expectOk(question, "建题");
  const questionId = Number(question.json?.question?.id);
  expect(questionId, "题目要有 ID").toBeGreaterThan(0);

  const publishQuestion = await api(admin, "POST", `/api/v1/questions/${questionId}/publish`, {});
  expectOk(publishQuestion, "发布题目");

  // 4. 组卷并发布。允许重考：样本量要攒到 5 才「参与排序」。
  const paper = await api(admin, "POST", "/api/v1/papers", {
    kind: "exam",
    name: `端到端画像试卷-${index}-${runId}`,
    targetTotalScore: 10,
    durationMinutes: 30,
    allowRetake: true,
    orderRule: "by_type",
    variantRule: "standard",
    answerPolicy: "immediately",
  });
  expectOk(paper, "建卷");
  const paperId = Number(paper.json?.paper?.id);

  const addItem = await api(admin, "POST", `/api/v1/papers/${paperId}/items`, {
    questionId,
    score: 10,
    sortOrder: 1,
  });
  expectOk(addItem, "加题位");

  const publishPaper = await api(admin, "POST", `/api/v1/papers/${paperId}/publish`, {
    warningOverrideReason: "端到端用例：只放一道题用于验证能力画像。",
  });
  expectOk(publishPaper, "发布试卷");

  // 5. 建场次并把学生放进名单，发布。
  const now = new Date();
  const session = await api(admin, "POST", "/api/v1/exam-sessions", {
    paperId,
    name: `端到端画像场次-${index}-${runId}`,
    openAt: new Date(now.getTime() - 60_000).toISOString(),
    closeAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    durationMinutes: 30,
    participantMode: "direct",
    participantUserIds: [student.userId],
    variantRule: "standard",
  });
  expectOk(session, "建场次");
  const sessionId = Number(session.json?.session?.id);

  const publishSession = await api(admin, "POST", `/api/v1/exam-sessions/${sessionId}/publish`, {});
  expectOk(publishSession, "发布场次");

  return { tagName, abilityTagId, questionId, sessionId };
}

/** 考一次（客观题答对或答错）。 */
export async function takeAndSubmit(
  student: Session,
  sessionId: number,
  questionId: number,
  correct: boolean,
): Promise<number> {
  const start = await api(student, "POST", "/api/v1/attempts", { examSessionId: sessionId });
  expectOk(start, "学生进入考试");
  const attemptId = Number(start.json?.attemptId);
  expect(attemptId, "作答要有 ID").toBeGreaterThan(0);

  const save = await api(student, "POST", `/api/v1/attempts/${attemptId}/answers`, {
    clientSeq: 1,
    items: [
      {
        questionId,
        payload: { selectedOptionKeys: correct ? ["A"] : ["B"] },
      },
    ],
    clientSentAt: new Date().toISOString(),
  });
  expectOk(save, "保存答案");

  const submit = await api(student, "POST", `/api/v1/attempts/${attemptId}/submit`, {
    reason: "manual",
  });
  expectOk(submit, "交卷");

  return attemptId;
}

/** 读某人的能力画像。 */
export async function fetchAbilityProfile(
  session: Session,
): Promise<AbilityProfileResponse> {
  const result = await api(session, "GET", "/api/v1/abilities/profile");
  expectOk(result, "读取能力画像");
  return (result.json ?? { items: [], total: 0, insufficientCount: 0 }) as AbilityProfileResponse;
}

/**
 * 轮询能力画像，等某一项达到期望状态。
 *
 * **为什么要等**：画像是定分驱动的，交卷之后还要等 Worker 把领域事件
 * 派发出去（Worker 每 5 秒轮询一次 Outbox）——请求返回的那一瞬间，
 * 画像可能还没写上。
 *
 * `expect.poll` 会在超时前一直重试；超时信息里带上「Worker 可能没起」的提示，
 * 因为**只起 API 不起 Worker 的话，这里一定等不到**。
 */
export async function waitForAbilityProfile(
  session: Session,
  predicate: (profile: AbilityProfileResponse) => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<AbilityProfileResponse> {
  let last: AbilityProfileResponse = { items: [], total: 0, insufficientCount: 0 };

  await expect
    .poll(
      async () => {
        last = await fetchAbilityProfile(session);
        return predicate(last);
      },
      {
        timeout: timeoutMs,
        intervals: [1000],
        message:
          `${what}（等不到就是画像没更新：交卷后要等 Worker 派发领域事件，` +
          `只起 API 不起 Worker 的话这里永远等不到）`,
      },
    )
    .toBe(true);

  return last;
}
