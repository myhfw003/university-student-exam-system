using System.Text.Json;
using Exam.Domain.Analytics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>场次级统计读模型。</summary>
public sealed class ExamStatisticConfiguration : IEntityTypeConfiguration<ExamStatistic>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<ExamStatistic> builder)
    {
        builder.ToTable("exam_statistic", AppDbContext.AnalyticsSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.ParticipantCount).HasColumnName("participant_count").IsRequired();
        builder.Property(x => x.SubmittedCount).HasColumnName("submitted_count").IsRequired();
        builder.Property(x => x.AbsentCount).HasColumnName("absent_count").IsRequired();
        builder.Property(x => x.AverageScore).HasColumnName("average_score").HasPrecision(8, 2);
        builder.Property(x => x.MaxScore).HasColumnName("max_score").HasPrecision(8, 2);
        builder.Property(x => x.MinScore).HasColumnName("min_score").HasPrecision(8, 2);
        builder.Property(x => x.PassRate).HasColumnName("pass_rate").HasPrecision(6, 4);
        builder.Property(x => x.ExcellentRate).HasColumnName("excellent_rate").HasPrecision(6, 4);
        builder.Property(x => x.ScoreBuckets)
            .HasColumnName("score_buckets")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<Dictionary<string, int>>(v, JsonOptions) ?? new Dictionary<string, int>())
            .IsRequired();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一场考试一行。
        builder.HasIndex(x => x.ExamSessionId)
            .HasDatabaseName("uq_exam_statistic_session")
            .IsUnique();

        builder.HasOne<Exam.Domain.Delivery.ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
