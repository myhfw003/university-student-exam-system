/* ==========================================================================
   审计动作码与中文名
   --------------------------------------------------------------------------
   动作码是**前后端共用的一套词**：后端写审计行时用它，前端用它显示中文名
   与提供筛选项。两边对不上就会出现「审计页上一半的动作显示成一串原始码、
   筛选项里又选不到它们」的老毛病。

   这份清单由 `scripts/check-audit-action-codes.py` 守着：后端新增了动作码
   而前端没跟上时，CI 直接失败。

   后端的审计行有两类：
   1. 显式业务动作（`IAuditRecorder` 的调用点写出来的），共 69 个，逐个登记；
   2. EF 拦截器写的**实体字段自动留痕**，动作码是
      `entity.<实体类型>.updated|deleted`，实体类型是运行期拼出来的——
      列不出全部，只能按前缀匹配，因此这类动作码不在联合类型里。
   ========================================================================== */

import type { AuditAction } from "./types";

/** 审计动作中文名（显式业务动作，逐个登记）。 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  "auth.login": "登录成功",
  "auth.login_failed": "登录失败",
  "auth.refresh_reuse": "刷新令牌异常使用",
  "auth.logout": "登出",
  "tag.create": "新建标签",
  "user.create": "新建用户",
  "user.update": "修改用户",
  "user.assign-roles": "变更角色",
  "user.revoke-role": "撤销角色",
  "user.assign-tags": "变更用户标签",
  "user.change-password": "修改本人密码",
  "user.reset-password": "重置用户密码",
  "user.import-roster": "导入人员名单",
  "role.create": "新建角色",
  "role.update": "修改角色",
  "question.create": "新建题目",
  "question.update": "修改题目",
  "question.publish": "发布题目",
  "question.disable": "停用题目",
  "question.delete": "删除题目",
  "question.restore": "恢复题目",
  "question.batch-status": "批量改题目状态",
  "question.upload-attachment": "上传题目附件",
  "question-bank.create": "新建题库",
  "question-bank.update": "修改题库",
  "question-bank.delete": "删除题库",
  "question-bank.add-items": "题库加入题目",
  "question-bank.remove-items": "题库移除题目",
  "paper.create": "新建试卷",
  "paper.update": "修改试卷",
  "paper.update-item": "修改试卷题目",
  "paper.add-item": "试卷加入题目",
  "paper.remove-item": "试卷移除题目",
  "paper.replace-items": "试卷替换题目",
  "paper.publish": "发布试卷",
  "paper.unpublish": "撤回试卷",
  "paper.archive": "归档试卷",
  "paper.delete": "删除试卷",
  "paper_template.create": "新建试卷模板",
  "paper_template.apply": "应用试卷模板",
  "blueprint.generate": "规则生成",
  "blueprint.save": "保存组卷蓝图",
  "import.upload": "上传导入文件",
  "import.adopt": "采纳导入内容",
  "ai.generate": "AI 生成试题",
  "exam_session.create": "新建场次",
  "exam_session.update": "修改场次",
  "exam_session.publish": "发布场次",
  "exam_session.close": "关闭场次",
  "exam_session.cancel": "取消场次",
  "exam_session.set_participants": "设置场次名单",
  "exam_session.import_participants": "导入场次名单",
  "exam_session.set_assignments": "指派负责教师",
  "exam_session.publish_grades": "发布成绩",
  "proctor_action.create": "监考处置",
  "review_task.assign": "指派阅卷任务",
  "review_task.claim": "领取阅卷任务",
  "review_task.grade": "阅卷打分",
  "review_task.batch_adopt": "批量采纳阅卷",
  "practice_assignment.create": "新建练习",
  "practice_assignment.update": "修改练习",
  "practice_assignment.publish": "发布练习",
  "practice_assignment.archive": "归档练习",
  "mistake.redo": "重做错题",
  "mistake.resolve": "标记已掌握",
  "attempt.submit": "交卷",
  "attempt.submit_by_timeout": "超时自动交卷",
  "attempt.force_submit_by_proctor": "监考强制交卷",
  "attempt.force_submit_by_focus": "切屏强制交卷",
  "attempt.reconciliation_failed": "对账失败",
  "settings.update": "修改系统设置",
  "settings.original_password": "设置原始密码",
  "settings.original_password_clear": "清除原始密码",
};

/**
 * 实体类型中文名（EF 拦截器的自动留痕用）。
 *
 * 键是实体类名的小写形式——后端那边就是 `GetType().Name.ToLowerInvariant()`，
 * 所以两边对不上时 CI 会报出来。
 */
export const AUDIT_ENTITY_TYPE_LABEL: Record<string, string> = {
  user: "用户",
  role: "角色",
  tag: "标签",
  question: "题目",
  questionbank: "题库",
  paper: "试卷",
  papertemplate: "试卷模板",
  blueprint: "组卷蓝图",
  examsession: "考试场次",
  examsessionassignment: "场次教师指派",
  examparticipant: "考生名单",
  attempt: "作答",
  proctoraction: "监考处置",
  reviewtask: "阅卷任务",
  scoreresult: "成绩",
  gradepublication: "成绩发布",
  importbatch: "导入批次",
  practiceassignment: "练习",
  mistake: "错题",
  abilityprofile: "能力画像",
};

/** 动作码前缀 → 业务分组名（筛选下拉按组展示）。 */
const GROUP_BY_PREFIX: Record<string, string> = {
  auth: "账号与权限",
  user: "账号与权限",
  role: "账号与权限",
  tag: "题目与题库",
  question: "题目与题库",
  "question-bank": "题目与题库",
  paper: "试卷与组卷",
  paper_template: "试卷与组卷",
  blueprint: "试卷与组卷",
  import: "数据导入",
  ai: "题目与题库",
  exam_session: "场次与考试",
  attempt: "场次与考试",
  proctor_action: "监考与阅卷",
  review_task: "监考与阅卷",
  practice_assignment: "练习与错题",
  mistake: "练习与错题",
  settings: "系统设置",
};

/** 动作码没登记过分组时落到的组（不该出现，测试会盯住）。 */
const FALLBACK_GROUP = "其他";

/** 审计动作所属业务分组。 */
export function auditActionGroupOf(code: AuditAction): string {
  const prefix = code.split(".")[0] ?? "";
  return GROUP_BY_PREFIX[prefix] ?? FALLBACK_GROUP;
}

/** 一个业务分组下的动作。 */
export interface AuditActionGroup {
  /** 分组名。 */
  label: string;
  /** 该组下的动作码。 */
  actions: AuditAction[];
}

/**
 * 按业务域分组的动作清单（筛选下拉用）。
 *
 * 69 个动作塞进一排分段按钮里没法用，所以下拉按业务域分组。
 */
export const AUDIT_ACTION_GROUPS: AuditActionGroup[] = (() => {
  const groups = new Map<string, AuditAction[]>();
  for (const code of Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]) {
    const label = auditActionGroupOf(code);
    const bucket = groups.get(label);
    if (bucket) bucket.push(code);
    else groups.set(label, [code]);
  }
  return [...groups].map(([label, actions]) => ({ label, actions }));
})();

/** 实体字段自动留痕的动作码：`entity.<实体类型>.updated|deleted`。 */
const ENTITY_ACTION = /^entity\.([a-z0-9]+)\.(updated|deleted)$/;

/**
 * 动作码 → 中文名。
 *
 * 没登记过的动作原样返回动作码——不能显示成空白。
 */
export function auditActionLabel(code: string): string {
  const known = AUDIT_ACTION_LABEL[code as AuditAction];
  if (known) return known;

  const match = ENTITY_ACTION.exec(code);
  if (match) {
    const type = match[1] ?? "";
    const name = AUDIT_ENTITY_TYPE_LABEL[type] ?? type;
    return match[2] === "deleted" ? `自动留痕：删除${name}` : `自动留痕：更新${name}`;
  }

  return code;
}
