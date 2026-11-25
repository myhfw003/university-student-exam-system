/* ==========================================================================
   人员名单批量导入（FR-IAM-05）的单元测试
   --------------------------------------------------------------------------
   覆盖：列名匹配、逐行校验（不阻断整批）、已存在账号走更新、
   组织维度标签自动创建、角色推断、审计日志。
   ========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { importRoster, parseRosterCsv, validateRosterRows } from "../roster";
import { findUserByAccount, getOrgTag, useAdminOps, resetAdminOps } from "../adminOps";
import { resetCatalog, useCatalog } from "../catalog";

/** 便捷构造一行。 */
function row(over: Partial<Parameters<typeof validateRosterRows>[0][number]> = {}) {
  return {
    account: "2023999001",
    name: "测试同学",
    faculty: "计算机学院",
    major: "软件工程",
    className: "软件工程 2023 级 1 班",
    email: "t@example.edu",
    role: "",
    password: "",
    ...over,
  };
}

describe("roster · 名单 CSV 解析", () => {
  it("按表头名匹配中英文列名", () => {
    const rows = parseRosterCsv(
      "账号,姓名,院系,专业,班级,邮箱,角色,初始密码\n2023999001,张三,计算机学院,软件工程,软工2301,a@b.com,学生,",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account: "2023999001",
      name: "张三",
      faculty: "计算机学院",
      major: "软件工程",
      className: "软工2301",
      email: "a@b.com",
      role: "学生",
    });
  });

  it("认英文表头", () => {
    const rows = parseRosterCsv("account,name\n2023999002,李四");
    expect(rows[0]).toMatchObject({ account: "2023999002", name: "李四" });
  });

  it("缺账号或姓名列时抛错", () => {
    expect(() => parseRosterCsv("姓名,邮箱\n张三,a@b.com")).toThrow(/账号/);
    expect(() => parseRosterCsv("账号,邮箱\n2023999003,a@b.com")).toThrow(/姓名/);
  });

  it("「初始密码」列要认出来，不能被当成没有密码", () => {
    // 2026-11-25 的真缺陷：后端词表里没有「初始密码」，那一列被静默丢弃，
    // 教师给每个学生设的初始密码整列没进库。前端认、后端不认，才更要盯住。
    const rows = parseRosterCsv(
      "账号,姓名,初始密码\n2023999004,张三,Init9pass",
    );
    expect(rows[0]?.password).toBe("Init9pass");
  });

  it("认常见的列名别名", () => {
    const rows = parseRosterCsv(
      "帐号,名字,院系,班级,邮件,身份,初始密码\n2023999005,张三,计算机学院,软工2301,a@b.com,学生,Init9pass",
    );
    expect(rows[0]).toMatchObject({
      account: "2023999005",
      name: "张三",
      faculty: "计算机学院",
      className: "软工2301",
      email: "a@b.com",
      role: "学生",
      password: "Init9pass",
    });
  });

  it("username 与 name 两列不互相抢", () => {
    // 「username」里含「name」：按包含关系匹配时它会被姓名列抢走。
    const rows = parseRosterCsv("username,name\n2023999006,张三");
    expect(rows[0]).toMatchObject({ account: "2023999006", name: "张三" });
  });

  it("表头里带修饰词时按包含关系匹配", () => {
    const rows = parseRosterCsv("考生账号,考生姓名\n2023999007,张三");
    expect(rows[0]).toMatchObject({ account: "2023999007", name: "张三" });
  });
});

describe("roster · 逐行校验", () => {
  it("必填缺失、文件内账号重复、角色无法识别 → 该行标红，不阻断整批", () => {
    const checked = validateRosterRows([
      row(),
      row({ account: "", name: "无名" }),
      row({ account: "2023999001", name: "重复" }),
      row({ account: "2023999004", name: "坏角色", role: "校长" }),
      row({ account: "2023999005", name: "弱密码", password: "123" }),
    ]);

    expect(checked).toHaveLength(5);
    expect(checked[0]?.error).toBeUndefined();
    expect(checked[1]?.error).toMatch(/缺少账号/);
    expect(checked[2]?.error).toMatch(/重复/);
    expect(checked[3]?.error).toMatch(/角色无法识别/);
    expect(checked[4]?.error).toMatch(/初始密码/);
  });

  it("初始密码含账号时标红（规则与后端 PasswordPolicy 一致）", () => {
    const checked = validateRosterRows([
      row({ account: "2023999008", password: "Pass2023999008" }),
    ]);
    expect(checked[0]?.error).toMatch(/不能包含账号/);
  });

  it("重复判定不受该行其他错误影响：缺姓名的行也占位，后面的同名行仍算重复", () => {
    const checked = validateRosterRows([
      row({ account: "2023999010", name: "" }),
      row({ account: "2023999010", name: "后来的" }),
    ]);
    expect(checked[0]?.error).toMatch(/缺少姓名/);
    expect(checked[1]?.error).toMatch(/重复/);
  });

  it("系统中已存在的账号标记为「更新」", () => {
    const checked = validateRosterRows([row({ account: "admin", name: "陈砚之" })]);
    expect(checked[0]?.exists).toBe(true);
  });
});

describe("roster · 导入", () => {
  beforeEach(() => {
    resetCatalog();
    resetAdminOps();
  });

  it("新建账号：按班级推断为学生，并自动创建组织维度标签", () => {
    const checked = validateRosterRows([row()]);
    const result = importRoster(checked);

    expect(result.failed).toBe(0);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);

    const user = findUserByAccount("2023999001");
    expect(user?.roles).toEqual(["student"]);
    expect(user?.status).toBe("active");
    // 组织标签链：院系 → 专业 → 班级，三级都自动建出来。
    expect(user?.orgTags).toHaveLength(3);
    const classTag = getOrgTag(user?.orgTags[2] ?? "");
    expect(classTag?.name).toBe("软件工程 2023 级 1 班");
    expect(getOrgTag(user?.orgTags[1] ?? "")?.parentId).toBe(user?.orgTags[0]);
    expect(getOrgTag(user?.orgTags[0] ?? "")?.parentId).toBeNull();

    // 学生档案也建好了，能被名单组纳入。
    const student = useCatalog.getState().students.find((s) => s.id === "2023999001");
    expect(student?.name).toBe("测试同学");
  });

  it("无班级 → 社会人士，不挂组织标签", () => {
    const checked = validateRosterRows([
      row({ account: "public9001", name: "社会人", faculty: "", major: "", className: "" }),
    ]);
    const result = importRoster(checked);

    expect(result.created).toBe(1);
    const user = findUserByAccount("public9001");
    expect(user?.roles).toEqual(["general_user"]);
    expect(user?.orgTags).toEqual([]);
  });

  it("显式角色优先于班级推断", () => {
    const checked = validateRosterRows([row({ role: "出题教师" })]);
    importRoster(checked);
    expect(findUserByAccount("2023999001")?.roles).toEqual(["author_teacher"]);
  });

  it("更新已有账号时，CSV 没给组织信息就不清空原有标签", () => {
    const before = findUserByAccount("teacher01");
    expect(before?.orgTags.length).toBeGreaterThan(0);

    const checked = validateRosterRows([
      row({ account: "teacher01", name: "周砚秋", faculty: "", major: "", className: "" }),
    ]);
    importRoster(checked);

    expect(findUserByAccount("teacher01")?.orgTags).toEqual(before?.orgTags);
  });

  it("已存在的账号走更新，不重置密码，也不重复创建", () => {
    const before = useAdminOps.getState().users.length;
    const checked = validateRosterRows([row({ account: "admin", name: "陈砚之改" })]);
    const result = importRoster(checked);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(useAdminOps.getState().users.length).toBe(before);
    expect(findUserByAccount("admin")?.name).toBe("陈砚之改");
  });

  it("错误行跳过并计入失败明细，其余行照常导入", () => {
    const checked = validateRosterRows([
      row({ account: "", name: "缺账号" }),
      row({ account: "2023999006", name: "正常" }),
    ]);
    const result = importRoster(checked);

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.reason).toMatch(/缺少账号/);
    expect(findUserByAccount("2023999006")).toBeTruthy();
  });

  it("写入审计日志", () => {
    const checked = validateRosterRows([row()]);
    importRoster(checked);
    const logs = useAdminOps.getState().auditLogs;
    expect(logs[0]?.action).toBe("user.import-roster");
    expect(logs[0]?.summary).toMatch(/批量导入人员名单/);
  });

  it("未指定初始密码时不回显密码，新账号标记为要改密", () => {
    const checked = validateRosterRows([row()]);
    const result = importRoster(checked);

    // 响应里没有密码：新账号的密码是系统设定的原始密码，由管理员另行告知。
    expect(Object.keys(result)).not.toContain("initialPasswords");
    expect(findUserByAccount("2023999001")?.mustChangePassword).toBe(true);
  });

  it("名单里给了初始密码的账号，那个密码就是它自己的登录密码，不强制改密", () => {
    const checked = validateRosterRows([row({ account: "2023999007", password: "Init9pass" })]);
    importRoster(checked);

    // 与后端一致：教师逐个给定的密码不进「必须改密」，落回系统原始密码才要改。
    // mock 里没有这个标记就是「不需要改」（字段本身可选）。
    expect(findUserByAccount("2023999007")?.mustChangePassword).toBeFalsy();
  });
});
