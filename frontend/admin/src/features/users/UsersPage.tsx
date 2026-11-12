/* ==========================================================================
   知行测评 · 管理端用户管理
   --------------------------------------------------------------------------
   按设计文档 §2.1 新建（原型无此模块）。

   账号 = 账号 + 密码（不限学号），角色权限取并集。
   组织归属用**组织维度标签**表达，不存独立字段（FR-IAM-04）。
   ========================================================================== */

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Field,
  PageHead,
  SearchInput,
  Segmented,
  SelectInput,
  Stat,
  toast,
} from "@exam/shared";
import {
  ORG_TAGS,
  USER_ROLE_LABEL,
  USER_STATUS_LABEL,
  setUserRoles,
  updateUser,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import type { AppUser, UserRole } from "@exam/shared/domain/types";
import { Icon } from "@/app/Icon";

const ALL_ROLES: UserRole[] = [
  "system_admin",
  "content_admin",
  "author_teacher",
  "grader_teacher",
  "student",
  "general_user",
];

const ROLE_TONE: Record<UserRole, "primary" | "info" | "ok" | "warn" | "neutral"> = {
  system_admin: "primary",
  content_admin: "info",
  author_teacher: "ok",
  grader_teacher: "warn",
  student: "neutral",
  general_user: "neutral",
};

/** 用户管理页。 */
export function UsersPage() {
  const users = useAdminOps((state) => state.users);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [editing, setEditing] = useState<AppUser | null>(null);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== "all" && !u.roles.includes(roleFilter)) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${u.account} ${u.name} ${u.email}`.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [users, keyword, roleFilter]);

  const activeCount = users.filter((u) => u.status === "active").length;
  const generalCount = users.filter((u) => u.roles.includes("general_user")).length;
  const staffCount = users.filter((u) =>
    u.roles.some((r) => r === "author_teacher" || r === "grader_teacher" || r === "content_admin" || r === "system_admin"),
  ).length;

  const toggleRole = (user: AppUser, role: UserRole) => {
    const next = user.roles.includes(role)
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role];
    const result = setUserRoles(user.id, next);
    if (!result.ok) {
      toast.error(result.message ?? "角色变更失败");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "user.role_changed",
      targetType: "user",
      targetId: user.id,
      summary: `为「${user.name}」调整角色：${user.roles.map((r) => USER_ROLE_LABEL[r]).join("、")} → ${next.map((r) => USER_ROLE_LABEL[r]).join("、")}`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok("角色已更新，变更即时生效");
  };

  const toggleStatus = (user: AppUser) => {
    const next = user.status === "active" ? "disabled" : "active";
    const result = updateUser(user.id, { status: next });
    if (!result.ok) {
      toast.error(result.message ?? "状态更新失败");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "user.update",
      targetType: "user",
      targetId: user.id,
      summary: `将「${user.name}」置为${USER_STATUS_LABEL[next]}`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok(next === "active" ? "账号已启用" : "账号已停用");
  };

  return (
    <>
      <PageHead
        title="用户"
        sub="账号与密码登录（不限学号），角色权限取并集；组织归属用组织维度标签表达，不单独存字段。"
        actions={
          <Button onClick={() => toast.info("批量导入需上传 CSV，当前为示例数据模式")}>
            <Icon name="document" />
            批量导入
          </Button>
        }
      />

      <div className="stat-row" style={{ marginBottom: "var(--sp-4)" }}>
        <Stat label="账号总数" value={users.length} unit="个" hint={`${activeCount} 个正常`} />
        <Stat label="教职账号" value={staffCount} unit="个" hint="出题 / 阅卷 / 管理" />
        <Stat label="在校学生" value={users.filter((u) => u.roles.includes("student")).length} unit="个" hint="挂组织标签" />
        <Stat label="社会人士" value={generalCount} unit="个" hint="不依赖组织归属" />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">账号清单</h2>
          <span className="text-sm text-3">{filtered.length} 个账号</span>
        </div>
        <div className="card-body">
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <Segmented
              label="角色筛选"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "all" as const, label: "全部" },
                ...ALL_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABEL[r] })),
              ]}
            />
            <SearchInput
              label="搜索账号、姓名或邮箱"
              value={keyword}
              placeholder="搜索账号、姓名或邮箱"
              onSearch={setKeyword}
              onChange={setKeyword}
            />
          </div>
          <Callout tone="info" title="角色权限取并集">
            用户可拥有多个角色，权限按并集计算；变更即时生效，无需重新登录。系统管理员拥有全部权限。
          </Callout>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>组织标签</th>
                  <th>状态</th>
                  <th>最后登录</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <span className="empty-title">没有符合条件的账号</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="strong" style={{ fontWeight: 500 }}>
                          {u.account}
                        </div>
                        <div className="text-xs text-3 mono">{u.id}</div>
                      </td>
                      <td>{u.name}</td>
                      <td>
                        <div className="row-tight">
                          {u.roles.map((r) => (
                            <Badge key={r} tone={ROLE_TONE[r]}>
                              {USER_ROLE_LABEL[r]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        {u.orgTags.length === 0 ? (
                          <span className="text-3 text-sm">—</span>
                        ) : (
                          <div className="row-tight">
                            {u.orgTags.map((tagId) => (
                              <span className="tag-chip is-organization" key={tagId}>
                                {ORG_TAGS.find((t) => t.id === tagId)?.name ?? tagId}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge tone={u.status === "active" ? "ok" : "neutral"}>
                          {USER_STATUS_LABEL[u.status]}
                        </Badge>
                      </td>
                      <td className="text-xs text-3">{u.lastLoginAt ?? "从未登录"}</td>
                      <td className="col-actions">
                        <Button size="sm" onClick={() => setEditing(u)}>
                          角色
                        </Button>{" "}
                        <Button size="sm" variant="danger" onClick={() => toggleStatus(u)}>
                          {u.status === "active" ? "停用" : "启用"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `角色分配 · ${editing.name}` : "角色分配"}
        footer={
          <Button variant="primary" onClick={() => setEditing(null)}>
            完成
          </Button>
        }
      >
        {editing ? (
          <>
            <p className="section-note" style={{ marginBottom: "var(--sp-4)" }}>
              账号 <span className="mono">{editing.account}</span> · 勾选即生效，权限按并集计算。
            </p>
            <div className="grid-2">
              {ALL_ROLES.map((role) => (
                <label className="checkline" key={role}>
                  <input
                    type="checkbox"
                    checked={editing.roles.includes(role)}
                    onChange={() => toggleRole(editing, role)}
                  />
                  <span className="checkline-text">
                    {USER_ROLE_LABEL[role]}
                    <span className="checkline-hint">
                      {role === "system_admin"
                        ? "拥有全部权限"
                        : role === "general_user"
                          ? "面向社会人士，不依赖组织归属"
                          : role === "student"
                            ? "可参加考试与练习，查看自己的成绩与错题本"
                            : "按权限矩阵授予"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <Field label="组织归属标签" hint="社会人士不挂组织标签；院系 / 专业 / 班级在此表达。" htmlFor="user-org-tag">
                <SelectInput
                  id="user-org-tag"
                  aria-label="组织归属标签"
                  value={editing.orgTags[0] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateUser(editing.id, { orgTags: value ? [value] : [] });
                    writeAudit({
                      operator: "陈砚之",
                      action: "user.tag_changed",
                      targetType: "user",
                      targetId: editing.id,
                      summary: `为「${editing.name}」调整组织标签`,
                      ip: "10.12.0.21",
                      userAgent: "Chrome 131 / Windows",
                    });
                    setEditing({ ...editing, orgTags: value ? [value] : [] });
                  }}
                >
                  <option value="">不挂组织标签（社会人士）</option>
                  {ORG_TAGS.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
