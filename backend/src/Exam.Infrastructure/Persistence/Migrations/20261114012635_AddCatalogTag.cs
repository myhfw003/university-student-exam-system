using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "catalog");

            migrationBuilder.CreateTable(
                name: "tag",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    group_name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    parent_id = table.Column<long>(type: "bigint", nullable: true),
                    level = table.Column<int>(type: "integer", nullable: true),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    is_system = table.Column<bool>(type: "boolean", nullable: false),
                    usage_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<long>(type: "bigint", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<long>(type: "bigint", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tag", x => x.id);
                    table.CheckConstraint("ck_tag_group_name", "group_name IN ('domain','knowledge_point','ability','difficulty','organization')");
                    table.CheckConstraint("ck_tag_level_by_group", "(group_name = 'difficulty' AND level IS NOT NULL AND level BETWEEN 1 AND 5 AND parent_id IS NULL) OR (group_name <> 'difficulty' AND level IS NULL)");
                    table.ForeignKey(
                        name: "fk_tag_tag_parent_id",
                        column: x => x.parent_id,
                        principalSchema: "catalog",
                        principalTable: "tag",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tag_group",
                schema: "catalog",
                table: "tag",
                column: "group_name",
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tag_parent",
                schema: "catalog",
                table: "tag",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "uq_tag_code",
                schema: "catalog",
                table: "tag",
                column: "code",
                unique: true,
                filter: "deleted_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tag",
                schema: "catalog");
        }
    }
}
