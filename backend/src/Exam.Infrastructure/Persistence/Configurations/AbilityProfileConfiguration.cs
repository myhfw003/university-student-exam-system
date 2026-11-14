using Exam.Domain.Learning;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>能力画像。</summary>
public sealed class AbilityProfileConfiguration : IEntityTypeConfiguration<AbilityProfile>
{
    public void Configure(EntityTypeBuilder<AbilityProfile> builder)
    {
        builder.ToTable("ability_profile", AppDbContext.LearningSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.AbilityTagId).HasColumnName("ability_tag_id").IsRequired();
        builder.Property(x => x.MasteryRate).HasColumnName("mastery_rate").HasPrecision(6, 4).IsRequired();
        builder.Property(x => x.SampleSize).HasColumnName("sample_size").IsRequired();
        builder.Property(x => x.CorrectCount).HasColumnName("correct_count").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.UpdatedBy).HasColumnName("updated_by");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一个人一项能力只有一条画像。
        builder.HasIndex(x => new { x.UserId, x.AbilityTagId })
            .HasDatabaseName("uq_ability_profile")
            .IsUnique();
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_ability_profile_user");

        builder.HasOne<Exam.Domain.Identity.User>()
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Exam.Domain.Catalog.Tag>()
            .WithMany()
            .HasForeignKey(x => x.AbilityTagId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
