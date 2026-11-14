using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class PaperTemplateConfiguration : IEntityTypeConfiguration<PaperTemplate>
{
    public void Configure(EntityTypeBuilder<PaperTemplate> builder)
    {
        builder.ToTable("paper_template", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_paper_template_kind", "kind IN ('exam','practice')");
            table.HasCheckConstraint(
                "ck_paper_template_variant_rule",
                "variant_rule IN ('standard','small_plum','large_plum')");
            table.HasCheckConstraint("ck_paper_template_duration", "duration_minutes BETWEEN 1 AND 300");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Kind)
            .HasConversion(v => v.ToStorage(), v => ParseKind(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.VariantRule)
            .HasConversion(v => v.ToStorage(), v => ParseVariantRule(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.DurationMinutes).HasColumnName("duration_minutes").IsRequired();
        builder.Property(x => x.PassScore)
            .HasConversion<decimal?>(
                v => v == null ? null : v.Value,
                v => v == null ? null : Score.Paper(v.Value))
            .HasPrecision(8, 2);
        builder.Property(x => x.SourcePaperId).HasColumnName("source_paper_id");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasMany(x => x.Items)
            .WithOne()
            .HasForeignKey(x => x.TemplateId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(PaperTemplate.Items))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(x => x.Name).HasDatabaseName("ix_paper_template_name");
    }

    private static PaperKind ParseKind(string value) =>
        PaperKinds.FromStorage(value)
        ?? throw new InvalidOperationException($"未知试卷形态：{value}。");

    private static VariantRule ParseVariantRule(string value) =>
        VariantRules.FromStorage(value)
        ?? throw new InvalidOperationException($"未知卷型规则：{value}。");
}

public sealed class PaperTemplateItemConfiguration : IEntityTypeConfiguration<PaperTemplateItem>
{
    public void Configure(EntityTypeBuilder<PaperTemplateItem> builder)
    {
        builder.ToTable("template_item", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_template_item_score", "score >= 0 AND score <= 40");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.Score)
            .HasConversion(v => v.Value, v => Score.Paper(v))
            .HasPrecision(6, 2)
            .IsRequired();
        builder.Property(x => x.SortOrder).HasColumnName("sort_order").IsRequired();

        builder.HasIndex(x => new { x.TemplateId, x.SortOrder })
            .HasDatabaseName("ix_template_item_template");
    }
}
