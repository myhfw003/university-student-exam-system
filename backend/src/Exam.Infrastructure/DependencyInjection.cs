using Exam.Application.Authoring.Services;
using Exam.Application.Delivery.Services;
using Exam.Application.Common.Interfaces;
using Exam.Application.Grading.Services;
using Exam.Application.Learning.Services;
using Exam.Application.Messaging;
using Exam.Domain.Grading.Events;
using Exam.Application.Identity.Services;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.Caching;
using Exam.Infrastructure.Configuration;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Messaging;
using Exam.Infrastructure.Persistence;
using Exam.Infrastructure.Persistence.Repositories;
using Exam.Infrastructure.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

namespace Exam.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddExamInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var jwtSection = configuration.GetSection(JwtOptions.SectionName);
        services.Configure<JwtOptions>(jwtSection);
        services.AddOptions<JwtOptions>()
            .Bind(jwtSection)
            .Validate(o => !string.IsNullOrWhiteSpace(o.Issuer), "Jwt:Issuer 必须配置。")
            .Validate(o => !string.IsNullOrWhiteSpace(o.Audience), "Jwt:Audience 必须配置。")
            .Validate(o => o.AccessTokenMinutes > 0, "Jwt:AccessTokenMinutes 必须大于 0。")
            .ValidateOnStart();

        services.AddDbContext<AppDbContext>((sp, options) =>
        {
            var connectionString = configuration.GetConnectionString("Database")
                ?? throw new InvalidOperationException("缺少连接串 ConnectionStrings:Database。");

            options.UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsAssembly(typeof(AppDbContext).Assembly.FullName);
            })
            // 实体字段变更的自动留痕
            .AddInterceptors(
                sp.GetRequiredService<AuditSaveChangesInterceptor>(),
                sp.GetRequiredService<OutboxSaveChangesInterceptor>())
            // 列名、表名统一使用 snake_case，与数据库设计文档一致
            .UseSnakeCaseNamingConvention();
        });

        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IRoleRepository, RoleRepository>();
        services.AddScoped<IPermissionRepository, PermissionRepository>();
        services.AddScoped<IUserRoleRepository, UserRoleRepository>();
        services.AddScoped<IUserTagRepository, UserTagRepository>();
        services.AddScoped<IRolePermissionRepository, RolePermissionRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<ITagRepository, TagRepository>();
        services.AddScoped<IQuestionRepository, QuestionRepository>();
        services.AddScoped<IQuestionBankRepository, QuestionBankRepository>();
        services.AddScoped<IImportBatchRepository, ImportBatchRepository>();
        services.AddScoped<IPaperRepository, PaperRepository>();
        services.AddScoped<IPaperSnapshotRepository, PaperSnapshotRepository>();
        services.AddScoped<IBlueprintRepository, BlueprintRepository>();
        services.AddScoped<IPaperTemplateRepository, PaperTemplateRepository>();
        services.AddScoped<IExamSessionRepository, ExamSessionRepository>();
        services.AddScoped<IExamParticipantRepository, ExamParticipantRepository>();
        services.AddScoped<IExamSessionAssignmentRepository, ExamSessionAssignmentRepository>();
        services.AddScoped<ExamRosterBuilder>();
        services.AddScoped<IAttemptRepository, AttemptRepository>();
        services.AddScoped<IAnswerRepository, AnswerRepository>();
        services.AddScoped<IAnswerRevisionRepository, AnswerRevisionRepository>();
        services.AddScoped<IFocusEventRepository, FocusEventRepository>();
        services.AddScoped<IProctorActionRepository, ProctorActionRepository>();
        services.AddScoped<IScoreResultRepository, ScoreResultRepository>();
        services.AddScoped<IReviewTaskRepository, ReviewTaskRepository>();
        services.AddScoped<IGradeRevisionRepository, GradeRevisionRepository>();
        services.AddScoped<IGradePublicationRepository, GradePublicationRepository>();
        services.AddScoped<IMistakeRepository, MistakeRepository>();
        services.AddScoped<IPracticeAssignmentRepository, PracticeAssignmentRepository>();
        services.AddScoped<IAbilityProfileRepository, AbilityProfileRepository>();
        services.AddScoped<IExamStatisticRepository, ExamStatisticRepository>();
        services.AddScoped<ISystemSettingRepository, SystemSettingRepository>();
        // 系统级设置：取值与回退收在一处，业务代码不直接查设置表。
        services.AddScoped<Exam.Application.Settings.Services.SystemSettingsResolver>();
        // 「已掌握」按系统级设置处理：移出，还是保留但标记已掌握。
        services.AddScoped<Exam.Application.Learning.Services.MistakeResolutionService>();
        services.AddScoped<IExamStatisticSource, ExamStatisticSource>();
        services.AddScoped<Exam.Application.Analytics.Services.ExamStatisticsService>();
        services.AddScoped<Exam.Application.Learning.Services.PracticeVisibilityResolver>();
        services.AddScoped<Exam.Application.Learning.Services.PracticeRulesResolver>();
        services.AddScoped<Exam.Application.Learning.Services.PracticeAssignmentService>();
        services.AddScoped<Exam.Application.Delivery.Services.AnswerReconciler>();
        // 对象级可见范围：谁能看哪些场次、哪些卷子、哪些作答。
        services.AddScoped<Exam.Application.Delivery.Services.ExamAccessScope>();
        // 快照不可变，缓存住：开考瞬间 1000 人进考场读的是同一份。
        services.AddSingleton<Exam.Application.Authoring.Services.PaperSnapshotCache>();
        services.AddScoped<Exam.Application.Learning.Services.DashboardService>();
        services.AddScoped<IDomainEventHandler<ScoreFinalized>, AbilityProfileUpdateHandler>();
        services.AddScoped<AttemptPaperResolver>();
        // 交卷收尾（判分 + 待阅任务 + 审计）：四条交卷路径共用。
        services.AddScoped<AttemptFinalizationService>();
        services.AddScoped<IOutboxStore, OutboxStore>();
        services.AddScoped<IDomainEventDispatcher, DomainEventDispatcher>();
        services.AddScoped<IDomainEventHandler<ScoreFinalized>, MistakeWriteBackHandler>();
        services.AddScoped<GradeVisibilityResolver, GradeVisibilityResolver>();
        services.AddScoped<AttemptPaperSurfaceBuilder>();
        services.AddScoped<ExamMonitoringService>();
        services.AddScoped<AttemptScoringService>();
        services.AddScoped<Exam.Application.Grading.Services.ReviewTaskGenerator>();
        services.AddScoped<BlueprintPoolBuilder>();
        services.AddSingleton<IQuestionFileParser, QuestionFileParser>();
        services.AddScoped<IUserPermissionService, UserPermissionService>();
        services.AddScoped<Exam.Application.Identity.Services.UserOrganizationResolver, Exam.Application.Identity.Services.UserOrganizationResolver>();
        services.AddScoped<Exam.Application.Catalog.Services.OrganizationTagProvisioner, Exam.Application.Catalog.Services.OrganizationTagProvisioner>();
        services.AddScoped<Exam.Application.Catalog.Services.QuestionImportRowProcessor, Exam.Application.Catalog.Services.QuestionImportRowProcessor>();
        services.AddScoped<IAuditRecorder, AuditRecorder>();
        services.AddScoped<IAuditLogRepository, AuditLogRepository>();
        services.AddScoped<Audit.AuditSaveChangesInterceptor>();
        services.AddScoped<OutboxSaveChangesInterceptor>();
        services.AddScoped<Seeding.DataSeeder>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IPasswordVerifier, Pbkdf2PasswordVerifier>();

        var storageSection = configuration.GetSection(ObjectStorageOptions.SectionName);
        services.Configure<ObjectStorageOptions>(storageSection);
        services.AddOptions<ObjectStorageOptions>()
            .Bind(storageSection)
            .Validate(o => !o.Enabled || !string.IsNullOrWhiteSpace(o.Endpoint), "ObjectStorage:Endpoint 必须配置。")
            .Validate(o => !o.Enabled || !string.IsNullOrWhiteSpace(o.AccessKey), "ObjectStorage:AccessKey 必须配置。")
            .Validate(o => !o.Enabled || !string.IsNullOrWhiteSpace(o.SecretKey), "ObjectStorage:SecretKey 必须配置。")
            .ValidateOnStart();
        services.AddSingleton<IObjectStorage, Storage.MinioObjectStorage>();
        services.AddSingleton<IUserRosterParser, UserRosterCsvParser>();
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddSingleton<RedisCacheNamespace>();
        services.AddSingleton<ITokenBlacklist, HybridTokenBlacklist>();
        services.AddSingleton<IPermissionProvider, CachedPermissionProvider>();

        services.AddSingleton(sp =>
        {
            var connectionString = configuration.GetConnectionString("Database")
                ?? throw new InvalidOperationException("缺少连接串 ConnectionStrings:Database。");
            return new Npgsql.NpgsqlDataSourceBuilder(connectionString).Build();
        });

        services.AddSingleton<IConnectionMultiplexer>(sp =>
        {
            var configurationOptions = ConfigurationOptions.Parse(
                configuration.GetConnectionString("Redis") ?? "localhost:6379");
            configurationOptions.AbortOnConnectFail = false;
            configurationOptions.ConnectRetry = 2;
            configurationOptions.ConnectTimeout = 3000;
            return ConnectionMultiplexer.Connect(configurationOptions);
        });

        return services;
    }
}
