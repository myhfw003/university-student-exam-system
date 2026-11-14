using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>
/// 附件准入规则。
/// <para>
/// 只接受 png / jpg / webp 三种图片，且大小受限。
/// <b>不信任扩展名</b>：文件头必须与声明的类型一致，否则拒收。
/// </para>
/// </summary>
public static class AttachmentPolicy
{
    /// <summary>允许的内容类型 → 文件扩展名。</summary>
    public static IReadOnlyDictionary<string, string> AllowedContentTypes { get; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["image/png"] = ".png",
            ["image/jpeg"] = ".jpg",
            ["image/webp"] = ".webp",
        };

    /// <summary>单个附件大小上限：10 MB。</summary>
    public const long MaxSizeBytes = 10 * 1024 * 1024;

    /// <summary>校验附件并返回应使用的扩展名。</summary>
    /// <param name="contentType">声明的内容类型。</param>
    /// <param name="size">文件字节数。</param>
    /// <param name="header">文件头前若干字节，用于内容嗅探。</param>
    public static string EnsureAllowed(string? contentType, long size, ReadOnlySpan<byte> header)
    {
        if (string.IsNullOrWhiteSpace(contentType))
        {
            throw new BusinessRuleException("附件缺少内容类型。");
        }

        if (!AllowedContentTypes.TryGetValue(contentType.Trim(), out var extension))
        {
            throw new BusinessRuleException("只允许上传 png、jpg、webp 格式的图片。");
        }

        if (size <= 0)
        {
            throw new BusinessRuleException("附件内容为空。");
        }

        if (size > MaxSizeBytes)
        {
            throw new BusinessRuleException($"附件大小不能超过 {MaxSizeBytes / 1024 / 1024} MB。");
        }

        if (!MatchesMagicBytes(contentType.Trim(), header))
        {
            throw new BusinessRuleException("附件内容与声明的类型不一致，已拒绝。");
        }

        return extension;
    }

    /// <summary>文件头嗅探：只看魔数，不看扩展名。</summary>
    public static bool MatchesMagicBytes(string contentType, ReadOnlySpan<byte> header)
    {
        switch (contentType.ToLowerInvariant())
        {
            case "image/png":
                return header.Length >= 8
                    && header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47
                    && header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A;

            case "image/jpeg":
                return header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF;

            case "image/webp":
                return header.Length >= 12
                    && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46
                    && header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50;

            default:
                return false;
        }
    }
}
