using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogQuestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "question",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    stem = table.Column<string>(type: "text", nullable: false),
                    default_score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    analysis = table.Column<string>(type: "text", nullable: true),
                    reference_answer = table.Column<string>(type: "text", nullable: true),
                    difficulty_tag_id = table.Column<long>(type: "bigint", nullable: false),
                    batch_id = table.Column<long>(type: "bigint", nullable: true),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question", x => x.id);
                    table.CheckConstraint("ck_question_default_score", "default_score > 0 AND default_score <= 40");
                    table.CheckConstraint("ck_question_source", "source IN ('manual','import','generated')");
                    table.CheckConstraint("ck_question_status", "status IN ('draft','published','disabled')");
                    table.CheckConstraint("ck_question_type", "type IN ('single','multi','judge','short','comprehensive')");
                });

            migrationBuilder.CreateTable(
                name: "question_bank",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_bank", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "question_attachment",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    object_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    file_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    content_type = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_attachment", x => x.id);
                    table.ForeignKey(
                        name: "fk_question_attachment_questions_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_keypoint",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    keywords = table.Column<string[]>(type: "text[]", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_keypoint", x => x.id);
                    table.ForeignKey(
                        name: "fk_question_keypoint_question_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_option",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    option_key = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    is_correct = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_option", x => x.id);
                    table.CheckConstraint("ck_question_option_key", "option_key IN ('A','B','C','D','E','F')");
                    table.ForeignKey(
                        name: "fk_question_option_question_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_step",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    step_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    prompt = table.Column<string>(type: "text", nullable: false),
                    reference_answer = table.Column<string>(type: "text", nullable: true),
                    keywords = table.Column<string[]>(type: "text[]", nullable: false),
                    score = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_step", x => x.id);
                    table.CheckConstraint("ck_question_step_score", "score > 0");
                    table.ForeignKey(
                        name: "fk_question_step_question_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_tag",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    tag_id = table.Column<long>(type: "bigint", nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_tag", x => x.id);
                    table.ForeignKey(
                        name: "fk_question_tag_question_question_id",
                        column: x => x.question_id,
                        principalSchema: "catalog",
                        principalTable: "question",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_bank_item",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    bank_id = table.Column<long>(type: "bigint", nullable: false),
                    question_id = table.Column<long>(type: "bigint", nullable: false),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_question_bank_item", x => x.id);
                    table.ForeignKey(
                        name: "fk_question_bank_item_question_bank_bank_id",
                        column: x => x.bank_id,
                        principalSchema: "catalog",
                        principalTable: "question_bank",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_question_batch",
                schema: "catalog",
                table: "question",
                column: "batch_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_difficulty",
                schema: "catalog",
                table: "question",
                column: "difficulty_tag_id",
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_question_status_type",
                schema: "catalog",
                table: "question",
                columns: new[] { "status", "type" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "uq_question_code",
                schema: "catalog",
                table: "question",
                column: "code",
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_question_attachment_q",
                schema: "catalog",
                table: "question_attachment",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_bank_name",
                schema: "catalog",
                table: "question_bank",
                column: "name",
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_question_bank_item_q",
                schema: "catalog",
                table: "question_bank_item",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_bank_item",
                schema: "catalog",
                table: "question_bank_item",
                columns: new[] { "bank_id", "question_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_question_keypoint_q",
                schema: "catalog",
                table: "question_keypoint",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_option_q",
                schema: "catalog",
                table: "question_option",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_option_key",
                schema: "catalog",
                table: "question_option",
                columns: new[] { "question_id", "option_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_question_step_q",
                schema: "catalog",
                table: "question_step",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_step_code",
                schema: "catalog",
                table: "question_step",
                columns: new[] { "question_id", "step_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_question_tag_tag",
                schema: "catalog",
                table: "question_tag",
                column: "tag_id");

            migrationBuilder.CreateIndex(
                name: "uq_question_tag",
                schema: "catalog",
                table: "question_tag",
                columns: new[] { "question_id", "tag_id" },
                unique: true);

            // 关键词检索走 ILIKE（中文没有词法切分，trigram 比 tsvector 更实用）。
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
            migrationBuilder.Sql("CREATE INDEX ix_question_code_trgm ON catalog.question USING gin (code gin_trgm_ops);");
            migrationBuilder.Sql("CREATE INDEX ix_question_stem_trgm ON catalog.question USING gin (stem gin_trgm_ops);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "question_attachment",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_bank_item",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_keypoint",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_option",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_step",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_tag",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "question_bank",
                schema: "catalog");

            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_question_stem_trgm;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_question_code_trgm;");

            migrationBuilder.DropTable(
                name: "question",
                schema: "catalog");
        }
    }
}
