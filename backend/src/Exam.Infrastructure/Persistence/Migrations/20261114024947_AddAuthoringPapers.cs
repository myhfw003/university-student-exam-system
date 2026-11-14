using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthoringPapers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "authoring");

            migrationBuilder.CreateTable(
                name: "paper",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    batch = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    total_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    duration_minutes = table.Column<int>(type: "integer", nullable: false),
                    pass_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    order_rule = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    variant_rule = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    answer_policy = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    allow_retake = table.Column<bool>(type: "boolean", nullable: false),
                    retake_keeps_best = table.Column<bool>(type: "boolean", nullable: false),
                    note = table.Column<string>(type: "text", nullable: true),
                    exam_rules = table.Column<string>(type: "jsonb", nullable: true),
                    practice_rules = table.Column<string>(type: "jsonb", nullable: true),
                    published_snapshot_id = table.Column<long>(type: "bigint", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper", x => x.id);
                    table.CheckConstraint("ck_paper_answer_policy", "answer_policy IN ('immediately','after_submit','after_close')");
                    table.CheckConstraint("ck_paper_duration", "duration_minutes BETWEEN 1 AND 300");
                    table.CheckConstraint("ck_paper_kind", "kind IN ('exam','practice')");
                    table.CheckConstraint("ck_paper_order_rule", "order_rule IN ('by_type','manual')");
                    table.CheckConstraint("ck_paper_rules_exclusive", "(kind = 'exam' AND exam_rules IS NOT NULL AND practice_rules IS NULL) OR (kind = 'practice' AND practice_rules IS NOT NULL AND exam_rules IS NULL)");
                    table.CheckConstraint("ck_paper_status", "status IN ('draft','published','archived')");
                    table.CheckConstraint("ck_paper_variant_rule", "variant_rule IN ('standard','small_plum','large_plum')");
                });

            migrationBuilder.CreateTable(
                name: "paper_item",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    section_id = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper_item", x => x.id);
                    table.CheckConstraint("ck_paper_item_score", "score >= 0 AND score <= 40");
                    table.ForeignKey(
                        name: "fk_paper_item_paper_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "paper_section",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    instructions = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper_section", x => x.id);
                    table.ForeignKey(
                        name: "fk_paper_section_paper_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "paper_tag",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    tag_id = table.Column<long>(type: "bigint", nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper_tag", x => x.id);
                    table.ForeignKey(
                        name: "fk_paper_tag_paper_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_paper_kind_status",
                schema: "authoring",
                table: "paper",
                columns: new[] { "kind", "status" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_paper_item_paper_order",
                schema: "authoring",
                table: "paper_item",
                columns: new[] { "paper_id", "sort_order" });

            migrationBuilder.CreateIndex(
                name: "ix_paper_item_question",
                schema: "authoring",
                table: "paper_item",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_paper_item_question",
                schema: "authoring",
                table: "paper_item",
                columns: new[] { "paper_id", "question_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_paper_section_paper",
                schema: "authoring",
                table: "paper_section",
                column: "paper_id");

            migrationBuilder.CreateIndex(
                name: "ix_paper_tag_tag",
                schema: "authoring",
                table: "paper_tag",
                column: "tag_id");

            migrationBuilder.CreateIndex(
                name: "uq_paper_tag",
                schema: "authoring",
                table: "paper_tag",
                columns: new[] { "paper_id", "tag_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "paper_item",
                schema: "authoring");

            migrationBuilder.DropTable(
                name: "paper_section",
                schema: "authoring");

            migrationBuilder.DropTable(
                name: "paper_tag",
                schema: "authoring");

            migrationBuilder.DropTable(
                name: "paper",
                schema: "authoring");
        }
    }
}
