# ---------- 构建 ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# 先复制包管理文件，依赖层可缓存
COPY Directory.Build.props Directory.Packages.props global.json NuGet.config ./
COPY src/Exam.Domain/Exam.Domain.csproj                 src/Exam.Domain/
COPY src/Exam.Application/Exam.Application.csproj       src/Exam.Application/
COPY src/Exam.Infrastructure/Exam.Infrastructure.csproj src/Exam.Infrastructure/
COPY src/Exam.Web/Exam.Web.csproj                       src/Exam.Web/
COPY src/Exam.Worker/Exam.Worker.csproj                 src/Exam.Worker/
RUN dotnet restore src/Exam.Web/Exam.Web.csproj \
 && dotnet restore src/Exam.Worker/Exam.Worker.csproj

COPY . .
RUN dotnet publish src/Exam.Web/Exam.Web.csproj       -c Release -o /out/web       --no-restore \
 && dotnet publish src/Exam.Worker/Exam.Worker.csproj -c Release -o /out/worker     --no-restore

# ---------- 运行 ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out/web ./
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_gcServer=1
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Exam.Web.dll"]

FROM runtime AS worker
WORKDIR /app
COPY --from=build /out/worker ./
USER app
ENTRYPOINT ["dotnet", "Exam.Worker.dll"]
