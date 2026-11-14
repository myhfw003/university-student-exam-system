using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class AttemptConfiguration : IEntityTypeConfiguration<Attempt>
{
    public void Configure(EntityTypeBuilder<Attempt> builder)
    {
        builder.ToTable("attempt", AppDbContext.DeliverySchema, table =>
        {
            table.HasCheckConstraint("ck_attempt_target_type", "target_type IN ('exam','practice')");
            table.HasCheckConstraint(
                "ck_attempt_status",
                "status IN ('not_started','in_progress','submitted','auto_submitted','force_submitted','abandoned')");
            table.HasCheckConstraint(
                "ck_attempt_submit_reason",
                "submit_reason IS NULL OR submit_reason IN ('manual','time_up','proctor_force','admin_force','network_timeout')");
            table.HasCheckConstraint(
                "ck_attempt_target",
                "(target_type = 'exam' AND exam_session_id IS NOT NULL AND practice_assignment_id IS NULL) OR "
                + "(target_type = 'practice' AND practice_assignment_id IS NOT NULL AND exam_session_id IS NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.TargetType)
            .HasColumnName("target_type")
            .HasConversion(v => v.ToStorage(), v => ParseTargetType(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id");
        builder.Property(x => x.PracticeAssignmentId).HasColumnName("practice_assignment_id");
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.AttemptNo).HasColumnName("attempt_no").IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.StartedAt).HasColumnName("started_at");
        builder.Property(x => x.DeadlineAt).HasColumnName("deadline_at").IsRequired();
        builder.Property(x => x.SubmittedAt).HasColumnName("submitted_at");
        builder.Property(x => x.SubmitReason)
            .HasColumnName("submit_reason")
            .HasConversion<string?>(
                v => v == null ? null : v.Value.ToStorage(),
                v => v == null ? null : ParseSubmitReason(v))
            .HasMaxLength(20);
        builder.Property(x => x.LastSavedAt).HasColumnName("last_saved_at");
        builder.Property(x => x.LastClientSeq).HasColumnName("last_client_seq").IsRequired();
        builder.Property(x => x.FocusLossCount).HasColumnName("focus_loss_count").IsRequired();
        builder.Property(x => x.DisconnectCount).HasColumnName("disconnect_count").IsRequired();
        builder.Property(x => x.WarningCount).HasColumnName("warning_count").IsRequired();
        builder.Property(x => x.VariantKey).HasColumnName("variant_key").HasMaxLength(32);
        builder.Property(x => x.VariantSeed).HasColumnName("variant_seed").HasMaxLength(128);
        builder.Property(x => x.DurationSpentSeconds).HasColumnName("duration_spent_seconds");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => new { x.ExamSessionId, x.UserId, x.AttemptNo })
            .HasDatabaseName("uq_attempt_exam_user_no")
            .IsUnique()
            .HasFilter("target_type = 'exam' AND deleted_at IS NULL");
        builder.HasIndex(x => new { x.UserId, x.CreatedAt })
            .HasDatabaseName("ix_attempt_user");
        builder.HasIndex(x => new { x.ExamSessionId, x.Status })
            .HasDatabaseName("ix_attempt_session_status");
        builder.HasIndex(x => new { x.Status, x.DeadlineAt })
            .HasDatabaseName("ix_attempt_active")
            .HasFilter("status = 'in_progress' AND deleted_at IS NULL");
    }

    private static AttemptTargetType ParseTargetType(string value) =>
        AttemptTargetTypes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知作答目标类型：{value}。");

    private static AttemptStatus ParseStatus(string value) =>
        AttemptStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知作答会话状态：{value}。");

    private static SubmitReason ParseSubmitReason(string value) =>
        SubmitReasons.FromStorage(value)
        ?? throw new InvalidOperationException($"未知交卷原因：{value}。");
}
