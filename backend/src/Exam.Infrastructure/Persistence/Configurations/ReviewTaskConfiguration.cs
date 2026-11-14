using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ReviewTaskConfiguration : IEntityTypeConfiguration<ReviewTask>
{
    public void Configure(EntityTypeBuilder<ReviewTask> builder)
    {
        builder.ToTable("review_task", AppDbContext.GradingSchema, table =>
        {
            table.HasCheckConstraint("ck_review_task_status", "status IN ('pending','in_review','reviewed')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id");
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.StepCode).HasColumnName("step_code").HasMaxLength(64);
        builder.Property(x => x.AnswerText).HasColumnName("answer_text").IsRequired();
        builder.Property(x => x.SuggestedScore)
            .HasColumnName("suggested_score")
            .HasConversion<decimal?>(
                v => v == null ? null : v.Value,
                v => v == null ? null : Score.Paper(v.Value))
            .HasPrecision(6, 2);
        builder.Property(x => x.MaxScore)
            .HasColumnName("max_score")
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.AssigneeId).HasColumnName("assignee_id");
        builder.Property(x => x.ReviewerId).HasColumnName("reviewer_id");
        builder.Property(x => x.FinalScore)
            .HasColumnName("final_score")
            .HasConversion<decimal?>(
                v => v == null ? null : v.Value,
                v => v == null ? null : Score.Paper(v.Value))
            .HasPrecision(6, 2);
        builder.Property(x => x.Comment);
        builder.Property(x => x.ReviewedAt).HasColumnName("reviewed_at");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => new { x.Status, x.CreatedAt })
            .HasDatabaseName("ix_review_task_status");
        builder.HasIndex(x => x.AttemptId).HasDatabaseName("ix_review_task_attempt");
        builder.HasIndex(x => new { x.ExamSessionId, x.Status })
            .HasDatabaseName("ix_review_task_exam");

        builder.HasOne<Exam.Domain.Delivery.Attempt>()
            .WithMany()
            .HasForeignKey(x => x.AttemptId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static ReviewTaskStatus ParseStatus(string value) =>
        ReviewTaskStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知阅卷任务状态：{value}。");
}
