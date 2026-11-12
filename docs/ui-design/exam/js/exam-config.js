/* ==========================================================================
   知行测评 · 答题端应用配置
   仅描述「答题端」这一侧的应用身份：存储键、导航、默认状态、身份信息与跨端链接。
   公共能力（外壳、路由、图标、图表、弹窗）见 ../shared/js/app.js，
   共享内容仓库（标签 / 题库 / 题目 / 试卷 / 练习）见 ../shared/js/catalog.js。
   本文件必须在 shared/js/app.js 之前载入。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = (global.EX = global.EX || {});

  EX.APP = {
    /* 应用标识：exam（答题端） / admin（管理端） */
    mode: "exam",

    /* 端内状态独立存放；共享内容统一存放在 shared/js/catalog.js */
    storageKey: "zhixing.student.v1",

    /* 数据结构版本：结构变化时递增，旧存档将被丢弃以避免脏数据 */
    schema: 3,

    /* 顶栏副标题与跨端互链 */
    brandSub: "在线考试与练习平台",
    otherApp: { label: "管理端", href: "../admin/index.html" },

    /* 路由不可用时的兜底首页 */
    homeRoute: "student.dashboard",

    /* 子路由归属的导航项（保持侧栏高亮一致） */
    navParent: {},

    /* 侧栏导航：按小节排列的菜单项；count(state) 返回角标数字 */
    nav: [
      {
        group: "学习",
        items: [
          { key: "student.dashboard", label: "工作台", icon: "grid" },
          { key: "student.practice", label: "练习中心", icon: "book" },
          { key: "student.exams", label: "考试安排", icon: "clipboard" },
          {
            key: "student.mistakes",
            label: "错题本",
            icon: "alert",
            count: function (state) {
              return (state.mistakes || []).filter(function (m) {
                return !m.studentId || m.studentId === state.studentId;
              }).length;
            }
          }
        ]
      },
      {
        group: "记录",
        items: [
          { key: "student.reports", label: "成绩报告", icon: "chart" },
          { key: "student.profile", label: "个人中心", icon: "user" }
        ]
      }
    ],

    /* 端内默认状态 */
    state: function () {
      return {
        schema: EX.APP.schema,
        studentId: "2023120101",
        theme: "light",
        route: { key: "student.dashboard", params: {} },
        examSessions: {},
        practiceSessions: {},
        practiceResults: {},
        attempts: {},
        mistakes: ((EX.seed && EX.seed.mistakes) || []).map(function (m) {
          return {
            qid: m.qid,
            studentId: m.studentId || "2023120101",
            wrongCount: m.wrongCount,
            lastWrongAt: m.lastWrongAt,
            reason: m.reason
          };
        }),
        lastSavedAt: null
      };
    },

    /* 顶栏右上角的当前身份 */
    identity: function (state) {
      var student = (EX.seed.getStudent(state.studentId) || EX.seed.students[0]) || {};
      return {
        name: student.name || "",
        meta: (student.id || "") + (student.className ? " · " + student.className : ""),
        initial: (student.name || "答").slice(0, 1)
      };
    }
  };
})(window);
