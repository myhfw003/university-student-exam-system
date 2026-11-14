using Exam.Domain.Catalog;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class QuestionBankConfiguration : IEntityTypeConfiguration<QuestionBank>
{
    public void Configure(EntityTypeBuilder<QuestionBank> builder)
    {
        builder.ToTable("question_bank", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.Name).HasMaxLength(QuestionBank.MaxNameLength).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.Version).IsRowVersion();

        builder.HasIndex(x => x.Name)
            .HasDatabaseName("uq_question_bank_name")
            .IsUnique()
            .HasFilter("deleted_at IS NULL");

        builder.HasMany(x => x.Items)
            .WithOne()
            .HasForeignKey(x => x.BankId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata.FindNavigation(nameof(QuestionBank.Items))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class QuestionBankItemConfiguration : IEntityTypeConfiguration<QuestionBankItem>
{
    public void Configure(EntityTypeBuilder<QuestionBankItem> builder)
    {
        builder.ToTable("question_bank_item", AppDbContext.CatalogSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.QuestionId).IsRequired();
        builder.Property(x => x.AddedAt).IsRequired();

        builder.HasIndex(x => new { x.BankId, x.QuestionId })
            .HasDatabaseName("uq_question_bank_item")
            .IsUnique();
        builder.HasIndex(x => x.QuestionId).HasDatabaseName("ix_question_bank_item_q");
    }
}
