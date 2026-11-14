using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class QuestionConfiguration : IEntityTypeConfiguration<Question>
{
    public void Configure(EntityTypeBuilder<Question> builder)
    {
        builder.ToTable("question", AppDbContext.CatalogSchema, table =>
        {
            table.HasCheckConstraint("ck_question_type", "type IN ('single','multi','judge','short','comprehensive')");
            table.HasCheckConstraint("ck_question_status", "status IN ('draft','published','disabled')");
            table.HasCheckConstraint("ck_question_source", "source IN ('manual','import','generated')");
            table.HasCheckConstraint("ck_question_default_score", "default_score > 0 AND default_score <= 40");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();

        builder.Property(x => x.Code).HasMaxLength(64).IsRequired();
        builder.Property(x => x.Type)
            .HasConversion(v => v.ToStorage(), v => ParseType(v))
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(x => x.Stem).IsRequired();
        builder.Property(x => x.DefaultScore)
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .HasColumnName("default_score")
            .IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Source)
            .HasConversion(v => v.ToStorage(), v => ParseSource(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Analysis);
        builder.Property(x => x.ReferenceAnswer);
        builder.Property(x => x.DifficultyTagId).IsRequired();
        builder.Property(x => x.BatchId);
        builder.Property(x => x.PublishedAt);
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => x.Code)
            .HasDatabaseName("uq_question_code")
            .IsUnique()
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => new { x.Status, x.Type })
            .HasDatabaseName("ix_question_status_type")
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => x.DifficultyTagId)
            .HasDatabaseName("ix_question_difficulty")
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => x.BatchId).HasDatabaseName("ix_question_batch");

        builder.Property(x => x.DefaultScore).Metadata.SetValueComparer(new ValueComparer<Score>(
            (left, right) => ReferenceEquals(left, null)
                ? ReferenceEquals(right, null)
                : left!.Value == right!.Value,
            score => ReferenceEquals(score, null) ? 0 : score!.Value.GetHashCode(),
            score => Score.Paper(ReferenceEquals(score, null) ? 0m : score!.Value)));

        ConfigureChildren(builder);
    }

    private static QuestionType ParseType(string value) =>
        QuestionTypes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知题型：{value}。");

    private static QuestionStatus ParseStatus(string value) =>
        QuestionStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知题目状态：{value}。");

    private static QuestionSource ParseSource(string value) =>
        QuestionSources.FromStorage(value)
        ?? throw new InvalidOperationException($"未知题目来源：{value}。");

    private static void ConfigureChildren(EntityTypeBuilder<Question> builder)
    {
        builder.HasMany(x => x.Options)
            .WithOne()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Question.Options))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Keypoints)
            .WithOne()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Question.Keypoints))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Steps)
            .WithOne()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Question.Steps))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Attachments)
            .WithOne()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Question.Attachments))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasMany(x => x.Tags)
            .WithOne()
            .HasForeignKey(x => x.QuestionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(Question.Tags))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class QuestionOptionConfiguration : IEntityTypeConfiguration<QuestionOption>
{
    public void Configure(EntityTypeBuilder<QuestionOption> builder)
    {
        builder.ToTable("question_option", AppDbContext.CatalogSchema, table =>
        {
            table.HasCheckConstraint("ck_question_option_key", "option_key IN ('A','B','C','D','E','F')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Key).HasColumnName("option_key").HasMaxLength(1).IsRequired();
        builder.Property(x => x.Text).IsRequired();
        builder.Property(x => x.IsCorrect).HasColumnName("is_correct").IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();

        builder.HasIndex(x => new { x.QuestionId, x.Key })
            .HasDatabaseName("uq_question_option_key")
            .IsUnique();
        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_question_option_q");
    }
}

public sealed class QuestionKeypointConfiguration : IEntityTypeConfiguration<QuestionKeypoint>
{
    public void Configure(EntityTypeBuilder<QuestionKeypoint> builder)
    {
        builder.ToTable("question_keypoint", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Text).IsRequired();
        builder.Property(x => x.Keywords).HasColumnType("text[]").IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();

        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_question_keypoint_q");
    }
}

public sealed class QuestionStepConfiguration : IEntityTypeConfiguration<QuestionStep>
{
    public void Configure(EntityTypeBuilder<QuestionStep> builder)
    {
        builder.ToTable("question_step", AppDbContext.CatalogSchema, table =>
        {
            table.HasCheckConstraint("ck_question_step_score", "score > 0");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Code).HasColumnName("step_code").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Prompt).IsRequired();
        builder.Property(x => x.ReferenceAnswer).HasColumnName("reference_answer");
        builder.Property(x => x.Keywords).HasColumnType("text[]").IsRequired();
        builder.Property(x => x.Score)
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();

        builder.Property(x => x.Score).Metadata.SetValueComparer(new ValueComparer<Score>(
            (left, right) => ReferenceEquals(left, null)
                ? ReferenceEquals(right, null)
                : left!.Value == right!.Value,
            score => ReferenceEquals(score, null) ? 0 : score!.Value.GetHashCode(),
            score => Score.Paper(ReferenceEquals(score, null) ? 0m : score!.Value)));

        builder.HasIndex(x => new { x.QuestionId, x.Code })
            .HasDatabaseName("uq_question_step_code")
            .IsUnique();
        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_question_step_q");
    }
}

public sealed class QuestionAttachmentConfiguration : IEntityTypeConfiguration<QuestionAttachment>
{
    public void Configure(EntityTypeBuilder<QuestionAttachment> builder)
    {
        builder.ToTable("question_attachment", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ObjectKey).HasColumnName("object_key").HasMaxLength(512).IsRequired();
        builder.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(256).IsRequired();
        builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(128).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes").IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();

        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_question_attachment_q");
    }
}

public sealed class QuestionTagConfiguration : IEntityTypeConfiguration<QuestionTag>
{
    public void Configure(EntityTypeBuilder<QuestionTag> builder)
    {
        builder.ToTable("question_tag", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.TagId).HasColumnName("tag_id").IsRequired();
        builder.Property(x => x.AssignedAt).IsRequired();

        builder.HasIndex(x => new { x.QuestionId, x.TagId })
            .HasDatabaseName("uq_question_tag")
            .IsUnique();
        builder.HasIndex(x => x.TagId).HasDatabaseName("ix_question_tag_tag");
    }
}
