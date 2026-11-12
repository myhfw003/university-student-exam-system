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
            // 列名、表名统一使用 snake_case，与数据库设计文档一致
            .UseSnakeCaseNamingConvention();
        });

        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IRoleRepository, RoleRepository>();
        services.AddScoped<IPermissionRepository, PermissionRepository>();
        services.AddScoped<IUserRoleRepository, UserRoleRepository>();
        services.AddScoped<IRolePermissionRepository, RolePermissionRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<IUserPermissionService, UserPermissionService>();
        services.AddScoped<IAuditRecorder, AuditRecorder>();
        services.AddScoped<Seeding.DataSeeder>();
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IPasswordVerifier, Pbkdf2PasswordVerifier>();
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddSingleton<ITokenBlacklist, HybridTokenBlacklist>();

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
