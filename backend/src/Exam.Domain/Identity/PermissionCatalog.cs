namespace Exam.Domain.Identity;

/// <summary>
/// 全量权限码目录。权限点采用 <c>模块:动作</c> 形式，由常量固化，防止拼写错误。
/// </summary>
public static class PermissionCatalog
{
    public const string QuestionRead = "question:read";
    public const string QuestionWrite = "question:write";
    public const string QuestionPublish = "question:publish";

    public const string TagRead = "tag:read";
    public const string TagWrite = "tag:write";

    public const string BankRead = "bank:read";
    public const string BankWrite = "bank:write";

    public const string ImportRun = "import:run";
    public const string ImportAdopt = "import:adopt";

    public const string AiGenerate = "ai:generate";

    public const string PaperRead = "paper:read";
    public const string PaperWrite = "paper:write";
    public const string PaperPublish = "paper:publish";

    public const string BlueprintGenerate = "blueprint:generate";

    public const string PracticeRead = "practice:read";
    public const string PracticeWrite = "practice:write";

    public const string ExamRead = "exam:read";
    public const string ExamWrite = "exam:write";
    public const string ExamPublish = "exam:publish";

    public const string AttemptTake = "attempt:take";
    public const string AttemptReadOwn = "attempt:read-own";
    public const string AttemptReadAll = "attempt:read-all";

    public const string ReviewGrade = "review:grade";
    public const string ReviewBatchAdopt = "review:batch-adopt";

    public const string GradePublish = "grade:publish";

    public const string ProctorMonitor = "proctor:monitor";
    public const string ProctorAct = "proctor:act";

    public const string UserRead = "user:read";
    public const string UserWrite = "user:write";
    public const string UserImport = "user:import";
    public const string UserTagAssign = "user-tag:assign";

    public const string RoleRead = "role:read";
    public const string RoleWrite = "role:write";

    public const string AnalyticsRead = "analytics:read";

    public const string AuditRead = "audit:read";

    public const string SystemConfigure = "system:configure";

    /// <summary>全部权限码。</summary>
    public static IReadOnlyList<string> All { get; } =
    [
        QuestionRead, QuestionWrite, QuestionPublish,
        TagRead, TagWrite,
        BankRead, BankWrite,
        ImportRun, ImportAdopt,
        AiGenerate,
        PaperRead, PaperWrite, PaperPublish,
        BlueprintGenerate,
        PracticeRead, PracticeWrite,
        ExamRead, ExamWrite, ExamPublish,
        AttemptTake, AttemptReadOwn, AttemptReadAll,
        ReviewGrade, ReviewBatchAdopt,
        GradePublish,
        ProctorMonitor, ProctorAct,
        UserRead, UserWrite, UserImport, UserTagAssign,
        RoleRead, RoleWrite,
        AnalyticsRead,
        AuditRead,
        SystemConfigure,
    ];

    /// <summary>与系统角色对应的默认权限集合。</summary>
    public static IReadOnlyDictionary<string, string[]> DefaultRolePermissions { get; } =
        new Dictionary<string, string[]>
        {
            [Role.Codes.SystemAdmin] = [.. All],
            [Role.Codes.ContentAdmin] =
            [
                QuestionRead, QuestionWrite, QuestionPublish,
                TagRead, TagWrite,
                BankRead, BankWrite,
                ImportRun, ImportAdopt,
                AiGenerate,
                PaperRead, PaperWrite, PaperPublish,
                BlueprintGenerate,
                PracticeRead, PracticeWrite,
                ExamRead, ExamWrite, ExamPublish,
                AttemptTake, AttemptReadOwn, AttemptReadAll,
                ReviewGrade, ReviewBatchAdopt,
                GradePublish,
                ProctorMonitor, ProctorAct,
                UserRead, UserWrite, UserImport, UserTagAssign,
                AnalyticsRead,
            ],
            [Role.Codes.AuthorTeacher] =
            [
                QuestionRead, QuestionWrite, QuestionPublish,
                TagRead, TagWrite,
                BankRead, BankWrite,
                ImportRun, ImportAdopt,
                AiGenerate,
                PaperRead, PaperWrite, PaperPublish,
                BlueprintGenerate,
                PracticeRead, PracticeWrite,
                // 出题教师能发布考试（需求文档 §1 的权限矩阵：
                // exam:read / exam:write / exam:publish 三个都给出题教师）。
                // 少了这一条，出题教师组好卷、建好场次却卡在「发布」上。
                ExamRead, ExamWrite, ExamPublish,
                AttemptTake, AttemptReadOwn,
                AnalyticsRead,
                UserTagAssign,
            ],
            [Role.Codes.GraderTeacher] =
            [
                QuestionRead, TagRead, BankRead, PaperRead,
                ExamRead,
                AttemptTake, AttemptReadOwn, AttemptReadAll,
                ReviewGrade, ReviewBatchAdopt,
                ProctorMonitor, ProctorAct,
                AnalyticsRead,
            ],
            [Role.Codes.Student] =
            [
                // 学生不进题库：练习与考试的内容从自己的作答卷面拿，
                // 题库里连题干带答案都读不到。
                TagRead, PaperRead,
                // 学生要能看到自己的考试场次（只读，且只看得到与自己相关的）。
                ExamRead,
                AttemptTake, AttemptReadOwn,
            ],
            [Role.Codes.GeneralUser] =
            [
                QuestionRead, TagRead, PaperRead,
                AttemptTake, AttemptReadOwn,
            ],
        };

    public static IReadOnlyDictionary<string, string> DisplayNames { get; } =
        new Dictionary<string, string>
        {
            [QuestionRead] = "查看题目",
            [QuestionWrite] = "编辑题目",
            [QuestionPublish] = "发布题目",
            [TagRead] = "查看标签",
            [TagWrite] = "编辑标签",
            [BankRead] = "查看题库",
            [BankWrite] = "编辑题库",
            [ImportRun] = "导入试题",
            [ImportAdopt] = "采纳试题",
            [AiGenerate] = "AI 生成试题",
            [PaperRead] = "查看试卷",
            [PaperWrite] = "编辑试卷",
            [PaperPublish] = "发布试卷",
            [BlueprintGenerate] = "生成组卷方案",
            [PracticeRead] = "查看练习",
            [PracticeWrite] = "管理练习",
            [ExamRead] = "查看考试",
            [ExamWrite] = "编辑考试",
            [ExamPublish] = "发布考试",
            [AttemptTake] = "参加考试",
            [AttemptReadOwn] = "查看自己的作答",
            [AttemptReadAll] = "查看全部作答",
            [ReviewGrade] = "人工阅卷",
            [ReviewBatchAdopt] = "批量采纳初判",
            [GradePublish] = "发布成绩",
            [ProctorMonitor] = "实时监考",
            [ProctorAct] = "监考处置",
            [UserRead] = "查看用户",
            [UserWrite] = "编辑用户",
            [UserImport] = "导入用户",
            [UserTagAssign] = "分配用户标签",
            [RoleRead] = "查看角色",
            [RoleWrite] = "编辑角色",
            [AnalyticsRead] = "查看统计分析",
            [AuditRead] = "查看审计日志",
            [SystemConfigure] = "系统配置",
        };
}
