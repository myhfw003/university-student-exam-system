-- 由 postgres 容器在初始化时执行：创建应用运行账号（此处不设密码，
-- 密码在迁移完成后的授权步骤统一设置，避免密码出现在镜像与仓库中）。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exam_app') THEN
        CREATE ROLE exam_app LOGIN;
    END IF;
END
$$;
