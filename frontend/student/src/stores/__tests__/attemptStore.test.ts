import { beforeEach, describe, expect, it } from "vitest";
import { isPayloadEmpty } from "@exam/shared/domain/attempt";
import {
  multiPayload,
  selectedKeysOf,
  singlePayload,
  useAttemptStore,
} from "../attemptStore";

describe("attemptStore · 作答缓冲", () => {
  beforeEach(() => {
    useAttemptStore.getState().reset();
  });

  it("写入与清空答案", () => {
    useAttemptStore.getState().setAnswer(1, singlePayload("A"));
    expect(useAttemptStore.getState().answers[1]).toEqual({ selectedOptionKey: "A" });

    useAttemptStore.getState().clearAnswer(1);
    expect(useAttemptStore.getState().answers[1]).toBeUndefined();
  });

  it("标记可来回切换", () => {
    useAttemptStore.getState().toggleMarked(5);
    expect(useAttemptStore.getState().marked).toEqual([5]);

    useAttemptStore.getState().toggleMarked(5);
    expect(useAttemptStore.getState().marked).toEqual([]);
  });

  it("clientSeq 从 1 开始单调递增", () => {
    expect(useAttemptStore.getState().nextClientSeq()).toBe(1);
    expect(useAttemptStore.getState().nextClientSeq()).toBe(2);
    expect(useAttemptStore.getState().nextClientSeq()).toBe(3);
  });

  it("多选载荷去重并按键排序，保证同一组选项载荷稳定", () => {
    expect(multiPayload(["C", "A", "C"])).toEqual({ selectedOptionKeys: ["A", "C"] });
  });

  it("已选项读取统一入口", () => {
    expect(selectedKeysOf({ selectedOptionKey: "B" })).toEqual(["B"]);
    expect(selectedKeysOf({ selectedOptionKeys: ["A", "D"] })).toEqual(["A", "D"]);
    expect(selectedKeysOf(undefined)).toEqual([]);
  });

  it("空载荷判定覆盖各题型", () => {
    expect(isPayloadEmpty(undefined)).toBe(true);
    expect(isPayloadEmpty({ selectedOptionKey: "" })).toBe(true);
    expect(isPayloadEmpty({ selectedOptionKeys: [] })).toBe(true);
    expect(isPayloadEmpty({ text: "   " })).toBe(true);
    expect(isPayloadEmpty({ steps: [{ stepCode: "s1", text: "" }] })).toBe(true);
    expect(isPayloadEmpty({ selectedOptionKey: "A" })).toBe(false);
    expect(isPayloadEmpty({ text: "作答" })).toBe(false);
  });
});
