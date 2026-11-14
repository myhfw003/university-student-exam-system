using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLearningPracticeAssignments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "practice_assignment",
                schema: "learning",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    scope = table.Column<string>(type: "jsonb", nullable: false),
                    open_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    close_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    rules = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_practice_assignment", x => x.id);
                    table.CheckConstraint("ck_practice_assignment_status", "status IN ('draft','published','archived')");
                    table.ForeignKey(
                        name: "fk_practice_assignment_paper_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_practice_assignment_paper",
                schema: "learning",
                table: "practice_assignment",
                column: "paper_id");

            migrationBuilder.CreateIndex(
                name: "ix_practice_assignment_status",
                schema: "learning",
                table: "practice_assignment",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "practice_assignment",
                schema: "learning");
        }
    }
}
