using System.Text.Json;
using Exam.Domain.Authoring;
using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ExamSessionConfiguration : IEntityTypeConfiguration<ExamSession>
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Configure(EntityTypeBuilder<ExamSession> builder)
    {
        builder.ToTable("exam_session", AppDbContext.DeliverySchema, table =>
        {
            table.HasCheckConstraint("ck_exam_session_status", "status IN ('scheduled','in_progress','closed','cancelled')");
            table.HasCheckConstraint("ck_exam_session_variant_rule", "variant_rule IN ('standard','small_plum','large_plum')");
            table.HasCheckConstraint("ck_exam_session_participant_mode", "participant_mode IN ('tags','direct','open')");
            table.HasCheckConstraint("ck_exam_session_window", "open_at < close_at");
            table.HasCheckConstraint("ck_exam_session_duration", "duration_minutes > 0");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.PaperId).HasColumnName("paper_id").IsRequired();
        builder.Property(x => x.SnapshotId).HasColumnName("snapshot_id");
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.OpenAt).HasColumnName("open_at").IsRequired();
        builder.Property(x => x.CloseAt).HasColumnName("close_at").IsRequired();
        builder.Property(x => x.DurationMinutes).HasColumnName("duration_minutes").IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.VariantRule)
            .HasConversion(v => v.ToStorage(), v => ParseVariantRule(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Rules)
            .HasColumnName("rules")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, JsonOptions),
                v => JsonSerializer.Deserialize<ExamRules>(v, JsonOptions) ?? ExamRules.Default)
            .IsRequired();
        builder.Property(x => x.Note);
        builder.Property(x => x.ParticipantMode)
            .HasConversion(v => v.ToStorage(), v => ParseParticipantMode(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.ParticipantTagIds)
            .HasColumnName("participant_tag_ids")
            .HasColumnType("bigint[]")
            .IsRequired();
        builder.Property(x => x.ParticipantUserIds)
            .HasColumnName("participant_user_ids")
            .HasColumnType("bigint[]")
            .IsRequired();
        builder.Property(x => x.PublishedAt).HasColumnName("published_at");
        builder.Property(x => x.ClosedAt).HasColumnName("closed_at");
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");
        builder.Property(x => x.Version).HasColumnName("xmin").IsRowVersion();

        builder.HasIndex(x => new { x.Status, x.OpenAt })
            .HasDatabaseName("ix_exam_session_status")
            .HasFilter("deleted_at IS NULL");

        builder.HasOne<Paper>()
            .WithMany()
            .HasForeignKey(x => x.PaperId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static ExamSessionStatus ParseStatus(string value) =>
        ExamSessionStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知场次状态：{value}。");

    private static VariantRule ParseVariantRule(string value) =>
        VariantRules.FromStorage(value)
        ?? throw new InvalidOperationException($"未知卷型规则：{value}。");

    private static ParticipantMode ParseParticipantMode(string value) =>
        ParticipantModes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知名单纳入方式：{value}。");
}
