/* ==========================================================================
   知行测评 · 认证与权限出口
   ========================================================================== */

export {
  PERMISSION_DISPLAY_NAMES,
  ROLE_PERMISSIONS,
  hasPermission,
  permissionDisplayName,
  permissionModule,
  permissionsFor,
  type PermissionPoint,
} from "./permissions";
export {
  authMode,
  useAuth,
  useCan,
  useMustChangePassword,
  type AuthMode,
  type AuthState,
  type AuthUser,
} from "./useAuth";
export {
  ChangePasswordForm,
  type ChangePasswordFormProps,
} from "./ChangePasswordForm";
