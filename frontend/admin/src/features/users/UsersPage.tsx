/* ==========================================================================
   知行测评 · 管理端用户管理
   --------------------------------------------------------------------------
   按设计文档 §2.1 新建（原型无此模块）。

   账号 = 账号 + 密码（不限学号），角色权限取并集。
   组织归属用**组织维度标签**表达，不存独立字段（FR-IAM-04）。

   数据通路见 `useAdminUsers.ts`：mock 与真实后端各一份，页面只认统一形状。
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
  decodeCsvBuffer,
  hasPermission,
  toast,
  useAuth,
} from "@exam/shared";
import { isBackendEnabled } from "@exam/shared/api";
import {
  parseRosterCsv,
  validateRosterRows,
  type RosterImportResult,
  type RosterPreviewRow,
} from "@exam/shared/mock/roster";
import { Icon } from "@/app/Icon";
import {
  importRosterFile,
  useAdminOrgTags,
  useAdminRoles,
  useAdminUserActions,
  useAdminUserList,
  writeUserAudit,
  type AdminUserRow,
} from "./useAdminUsers";

/** 教职类角色码（统计用）。 */
const STAFF_ROLE_CODES = ["author_teacher", "grader_teacher", "content_admin", "system_admin"];

/** 角色徽标色调。 */
const ROLE_TONE: Record<string, "primary" | "info" | "ok" | "warn" | "neutral"> = {
  system_admin: "primary",
  content_admin: "info",
  author_teacher: "ok",
  grader_teacher: "warn",
  student: "neutral",
  general_user: "neutral",
};

/** 角色文本（角色码或中文名）→ 中文名；无法识别时原样返回。 */
function roleLabelOf(text: string): string {
  return text;
}

/** 用户管理页。 */
export function UsersPage() {
  const remote = isBackendEnabled();

  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  // 重置密码（FR-IAM-03）：管理员重置任意用户密码并强制其下次登录修改。
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  // 名单批量导入（FR-IAM-05）。
  const [importOpen, setImportOpen] = useState(false);
  const [rosterRows, setRosterRows] = useState<RosterPreviewRow[]>([]);
  const [rosterFile, setRosterFile] = useState<File | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterResult, setRosterResult] = useState<RosterImportResult | null>(null);
  const [rosterFileName, setRosterFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const doResetPassword = useAuth((state) => state.resetPassword);
  const authUser = useAuth((state) => state.user);

  // 角色目录**读**只要 user:read（谁在管用户谁就看得到有哪些角色），
  // 但改角色集合要 role:write——矩阵里只给系统管理员。
  // 没有 role:write 的账号（例如内容管理员）照样看得到角色清单，
  // 只是勾不动：与其点一下就撞 403，不如把话说清楚。
  //
  // 权限来源与服务端对齐：http 模式用服务端下发的权限码，
  // mock 模式退回本地角色矩阵。
  const canAssignRoles =
    authUser?.permissions?.includes("role:write") ??
    hasPermission(authUser?.roles, "role:write");

  const { roles, byCode } = useAdminRoles();
  const orgTags = useAdminOrgTags();

  // 角色过滤传给服务端的是**角色 ID**；页面上的下拉用的是角色码。
  const roleId = roleFilter === "all" ? "" : (byCode[roleFilter]?.id ?? "");
  const roleNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const role of roles) map[role.code] = role.name;
    return map;
  }, [roles]);
  const { rows, total, refresh } = useAdminUserList({ keyword, roleId, roleNames, orgTags });

  const { setRoles, setStatus, setOrgTags } = useAdminUserActions({
    roleIdOf: (code) => byCode[code]?.id ?? "",
    refresh,
    audit: (userId, summary, action) => writeUserAudit(userId, summary, action),
  });

  const activeCount = rows.filter((u) => u.status === "active").length;
  const staffCount = rows.filter((u) =>
    u.roles.some((code) => STAFF_ROLE_CODES.includes(code)),
  ).length;
  const studentCount = rows.filter((u) => u.roles.includes("student")).length;
  const generalCount = rows.filter((u) => u.roles.includes("general_user")).length;

  const toggleRole = async (user: AdminUserRow, role: string) => {
    const next = user.roles.includes(role)
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role];
    try {
      await setRoles(user.id, next);
      setEditing({
        ...user,
        roles: next,
        roleLabels: next.map((code) => byCode[code]?.name ?? code),
      });
      toast.ok("角色已更新，变更即时生效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "角色变更失败");
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetError(null);
    const result = await doResetPassword(resetTarget.id);
    if (!result.ok) {
      setResetError(result.message ?? "重置失败，请重试");
      return;
    }
    toast.ok("密码已重置");
    setResetTarget(null);
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
      setRosterFile(file);
      setRosterFileName(file.name);
      const bad = checked.filter((row) => row.error).length;
      toast.ok(
        bad > 0
          ? `已解析 ${checked.length} 行，其中 ${bad} 行有问题，将跳过这些行`
          : `已解析 ${checked.length} 行，可导入`,
      );
    } catch (error) {
      setRosterRows([]);
      setRosterFile(null);
      setRosterError(error instanceof Error ? error.message : "文件解析失败");
    }
  };

  /** 执行导入：逐行写入，失败行跳过并给出明细。 */
  const handleRosterImport = async (): Promise<void> => {
    if (!rosterFile) {
      toast.error("请先选择名单文件");
      return;
    }
    if (!remote && rosterRows.length === 0) {
      toast.error("没有可导入的数据行");
      return;
    }
    setImporting(true);
    try {
      const result = await importRosterFile(rosterFile, rosterRows);
      setRosterResult(result);
      if (result.failed > 0) {
        toast.error(`导入完成：成功 ${result.succeeded} 行，失败 ${result.failed} 行`);
      } else {
        toast.ok(`导入完成：成功 ${result.succeeded} 行`);
      }
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const toggleStatus = async (user: AdminUserRow) => {
    const next = user.status === "active" ? "disabled" : "active";
    try {
      await setStatus(user, next);
      toast.ok(next === "active" ? "账号已启用" : "账号已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "状态更新失败");
    }
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
        <Stat
          label="账号总数"
          value={total}
          unit="个"
          hint={remote ? "服务端统计" : `${activeCount} 个正常`}
        />
        <Stat
          label="教职账号"
          value={staffCount}
          unit="个"
          hint={remote ? "本页" : "出题 / 阅卷 / 管理"}
        />
        <Stat
          label="在校学生"
          value={studentCount}
          unit="个"
          hint={remote ? "本页" : "挂组织标签"}
        />
        <Stat
          label="社会人士"
          value={generalCount}
          unit="个"
          hint={remote ? "本页" : "不依赖组织归属"}
        />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">账号清单</h2>
          <span className="text-sm text-3">{rows.length} 个账号</span>
        </div>
        <div className="card-body">
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <Segmented
              label="角色筛选"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "all" as const, label: "全部" },
                ...roles.map((role) => ({ value: role.code, label: role.name })),
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
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <span className="empty-title">没有符合条件的账号</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => (
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
                          {u.roles.map((code) => (
                            <Badge key={code} tone={ROLE_TONE[code] ?? "neutral"}>
                              {byCode[code]?.name ?? roleLabelOf(code)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        {u.orgTags.length === 0 ? (
                          <span className="text-3 text-sm">—</span>
                        ) : (
                          <div className="row-tight">
                            {u.orgTags.map((tag) => (
                              <span className="tag-chip is-organization" key={tag.id}>
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row-tight">
                          <Badge tone={u.status === "active" ? "ok" : "neutral"}>
                            {u.status === "active" ? "正常" : u.status === "locked" ? "已锁定" : "已停用"}
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
                            setResetTarget(u);
                          }}
                        >
                          重置密码
                        </Button>{" "}
                        <Button size="sm" variant="danger" onClick={() => void toggleStatus(u)}>
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
          <p className="section-note">
            重置后这个用户的密码置为系统设定的原始密码（在「系统设置」里配好的那个），
            请自行把密码告知用户。响应里不会带密码。
          </p>
          <p className="section-note">
            该密码仅作首次登录凭据：用户登录后必须立即修改密码，
            改密之前只能用改密、查看本人档案与登出这三个功能。
          </p>
        </div>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setRosterRows([]);
          setRosterFile(null);
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
                setRosterFile(null);
                setRosterError(null);
                setRosterResult(null);
                setRosterFileName("");
              }}
            >
              关闭
            </Button>
            <Button
              variant="primary"
              disabled={rosterFile === null || rosterResult !== null || importing}
              onClick={() => void handleRosterImport()}
            >
              {importing ? "导入中…" : "确认导入"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="名单 CSV 列定义">
            账号、姓名为必填；院系 / 专业 / 班级可空（为空即视为社会人士）；
            邮箱、角色、初始密码可空。角色留空时按「是否有班级」推断。
            导入按行校验，出错的行标红跳过，不阻断整批。
            初始密码列留空时，账号的密码是系统设定的原始密码（在「系统设置」里配好的那个），
            导入结果里不回显密码。
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
                {rosterResult.created > 0 ? (
                  <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
                    新账号的初始密码是系统设定的原始密码（在「系统设置」里配好的那个），
                    请自行把密码告知用户；用户首次登录后需修改密码。
                  </p>
                ) : null}
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
            {canAssignRoles ? null : (
              <p className="section-note" style={{ marginBottom: "var(--sp-3)" }}>
                当前账号没有「编辑角色」的权限（role:write），只能查看角色，不能改。
              </p>
            )}
            <div className="grid-2">
              {roles.map((role) => (
                <label className="checkline" key={role.code}>
                  <input
                    type="checkbox"
                    disabled={!canAssignRoles}
                    checked={editing.roles.includes(role.code)}
                    onChange={() => void toggleRole(editing, role.code)}
                  />
                  <span className="checkline-text">
                    {role.name}
                    <span className="checkline-hint">
                      {role.code === "system_admin"
                        ? "拥有全部权限"
                        : role.code === "general_user"
                          ? "面向社会人士，不依赖组织归属"
                          : role.code === "student"
                            ? "可参加考试与练习，查看自己的成绩与错题本"
                            : role.description || "按权限矩阵授予"}
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
                  value={editing.orgTags[0]?.id ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    const tagIds = value ? [value] : [];
                    void setOrgTags(editing.id, tagIds).then(() => {
                      setEditing({
                        ...editing,
                        orgTags: tagIds.map((id) => ({
                          id,
                          name: orgTags.find((tag) => tag.id === id)?.name ?? id,
                        })),
                      });
                      toast.ok("组织归属已更新");
                    }).catch((error: unknown) => {
                      toast.error(error instanceof Error ? error.message : "组织标签更新失败");
                    });
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
