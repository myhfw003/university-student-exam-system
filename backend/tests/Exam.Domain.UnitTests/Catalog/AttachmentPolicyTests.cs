using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

public sealed class AttachmentPolicyTests
{
    private static readonly byte[] PngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
    private static readonly byte[] JpegHeader = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    private static readonly byte[] WebpHeader = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

    [Fact]
    public void 三种图片类型都放行并给出扩展名()
    {
        AttachmentPolicy.EnsureAllowed("image/png", 1024, PngHeader).ShouldBe(".png");
        AttachmentPolicy.EnsureAllowed("image/jpeg", 1024, JpegHeader).ShouldBe(".jpg");
        AttachmentPolicy.EnsureAllowed("image/webp", 1024, WebpHeader).ShouldBe(".webp");
    }

    [Fact]
    public void 白名单之外的类型被拒绝()
    {
        var act = () => AttachmentPolicy.EnsureAllowed("application/pdf", 1024, PngHeader);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("png");
    }

    [Fact]
    public void 超过大小上限被拒绝()
    {
        var act = () => AttachmentPolicy.EnsureAllowed("image/png", AttachmentPolicy.MaxSizeBytes + 1, PngHeader);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 空文件被拒绝()
    {
        var act = () => AttachmentPolicy.EnsureAllowed("image/png", 0, PngHeader);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 内容与声明类型不一致时拒绝()
    {
        // 声明是 png，内容却是 jpeg：不能只信扩展名或 Content-Type。
        var act = () => AttachmentPolicy.EnsureAllowed("image/png", 1024, JpegHeader);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("不一致");
    }

    [Fact]
    public void 空文件头无法匹配任何类型()
    {
        AttachmentPolicy.MatchesMagicBytes("image/png", ReadOnlySpan<byte>.Empty).ShouldBeFalse();
        AttachmentPolicy.MatchesMagicBytes("image/jpeg", ReadOnlySpan<byte>.Empty).ShouldBeFalse();
        AttachmentPolicy.MatchesMagicBytes("image/webp", ReadOnlySpan<byte>.Empty).ShouldBeFalse();
    }
}
