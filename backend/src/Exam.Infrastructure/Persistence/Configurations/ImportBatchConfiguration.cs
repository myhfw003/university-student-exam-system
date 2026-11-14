using System.Text.Json;
using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ImportBatchConfiguration : IEntityTypeConfiguration<ImportBatch>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<ImportBatch> builder)
    {
        builder.ToTable("import_batch", AppDbContext.CatalogSchema, table =>
        {
            table.HasCheckConstraint("ck_import_batch_file_type", "file_type IN ('csv','xlsx')");
            table.HasCheckConstraint("ck_import_batch_status", "status IN ('parsed','adopted','failed')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();

        builder.Property(x => x.FileName).HasMaxLength(256).IsRequired();
        builder.Property(x => x.FileType)
            .HasConversion(v => v == ImportFileType.Xlsx ? "xlsx" : "csv",
                v => v == "xlsx" ? ImportFileType.Xlsx : ImportFileType.Csv)
            .HasMaxLength(8)
            .IsRequired();
        builder.Property(x => x.ColumnMapping)
            .HasColumnName("column_mapping")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, JsonOptions)
                    ?? new Dictionary<string, string>(StringComparer.Ordinal))
            .IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToString().ToLowerInvariant(),
                v => Enum.Parse<ImportStatus>(v, ignoreCase: true))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.TotalRows).IsRequired();
        builder.Property(x => x.ValidRows).IsRequired();
        builder.Property(x => x.InvalidRows).IsRequired();
        builder.Property(x => x.AdoptedCount).IsRequired();
        builder.Property(x => x.OperatorId).IsRequired();
        builder.Property(x => x.AdoptedBy);
        builder.Property(x => x.AdoptedAt);
        builder.Property(x => x.ObjectKey).HasMaxLength(512);
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => x.Status).HasDatabaseName("ix_import_batch_status");
        builder.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_import_batch_created");

        builder.Property(x => x.ColumnMapping).Metadata.SetValueComparer(
            new ValueComparer<IReadOnlyDictionary<string, string>>(
                (left, right) => left != null && right != null
                    && left.Count == right.Count
                    && left.All(pair => right!.ContainsKey(pair.Key) && right[pair.Key] == pair.Value),
                mapping => mapping.OrderBy(pair => pair.Key).Aggregate(
                    17,
                    (acc, pair) => acc * 31
                        + pair.Key.GetHashCode() * 397
                        + (pair.Value == null ? 0 : pair.Value.GetHashCode())),
                mapping => new Dictionary<string, string>(mapping, StringComparer.Ordinal)));

        builder.HasMany(x => x.Rows)
            .WithOne()
            .HasForeignKey(x => x.BatchId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(ImportBatch.Rows))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class ImportRowConfiguration : IEntityTypeConfiguration<ImportRow>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<ImportRow> builder)
    {
        builder.ToTable("import_row", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.RowNumber).IsRequired();
        builder.Property(x => x.Raw).HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.Parsed).HasColumnType("jsonb");
        builder.Property(x => x.Errors)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<List<ImportRowError>>(v, JsonOptions)
                    ?? new List<ImportRowError>())
            .IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();

        builder.HasIndex(x => new { x.BatchId, x.RowNumber })
            .HasDatabaseName("uq_import_row_batch_no")
            .IsUnique();
    }
}
