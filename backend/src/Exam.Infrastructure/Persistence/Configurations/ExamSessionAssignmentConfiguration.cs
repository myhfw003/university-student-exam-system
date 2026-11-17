using Exam.Domain.Delivery;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

public sealed class ExamSessionAssignmentConfiguration : IEntityTypeConfiguration<ExamSessionAssignment>
{
    public void Configure(EntityTypeBuilder<ExamSessionAssignment> builder)
    {
        builder.ToTable("exam_session_assignment", AppDbContext.DeliverySchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ExamSessionId).HasColumnName("exam_session_id").IsRequired();
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(x => x.CreatedBy).HasColumnName("created_by");

        // 同一场次里一个用户只能有一条指派。
        builder.HasIndex(x => new { x.ExamSessionId, x.UserId })
            .HasDatabaseName("uq_exam_session_assignment_user")
            .IsUnique();
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_exam_session_assignment_user");

        builder.HasOne<ExamSession>()
            .WithMany()
            .HasForeignKey(x => x.ExamSessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
