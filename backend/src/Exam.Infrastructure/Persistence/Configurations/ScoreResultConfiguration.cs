using System.Text.Json;
using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ScoreResultConfiguration : IEntityTypeConfiguration<ScoreResult>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<ScoreResult> builder)
    {
        builder.ToTable("score_result", AppDbContext.GradingSchema, table =>
        {
            table.HasCheckConstraint("ck_score_result_method", "method IN ('auto_scored','auto_suggested','manual_scored')");
            table.HasCheckConstraint("ck_score_result_status", "status IN ('pending','auto_scored','suggested','final')");
            table.HasCheckConstraint("ck_score_result_score", "score >= 0 AND max_score >= 0");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.PaperItemId).HasColumnName("paper_item_id");
        builder.Property(x => x.Score)
            .HasColumnName("score")
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.MaxScore)
            .HasColumnName("max_score")
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.Method)
            .HasConversion(v => v.ToStorage(), v => ParseMethod(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Detail)
            .HasColumnName("detail")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<ScoringDetail>(v, JsonOptions) ?? ScoringDetail.Empty)
            .IsRequired();
        builder.Property(x => x.ScoredBy).HasColumnName("scored_by");
        builder.Property(x => x.ScoredAt).HasColumnName("scored_at");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一次作答里每道题只有一行当前评分结果。
        builder.HasIndex(x => new { x.AttemptId, x.QuestionId })
            .HasDatabaseName("uq_score_result_attempt_question")
            .IsUnique();
        builder.HasIndex(x => x.AttemptId).HasDatabaseName("ix_score_result_attempt");

        builder.HasOne<Exam.Domain.Delivery.Attempt>()
            .WithMany()
            .HasForeignKey(x => x.AttemptId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static ScoringMethod ParseMethod(string value) =>
        ScoringMethods.FromStorage(value)
        ?? throw new InvalidOperationException($"未知评分方式：{value}。");

    private static ScoringStatus ParseStatus(string value) =>
        ScoringStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知评分状态：{value}。");
}
