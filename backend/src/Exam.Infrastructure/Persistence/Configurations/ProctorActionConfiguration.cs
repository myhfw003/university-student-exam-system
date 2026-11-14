using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ProctorActionConfiguration : IEntityTypeConfiguration<ProctorAction>
{
    public void Configure(EntityTypeBuilder<ProctorAction> builder)
    {
        builder.ToTable("proctor_action", AppDbContext.DeliverySchema, table =>
        {
            table.HasCheckConstraint("ck_proctor_action_type", "action_type IN ('warn','note','force_submit')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.AttemptId).HasColumnName("attempt_id").IsRequired();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.ActionType)
            .HasConversion(v => v.ToStorage(), v => ParseActionType(v))
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(x => x.Message);
        builder.Property(x => x.Reason);
        builder.Property(x => x.OperatorId).HasColumnName("operator_id").IsRequired();
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.UpdatedAt);

        builder.HasIndex(x => new { x.AttemptId, x.CreatedAt })
            .HasDatabaseName("ix_proctor_action_attempt");

        builder.HasOne<Attempt>()
            .WithMany()
            .HasForeignKey(x => x.AttemptId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static ProctorActionType ParseActionType(string value) =>
        ProctorActionTypes.FromStorage(value)
        ?? throw new InvalidOperationException($"未知监考处置类型：{value}。");
}
