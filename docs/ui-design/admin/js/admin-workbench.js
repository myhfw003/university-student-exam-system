/* ==========================================================================
   知行测评 · 管理端工作台
   概览（待办工作台）· 题库内容工作台（题目 / 候选题 / 内容生产）· 组卷四步向导
   题目状态机：draft → published → disabled；仅「已发布」题目可被组卷引用。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = global.EX;
  var doc = global.document;
  var h = EX.h;
  var fmt = EX.fmt;
  var store = EX.store;
  var catalog = EX.catalog;
  var A = EX.admin;

  /* ---------------------------------------------------------- 工作台状态 */
  var wb = {
    bankId: "",
    tab: "questions",
    q: { status: "published", type: "全部", keyword: "", tags: [] },
    cand: { source: "全部", picked: [] },
    produce: { mode: "import", batchId: "", fileName: "", rowCount: 3, genType: "single", genCount: 3, genDifficulty: "中等", genPrompt: "", genTags: [] },
    papers: { kind: "exam" },
    wiz: {
      kind: "exam",
      id: "",
      step: "basic",
      mode: "standard",
      focus: "",
      openField: "",
      qsel: { bank: [], type: [], keyword: "", tags: [] }
    }
  };

  var STATUS_META = {
    draft: { label: "草稿", cls: "badge-warn" },
    published: { label: "已发布", cls: "badge-ok" },
    disabled: { label: "已停用", cls: "badge-neutral" }
  };

  var PAPER_META = {
    exam: {
      draft: { label: "未发布", cls: "badge-warn" },
      ongoing: { label: "进行中", cls: "badge-ok" },
      ended: { label: "已结束", cls: "badge-neutral" }
    },
    practice: {
      draft: { label: "未上架", cls: "badge-warn" },
      published: { label: "已上架", cls: "badge-ok" },
      archived: { label: "已下架", cls: "badge-neutral" }
    }
  };

  var WIZ_STEPS = {
    exam: [
      { key: "basic", label: "基本信息", hint: "名称、时长与分值" },
      { key: "select", label: "选题与配分", hint: "选题并设定每题分值" },
      { key: "plum", label: "卷型与梅花卷", hint: "标准 / 小梅花 / 大梅花" },
      { key: "publish", label: "名单与发布", hint: "考试名单与发布校验" }
    ],
    practice: [
      { key: "basic", label: "基本信息", hint: "开放范围与练习规则" },
      { key: "select", label: "选题与配分", hint: "选题并设定每题分值" },
      { key: "plum", label: "卷型与规则", hint: "固定顺序组卷" },
      { key: "publish", label: "开放与上架", hint: "上架校验" }
    ]
  };

  /* ------------------------------------------------------------ 基础片段 */
  function statusBadge(status) {
    var meta = STATUS_META[status] || STATUS_META.published;
    return '<span class="badge ' + meta.cls + '">' + h.esc(meta.label) + "</span>";
  }

  function sourceBadge(source) {
    var map = { manual: "badge-neutral", import: "badge-info", ai: "badge-primary" };
    var label = { manual: "手工录入", import: "导入", ai: "AI 生成" }[source] || "手工录入";
    return '<span class="badge ' + (map[source] || "badge-neutral") + '">' + h.esc(label) + "</span>";
  }

  function paperBadge(kind, item) {
    var group = PAPER_META[kind] || PAPER_META.exam;
    var key = item.status || "draft";
    var meta = group[key] || group.draft;
    return '<span class="badge ' + meta.cls + '">' + h.esc(meta.label) + "</span>";
  }

  function emptyBlock(title, body, action) {
    return '<div class="empty"><span class="empty-title">' + h.esc(title) + "</span>" +
      '<span class="empty-body">' + h.esc(body || "") + "</span>" +
      (action || "") + "</div>";
  }

  function typeOptions(current) {
    var all = [{ id: "全部", name: "全部题型" }].concat(EX.seed.QUESTION_TYPES);
    return all.map(function (t) {
      return '<option value="' + h.esc(t.id) + '"' + (t.id === current ? " selected" : "") + ">" + h.esc(t.label || t.name) + "</option>";
    }).join("");
  }

  /* -------------------------------------------------- 多选下拉（可多选） */
  function mselectSummary(selected, labels, allLabel) {
    if (!selected.length) return allLabel;
    if (selected.length === 1) return labels[selected[0]] || selected[0];
    return "已选 " + selected.length + " 项";
  }

  function mselectHtml(opts) {
    var selected = opts.selected || [];
    var open = wb.wiz.openField === opts.field;
    var labels = {};
    opts.items.forEach(function (it) { labels[it.value] = it.label; });
    var summary = mselectSummary(selected, labels, opts.allLabel);

    var options = opts.items.map(function (it) {
      var on = selected.indexOf(it.value) !== -1;
      return '<label class="mselect-option">' +
        '<input type="checkbox" data-change="admin.wiz.mselect.pick" data-field="' + h.esc(opts.field) +
        '" data-value="' + h.esc(it.value) + '"' + (on ? " checked" : "") + ">" +
        '<span class="mselect-option-text">' + h.esc(it.label) + "</span>" +
        (it.meta ? '<span class="mselect-option-meta">' + h.esc(it.meta) + "</span>" : "") +
        "</label>";
    }).join("");

    return '<div class="mselect' + (open ? " is-open" : "") + (selected.length ? " is-on" : "") + '"' +
      ' data-mselect="' + h.esc(opts.field) + '" data-title="' + h.esc(opts.title) + '"' +
      ' data-all-label="' + h.esc(opts.allLabel) + '"' +
      (opts.minWidth ? ' style="min-width:' + h.esc(opts.minWidth) + 'px"' : "") + ">" +
      '<button type="button" class="mselect-trigger" data-action="admin.wiz.mselect.toggle" data-field="' + h.esc(opts.field) +
        '" aria-haspopup="true" aria-expanded="' + (open ? "true" : "false") + '"' +
        ' aria-label="' + h.esc(opts.title) + '筛选（可多选）">' +
        '<span class="mselect-value">' + h.esc(summary) + "</span>" +
        '<span class="mselect-caret" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="mselect-panel" role="group" aria-label="' + h.esc(opts.title) + '">' +
        '<div class="mselect-head">' +
          '<span class="mselect-count text-xs text-3">' + h.esc(opts.title) + " · 已选 " + selected.length + " / " + opts.items.length + "</span>" +
          '<div class="row-tight">' +
            '<button type="button" class="btn btn-sm btn-quiet" data-action="admin.wiz.mselect.all" data-field="' + h.esc(opts.field) + '">全选</button>' +
            '<button type="button" class="btn btn-sm btn-quiet" data-action="admin.wiz.mselect.clear" data-field="' + h.esc(opts.field) + '">清空</button>' +
          "</div>" +
        "</div>" +
        '<div class="mselect-options">' + options + "</div>" +
      "</div></div>";
  }

  function closeMSelects(except) {
    Array.prototype.forEach.call(doc.querySelectorAll(".mselect.is-open"), function (w) {
      if (except && w === except) return;
      w.classList.remove("is-open");
      var trigger = w.querySelector(".mselect-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
    if (!except) wb.wiz.openField = "";
  }

  function syncMselectLabels() {
    Array.prototype.forEach.call(doc.querySelectorAll(".mselect"), function (wrap) {
      var field = wrap.getAttribute("data-mselect");
      var selected = wb.wiz.qsel[field] || [];
      var labels = {};
      var total = 0;
      Array.prototype.forEach.call(wrap.querySelectorAll(".mselect-option"), function (opt) {
        var input = opt.querySelector("input");
        if (!input) return;
        total += 1;
        var text = opt.querySelector(".mselect-option-text");
        labels[input.getAttribute("data-value")] = text ? text.textContent : "";
      });
      var value = wrap.querySelector(".mselect-value");
      if (value) value.textContent = mselectSummary(selected, labels, wrap.getAttribute("data-all-label"));
      var count = wrap.querySelector(".mselect-count");
      if (count) count.textContent = wrap.getAttribute("data-title") + " · 已选 " + selected.length + " / " + total;
      if (selected.length) wrap.classList.add("is-on"); else wrap.classList.remove("is-on");
    });
  }

  function tagFilterChips(active) {
    return catalog.tagsOfGroup("领域").concat(catalog.tagsOfGroup("能力")).map(function (t) {
      var on = active.indexOf(t.id) !== -1;
      return '<button type="button" class="chip is-tag' + (on ? " is-on" : "") + '" ' +
        'data-action="admin.wb.tagfilter" data-tag="' + h.esc(t.id) + '" ' +
        'aria-pressed="' + (on ? "true" : "false") + '">' + h.esc(t.name) + "</button>";
    }).join("");
  }

  function tagFilterPanel(active, action) {
    return '<div class="filter-block"><div class="filter-group-label">标签筛选</div>' +
      '<div class="row-tight">' + tagFilterChips(active) + "</div></div>";
  }

  function bankOf(id) {
    if (!id || id === "__all__") return null;
    return catalog.getBank(id);
  }

  function bankTitle(id) {
    if (!id || id === "__all__") return "全部题库";
    var b = bankOf(id);
    return b ? b.name : "全部题库";
  }

  function scopeLabel(scope) {
    var ids = scope || [];
    if (!ids.length) return "全员开放";
    return ids.map(function (id) {
      var c = (EX.seed.classes || []).filter(function (x) { return x.id === id; })[0];
      return c ? c.name : id;
    }).join("、");
  }

  function itemsOfPaper(item) {
    return catalog.itemsOf(item);
  }

  function sumScore(items) {
    return items.reduce(function (a, b) { return a + (Number(b.score) || 0); }, 0);
  }

  /* ---------------------------------------------------------- 题库列表 */
  EX.views["admin.banks"] = function () {
    var list = catalog.banks();
    var all = catalog.questions();
    var allStats = catalog.bankStats("__all__");

    var rows = list.map(function (b) {
      var st = catalog.bankStats(b.id);
      var points = (b.tags || []).map(function (id) {
        var t = catalog.getTag(id);
        return t ? t.name : id;
      }).filter(function (n) { return n; });
      return "<tr>" +
        '<td><div class="strong" style="font-weight:500">' + h.esc(b.name) + "</div>" +
          '<div class="text-xs text-3">' + h.esc(b.desc || "—") + "</div></td>" +
        "<td>" + (A.tagChips(b, 3) || '<span class="text-3 text-sm">—</span>') + "</td>" +
        '<td class="num">' + st.published + "</td>" +
        '<td class="num">' + (st.draft ? '<span class="badge badge-warn">' + st.draft + "</span>" : '<span class="text-3">0</span>') + "</td>" +
        '<td class="num">' + (st.disabled ? '<span class="badge badge-neutral">' + st.disabled + "</span>" : '<span class="text-3">0</span>') + "</td>" +
        '<td class="text-xs text-3">' + h.esc(points.join("、") || "—") + "</td>" +
        '<td class="col-actions">' +
          '<button class="btn btn-sm" data-action="admin.bank.open" data-id="' + h.esc(b.id) + '" data-tab="questions">工作台</button> ' +
          '<button class="btn btn-sm" data-action="admin.bank.edit" data-id="' + h.esc(b.id) + '">编辑</button> ' +
          '<button class="btn btn-sm btn-danger" data-action="admin.bank.delete" data-id="' + h.esc(b.id) + '">删除</button>' +
        "</td></tr>";
    }).join("");

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">题库</h1>' +
        '<p class="page-sub">题库是内容的组织容器。进入题库工作台可管理题目状态、审核候选题，并通过导入或 AI 生成补充内容。</p>' +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn btn-primary" data-action="admin.bank.new">' + EX.icon("plus") + "新建题库</button>" +
      "</div></div>" +
      '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-body">' +
        '<div class="row" style="justify-content:space-between">' +
          '<div><div class="strong" style="font-weight:600">全部题库</div>' +
            '<div class="text-sm text-3">跨库查看全部 ' + all.length + " 道题目（已发布 " + allStats.published +
            " / 草稿 " + allStats.draft + " / 已停用 " + allStats.disabled + "）</div></div>" +
          '<button class="btn btn-sm" data-action="admin.bank.open" data-id="__all__" data-tab="questions">进入工作台</button>' +
        "</div></div></section>" +
      '<section class="card"><div class="card-head"><h2 class="card-title">题库清单</h2>' +
        '<span class="text-sm text-3">' + list.length + " 个题库</span></div>" +
        '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>题库</th><th>标签</th><th>已发布</th><th>草稿</th><th>已停用</th><th>覆盖维度</th><th></th></tr></thead>" +
        "<tbody>" + (rows || '<tr><td colspan="7"><div class="empty"><span class="empty-title">暂无题库</span></div></td></tr>') +
        "</tbody></table></div></div></section>";
  };

  /* ---------------------------------------------------------- 题库工作台 */
  EX.views["admin.bank"] = function (params) {
    var id = params.id || "__all__";
    var tab = params.tab || "questions";
    wb.bankId = id;
    wb.tab = tab;
    var bank = bankOf(id);
    var stats = catalog.bankStats(id);
    var title = bankTitle(id);

    var tabs = [
      { key: "questions", label: "题目", count: stats.total },
      { key: "candidates", label: "候选题", count: stats.draft },
      { key: "produce", label: "内容生产", count: 0 }
    ];
    var tabBar = '<div class="seg" role="tablist" style="margin-bottom:var(--sp-4)">' + tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (tab === t.key ? "true" : "false") + '" ' +
        'aria-pressed="' + (tab === t.key ? "true" : "false") + '" ' +
        'data-action="admin.bank.tab" data-tab="' + h.esc(t.key) + '" data-id="' + h.esc(id) + '">' +
        h.esc(t.label) + (t.count ? " " + t.count : "") + "</button>";
    }).join("") + "</div>";

    var body = tab === "candidates" ? candidatesPanel(id) : (tab === "produce" ? producePanel(id) : questionsPanel(id));

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">' + h.esc(title) + "</h1>" +
        '<p class="page-sub">' + (bank ? h.esc(bank.desc || "题库工作台") : "跨库视图：所有题库的内容汇总在同一工作台中处理。") + "</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="admin.bank.list">' + EX.icon("library") + "题库清单</button>" +
        (bank ? '<button class="btn" data-action="admin.bank.edit" data-id="' + h.esc(id) + '">编辑题库</button>' : "") +
        '<button class="btn btn-primary" data-action="admin.question.new">' + EX.icon("plus") + "新建题目</button>" +
      "</div></div>" +
      '<div class="stat-row" style="margin-bottom:var(--sp-4)">' +
        A.statCard("已发布", stats.published, "道", "可被组卷引用") +
        A.statCard("草稿候选题", stats.draft, "道", "待审核发布") +
        A.statCard("已停用", stats.disabled, "道", "可恢复为已发布") +
        A.statCard("客观题分值", stats.objective, "分", "单选 / 多选 / 判断") +
        A.statCard("主观题分值", stats.subjective, "分", "简答 / 综合操作") +
      "</div>" +
      tabBar + body;
  };

  /* ------------------------------------------------------- 工作台 · 题目 */
  function filteredQuestions(bankId) {
    var list = catalog.questionsOfBank(bankId);
    var f = wb.q;
    return list.filter(function (q) {
      if (f.status !== "全部" && catalog.statusOf(q) !== f.status) return false;
      if (f.type !== "全部" && q.type !== f.type) return false;
      if (f.keyword) {
        var kw = f.keyword.toLowerCase();
        var hay = (q.id + " " + q.stem).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      if (f.tags.length) {
        var ids = q.tags || [];
        var hit = f.tags.some(function (t) { return ids.indexOf(t) !== -1; });
        if (!hit) return false;
      }
      return true;
    });
  }

  function questionsPanel(bankId) {
    var list = filteredQuestions(bankId);
    var statuses = [
      { key: "published", label: "已发布" },
      { key: "draft", label: "草稿" },
      { key: "disabled", label: "已停用" },
      { key: "全部", label: "全部" }
    ];

    var rows = list.map(function (q) {
      var st = catalog.statusOf(q);
      var act = st === "published"
        ? '<button class="btn btn-sm" data-action="admin.q.status" data-id="' + h.esc(q.id) + '" data-status="disabled">停用</button>'
        : st === "disabled"
          ? '<button class="btn btn-sm" data-action="admin.q.status" data-id="' + h.esc(q.id) + '" data-status="published">恢复</button>'
          : '<button class="btn btn-sm btn-primary" data-action="admin.q.status" data-id="' + h.esc(q.id) + '" data-status="published">发布</button>';
      return "<tr>" +
        '<td class="text-xs mono">' + h.esc(q.id) + "</td>" +
        '<td><div style="font-weight:500">' + h.esc(q.stem) + "</div>" +
          '<div class="row-tight" style="margin-top:var(--sp-2)">' + A.typeBadge(q.type) + A.difficultyChip(q) + A.tagChips(q, 3) + "</div></td>" +
        "<td>" + sourceBadge(q.source) + "</td>" +
        "<td>" + statusBadge(st) + "</td>" +
        '<td class="num">' + q.score + "</td>" +
        '<td class="col-actions">' +
          '<button class="btn btn-sm" data-action="admin.question.edit" data-id="' + h.esc(q.id) + '">编辑</button> ' + act +
          ' <button class="btn btn-sm btn-danger" data-action="admin.question.delete" data-id="' + h.esc(q.id) + '">删除</button>' +
        "</td></tr>";
    }).join("");

    return '<section class="card"><div class="card-head"><h2 class="card-title">题目</h2>' +
      '<span class="text-sm text-3">' + list.length + " 道</span></div>" +
      '<div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)">' +
          '<div class="seg">' + statuses.map(function (s) {
            return '<button type="button" aria-pressed="' + (wb.q.status === s.key ? "true" : "false") + '" ' +
              'data-action="admin.wb.qfilter" data-field="status" data-value="' + h.esc(s.key) + '">' + h.esc(s.label) + "</button>";
          }).join("") + "</div>" +
          '<div class="select-wrap" style="min-width:140px"><select class="select" data-change="admin.wb.qfilter" data-field="type">' +
            typeOptions(wb.q.type) + "</select></div>" +
          '<input class="input" type="search" data-search="wb-q" value="' + h.esc(wb.q.keyword) + '" placeholder="搜索题号或题干" style="min-width:200px">' +
        "</div>" +
        tagFilterPanel(wb.q.tags) +
      "</div>" +
      '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
      "<thead><tr><th>编号</th><th>题目</th><th>来源</th><th>状态</th><th>分值</th><th></th></tr></thead>" +
      "<tbody>" + (rows || '<tr><td colspan="6">' + emptyBlock("没有符合条件的题目", "调整筛选条件，或通过内容生产补充题目。") + "</td></tr>") +
      "</tbody></table></div></div></section>";
  }

  /* --------------------------------------------------- 工作台 · 候选题 */
  function candidatesPanel(bankId) {
    var list = catalog.candidatesOf(bankId).filter(function (q) {
      if (wb.cand.source !== "全部" && (q.source || "manual") !== wb.cand.source) return false;
      return true;
    });
    var all = catalog.candidatesOf(bankId);
    var sources = [{ key: "全部", label: "全部来源" }, { key: "import", label: "导入" }, { key: "ai", label: "AI 生成" }, { key: "manual", label: "手工录入" }];

    var rows = list.map(function (q) {
      var on = wb.cand.picked.indexOf(q.id) !== -1;
      var batch = q.batchId ? h.esc(q.batchId) : "—";
      return "<tr>" +
        '<td><input type="checkbox" data-change="admin.cand.pick" data-id="' + h.esc(q.id) + '"' + (on ? " checked" : "") +
          ' aria-label="选择 ' + h.esc(q.id) + '"></td>' +
        '<td class="text-xs mono">' + h.esc(q.id) + "</td>" +
        '<td><div style="font-weight:500">' + h.esc(q.stem) + "</div>" +
          '<div class="row-tight" style="margin-top:var(--sp-2)">' + A.typeBadge(q.type) + A.difficultyChip(q) + A.tagChips(q, 3) + "</div></td>" +
        "<td>" + sourceBadge(q.source) + "</td>" +
        '<td class="text-xs text-3">' + batch + "</td>" +
        '<td class="col-actions">' +
          '<button class="btn btn-sm" data-action="admin.question.edit" data-id="' + h.esc(q.id) + '">编辑</button> ' +
          '<button class="btn btn-sm btn-primary" data-action="admin.q.status" data-id="' + h.esc(q.id) + '" data-status="published">发布</button> ' +
          '<button class="btn btn-sm btn-danger" data-action="admin.cand.discard" data-id="' + h.esc(q.id) + '">丢弃</button>' +
        "</td></tr>";
    }).join("");

    return '<section class="card"><div class="card-head"><h2 class="card-title">候选题队列</h2>' +
      '<span class="text-sm text-3">共 ' + all.length + " 道待审核</span></div>" +
      '<div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)">' +
          '<div class="seg">' + sources.map(function (s) {
            return '<button type="button" aria-pressed="' + (wb.cand.source === s.key ? "true" : "false") + '" ' +
              'data-action="admin.cand.source" data-value="' + h.esc(s.key) + '">' + h.esc(s.label) + "</button>";
          }).join("") + "</div>" +
          '<div class="row-tight" style="margin-left:auto">' +
            '<button class="btn btn-sm" data-action="admin.cand.pickall">' + EX.icon("check") + "全选本页</button>" +
            '<button class="btn btn-sm" data-action="admin.cand.clear">清空选择</button>' +
            '<button class="btn btn-sm btn-primary" data-action="admin.cand.publish">' + EX.icon("check") + "批量发布</button>" +
            '<button class="btn btn-sm btn-danger" data-action="admin.cand.discardAll">批量丢弃</button>' +
          "</div>" +
        "</div>" +
        '<div class="callout"><span class="callout-title">' + EX.icon("info") + "候选题需审核后发布</span>" +
          "<span>导入与 AI 生成的内容先进入草稿状态，审核确认无误后发布；仅「已发布」题目可被组卷与练习引用。</span></div>" +
      "</div>" +
      '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
      "<thead><tr><th></th><th>编号</th><th>题目</th><th>来源</th><th>批次</th><th></th></tr></thead>" +
      "<tbody>" + (rows || '<tr><td colspan="6">' + emptyBlock("暂无候选题", "通过「内容生产」导入试题或使用 AI 生成，即可在此审核。") + "</td></tr>") +
      "</tbody></table></div></div></section>";
  }

  /* --------------------------------------------------- 工作台 · 内容生产 */
  function producePanel(bankId) {
    var mode = wb.produce.mode;
    var banks = catalog.banks();
    var target = wb.produce.bankId;
    if (!target || (target !== "__all__" && !catalog.getBank(target))) {
      target = bankId && bankId !== "__all__" ? bankId : (banks[0] ? banks[0].id : "");
    }
    wb.produce.bankId = target;
    var targetOptions = banks.map(function (b) {
      return '<option value="' + h.esc(b.id) + '"' + (b.id === target ? " selected" : "") + ">" + h.esc(b.name) + "</option>";
    }).join("");

    var seg = '<div class="seg" style="margin-bottom:var(--sp-4)">' +
      '<button type="button" aria-pressed="' + (mode === "import" ? "true" : "false") + '" data-action="admin.produce.mode" data-value="import">' +
        EX.icon("document") + "导入试题</button>" +
      '<button type="button" aria-pressed="' + (mode === "gen" ? "true" : "false") + '" data-action="admin.produce.mode" data-value="gen">' +
        EX.icon("flag") + "AI 生成</button></div>";

    var batch = null;
    var batchKind = "";
    if (wb.produce.batchId) {
      batch = mode === "import" ? catalog.getImport(wb.produce.batchId) : catalog.getGeneration(wb.produce.batchId);
      batchKind = mode === "import" ? "import" : "gen";
    }

    var form;
    if (mode === "import") {
      form = '<div class="grid-2">' +
        '<div class="field"><label class="field-label" for="imp-file">试题文件</label>' +
          '<input class="input" id="imp-file" type="text" value="' + h.esc(wb.produce.fileName) + '" placeholder="例如 2026秋季期中试题汇总.csv">' +
          '<span class="field-hint">支持 .csv / .xlsx 试题文件；本原型使用示例数据模拟解析结果。</span></div>' +
        '<div class="field"><label class="field-label" for="imp-count">解析行数</label>' +
          '<div class="select-wrap"><select class="select" id="imp-count">' +
            [1, 2, 3].map(function (n) {
              return '<option value="' + n + '"' + (wb.produce.rowCount === n ? " selected" : "") + ">" + n + " 行</option>";
            }).join("") + "</select></div>" +
          '<span class="field-hint">解析前会先校验列映射，解析结果进入草稿候选题。</span></div>' +
        "</div>" +
        '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="imp-bank">导入到题库</label>' +
          '<div class="select-wrap"><select class="select" id="imp-bank">' + targetOptions + "</select></div></div>" +
        '<div class="row" style="margin-top:var(--sp-5)">' +
          '<button class="btn btn-primary" data-action="admin.produce.parse">' + EX.icon("document") + "解析文件</button>" +
          '<span class="text-sm text-3">解析为真实交互流程，产出为示例数据；不接入真实解析器。</span>' +
        "</div>";
    } else {
      var genTagChips = catalog.tagsOfGroup("领域").concat(catalog.tagsOfGroup("知识点")).map(function (t) {
        var on = wb.produce.genTags.indexOf(t.id) !== -1;
        return '<button type="button" class="chip is-tag' + (on ? " is-on" : "") + '" ' +
          'data-action="admin.produce.tag" data-tag="' + h.esc(t.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
          h.esc(t.name) + "</button>";
      }).join("");
      form = '<div class="grid-3">' +
        '<div class="field"><label class="field-label" for="gen-type">题型</label>' +
          '<div class="select-wrap"><select class="select" id="gen-type">' +
            EX.seed.QUESTION_TYPES.map(function (t) {
              return '<option value="' + h.esc(t.id) + '"' + (wb.produce.genType === t.id ? " selected" : "") + ">" + h.esc(t.label) + "</option>";
            }).join("") + "</select></div></div>" +
        '<div class="field"><label class="field-label" for="gen-count">生成数量</label>' +
          '<input class="input" id="gen-count" type="number" min="1" max="8" value="' + wb.produce.genCount + '"></div>' +
        '<div class="field"><label class="field-label" for="gen-difficulty">难度</label>' +
          '<div class="select-wrap"><select class="select" id="gen-difficulty">' +
            ["基础", "中等", "较难"].map(function (d) {
              return '<option value="' + h.esc(d) + '"' + (wb.produce.genDifficulty === d ? " selected" : "") + ">" + h.esc(d) + "</option>";
            }).join("") + "</select></div></div>" +
        "</div>" +
        '<div class="field" style="margin-top:var(--sp-4)"><span class="field-label">知识点标签</span>' +
          '<div class="row-tight">' + genTagChips + "</div>" +
          '<span class="field-hint">标签决定生成题目的归类与难度层级，最多 5 个。</span></div>' +
        '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="gen-prompt">生成指令</label>' +
          '<textarea class="textarea" id="gen-prompt" placeholder="例如 围绕 TCP 三次握手与四次挥手生成单选题">' +
          h.esc(wb.produce.genPrompt) + "</textarea></div>" +
        '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="imp-bank">生成到题库</label>' +
          '<div class="select-wrap"><select class="select" id="imp-bank">' + targetOptions + "</select></div></div>" +
        '<div class="row" style="margin-top:var(--sp-5)">' +
          '<button class="btn btn-primary" data-action="admin.produce.gen">' + EX.icon("flag") + "生成候选题</button>" +
          '<span class="text-sm text-3">生成结果为示例数据，不接入真实大模型。</span>' +
        "</div>";
    }

    var preview = "";
    if (batch) {
      var rows = (batch.rows || []).map(function (r) {
        return "<tr>" +
          '<td class="num">' + r.no + "</td>" +
          "<td>" + h.esc(r.stem) + "</td>" +
          "<td>" + A.typeBadge(r.type) + "</td>" +
          '<td class="num">' + (r.score || 5) + "</td>" +
          "<td>" + h.esc((r.answer || []).join("")) + "</td>" +
          "<td>" + A.tagChips({ tags: r.tags || [] }, 3) + "</td></tr>";
      }).join("");
      var mapping = batch.mapping
        ? Object.keys(batch.mapping).map(function (k) {
            return "<tr><td>" + h.esc(k) + "</td><td>" + h.esc(batch.mapping[k]) + "</td></tr>";
          }).join("")
        : "";
      preview = '<section class="card" style="margin-top:var(--sp-4)"><div class="card-head">' +
        '<h2 class="card-title">' + (batchKind === "import" ? "解析预览" : "生成结果预览") + "</h2>" +
        '<span class="text-sm text-3">' + h.esc(batch.id + " · " + (batch.createdAt || "")) + "</span></div>" +
        '<div class="card-body">' +
          (mapping ? '<div class="filter-block"><div class="filter-group-label">列映射</div>' +
            '<div class="table-wrap"><table class="table"><thead><tr><th>字段</th><th>来源列</th></tr></thead><tbody>' +
            mapping + "</tbody></table></div></div>" : "") +
          '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>题干</th><th>题型</th><th>分值</th><th>答案</th><th>标签</th></tr></thead>' +
          "<tbody>" + (rows || '<tr><td colspan="6">' + emptyBlock("没有可采纳的解析结果", "请检查列映射后重新解析。") + "</td></tr>") + "</tbody></table></div>" +
          '<div class="row" style="margin-top:var(--sp-4)">' +
            '<button class="btn btn-primary" data-action="admin.produce.adopt">' + EX.icon("check") + "采纳为候选题</button>" +
            '<span class="text-sm text-3">采纳后题目进入草稿状态，需在候选题队列审核发布。</span>' +
          "</div>" +
        "</div></section>";
    }

    return '<section class="card"><div class="card-head"><h2 class="card-title">内容生产</h2>' +
      '<span class="text-sm text-3">导入与 AI 生成均产出草稿候选题</span></div>' +
      '<div class="card-body">' + seg + form + "</div></section>" + preview;
  }

  EX.views["admin.overview"] = function () {
    var all = catalog.questions();
    var drafts = all.filter(function (q) { return catalog.statusOf(q) === "draft"; });
    var published = all.filter(function (q) { return catalog.statusOf(q) === "published"; });
    var disabled = all.filter(function (q) { return catalog.statusOf(q) === "disabled"; });
    var exams = catalog.exams();
    var practices = catalog.practices();
    var pendingReviews = catalog.reviews().filter(function (r) { return r.status === "pending"; });
    var draftExams = exams.filter(function (e) { return e.status === "draft" || e.published === false; });
    var draftPractices = practices.filter(function (p) { return p.status !== "published"; });
    var blocked = [];
    exams.forEach(function (e) { if (!catalog.preflight("exam", e.id).ok) blocked.push({ kind: "exam", item: e }); });
    practices.forEach(function (p) { if (!catalog.preflight("practice", p.id).ok) blocked.push({ kind: "practice", item: p }); });

    function todo(icon, label, count, hint, actionLabel, action, attrs) {
      var tone = count > 0 ? "is-todo" : "is-done";
      return '<article class="todo-card ' + tone + '">' +
        '<div class="todo-icon" aria-hidden="true">' + EX.icon(icon) + "</div>" +
        '<div class="todo-main"><span class="todo-label">' + h.esc(label) + "</span>" +
        '<span class="todo-count">' + count + "</span>" +
        '<span class="todo-hint">' + h.esc(hint) + "</span></div>" +
        '<button type="button" class="btn btn-sm" data-action="' + h.esc(action) + '" ' + (attrs || "") + ">" +
        h.esc(actionLabel) + "</button></article>";
    }

    var todoHtml = [
      todo("layers", "候选题待审核", drafts.length, "导入与 AI 生成的题目需审核发布后方可组卷",
        "去审核", "admin.bank.open", 'data-id="__all__" data-tab="candidates"'),
      todo("clipboard", "试卷待发布", draftExams.length, "已配置但尚未发布到答题端",
        "去组卷", "admin.papers.list", 'data-kind="exam"'),
      todo("book", "练习待上架", draftPractices.length, "开放范围与规则就绪后即可上架",
        "去上架", "admin.papers.list", 'data-kind="practice"'),
      todo("edit", "待人工阅卷", pendingReviews.length, "主观题提交后进入阅卷队列",
        "去阅卷", "admin.go", 'data-route="admin.review"'),
      todo("alert", "发布校验未通过", blocked.length, "题量、分值、名单等检查项存在未通过项",
        "去处理", blocked.length ? "admin.paper.open" : "admin.papers.list",
        blocked.length
          ? 'data-kind="' + h.esc(blocked[0].kind) + '" data-id="' + h.esc(blocked[0].item.id) + '" data-step="publish"'
          : 'data-kind="exam"'),
      todo("flag", "已停用题目", disabled.length, "停用后不可被组卷引用，可随时恢复",
        "去复核", "admin.bank.open", 'data-id="__all__" data-tab="questions" data-status="disabled"')
    ].join("");

    var statusBars = [
      A.barRow("已发布", published.length, all.length || 1, " 道", " is-ok"),
      A.barRow("草稿（候选题）", drafts.length, all.length || 1, " 道", " is-warn"),
      A.barRow("已停用", disabled.length, all.length || 1, " 道", "")
    ].join("");

    var tplRows = catalog.paperTemplates().map(function (t) {
      var modeLabel = EX.engine.MODES[t.mode] ? EX.engine.MODES[t.mode].label : t.mode;
      return '<li class="todo-card is-done" style="padding:var(--sp-3)">' +
        '<div class="todo-main"><span class="todo-label">' + h.esc(t.name) + "</span>" +
        '<span class="todo-hint">' + h.esc((t.kind === "practice" ? "练习" : "试卷") + " · " + modeLabel +
          " · " + (t.items || []).length + " 题 · " + (t.durationMin || 0) + " 分钟") + "</span></div>" +
        '<button type="button" class="btn btn-sm" data-action="admin.wb.tpl.open" data-id="' + h.esc(t.id) + '">查看</button></li>';
    }).join("");

    var batches = [];
    catalog.imports().slice(-3).reverse().forEach(function (b) {
      batches.push('<li class="list-row"><div><div class="strong" style="font-weight:500">' + h.esc(b.fileName) + "</div>" +
        '<div class="text-xs text-3">' + h.esc(b.id + " · " + b.createdAt + " · " + b.rowCount + " 行") + "</div></div>" +
        '<span class="badge ' + (b.status === "adopted" ? "badge-ok" : "badge-warn") + '">' +
        (b.status === "adopted" ? "已采纳" : "待采纳") + "</span></li>");
    });
    catalog.generations().slice(-3).reverse().forEach(function (g) {
      batches.push('<li class="list-row"><div><div class="strong" style="font-weight:500">' + h.esc(g.prompt) + "</div>" +
        '<div class="text-xs text-3">' + h.esc(g.id + " · " + g.createdAt + " · " + g.count + " 题") + "</div></div>" +
        '<span class="badge ' + (g.status === "adopted" ? "badge-ok" : "badge-warn") + '">' +
        (g.status === "adopted" ? "已采纳" : "待采纳") + "</span></li>");
    });

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">概览</h1>' +
        '<p class="page-sub">工作台汇总内容生产、组卷与阅卷三类待办，所有数字直接来自当前题库状态，可直接跳转处理。</p>' +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="admin.paper.new" data-kind="exam">' + EX.icon("plus") + "新建试卷</button>" +
        '<button class="btn btn-primary" data-action="admin.bank.open" data-id="__all__" data-tab="produce">' +
          EX.icon("layers") + "内容生产</button>" +
      "</div></div>" +
      '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
        A.statCard("题目总数", all.length, "道", "覆盖 " + catalog.banks().length + " 个题库") +
        A.statCard("已发布", published.length, "道", "可被组卷与练习引用") +
        A.statCard("试卷", exams.length, "份", draftExams.length + " 份待发布") +
        A.statCard("练习", practices.length, "个", draftPractices.length + " 个待上架") +
        A.statCard("待阅卷", pendingReviews.length, "份", "主观题评分队列") +
      "</div>" +
      '<div class="grid-main">' +
        '<section class="card"><div class="card-head"><h2 class="card-title">待办工作台</h2>' +
          '<span class="text-sm text-3">' + (drafts.length + draftExams.length + draftPractices.length + pendingReviews.length + blocked.length) + " 项待处理</span></div>" +
          '<div class="card-body"><div class="todo-list">' + todoHtml + "</div></div></section>" +
        '<div>' +
          '<section class="card"><div class="card-head"><h2 class="card-title">内容状态分布</h2></div>' +
            '<div class="card-body">' + statusBars +
            '<p class="section-note" style="margin-top:var(--sp-3)">仅「已发布」题目可进入试卷与练习；草稿需审核发布，停用可恢复。</p>' +
            "</div></section>" +
          '<section class="card" style="margin-top:var(--sp-4)"><div class="card-head"><h2 class="card-title">卷型模板</h2>' +
            '<span class="text-sm text-3">' + catalog.paperTemplates().length + " 个</span></div>" +
            '<div class="card-body">' + (tplRows ? '<ul class="todo-list" style="padding:0;list-style:none">' + tplRows + "</ul>"
              : emptyBlock("暂无卷型模板", "在组卷向导中可把配分与卷型保存为模板。")) + "</div></section>" +
          '<section class="card" style="margin-top:var(--sp-4)"><div class="card-head"><h2 class="card-title">最近生产批次</h2></div>' +
            '<div class="card-body is-flush">' + (batches.length ? '<ul class="list">' + batches.join("") + "</ul>"
              : emptyBlock("暂无批次", "导入或 AI 生成后会在此留痕。")) + "</div></section>" +
        "</div>" +
      "</div>";
  };
/* ---------------------------------------------------------- 组卷列表 */
  EX.views["admin.papers"] = function (params) {
    var kind = params.kind || wb.papers.kind || "exam";
    wb.papers.kind = kind;
    var isExam = kind === "exam";
    var list = isExam ? catalog.exams() : catalog.practices();

    var rows = list.map(function (item) {
      var items = catalog.itemsOf(item);
      var score = sumScore(items);
      var extra = isExam
        ? '<td>' + h.esc(EX.engine.MODES[(item.plum && item.plum.mode) || "standard"].label) + "</td>" +
          "<td>" + h.esc(scopeLabel(item.scope)) + "</td>"
        : "<td>" + h.esc(scopeLabel(item.scope)) + "</td>" +
          '<td class="num">' + (item.repeats || 0) + "</td>";
      var check = catalog.preflight(kind, item.id);
      var checkCell = check.ok
        ? '<span class="badge badge-ok">校验通过</span>'
        : '<button type="button" class="badge badge-warn" data-action="admin.paper.open" data-kind="' + h.esc(kind) +
          '" data-id="' + h.esc(item.id) + '" data-step="publish" title="' + h.esc(check.failed + " 项未通过，点击进入发布校验") +
          '">' + check.failed + " 项未通过</button>";
      return "<tr>" +
        '<td><div class="strong" style="font-weight:500">' + h.esc(item.name) + "</div>" +
          '<div class="text-xs text-3">' + h.esc(isExam ? (item.batch || "—") : (item.note || "—")) + "</div></td>" +
        "<td>" + paperBadge(kind, item) + "</td>" +
        '<td class="num">' + items.length + "</td>" +
        '<td class="num">' + score + "</td>" +
        '<td class="num">' + (item.durationMin || 0) + "</td>" +
        extra +
        "<td>" + checkCell + "</td>" +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-primary" data-action="admin.paper.open" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(item.id) + '">' +
            (isExam ? "组卷向导" : "练习设置") + "</button> " +
          '<button class="btn btn-sm" data-action="admin.entity.tags" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(item.id) + '">标签</button> ' +
          '<button class="btn btn-sm btn-danger" data-action="admin.paper.delete" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(item.id) + '">删除</button>' +
        "</td></tr>";
    }).join("");

    var cols = 9;

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">组卷</h1>' +
        '<p class="page-sub">试卷与练习都是「卷对象」：先定基本信息，再选题配分、设卷型，最后配置名单与发布。' +
          "每一步都有发布前校验，未通过的项会阻止发布。</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="admin.paper.new" data-kind="practice">' + EX.icon("plus") + "新建练习</button>" +
        '<button class="btn btn-primary" data-action="admin.paper.new" data-kind="exam">' + EX.icon("plus") + "新建试卷</button>" +
      "</div></div>" +
      '<div class="seg" style="margin-bottom:var(--sp-4)">' +
        '<button type="button" aria-pressed="' + (isExam ? "true" : "false") + '" data-action="admin.papers.kind" data-value="exam">考试卷 ' +
          catalog.exams().length + "</button>" +
        '<button type="button" aria-pressed="' + (isExam ? "false" : "true") + '" data-action="admin.papers.kind" data-value="practice">练习 ' +
          catalog.practices().length + "</button>" +
      "</div>" +
      '<section class="card"><div class="card-head"><h2 class="card-title">' + (isExam ? "考试卷" : "练习") + "</h2>" +
        '<span class="text-sm text-3">' + list.length + " 个</span></div>" +
        '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>名称</th><th>状态</th><th>题量</th><th>总分</th><th>时长(分)</th>" +
        (isExam ? "<th>卷型</th><th>名单</th>" : "<th>开放范围</th><th>可重复次数</th>") +
        "<th>发布校验</th><th></th></tr></thead>" +
        "<tbody>" + (rows || '<tr><td colspan="' + cols + '">' + emptyBlock("暂无对象", "点击右上角新建。") + "</td></tr>") +
        "</tbody></table></div></div></section>";
  };

  /* ---------------------------------------------------------- 四步向导 */
  function stepNav(kind, id, current) {
    var steps = WIZ_STEPS[kind];
    var curIdx = 0;
    steps.forEach(function (s, i) { if (s.key === current) curIdx = i; });
    return '<ol class="steps">' + steps.map(function (s, i) {
      var cls = s.key === current ? "is-current" : (i < curIdx ? "is-done" : "");
      return '<li class="step ' + cls + '">' +
        '<button type="button" class="step-btn" data-action="admin.paper.step" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) +
        '" data-step="' + h.esc(s.key) + '"' + (s.key === current ? ' aria-current="step"' : "") + ">" +
        '<span class="step-index" aria-hidden="true">' + (i + 1) + "</span>" +
        '<span class="step-text"><span class="step-label">' + h.esc(s.label) + "</span>" +
        '<span class="step-hint">' + h.esc(s.hint) + "</span></span></button></li>";
    }).join("") + "</ol>";
  }

  function checklistHtml(result) {
    var items = result.checks.map(function (c) {
      return '<li class="check-item ' + (c.ok ? "is-ok" : "is-bad") + '">' +
        '<span class="check-mark" aria-hidden="true">' + EX.icon(c.ok ? "check" : "close") + "</span>" +
        '<span class="check-text"><span class="check-label">' + h.esc(c.label) + "</span>" +
        '<span class="check-detail">' + h.esc(c.detail) + "</span></span>" +
        '<span class="check-state">' + (c.ok ? "通过" : "未通过") + "</span></li>";
    }).join("");
    return '<ul class="checklist">' + items + "</ul>" +
      '<p class="section-note" style="margin-top:var(--sp-3)">共 ' + result.total + " 项检查，" +
      (result.failed ? "其中 " + result.failed + " 项未通过，需修正后才能发布。" : "全部通过，可以发布。") + "</p>";
  }

  function classChips(kind, id, item) {
    var scope = item.scope || [];
    return (EX.seed.classes || []).map(function (c) {
      var on = scope.indexOf(c.id) !== -1;
      var count = EX.seed.students.filter(function (s) { return s.className === c.name; }).length;
      return '<button type="button" class="chip' + (on ? " is-on" : "") + '" ' +
        'data-action="admin.paper.scope" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '" data-class="' + h.esc(c.id) + '" ' +
        'aria-pressed="' + (on ? "true" : "false") + '">' + h.esc(c.name) + " · " + count + " 人</button>";
    }).join("");
  }

  EX.views["admin.paper"] = function (params) {
    var kind = params.kind === "practice" ? "practice" : "exam";
    var id = params.id || "";
    var step = params.step || "basic";
    var item = kind === "exam" ? catalog.getExam(id) : catalog.getPractice(id);
    if (!item) {
      return '<div class="page-head"><div><h1 class="page-title">' + (kind === "exam" ? "试卷" : "练习") + "</h1>" +
        '<p class="page-sub">对象不存在或已被删除。</p></div></div>' +
        emptyBlock("未找到该对象", "请返回列表重新选择。",
          '<button class="btn btn-primary" data-action="admin.papers.list" data-kind="' + h.esc(kind) + '">返回列表</button>');
    }
    var switched = wb.wiz.kind !== kind || wb.wiz.id !== id;
    wb.wiz.kind = kind;
    wb.wiz.id = id;
    wb.wiz.step = step;
    if (step !== "select" || switched) {
      wb.wiz.openField = "";
      if (switched) wb.wiz.qsel = { bank: [], type: [], keyword: "", tags: [] };
    }
    if (kind === "exam") {
      var cfg = catalog.plumCfg(id);
      wb.wiz.mode = cfg.mode;
    }

    var steps = WIZ_STEPS[kind];
    var curIdx = 0;
    steps.forEach(function (s, i) { if (s.key === step) curIdx = i; });
    var body = "";
    if (step === "basic") body = stepBasic(kind, id, item);
    else if (step === "select") body = stepSelect(kind, id, item);
    else if (step === "plum") body = stepPlum(kind, id, item);
    else body = stepPublish(kind, id, item);

    var prevStep = curIdx > 0 ? steps[curIdx - 1].key : "";
    var nextStep = curIdx < steps.length - 1 ? steps[curIdx + 1].key : "";

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">' + h.esc(item.name) + "</h1>" +
        '<p class="page-sub">' + (kind === "exam" ? "考试卷" : "练习") + " · " +
          h.esc((item.batch || item.note || "尚未填写说明")) + " · 第 " + (curIdx + 1) + " / " + steps.length + " 步</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="admin.papers.list" data-kind="' + h.esc(kind) + '">返回列表</button>' +
        '<button class="btn" data-action="admin.entity.tags" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">标签</button>' +
      "</div></div>" +
      stepNav(kind, id, step) +
      '<div id="wiz-step">' + body + "</div>";
  };
/* ------------------------------------------------------ 向导 · 基本信息 */
  function stepBasic(kind, id, item) {
    var isExam = kind === "exam";
    var fields = '<div class="grid-2">' +
      '<div class="field"><label class="field-label" for="wiz-name">名称<span class="field-req">*</span></label>' +
        '<input class="input" id="wiz-name" type="text" value="' + h.esc(item.name) + '" placeholder="例如 计算机网络期中考试"></div>' +
      (isExam
        ? '<div class="field"><label class="field-label" for="wiz-batch">考试批次</label>' +
          '<input class="input" id="wiz-batch" type="text" value="' + h.esc(item.batch || "") + '" placeholder="例如 2026—2027 学年第一学期 · 期中考试"></div>'
        : '<div class="field"><label class="field-label" for="wiz-duration">建议时长（分钟）</label>' +
          '<input class="input" id="wiz-duration" type="number" min="1" max="300" value="' + (item.durationMin || 20) + '"></div>') +
      "</div>";

    if (isExam) {
      fields += '<div class="grid-4" style="margin-top:var(--sp-4)">' +
        '<div class="field"><label class="field-label" for="wiz-duration">时长（分钟）</label>' +
          '<input class="input" id="wiz-duration" type="number" min="1" max="300" value="' + (item.durationMin || 60) + '"></div>' +
        '<div class="field"><label class="field-label" for="wiz-total">总分</label>' +
          '<input class="input" id="wiz-total" type="number" min="0" max="200" value="' + (item.totalScore || 0) + '"></div>' +
        '<div class="field"><label class="field-label" for="wiz-pass">及格分</label>' +
          '<input class="input" id="wiz-pass" type="number" min="0" max="200" value="' + (item.passScore || 0) + '"></div>' +
        '<div class="field"><label class="field-label" for="wiz-open">开考时间</label>' +
          '<input class="input" id="wiz-open" type="text" value="' + h.esc(item.openAt || "") + '" placeholder="2026-11-09 08:30"></div>' +
      "</div>" +
        '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="wiz-close">结束时间</label>' +
          '<input class="input" id="wiz-close" type="text" value="' + h.esc(item.closeAt || "") + '" placeholder="2026-11-09 12:00"></div>';
    }

    fields += '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="wiz-note">说明</label>' +
      '<textarea class="textarea" id="wiz-note" placeholder="面向答题者的说明与注意事项">' + h.esc(item.note || "") + "</textarea></div>";

    var rules = "";
    if (!isExam) {
      rules = '<h3 class="section-title" style="margin-top:var(--sp-5)">练习规则</h3>' +
        '<div class="grid-2" style="margin-top:var(--sp-3)">' +
          '<div class="field"><label class="field-label" for="wiz-repeats">可重复次数</label>' +
            '<input class="input" id="wiz-repeats" type="number" min="0" max="99" value="' + (item.repeats || 0) + '">' +
            '<span class="field-hint">0 表示不限次数。</span></div>' +
          '<div class="field"><label class="field-label" for="wiz-feedback">解析反馈时机</label>' +
            '<div class="select-wrap"><select class="select" id="wiz-feedback">' +
              '<option value="immediate"' + (item.feedback === "immediate" ? " selected" : "") + ">每题作答后即时反馈</option>" +
              '<option value="after_submit"' + (item.feedback !== "immediate" ? " selected" : "") + ">提交后统一展示解析</option>" +
            "</select></div></div>" +
        "</div>" +
        '<label class="checkline" style="margin-top:var(--sp-4)"><input type="checkbox" id="wiz-mistake"' +
          (item.mistakeReflow === false ? "" : " checked") + ">" +
          '<span class="checkline-text">错题自动回流至错题本' +
          '<span class="checkline-hint">练习中答错的题目会进入答题者的错题本，用于后续专项复习。</span></span></label>' +
        '<h3 class="section-title" style="margin-top:var(--sp-5)">开放范围</h3>' +
        '<div class="row-tight" style="margin-top:var(--sp-3)">' + classChips(kind, id, item) + "</div>" +
        '<p class="section-note" style="margin-top:var(--sp-2)">不选任何名单组即为全员开放。</p>';
    }

    return '<section class="card"><div class="card-head"><h2 class="card-title">基本信息</h2>' +
      '<span class="text-sm text-3">' + h.esc(scopeLabel(item.scope)) + "</span></div>" +
      '<div class="card-body">' + fields + rules + "</div>" +
      '<div class="card-foot"><button class="btn btn-primary" data-action="admin.paper.save.basic" data-kind="' + h.esc(kind) +
        '" data-id="' + h.esc(id) + '" data-step="select">保存并选择题目</button></div></section>';
  }

  /* ------------------------------------------------------ 向导 · 选题配分 */
  function pickedRowsHtml(kind, id) {
    var item = kind === "exam" ? catalog.getExam(id) : catalog.getPractice(id);
    var items = catalog.itemsOf(item);
    if (!items.length) return '<div class="empty"><span class="empty-title">尚未选题</span>' +
      '<span class="empty-body">在左侧勾选题目，并为其设置分值。</span></div>';
    var byQid = {};
    items.forEach(function (it) { byQid[it.qid] = it; });
    var ordered = EX.engine.baseOrder({
      questionIds: items.map(function (it) { return it.qid; }),
      orderRule: item.orderRule
    });
    return ordered.map(function (qid, i) {
      var it = byQid[qid] || { qid: qid, score: 0 };
      var q = catalog.getQuestion(qid);
      return '<div class="wiz-picked-row" data-qid="' + h.esc(qid) + '">' +
        '<span class="pick-id mono">' + (i + 1) + "</span>" +
        '<div class="wiz-picked-main">' +
          '<span class="wiz-picked-stem">' + h.esc(q ? q.stem : qid) + "</span>" +
          '<span class="wiz-picked-meta">' + A.typeBadge(q ? q.type : "") +
            A.difficultyChip(q) + "</span>" +
        "</div>" +
        '<input class="input" type="number" min="0" max="40" value="' + (Number(it.score) || 0) + '" ' +
          'data-change="admin.wiz.score" data-qid="' + h.esc(qid) + '" ' +
          'data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '" aria-label="' + h.esc(qid) + ' 分值">' +
        '<button type="button" class="icon-btn" data-action="admin.wiz.unpick" data-qid="' + h.esc(qid) + '" ' +
          'data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '" ' +
          'aria-label="移除 ' + h.esc(qid) + '">' + EX.icon("trash") + "</button></div>";
    }).join("");
  }

  function stepSelect(kind, id, item) {
    var items = catalog.itemsOf(item);
    var qsel = wb.wiz.qsel;
    var bankMap = {};
    catalog.banks().forEach(function (b) {
      (b.questionIds || []).forEach(function (qid) { (bankMap[qid] = bankMap[qid] || []).push(b.id); });
    });
    var all = catalog.questions();
    var available = all.filter(function (q) { return catalog.statusOf(q) === "published"; });
    var pickedIds = items.map(function (it) { return it.qid; });

    var rows = available.map(function (q) {
      var on = pickedIds.indexOf(q.id) !== -1;
      var kw = (q.id + " " + q.stem).toLowerCase();
      return '<label class="pick-row has-meta" data-kw="' + h.esc(kw) + '" data-type="' + h.esc(q.type) +
        '" data-tags="' + h.esc((q.tags || []).join(",")) + '" data-bank="' + h.esc((bankMap[q.id] || []).join(",")) + '">' +
        '<input type="checkbox" data-change="admin.wiz.pick" data-qid="' + h.esc(q.id) + '"' +
          ' data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '"' + (on ? " checked" : "") + ">" +
        '<span class="pick-id mono">' + h.esc(q.id) + "</span>" +
        '<span class="pick-text">' + h.esc(q.stem) + "</span>" +
        '<span class="text-xs text-3">' + q.score + " 分</span></label>";
    }).join("");

    var tpls = catalog.paperTemplates().filter(function (t) { return t.kind === kind; });
    var tplOptions = tpls.map(function (t) {
      return '<option value="' + h.esc(t.id) + '">' + h.esc(t.name) + "（" + (t.items || []).length + " 题）</option>";
    }).join("");

    var total = sumScore(items);
    var target = Number(item.totalScore) || 0;

    var rule = catalog.normalizeOrderRule(item.orderRule);
    var ruleMeta = catalog.ORDER_RULES.filter(function (r) { return r.id === rule; })[0] || catalog.ORDER_RULES[0];
    var ruleOptions = catalog.ORDER_RULES.map(function (r) {
      return '<option value="' + h.esc(r.id) + '"' + (r.id === rule ? " selected" : "") + ">" + h.esc(r.label) + "</option>";
    }).join("");

    var bankItems = catalog.banks().map(function (b) {
      var st = catalog.bankStats(b.id);
      return { value: b.id, label: b.name, meta: st.published + " 题" };
    });
    var typeItems = EX.seed.QUESTION_TYPES.map(function (t) {
      var n = available.filter(function (q) { return q.type === t.id; }).length;
      return { value: t.id, label: t.label || t.name, meta: n + " 题" };
    });

    return '<div class="grid-2">' +
      '<section class="card"><div class="card-head"><h2 class="card-title">可选题目</h2>' +
        '<span class="text-sm text-3">仅「已发布」题目可入选</span></div>' +
        '<div class="card-body">' +
          '<div class="row" style="margin-bottom:var(--sp-3)">' +
            mselectHtml({
              field: "bank",
              title: "题库",
              allLabel: "全部题库",
              items: bankItems,
              selected: qsel.bank,
              minWidth: 170
            }) +
            mselectHtml({
              field: "type",
              title: "题型",
              allLabel: "全部题型",
              items: typeItems,
              selected: qsel.type,
              minWidth: 150
            }) +
            '<input class="input" type="search" data-search="wiz-q" value="' + h.esc(qsel.keyword) + '" placeholder="搜索题号或题干" style="min-width:180px">' +
          "</div>" +
          '<p class="section-note" style="margin:-4px 0 var(--sp-3)">题库与题型均可多选；未选择时表示不限制，命中任一所选项即列出。</p>' +
          tagFilterPanel(qsel.tags) +
        "</div>" +
        '<div class="card-body is-flush"><div class="pick-list" id="wiz-available" style="max-height:420px">' +
          (rows || emptyBlock("没有可用的已发布题目", "请先在题库工作台发布题目。")) + "</div>" +
          '<div class="empty" id="wiz-nomatch" hidden><span class="empty-title">没有符合条件的题目</span>' +
            "<span class=\"empty-body\">调整题库、题型或标签筛选条件后重试。</span></div></div></section>" +
      '<section class="card"><div class="card-head"><h2 class="card-title">已选题目</h2>' +
        '<span class="text-sm text-3" id="wiz-total-text">合计 ' + total + " / 目标 " + target + " 分</span></div>" +
        '<div class="card-body">' +
          '<div class="field" style="margin-bottom:var(--sp-3)">' +
            '<label class="field-label" for="wiz-order-rule">题序规则</label>' +
            '<div class="select-wrap"><select class="select" id="wiz-order-rule" data-change="admin.wiz.orderRule" ' +
              'data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">' + ruleOptions + "</select></div>" +
            '<span class="field-hint" id="wiz-order-rule-hint">' + h.esc(ruleMeta.desc) +
              " 下列序号是出卷的基础题序：标准卷与小梅花按此顺序出卷，大梅花保留题型分块顺序、仅在每个题型内部打乱题目。</span>" +
          "</div>" +
          '<div class="row" style="margin-bottom:var(--sp-3)">' +
            '<button class="btn btn-sm" data-action="admin.wiz.even" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">按题量均分</button>' +
            '<button class="btn btn-sm" data-action="admin.wiz.align" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">对齐目标总分</button>' +
          "</div>" +
          '<div id="wiz-picked" class="wiz-picked">' + pickedRowsHtml(kind, id) + "</div>" +
        "</div>" +
        '<div class="card-body" style="border-top:1px solid var(--c-border)">' +
          '<div class="row">' +
            (tpls.length
              ? '<div class="select-wrap" style="min-width:190px"><select class="select" id="wiz-tpl">' + tplOptions + "</select></div>" +
                '<button class="btn btn-sm" data-action="admin.wiz.tpl.apply" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">套用模板</button>'
              : '<span class="text-sm text-3">暂无卷型模板，可将当前配分保存为模板。</span>') +
            '<input class="input" id="wiz-tpl-name" type="text" placeholder="模板名称" style="min-width:150px">' +
            '<button class="btn btn-sm" data-action="admin.wiz.tpl.save" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">保存为模板</button>' +
          "</div>" +
        "</div>" +
        '<div class="card-foot"><button class="btn btn-primary" data-action="admin.paper.step" data-kind="' + h.esc(kind) +
          '" data-id="' + h.esc(id) + '" data-step="plum">下一步 · 卷型</button></div></section>' +
      "</div>";
  }

  /* ------------------------------------------------------ 梅花卷卷面测算 */
  /**
   * 测算当前设置会生成多少种不同卷面。
   * 标准卷：全体共用一份（1 种）。
   * 小梅花：题序统一、选项逐人打乱（卷面种类 = 答题者人数）。
   * 大梅花：题型分块保留、组内题序与选项均逐人打乱（卷面种类 = 答题者人数）。
   */
  function variantPlan(scope) {
    var all = (EX.seed && EX.seed.students) || [];
    var scoped = catalog.scopeStudents(scope);
    if (!scoped.length) scoped = all.slice();
    return {
      students: scoped.length,
      variants: scoped.length,
      perVariant: 1
    };
  }

  /* ------------------------------------------------------ 向导 · 卷型梅花 */
  function stepPlum(kind, id, item) {
    if (kind === "practice") {
      return '<section class="card"><div class="card-head"><h2 class="card-title">卷型与规则</h2></div>' +
        '<div class="card-body">' +
          '<div class="callout"><span class="callout-title">' + EX.icon("info") + "练习卷按固定顺序组卷</span>" +
          "<span>练习卷面向单个答题者的巩固训练，题序按第 2 步选定的题序规则排布，选项顺序固定，不生成梅花卷变体；需要变式训练时可在题库中维护多套练习。</span></div>" +
          '<dl class="kv" style="margin-top:var(--sp-5)">' +
            "<dt>题量</dt><dd>" + catalog.itemsOf(item).length + " 道</dd>" +
            "<dt>题序规则</dt><dd>" + h.esc(catalog.orderRuleLabel(item.orderRule)) + "</dd>" +
            "<dt>总分</dt><dd>" + sumScore(catalog.itemsOf(item)) + " 分</dd>" +
            "<dt>时长</dt><dd>" + (item.durationMin || 0) + " 分钟</dd>" +
            "<dt>开放范围</dt><dd>" + h.esc(scopeLabel(item.scope)) + "</dd>" +
          "</dl>" +
        "</div>" +
        '<div class="card-foot"><button class="btn btn-primary" data-action="admin.paper.step" data-kind="' + h.esc(kind) +
          '" data-id="' + h.esc(id) + '" data-step="publish">下一步 · 上架</button></div></section>';
    }

    var cfg = catalog.plumCfg(id);
    var modes = [
      { id: "standard", label: "标准卷", desc: "全体答题者同一份卷面：题序按题型分块、组内由易到难，选项顺序固定。" },
      { id: "small", label: "小梅花", desc: "题目顺序全体统一保留，仅每位答题者的选项顺序独立打乱。" },
      { id: "large", label: "大梅花", desc: "保留题型分块的先后顺序（单选→多选→判断→简答→综合），每个题型内部的题目顺序按答题者独立打乱，选项顺序同样独立打乱。" }
    ];
    var modeCards = '<div class="grid-3">' + modes.map(function (m) {
      var on = cfg.mode === m.id;
      var label = EX.engine.MODES[m.id] ? EX.engine.MODES[m.id].label : m.label;
      return '<button type="button" class="mode-card' + (on ? " is-on" : "") + '" ' +
        'data-action="admin.wiz.mode" data-id="' + h.esc(id) + '" data-mode="' + h.esc(m.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="mode-name">' + h.esc(label) + "</span>" +
        '<span class="mode-desc">' + h.esc(m.desc) + "</span></button>";
    }).join("") + "</div>";

    var students = catalog.scopeStudents(item.scope);
    if (!students.length) students = EX.seed.students.slice();
    var plan = variantPlan(item.scope);
    var planText = cfg.mode === "standard"
      ? "标准卷不生成变体，全体答题者共用同一份卷面。"
      : cfg.mode === "small"
        ? "当前名单 " + plan.students + " 名答题者 → 共 " + plan.variants + " 种不同卷面（题序统一，仅选项顺序逐人打乱）。"
        : "当前名单 " + plan.students + " 名答题者 → 共 " + plan.variants + " 种不同卷面（题型分块顺序不变，组内题序与选项顺序逐人打乱）。";

    return '<section class="card"><div class="card-head"><h2 class="card-title">卷型与梅花卷</h2>' +
      '<span class="text-sm text-3">置换种子由系统自动生成</span></div>' +
      '<div class="card-body">' + modeCards +
        '<div class="grid-2" style="margin-top:var(--sp-5)">' +
          '<div class="field"><span class="field-label">题序规则</span>' +
            '<div class="text-sm text-3">' + h.esc(catalog.orderRuleLabel(item.orderRule)) +
            "（第 2 步设定）</div></div>" +
          '<div class="field"><span class="field-label">卷面生成方式</span>' +
            '<div class="text-sm text-3">' +
              (cfg.mode === "standard" ? "固定卷面，全体一致"
                : cfg.mode === "small" ? "题序统一，逐人打乱选项"
                : "题型分块保留，组内题序与选项逐人打乱") +
            "</div></div>" +
        "</div>" +
        '<div class="callout" style="margin-top:var(--sp-4)"><span class="callout-title">' +
          EX.icon("info") + "置换口径</span><span>" + h.esc(planText) +
          " 小梅花保留统一题序、仅逐人打乱选项；大梅花保留题型分块顺序（单选→多选→判断→简答→综合），仅在每个题型内部打乱题目顺序，选项也逐人打乱。" +
          " 置换种子由系统按试卷自动生成，无需手工设置；同一试卷重复出卷结果一致，可随时复核。判断题固定不参与选项置换。</span></div>" +
        '<div class="row" style="margin-top:var(--sp-5)">' +
          '<span class="text-sm text-3">卷型选择即时生效并自动保存，可切换到「答题者卷面」预览逐人对照：标准卷完全一致，小梅花仅选项顺序不同，大梅花题型分块不变、组内题序与选项顺序均不同。</span>' +
        "</div>" +
      "</div></section>" +
      A.previewSection(item, cfg, students, EX.admin.previewState.index) +
      '<div class="card-foot"><button class="btn btn-primary" data-action="admin.paper.step" data-kind="' + h.esc(kind) +
        '" data-id="' + h.esc(id) + '" data-step="publish">下一步 · 名单与发布</button></div>';
  }

  /* ------------------------------------------------------ 向导 · 名单发布 */
  function stepPublish(kind, id, item) {
    var isExam = kind === "exam";
    var result = catalog.preflight(kind, id);
    var published = isExam ? item.status !== "draft" && item.published !== false : item.status === "published";

    var settings = "";
    if (isExam) {
      settings = '<h3 class="section-title">考试设置</h3>' +
        '<div class="grid-2" style="margin-top:var(--sp-3)">' +
          '<div class="field"><label class="field-label" for="wiz-publish-answer">答案公布时机</label>' +
            '<div class="select-wrap"><select class="select" id="wiz-publish-answer">' +
              '<option value="after_close"' + (item.publishAnswer !== "after_submit" && item.publishAnswer !== "immediately" ? " selected" : "") + ">考试结束后公布</option>" +
              '<option value="after_submit"' + (item.publishAnswer === "after_submit" ? " selected" : "") + ">交卷后立即公布</option>" +
              '<option value="immediately"' + (item.publishAnswer === "immediately" ? " selected" : "") + ">开考即公布</option>" +
            "</select></div></div>" +
          '<div class="field"><span class="field-label">补考策略</span>' +
            '<label class="checkline"><input type="checkbox" id="wiz-retake"' + (item.allowRetake ? " checked" : "") + ">" +
            '<span class="checkline-text">允许重考<span class="checkline-hint">开启后答题者可重复进入本场考试，成绩取最高分。</span></span></label></div>' +
        "</div>" +
        '<h3 class="section-title" style="margin-top:var(--sp-5)">考试名单</h3>' +
        '<div class="row-tight" style="margin-top:var(--sp-3)">' + classChips(kind, id, item) + "</div>" +
        '<p class="section-note" style="margin-top:var(--sp-2)">当前覆盖 ' +
        catalog.scopeStudents(item.scope).length + " 名答题者；名单为空时不可发布。</p>";
    } else {
      settings = '<h3 class="section-title">开放范围</h3>' +
        '<div class="row-tight" style="margin-top:var(--sp-3)">' + classChips(kind, id, item) + "</div>" +
        '<p class="section-note" style="margin-top:var(--sp-2)">不选名单组即为全员开放；上架后答题端可见。</p>';
    }

    var btn = published
      ? '<button class="btn" data-action="admin.paper.unpublish" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '">' +
        (isExam ? "撤回发布" : "下架") + "</button>"
      : '<button class="btn btn-primary" data-action="admin.paper.publish" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '"' +
        (result.ok ? "" : " disabled") + ">" + (isExam ? "发布考试" : "上架练习") + "</button>";

    return '<section class="card"><div class="card-head"><h2 class="card-title">' +
        (isExam ? "名单与发布" : "开放与上架") + "</h2>" +
        '<span class="text-sm text-3">' + (published ? "已发布" : "未发布") + "</span></div>" +
      '<div class="card-body">' + settings +
        '<h3 class="section-title" style="margin-top:var(--sp-5)">发布前校验</h3>' +
        '<div style="margin-top:var(--sp-3)">' + checklistHtml(result) + "</div>" +
        (result.ok ? "" : '<div class="callout is-warn" style="margin-top:var(--sp-4)"><span class="callout-title">' +
          EX.icon("alert") + "存在未通过的校验项</span><span>请先修正上述问题，发布按钮在全部校验通过后才会启用。</span></div>") +
      "</div>" +
      '<div class="card-foot">' +
        '<button class="btn" data-action="admin.paper.step" data-kind="' + h.esc(kind) + '" data-id="' + h.esc(id) + '" data-step="plum">上一步 · 卷型</button> ' +
        btn +
      "</div></section>";
  }
/* ================================================================ 动作 */
  function fieldValue(id) {
    var el = doc.getElementById(id);
    return el ? el.value : "";
  }

  function checkedValue(id) {
    var el = doc.getElementById(id);
    return !!(el && el.checked);
  }

  function paperOf(kind, id) {
    return kind === "exam" ? catalog.getExam(id) : catalog.getPractice(id);
  }

  /** 选题 / 配分动作的归属对象：优先取元素属性，回退到当前向导上下文 */
  function wizTarget(el) {
    var kind = el.getAttribute("data-kind") || wb.wiz.kind;
    var id = el.getAttribute("data-id") || wb.wiz.id;
    return { kind: kind === "practice" ? "practice" : "exam", id: id };
  }

  function saveItems(kind, id, items) {
    var res = catalog.setPaperItems(kind, id, items);
    if (!res.ok) EX.toast(res.message || "保存失败", "error");
    return res.ok;
  }

  function syncPicked(kind, id) {
    var host = doc.getElementById("wiz-picked");
    if (host) host.innerHTML = pickedRowsHtml(kind, id);
    var item = paperOf(kind, id);
    if (!item) return;
    var items = catalog.itemsOf(item);
    var label = doc.getElementById("wiz-total-text");
    if (label) label.textContent = "合计 " + sumScore(items) + " / 目标 " + (Number(item.totalScore) || 0) + " 分";
  }

  function syncCheck(qid, on) {
    var boxes = doc.querySelectorAll('#wiz-available input[type="checkbox"][data-qid="' + qid + '"]');
    Array.prototype.forEach.call(boxes, function (b) { b.checked = on; });
  }

  function applyWizFilters() {
    var host = doc.getElementById("wiz-available");
    if (!host) return;
    var qsel = wb.wiz.qsel;
    var rows = host.querySelectorAll(".pick-row");
    var visible = 0;
    Array.prototype.forEach.call(rows, function (row) {
      var ok = true;
      if (ok && qsel.bank.length) {
        var banks = (row.getAttribute("data-bank") || "").split(",");
        ok = qsel.bank.some(function (b) { return banks.indexOf(b) !== -1; });
      }
      if (ok && qsel.type.length) ok = qsel.type.indexOf(row.getAttribute("data-type")) !== -1;
      if (ok && qsel.tags.length) {
        var tags = (row.getAttribute("data-tags") || "").split(",");
        ok = qsel.tags.some(function (t) { return tags.indexOf(t) !== -1; });
      }
      if (ok && qsel.keyword) ok = (row.getAttribute("data-kw") || "").indexOf(qsel.keyword.toLowerCase()) !== -1;
      row.style.display = ok ? "" : "none";
      if (ok) visible += 1;
    });
    var nomatch = doc.getElementById("wiz-nomatch");
    if (nomatch) nomatch.hidden = visible > 0;
  }

  function evenScores(items, target) {
    if (!items.length) return items;
    var base = Math.floor(target / items.length);
    var rem = target - base * items.length;
    return items.map(function (it, i) {
      return { qid: it.qid, score: base + (i < rem ? 1 : 0) };
    });
  }

  function alignScores(items, target) {
    var out = items.map(function (it) { return { qid: it.qid, score: Number(it.score) || 0 }; });
    if (!out.length) return out;
    var sum = out.reduce(function (a, b) { return a + b.score; }, 0);
    var diff = target - sum;
    var i = out.length - 1;
    var guard = 0;
    while (diff !== 0 && guard < 500) {
      var step = diff > 0 ? 1 : -1;
      if (out[i].score + step >= 0) { out[i].score += step; diff -= step; }
      i = (i - 1 + out.length) % out.length;
      guard += 1;
    }
    return out;
  }

  /* ---------------------------------------------------------- 导航动作 */
  EX.actions["admin.go"] = function (el) {
    var route = el.getAttribute("data-route");
    if (route) EX.router.go(route);
  };

  EX.actions["admin.bank.open"] = function (el) {
    var id = el.getAttribute("data-id") || "__all__";
    var tab = el.getAttribute("data-tab") || "questions";
    var status = el.getAttribute("data-status");
    if (status) wb.q.status = status;
    if (el.getAttribute("data-clear-status") === "1") wb.q.status = "全部";
    EX.router.go("admin.bank", { id: id, tab: tab });
  };

  EX.actions["admin.bank.list"] = function () {
    EX.router.go("admin.banks");
  };

  EX.actions["admin.bank.tab"] = function (el) {
    var id = el.getAttribute("data-id") || wb.bankId;
    var tab = el.getAttribute("data-tab") || "questions";
    EX.router.go("admin.bank", { id: id, tab: tab });
  };

  EX.actions["admin.papers.kind"] = function (el) {
    var kind = el.getAttribute("data-value") === "practice" ? "practice" : "exam";
    wb.papers.kind = kind;
    EX.router.go("admin.papers", { kind: kind });
  };

  EX.actions["admin.papers.list"] = function (el) {
    var kind = el.getAttribute("data-kind") || wb.papers.kind;
    EX.router.go("admin.papers", { kind: kind });
  };

  /* ---------------------------------------------------------- 筛选动作 */
  EX.actions["admin.wb.qfilter"] = function (el) {
    var field = el.getAttribute("data-field");
    var value = el.getAttribute("data-value");
    if (!field) return;
    if (field === "type") value = el.value;
    wb.q[field] = value;
    EX.router.refresh();
  };

  EX.actions["admin.wb.tagfilter"] = function (el) {
    var id = el.getAttribute("data-tag");
    if (!id) return;
    var idx = wb.q.tags.indexOf(id);
    if (idx === -1) wb.q.tags.push(id); else wb.q.tags.splice(idx, 1);
    EX.router.refresh();
  };

  /* ---------------------------------------------------------- 题目动作 */
  EX.actions["admin.q.status"] = function (el) {
    var id = el.getAttribute("data-id");
    var status = el.getAttribute("data-status");
    var res = catalog.setQuestionStatus(id, status);
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast("题目 " + id + " 已" + (status === "published" ? "发布" : (status === "disabled" ? "停用" : "转为草稿")), "ok");
    EX.router.refresh();
  };

  /* -------------------------------------------------------- 候选题动作 */
  EX.actions["admin.cand.source"] = function (el) {
    wb.cand.source = el.getAttribute("data-value") || "全部";
    EX.router.refresh();
  };

  EX.actions["admin.cand.pick"] = function (el) {
    var id = el.getAttribute("data-id");
    if (!id) return;
    var idx = wb.cand.picked.indexOf(id);
    if (el.checked && idx === -1) wb.cand.picked.push(id);
    if (!el.checked && idx !== -1) wb.cand.picked.splice(idx, 1);
  };

  EX.actions["admin.cand.pickall"] = function () {
    var list = catalog.candidatesOf(wb.bankId).filter(function (q) {
      return wb.cand.source === "全部" || (q.source || "manual") === wb.cand.source;
    });
    wb.cand.picked = list.map(function (q) { return q.id; });
    EX.router.refresh();
  };

  EX.actions["admin.cand.clear"] = function () {
    wb.cand.picked = [];
    EX.router.refresh();
  };

  EX.actions["admin.cand.publish"] = function () {
    if (!wb.cand.picked.length) { EX.toast("请先选择候选题", "error"); return; }
    var res = catalog.setQuestionsStatus(wb.cand.picked, "published");
    EX.toast("已发布 " + res.changed + " 道候选题", "ok");
    wb.cand.picked = [];
    EX.router.refresh();
  };

  EX.actions["admin.cand.discard"] = function (el) {
    var id = el.getAttribute("data-id");
    var q = catalog.getQuestion(id);
    if (!q) return;
    EX.confirm({
      title: "丢弃候选题",
      message: "将丢弃题目 " + id + "：" + q.stem + "。丢弃后不可恢复。",
      okText: "确认丢弃",
      onConfirm: function () {
        var res = catalog.discardQuestion(id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
        EX.toast("已丢弃 " + id, "ok");
        EX.router.refresh();
      }
    });
  };

  EX.actions["admin.cand.discardAll"] = function () {
    if (!wb.cand.picked.length) { EX.toast("请先选择候选题", "error"); return; }
    var ids = wb.cand.picked.slice();
    EX.confirm({
      title: "批量丢弃候选题",
      message: "将丢弃 " + ids.length + " 道候选题，丢弃后不可恢复。",
      okText: "确认丢弃",
      onConfirm: function () {
        var n = 0;
        ids.forEach(function (id) { if (catalog.discardQuestion(id).ok) n += 1; });
        EX.toast("已丢弃 " + n + " 道候选题", "ok");
        wb.cand.picked = [];
        EX.router.refresh();
      }
    });
  };

  /* ------------------------------------------------------ 内容生产动作 */
  EX.actions["admin.produce.mode"] = function (el) {
    wb.produce.mode = el.getAttribute("data-value") === "gen" ? "gen" : "import";
    wb.produce.batchId = "";
    EX.router.refresh();
  };

  EX.actions["admin.produce.tag"] = function (el) {
    var id = el.getAttribute("data-tag");
    var idx = wb.produce.genTags.indexOf(id);
    if (idx === -1) {
      if (wb.produce.genTags.length >= 5) { EX.toast("最多只能选择 5 个标签", "error"); return; }
      wb.produce.genTags.push(id);
    } else {
      wb.produce.genTags.splice(idx, 1);
    }
    EX.router.refresh();
  };

  EX.actions["admin.produce.parse"] = function () {
    var fileName = String(fieldValue("imp-file") || "").trim();
    if (!fileName) { EX.toast("请填写试题文件名", "error"); return; }
    var count = parseInt(fieldValue("imp-count"), 10) || 3;
    var res = catalog.createImportBatch({ fileName: fileName, count: count, operator: "当前管理员" });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    wb.produce.fileName = fileName;
    wb.produce.rowCount = count;
    wb.produce.batchId = res.batch.id;
    EX.toast("解析完成，共 " + res.batch.rowCount + " 行待确认", "ok");
    EX.router.refresh();
  };

  EX.actions["admin.produce.gen"] = function () {
    var res = catalog.createGeneration({
      type: fieldValue("gen-type") || "single",
      count: parseInt(fieldValue("gen-count"), 10) || 3,
      difficulty: fieldValue("gen-difficulty") || "中等",
      prompt: fieldValue("gen-prompt") || "",
      tagIds: wb.produce.genTags.slice(),
      operator: "当前管理员"
    });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    wb.produce.genType = fieldValue("gen-type") || "single";
    wb.produce.genCount = parseInt(fieldValue("gen-count"), 10) || 3;
    wb.produce.genDifficulty = fieldValue("gen-difficulty") || "中等";
    wb.produce.genPrompt = fieldValue("gen-prompt") || "";
    wb.produce.batchId = res.batch.id;
    EX.toast("已生成 " + res.batch.count + " 道候选题", "ok");
    EX.router.refresh();
  };

  EX.actions["admin.produce.adopt"] = function () {
    var bankId = fieldValue("imp-bank") || wb.produce.bankId;
    if (!bankId) { EX.toast("请先选择目标题库", "error"); return; }
    var res = wb.produce.mode === "import"
      ? catalog.commitImport(wb.produce.batchId, bankId)
      : catalog.commitGeneration(wb.produce.batchId, bankId);
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast("已采纳 " + res.created.length + " 道候选题，请到候选题队列审核", "ok");
    wb.produce.batchId = "";
    EX.router.go("admin.bank", { id: bankId, tab: "candidates" });
  };

  EX.actions["admin.wb.tpl.open"] = function (el) {
    var tpl = catalog.getPaperTemplate(el.getAttribute("data-id"));
    if (!tpl) return;
    var modeLabel = EX.engine.MODES[tpl.mode] ? EX.engine.MODES[tpl.mode].label : tpl.mode;
    EX.toast(tpl.name + "：" + modeLabel + " · " + (tpl.items || []).length + " 题 · " + (tpl.durationMin || 0) + " 分钟", "ok");
  };
/* ---------------------------------------------------------- 卷对象动作 */
  function refreshKeepScroll() {
    var scroller = doc.getElementById("view");
    var top = scroller ? scroller.scrollTop : 0;
    EX.router.refresh();
    if (scroller) scroller.scrollTop = top;
  }

  /* 收集第 1 步字段：只读取当前 DOM 中真实存在的输入框，
     这样在第 4 步直接发布时不会因为字段不在页面上而被误判为「未填写」。 */
  function collectBasic(kind, id) {
    var nameEl = doc.getElementById("wiz-name");
    var name = nameEl ? String(nameEl.value || "").trim() : "";
    if (nameEl && !name) return { ok: false, message: "请填写名称" };
    var patch = {};
    if (nameEl) patch.name = name;
    if (doc.getElementById("wiz-note")) patch.note = fieldValue("wiz-note");
    if (doc.getElementById("wiz-duration")) patch.durationMin = parseInt(fieldValue("wiz-duration"), 10) || 0;
    if (kind === "exam") {
      if (doc.getElementById("wiz-batch")) patch.batch = fieldValue("wiz-batch");
      if (doc.getElementById("wiz-total")) patch.totalScore = parseFloat(fieldValue("wiz-total")) || 0;
      if (doc.getElementById("wiz-pass")) patch.passScore = parseFloat(fieldValue("wiz-pass")) || 0;
      if (doc.getElementById("wiz-open")) patch.openAt = fieldValue("wiz-open");
      if (doc.getElementById("wiz-close")) patch.closeAt = fieldValue("wiz-close");
    } else {
      if (doc.getElementById("wiz-repeats")) patch.repeats = parseInt(fieldValue("wiz-repeats"), 10) || 0;
      if (doc.getElementById("wiz-feedback")) patch.feedback = fieldValue("wiz-feedback") || "after_submit";
      if (doc.getElementById("wiz-mistake")) patch.mistakeReflow = checkedValue("wiz-mistake");
    }
    if (!Object.keys(patch).length) return { ok: true };
    var res = kind === "exam" ? catalog.setExamMeta(id, patch) : catalog.setPracticeMeta(id, patch);
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  }

  function collectPublish(kind, id) {
    if (kind !== "exam") return { ok: true, patch: {} };
    var patch = {};
    if (doc.getElementById("wiz-publish-answer")) patch.publishAnswer = fieldValue("wiz-publish-answer") || "after_close";
    if (doc.getElementById("wiz-retake")) patch.allowRetake = checkedValue("wiz-retake");
    if (!Object.keys(patch).length) return { ok: true, patch: {} };
    var res = catalog.setExamMeta(id, patch);
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, patch: patch };
  }

  EX.actions["admin.paper.new"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var res = kind === "exam" ? catalog.createExam({ name: "未命名试卷" }) : catalog.createPractice({ name: "未命名练习" });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    var id = kind === "exam" ? res.exam.id : res.practice.id;
    EX.toast("已创建" + (kind === "exam" ? "试卷" : "练习") + "，请完善基本信息", "ok");
    EX.router.go("admin.paper", { kind: kind, id: id, step: "basic" });
  };

  EX.actions["admin.paper.open"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var step = el.getAttribute("data-step") || "basic";
    EX.router.go("admin.paper", { kind: kind, id: id, step: step });
  };

  EX.actions["admin.paper.delete"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var item = paperOf(kind, id);
    if (!item) return;
    var label = kind === "exam" ? "试卷" : "练习";
    EX.confirm({
      title: "删除" + label,
      message: "将删除" + label + "「" + item.name + "」及其题目引用，" +
        (kind === "exam" ? "关联的阅卷记录也会一并清除。" : "管理端与答题端的入口都会移除。") + "操作不可撤销。",
      okText: "确认删除",
      onConfirm: function () {
        var res = catalog.removePaper(kind, id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
        EX.toast("已删除" + label + "「" + item.name + "」", "ok");
        EX.router.refresh();
      }
    });
  };

  EX.actions["admin.paper.step"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var step = el.getAttribute("data-step") || "basic";
    var route = EX.router.current();
    if (route && route.key === "admin.paper" && route.params && route.params.id === id) {
      var cur = route.params.step || "basic";
      if (cur === "basic" && step !== "basic") {
        var res = collectBasic(kind, id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
      }
      if (cur === "publish" && step !== "publish") {
        var pub = collectPublish(kind, id);
        if (!pub.ok) { EX.toast(pub.message, "error"); return; }
      }
    }
    EX.router.go("admin.paper", { kind: kind, id: id, step: step });
  };

  EX.actions["admin.paper.save.basic"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var next = el.getAttribute("data-step") || "";
    var res = collectBasic(kind, id);
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast("基本信息已保存", "ok");
    if (next) EX.router.go("admin.paper", { kind: kind, id: id, step: next });
    else refreshKeepScroll();
  };

  EX.actions["admin.paper.scope"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var cid = el.getAttribute("data-class");
    var item = paperOf(kind, id);
    if (!item || !cid) return;
    var scope = (item.scope || []).slice();
    var idx = scope.indexOf(cid);
    if (idx === -1) scope.push(cid); else scope.splice(idx, 1);
    var res = kind === "exam" ? catalog.setExamMeta(id, { scope: scope }) : catalog.setPracticeMeta(id, { scope: scope });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    refreshKeepScroll();
  };

  EX.actions["admin.paper.publish"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    /* 发布前先回写第 1 步与第 4 步尚未显式保存的字段，避免直接跳转时数据丢失 */
    var basic = collectBasic(kind, id);
    if (!basic.ok) { EX.toast(basic.message, "error"); return; }
    var pub = collectPublish(kind, id);
    if (!pub.ok) { EX.toast(pub.message, "error"); return; }
    var result = catalog.preflight(kind, id);
    if (!result.ok) { EX.toast("仍有 " + result.failed + " 项校验未通过，无法发布", "error"); return; }
    var res;
    if (kind === "exam") {
      var patch = { status: "ongoing", published: true };
      if (pub.patch.publishAnswer) patch.publishAnswer = pub.patch.publishAnswer;
      if (typeof pub.patch.allowRetake === "boolean") patch.allowRetake = pub.patch.allowRetake;
      res = catalog.setExamMeta(id, patch);
    } else {
      res = catalog.setPracticeMeta(id, { status: "published", published: true });
    }
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast(kind === "exam" ? "试卷已发布，答题端可见" : "练习已上架，答题端可见", "ok");
    refreshKeepScroll();
  };

  EX.actions["admin.paper.unpublish"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var res = kind === "exam"
      ? catalog.setExamMeta(id, { status: "draft", published: false })
      : catalog.setPracticeMeta(id, { status: "draft", published: false });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast(kind === "exam" ? "试卷已撤回发布" : "练习已下架", "ok");
    refreshKeepScroll();
  };

  /* ------------------------------------------------------ 选题与配分动作 */
  EX.actions["admin.wiz.mselect.toggle"] = function (el) {
    var field = el.getAttribute("data-field");
    var wrap = el.closest ? el.closest(".mselect") : null;
    if (!wrap) return;
    var willOpen = !wrap.classList.contains("is-open");
    closeMSelects();
    if (willOpen) {
      wrap.classList.add("is-open");
      wb.wiz.openField = field;
      var trigger = wrap.querySelector(".mselect-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
    }
  };

  EX.actions["admin.wiz.mselect.pick"] = function (el) {
    var field = el.getAttribute("data-field");
    var value = el.getAttribute("data-value");
    if (!field || !value) return;
    var arr = wb.wiz.qsel[field];
    if (!Array.isArray(arr)) arr = wb.wiz.qsel[field] = [];
    var idx = arr.indexOf(value);
    if (el.checked && idx === -1) arr.push(value);
    if (!el.checked && idx !== -1) arr.splice(idx, 1);
    applyWizFilters();
    syncMselectLabels();
  };

  EX.actions["admin.wiz.mselect.all"] = function (el) {
    var field = el.getAttribute("data-field");
    var wrap = el.closest ? el.closest(".mselect") : null;
    if (!wrap || !field) return;
    var values = [];
    Array.prototype.forEach.call(wrap.querySelectorAll(".mselect-option input"), function (input) {
      values.push(input.getAttribute("data-value"));
      input.checked = true;
    });
    wb.wiz.qsel[field] = values;
    applyWizFilters();
    syncMselectLabels();
  };

  EX.actions["admin.wiz.mselect.clear"] = function (el) {
    var field = el.getAttribute("data-field");
    var wrap = el.closest ? el.closest(".mselect") : null;
    if (!wrap || !field) return;
    wb.wiz.qsel[field] = [];
    Array.prototype.forEach.call(wrap.querySelectorAll(".mselect-option input"), function (input) { input.checked = false; });
    applyWizFilters();
    syncMselectLabels();
  };

  EX.actions["admin.wiz.pick"] = function (el) {
    var target = wizTarget(el);
    var kind = target.kind;
    var id = target.id;
    var qid = el.getAttribute("data-qid");
    var item = paperOf(kind, id);
    if (!item || !qid) return;
    var items = catalog.itemsOf(item).map(function (it) { return { qid: it.qid, score: Number(it.score) || 0 }; });
    var idx = -1;
    items.forEach(function (it, i) { if (it.qid === qid) idx = i; });
    if (el.checked) {
      if (idx !== -1) return;
      var q = catalog.getQuestion(qid);
      if (!q || catalog.statusOf(q) !== "published") {
        EX.toast("仅「已发布」题目可入选卷面", "error");
        syncCheck(qid, false);
        return;
      }
      items.push({ qid: qid, score: q ? (Number(q.score) || 5) : 5 });
    } else {
      if (idx === -1) return;
      items.splice(idx, 1);
    }
    saveItems(kind, id, items);
    syncPicked(kind, id);
  };

  EX.actions["admin.wiz.unpick"] = function (el) {
    var target = wizTarget(el);
    var kind = target.kind;
    var id = target.id;
    var qid = el.getAttribute("data-qid");
    var item = paperOf(kind, id);
    if (!item || !qid) return;
    var items = catalog.itemsOf(item).filter(function (it) { return it.qid !== qid; });
    saveItems(kind, id, items);
    syncCheck(qid, false);
    syncPicked(kind, id);
  };

  EX.actions["admin.wiz.score"] = function (el) {
    var target = wizTarget(el);
    var kind = target.kind;
    var id = target.id;
    var qid = el.getAttribute("data-qid");
    var value = parseFloat(el.value);
    if (isNaN(value) || value < 0) value = 0;
    var items = catalog.itemsOf(paperOf(kind, id)).map(function (it) {
      return it.qid === qid ? { qid: it.qid, score: value } : { qid: it.qid, score: Number(it.score) || 0 };
    });
    saveItems(kind, id, items);
    var item = paperOf(kind, id);
    var label = doc.getElementById("wiz-total-text");
    if (label && item) label.textContent = "合计 " + sumScore(catalog.itemsOf(item)) + " / 目标 " + (Number(item.totalScore) || 0) + " 分";
  };

  EX.actions["admin.wiz.even"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var item = paperOf(kind, id);
    if (!item) return;
    var items = catalog.itemsOf(item);
    if (!items.length) { EX.toast("请先选择题目", "error"); return; }
    saveItems(kind, id, evenScores(items, Number(item.totalScore) || 0));
    syncPicked(kind, id);
  };

  EX.actions["admin.wiz.align"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var item = paperOf(kind, id);
    if (!item) return;
    var items = catalog.itemsOf(item);
    if (!items.length) { EX.toast("请先选择题目", "error"); return; }
    saveItems(kind, id, alignScores(items, Number(item.totalScore) || 0));
    syncPicked(kind, id);
  };

  EX.actions["admin.wiz.orderRule"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var rule = catalog.normalizeOrderRule(el.value);
    var res = kind === "exam"
      ? catalog.setExamMeta(id, { orderRule: rule })
      : catalog.setPracticeMeta(id, { orderRule: rule });
    if (!res.ok) { EX.toast(res.message || "保存失败", "error"); return; }
    var meta = catalog.ORDER_RULES.filter(function (r) { return r.id === rule; })[0];
    var hint = doc.getElementById("wiz-order-rule-hint");
    if (hint && meta) {
      hint.textContent = meta.desc +
        " 下列序号是出卷的基础题序：标准卷与小梅花按此顺序出卷，大梅花保留题型分块顺序、仅在每个题型内部打乱题目。";
    }
    syncPicked(kind, id);
    EX.toast(rule === "type" ? "题序已按题型分块、组内由易到难排布" : "题序已改为按选题顺序", "ok");
  };

  EX.actions["admin.wiz.tpl.apply"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var tpl = catalog.getPaperTemplate(fieldValue("wiz-tpl"));
    if (!tpl) { EX.toast("请选择要套用的模板", "error"); return; }
    var all = tpl.items || [];
    var usable = all.filter(function (it) {
      var q = catalog.getQuestion(it.qid);
      return q && catalog.statusOf(q) === "published";
    });
    if (!usable.length) { EX.toast("模板中的题目均未发布，无法套用", "error"); return; }
    saveItems(kind, id, usable);
    if (kind === "exam") {
      catalog.setPlumCfg(id, { mode: tpl.mode });
    }
    var skipped = all.length - usable.length;
    EX.toast("已套用模板「" + tpl.name + "」" + (skipped ? "，跳过 " + skipped + " 道未发布题目" : ""), "ok");
    refreshKeepScroll();
  };

  EX.actions["admin.wiz.tpl.save"] = function (el) {
    var kind = el.getAttribute("data-kind") === "practice" ? "practice" : "exam";
    var id = el.getAttribute("data-id");
    var name = String(fieldValue("wiz-tpl-name") || "").trim();
    if (!name) { EX.toast("请填写模板名称", "error"); return; }
    var item = paperOf(kind, id);
    var items = catalog.itemsOf(item);
    if (!items.length) { EX.toast("请先选择题目再保存模板", "error"); return; }
    var cfg = kind === "exam" ? catalog.plumCfg(id) : { mode: "standard" };
    var res = catalog.savePaperTemplate({
      name: name,
      kind: kind,
      mode: cfg.mode,
      durationMin: item.durationMin || 0,
      passScore: item.passScore || 0,
      items: items
    });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast("已保存卷型模板「" + name + "」", "ok");
    refreshKeepScroll();
  };

  /* ---------------------------------------------------------- 卷型动作 */
  EX.actions["admin.wiz.mode"] = function (el) {
    var id = el.getAttribute("data-id");
    var mode = el.getAttribute("data-mode");
    catalog.setPlumCfg(id, { mode: mode });
    refreshKeepScroll();
  };

  /* ---------------------------------------------------------- 搜索输入 */
  doc.addEventListener("input", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    var scope = el.getAttribute("data-search");
    if (scope === "wiz-q") {
      wb.wiz.qsel.keyword = el.value;
      applyWizFilters();
      return;
    }
    if (scope === "wb-q") {
      wb.q.keyword = el.value;
      refreshKeepScroll();
    }
  });

  /* ------------------------------------------------ 多选下拉的开关行为 */
  doc.addEventListener("click", function (event) {
    if (!doc.querySelector(".mselect.is-open")) return;
    var inside = event.target && event.target.closest ? event.target.closest(".mselect") : null;
    if (inside) return;
    closeMSelects();
  });

  doc.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (!doc.querySelector(".mselect.is-open")) return;
    closeMSelects();
  });
})(window);
