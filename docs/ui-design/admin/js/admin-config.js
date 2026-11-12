/* ==========================================================================
   知行测评 · 管理端应用配置
   仅描述「管理端」这一侧的应用身份：存储键、导航、默认状态、身份信息与跨端链接。
   公共能力（外壳、路由、图标、图表、弹窗）见 ../shared/js/app.js，
   共享内容仓库（标签 / 题库 / 题目 / 试卷 / 练习）见 ../shared/js/catalog.js。
   本文件必须在 shared/js/app.js 之前载入。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = (global.EX = global.EX || {});

  EX.APP = {
    /* 应用标识：exam（答题端） / admin（管理端） */
    mode: "admin",

    /* 端内状态独立存放；共享内容统一存放在 shared/js/catalog.js */
    storageKey: "zhixing.admin.v1",

    /* 数据结构版本：结构变化时递增，旧存档将被丢弃以避免脏数据 */
    schema: 3,

    /* 顶栏副标题与跨端互链 */
    brandSub: "管理端 · 在线考试与练习平台",
    otherApp: { label: "答题端", href: "../exam/index.html" },

    /* 路由不可用时的兜底首页 */
    homeRoute: "admin.overview",

    /* 子路由归属的导航项（保持侧栏高亮一致） */
    navParent: {
      "admin.paper": "admin.papers",
      "admin.bank": "admin.banks"
    },

    /* 侧栏导航：按小节排列的菜单项；count(state) 返回角标数字 */
    nav: [
      {
        group: "内容",
        items: [
          { key: "admin.overview", label: "概览", icon: "grid" },
          { key: "admin.tags", label: "标签", icon: "target" },
          { key: "admin.banks", label: "题库", icon: "library" }
        ]
      },
      {
        group: "测评",
        items: [
          { key: "admin.papers", label: "组卷", icon: "shuffle" },
          {
            key: "admin.review",
            label: "阅卷中心",
            icon: "edit",
            count: function () {
              if (!EX.catalog || typeof EX.catalog.reviews !== "function") return 0;
              return EX.catalog.reviews().filter(function (r) { return r.status === "pending"; }).length;
            }
          },
          { key: "admin.analytics", label: "成绩分析", icon: "chart" }
        ]
      }
    ],

    /* 端内默认状态 */
    state: function () {
      return {
        schema: EX.APP.schema,
        theme: "light",
        route: { key: "admin.overview", params: {} },
        adminName: "陈砚之",
        adminTitle: "内容管理员",
        lastSavedAt: null
      };
    },

    /* 顶栏右上角的当前身份 */
    identity: function (state) {
      return {
        name: state.adminName || "内容管理员",
        meta: state.adminTitle || "",
        initial: (state.adminName || "管").slice(0, 1)
      };
    }
  };
})(window);
