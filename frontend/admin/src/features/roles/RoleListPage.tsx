/* ==========================================================================
   知行测评 · 管理端角色与权限
   --------------------------------------------------------------------------
   角色决定用户能做什么：用户可拥有多个角色，权限点按**并集**计算，
   变更即时生效（下次鉴权即反映，无需重新登录）。

   按需求文档 §1「角色与权限矩阵」新建。系统内置角色不可删除，
   只能调整其权限集合——存量库里被划掉的权限点（如学生的 `question:read`）
   也要靠在这里**重新保存一次该角色**才真正去掉。

   数据通路见 `useAdminRoles.ts`（在 users 目录下，角色目录本来就在那儿取）：
   mock 与真实后端各一份，页面只认统一形状。
   ========================================================================== */

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  Field,
  PageHead,
  TextInput,
  toast,
} from "@exam/shared";
import { Icon } from "@/app/Icon";
import type { AdminPermission, AdminRole } from "@exam/shared/domain/admin";
import {
  createRoleSettings,
  saveRoleSettings,
  useAdminRoles,
  usePermissionCatalog,
} from "../users/useAdminUsers";

/** 角色与权限页。 */
export function RoleListPage() {
  const { roles, loading, refresh } = useAdminRoles();
  const permissions = usePermissionCatalog();

  // 对话框：新建一个角色，还是改已有角色的权限。
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [roleCode, setRoleCode] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  /** 权限点按模块分组。 */
  const modules = useMemo(() => {
    const groups = new Map<string, AdminPermission[]>();
    for (const permission of permissions) {
      const list = groups.get(permission.module) ?? [];
      list.push(permission);
      groups.set(permission.module, list);
    }
    return [...groups.entries()].map(([module, items]) => ({ module, items }));
  }, [permissions]);

  /** 新建一个自定义角色。 */
  const openCreate = () => {
    setDialogMode("create");
    setEditing(null);
    setRoleCode("");
    setRoleName("");
    setRoleDescription("");
    setSelected([]);
  };

  /** 打开某个角色的权限矩阵。 */
  const openEditor = (role: AdminRole) => {
    setDialogMode("edit");
    setEditing(role);
    setRoleCode(role.code);
    setRoleName(role.name);
    setRoleDescription(role.description);
    setSelected([...role.permissions]);
  };

  /** 保存：新建走 POST /roles，改权限走 PUT /roles/{id}。 */
  const handleSave = async () => {
    if (dialogMode === "create") {
      const result = await createRoleSettings({
        code: roleCode.trim(),
        name: roleName.trim(),
        description: roleDescription,
        permissionCodes: selected,
      });
      if (!result.ok) {
        toast.error(result.message ?? "创建失败");
        return;
      }
      toast.ok("角色已创建");
      setDialogMode(null);
      refresh();
      return;
    }

    if (!editing) return;
    const result = await saveRoleSettings(editing, {
      name: roleName.trim() || editing.name,
      description: roleDescription,
      permissionCodes: selected,
    });
    if (!result.ok) {
      toast.error(result.message ?? "保存失败");
      return;
    }
    toast.ok("角色权限已更新，变更即时生效");
    setDialogMode(null);
    refresh();
  };

  return (
    <>
      <PageHead
        title="角色"
        sub="角色决定用户能做什么：用户可拥有多个角色，权限点按并集计算。系统内置角色不可删除，只能调整其权限集合；变更即时生效，无需重新登录。"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Icon name="plus" />
            新建角色
          </Button>
        }
      />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">角色清单</h2>
          <span className="text-sm text-3">{loading ? "加载中…" : `${roles.length} 个角色`}</span>
        </div>
        <div className="card-body is-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">角色</th>
                  <th scope="col">说明</th>
                  <th scope="col">权限点</th>
                  <th scope="col">类型</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {roles.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">
                        <span className="empty-title">没有角色</span>
                        <span className="empty-body">角色目录读不出来时先检查账号权限。</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  roles.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{role.name}</div>
                        <div className="text-xs text-3 mono">{role.code}</div>
                      </td>
                      <td className="text-sm text-3">{role.description || "—"}</td>
                      <td className="num">{role.permissions.length}</td>
                      <td>
                        {role.isSystem ? (
                          <Badge tone="info">系统内置</Badge>
                        ) : (
                          <Badge tone="neutral">自定义</Badge>
                        )}
                      </td>
                      <td className="col-actions">
                        <Button size="sm" onClick={() => openEditor(role)}>
                          编辑权限
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
        open={dialogMode !== null}
        onClose={() => setDialogMode(null)}
        title={
          dialogMode === "create"
            ? "新建角色"
            : editing
              ? `角色权限 · ${editing.name}`
              : "角色权限"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogMode(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void handleSave()}>
              {dialogMode === "create" ? "创建" : "保存"}
            </Button>
          </>
        }
      >
        {dialogMode === "create" ? (
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <Field
              label="角色编码"
              required
              htmlFor="role-code"
              hint="全局唯一，建议用小写字母加下划线（如 review_lead）。"
            >
              <TextInput
                id="role-code"
                value={roleCode}
                placeholder="review_lead"
                onChange={(event) => setRoleCode(event.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid-2">
          <Field label="角色名称" htmlFor="role-name">
            <TextInput
              id="role-name"
              value={roleName}
              onChange={(event) => setRoleName(event.target.value)}
            />
          </Field>
          <Field label="说明" htmlFor="role-desc">
            <TextInput
              id="role-desc"
              value={roleDescription}
              onChange={(event) => setRoleDescription(event.target.value)}
            />
          </Field>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <span className="field-label">
            权限点（已选 {selected.length} / {permissions.length}）
          </span>
          {modules.map((group) => (
            <div key={group.module} style={{ marginTop: "var(--sp-3)" }}>
              <div className="filter-group-label">{group.module}</div>
              <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                {group.items.map((permission) => {
                  const on = selected.includes(permission.code);
                  return (
                    <button
                      key={permission.code}
                      type="button"
                      className={`chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() =>
                        setSelected((prev) =>
                          prev.includes(permission.code)
                            ? prev.filter((code) => code !== permission.code)
                            : [...prev, permission.code],
                        )
                      }
                    >
                      {permission.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
            权限集合是**整体覆盖**：取消勾选即去掉该权限点。
            变更即时生效，用户下次请求就按新权限判定。
          </p>
        </div>
      </Dialog>
    </>
  );
}
