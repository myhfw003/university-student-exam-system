using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthoringPaperTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "paper_template",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    variant_rule = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    duration_minutes = table.Column<int>(type: "integer", nullable: false),
                    pass_score = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    source_paper_id = table.Column<long>(type: "bigint", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper_template", x => x.id);
                    table.CheckConstraint("ck_paper_template_duration", "duration_minutes BETWEEN 1 AND 300");
                    table.CheckConstraint("ck_paper_template_kind", "kind IN ('exam','practice')");
                    table.CheckConstraint("ck_paper_template_variant_rule", "variant_rule IN ('standard','small_plum','large_plum')");
                });

            migrationBuilder.CreateTable(
                name: "template_item",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    template_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_template_item", x => x.id);
                    table.CheckConstraint("ck_template_item_score", "score >= 0 AND score <= 40");
                    table.ForeignKey(
                        name: "fk_template_item_paper_template_template_id",
                        column: x => x.template_id,
                        principalSchema: "authoring",
                        principalTable: "paper_template",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_paper_template_name",
                schema: "authoring",
                table: "paper_template",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_template_item_template",
                schema: "authoring",
                table: "template_item",
                columns: new[] { "template_id", "sort_order" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "template_item",
                schema: "authoring");

            migrationBuilder.DropTable(
                name: "paper_template",
                schema: "authoring");
        }
    }
}
