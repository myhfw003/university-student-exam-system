using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGradingReviewTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "review_task",
                schema: "grading",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<long>(type: "bigint", nullable: false),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: true),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    step_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    answer_text = table.Column<string>(type: "text", nullable: false),
                    suggested_score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    max_score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    assignee_id = table.Column<long>(type: "bigint", nullable: true),
                    reviewer_id = table.Column<long>(type: "bigint", nullable: true),
                    final_score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    comment = table.Column<string>(type: "text", nullable: true),
                    reviewed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_review_task", x => x.id);
                    table.CheckConstraint("ck_review_task_status", "status IN ('pending','in_review','reviewed')");
                    table.ForeignKey(
                        name: "fk_review_task_attempt_attempt_id",
                        column: x => x.attempt_id,
                        principalSchema: "delivery",
                        principalTable: "attempt",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_review_task_attempt",
                schema: "grading",
                table: "review_task",
                column: "attempt_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_task_exam",
                schema: "grading",
                table: "review_task",
                columns: new[] { "exam_session_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_review_task_status",
                schema: "grading",
                table: "review_task",
                columns: new[] { "status", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "review_task",
                schema: "grading");
        }
    }
}
