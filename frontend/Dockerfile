# ---------- 构建 ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json   shared/
COPY student/package.json  student/
COPY admin/package.json    admin/
RUN pnpm install --frozen-lockfile

COPY . .

# shared 是源码包（exports 指向 src/index.ts），无需构建产物
RUN pnpm --filter @exam/student build
RUN pnpm --filter @exam/admin build
# 两个 SPA 的产物目录必须错开（学生端 /assets/，管理端 /admin/assets/）。
# 撞了不会让构建失败，但容器里管理端会整页空白，故在这里硬校验。
RUN node scripts/check-build-output.mjs

# ---------- 运行 ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/student/dist /usr/share/nginx/html
COPY --from=build /app/admin/dist    /usr/share/nginx/html/admin

# 入口门户页是静态 HTML，引用学生端产出的稳定文件名 app.css
COPY --from=build /app/portal/index.html /usr/share/nginx/html/portal/index.html

EXPOSE 80
