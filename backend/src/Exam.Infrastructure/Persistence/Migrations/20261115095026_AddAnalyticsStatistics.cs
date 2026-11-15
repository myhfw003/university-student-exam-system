using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalyticsStatistics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "analytics");

            migrationBuilder.CreateTable(
                name: "exam_statistic",
                schema: "analytics",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: false),
                    participant_count = table.Column<int>(type: "integer", nullable: false),
                    submitted_count = table.Column<int>(type: "integer", nullable: false),
                    absent_count = table.Column<int>(type: "integer", nullable: false),
                    average_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    max_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    min_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    pass_rate = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: true),
                    excellent_rate = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: true),
                    score_buckets = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_exam_statistic", x => x.id);
                    table.ForeignKey(
                        name: "fk_exam_statistic_exam_session_exam_session_id",
                        column: x => x.exam_session_id,
                        principalSchema: "delivery",
                        principalTable: "exam_session",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_statistic",
                schema: "analytics",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    answered_count = table.Column<int>(type: "integer", nullable: false),
                    correct_count = table.Column<int>(type: "integer", nullable: false),
                    average_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    mastery_rate = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_statistic", x => x.id);
                    table.ForeignKey(
                        name: "fk_question_statistic_exam_session_exam_session_id",
                        column: x => x.exam_session_id,
                        principalSchema: "delivery",
                        principalTable: "exam_session",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_question_statistic_question_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "type_statistic",
                schema: "analytics",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    exam_session_id = table.Column<long>(type: "bigint", nullable: false),
                    question_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    answered_count = table.Column<int>(type: "integer", nullable: false),
                    average_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    score_rate = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_type_statistic", x => x.id);
                    table.ForeignKey(
                        name: "fk_type_statistic_exam_session_exam_session_id",
                        column: x => x.exam_session_id,
                        principalSchema: "delivery",
                        principalTable: "exam_session",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "uq_exam_statistic_session",
                schema: "analytics",
                table: "exam_statistic",
                column: "exam_session_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_question_statistic_question_id",
                schema: "analytics",
                table: "question_statistic",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_statistic_session_question",
                schema: "analytics",
                table: "question_statistic",
                columns: new[] { "exam_session_id", "question_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_type_statistic_session_type",
                schema: "analytics",
                table: "type_statistic",
                columns: new[] { "exam_session_id", "question_type" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "exam_statistic",
                schema: "analytics");

            migrationBuilder.DropTable(
                name: "question_statistic",
                schema: "analytics");

            migrationBuilder.DropTable(
                name: "type_statistic",
                schema: "analytics");
        }
    }
}
