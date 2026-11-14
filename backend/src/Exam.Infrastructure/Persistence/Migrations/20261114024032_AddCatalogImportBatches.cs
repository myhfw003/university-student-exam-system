using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogImportBatches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "import_batch",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    file_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    file_type = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    column_mapping = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    total_rows = table.Column<int>(type: "integer", nullable: false),
                    valid_rows = table.Column<int>(type: "integer", nullable: false),
                    invalid_rows = table.Column<int>(type: "integer", nullable: false),
                    adopted_count = table.Column<int>(type: "integer", nullable: false),
                    operator_id = table.Column<long>(type: "bigint", nullable: false),
                    object_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    adopted_by = table.Column<long>(type: "bigint", nullable: true),
                    adopted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("pk_import_batch", x => x.id);
                    table.CheckConstraint("ck_import_batch_file_type", "file_type IN ('csv','xlsx')");
                    table.CheckConstraint("ck_import_batch_status", "status IN ('parsed','adopted','failed')");
                });

            migrationBuilder.CreateTable(
                name: "import_row",
                schema: "catalog",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    batch_id = table.Column<long>(type: "bigint", nullable: false),
                    row_number = table.Column<int>(type: "integer", nullable: false),
                    raw = table.Column<string>(type: "jsonb", nullable: false),
                    parsed = table.Column<string>(type: "jsonb", nullable: true),
                    errors = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_import_row", x => x.id);
                    table.ForeignKey(
                        name: "fk_import_row_import_batch_batch_id",
                        column: x => x.batch_id,
                        principalSchema: "catalog",
                        principalTable: "import_batch",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_import_batch_created",
                schema: "catalog",
                table: "import_batch",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_import_batch_status",
                schema: "catalog",
                table: "import_batch",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "uq_import_row_batch_no",
                schema: "catalog",
                table: "import_row",
                columns: new[] { "batch_id", "row_number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "import_row",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "import_batch",
                schema: "catalog");
        }
    }
}
