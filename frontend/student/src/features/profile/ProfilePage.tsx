/* ==========================================================================
   知行测评 · 学生端个人中心
   --------------------------------------------------------------------------
   对应原型 student.profile。四个区块：账号信息、演示切换答题者、
   本地数据管理、界面偏好与考试须知。

   「清除本地数据」是真操作：重置内存中的示例数据仓库、IndexedDB 草稿与
   上行队列、以及两个会话 store，行为与原型「恢复为初始示例数据」一致。
   ========================================================================== */

import { useState } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  RuleList,
  Segmented,
  SelectInput,
  toast,
} from "@exam/shared";
import { MULTI_POLICY } from "@exam/shared/engine/scoring";
import { className, resetCatalog, useCatalog } from "@exam/shared/mock/catalog";
import { useThemeStore, type Theme } from "@/app/themeStore";
import { resetDraftStore } from "@/stores/draftQueue";
import { useExamSessionStore } from "@/stores/examSessionStore";
import { usePracticeSessionStore } from "@/stores/practiceSessionStore";
import { useStudentStore } from "@/stores/studentStore";

/** 个人中心。 */
export function ProfilePage() {
  const studentId = useStudentStore((state) => state.studentId);
  const setStudentId = useStudentStore((state) => state.setStudentId);
  const students = useCatalog((state) => state.students);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const current = students.find((s) => s.id === studentId);

  const handleClear = async (): Promise<void> => {
    setClearing(true);
    try {
      resetCatalog();
      await resetDraftStore();
      useExamSessionStore.getState().resetAll();
      usePracticeSessionStore.getState().resetAll();
      setConfirmOpen(false);
      toast.ok("本地数据已清除，已恢复为初始示例数据");
    } catch {
      toast.error("清除失败，请重试");
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">个人中心</h1>
          <p className="page-sub">账号信息、界面偏好与本地数据管理。</p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <Card title="账号信息">
            <dl className="kv">
              <dt>姓名</dt>
              <dd>{current?.name ?? "—"}</dd>
              <dt>编号</dt>
              <dd className="mono">{current?.id ?? studentId}</dd>
              <dt>名单组</dt>
              <dd>{current ? className(current.classId) : "—"}</dd>
              <dt>加入年份</dt>
              <dd className="num">{current?.enrollYear ?? "—"}</dd>
            </dl>
          </Card>

          <Card title="演示：切换答题者">
            <Field
              htmlFor="stu-switch"
              label="当前答题者"
              hint="原型演示用：切换后可查看不同答题者拿到的卷面差异——标准卷完全一致；小梅花选项顺序不同、题序一致；大梅花题型分块顺序一致、组内题序与选项顺序均不同。"
            >
              <SelectInput
                id="stu-switch"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}（{student.id} · {className(student.classId)}）
                  </option>
                ))}
              </SelectInput>
            </Field>
          </Card>

          <Card title="本地数据">
            <p className="section-note" style={{ marginBottom: "var(--sp-3)" }}>
              作答记录、练习结果与阅卷进度保存在本机浏览器中。清除后将恢复为初始示例数据。
            </p>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              清除本地数据
            </Button>
          </Card>
        </div>

        <div className="stack">
          <Card title="界面偏好">
            <Field
              label="主题"
              hint="深色主题使用独立取色，保证正文对比度不低于 4.5:1。"
            >
              <Segmented<Theme>
                label="主题"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                ]}
              />
            </Field>
          </Card>

          <Card title="考试须知">
            <RuleList
              items={[
                "客观题交卷后自动判分，主观题由阅卷人复核。",
                MULTI_POLICY,
                "考试期间可标记题目，交卷前用答题卡逐一核对。",
              ]}
            />
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="清除本地数据"
        message="将删除本机保存的作答记录、练习结果与阅卷进度，并恢复为初始示例数据。此操作不可撤销。"
        confirmText={clearing ? "清除中…" : "确认清除"}
        confirmVariant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleClear}
      />
    </>
  );
}
