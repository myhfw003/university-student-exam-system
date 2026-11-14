using System.Linq.Expressions;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Entities;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence;

/// <summary>
/// 应用数据库上下文。
/// <para>全局软删除过滤器在此统一注册：实现 <see cref="ISoftDeletable"/> 的实体自动排除已删除行。</para>
/// </summary>
public sealed class AppDbContext : DbContext, IUnitOfWork
{
    public const string DefaultSchema = "iam";

    /// <summary>题库与内容上下文所在 Schema。</summary>
    public const string CatalogSchema = "catalog";

    /// <summary>组卷上下文所在 Schema。</summary>
    public const string AuthoringSchema = "authoring";

    /// <summary>考试组织与作答上下文所在 Schema。</summary>
    public const string DeliverySchema = "delivery";

    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options) { }

    public DbSet<User> Users => Set<User>();

    public DbSet<Role> Roles => Set<Role>();

    public DbSet<Permission> Permissions => Set<Permission>();

    public DbSet<UserRole> UserRoles => Set<UserRole>();

    public DbSet<UserTag> UserTags => Set<UserTag>();

    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<SeedMarker> SeedMarkers => Set<SeedMarker>();

    public DbSet<Tag> Tags => Set<Tag>();

    public DbSet<Question> Questions => Set<Question>();

    public DbSet<QuestionOption> QuestionOptions => Set<QuestionOption>();

    public DbSet<QuestionKeypoint> QuestionKeypoints => Set<QuestionKeypoint>();

    public DbSet<QuestionStep> QuestionSteps => Set<QuestionStep>();

    public DbSet<QuestionAttachment> QuestionAttachments => Set<QuestionAttachment>();

    public DbSet<QuestionTag> QuestionTags => Set<QuestionTag>();

    public DbSet<QuestionBank> QuestionBanks => Set<QuestionBank>();

    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();

    public DbSet<ImportRow> ImportRows => Set<ImportRow>();

    public DbSet<Paper> Papers => Set<Paper>();

    public DbSet<PaperItem> PaperItems => Set<PaperItem>();

    public DbSet<PaperSection> PaperSections => Set<PaperSection>();

    public DbSet<PaperTag> PaperTags => Set<PaperTag>();

    public DbSet<PaperSnapshot> PaperSnapshots => Set<PaperSnapshot>();

    public DbSet<SnapshotItem> SnapshotItems => Set<SnapshotItem>();

    public DbSet<ExamSession> ExamSessions => Set<ExamSession>();

    public DbSet<ExamParticipant> ExamParticipants => Set<ExamParticipant>();

    public DbSet<QuestionBankItem> QuestionBankItems => Set<QuestionBankItem>();

    /// <summary>工作单元提交。EF Core 的单次 SaveChanges 本身即一个事务。</summary>
    Task<int> IUnitOfWork.SaveChangesAsync(CancellationToken cancellationToken) =>
        base.SaveChangesAsync(cancellationToken);

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema(DefaultSchema);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        ApplyGlobalSoftDeleteFilter(modelBuilder);
    }

    /// <summary>
    /// 为所有实现 <see cref="ISoftDeletable"/> 的实体注册全局查询过滤器。
    /// 需要取回已删除行时显式使用 IgnoreQueryFilters()。
    /// </summary>
    private static void ApplyGlobalSoftDeleteFilter(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
                     .Where(t => typeof(ISoftDeletable).IsAssignableFrom(t.ClrType))
                     .ToList())
        {
            var parameter = Expression.Parameter(entityType.ClrType, "e");
            var property = Expression.Property(parameter, nameof(ISoftDeletable.DeletedAt));
            var body = Expression.Equal(property, Expression.Constant(null, typeof(DateTimeOffset?)));
            var filter = Expression.Lambda(body, parameter);

            modelBuilder.Entity(entityType.ClrType).HasQueryFilter(filter);
        }
    }
}
