using System.Text.Json;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class PaperSnapshotConfiguration : IEntityTypeConfiguration<PaperSnapshot>
{
    public void Configure(EntityTypeBuilder<PaperSnapshot> builder)
    {
        builder.ToTable("paper_snapshot", AppDbContext.AuthoringSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.PaperId).HasColumnName("paper_id").IsRequired();
        builder.Property(x => x.SnapshotVersion).HasColumnName("version").IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(128).IsRequired();
        builder.Property(x => x.AnswerPolicy)
            .HasColumnName("answer_policy")
            .HasConversion(v => v.ToStorage(), v => ParseAnswerPolicy(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => new { x.PaperId, x.SnapshotVersion })
            .HasDatabaseName("uq_snapshot_paper_version")
            .IsUnique();

        builder.HasOne<Paper>()
            .WithMany()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(x => x.Items)
            .WithOne()
            .HasForeignKey(x => x.SnapshotId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(PaperSnapshot.Items))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }

    private static AnswerPolicy ParseAnswerPolicy(string value) =>
        Exam.Domain.Authoring.AnswerPolicies.FromStorage(value)
        ?? throw new InvalidOperationException($"未知答案公布策略：{value}。");
}

public sealed class SnapshotItemConfiguration : IEntityTypeConfiguration<SnapshotItem>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<SnapshotItem> builder)
    {
        builder.ToTable("snapshot_item", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_snapshot_item_score", "score >= 0 AND score <= 40");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.SnapshotId).HasColumnName("snapshot_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.QuestionCode).HasColumnName("question_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.QuestionType).HasColumnName("question_type").HasMaxLength(20).IsRequired();
        builder.Property(x => x.Stem).IsRequired();
        builder.Property(x => x.Options)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<SnapshotOption>>(v, JsonOptions) ?? new List<SnapshotOption>())
            .IsRequired();
        builder.Property(x => x.CorrectKeys)
            .HasColumnType("text[]")
            .IsRequired();
        builder.Property(x => x.Keypoints)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<SnapshotKeypoint>>(v, JsonOptions) ?? new List<SnapshotKeypoint>())
            .IsRequired();
        builder.Property(x => x.Steps)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<SnapshotStep>>(v, JsonOptions) ?? new List<SnapshotStep>())
            .IsRequired();
        builder.Property(x => x.Analysis);
        builder.Property(x => x.ReferenceAnswer).HasColumnName("reference_answer");
        builder.Property(x => x.Attachments)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<SnapshotAttachment>>(v, JsonOptions) ?? new List<SnapshotAttachment>())
            .IsRequired();
        builder.Property(x => x.Score)
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();
        builder.Property(x => x.SectionTitle).HasColumnName("section_title").HasMaxLength(200);
        builder.Property(x => x.CreatedAt).IsRequired();

        builder.HasIndex(x => new { x.SnapshotId, x.SortOrder })
            .HasDatabaseName("ix_snapshot_item_snapshot");
    }
}
