using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthoringSnapshotAnswerPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "answer_policy",
                schema: "authoring",
                table: "paper_snapshot",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "after_close");

            // 已有快照按各自试卷的策略回填——不是所有快照都是同一条策略。
            migrationBuilder.Sql("""
                UPDATE authoring.paper_snapshot AS s
                SET answer_policy = p.answer_policy
                FROM authoring.paper AS p
                WHERE p.id = s.paper_id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "answer_policy",
                schema: "authoring",
                table: "paper_snapshot");
        }
    }
}
