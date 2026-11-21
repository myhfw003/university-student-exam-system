/* ==========================================================================
   能力画像（真实后端）
   --------------------------------------------------------------------------
   对应 FR-LRN-02：按「能力」维度的标签聚合学生表现，给出掌握度与样本量；
   样本量不足时明确标注「样本不足」。

   **画像是定分驱动的**：交卷 → 成绩定分 → 领域事件 → Outbox → Worker 派发
   → 更新画像。派发这一步**只在 Worker 进程里做**（API 不派发），
   所以这条用例要求环境里**同时起了 Worker**；没起的话画像永远空着，
   轮询会超时并把原因写在失败信息里。

   这一组守住三件事：

   1. 交卷之后画像里有这一项能力，掌握度、样本量、全对数与分档都对；
   2. 样本量够（≥5）才参与排序，不够的标「样本不足」并单独计数；
   3. **按答题者隔离**——别人的画像看不到。
   ========================================================================== */

import { expect, test } from "@playwright/test";
import { MASTERY_LABEL } from "../shared/src/domain/ability";
import {
  api,
  createAbilityTrack,
  expectOk,
  fetchAbilityProfile,
  prepareAbilityFixture,
  takeAndSubmit,
  waitForAbilityProfile,
} from "./setup/ability";

test.describe("能力画像（真实后端）", () => {
  // 交卷之后要等 Worker 把领域事件派发出去（它每 5 秒轮询一次 Outbox），
  // 攒够 5 个样本要等好几轮——默认的 60 秒用例超时留得不够宽。
  test.setTimeout(180_000);

  test("交卷之后画像里有这一项能力，掌握度与样本量都对", async () => {
    const fixture = await prepareAbilityFixture();
    const track = await createAbilityTrack(fixture, 0);

    await takeAndSubmit(fixture.student, track.sessionId, track.questionId, true);

    const profile = await waitForAbilityProfile(
      fixture.student,
      (p) => p.total >= 1,
      "交卷之后画像里应当出现这一项能力",
    );

    expect(profile.total, "画像里应当只有这一项能力").toBe(1);
    expect(profile.insufficientCount, "样本不够的应当单独计数").toBe(1);

    const item = profile.items[0]!;
    expect(Number(item.abilityTagId), "画像项要指向我们建的那个能力标签").toBe(
      track.abilityTagId,
    );
    expect(item.tagName, "标签名由服务端给").toBe(track.tagName);
    expect(item.sampleSize, "一次作答就是一个样本").toBe(1);
    expect(item.correctCount, "答对了一个").toBe(1);
    expect(item.masteryRate, "掌握度是 0..1 的小数").toBeGreaterThan(0);
    expect(item.masteryRate, "掌握度不超过 1").toBeLessThanOrEqual(1);
    expect(item.sampleSufficient, "样本只有 1 个，不够").toBe(false);
    expect(item.masteryLabel, "样本不足要明确标出来").toBe(MASTERY_LABEL.insufficient);

    // 服务端给的分档必须是前端登记过的那些词：认不出来的话，
    // 徽标会静默退回中性色（「薄弱」和「掌握」看起来一样）。
    const known = Object.values(MASTERY_LABEL) as string[];
    expect(known, "服务端给的分档应当在前端登记的词表里").toContain(item.masteryLabel);
  });

  test("样本够了就参与排序：样本量 ≥5 标「掌握」，不再计入样本不足", async () => {
    const fixture = await prepareAbilityFixture();
    const track = await createAbilityTrack(fixture, 0);

    // 做满 5 次，样本量才够（服务端门槛是 5）。
    for (let i = 0; i < 5; i += 1) {
      await takeAndSubmit(fixture.student, track.sessionId, track.questionId, true);
    }

    const profile = await waitForAbilityProfile(
      fixture.student,
      (p) => p.items.some((item) => item.sampleSize >= 5),
      "做满 5 次之后样本量应当够",
    );

    const item = profile.items[0]!;
    expect(item.sampleSize, "样本量攒到 5").toBe(5);
    expect(item.correctCount, "五次全对").toBe(5);
    expect(item.sampleSufficient, "样本够了就参与排序").toBe(true);
    expect(item.masteryLabel, "全对五次评「掌握」").toBe(MASTERY_LABEL.mastered);
    expect(profile.insufficientCount, "样本够了就不再计入样本不足").toBe(0);
    expect(profile.total, "还是这一项能力").toBe(1);
  });

  test("排序：样本足够的在前，样本不足的排在后面", async () => {
    const fixture = await prepareAbilityFixture();

    // 两条能力：一条攒够样本，一条只有一次作答。
    const enough = await createAbilityTrack(fixture, 0);
    const lacking = await createAbilityTrack(fixture, 1);

    for (let i = 0; i < 5; i += 1) {
      await takeAndSubmit(fixture.student, enough.sessionId, enough.questionId, true);
    }
    await takeAndSubmit(fixture.student, lacking.sessionId, lacking.questionId, true);

    const profile = await waitForAbilityProfile(
      fixture.student,
      (p) => p.total >= 2 && p.insufficientCount >= 1,
      "两项能力都应当出现在画像里",
    );

    expect(profile.total, "画像里两项能力").toBe(2);
    expect(profile.insufficientCount, "其中一项样本不足").toBe(1);

    // 排序口径在服务端：样本足够的在前，样本不足的排在后面。
    // 前端照服务端给的顺序显示，不自己重排。
    expect(profile.items[0]?.tagName, "样本足够的应当排在前面").toBe(enough.tagName);
    expect(profile.items[0]?.sampleSufficient, "排在前面的样本是够的").toBe(true);
    expect(profile.items[1]?.tagName, "样本不足的排在后面").toBe(lacking.tagName);
    expect(profile.items[1]?.sampleSufficient, "排在后面的样本是不够的").toBe(false);
    expect(profile.items[1]?.masteryLabel).toBe(MASTERY_LABEL.insufficient);
  });

  test("别人的画像看不到（按答题者隔离）", async () => {
    const fixture = await prepareAbilityFixture();
    const track = await createAbilityTrack(fixture, 0);

    await takeAndSubmit(fixture.student, track.sessionId, track.questionId, true);

    await waitForAbilityProfile(
      fixture.student,
      (p) => p.total >= 1,
      "本人应当看得到自己的画像",
    );

    // 另一个学生登录：自己的画像是空的。
    const other = await fetchAbilityProfile(fixture.otherStudent);
    expect(other.total, "别人的画像看不到").toBe(0);
    expect(other.items.length, "别人的画像里没有条目").toBe(0);
    expect(other.insufficientCount).toBe(0);
  });

  test("画像按当前登录者取，不接受指定别人的参数", async () => {
    const fixture = await prepareAbilityFixture();
    const track = await createAbilityTrack(fixture, 0);

    await takeAndSubmit(fixture.student, track.sessionId, track.questionId, true);
    await waitForAbilityProfile(
      fixture.student,
      (p) => p.total >= 1,
      "本人应当看得到自己的画像",
    );

    // 带上别人的 userId 也不该给出别人的画像：
    // 这个接口没有「取谁的画像」这个入参，画像永远属于当前登录者。
    const result = await api(
      fixture.student,
      "GET",
      `/api/v1/abilities/profile?userId=${fixture.otherStudent.userId}`,
    );
    expectOk(result, "带 userId 读能力画像");

    const total = Number(result.json?.total ?? -1);
    expect(total, "带别人的 userId 也只返回自己的画像").toBe(1);
  });
});
