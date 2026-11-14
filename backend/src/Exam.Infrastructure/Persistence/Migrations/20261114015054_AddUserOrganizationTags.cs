using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserOrganizationTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_tag",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    tag_id = table.Column<long>(type: "bigint", nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_tag", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_user_tag_tag",
                schema: "iam",
                table: "user_tag",
                column: "tag_id");

            migrationBuilder.CreateIndex(
                name: "uq_user_tag",
                schema: "iam",
                table: "user_tag",
                columns: new[] { "user_id", "tag_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_tag",
                schema: "iam");
        }
    }
}
