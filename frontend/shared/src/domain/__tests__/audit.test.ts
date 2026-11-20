/* ==========================================================================
   审计动作码与中文名的单元测试
   --------------------------------------------------------------------------
   动作码是前后端共用的一套词（FR-AUD-01 / FR-IAM-07）：
   前端要按它筛审计日志，也要把动作显示成人看得懂的中文名。

   这里的用例盯住三件事：
   - 每个动作码都有中文名（漏一个，审计页上就显示成一串原始码）；
   - 每个动作码都落在某个业务分组里（落在「其他」组说明分组表漏了它）；
   - 没登记过的动作码原样显示，不能显示成空白。
   ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_TYPE_LABEL,
  auditActionGroupOf,
  auditActionLabel,
} from "../audit";
import type { AuditAction } from "../types";

describe("审计动作码", () => {
  it("每个动作码都有中文名", () => {
    const missing = Object.keys(AUDIT_ACTION_LABEL).filter((code) => !AUDIT_ACTION_LABEL[code as AuditAction]);
    expect(missing).toEqual([]);
  });

  it("每个动作码都落在业务分组里，没有漏网的", () => {
    const orphan = (Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]).filter(
      (code) => auditActionGroupOf(code) === "其他",
    );
    expect(orphan).toEqual([]);
  });

  it("分组清单把所有动作码都收了，且不重不漏", () => {
    const grouped = AUDIT_ACTION_GROUPS.flatMap((group) => group.actions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...Object.keys(AUDIT_ACTION_LABEL)].sort());
  });

  it("登录相关的动作码都有中文名（FR-AUD-01 必留痕的那批）", () => {
    expect(AUDIT_ACTION_LABEL["auth.login"]).toBe("登录成功");
    expect(AUDIT_ACTION_LABEL["auth.login_failed"]).toBe("登录失败");
    expect(AUDIT_ACTION_LABEL["auth.logout"]).toBe("登出");
    expect(AUDIT_ACTION_LABEL["auth.refresh_reuse"]).toBe("刷新令牌异常使用");
  });

  it("已登记的动作码给出中文名", () => {
    expect(auditActionLabel("exam_session.publish")).toBe("发布场次");
    expect(auditActionLabel("user.assign-roles")).toBe("变更角色");
  });

  it("实体字段自动留痕（entity.<类型>.updated）也认得出来", () => {
    expect(auditActionLabel("entity.user.updated")).toBe("自动留痕：更新用户");
    expect(auditActionLabel("entity.paper.deleted")).toBe("自动留痕：删除试卷");
  });

  it("完全不熟悉的动作码原样返回，不能显示成空白", () => {
    expect(auditActionLabel("legacy.old_action")).toBe("legacy.old_action");
    expect(auditActionLabel("")).toBe("");
  });

  it("实体类型名登记了中文名", () => {
    expect(AUDIT_ENTITY_TYPE_LABEL.user).toBe("用户");
    expect(AUDIT_ENTITY_TYPE_LABEL.examsession).toBe("考试场次");
  });
});
