using Exam.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class UserTagConfiguration : IEntityTypeConfiguration<UserTag>
{
    public void Configure(EntityTypeBuilder<UserTag> builder)
    {
        builder.ToTable("user_tag", AppDbContext.DefaultSchema);
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AssignedAt).IsRequired();

        builder.HasIndex(x => new { x.UserId, x.TagId })
            .HasDatabaseName("uq_user_tag")
            .IsUnique();
        builder.HasIndex(x => x.TagId).HasDatabaseName("ix_user_tag_tag");
    }
}
