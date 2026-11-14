using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>Outbox 消息。</summary>
public sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("outbox_message", AppDbContext.OutboxSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.MessageType).HasColumnName("message_type").IsRequired();
        builder.Property(x => x.Payload).HasColumnName("payload").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at").IsRequired();
        builder.Property(x => x.DispatchedAt).HasColumnName("dispatched_at");
        builder.Property(x => x.Attempts).HasColumnName("attempts").IsRequired();
        builder.Property(x => x.LastError).HasColumnName("last_error");

        // 待派发的消息：Worker 轮询的就是这批。
        builder.HasIndex(x => x.DispatchedAt)
            .HasDatabaseName("ix_outbox_pending")
            .HasFilter("dispatched_at IS NULL");
    }
}
