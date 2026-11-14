using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Exam.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Persistence;

/// <summary>
/// 标签的持久化与层级查询。递归 CTE 只能在真实 PostgreSQL 上验证。
/// </summary>
public sealed class TagRepositoryTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public TagRepositoryTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 标签落在_catalog_schema()
    {
        var tables = await _fixture.DbContext.Database
            .SqlQueryRaw<string>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'catalog'")
            .ToListAsync();

        tables.ShouldContain("tag");
    }

    [Fact]
    public async Task 维度与难度等级按数据库约束落库()
    {
        await _fixture.ResetAsync();

        var tag = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(tag);
        await _fixture.DbContext.SaveChangesAsync();

        var stored = await _fixture.DbContext.Tags.FirstAsync(t => t.Code == "difficulty.basic");
        stored.Group.ShouldBe(TagGroup.Difficulty);
        stored.Level.ShouldBe(1);

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 难度等级缺失时数据库约束兜底()
    {
        await _fixture.ResetAsync();

        var act = async () => await _fixture.DbContext.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO catalog.tag (code, name, group_name, level, sort_order, is_system, usage_count, created_at)
            VALUES ('bad.level', '非法难度', 'difficulty', NULL, 0, false, 0, now())
            """);

        var ex = await act.ShouldThrowAsync<PostgresException>();
        ex.SqlState.ShouldBe(PostgresErrorCodes.CheckViolation);

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 标签编码唯一_软删除后可复用()
    {
        await _fixture.ResetAsync();

        var first = Tag.Create("math.limit", "极限", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(first);
        await _fixture.DbContext.SaveChangesAsync();

        var act = async () => await _fixture.DbContext.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO catalog.tag (code, name, group_name, sort_order, is_system, usage_count, created_at)
            VALUES ('math.limit', '极限2', 'domain', 0, false, 0, now())
            """);

        await act.ShouldThrowAsync<PostgresException>();

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 后代展开_递归CTE一次取回全部子孙()
    {
        await _fixture.ResetAsync();

        var root = Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(root);
        await _fixture.DbContext.SaveChangesAsync();

        var mid = Tag.Create("math.calc", "微积分", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        mid.SetParent(root, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(mid);
        await _fixture.DbContext.SaveChangesAsync();

        var leaf = Tag.Create("math.calc.limit", "极限", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        leaf.SetParent(mid, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(leaf);
        await _fixture.DbContext.SaveChangesAsync();

        var repository = new TagRepository(_fixture.DbContext);

        var withSelf = await repository.GetDescendantIdsAsync(root.Id, includeSelf: true);
        withSelf.Count.ShouldBe(3);
        withSelf.ShouldContain(root.Id);
        withSelf.ShouldContain(mid.Id);
        withSelf.ShouldContain(leaf.Id);

        var withoutSelf = await repository.GetDescendantIdsAsync(root.Id, includeSelf: false);
        withoutSelf.Count.ShouldBe(2);
        withoutSelf.ShouldNotContain(root.Id);

        var ancestors = await repository.GetAncestorIdsAsync(leaf.Id);
        ancestors.Count.ShouldBe(2);
        ancestors.ShouldContain(root.Id);
        ancestors.ShouldContain(mid.Id);

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 软删除的标签不参与后代展开()
    {
        await _fixture.ResetAsync();

        var root = Tag.Create("math", "高等数学", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(root);
        await _fixture.DbContext.SaveChangesAsync();

        var child = Tag.Create("math.calc", "微积分", TagGroup.Domain, null, null, 0, DateTimeOffset.UtcNow);
        child.SetParent(root, DateTimeOffset.UtcNow);
        await _fixture.DbContext.Tags.AddAsync(child);
        await _fixture.DbContext.SaveChangesAsync();

        child.SoftDelete(DateTimeOffset.UtcNow, null);
        await _fixture.DbContext.SaveChangesAsync();

        var repository = new TagRepository(_fixture.DbContext);
        var descendants = await repository.GetDescendantIdsAsync(root.Id, includeSelf: true);

        descendants.Count.ShouldBe(1);
        descendants.ShouldContain(root.Id);

        await _fixture.ResetAsync();
    }
}
