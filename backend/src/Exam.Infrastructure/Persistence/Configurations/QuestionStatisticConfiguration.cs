using Exam.Domain.Analytics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>逐题统计读模型。</summary>
public sealed class QuestionStatisticConfiguration : IEntityTypeConfiguration<QuestionStatistic>
{
    public void Configure(EntityTypeBuilder<QuestionStatistic> builder)
    {
        builder.ToTable("question_statistic", AppDbContext.AnalyticsSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.AnsweredCount).HasColumnName("answered_count").IsRequired();
        builder.Property(x => x.CorrectCount).HasColumnName("correct_count").IsRequired();
        builder.Property(x => x.ScoreSum).HasColumnName("score_sum").HasPrecision(10, 2).IsRequired();
        builder.Property(x => x.AverageScore).HasColumnName("average_score").HasPrecision(8, 2);
        builder.Property(x => x.MasteryRate).HasColumnName("mastery_rate").HasPrecision(6, 4);
        builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一场考试一道题一行。
        builder.HasIndex(x => new { x.ExamSessionId, x.QuestionId })
            .HasDatabaseName("uq_question_statistic_session_question")
            .IsUnique();

        builder.HasOne<Exam.Domain.Delivery.ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Exam.Domain.Catalog.Question>()
            .WithMany()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
