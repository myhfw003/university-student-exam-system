using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryAttemptsAndAnswers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "answer",
                schema: "delivery",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    paper_item_id = table.Column<long>(type: "bigint", nullable: true),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    is_blank = table.Column<bool>(type: "boolean", nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    client_seq = table.Column<int>(type: "integer", nullable: false),
                    saved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_answer", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "attempt",
                schema: "delivery",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    target_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: true),
                    practice_assignment_id = table.Column<long>(type: "bigint", nullable: true),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    attempt_no = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deadline_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    submit_reason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    last_saved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_client_seq = table.Column<int>(type: "integer", nullable: false),
                    focus_loss_count = table.Column<int>(type: "integer", nullable: false),
                    disconnect_count = table.Column<int>(type: "integer", nullable: false),
                    warning_count = table.Column<int>(type: "integer", nullable: false),
                    variant_key = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    variant_seed = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    duration_spent_seconds = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attempt", x => x.id);
                    table.CheckConstraint("ck_attempt_status", "status IN ('not_started','in_progress','submitted','auto_submitted','force_submitted','abandoned')");
                    table.CheckConstraint("ck_attempt_submit_reason", "submit_reason IS NULL OR submit_reason IN ('manual','time_up','proctor_force','admin_force','network_timeout')");
                    table.CheckConstraint("ck_attempt_target", "(target_type = 'exam' AND exam_session_id IS NOT NULL AND practice_assignment_id IS NULL) OR (target_type = 'practice' AND practice_assignment_id IS NOT NULL AND exam_session_id IS NULL)");
                    table.CheckConstraint("ck_attempt_target_type", "target_type IN ('exam','practice')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_answer_attempt",
                schema: "delivery",
                table: "answer",
                column: "attempt_id");

            migrationBuilder.CreateIndex(
                name: "uq_answer_attempt_question",
                schema: "delivery",
                table: "answer",
                columns: new[] { "attempt_id", "question_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_attempt_active",
                schema: "delivery",
                table: "attempt",
                columns: new[] { "status", "deadline_at" },
                filter: "status = 'in_progress' AND deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_attempt_session_status",
                schema: "delivery",
                table: "attempt",
                columns: new[] { "exam_session_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_attempt_user",
                schema: "delivery",
                table: "attempt",
                columns: new[] { "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "uq_attempt_exam_user_no",
                schema: "delivery",
                table: "attempt",
                columns: new[] { "exam_session_id", "user_id", "attempt_no" },
                unique: true,
                filter: "target_type = 'exam' AND deleted_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "answer",
                schema: "delivery");

            migrationBuilder.DropTable(
                name: "attempt",
                schema: "delivery");
        }
    }
}
