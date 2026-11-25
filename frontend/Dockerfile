# ---------- 构建 ----------
FROM node:24-alpine AS build
WORKDIR /app

# 包源可配：国内构建走 npmmirror（corepack 取 pnpm 版本列表也走它，
# 否则 corepack 直接找 registry.npmjs.org，在境内会超时）。
# 默认仍是官方源；deploy/docker-compose.yml 按部署环境传入。
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG COREPACK_NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY} \
    COREPACK_NPM_REGISTRY=${COREPACK_NPM_REGISTRY}
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json   shared/
COPY student/package.json  student/
COPY admin/package.json    admin/
RUN pnpm install --frozen-lockfile

COPY . .

# 产物默认连真实后端。
# 不设这两个变量时，前端构建走 mock 模式：内容数据来自 shared/src/mock 的本地
# 示例数据，页面一个后端请求都不发——那个产物发出去是个假系统，
# 题目、成绩、监考全是示例数据。同源部署（nginx 把 /api/ 反代到 api 服务）
# 用相对路径 /api/v1 即可，不必配基地址。
ARG VITE_DATA_SOURCE=http
ARG VITE_API_BASE_URL=
ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

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
