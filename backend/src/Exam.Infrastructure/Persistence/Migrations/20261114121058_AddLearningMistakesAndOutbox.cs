using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLearningMistakesAndOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "learning");

            migrationBuilder.EnsureSchema(
                name: "outbox");

            migrationBuilder.CreateTable(
                name: "mistake",
                schema: "learning",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    wrong_count = table.Column<int>(type: "integer", nullable: false),
                    last_wrong_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    source_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source_attempt_id = table.Column<long>(type: "bigint", nullable: true),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_mistake", x => x.id);
                    table.CheckConstraint("ck_mistake_reason", "reason IN ('multi_missed','multi_wrong','single_wrong','judge_wrong','short_keypoints_missed','comprehensive_step_missed','unanswered')");
                    table.CheckConstraint("ck_mistake_source_type", "source_type IN ('exam','practice')");
                });

            migrationBuilder.CreateTable(
                name: "outbox_message",
                schema: "outbox",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    message_type = table.Column<string>(type: "text", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    dispatched_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    last_error = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_outbox_message", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_mistake_user_wrong",
                schema: "learning",
                table: "mistake",
                columns: new[] { "user_id", "wrong_count" });

            migrationBuilder.CreateIndex(
                name: "uq_mistake_user_question",
                schema: "learning",
                table: "mistake",
                columns: new[] { "user_id", "question_id" },
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_outbox_pending",
                schema: "outbox",
                table: "outbox_message",
                column: "dispatched_at",
                filter: "dispatched_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "mistake",
                schema: "learning");

            migrationBuilder.DropTable(
                name: "outbox_message",
                schema: "outbox");
        }
    }
}
