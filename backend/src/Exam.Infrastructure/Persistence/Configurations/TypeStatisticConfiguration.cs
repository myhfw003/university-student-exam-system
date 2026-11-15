using Exam.Domain.Analytics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>题型统计读模型。</summary>
public sealed class TypeStatisticConfiguration : IEntityTypeConfiguration<TypeStatistic>
{
    public void Configure(EntityTypeBuilder<TypeStatistic> builder)
    {
        builder.ToTable("type_statistic", AppDbContext.AnalyticsSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.QuestionType).HasColumnName("question_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.AnsweredCount).HasColumnName("answered_count").IsRequired();
        builder.Property(x => x.AverageScore).HasColumnName("average_score").HasPrecision(8, 2);
        builder.Property(x => x.ScoreRate).HasColumnName("score_rate").HasPrecision(6, 4);
        builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一场考试一个题型一行。
        builder.HasIndex(x => new { x.ExamSessionId, x.QuestionType })
            .HasDatabaseName("uq_type_statistic_session_type")
            .IsUnique();

        builder.HasOne<Exam.Domain.Delivery.ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
