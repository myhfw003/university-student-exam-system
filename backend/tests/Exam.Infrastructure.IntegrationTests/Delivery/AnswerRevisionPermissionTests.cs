using Exam.Infrastructure.IntegrationTests.Persistence;
using Npgsql;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Delivery;

/// <summary>
/// 答案修订流水的权限约束。
/// <para>
/// 流水表只能往前写：应用账号对它没有 UPDATE / DELETE 权限。
/// 授权脚本一旦被改松，这里就会红。
/// </para>
/// </summary>
public sealed class AnswerRevisionPermissionTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public AnswerRevisionPermissionTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 应用账号只能插入答案流水不能改删()
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
            INSERT INTO app.answer_revision
                (attempt_id, question_id, client_seq, payload, revision, server_received_at)
            VALUES (1, 1, 1, '{"selectedOptionKeys":["A"]}'::jsonb, 1, now());
            """);

        var inserted = await ExecuteScalarAsync(connection, "SELECT count(*) FROM app.answer_revision;");
        inserted.Trim().ShouldBe("1");

        // 权限矩阵：只能读与写，不能改与删。
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            var granted = await ExecuteScalarAsync(
                connection,
                $"SELECT has_table_privilege('exam_app', 'app.answer_revision', '{privilege}');");
            granted.Trim().ShouldBe("True");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE" })
        {
            var granted = await ExecuteScalarAsync(
                connection,
                $"SELECT has_table_privilege('exam_app', 'app.answer_revision', '{privilege}');");
            granted.Trim().ShouldBe("False");
        }

        // 改：拒绝。
        var update = await TryExecuteAsync(
            connection,
            "SET SESSION AUTHORIZATION exam_app; UPDATE app.answer_revision SET revision = 2;");
        update.ShouldBeTrue();

        // 删：拒绝。
        var delete = await TryExecuteAsync(
            connection,
            "SET SESSION AUTHORIZATION exam_app; DELETE FROM app.answer_revision;");
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
        return value is null ? string.Empty : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
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
