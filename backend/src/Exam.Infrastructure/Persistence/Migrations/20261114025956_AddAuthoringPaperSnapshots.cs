using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuthoringPaperSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "paper_snapshot",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    paper_id = table.Column<long>(type: "bigint", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_paper_snapshot", x => x.id);
                    table.ForeignKey(
                        name: "fk_paper_snapshot_paper_paper_id",
                        column: x => x.paper_id,
                        principalSchema: "authoring",
                        principalTable: "paper",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "snapshot_item",
                schema: "authoring",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    snapshot_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    question_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    question_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    stem = table.Column<string>(type: "text", nullable: false),
                    options = table.Column<string>(type: "jsonb", nullable: false),
                    correct_keys = table.Column<string[]>(type: "text[]", nullable: false),
                    keypoints = table.Column<string>(type: "jsonb", nullable: false),
                    steps = table.Column<string>(type: "jsonb", nullable: false),
                    analysis = table.Column<string>(type: "text", nullable: true),
                    reference_answer = table.Column<string>(type: "text", nullable: true),
                    attachments = table.Column<string>(type: "jsonb", nullable: false),
                    score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    section_title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_snapshot_item", x => x.id);
                    table.CheckConstraint("ck_snapshot_item_score", "score >= 0 AND score <= 40");
                    table.ForeignKey(
                        name: "fk_snapshot_item_paper_snapshot_snapshot_id",
                        column: x => x.snapshot_id,
                        principalSchema: "authoring",
                        principalTable: "paper_snapshot",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "uq_snapshot_paper_version",
                schema: "authoring",
                table: "paper_snapshot",
                columns: new[] { "paper_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_snapshot_item_snapshot",
                schema: "authoring",
                table: "snapshot_item",
                columns: new[] { "snapshot_id", "sort_order" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "snapshot_item",
                schema: "authoring");

            migrationBuilder.DropTable(
                name: "paper_snapshot",
                schema: "authoring");
        }
    }
}
