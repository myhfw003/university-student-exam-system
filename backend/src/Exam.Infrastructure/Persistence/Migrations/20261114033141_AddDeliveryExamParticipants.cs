using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryExamParticipants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "exam_participant",
                schema: "delivery",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: false),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    attempts_used = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_exam_participant", x => x.id);
                    table.CheckConstraint("ck_exam_participant_status", "status IN ('invited','not_started','in_progress','submitted','absent','disqualified')");
                    table.ForeignKey(
                        name: "fk_exam_participant_exam_sessions_exam_session_id",
                        column: x => x.exam_session_id,
                        principalSchema: "delivery",
                        principalTable: "exam_session",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_exam_participant_user",
                schema: "delivery",
                table: "exam_participant",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_exam_participant_user",
                schema: "delivery",
                table: "exam_participant",
                columns: new[] { "exam_session_id", "user_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "exam_participant",
                schema: "delivery");
        }
    }
}
