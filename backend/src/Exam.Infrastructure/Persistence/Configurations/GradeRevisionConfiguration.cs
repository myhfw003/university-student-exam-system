using Exam.Domain.Grading;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Exam.Infrastructure.Persistence.Configurations;

/// <summary>
/// 改分流水。追加式：应用账号只有 SELECT / INSERT 权限。
/// <para>
/// 没有软删除列，也没有更新时间——流水只进不出。
/// </para>
/// </summary>
public sealed class GradeRevisionConfiguration : IEntityTypeConfiguration<GradeRevision>
{
    public void Configure(EntityTypeBuilder<GradeRevision> builder)
    {
        builder.ToTable("grade_revision", AppDbContext.AppSchema);

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedOnAdd();
        builder.Property(x => x.ScoreResultId).HasColumnName("score_result_id").IsRequired();
        builder.Property(x => x.PreviousScore).HasColumnName("previous_score").HasPrecision(6, 2);
        builder.Property(x => x.NewScore).HasColumnName("new_score").HasPrecision(6, 2).IsRequired();
        builder.Property(x => x.Comment).HasColumnName("comment");
        builder.Property(x => x.OperatorId).HasColumnName("operator_id").IsRequired();
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at").IsRequired();

        builder.HasIndex(x => x.ScoreResultId)
            .HasDatabaseName("ix_grade_revision_score_result");
        builder.HasIndex(x => x.OccurredAt)
            .HasDatabaseName("ix_grade_revision_occurred_at");
    }
}
