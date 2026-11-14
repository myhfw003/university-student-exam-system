using System.Text.Json;
using System.Text.Json.Serialization;
using Exam.Domain.Authoring;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class BlueprintConfiguration : IEntityTypeConfiguration<Blueprint>
{
    /// <summary>
    /// 规则与缺口都用 jsonb 存。枚举一律用 camelCase 字符串，
    /// 题型配额的对象键也是题型名，前端可以直接透传。
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public void Configure(EntityTypeBuilder<Blueprint> builder)
    {
        builder.ToTable("blueprint", AppDbContext.AuthoringSchema, table =>
        {
            table.HasCheckConstraint("ck_blueprint_status", "status IN ('draft','generated','modified')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.PaperId).HasColumnName("paper_id").IsRequired();
        builder.Property(x => x.Rules)
            .HasColumnName("rules")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<BlueprintRules>(v, JsonOptions) ?? new BlueprintRules())
            .IsRequired();
        builder.Property(x => x.Seed).HasMaxLength(128).IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.ManualModified).HasColumnName("manual_modified").IsRequired();
        builder.Property(x => x.Plan)
            .HasColumnName("generated_items")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<BlueprintPlan>(v, JsonOptions) ?? BlueprintPlan.Empty)
            .IsRequired();
        builder.Property(x => x.Shortfalls)
            .HasColumnName("shortfalls")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<Shortfall>>(v, JsonOptions) ?? new List<Shortfall>())
            .IsRequired();
        builder.Property(x => x.GeneratedAt).HasColumnName("generated_at");
        builder.Property(x => x.GeneratedBy).HasColumnName("generated_by");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        // 一份试卷至多一份方案。
        builder.HasIndex(x => x.PaperId)
            .HasDatabaseName("ux_blueprint_paper")
            .IsUnique();

        builder.HasOne<Paper>()
            .WithMany()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static BlueprintStatus ParseStatus(string value) =>
        BlueprintStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知组卷方案状态：{value}。");
}
