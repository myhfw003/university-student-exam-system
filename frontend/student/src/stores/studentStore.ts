/* ==========================================================================
   知行测评 · 学生端身份与本地偏好
   --------------------------------------------------------------------------
   对齐原型的「演示：切换答题者」能力：所有会话、错题、成绩按 studentId 隔离。

   本地偏好（当前答题者、主题）存 localStorage；
   **作答数据不走这里**，作答数据由 draftQueue（IndexedDB）承载。
   ========================================================================== */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 学生端身份状态。 */
export interface StudentState {
  /** 当前答题者 ID。 */
  studentId: string;
  /** 设置当前答题者。 */
  setStudentId: (id: string) => void;
}

/** 默认答题者（原型演示的默认学生）。 */
export const DEFAULT_STUDENT_ID = "2023120101";

export const useStudentStore = create<StudentState>()(
  persist(
    (set) => ({
      studentId: DEFAULT_STUDENT_ID,
      setStudentId: (id) => set({ studentId: id }),
    }),
    {
      name: "zhixing.student.pref",
      // 只持久化偏好，不持久化作答数据。
      partialize: (state) => ({ studentId: state.studentId }),
    },
  ),
);
