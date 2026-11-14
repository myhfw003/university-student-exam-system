using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAppFocusEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "focus_event",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<long>(type: "bigint", nullable: false),
                    event_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: true),
                    client_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    server_received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_focus_event", x => x.id);
                    table.CheckConstraint("ck_focus_event_type", "event_type IN ('window_blur','page_hidden','fullscreen_exit','copy_attempt','paste_attempt','context_menu','heartbeat_timeout')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_focus_event_attempt",
                schema: "app",
                table: "focus_event",
                columns: new[] { "attempt_id", "server_received_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "focus_event",
                schema: "app");
        }
    }
}
