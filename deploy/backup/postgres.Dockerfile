# 带 pgBackRest 的 PostgreSQL 镜像。
#
# 为什么自定义镜像：WAL 归档命令在数据库侧执行（archive_command），
# pgBackRest 的备份与归档要用同一套工具、同一份配置。
# 只装 pgbackrest，不改 PostgreSQL 本身的行为。
FROM postgres:17-alpine

RUN apk add --no-cache pgbackrest tzdata
