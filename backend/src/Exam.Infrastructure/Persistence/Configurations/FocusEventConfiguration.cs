using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>
/// 焦点事件流水。追加式：应用账号只有 SELECT / INSERT 权限。
/// </summary>
public sealed class FocusEventConfiguration : IEntityTypeConfiguration<FocusEvent>
{
    public void Configure(EntityTypeBuilder<FocusEvent> builder)
    {
        builder.ToTable("focus_event", AppDbContext.AppSchema, table =>
        {
            table.HasCheckConstraint(
                "ck_focus_event_type",
                "event_type IN ('window_blur','page_hidden','fullscreen_exit','copy_attempt','paste_attempt','context_menu','heartbeat_timeout')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.EventType)
            .HasColumnName("event_type")
            .HasConversion(v => v.ToStorage(), v => ParseEventType(v))
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(x => x.QuestionId).HasColumnName("question_id");
        builder.Property(x => x.ClientAt).HasColumnName("client_at");
        builder.Property(x => x.ServerReceivedAt).HasColumnName("server_received_at").IsRequired();

        builder.HasIndex(x => new { x.AttemptId, x.ServerReceivedAt })
            .HasDatabaseName("ix_focus_event_attempt");
    }

    private static FocusEventType ParseEventType(string value) =>
        FocusEventTypes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知焦点事件类型：{value}。");
}
