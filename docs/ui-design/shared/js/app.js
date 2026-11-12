/* ==========================================================================
   知行测评 · 公共外壳
   路由、状态仓库、图标、图表、提示与对话框等与具体端无关的能力。
   两个独立应用共用本文件：答题端（exam/）与管理端（admin/）。
   应用身份（存储键、导航、默认状态、身份信息、跨端链接）由各端配置提供，
   见 exam/js/exam-config.js 与 admin/js/admin-config.js，
   本文件必须在配置之后载入。
   共享内容（标签 / 题库 / 题目 / 试卷 / 练习）统一存放在 shared/js/catalog.js。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = (global.EX = global.EX || {});
  var doc = global.document;

  /* ------------------------------------------------------------- 模式 */
  /* 应用身份由各端自己的配置文件提供（EX.APP），本文件不感知具体是哪一端。 */
  var CFG = global.EX && global.EX.APP ? global.EX.APP : null;
  if (!CFG) {
    throw new Error("应用配置缺失：请先载入本端配置（EX.APP），再载入 shared/js/app.js");
  }
  var APP_MODE = CFG.mode || "student";
  EX.appMode = APP_MODE;

  /* ------------------------------------------------------------- 状态 */
  var STORAGE_KEY = CFG.storageKey;
  /* 数据结构版本：结构变化时递增，旧存档将被丢弃以避免脏数据 */
  var SCHEMA_VERSION = CFG.schema || 3;

  var defaultState = function () {
    return typeof CFG.state === "function" ? CFG.state() : {};
  };

  var store = {
    state: defaultState(),
    listeners: [],

    load: function () {
      try {
        var raw = global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return false;
        if (parsed.schema !== SCHEMA_VERSION) {
          global.localStorage.removeItem(STORAGE_KEY);
          this.state = defaultState();
          return false;
        }
        var base = defaultState();
        Object.keys(base).forEach(function (k) {
          if (parsed[k] !== undefined && parsed[k] !== null) base[k] = parsed[k];
        });
        base.theme = parsed.theme || "light";
        if (!Array.isArray(base.mistakes)) base.mistakes = defaultState().mistakes;
        this.state = base;
        return true;
      } catch (e) {
        this.state = defaultState();
        return false;
      }
    },

    save: function () {
      try {
        this.state.lastSavedAt = new Date().toISOString();
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        return true;
      } catch (e) {
        this.state.lastSavedAt = new Date().toISOString();
        return false;
      }
    },

    reset: function () {
      this.state = defaultState();
      try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略：预览环境可能禁用存储 */ }
    },

    subscribe: function (fn) { this.listeners.push(fn); },
    notify: function () {
      this.listeners.forEach(function (fn) { fn(store.state); });
    }
  };

  EX.store = store;

  /* ------------------------------------------------------------- 工具 */
  var h = {
    esc: function (value) {
      return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    clamp: function (n, min, max) { return Math.min(max, Math.max(min, n)); },
    round1: function (n) { return Math.round(n * 10) / 10; }
  };
  EX.h = h;

  var fmt = {
    score: function (n) {
      var v = Math.round((Number(n) || 0) * 100) / 100;
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    },
    pct: function (n) {
      var v = Math.round((Number(n) || 0) * 10) / 10;
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    },
    clock: function (seconds) {
      var s = Math.max(0, Math.floor(seconds));
      var hh = Math.floor(s / 3600);
      var mm = Math.floor((s % 3600) / 60);
      var ss = s % 60;
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return hh > 0 ? pad(hh) + ":" + pad(mm) + ":" + pad(ss) : pad(mm) + ":" + pad(ss);
    },
    minutes: function (min) {
      return min >= 60 ? Math.floor(min / 60) + " 小时 " + (min % 60) + " 分钟" : min + " 分钟";
    },
    dateTime: function (iso) {
      if (!iso) return "—";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    },
    time: function (d) {
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    },
    day: function (d) {
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };
  EX.fmt = fmt;

  /* ------------------------------------------------------------- 图标 */
  var ICON_BODY = {
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    book: '<path d="M4 19.2A2.2 2.2 0 0 1 6.2 17H20"/><path d="M6.4 3H20v14H6.4A2.4 2.4 0 0 0 4 19.4V5.4A2.4 2.4 0 0 1 6.4 3z"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
    chart: '<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5.2"/><path d="M12 16.2h.01"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    library: '<rect x="3.5" y="4" width="4" height="16" rx="1"/><rect x="9.5" y="4" width="4" height="16" rx="1"/><path d="M16.8 5.4l3.4 13.2"/>',
    shuffle: '<path d="M16 3.5h4.5V8"/><path d="M20.5 3.5L14 10"/><path d="M3.5 20.5L10 14"/><path d="M14 10h3.2a4 4 0 0 1 3.3 1.8L22 14"/><path d="M3.5 3.5h3.7c1.6 0 3 .9 3.8 2.3L13 10"/><path d="M14 14l1.6 2.7c.8 1.4 2.2 2.3 3.8 2.3h4.1"/>',
    edit: '<path d="M12.5 20.5H20"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.6 18.4l-4 1 1-4z"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5"/><path d="M17.6 14.6A6.2 6.2 0 0 1 21.5 20"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.4 2"/>',
    flag: '<path d="M5.5 21V3.6"/><path d="M5.5 4.6h11l-1.6 4.2 1.6 4.2h-11"/>',
    search: '<circle cx="11" cy="11" r="6.8"/><path d="M20 20l-4.2-4.2"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12.1A1.2 1.2 0 0 0 8.6 20h6.8a1.2 1.2 0 0 0 1.2-1.1L17.5 7"/>',
    moon: '<path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.6 6.6 0 0 0 10.4 10.4z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    chevronLeft: '<path d="M15 18.5l-6.5-6.5L15 5.5"/>',
    chevronRight: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
    check: '<path d="M20 6.5L9.2 17.3 4 12.1"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    plusSmall: '<path d="M12 5.5v13M5.5 12h13"/>',
    search2: '<circle cx="11" cy="11" r="6.8"/><path d="M20 20l-4.2-4.2"/>',
    filter: '<path d="M4 5.5h16l-6 7v6.2l-4 1.8V12.5z"/>',
    arrowRight: '<path d="M4.5 12h15"/><path d="M13.5 6l6 6-6 6"/>',
    refresh: '<path d="M20 11.5A8 8 0 1 0 18.4 17"/><path d="M20 5.5v6h-6"/>',
    document: '<path d="M6.5 3.5h7L18.5 8.5V20.5h-12z"/><path d="M13.5 3.5v5h5"/><path d="M9 13h6M9 16.5h6"/>',
    layers: '<path d="M12 3.2l8.5 4.6L12 12.4 3.5 7.8z"/><path d="M3.5 12.6L12 17.2l8.5-4.6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
    award: '<circle cx="12" cy="9" r="5.2"/><path d="M8.8 13.4L7 21l5-2.4L17 21l-1.8-7.6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.4"/><path d="M12 7.9h.01"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    logout: '<path d="M15 4.5h2.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M10.5 16.5L15 12l-4.5-4.5"/><path d="M15 12H4"/>',
    eye: '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M5 4.5h11l3 3V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/><path d="M8 4.5v5h6v-5"/><rect x="7.5" y="13" width="9" height="7"/>',
    play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
    minus: '<path d="M5.5 12h13"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.8 6.8L12 13l8.2-6.2"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>'
  };

  EX.icon = function (name, size) {
    var body = ICON_BODY[name];
    if (!body) return "";
    var style = size ? ' style="--od-icon-size:' + size + 'px"' : "";
    return '<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + style + ">" + body + "</svg>";
  };

  /* ------------------------------------------------------------- 提示 */
  var toastHost = null;
  EX.toast = function (message, kind) {
    if (!toastHost) toastHost = doc.getElementById("toast-host");
    if (!toastHost) return;
    var el = doc.createElement("div");
    el.className = "toast" + (kind ? " is-" + kind : "");
    el.setAttribute("role", "status");
    el.textContent = message;
    toastHost.appendChild(el);
    global.setTimeout(function () {
      el.style.opacity = "0";
      global.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 240);
    }, 2600);
  };

  /* --------------------------------------------------------- 对话框 */
  EX.openDialog = function (id) {
    var dlg = doc.getElementById(id);
    if (!dlg) return null;
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    return dlg;
  };

  EX.closeDialog = function (id) {
    var dlg = doc.getElementById(id);
    if (!dlg) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  };

  /* 通用二次确认：业务侧注册回调，确认后执行 */
  var pendingConfirm = null;
  EX.confirm = function (opts) {
    var o = opts || {};
    pendingConfirm = typeof o.onConfirm === "function" ? o.onConfirm : null;
    var body = doc.getElementById("confirm-body");
    if (body) body.textContent = o.message || "";
    var title = doc.getElementById("confirm-title");
    if (title) title.textContent = o.title || "确认操作";
    var ok = doc.getElementById("confirm-ok");
    if (ok) ok.textContent = o.okText || "确认";
    EX.openDialog("dlg-confirm");
  };

  /* ------------------------------------------------------------- 图表 */
  function niceMax(value) {
    if (value <= 0) return 10;
    var pow = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var n = value / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  EX.chart = {
    line: function (opts) {
      var data = opts.data || [];
      var W = 640, H = 220;
      var padL = 40, padR = 16, padT = 18, padB = 34;
      var innerW = W - padL - padR;
      var innerH = H - padT - padB;
      var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1])));
      var stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
      var pts = data.map(function (d, i) {
        return {
          x: padL + (data.length > 1 ? stepX * i : innerW / 2),
          y: padT + innerH - (d.value / max) * innerH,
          d: d
        };
      });
      var grid = "";
      for (var g = 0; g <= 4; g++) {
        var gy = padT + (innerH / 4) * g;
        var gv = Math.round(max - (max / 4) * g);
        grid += '<line class="chart-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
        grid += '<text class="chart-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + gv + "</text>";
      }
      var path = pts.map(function (p, i) { return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
      var area = path + " L" + pts[pts.length - 1].x.toFixed(1) + " " + (padT + innerH) + " L" + pts[0].x.toFixed(1) + " " + (padT + innerH) + " Z";
      var dots = pts.map(function (p) {
        return '<circle class="chart-dot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4"/>';
      }).join("");
      var values = pts.map(function (p) {
        return '<text class="chart-value" x="' + p.x.toFixed(1) + '" y="' + (p.y - 10).toFixed(1) + '" text-anchor="middle">' + p.d.value + "</text>";
      }).join("");
      var labels = pts.map(function (p, i) {
        var lx = data.length > 1 ? p.x : W / 2;
        return '<text class="chart-axis" x="' + lx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + h.esc(p.d.label) + "</text>";
      }).join("");
      var title = opts.title ? h.esc(opts.title) : "趋势图";
      return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + title + '">' +
        grid + '<path class="chart-area" d="' + area + '"/><path class="chart-line" d="' + path + '"/>' +
        dots + values + labels + "</svg>";
    },

    bar: function (opts) {
      var data = opts.data || [];
      var W = 640, H = 220;
      var padL = 36, padR = 12, padT = 18, padB = 36;
      var innerW = W - padL - padR;
      var innerH = H - padT - padB;
      var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1])));
      var slot = innerW / Math.max(data.length, 1);
      var bw = Math.min(46, slot * 0.62);
      var grid = "";
      for (var g = 0; g <= 4; g++) {
        var gy = padT + (innerH / 4) * g;
        var gv = Math.round(max - (max / 4) * g);
        grid += '<line class="chart-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
        grid += '<text class="chart-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + gv + "</text>";
      }
      var bars = data.map(function (d, i) {
        var hgt = (d.value / max) * innerH;
        var x = padL + slot * i + (slot - bw) / 2;
        var y = padT + innerH - hgt;
        var cls = "chart-bar" + (d.accent ? " is-accent" : "");
        return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(hgt, 0).toFixed(1) + '" rx="2"/>' +
          '<text class="chart-value" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + d.value + "</text>" +
          '<text class="chart-axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 14) + '" text-anchor="middle">' + h.esc(d.label) + "</text>";
      }).join("");
      var title = opts.title ? h.esc(opts.title) : "分布图";
      return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + title + '">' + grid + bars + "</svg>";
    }
  };

  /* ------------------------------------------------------------- 导航 */
  /* 导航结构由各端配置提供（EX.APP.nav）；NAV_PARENT 用于子路由归属时的侧栏高亮。 */
  var NAV_PARENT = CFG.navParent || {};
  EX.NAV = CFG.nav || [];

  var views = {};
  var actions = {};
  EX.views = views;
  EX.actions = actions;

  /* ------------------------------------------------------------- 路由 */
  var cleanup = null;

  var router = {
    go: function (key, params) {
      if (!views[key]) {
        EX.toast("页面尚未开放：" + key, "error");
        return;
      }
      if (typeof cleanup === "function") { cleanup(); cleanup = null; }
      store.state.route = { key: key, params: params || {} };
      store.save();
      router.render();
    },
    render: function () {
      var route = store.state.route;
      var fn = views[route.key];
      var host = doc.getElementById("view-inner") || doc.getElementById("view");
      if (!fn || !host) return;
      /* 渲染前先释放上一个视图的副作用（定时器、监听器），避免重复注册 */
      if (typeof cleanup === "function") { cleanup(); cleanup = null; }
      var result = fn(route.params || {});
      host.innerHTML = result && result.html !== undefined ? result.html : result;
      cleanup = result && typeof result.cleanup === "function" ? result.cleanup : null;
      var scroller = doc.getElementById("view");
      if (scroller) scroller.scrollTop = 0;
      renderNav();
      document.documentElement.dataset.route = route.key;
    },
    refresh: function () {
      renderNav();
      router.render();
    },
    current: function () { return store.state.route; }
  };
  EX.router = router;

  /* --------------------------------------------------------- 动作分发 */
  doc.addEventListener("click", function (event) {
    var target = event.target.closest ? event.target.closest("[data-action]") : null;
    if (!target) return;
    var name = target.getAttribute("data-action");
    var fn = actions[name];
    if (!fn) return;
    event.preventDefault();
    fn(target, event);
  });

  doc.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var target = event.target.closest ? event.target.closest("[data-action][data-enter]") : null;
    if (!target) return;
    var name = target.getAttribute("data-action");
    if (!actions[name]) return;
    event.preventDefault();
    actions[name](target, event);
  });

  /* ------------------------------------------------------- 跨页面同步 */
  /* 管理端与答题端是两个页面，共享仓库写在 localStorage。
     监听 storage 事件、页面重新可见与定时轮询，保证任一端写入后另一端能读到最新数据。 */
  var lastRemote = "";

  function syncCatalog() {
    if (!EX.catalog) return;
    /* 优先按正文快照比对：即使对方只写了正文键、未更新版本键，也能被感知 */
    var changed = false;
    if (typeof EX.catalog.ensureFresh === "function") changed = !!EX.catalog.ensureFresh();
    if (!changed && typeof EX.catalog.remoteStamp === "function") {
      var remote = EX.catalog.remoteStamp();
      if (!remote) return;
      if (remote === lastRemote) return;
      lastRemote = remote;
      /* 本页自己刚写入的内容无需重读 */
      if (typeof EX.catalog.stamp === "function" && EX.catalog.stamp() === remote) return;
      var res = EX.catalog.reload();
      changed = !!(res && res.changed);
    }
    if (!changed) return;
    lastRemote = typeof EX.catalog.remoteStamp === "function" ? EX.catalog.remoteStamp() : lastRemote;
    if (typeof EX.onCatalogSync === "function") EX.onCatalogSync();
    router.refresh();
  }

  if (typeof global.addEventListener === "function") {
    global.addEventListener("storage", function (event) {
      if (!event) return;
      if (event.key === EX.catalog.REV_KEY || event.key === EX.catalog.STORAGE_KEY || event.key === null) {
        syncCatalog();
      }
    });

    global.addEventListener("focus", function () { syncCatalog(); });
  }

  if (typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", function () {
      if (!doc.hidden) syncCatalog();
    });
  }

  if (typeof global.setInterval === "function") {
    var syncTimer = global.setInterval(syncCatalog, 3000);
    if (syncTimer && typeof syncTimer.unref === "function") syncTimer.unref();
  }

  /* ------------------------------------------------------------- 外壳 */
  function identity() {
    if (typeof CFG.identity !== "function") return { name: "", meta: "", initial: "" };
    return CFG.identity(store.state);
  }

  function renderTopbar() {
    var s = store.state;
    var host = doc.getElementById("topbar");
    if (!host) return;
    var who = identity();
    var other = CFG.otherApp || {};
    var otherLink = other.href
      ? '<a class="top-link" href="' + h.esc(other.href) + '">' + h.esc(other.label || "") + "</a>"
      : "";
    host.innerHTML =
      '<button class="icon-btn nav-toggle" type="button" data-action="toggle.nav" aria-label="打开导航">' + EX.icon("menu") + "</button>" +
      '<div class="brand">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="--od-icon-size:17px"><path d="M6.5 12.4l3.6 3.6L17.8 8.4"/></svg>' +
        "</span>" +
        '<span class="brand-text">' +
          '<span class="brand-name">知行测评</span>' +
          '<span class="brand-sub">' + h.esc(CFG.brandSub || "") + "</span>" +
        "</span>" +
      "</div>" +
      '<div class="topbar-spacer"></div>' +
      otherLink +
      '<button class="icon-btn" type="button" data-action="theme.toggle" aria-label="' + (s.theme === "dark" ? "切换到浅色主题" : "切换到深色主题") + '" title="' + (s.theme === "dark" ? "浅色主题" : "深色主题") + '">' +
        EX.icon(s.theme === "dark" ? "sun" : "moon") +
      "</button>" +
      '<div class="user-chip">' +
        '<span class="avatar" aria-hidden="true">' + h.esc(who.initial) + "</span>" +
        '<span class="user-chip-text">' +
          '<span class="user-chip-name">' + h.esc(who.name) + "</span>" +
          '<span class="user-chip-meta">' + h.esc(who.meta) + "</span>" +
        "</span>" +
      "</div>";
  }

  function renderNav() {
    var host = doc.getElementById("sidebar");
    if (!host) return;
    var s = store.state;
    var groups = CFG.nav || [];
    var html = groups.map(function (group) {
      var items = group.items.map(function (item) {
        var current = s.route.key === item.key || NAV_PARENT[s.route.key] === item.key;
        var count = item.count ? item.count(s) : 0;
        return '<button type="button" class="nav-item" data-action="nav.go" data-key="' + item.key + '"' +
          (current ? ' aria-current="page"' : "") + '>' +
          EX.icon(item.icon) +
          '<span class="nav-label">' + h.esc(item.label) + "</span>" +
          (count ? '<span class="nav-count num">' + count + "</span>" : "") +
          "</button>";
      }).join("");
      return '<div class="nav-group"><div class="nav-group-title">' + h.esc(group.group) + "</div>" + items + "</div>";
    }).join("");
    host.innerHTML = html;
  }

  /* ----------------------------------------------------------- 动作 */
  actions["theme.toggle"] = function () {
    store.state.theme = store.state.theme === "dark" ? "light" : "dark";
    store.save();
    doc.documentElement.dataset.theme = store.state.theme;
    renderTopbar();
  };

  actions["nav.go"] = function (el) {
    var params = {};
    var raw = el.getAttribute("data-params");
    if (raw) {
      try { params = JSON.parse(raw) || {}; } catch (e) { params = {}; }
    }
    router.go(el.getAttribute("data-key"), params);
    var sidebar = doc.getElementById("sidebar");
    var scrim = doc.getElementById("scrim");
    if (sidebar) sidebar.classList.remove("is-open");
    if (scrim) scrim.parentNode.removeChild(scrim);
  };

  actions["toggle.nav"] = function () {
    var sidebar = doc.getElementById("sidebar");
    if (!sidebar) return;
    var open = sidebar.classList.toggle("is-open");
    if (open) {
      var scrim = doc.createElement("div");
      scrim.className = "scrim";
      scrim.id = "scrim";
      scrim.addEventListener("click", function () {
        sidebar.classList.remove("is-open");
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      });
      doc.body.appendChild(scrim);
    } else {
      var s = doc.getElementById("scrim");
      if (s) s.parentNode.removeChild(s);
    }
  };

  actions["dialog.close"] = function (el) {
    EX.closeDialog(el.getAttribute("data-dialog"));
  };

  actions["dialog.confirm"] = function () {
    var fn = pendingConfirm;
    pendingConfirm = null;
    EX.closeDialog("dlg-confirm");
    if (fn) fn();
  };

  /* ----------------------------------------------------------- 启动 */
  var booted = false;

  /* 视图模块（exam/js/student.js、admin/js/admin.js）在 app.js 之后载入，
     因此启动流程必须可被重复调用且要容忍视图尚未注册的情况。 */
  function boot() {
    if (booted) return;
    store.load();
    if (EX.catalog && typeof EX.catalog.remoteStamp === "function") lastRemote = EX.catalog.remoteStamp();
    doc.documentElement.dataset.theme = store.state.theme;
    renderTopbar();
    renderNav();

    var route = store.state.route;
    var fallback = CFG.homeRoute;
    if (!views[route.key]) {
      route = views[fallback] ? { key: fallback, params: {} } : null;
      if (route) store.state.route = route;
    }
    var host = doc.getElementById("view-inner") || doc.getElementById("view");
    if (!host) return;
    if (!route || !views[route.key]) {
      host.innerHTML = '<div class="card"><div class="empty"><span class="empty-title">页面加载中</span>' +
        '<span class="empty-body">正在载入视图模块…</span></div></div>';
      return;
    }
    var result = views[route.key](route.params || {});
    host.innerHTML = result && result.html !== undefined ? result.html : result;
    cleanup = result && typeof result.cleanup === "function" ? result.cleanup : null;
    document.documentElement.dataset.route = route.key;
    booted = true;
  }
  EX.boot = boot;

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* 各端视图模块载入完成后补一次启动，确保首屏视图已注册 */
  if (doc.readyState !== "loading") setTimeout(boot, 0);
  else doc.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });

  EX.refreshShell = function () {
    renderTopbar();
    renderNav();
  };
})(window);
