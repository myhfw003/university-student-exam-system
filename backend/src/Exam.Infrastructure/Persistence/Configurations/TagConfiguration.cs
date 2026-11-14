using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class TagConfiguration : IEntityTypeConfiguration<Tag>
{
    public void Configure(EntityTypeBuilder<Tag> builder)
    {
        builder.ToTable("tag", AppDbContext.CatalogSchema, table =>
        {
            table.HasCheckConstraint("ck_tag_group_name", "group_name IN ('domain','knowledge_point','ability','difficulty','organization')");
            table.HasCheckConstraint(
                "ck_tag_level_by_group",
                "(group_name = 'difficulty' AND level IS NOT NULL AND level BETWEEN 1 AND 5 AND parent_id IS NULL) OR " +
                "(group_name <> 'difficulty' AND level IS NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();

        builder.Property(x => x.Code).HasMaxLength(Tag.MaxCodeLength).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(Tag.MaxNameLength).IsRequired();
        builder.Property(x => x.Group)
            .HasColumnName("group_name")
            .HasConversion(value => value.ToStorage(), value => ParseGroup(value))
            .HasMaxLength(32)
            .IsRequired();
        builder.Property(x => x.Level);
        builder.Property(x => x.Description).HasMaxLength(Tag.MaxDescriptionLength);
        builder.Property(x => x.SortOrder).IsRequired();
        builder.Property(x => x.IsSystem).IsRequired();
        builder.Property(x => x.UsageCount).IsRequired();
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => x.Code)
            .HasDatabaseName("uq_tag_code")
            .IsUnique()
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => x.Group)
            .HasDatabaseName("ix_tag_group")
            .HasFilter("deleted_at IS NULL");
        builder.HasIndex(x => x.ParentId).HasDatabaseName("ix_tag_parent");

        // 同维度内的自引用层级。删除父标签前由领域规则拦截，数据库层兜底为禁止级联删除。
        builder.HasOne<Tag>()
            .WithMany()
            .HasForeignKey(x => x.ParentId)
            .OnDelete(DeleteBehavior.Restrict);
    }

    /// <summary>把数据库里的维度存储值还原为枚举。</summary>
    private static TagGroup ParseGroup(string value) =>
        TagGroups.FromStorage(value)
        ?? throw new InvalidOperationException($"未知的标签维度：{value}。");
}
