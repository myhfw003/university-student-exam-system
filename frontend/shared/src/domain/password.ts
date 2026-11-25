/* ==========================================================================
   知行测评 · 密码强度规则（共享层）
   --------------------------------------------------------------------------
   与后端 `Exam.Domain.Identity.PasswordPolicy` **一一对应**：
   最少 8 位、最多 128 位、必须同时含 ASCII 字母与数字、不能包含账号本身。
   两边的常量由 `scripts/check-roster-password-policy.py` 比对，漂了 CI 就红。
   ========================================================================== */

/** 密码最短长度（后端 PasswordPolicy.MinLength）。 */
export const PASSWORD_MIN_LENGTH = 8;

/** 密码最长长度（后端 PasswordPolicy.MaxLength）。 */
export const PASSWORD_MAX_LENGTH = 128;

/** 密码不合规的原因。 */
export type PasswordViolation =
  | "too_short"
  | "too_long"
  | "need_letter"
  | "need_digit"
  | "contains_username";

/**
 * 列出密码不合规之处；空数组表示通过。
 *
 * @param password 待校验的明文密码
 * @param username 账号；给了就一并检查「不能包含账号」
 */
export function passwordPolicyViolations(
  password: string,
  username = "",
): PasswordViolation[] {
  const failures: PasswordViolation[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) failures.push("too_short");
  if (password.length > PASSWORD_MAX_LENGTH) failures.push("too_long");
  if (!/[A-Za-z]/.test(password)) failures.push("need_letter");
  if (!/[0-9]/.test(password)) failures.push("need_digit");
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    failures.push("contains_username");
  }

  return failures;
}

/**
 * 把违规原因翻成人话（**不含主体名**，便于拼成一句）。
 */
export function describePasswordViolation(violation: PasswordViolation): string {
  switch (violation) {
    case "too_short":
      return `至少 ${PASSWORD_MIN_LENGTH} 位`;
    case "too_long":
      return `最多 ${PASSWORD_MAX_LENGTH} 位`;
    case "need_letter":
      return "需包含字母";
    case "need_digit":
      return "需包含数字";
    case "contains_username":
      return "不能包含账号";
  }
}

/**
 * 把违规原因拼成一句人话。主体名只出现一次。
 *
 * @param subject 主体名，如「初始密码」「新密码」
 */
export function describePasswordViolations(
  violations: PasswordViolation[],
  subject = "密码",
): string {
  return `${subject}${violations.map(describePasswordViolation).join("、")}`;
}
