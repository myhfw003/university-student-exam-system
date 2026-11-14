using System.Text;
using Exam.Infrastructure.Identity;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Identity;

public sealed class UserRosterCsvParserTests
{
    private readonly UserRosterCsvParser _parser = new();

    [Fact]
    public void 中文表头能解析成标准字段()
    {
        var csv = "账号,姓名,学院,专业,班级,邮箱,角色\n20230001,张三,计算机学院,计算机科学与技术,计科2301班,a@b.edu,student\n";

        var rows = _parser.Parse(Encoding.UTF8.GetBytes(csv), "名单.csv");

        rows.Count.ShouldBe(1);
        rows[0].RowNumber.ShouldBe(2);
        rows[0].Account.ShouldBe("20230001");
        rows[0].Name.ShouldBe("张三");
        rows[0].Faculty.ShouldBe("计算机学院");
        rows[0].Major.ShouldBe("计算机科学与技术");
        rows[0].Class.ShouldBe("计科2301班");
        rows[0].Email.ShouldBe("a@b.edu");
        rows[0].Role.ShouldBe("student");
    }

    [Fact]
    public void 英文表头同样能解析()
    {
        var csv = "account,name,faculty,major,class\n20230002,李四,数学学院,数学,数应2301班\n";

        var rows = _parser.Parse(Encoding.UTF8.GetBytes(csv), "roster.csv");

        rows[0].Account.ShouldBe("20230002");
        rows[0].Class.ShouldBe("数应2301班");
    }

    [Fact]
    public void GB18030编码能被正确识别()
    {
        var csv = "账号,姓名\n20230003,王五\n";
        var bytes = Encoding.GetEncoding("GB18030").GetBytes(csv);

        var rows = _parser.Parse(bytes, "名单.csv");

        rows[0].Name.ShouldBe("王五");
    }

    [Fact]
    public void 缺少账号列时报错并说明原因()
    {
        var csv = "姓名,学院\n张三,计算机学院\n";

        var act = () => _parser.Parse(Encoding.UTF8.GetBytes(csv), "名单.csv");

        var ex = act.ShouldThrow<Exam.Domain.SharedKernel.Exceptions.BusinessRuleException>();
        ex.Message.ShouldContain("账号");
    }

    [Fact]
    public void 空文件报错()
    {
        var act = () => _parser.Parse([], "名单.csv");

        act.ShouldThrow<Exam.Domain.SharedKernel.Exceptions.BusinessRuleException>();
    }

    [Fact]
    public void 全空行被跳过不计入总数()
    {
        var csv = "账号,姓名\n\n20230004,赵六\n\n";

        var rows = _parser.Parse(Encoding.UTF8.GetBytes(csv), "名单.csv");

        rows.Count.ShouldBe(1);
        rows[0].Account.ShouldBe("20230004");
    }
}
