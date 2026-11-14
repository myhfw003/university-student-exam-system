using Exam.Infrastructure.IntegrationTests.Persistence;
using Npgsql;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Grading;

/// <summary>
/// 改分流水的权限约束。
/// <para>
/// 流水只能往前写：应用账号对它没有 UPDATE / DELETE 权限。
/// 改分赖不掉——流水改不了、删不了。
/// </para>
/// </summary>
public sealed class GradeRevisionPermissionTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public GradeRevisionPermissionTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 应用账号只能插入改分流水不能改删()
    {
        await _fixture.ResetAsync();

        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();

        await ExecuteAsync(connection, """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exam_app') THEN
                    CREATE ROLE exam_app LOGIN;
                END IF;
            END
            $$;
            """);

        // 按部署脚本给应用账号授权。
        var script = await File.ReadAllTextAsync(GrantScriptPath());
        script = script.Replace("ALTER ROLE exam_app PASSWORD :'app_password';", string.Empty);
        await ExecuteAsync(connection, script);

        // 以应用账号身份插入流水：允许。
        await ExecuteAsync(connection, """
            SET SESSION AUTHORIZATION exam_app;
            INSERT INTO app.grade_revision
                (score_result_id, previous_score, new_score, comment, operator_id, occurred_at)
            VALUES (1, 5.00, 7.50, '要点 1、2 覆盖到位', 1, now());
            """);

        var inserted = await ExecuteScalarAsync(connection, "SELECT count(*) FROM app.grade_revision;");
        inserted.Trim().ShouldBe("1");

        // 权限矩阵：只能读与写，不能改与删。
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            var granted = await ExecuteScalarAsync(
                connection,
                $"SELECT has_table_privilege('exam_app', 'app.grade_revision', '{privilege}');");
            granted.Trim().ShouldBe("True");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE" })
        {
            var granted = await ExecuteScalarAsync(
                connection,
                $"SELECT has_table_privilege('exam_app', 'app.grade_revision', '{privilege}');");
            granted.Trim().ShouldBe("False");
        }

        // 改：拒绝。
        var update = await TryExecuteAsync(
            connection,
            "SET SESSION AUTHORIZATION exam_app; UPDATE app.grade_revision SET new_score = 10;");
        update.ShouldBeTrue();

        // 删：拒绝。
        var delete = await TryExecuteAsync(
            connection,
            "SET SESSION AUTHORIZATION exam_app; DELETE FROM app.grade_revision;");
        delete.ShouldBeTrue();
    }

    /// <summary>授权脚本路径：从测试程序集目录往上找到仓库根。</summary>
    private static string GrantScriptPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "deploy", "db", "02-grant-app-role.sql")))
        {
            directory = directory.Parent;
        }

        if (directory is null)
        {
            throw new FileNotFoundException("找不到授权脚本 deploy/db/02-grant-app-role.sql。");
        }

        return Path.Combine(directory.FullName, "deploy", "db", "02-grant-app-role.sql");
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<string> ExecuteScalarAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        var value = await command.ExecuteScalarAsync();
        return value is null
            ? string.Empty
            : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
    }

    /// <summary>执行并忽略权限错误，返回是否被拒绝。</summary>
    private static async Task<bool> TryExecuteAsync(NpgsqlConnection connection, string sql)
    {
        try
        {
            await using var command = new NpgsqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync();
            return false;
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            return true;
        }
    }
}
