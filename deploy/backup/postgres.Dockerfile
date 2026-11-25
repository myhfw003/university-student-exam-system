# 带 pgBackRest 的 PostgreSQL 镜像。
#
# 为什么自定义镜像：WAL 归档命令在数据库侧执行（archive_command），
# pgBackRest 的备份与归档要用同一套工具、同一份配置。
# 只装 pgbackrest，不改 PostgreSQL 本身的行为。
FROM postgres:17-alpine

# apk 源可配：国内构建走 Alpine 的国内镜像（默认仍是官方源）。
ARG ALPINE_MIRROR=
RUN if [ -n "$ALPINE_MIRROR" ]; then \
      sed -i "s#dl-cdn.alpinelinux.org#$ALPINE_MIRROR#" /etc/apk/repositories; \
    fi \
 && apk add --no-cache pgbackrest tzdata
