using Exam.Application.Authoring.Services;
using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Services;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.Caching;
using Exam.Infrastructure.Configuration;
using Exam.Infrastructure.Identity;
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
            .AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>())
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
        services.AddScoped<BlueprintPoolBuilder>();
        services.AddSingleton<IQuestionFileParser, QuestionFileParser>();
        services.AddScoped<IUserPermissionService, UserPermissionService>();
        services.AddScoped<Exam.Application.Identity.Services.UserOrganizationResolver, Exam.Application.Identity.Services.UserOrganizationResolver>();
        services.AddScoped<Exam.Application.Catalog.Services.OrganizationTagProvisioner, Exam.Application.Catalog.Services.OrganizationTagProvisioner>();
        services.AddScoped<Exam.Application.Catalog.Services.QuestionImportRowProcessor, Exam.Application.Catalog.Services.QuestionImportRowProcessor>();
        services.AddScoped<IAuditRecorder, AuditRecorder>();
        services.AddScoped<IAuditLogRepository, AuditLogRepository>();
        services.AddScoped<Audit.AuditSaveChangesInterceptor>();
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
