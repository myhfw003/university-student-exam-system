using System.Text.Json;
using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>
/// 答案修订流水。追加式：应用账号只有 SELECT / INSERT 权限。
/// </summary>
public sealed class AnswerRevisionConfiguration : IEntityTypeConfiguration<AnswerRevision>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<AnswerRevision> builder)
    {
        builder.ToTable("answer_revision", AppDbContext.AppSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id").IsRequired();
        builder.Property(x => x.ClientSeq).HasColumnName("client_seq").IsRequired();
        builder.Property(x => x.Payload)
            .HasColumnName("payload")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<AnswerPayload>(v, JsonOptions) ?? new AnswerPayload())
            .IsRequired();
        builder.Property(x => x.Revision).IsRequired();
        builder.Property(x => x.ClientSentAt).HasColumnName("client_sent_at");
        builder.Property(x => x.ServerReceivedAt).HasColumnName("server_received_at").IsRequired();

        // 同一批里同一道题只落一条流水，重复提交不会写脏数据。
        builder.HasIndex(x => new { x.AttemptId, x.ClientSeq, x.QuestionId })
            .HasDatabaseName("uq_answer_revision_seq")
            .IsUnique();
        builder.HasIndex(x => new { x.AttemptId, x.ServerReceivedAt })
            .HasDatabaseName("ix_answer_revision_attempt");
    }
}
