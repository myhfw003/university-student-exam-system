using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Exam.Infrastructure.Identity;

/// <summary>
/// RS256 令牌服务。
/// <para>未配置私钥时会在启动时临时生成一把 RSA 密钥（仅用于本地开发，重启后已签发令牌失效）。</para>
/// </summary>
public sealed class JwtTokenService : ITokenService
{
    private readonly JwtOptions _options;
    private readonly JwtKeyProvider _keys;
    private readonly byte[] _pepper;

    public JwtTokenService(IOptions<JwtOptions> options, JwtKeyProvider keys)
    {
        _options = options.Value;
        _keys = keys;

        _pepper = string.IsNullOrWhiteSpace(_options.RefreshTokenPepper)
            ? Encoding.UTF8.GetBytes("exam-dev-refresh-pepper")
            : Encoding.UTF8.GetBytes(_options.RefreshTokenPepper);
    }

    public AccessTokenMaterial IssueAccessToken(
        long userId,
        string username,
        IReadOnlyCollection<string> permissions,
        bool mustChangePassword = false)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.AddMinutes(Math.Max(1, _options.AccessTokenMinutes));
        var jti = Guid.NewGuid().ToString("N");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, jti),
            new(JwtRegisteredClaimNames.UniqueName, username),
            new(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64),
            // 毫秒精度的签发时间：账号被重置密码后要按签发时间吊销旧令牌，
            // 只靠整秒的 iat 会把「重置后同一秒登录」的新令牌误判成旧令牌。
            new("iat_ms", now.ToUnixTimeMilliseconds().ToString()),
        };

        claims.AddRange(permissions.Select(p => new Claim("perm", p)));

        // 强制改密标记：管理员重置密码或导入名单后，令牌带上它，
        // 期间只放行改密、查看本人档案与登出。
        if (mustChangePassword)
        {
            claims.Add(new Claim("must_change_password", "true"));
        }

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: _keys.SigningCredentials);

        return new AccessTokenMaterial(new JwtSecurityTokenHandler().WriteToken(token), jti, expiresAt);
    }

    public RefreshTokenMaterial IssueRefreshToken(long userId, Guid familyId)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var expiresAt = DateTimeOffset.UtcNow.AddDays(Math.Max(1, _options.RefreshTokenDays));
        return new RefreshTokenMaterial(raw, HashRefreshToken(raw), expiresAt);
    }

    public string HashRefreshToken(string rawToken)
    {
        using var hmac = new HMACSHA256(_pepper);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(hash);
    }
}
