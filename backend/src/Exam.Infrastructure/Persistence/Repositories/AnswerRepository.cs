using System.Text;
using System.Text.Json;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AnswerRepository : IAnswerRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private readonly AppDbContext _db;

    public AnswerRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<Answer>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<Answer>()
            .AsNoTracking()
            .Where(a => a.AttemptId == attemptId)
            .OrderBy(a => a.QuestionId)
            .ToListAsync(cancellationToken);

    public Task<Answer?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default) =>
        _db.Set<Answer>()
            .FirstOrDefaultAsync(a => a.AttemptId == attemptId && a.QuestionId == questionId, cancellationToken);

    /// <summary>
    /// 原生 SQL upsert：一批答案一次往返。
    /// <para>
    /// 命中已有行就覆盖并把修订序号 +1；没有就插入（修订序号 1）。
    /// </para>
    /// </summary>
    public async Task UpsertRangeAsync(
        long attemptId,
        IReadOnlyList<AnswerUpsertValue> values,
        CancellationToken cancellationToken = default)
    {
        if (values.Count == 0)
        {
            return;
        }

        var sql = new StringBuilder();
        sql.Append(
            """
            INSERT INTO delivery.answer
                (attempt_id, question_id, paper_item_id, payload, is_blank, revision, client_seq, saved_at, created_at)
            SELECT @attempt_id, v.question_id, v.paper_item_id, v.payload, v.is_blank, 1, v.client_seq, v.saved_at, v.saved_at
            FROM (VALUES
            """);

        var parameters = new List<NpgsqlParameter>();
        var attemptParameter = new NpgsqlParameter("attempt_id", NpgsqlDbType.Bigint) { Value = attemptId };
        parameters.Add(attemptParameter);

        for (var i = 0; i < values.Count; i++)
        {
            if (i > 0)
            {
                sql.Append(',');
            }

            var value = values[i];
            sql.Append($"(@q{i}, @pi{i}, @pl{i}, @b{i}, @s{i}, @t{i})");

            parameters.Add(new NpgsqlParameter($"q{i}", NpgsqlDbType.Bigint) { Value = value.QuestionId });
            parameters.Add(new NpgsqlParameter($"pi{i}", NpgsqlDbType.Bigint)
            {
                Value = value.PaperItemId is null ? DBNull.Value : value.PaperItemId.Value,
            });
            parameters.Add(new NpgsqlParameter($"pl{i}", NpgsqlDbType.Jsonb)
            {
                Value = JsonSerializer.Serialize(value.Payload, JsonOptions),
            });
            parameters.Add(new NpgsqlParameter($"b{i}", NpgsqlDbType.Boolean) { Value = value.IsBlank });
            parameters.Add(new NpgsqlParameter($"s{i}", NpgsqlDbType.Integer) { Value = value.ClientSeq });
            parameters.Add(new NpgsqlParameter($"t{i}", NpgsqlDbType.TimestampTz) { Value = value.SavedAt });
        }

        sql.Append(
            """
            ) AS v(question_id, paper_item_id, payload, is_blank, client_seq, saved_at)
            ON CONFLICT (attempt_id, question_id) DO UPDATE SET
                payload = EXCLUDED.payload,
                is_blank = EXCLUDED.is_blank,
                revision = delivery.answer.revision + 1,
                client_seq = EXCLUDED.client_seq,
                saved_at = EXCLUDED.saved_at
            """);

        await _db.Database.ExecuteSqlRawAsync(
            sql.ToString(),
            parameters.Cast<object>().ToArray(),
            cancellationToken);
    }
}
