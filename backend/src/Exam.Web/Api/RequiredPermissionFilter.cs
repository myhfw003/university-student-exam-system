using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Exam.Web.Api;

/// <summary>
/// 把接口要求的权限码写进 OpenAPI 契约（扩展字段 <c>x-required-permission</c>）。
/// <para>
/// 契约里带上权限码，前端就知道每个接口要什么权限、能不能在本地直接调；
/// 端到端测试也能据此逐条断言「没有权限的令牌必须被拒」，
/// 而不是靠人工维护一份接口与权限的对照表。
/// </para>
/// </summary>
public sealed class RequiredPermissionFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var policy = context.ApiDescription.ActionDescriptor.EndpointMetadata
            .OfType<AuthorizeAttribute>()
            .Select(attribute => attribute.Policy)
            .FirstOrDefault(p => !string.IsNullOrWhiteSpace(p));

        if (string.IsNullOrWhiteSpace(policy))
        {
            return;
        }

        operation.Extensions ??= new Dictionary<string, IOpenApiExtension>();
        operation.Extensions["x-required-permission"] = new JsonNodeExtension(JsonValue.Create(policy)!);
    }
}
