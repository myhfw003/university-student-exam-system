/* ==========================================================================
   知行测评 · 认证与权限出口
   ========================================================================== */

export {
  ROLE_PERMISSIONS,
  hasPermission,
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
