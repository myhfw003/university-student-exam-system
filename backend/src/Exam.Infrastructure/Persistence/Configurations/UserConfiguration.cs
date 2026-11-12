using Exam.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("user", AppDbContext.DefaultSchema, table =>
        {
            // 账号格式在数据库层兜底：4..32 位，允许字母、数字、下划线、点、中划线。
            table.HasCheckConstraint("ck_user_username_format", "username ~ '^[A-Za-z0-9_.-]{4,32}$'");
        });
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();

        builder.Property(x => x.Username).HasMaxLength(32).IsRequired();
        builder.Property(x => x.DisplayName).HasMaxLength(64).IsRequired();
        builder.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
        builder.Property(x => x.Email).HasMaxLength(256);
        builder.Property(x => x.Phone).HasMaxLength(32);
        builder.Property(x => x.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => x.Username).HasDatabaseName("uq_user_username").IsUnique();
        builder.HasIndex(x => x.Status).HasDatabaseName("ix_user_status");
    }
}
