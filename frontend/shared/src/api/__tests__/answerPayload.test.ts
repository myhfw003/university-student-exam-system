/* ==========================================================================
   作答载荷的线格式转换
   --------------------------------------------------------------------------
   重点是**选择键的口径**：卷面上给考生看的是显示字母，服务端判分用的是原题键。
   梅花卷置换过选项，两者不是一回事——换算错一次，整卷判分都是错的。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { toDomainPayload, toServerAnswerBatch, toServerPayload } from "../answerPayload";

/** 题目 11 的换算表：显示 A/B/C 分别对应原题键 C/A/B。 */
const keyMap = { "11": { A: "C", B: "A", C: "B" } };

describe("作答载荷的线格式转换", () => {
  it("上行前把显示字母换成原题键", () => {
    const wire = toServerAnswerBatch(
      {
        attemptId: "9001",
        clientSeq: 3,
        items: [{ questionId: "11", payload: { selectedOptionKeys: ["A"] } }],
        createdAt: "2026-11-17T10:00:00Z",
      },
      keyMap,
    );

    expect(wire.clientSeq).toBe(3);
    expect(wire.items[0]!.payload.selectedOptionKeys).toEqual(["C"]);
  });

  it("多选的显示字母逐个换成原题键", () => {
    const payload = toServerPayload({ selectedOptionKeys: ["A", "C"] }, keyMap["11"]);
    expect(payload.selectedOptionKeys).toEqual(["B", "C"]);
  });

  it("没有换算表时原样上行", () => {
    const payload = toServerPayload({ selectedOptionKeys: ["A"] });
    expect(payload.selectedOptionKeys).toEqual(["A"]);
  });

  it("换算表里没有的键原样保留", () => {
    const payload = toServerPayload({ selectedOptionKeys: ["D"] }, keyMap["11"]);
    expect(payload.selectedOptionKeys).toEqual(["D"]);
  });

  it("回填本地时把原题键换回显示字母", () => {
    const payload = toDomainPayload({ selectedOptionKeys: ["C"] }, keyMap["11"]);
    expect(payload.selectedOptionKey).toBe("A");
  });

  it("回填多选时换回全部显示字母", () => {
    const payload = toDomainPayload({ selectedOptionKeys: ["A", "B"] }, keyMap["11"]);
    expect(payload.selectedOptionKeys).toEqual(["B", "C"]);
  });

  it("文本与步骤不受换算影响", () => {
    const payload = toServerPayload(
      { text: "作答", steps: [{ stepCode: "S1", text: "第一步" }] },
      keyMap["11"],
    );
    expect(payload.text).toBe("作答");
    expect(payload.steps).toEqual([{ code: "S1", text: "第一步" }]);
  });
});
