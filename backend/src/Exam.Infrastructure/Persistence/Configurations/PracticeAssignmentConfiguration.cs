using Exam.Domain.Learning;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>练习开放单。</summary>
public sealed class PracticeAssignmentConfiguration : IEntityTypeConfiguration<PracticeAssignment>
{
    public void Configure(EntityTypeBuilder<PracticeAssignment> builder)
    {
        builder.ToTable("practice_assignment", AppDbContext.LearningSchema, table =>
        {
            table.HasCheckConstraint("ck_practice_assignment_status", "status IN ('draft','published','archived')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.PaperId).HasColumnName("paper_id").IsRequired();
        builder.Property(x => x.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.ScopeTagIds)
            .HasColumnName("scope")
            .HasColumnType("jsonb")
            .HasConversion(
                v => System.Text.Json.JsonSerializer.Serialize(v),
                v => System.Text.Json.JsonSerializer.Deserialize<long[]>(v) ?? Array.Empty<long>())
            .IsRequired();
        builder.Property(x => x.Rules)
            .HasColumnName("rules")
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(x => x.OpenAt).HasColumnName("open_at");
        builder.Property(x => x.CloseAt).HasColumnName("close_at");
        builder.Property(x => x.PublishedAt).HasColumnName("published_at");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.UpdatedBy).HasColumnName("updated_by");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => x.Status).HasDatabaseName("ix_practice_assignment_status");
        builder.HasIndex(x => x.PaperId).HasDatabaseName("ix_practice_assignment_paper");

        builder.HasOne<Exam.Domain.Authoring.Paper>()
            .WithMany()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static PracticeAssignmentStatus ParseStatus(string value) =>
        PracticeAssignmentStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知练习开放单状态：{value}。");
}
