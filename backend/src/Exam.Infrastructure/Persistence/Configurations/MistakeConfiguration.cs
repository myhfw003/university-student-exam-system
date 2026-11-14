using Exam.Domain.Learning;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>错题本。</summary>
public sealed class MistakeConfiguration : IEntityTypeConfiguration<Mistake>
{
    public void Configure(EntityTypeBuilder<Mistake> builder)
    {
        builder.ToTable("mistake", AppDbContext.LearningSchema, table =>
        {
            table.HasCheckConstraint("ck_mistake_source_type", "source_type IN ('exam','practice')");
            table.HasCheckConstraint(
                "ck_mistake_reason",
                "reason IN ('multi_missed','multi_wrong','single_wrong','judge_wrong',"
                + "'short_keypoints_missed','comprehensive_step_missed','unanswered')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.WrongCount).HasColumnName("wrong_count").IsRequired();
        builder.Property(x => x.LastWrongAt).HasColumnName("last_wrong_at").IsRequired();
        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasConversion(v => v.ToStorage(), v => ParseReason(v))
            .HasMaxLength(32)
            .IsRequired();
        builder.Property(x => x.SourceType)
            .HasColumnName("source_type")
            .HasConversion(v => v.ToStorage(), v => ParseSourceType(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.SourceAttemptId).HasColumnName("source_attempt_id");
        builder.Property(x => x.ResolvedAt).HasColumnName("resolved_at");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.UpdatedBy).HasColumnName("updated_by");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一个人同一道题只有一条错题记录。
        builder.HasIndex(x => new { x.UserId, x.QuestionId })
            .HasDatabaseName("uq_mistake_user_question")
            .IsUnique()
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => new { x.UserId, x.WrongCount })
            .HasDatabaseName("ix_mistake_user_wrong");
    }

    private static MistakeReason ParseReason(string value) =>
        MistakeReasons.FromStorage(value)
        ?? throw new InvalidOperationException($"未知错因：{value}。");

    private static MistakeSourceType ParseSourceType(string value) =>
        MistakeSourceTypes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知错题来源：{value}。");
}
