using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Exam.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// 出题教师补上「发布考试」的权限点。
    /// <para>
    /// 需求文档 §1 的权限矩阵里 <c>exam:read</c> / <c>exam:write</c> / <c>exam:publish</c>
    /// 三个都给出题教师，后端种子与前端矩阵原先也都这么写——只有后端种子漏了这一条，
    /// 结果出题教师组好卷、建好场次，却卡在「发布」上。
    /// </para>
    /// <para>
    /// 为什么要有这条迁移：种子数据只在**空库**上跑一次（<c>seed_markers</c> 有标记就跳过），
    /// 已经建好的库不会因为种子改了而跟着变。这条迁移把缺的那一条补到已有库上。
    /// </para>
    /// </summary>
    public partial class GrantAuthorTeacherExamPublish : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO iam.role_permission (role_id, permission_id, created_at)
                SELECT r.id, p.id, now()
                FROM iam.role r
                JOIN iam.permission p ON p.code = 'exam:publish'
                WHERE r.code = 'author_teacher'
                  AND r.deleted_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM iam.role_permission rp
                      WHERE rp.role_id = r.id AND rp.permission_id = p.id
                  );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM iam.role_permission rp
                USING iam.role r, iam.permission p
                WHERE rp.role_id = r.id
                  AND rp.permission_id = p.id
                  AND r.code = 'author_teacher'
                  AND p.code = 'exam:publish';
                """);
        }
    }
}
