using Exam.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.ToTable("refresh_token", AppDbContext.DefaultSchema);
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
        builder.Property(x => x.FamilyId).IsRequired();
        builder.Property(x => x.RevokeReason).HasConversion<string>().HasMaxLength(32);
        builder.Property(x => x.CreatedByIp).HasMaxLength(64);
        builder.Property(x => x.UserAgent).HasMaxLength(512);

        builder.HasIndex(x => x.TokenHash).HasDatabaseName("uq_refresh_token_hash").IsUnique();
        builder.HasIndex(x => x.FamilyId).HasDatabaseName("ix_refresh_token_family");
        builder.HasIndex(x => new { x.UserId, x.ExpiresAt }).HasDatabaseName("ix_refresh_token_user");
    }
}
