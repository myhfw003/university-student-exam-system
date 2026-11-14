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
  TextInput,
  decodeCsvBuffer,
  toast,
  useAuth,
} from "@exam/shared";
import {
  USER_ROLE_LABEL,
  USER_STATUS_LABEL,
  setUserRoles,
  updateUser,
  useAdminOps,
  writeAudit,
} from "@exam/shared/mock/adminOps";
import {
  importRoster,
  parseRosterCsv,
  validateRosterRows,
  type RosterImportResult,
  type RosterPreviewRow,
} from "@exam/shared/mock/roster";
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

/** 角色文本（角色码或中文名）→ 中文名；无法识别时原样返回。 */
function roleLabelOf(text: string): string {
  const hit = ALL_ROLES.find((role) => role === text || USER_ROLE_LABEL[role] === text);
  return hit ? USER_ROLE_LABEL[hit] : text;
}

/** 用户管理页。 */
export function UsersPage() {
  const users = useAdminOps((state) => state.users);
  // 组织维度标签已进 store（名单导入会按层级自动创建），这里要读最新的。
  const orgTags = useAdminOps((state) => state.orgTags);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [editing, setEditing] = useState<AppUser | null>(null);
  // 重置密码（FR-IAM-03）：管理员重置任意用户密码并强制其下次登录修改。
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);
  // 名单批量导入（FR-IAM-05）。
  const [importOpen, setImportOpen] = useState(false);
  const [rosterRows, setRosterRows] = useState<RosterPreviewRow[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterResult, setRosterResult] = useState<RosterImportResult | null>(null);
  const [rosterFileName, setRosterFileName] = useState("");
  const doResetPassword = useAuth((state) => state.resetPassword);

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

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetError(null);
    const result = await doResetPassword(resetTarget.id, resetPassword, forceChange);
    if (!result.ok) {
      setResetError(result.message ?? "重置失败，请重试");
      return;
    }
    writeAudit({
      operator: "陈砚之",
      action: "user.password_reset",
      targetType: "user",
      targetId: resetTarget.id,
      summary: `重置「${resetTarget.name}」的密码${forceChange ? "，强制下次登录修改" : ""}`,
      ip: "10.12.0.21",
      userAgent: "Chrome 131 / Windows",
    });
    toast.ok("密码已重置");
    setResetTarget(null);
    setResetPassword("");
    setForceChange(true);
  };

  /** 选择名单 CSV → 解析并逐行校验（不阻断整批）。 */
  const handleRosterFile = async (file: File | null): Promise<void> => {
    if (!file) return;
    setRosterError(null);
    setRosterResult(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      const parsed = parseRosterCsv(text);
      const checked = validateRosterRows(parsed);
      setRosterRows(checked);
      setRosterFileName(file.name);
      const bad = checked.filter((row) => row.error).length;
      toast.ok(
        bad > 0
          ? `已解析 ${checked.length} 行，其中 ${bad} 行有问题，将跳过这些行`
          : `已解析 ${checked.length} 行，可导入`,
      );
    } catch (error) {
      setRosterRows([]);
      setRosterError(error instanceof Error ? error.message : "文件解析失败");
    }
  };

  /** 执行导入：逐行写入，失败行跳过并给出明细。 */
  const handleRosterImport = (): void => {
    if (rosterRows.length === 0) {
      toast.error("请先选择名单文件");
      return;
    }
    const result = importRoster(rosterRows);
    setRosterResult(result);
    if (result.failed > 0) {
      toast.error(`导入完成：成功 ${result.succeeded} 行，失败 ${result.failed} 行`);
    } else {
      toast.ok(`导入完成：成功 ${result.succeeded} 行`);
    }
    setRosterRows([]);
    setRosterFileName("");
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
          <Button onClick={() => setImportOpen(true)}>
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
                  <th scope="col">账号</th>
                  <th scope="col">姓名</th>
                  <th scope="col">角色</th>
                  <th scope="col">组织标签</th>
                  <th scope="col">状态</th>
                  <th scope="col">最后登录</th>
                  <th scope="col"></th>
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
                                {orgTags.find((t) => t.id === tagId)?.name ?? tagId}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row-tight">
                          <Badge tone={u.status === "active" ? "ok" : "neutral"}>
                            {USER_STATUS_LABEL[u.status]}
                          </Badge>
                          {u.mustChangePassword ? (
                            <Badge tone="warn">待改密码</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-xs text-3">{u.lastLoginAt ?? "从未登录"}</td>
                      <td className="col-actions">
                        <Button size="sm" onClick={() => setEditing(u)}>
                          角色
                        </Button>{" "}
                        <Button
                          size="sm"
                          onClick={() => {
                            setResetError(null);
                            setResetPassword("");
                            setForceChange(true);
                            setResetTarget(u);
                          }}
                        >
                          重置密码
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
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `重置密码 · ${resetTarget.name}` : "重置密码"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void handleResetPassword()}>
              确认重置
            </Button>
          </>
        }
      >
        <div className="stack">
          {resetError ? (
            <Callout tone="danger" title="重置失败">
              {resetError}
            </Callout>
          ) : null}
          <Field label="新密码" required htmlFor="reset-password">
            <TextInput
              id="reset-password"
              type="text"
              value={resetPassword}
              placeholder="至少 8 位"
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </Field>
          <label className="checkline">
            <input
              type="checkbox"
              checked={forceChange}
              onChange={(e) => setForceChange(e.target.checked)}
            />
            <span className="checkline-text">
              <span>强制下次登录修改</span>
              <span className="checkline-hint">
                管理员重置的密码仅作首次登录凭据，用户登录后需立即修改。
              </span>
            </span>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setRosterRows([]);
          setRosterError(null);
          setRosterResult(null);
          setRosterFileName("");
        }}
        title="批量导入人员名单"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setImportOpen(false);
                setRosterRows([]);
                setRosterError(null);
                setRosterResult(null);
                setRosterFileName("");
              }}
            >
              关闭
            </Button>
            <Button
              variant="primary"
              disabled={rosterRows.length === 0 || rosterResult !== null}
              onClick={handleRosterImport}
            >
              确认导入
            </Button>
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="名单 CSV 列定义">
            账号、姓名为必填；院系 / 专业 / 班级可空（为空即视为社会人士）；
            邮箱、角色、初始密码可空。角色留空时按「是否有班级」推断。
            导入按行校验，出错的行标红跳过，不阻断整批。
          </Callout>

          <Field
            htmlFor="roster-file"
            label="名单文件"
            hint="支持 .csv（UTF-8 / GBK）。列按表头名自动匹配。"
          >
            <input
              id="roster-file"
              className="input"
              type="file"
              accept=".csv,.txt"
              onChange={(event) => void handleRosterFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          {rosterError ? (
            <Callout tone="danger" title="文件解析失败">
              {rosterError}
            </Callout>
          ) : null}

          {rosterResult ? (
            <>
              <Callout
                tone={rosterResult.failed > 0 ? "warn" : "ok"}
                title={`导入完成：成功 ${rosterResult.succeeded} 行，失败 ${rosterResult.failed} 行`}
              >
                新建 {rosterResult.created} 个账号，更新 {rosterResult.updated} 个账号。
                {rosterResult.failures.length > 0 ? (
                  <ul className="rule-list" style={{ marginTop: "var(--sp-3)" }}>
                    {rosterResult.failures.map((failure) => (
                      <li key={`${failure.rowNo}-${failure.account}`}>
                        第 {failure.rowNo} 行 · {failure.account || "（无账号）"} · {failure.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Callout>
              {rosterResult.initialPasswords.length > 0 ? (
                <Callout tone="warn" title="初始密码（仅显示一次）">
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">账号</th>
                          <th scope="col">初始密码</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rosterResult.initialPasswords.map((item) => (
                          <tr key={item.account}>
                            <td>{item.account}</td>
                            <td className="mono">{item.password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  用户首次登录后需修改密码。
                </Callout>
              ) : null}
            </>
          ) : null}

          {rosterRows.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">行</th>
                    <th scope="col">账号</th>
                    <th scope="col">姓名</th>
                    <th scope="col">班级</th>
                    <th scope="col">角色</th>
                    <th scope="col">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((row) => (
                    <tr key={row.rowNo}>
                      <td className="num">{row.rowNo}</td>
                      <td className="mono">{row.account || "—"}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.className || "—"}</td>
                      <td>
                        {row.roleExplicit
                          ? roleLabelOf(row.role)
                          : row.className
                            ? "学生（按班级推断）"
                            : "社会人士（按无班级推断）"}
                      </td>
                      <td>
                        {row.error ? (
                          <>
                            <Badge tone="danger">跳过</Badge>
                            <div className="text-xs" style={{ color: "var(--c-danger)" }}>
                              {row.error}
                            </div>
                          </>
                        ) : row.exists ? (
                          <Badge tone="info">更新</Badge>
                        ) : (
                          <Badge tone="ok">新建</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {rosterFileName && rosterRows.length === 0 && rosterResult === null ? (
            <p className="section-note">已读取 {rosterFileName}，暂无数据行。</p>
          ) : null}
        </div>
      </Dialog>

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
                  {orgTags.map((tag) => (
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
