using System.Text.Json;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class PaperConfiguration : IEntityTypeConfiguration<Paper>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private static PaperKind ParseKind(string value) =>
        PaperKinds.FromStorage(value)
        ?? throw new InvalidOperationException($"未知试卷形态：{value}。");

    private static PaperStatus ParseStatus(string value) =>
        PaperStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知试卷状态：{value}。");

    private static OrderRule ParseOrderRule(string value) =>
        OrderRules.FromStorage(value)
        ?? throw new InvalidOperationException($"未知题序规则：{value}。");

    private static VariantRule ParseVariantRule(string value) =>
        VariantRules.FromStorage(value)
        ?? throw new InvalidOperationException($"未知卷型规则：{value}。");

    private static AnswerPolicy ParseAnswerPolicy(string value) =>
        AnswerPolicies.FromStorage(value)
        ?? throw new InvalidOperationException($"未知答案公布策略：{value}。");

    public void Configure(EntityTypeBuilder<Paper> builder)
    {
        builder.ToTable("paper", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_paper_kind", "kind IN ('exam','practice')");
            table.HasCheckConstraint("ck_paper_status", "status IN ('draft','published','archived')");
            table.HasCheckConstraint("ck_paper_order_rule", "order_rule IN ('by_type','manual')");
            table.HasCheckConstraint("ck_paper_variant_rule", "variant_rule IN ('standard','small_plum','large_plum')");
            table.HasCheckConstraint("ck_paper_answer_policy", "answer_policy IN ('immediately','after_submit','after_close')");
            table.HasCheckConstraint("ck_paper_duration", "duration_minutes BETWEEN 1 AND 300");
            table.HasCheckConstraint(
                "ck_paper_rules_exclusive",
                "(kind = 'exam' AND exam_rules IS NOT NULL AND practice_rules IS NULL) OR "
                + "(kind = 'practice' AND practice_rules IS NOT NULL AND exam_rules IS NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();

        builder.Property(x => x.Kind)
            .HasConversion(v => v.ToStorage(), v => ParseKind(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Batch).HasMaxLength(200);
        builder.Property(x => x.Description).HasMaxLength(2000);
        builder.Property(x => x.TargetTotalScore)
            .HasColumnName("total_score")
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(8, 2)
            .IsRequired();
        builder.Property(x => x.DurationMinutes).HasColumnName("duration_minutes").IsRequired();
        builder.Property(x => x.PassScore)
            .HasConversion<decimal?>(
                v => v == null ? null : v.Value,
                v => v == null ? null : Score.Paper(v.Value))
            .HasPrecision(8, 2);
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.OrderRule)
            .HasConversion(v => v.ToStorage(), v => ParseOrderRule(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.VariantRule)
            .HasConversion(v => v.ToStorage(), v => ParseVariantRule(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.AnswerPolicy)
            .HasConversion(v => v.ToStorage(), v => ParseAnswerPolicy(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.AllowRetake).HasColumnName("allow_retake").IsRequired();
        builder.Property(x => x.RetakeKeepsBest).HasColumnName("retake_keeps_best").IsRequired();
        builder.Property(x => x.Note);
        builder.Property(x => x.ExamRules)
            .HasColumnName("exam_rules")
            .HasColumnType("jsonb")
            .HasConversion(
                v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
                v => v == null ? null : JsonSerializer.Deserialize<ExamRules>(v, JsonOptions))
            .HasColumnType("jsonb");
        builder.Property(x => x.PracticeRules)
            .HasColumnName("practice_rules")
            .HasColumnType("jsonb")
            .HasConversion(
                v => v == null ? null : JsonSerializer.Serialize(v, JsonOptions),
                v => v == null ? null : JsonSerializer.Deserialize<PracticeRules>(v, JsonOptions))
            .HasColumnType("jsonb");
        builder.Property(x => x.PublishedSnapshotId).HasColumnName("published_snapshot_id");
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => new { x.Kind, x.Status })
            .HasDatabaseName("ix_paper_kind_status")
            .HasFilter("deleted_at IS NULL");

        builder.Property(x => x.PassScore).Metadata.SetValueComparer(new ValueComparer<Score?>(
            (left, right) => (left == null ? 0m : left.Value) == (right == null ? 0m : right.Value),
            score => score == null ? 0 : score.Value.GetHashCode(),
            score => score == null ? null : Score.Paper(score.Value)));

        builder.Property(x => x.TargetTotalScore).Metadata.SetValueComparer(new ValueComparer<Score>(
            (left, right) => (ReferenceEquals(left, null) ? 0m : left!.Value)
                == (ReferenceEquals(right, null) ? 0m : right!.Value),
            score => ReferenceEquals(score, null) ? 0 : score!.Value.GetHashCode(),
            score => Score.Paper(ReferenceEquals(score, null) ? 0m : score!.Value)));

        builder.HasMany(x => x.Items)
            .WithOne()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Paper.Items))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Sections)
            .WithOne()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Paper.Sections))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Tags)
            .WithOne()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Paper.Tags))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class PaperItemConfiguration : IEntityTypeConfiguration<PaperItem>
{
    public void Configure(EntityTypeBuilder<PaperItem> builder)
    {
        builder.ToTable("paper_item", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_paper_item_score", "score >= 0 AND score <= 40");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.Score)
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();
        builder.Property(x => x.SectionId).HasColumnName("section_id");

        builder.Property(x => x.Score).Metadata.SetValueComparer(new ValueComparer<Score>(
            (left, right) => (ReferenceEquals(left, null) ? 0m : left!.Value)
                == (ReferenceEquals(right, null) ? 0m : right!.Value),
            score => ReferenceEquals(score, null) ? 0 : score!.Value.GetHashCode(),
            score => Score.Paper(ReferenceEquals(score, null) ? 0m : score!.Value)));

        builder.HasIndex(x => new { x.PaperId, x.QuestionId })
            .HasDatabaseName("uq_paper_item_question")
            .IsUnique();
        builder.HasIndex(x => new { x.PaperId, x.SortOrder })
            .HasDatabaseName("ix_paper_item_paper_order");
        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_paper_item_question");
    }
}

public sealed class PaperSectionConfiguration : IEntityTypeConfiguration<PaperSection>
{
    public void Configure(EntityTypeBuilder<PaperSection> builder)
    {
        builder.ToTable("paper_section", AppDbContext.AuthoringSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Title).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Instructions).HasMaxLength(2000);
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();

        builder.HasIndex(x => x.PaperId).HasDatabaseName("ix_paper_section_paper");
    }
}

public sealed class PaperTagConfiguration : IEntityTypeConfiguration<PaperTag>
{
    public void Configure(EntityTypeBuilder<PaperTag> builder)
    {
        builder.ToTable("paper_tag", AppDbContext.AuthoringSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.TagId).HasColumnName("tag_id").IsRequired();
        builder.Property(x => x.AssignedAt).IsRequired();

        builder.HasIndex(x => new { x.PaperId, x.TagId })
            .HasDatabaseName("uq_paper_tag")
            .IsUnique();
        builder.HasIndex(x => x.TagId).HasDatabaseName("ix_paper_tag_tag");
    }
}
