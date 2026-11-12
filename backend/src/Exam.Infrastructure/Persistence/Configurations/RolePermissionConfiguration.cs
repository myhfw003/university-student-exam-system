using Exam.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> builder)
    {
        builder.ToTable("role_permission", AppDbContext.DefaultSchema);
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.HasIndex(x => new { x.RoleId, x.PermissionId }).HasDatabaseName("uq_role_permission").IsUnique();
        builder.HasIndex(x => x.RoleId).HasDatabaseName("ix_role_permission_role");
    }
}
