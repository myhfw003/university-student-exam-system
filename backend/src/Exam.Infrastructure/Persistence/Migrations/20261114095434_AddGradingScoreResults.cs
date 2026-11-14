using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGradingScoreResults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "grading");

            migrationBuilder.CreateTable(
                name: "score_result",
                schema: "grading",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attempt_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    paper_item_id = table.Column<long>(type: "bigint", nullable: true),
                    score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    max_score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    method = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    detail = table.Column<string>(type: "jsonb", nullable: false),
                    scored_by = table.Column<long>(type: "bigint", nullable: true),
                    scored_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_score_result", x => x.id);
                    table.CheckConstraint("ck_score_result_method", "method IN ('auto_scored','auto_suggested','manual_scored')");
                    table.CheckConstraint("ck_score_result_score", "score >= 0 AND max_score >= 0");
                    table.CheckConstraint("ck_score_result_status", "status IN ('pending','auto_scored','suggested','final')");
                    table.ForeignKey(
                        name: "fk_score_result_attempt_attempt_id",
                        column: x => x.attempt_id,
                        principalSchema: "delivery",
                        principalTable: "attempt",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_score_result_attempt",
                schema: "grading",
                table: "score_result",
                column: "attempt_id");

            migrationBuilder.CreateIndex(
                name: "uq_score_result_attempt_question",
                schema: "grading",
                table: "score_result",
                columns: new[] { "attempt_id", "question_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "score_result",
                schema: "grading");
        }
    }
}
