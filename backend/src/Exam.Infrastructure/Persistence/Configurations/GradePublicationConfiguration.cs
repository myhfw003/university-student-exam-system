using Exam.Domain.Grading;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>成绩发布记录。</summary>
public sealed class GradePublicationConfiguration : IEntityTypeConfiguration<GradePublication>
{
    public void Configure(EntityTypeBuilder<GradePublication> builder)
    {
        builder.ToTable("grade_publication", AppDbContext.GradingSchema, table =>
        {
            table.HasCheckConstraint("ck_grade_publication_scope", "scope IN ('all','objective_only')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.Scope)
            .HasConversion(v => v.ToStorage(), v => ParseScope(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.IncludedAttemptIds)
            .HasColumnName("included_attempt_ids")
            .HasColumnType("bigint[]")
            .HasConversion(
                v => v.ToArray(),
                v => v ?? Array.Empty<long>())
            .IsRequired();
        builder.Property(x => x.PublishedAt).HasColumnName("published_at").IsRequired();
        builder.Property(x => x.PublishedBy).HasColumnName("published_by").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => x.ExamSessionId)
            .HasDatabaseName("ix_grade_publication_session");

        builder.HasOne<Exam.Domain.Delivery.ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static GradePublicationScope ParseScope(string value) =>
        GradePublicationScopes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知成绩发布范围：{value}。");
}
