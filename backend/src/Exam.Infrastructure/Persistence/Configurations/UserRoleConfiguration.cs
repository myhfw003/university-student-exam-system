using Exam.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class UserRoleConfiguration : IEntityTypeConfiguration<UserRole>
{
    public void Configure(EntityTypeBuilder<UserRole> builder)
    {
        builder.ToTable("user_role", AppDbContext.DefaultSchema);
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.GrantedAt).IsRequired();
        builder.HasIndex(x => new { x.UserId, x.RoleId }).HasDatabaseName("uq_user_role").IsUnique();
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_user_role_user");
    }
}
