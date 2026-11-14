using System.Text.Json;
using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class AnswerConfiguration : IEntityTypeConfiguration<Answer>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<Answer> builder)
    {
        builder.ToTable("answer", AppDbContext.DeliverySchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.PaperItemId).HasColumnName("paper_item_id");
        builder.Property(x => x.Payload)
            .HasColumnName("payload")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<AnswerPayload>(v, JsonOptions) ?? new AnswerPayload())
            .IsRequired();
        builder.Property(x => x.IsBlank).HasColumnName("is_blank").IsRequired();
        builder.Property(x => x.Revision).IsRequired();
        builder.Property(x => x.ClientSeq).HasColumnName("client_seq").IsRequired();
        builder.Property(x => x.SavedAt).HasColumnName("saved_at").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();

        // 一次作答里每道题只有一行当前值。
        builder.HasIndex(x => new { x.AttemptId, x.QuestionId })
            .HasDatabaseName("uq_answer_attempt_question")
            .IsUnique();
        builder.HasIndex(x => x.AttemptId).HasDatabaseName("ix_answer_attempt");
    }
}
