using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryProctorActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "proctor_action",
                schema: "delivery",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<long>(type: "bigint", nullable: false),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: false),
                    action_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    message = table.Column<string>(type: "text", nullable: true),
                    reason = table.Column<string>(type: "text", nullable: true),
                    operator_id = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_proctor_action", x => x.id);
                    table.CheckConstraint("ck_proctor_action_type", "action_type IN ('warn','note','force_submit')");
                    table.ForeignKey(
                        name: "fk_proctor_action_attempt_attempt_id",
                        column: x => x.attempt_id,
                        principalSchema: "delivery",
                        principalTable: "attempt",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_proctor_action_exam_session_exam_session_id",
                        column: x => x.exam_session_id,
                        principalSchema: "delivery",
                        principalTable: "exam_session",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_proctor_action_attempt",
                schema: "delivery",
                table: "proctor_action",
                columns: new[] { "attempt_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_proctor_action_exam_session_id",
                schema: "delivery",
                table: "proctor_action",
                column: "exam_session_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "proctor_action",
                schema: "delivery");
        }
    }
}
