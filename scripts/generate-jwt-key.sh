#!/usr/bin/env bash
# 生成 RS256 签名密钥对。
#
# 产出两种注入方式（按可靠性排序）：
#   1. 文件：deploy/secrets/jwt-private.pem，挂载进容器，设 Jwt__SigningPrivateKeyPemFile
#   2. Base64：deploy/secrets/jwt-private.pem.b64（单行），设 Jwt__SigningPrivateKeyPemBase64
#
# 不要把多行 PEM 直接塞进 .env：换行会被转义成字面 \n，签名密钥解析会失败。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
secret_dir="$repo_root/deploy/secrets"
mkdir -p "$secret_dir"
chmod 700 "$secret_dir"

private_pem="$secret_dir/jwt-private.pem"
public_pem="$secret_dir/jwt-public.pem"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_pem" 2>/dev/null
openssl rsa -pubout -in "$private_pem" -out "$public_pem" 2>/dev/null
# 目录 0700 保证宿主机上只有属主能进入；文件本身放宽到 0644，
# 因为容器内进程以 uid 1654(app) 运行，需要能读挂载进来的密钥文件。
chmod 0644 "$private_pem" "$public_pem"

# Base64 单行形式（无换行、无转义字符，可安全放进 .env 或 K8s Secret）
# 注意顺序：先写再 chmod。反过来写的话，**首次运行**（.b64 还不存在）
# chmod 会因文件不存在而失败，脚本带 set -e 就直接退出——新机器上部署必踩。
base64 -w0 "$private_pem" > "$private_pem.b64"
chmod 0644 "$private_pem.b64"

cat <<OUT
密钥已生成。

文件形式（推荐用于 Docker / K8s）：
  私钥：$private_pem
  公钥：$public_pem
  compose 中设置：Jwt__SigningPrivateKeyPemFile=/run/secrets/jwt-private.pem

Base64 单行形式（推荐用于 .env）：
  文件：$private_pem.b64
  .env 中设置：JWT_SIGNING_PRIVATE_KEY_PEM_BASE64=<该文件内容>

公钥（供需要独立验签的服务使用）：
$(cat "$public_pem")
OUT
