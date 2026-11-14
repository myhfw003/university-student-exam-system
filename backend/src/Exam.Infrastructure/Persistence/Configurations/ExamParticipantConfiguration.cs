using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ExamParticipantConfiguration : IEntityTypeConfiguration<ExamParticipant>
{
    public void Configure(EntityTypeBuilder<ExamParticipant> builder)
    {
        builder.ToTable("exam_participant", AppDbContext.DeliverySchema, table =>
        {
            table.HasCheckConstraint(
                "ck_exam_participant_status",
                "status IN ('invited','not_started','in_progress','submitted','absent','disqualified')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.Status)
            .HasConversion(v => v.ToStorage(), v => ParseStatus(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.AttemptsUsed).HasColumnName("attempts_used").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.UpdatedAt);

        // 同一场次里一个用户只能有一条名单项。
        builder.HasIndex(x => new { x.ExamSessionId, x.UserId })
            .HasDatabaseName("uq_exam_participant_user")
            .IsUnique();
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_exam_participant_user");

        builder.HasOne<ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static ParticipantStatus ParseStatus(string value) =>
        ParticipantStatuses.FromStorage(value)
        ?? throw new InvalidOperationException($"未知名单状态：{value}。");
}
