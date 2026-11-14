using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryExamSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "delivery");

            migrationBuilder.CreateTable(
                name: "exam_session",
                schema: "delivery",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    snapshot_id = table.Column<long>(type: "bigint", nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    open_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    close_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    duration_minutes = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    variant_rule = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    rules = table.Column<string>(type: "jsonb", nullable: false),
                    note = table.Column<string>(type: "text", nullable: true),
                    participant_mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    participant_tag_ids = table.Column<long[]>(type: "bigint[]", nullable: false),
                    participant_user_ids = table.Column<long[]>(type: "bigint[]", nullable: false),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_exam_session", x => x.id);
                    table.CheckConstraint("ck_exam_session_duration", "duration_minutes > 0");
                    table.CheckConstraint("ck_exam_session_participant_mode", "participant_mode IN ('tags','direct','open')");
                    table.CheckConstraint("ck_exam_session_status", "status IN ('scheduled','in_progress','closed','cancelled')");
                    table.CheckConstraint("ck_exam_session_variant_rule", "variant_rule IN ('standard','small_plum','large_plum')");
                    table.CheckConstraint("ck_exam_session_window", "open_at < close_at");
                    table.ForeignKey(
                        name: "fk_exam_session_papers_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_exam_session_paper_id",
                schema: "delivery",
                table: "exam_session",
                column: "paper_id");

            migrationBuilder.CreateIndex(
                name: "ix_exam_session_status",
                schema: "delivery",
                table: "exam_session",
                columns: new[] { "status", "open_at" },
                filter: "deleted_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "exam_session",
                schema: "delivery");
        }
    }
}
