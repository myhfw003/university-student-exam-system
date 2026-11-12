/* ==========================================================================
   知行测评 · 管理端
   标签 / 题库 / 题目编辑器 / 阅卷中心 / 成绩分析
   内容以标签为组织轴：题库 / 题目 / 试卷 / 练习统一挂载标签（单对象最多 5 个）。
   概览工作台 / 题库工作台 / 组卷向导见 js/admin-workbench.js。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = global.EX;
  var doc = global.document;
  var h = EX.h;
  var fmt = EX.fmt;
  var store = EX.store;
  var catalog = EX.catalog;
  var MAX_TAGS = catalog.MAX_TAGS || 5;

  /* ------------------------------------------------------------ 模块状态 */
  var bankFilter = { keyword: "" };
  var previewState = { index: 0 };
  var reviewState = { currentId: "", filter: "pending" };
  var analyticsState = { className: "全部", examId: "" };
  var editorState = { id: "", type: "single" };
  var tagState = { tags: [], hostId: "", counterId: "" };
  var entityState = { kind: "exam", id: "" };
  var bankEditor = { id: "", questionIds: [] };

  /* -------------------------------------------------------------- 基础 */
  function questions() { return catalog.questions(); }
  function banks() { return catalog.banks(); }
  function exams() { return catalog.exams(); }
  function practices() { return catalog.practices(); }
  function reviews() { return catalog.reviews(); }
  function tags() { return catalog.tags(); }

  function plumCfg(exam) {
    return catalog.plumCfg(exam.id);
  }

  function roster() {
    return EX.seed.students;
  }

  function typeBadge(type) {
    var map = {
      single: "badge-primary",
      multi: "badge-info",
      judge: "badge-neutral",
      short: "badge-warn",
      comprehensive: "badge-neutral"
    };
    return '<span class="badge ' + (map[type] || "badge-neutral") + '">' + h.esc(EX.seed.typeLabel(type)) + "</span>";
  }

  function statCard(label, value, unit, hint) {
    return '<div class="stat"><span class="stat-label">' + h.esc(label) + "</span>" +
      '<span class="stat-value">' + h.esc(String(value)) + (unit ? '<span class="unit">' + h.esc(unit) + "</span>" : "") + "</span>" +
      '<span class="stat-hint">' + h.esc(hint) + "</span></div>";
  }

  function barRow(label, value, max, suffix, tone) {
    var pct = max ? Math.round((value / max) * 100) : 0;
    return '<div class="bar-row" style="margin-bottom:var(--sp-2)">' +
      '<span class="od-truncate">' + h.esc(label) + "</span>" +
      '<span class="bar-track"><span class="bar-fill ' + (tone ? String(tone).trim() : "") + '" style="width:' + pct + '%"></span></span>' +
      '<span class="right num text-sm">' + value + (suffix || "") + "</span></div>";
  }

  /* ---------------------------------------------------------- 标签片段 */
  /** 实体标签的可视化呈现 */
  function tagChips(entity, limit) {
    var ids = (entity && entity.tags) || [];
    var shown = limit ? ids.slice(0, limit) : ids;
    var html = shown.map(function (id) {
      var tag = catalog.getTag(id);
      if (!tag) return "";
      return '<span class="tag-chip is-' + h.esc(tag.group) + '">' + h.esc(tag.name) + "</span>";
    }).join("");
    var rest = ids.length - shown.length;
    if (rest > 0) html += '<span class="tag-chip is-more">+' + rest + "</span>";
    return html ? '<span class="tag-chips">' + html + "</span>" : "";
  }

  /** 难度标签（仅「难度」分组） */
  function difficultyChip(entity) {
    var ids = (entity && entity.tags) || [];
    for (var i = 0; i < ids.length; i++) {
      var tag = catalog.getTag(ids[i]);
      if (tag && tag.group === "难度") {
        return '<span class="tag-chip is-难度">' + h.esc(tag.name) + "</span>";
      }
    }
    return '<span class="tag-chip is-难度">' + h.esc(catalog.difficultyLabel(entity)) + "</span>";
  }

  /** 实体在「知识点」分组中的标签；无知识点时回退到「领域」 */
  function knowledgeTag(entity) {
    var ids = (entity && entity.tags) || [];
    for (var i = 0; i < ids.length; i++) {
      var tag = catalog.getTag(ids[i]);
      if (tag && tag.group === "知识点") return tag;
    }
    for (var j = 0; j < ids.length; j++) {
      var t2 = catalog.getTag(ids[j]);
      if (t2 && t2.group === "领域") return t2;
    }
    return null;
  }

  /* ------------------------------------------------------- 标签选择器 */
  /** 分组标签选择器：满 5 个后其余标签置灰 */
  function tagPickerHtml(selected) {
    var full = selected.length >= MAX_TAGS;
    return catalog.tagGroups().map(function (group) {
      var list = catalog.tagsOfGroup(group);
      if (!list.length) return "";
      var chips = list.map(function (t) {
        var on = selected.indexOf(t.id) !== -1;
        var dis = full && !on;
        return '<button type="button" class="chip is-tag' + (on ? " is-on" : "") + '" ' +
          'data-action="admin.tag.toggle" data-tag="' + h.esc(t.id) + '" ' +
          'aria-pressed="' + (on ? "true" : "false") + '"' +
          (dis ? ' disabled aria-disabled="true"' : "") + ">" + h.esc(t.name) + "</button>";
      }).join("");
      return '<div class="tag-picker-group">' +
        '<span class="filter-group-label">' + h.esc(group) + "</span>" +
        '<div class="row-tight">' + chips + "</div></div>";
    }).join("");
  }

  /** 刷新选择器与 n/5 计数 */
  function syncTagPicker() {
    var counter = tagState.counterId ? doc.getElementById(tagState.counterId) : null;
    if (counter) {
      counter.textContent = tagState.tags.length + "/" + MAX_TAGS;
      counter.className = "tag-counter" + (tagState.tags.length >= MAX_TAGS ? " is-full" : "");
    }
    var host = tagState.hostId ? doc.getElementById(tagState.hostId) : null;
    if (host) host.innerHTML = tagPickerHtml(tagState.tags);
  }

  /** 打开标签选择器：hostId / counterId 指向当前对话框中的容器 */
  function mountTagPicker(hostId, counterId, selected) {
    tagState.hostId = hostId;
    tagState.counterId = counterId;
    tagState.tags = (selected || []).slice();
    syncTagPicker();
  }

  /* ------------------------------------------------------------ 标签管理 */
  EX.views["admin.tags"] = function () {
    var tk = tags();
    var totalUsage = tk.reduce(function (sum, t) { return sum + catalog.usageOf(t.id).total; }, 0);

    var groupCards = catalog.tagGroups().map(function (group) {
      var list = catalog.tagsOfGroup(group);
      var rows = list.map(function (t) {
        var u = catalog.usageOf(t.id);
        return "<tr>" +
          '<td><div class="strong" style="font-weight:500">' + h.esc(t.name) + "</div>" +
            '<div class="text-xs text-3 mono">' + h.esc(t.id) + "</div></td>" +
          '<td class="num">' + u.questions + "</td>" +
          '<td class="num">' + u.banks + "</td>" +
          '<td class="num">' + u.exams + "</td>" +
          '<td class="num">' + u.practices + "</td>" +
          '<td class="col-actions">' +
            '<button class="btn btn-sm" data-action="admin.tag.edit" data-id="' + h.esc(t.id) + '">编辑</button> ' +
            '<button class="btn btn-sm btn-danger" data-action="admin.tag.delete" data-id="' + h.esc(t.id) + '">删除</button>' +
          "</td></tr>";
      }).join("");
      return '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-head">' +
        '<h2 class="card-title">' + h.esc(group) + "</h2>" +
        '<span class="text-sm text-3">' + list.length + " 个标签</span></div>" +
        '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>标签</th><th>题目</th><th>题库</th><th>试卷</th><th>练习</th><th></th></tr></thead>" +
        "<tbody>" + (rows || '<tr><td colspan="6"><div class="empty"><span class="empty-title">该分组暂无标签</span></div></td></tr>') +
        "</tbody></table></div></div></section>";
    }).join("");

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">标签</h1>' +
        '<p class="page-sub">标签是本系统的组织轴：题库、题目、试卷与练习都通过标签关联。' +
          "共 " + tk.length + " 个标签，当前累计挂载 " + totalUsage + " 次；单个对象最多挂载 " + MAX_TAGS + " 个标签。</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn btn-primary" data-action="admin.tag.new">' + EX.icon("plus") + "新建标签</button>" +
      "</div></div>" +
      '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
        catalog.tagGroups().map(function (g) {
          return statCard(g, catalog.tagsOfGroup(g).length, "个", "该分组下的标签词条");
        }).join("") +
      "</div>" +
      groupCards +
      '<div class="callout" style="margin-top:var(--sp-4)"><span class="callout-title">' + EX.icon("info") + "删除标签会级联解除挂载</span>" +
      "<span>删除标签后，题库、题目、试卷与练习上对应的挂载会一并解除，对象本身保留。难度标签的名称与等级对应：基础 / 中等 / 较难。</span></div>";
  };

  function openTagDialog(id) {
    var tag = id ? catalog.getTag(id) : null;
    editorState.id = tag ? tag.id : "";
    var body = doc.getElementById("tag-editor-body");
    var title = doc.getElementById("tag-editor-title");
    if (title) title.textContent = tag ? "编辑标签 · " + tag.name : "新建标签";
    if (!body) return;
    var groupOptions = catalog.tagGroups().map(function (g) {
      var cur = tag ? tag.group : g;
      return '<option value="' + h.esc(g) + '"' + (g === cur ? " selected" : "") + ">" + h.esc(g) + "</option>";
    }).join("");
    body.innerHTML =
      '<div class="field"><label class="field-label" for="tg-name">标签名称<span class="field-req">*</span></label>' +
        '<input class="input" id="tg-name" type="text" value="' + h.esc(tag ? tag.name : "") + '" placeholder="例如 极限与连续">' +
        '<span class="field-hint">同一分组内名称不可重复。</span></div>' +
      '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="tg-group">所属分组</label>' +
        '<div class="select-wrap"><select class="select" id="tg-group">' + groupOptions + "</select></div>" +
        '<span class="field-hint">分组决定标签在列表与筛选器中的位置：领域用于主标识，知识点用于错题聚合，能力用于能力画像，难度用于难度层级。</span></div>' +
      (tag ? '<p class="section-note" style="margin-top:var(--sp-4)">当前引用：' +
        catalog.usageOf(tag.id).total + " 次（题目 " + catalog.usageOf(tag.id).questions + " / 题库 " + catalog.usageOf(tag.id).banks +
        " / 试卷 " + catalog.usageOf(tag.id).exams +
        " / 练习 " + catalog.usageOf(tag.id).practices + "）</p>" : "");
    EX.openDialog("dlg-tag");
  }

  /* ------------------------------------------------------------ 题库管理 */
  function openBankDialog(id) {
    var bank = id ? catalog.getBank(id) : null;
    editorState.id = bank ? bank.id : "";
    bankEditor.id = bank ? bank.id : "";
    bankEditor.questionIds = bank ? (bank.questionIds || []).slice() : [];
    var body = doc.getElementById("bank-editor-body");
    var title = doc.getElementById("bank-editor-title");
    if (title) title.textContent = bank ? "编辑题库 · " + bank.name : "新建题库";
    if (!body) return;
    body.innerHTML = bankEditorHtml(bank);
    mountTagPicker("tag-picker-bank", "tag-counter-bank", bank ? bank.tags : []);
    EX.openDialog("dlg-bank");
  }

  function bankEditorHtml(bank) {
    var picked = bankEditor.questionIds;
    var byType = {};
    questions().forEach(function (q) {
      (byType[q.type] = byType[q.type] || []).push(q);
    });
    var groups = EX.seed.QUESTION_TYPES.map(function (t) {
      var list = byType[t.id] || [];
      if (!list.length) return "";
      var rows = list.map(function (q) {
        var on = picked.indexOf(q.id) !== -1;
        return '<label class="pick-row"><input type="checkbox" data-bank-qid="' + h.esc(q.id) + '"' + (on ? " checked" : "") + ">" +
          '<span class="pick-id mono">' + h.esc(q.id) + "</span>" +
          '<span class="pick-text">' + h.esc(q.stem.length > 40 ? q.stem.slice(0, 40) + "…" : q.stem) + "</span></label>";
      }).join("");
      return '<div class="pick-group"><div class="pick-group-title">' + h.esc(t.label || t.name) + " · " + list.length + " 题</div>" + rows + "</div>";
    }).join("");

    return '<div class="field"><label class="field-label" for="bk-name">题库名称<span class="field-req">*</span></label>' +
        '<input class="input" id="bk-name" type="text" value="' + h.esc(bank ? bank.name : "") + '" placeholder="例如 高等数学基础题库"></div>' +
      '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="bk-desc">题库说明</label>' +
        '<textarea class="textarea" id="bk-desc" style="min-height:72px" placeholder="说明题库的覆盖范围与使用场景">' +
        h.esc(bank ? bank.desc || "" : "") + "</textarea></div>" +
      '<div class="field" style="margin-top:var(--sp-4)"><span class="field-label">标签' +
        '<span class="tag-counter" id="tag-counter-bank">0/' + MAX_TAGS + "</span></span>" +
        '<div class="tag-picker" id="tag-picker-bank"></div>' +
        '<span class="field-hint">标签用于把题库接入领域 / 知识点 / 能力等维度，最多 ' + MAX_TAGS + " 个。</span></div>" +
      '<div class="field" style="margin-top:var(--sp-4)"><span class="field-label">题目清单' +
        '<span class="text-xs text-3" id="bk-count">已选 ' + picked.length + " 题</span></span>" +
        '<div class="pick-list">' + groups + "</div></div>";
  }

  /* ------------------------------------------------------------ 题目管理 */
  /* ------------------------------------------------------- 题目编辑器 */
  function openQuestionEditor(id) {
    var q = id ? catalog.getQuestion(id) : null;
    editorState.id = q ? q.id : "";
    editorState.type = q ? q.type : "single";
    var body = doc.getElementById("q-editor-body");
    var title = doc.getElementById("q-editor-title");
    if (title) title.textContent = q ? "编辑题目 · " + q.id : "新建题目";
    if (!body) return;
    body.innerHTML = questionEditorHtml(q);
    mountTagPicker("tag-picker-question", "tag-counter-question", q ? q.tags : []);
    EX.openDialog("dlg-question");
  }

  function questionEditorHtml(q) {
    var type = q ? q.type : "single";
    var typeOptions = EX.seed.QUESTION_TYPES.map(function (t) {
      return '<option value="' + h.esc(t.id) + '"' + (t.id === type ? " selected" : "") + ">" + h.esc(t.label || t.name) + "</option>";
    }).join("");
    var status = q ? catalog.statusOf(q) : "draft";
    var statusOptions = [
      { key: "draft", label: "草稿" },
      { key: "published", label: "已发布" },
      { key: "disabled", label: "已停用" }
    ].map(function (s) {
      return '<option value="' + h.esc(s.key) + '"' + (s.key === status ? " selected" : "") + ">" + h.esc(s.label) + "</option>";
    }).join("");

    return '<div class="field"><label class="field-label" for="qe-id">题目编号</label>' +
        '<input class="input" id="qe-id" type="text" value="' + h.esc(q ? q.id : "") + '"' + (q ? " readonly" : "") +
        ' placeholder="例如 q-m-09"><span class="field-hint">编号用于题库检索与组卷引用，保存后不可修改。</span></div>' +
      '<div class="grid-3" style="margin-top:var(--sp-4)">' +
        '<div class="field"><label class="field-label" for="qe-type">题型</label>' +
          '<div class="select-wrap"><select class="select" id="qe-type" data-change="admin.qtype">' + typeOptions + "</select></div></div>" +
        '<div class="field"><label class="field-label" for="qe-score">分值</label>' +
          '<input class="input" id="qe-score" type="number" min="1" max="40" value="' + (q ? q.score : 5) + '"></div>' +
        '<div class="field"><label class="field-label" for="qe-status">状态</label>' +
          '<div class="select-wrap"><select class="select" id="qe-status">' + statusOptions + "</select></div>" +
          '<span class="field-hint">新建默认草稿，发布后可用于组卷。</span></div>' +
      "</div>" +
      '<div class="field" style="margin-top:var(--sp-4)"><span class="field-label">标签' +
        '<span class="tag-counter" id="tag-counter-question">0/' + MAX_TAGS + "</span></span>" +
        '<div class="tag-picker" id="tag-picker-question"></div>' +
        '<span class="field-hint">标签决定题目在答题端的筛选与归类，最多 ' + MAX_TAGS + " 个；难度由「难度」分组标签决定。</span></div>" +
      '<div class="field" style="margin-top:var(--sp-4)"><label class="field-label" for="qe-stem">题干<span class="field-req">*</span></label>' +
        '<textarea class="textarea" id="qe-stem" placeholder="输入题干">' + h.esc(q ? q.stem : "") + "</textarea></div>" +
      '<div id="qe-dynamic" style="margin-top:var(--sp-5)">' + dynamicEditorHtml(q, type) + "</div>" +
      '<div class="grid-2" style="margin-top:var(--sp-5)">' +
        '<div class="field"><label class="field-label" for="qe-analysis">解析</label>' +
          '<textarea class="textarea" id="qe-analysis" style="min-height:80px" placeholder="讲评时展示的解析">' +
          h.esc(q ? q.analysis || "" : "") + "</textarea></div>" +
        '<div class="field"><label class="field-label" for="qe-reference">参考答案</label>' +
          '<textarea class="textarea" id="qe-reference" style="min-height:80px" placeholder="阅卷时展示的参考答案">' +
          h.esc(q ? q.reference || "" : "") + "</textarea></div>" +
      "</div>";
  }

  function dynamicEditorHtml(q, type) {
    if (type === "single" || type === "multi" || type === "judge") {
      var options = q && q.options && q.options.length ? q.options : [
        { key: "A", text: "" }, { key: "B", text: "" }, { key: "C", text: "" }, { key: "D", text: "" }
      ];
      var answer = q && q.answer ? q.answer : [];
      var rows = options.map(function (o) {
        var checked = answer.indexOf(o.key) !== -1;
        return '<div class="opt-order" style="grid-template-columns:52px minmax(0,1fr) 92px">' +
          '<span class="oo-pos">' + h.esc(o.key) + "</span>" +
          '<input class="input" type="text" data-opt-text="' + h.esc(o.key) + '" value="' + h.esc(o.text) + '" placeholder="选项内容">' +
          '<label class="checkline"><input type="' + (type === "multi" ? "checkbox" : "radio") + '" name="qe-answer" ' +
            'data-opt-answer="' + h.esc(o.key) + '"' + (checked ? " checked" : "") + ">" +
            '<span class="checkline-text"><span class="checkline-hint">设为正确答案</span></span></label>' +
          "</div>";
      }).join("");
      return '<h3 class="section-title">选项与答案</h3>' +
        '<div class="card" style="margin-top:var(--sp-3)">' + rows + "</div>" +
        '<p class="section-note" style="margin-top:var(--sp-3)">判断题固定为「正确 / 错误」两项，且不参与梅花卷选项置换。</p>';
    }
    if (type === "short") {
      var kps = q && q.keypoints && q.keypoints.length ? q.keypoints : [
        { text: "", keywords: [] }, { text: "", keywords: [] }, { text: "", keywords: [] }
      ];
      var kpRows = kps.map(function (kp, i) {
        return '<div class="opt-order" style="grid-template-columns:52px minmax(0,1fr) minmax(0,1fr)">' +
          '<span class="oo-pos">' + (i + 1) + "</span>" +
          '<input class="input" type="text" data-kp-text="' + i + '" value="' + h.esc(kp.text) + '" placeholder="评分要点">' +
          '<input class="input" type="text" data-kp-kw="' + i + '" value="' + h.esc((kp.keywords || []).join("，")) + '" placeholder="关键词，用逗号分隔">' +
          "</div>";
      }).join("");
      return '<h3 class="section-title">评分要点</h3>' +
        '<div class="card" style="margin-top:var(--sp-3)">' + kpRows + "</div>" +
        '<p class="section-note" style="margin-top:var(--sp-3)">系统按关键词自动初判，管理端复核后计入最终成绩；各要点平均分配分值。</p>';
    }
    var steps = q && q.steps && q.steps.length ? q.steps : [
      { id: "s1", prompt: "", answer: "", keywords: [], score: 5 },
      { id: "s2", prompt: "", answer: "", keywords: [], score: 5 }
    ];
    var stepRows = steps.map(function (st, i) {
      return '<div class="card" style="margin-bottom:var(--sp-3)"><div class="card-body">' +
        '<div class="grid-2">' +
          '<div class="field"><label class="field-label">步骤提示</label>' +
            '<input class="input" type="text" data-step-prompt="' + i + '" value="' + h.esc(st.prompt) + '" placeholder="例如 第一步：…"></div>' +
          '<div class="field"><label class="field-label">步骤分值</label>' +
            '<input class="input" type="number" min="1" max="40" data-step-score="' + i + '" value="' + st.score + '"></div>' +
        "</div>" +
        '<div class="field" style="margin-top:var(--sp-3)"><label class="field-label">参考答案</label>' +
          '<textarea class="textarea" data-step-answer="' + i + '" style="min-height:80px">' + h.esc(st.answer || "") + "</textarea></div>" +
        '<div class="field" style="margin-top:var(--sp-3)"><label class="field-label">命中关键词</label>' +
          '<input class="input" type="text" data-step-kw="' + i + '" value="' + h.esc((st.keywords || []).join("，")) + '" placeholder="关键词，用逗号分隔"></div>' +
        "</div></div>";
    }).join("");
    return '<h3 class="section-title">评分步骤</h3>' +
      '<div style="margin-top:var(--sp-3)">' + stepRows + "</div>" +
      '<p class="section-note">综合操作题按步骤给分，每一步独立判定。</p>';
  }

  /** 答题者卷面表格行：题干 + 标签 + 该答题者实际看到的选项顺序 */
  function paperRowsHtml(paper, showBase) {
    var withBase = showBase === undefined ? true : !!showBase;
    return paper.items.map(function (item) {
      var q = item.question;
      var opts = "";
      if (q.type === "single" || q.type === "multi" || q.type === "judge") {
        opts = '<div class="q-opts" style="gap:var(--sp-2)">' + item.displayKeys.map(function (originalKey, pos) {
          var letter = EX.engine.LETTERS[pos];
          var opt = (q.options || []).filter(function (o) { return o.key === originalKey; })[0];
          var isAnswer = q.answer.indexOf(originalKey) !== -1;
          return '<div class="opt' + (isAnswer ? " is-correct" : "") + '">' +
            '<span class="opt-key" aria-hidden="true">' + letter + "</span>" +
            '<span class="opt-text">' + h.esc(opt ? opt.text : "") + "</span></div>";
        }).join("") + "</div>";
      } else {
        opts = '<div class="text-sm text-3">主观题 · ' + h.esc(EX.seed.typeLabel(q.type)) + " · " + q.score + " 分</div>";
      }
      return '<tr><td class="num">' + item.slot + "</td>" +
        (withBase ? '<td class="text-xs mono">第 ' + item.originalIndex + " 题</td>" : "") +
        '<td><div class="strong" style="font-weight:500">' + h.esc(q.stem) + "</div>" +
          '<div class="row-tight" style="margin-top:var(--sp-2)">' + typeBadge(q.type) +
          difficultyChip(q) +
          tagChips(q, 3) +
          (item.changed ? '<span class="variant-tag is-diff">选项已置换</span>' : "") + "</div>" + opts + "</td></tr>";
    }).join("");
  }

  /** 答题者卷面预览：previewIndex 指定当前查看的答题者序号 */
  function previewSection(exam, cfg, students, previewIndex) {
    var idx = Math.min(previewIndex || 0, students.length - 1);
    var student = students[idx];
    var paper = EX.engine.previewPaper(exam, student, cfg, idx);
    var options = students.map(function (s, i) {
      return '<option value="' + i + '"' + (i === idx ? " selected" : "") + ">" + h.esc(s.name + "（" + s.className + "）") + "</option>";
    }).join("");

    var rows = paperRowsHtml(paper, cfg.mode === "large");
    var grainText = cfg.mode === "standard"
      ? "标准卷：全体答题者同一份卷面（题序与选项顺序均固定）"
      : cfg.mode === "small"
        ? "小梅花：题序统一保留，仅每位答题者的选项顺序打乱"
        : "大梅花：题型分块顺序保留（单选→多选→判断→简答→综合），每个题型内的题目顺序与选项顺序逐人打乱";

    return '<section class="card" style="margin-top:var(--sp-4)"><div class="card-head"><h2 class="card-title">答题者卷面预览</h2>' +
      '<div style="min-width:260px"><div class="select-wrap"><select class="select" data-change="admin.preview.pick">' +
      options + "</select></div></div></div>" +
      '<div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)"><span class="variant-tag">' + h.esc(paper.variantLabel) + "</span>" +
        '<span class="text-sm text-3">卷型 ' + h.esc(EX.engine.MODES[cfg.mode].label) + " · 置换号 " + h.esc(paper.seedLabel) + "（系统自动生成）</span>" +
        '<span class="text-sm text-3">· ' + h.esc(grainText) + "</span></div>" +
        '<div class="table-wrap"><table class="table"><thead><tr><th>题号</th>' +
        (cfg.mode === "large" ? "<th>标准题号</th>" : "") +
        "<th>题目内容（答题者所见）</th></tr></thead>" +
        "<tbody>" + rows + "</tbody></table></div>" +
      "</div></section>";
  }

  /* -------------------------------------------------------- 阅卷中心 */
  function reviewList() {
    var f = reviewState.filter;
    return reviews().filter(function (r) {
      if (f === "pending") return r.status === "pending";
      if (f === "reviewed") return r.status === "reviewed";
      return true;
    });
  }

  function reviewById(id) {
    var list = reviews();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* 卷面配分：阅卷时该题的实际满分与组卷设定一致 */
  function paperScoreOf(examId, qid) {
    var exam = catalog.getExam(examId);
    if (exam && typeof EX.engine.itemScoreOf === "function") return EX.engine.itemScoreOf(exam, qid);
    var q = catalog.getQuestion(qid);
    return q ? (Number(q.score) || 0) : 0;
  }

  function autoScoreOf(r) {
    var q = catalog.getQuestion(r.qid);
    if (!q) return null;
    var paperMax = paperScoreOf(r.examId, r.qid);
    if (r.stepId) {
      var step = (q.steps || []).filter(function (st) { return st.id === r.stepId; })[0];
      if (!step) return null;
      /* 步骤满分按卷面配分等比缩放，与答题端判分口径一致 */
      var stepMax = step.score;
      if (typeof EX.engine.stepScores === "function") {
        var scales = EX.engine.stepScores(q, paperMax);
        var idx = (q.steps || []).indexOf(step);
        if (idx !== -1 && scales[idx] !== undefined) stepMax = scales[idx];
      }
      var res = EX.engine.gradeStep(step, r.answerText, stepMax);
      return { score: res.score, max: res.max, hit: res.hit, step: step };
    }
    if (q.type === "short") {
      var sres = EX.engine.gradeShort(q, r.answerText, paperMax);
      return { score: sres.score, max: sres.max, points: sres.points, answered: sres.answered };
    }
    return null;
  }

  EX.views["admin.review"] = function (params) {
    if (params && params.id) {
      reviewState.currentId = params.id;
      reviewState.filter = "all";
    }
    var list = reviewList();
    if (!reviewState.currentId || !reviewById(reviewState.currentId)) {
      reviewState.currentId = list.length ? list[0].id : "";
    }
    var current = reviewById(reviewState.currentId);

    var pendingCount = reviews().filter(function (r) { return r.status === "pending"; }).length;
    var reviewedCount = reviews().filter(function (r) { return r.status === "reviewed"; }).length;

    var filters = [
      { id: "pending", label: "待阅卷 " + pendingCount },
      { id: "reviewed", label: "已阅卷 " + reviewedCount },
      { id: "all", label: "全部 " + reviews().length }
    ].map(function (f) {
      return '<button type="button" class="chip" data-action="admin.review.filter" data-value="' + f.id + '" ' +
        'aria-pressed="' + (reviewState.filter === f.id ? "true" : "false") + '">' + h.esc(f.label) + "</button>";
    }).join("");

    var items = list.map(function (r) {
      var st = EX.seed.getStudent(r.studentId);
      var q = catalog.getQuestion(r.qid);
      var exam = catalog.getExam(r.examId);
      return '<div class="list-row' + (r.id === reviewState.currentId ? " is-active" : "") + '" ' +
        'data-action="admin.review.open" data-id="' + h.esc(r.id) + '" data-enter role="button" tabindex="0">' +
        '<div class="list-main">' +
          '<div class="list-title">' + h.esc(st ? st.name : r.studentId) +
            '<span class="badge ' + (r.status === "pending" ? "badge-warn" : "badge-ok") + '" style="margin-left:8px">' +
            (r.status === "pending" ? "待阅" : "已阅") + "</span></div>" +
          '<div class="list-sub">' + h.esc(exam ? exam.name : r.examId) + " · " +
            h.esc(q ? EX.seed.typeLabel(q.type) : "") + (r.stepId ? " · 步骤 " + r.stepId : "") +
            (Number(r.attempt) > 1 ? " · 第 " + r.attempt + " 次作答" : "") + "</div>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<div class="text-xs text-3 nowrap">' + h.esc(r.submittedAt) + "</div>" +
        "</div>";
    }).join("");

    var detail = current ? reviewDetail(current) :
      '<div class="empty"><span class="empty-title">没有需要阅卷的作答</span>' +
      '<span class="empty-body">答题者在答题端交卷后，主观题作答会自动进入阅卷队列。</span></div>';

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">阅卷中心</h1>' +
        '<p class="page-sub">主观题由系统按关键词给出初判建议，管理端复核后给出最终分数与评语。当前待阅 ' +
          pendingCount + " 份，已阅 " + reviewedCount + " 份。</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="admin.review.batchAuto">批量采纳初判建议</button>' +
      "</div></div>" +
      '<div class="split-side">' +
        '<section class="card"><div class="card-head"><h2 class="card-title">卷宗队列</h2></div>' +
          '<div class="card-body" style="padding-bottom:var(--sp-3)"><div class="row-tight">' + filters + "</div></div>" +
          '<div class="card-body is-flush">' + (items || '<div class="empty"><span class="empty-title">队列为空</span></div>') + "</div></section>" +
        "<div>" + detail + "</div>" +
      "</div>";
  };

  function reviewDetail(r) {
    var st = EX.seed.getStudent(r.studentId);
    var q = catalog.getQuestion(r.qid);
    var exam = catalog.getExam(r.examId);
    if (!q) return '<div class="empty"><span class="empty-title">题目已不存在</span></div>';

    var auto = autoScoreOf(r);
    var maxScore = auto ? auto.max : (q.score || 0);
    var given = r.teacherScore === null || r.teacherScore === undefined ? (auto ? auto.score : 0) : r.teacherScore;
    var kpTag = knowledgeTag(q);

    var answerBlock = '<div class="card" style="margin-bottom:var(--sp-4)"><div class="card-head"><h2 class="card-title">答题者作答</h2>' +
      '<span class="text-sm text-3">' + h.esc(r.submittedAt) + "</span></div>" +
      '<div class="card-body">' +
        '<div class="kv" style="margin-bottom:var(--sp-3)">' +
          "<dt>答题者</dt><dd>" + h.esc(st ? st.name + " · " + st.className + " · " + st.id : r.studentId) + "</dd>" +
          "<dt>试卷</dt><dd>" + h.esc(exam ? exam.name : r.examId) + "</dd>" +
          "<dt>题目</dt><dd>" + h.esc(q.id) + " · " + h.esc(EX.seed.typeLabel(q.type)) + " · " + paperScoreOf(r.examId, r.qid) + " 分" +
            (r.stepId ? " · 步骤 " + h.esc(r.stepId) : "") + "</dd>" +
          "<dt>作答次序</dt><dd>第 " + (Number(r.attempt) || 1) + " 次作答</dd>" +
          "<dt>标签</dt><dd>" + (tagChips(q) || "—") + "</dd>" +
        "</div>" +
        '<div class="q-stem" style="margin-bottom:var(--sp-3)">' + h.esc(q.stem) + "</div>" +
        (kpTag ? '<div class="row-tight" style="margin-bottom:var(--sp-3)"><span class="text-sm text-3">知识点</span>' +
          '<span class="tag-chip is-知识点">' + h.esc(kpTag.name) + "</span></div>" : "") +
        '<div class="analysis" style="white-space:pre-wrap">' + h.esc(r.answerText || "（未作答）") + "</div>" +
      "</div></div>";

    var refBlock = q.reference ? '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-head">' +
      '<h2 class="card-title">参考答案</h2></div><div class="card-body">' +
      '<div class="analysis" style="white-space:pre-wrap">' + h.esc(q.reference) + "</div>" +
      (q.analysis ? '<p class="section-note" style="margin-top:var(--sp-3)">' + h.esc(q.analysis) + "</p>" : "") +
      "</div></section>" : "";

    var kpBlock = "";
    if (auto && auto.points) {
      kpBlock = '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-head">' +
        '<h2 class="card-title">评分要点命中</h2><span class="text-sm text-3">系统初判 ' + fmt.score(auto.score) + " / " + fmt.score(auto.max) + " 分</span></div>" +
        '<div class="card-body"><div class="kp-list">' + auto.points.map(function (p) {
          return '<div class="kp' + (p.hit ? " is-hit" : "") + '">' +
            '<span class="kp-mark">' + (p.hit ? "✓" : "○") + "</span>" +
            "<span>" + h.esc(p.text) + "</span>" +
            '<span class="text-xs text-3 num">' + fmt.score(p.score) + " / " + fmt.score(p.max) + "</span></div>";
        }).join("") + "</div></div></section>";
    } else if (auto && auto.step) {
      kpBlock = '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-head">' +
        '<h2 class="card-title">步骤评分</h2><span class="text-sm text-3">系统初判 ' + fmt.score(auto.score) + " / " + fmt.score(auto.max) + " 分</span></div>" +
        '<div class="card-body"><div class="kp-list">' +
        '<div class="kp' + (auto.hit ? " is-hit" : "") + '"><span class="kp-mark">' + (auto.hit ? "✓" : "○") + "</span>" +
        "<span>" + h.esc(auto.step.prompt) + "</span>" +
        '<span class="text-xs text-3 num">' + fmt.score(auto.score) + " / " + fmt.score(auto.max) + "</span></div>" +
        "</div></div></section>";
    }

    var scoreOptions = [];
    for (var i = 0; i <= maxScore; i++) scoreOptions.push(i);
    var scoreChips = scoreOptions.map(function (n) {
      return '<button type="button" class="chip" data-action="admin.review.setScore" data-value="' + n + '" ' +
        'aria-pressed="' + (Number(given) === n ? "true" : "false") + '">' + n + "</button>";
    }).join("");

    var formBlock = '<section class="card"><div class="card-head"><h2 class="card-title">评分与评语</h2>' +
      '<span class="badge ' + (r.status === "reviewed" ? "badge-ok" : "badge-warn") + '">' +
      (r.status === "reviewed" ? "已阅卷" : "待阅卷") + "</span></div>" +
      '<div class="card-body">' +
        '<div class="field" style="margin-bottom:var(--sp-4)"><span class="field-label">最终得分</span>' +
          '<div class="row-tight">' + scoreChips + "</div>" +
          '<span class="field-hint">满分 ' + fmt.score(maxScore) + " 分，可在上方选择或直接修改下方输入框。</span></div>" +
        '<div class="field" style="margin-bottom:var(--sp-4)"><label class="field-label" for="rv-score">分数</label>' +
          '<input class="input" id="rv-score" type="number" min="0" max="' + maxScore + '" step="0.5" value="' + given + '"></div>' +
        '<div class="field" style="margin-bottom:var(--sp-4)"><label class="field-label" for="rv-comment">评语</label>' +
          '<textarea class="textarea" id="rv-comment" placeholder="写下针对该次作答的评语，答题端成绩报告可见">' +
          h.esc(r.comment || "") + "</textarea></div>" +
        '<div class="row">' +
          '<button class="btn btn-primary" data-action="admin.review.save" data-id="' + h.esc(r.id) + '">保存评分</button>' +
          '<button class="btn" data-action="admin.review.prev">上一份</button>' +
          '<button class="btn" data-action="admin.review.next">下一份</button>' +
        "</div>" +
      "</div></section>";

    return answerBlock + refBlock + kpBlock + formBlock;
  }

  /* -------------------------------------------------------- 成绩分析 */
  /* 用固定种子模拟各答题者的答卷，保证统计结果可复现；已复核的分数优先覆盖初判分。 */
  function abilityOf(student, seed) {
    var r = EX.engine.rng(EX.engine.hash32(seed + "|" + student.id + "|ability"));
    return 0.45 + r() * 0.5;
  }

  function simulateExam(exam) {
    var cfg = plumCfg(exam);
    var students = roster();
    var rows = students.map(function (student, idx) {
      var paper = EX.engine.previewPaper(exam, student, cfg, idx);
      var ability = abilityOf(student, exam.id);

      var responses = {};
      paper.items.forEach(function (item) {
        var q = item.question;
        if (q.type === "single" || q.type === "judge") {
          var right = EX.engine.rng(EX.engine.hash32(exam.id + "|" + student.id + "|" + q.id + "|r"))() < ability;
          var pick = right ? q.answer[0] : wrongKeyFor(q, item, exam, student);
          responses[q.id] = { choice: [item.fromOriginal[pick] || pick] };
        } else if (q.type === "multi") {
          var rnd = EX.engine.rng(EX.engine.hash32(exam.id + "|" + student.id + "|" + q.id + "|m"));
          var picked = q.answer.filter(function () { return rnd() < ability + 0.2; });
          if (!picked.length) picked = [q.answer[0]];
          responses[q.id] = { choice: picked.map(function (k) { return item.fromOriginal[k] || k; }) };
        } else if (q.type === "short") {
          responses[q.id] = { text: shortAnswerFor(q, ability) };
        } else {
          var steps = {};
          (q.steps || []).forEach(function (st) {
            var r = EX.engine.rng(EX.engine.hash32(exam.id + "|" + student.id + "|" + q.id + "|" + st.id));
            steps[st.id] = r() < ability ? st.answer : "";
          });
          responses[q.id] = { steps: steps };
        }
      });
      var graded = EX.engine.scorePaper(paper, responses);
      return {
        student: student,
        paper: paper,
        graded: graded,
        objective: graded.objective.score,
        subjective: graded.subjective.score,
        total: graded.total,
        max: graded.totalMax
      };
    });

    /* 已复核的分数覆盖初判分 */
    reviews().forEach(function (r) {
      if (r.examId !== exam.id) return;
      var row = rows.filter(function (x) { return x.student.id === r.studentId; })[0];
      if (!row) return;
      var q = catalog.getQuestion(r.qid);
      if (!q) return;
      if (r.teacherScore === null || r.teacherScore === undefined) return;
      var detail = row.graded.details.filter(function (d) { return d.qid === r.qid; })[0];
      if (!detail) return;
      if (r.stepId) {
        var st = detail.steps.filter(function (s) { return s.id === r.stepId; })[0];
        if (!st) return;
        row.total = EX.engine.round2(row.total - st.score + r.teacherScore);
        st.score = r.teacherScore;
      } else {
        row.total = EX.engine.round2(row.total - detail.score + r.teacherScore);
        detail.score = r.teacherScore;
      }
      row.subjective = EX.engine.round2(row.total - row.objective);
    });

    rows.sort(function (a, b) { return b.total - a.total; });
    rows.forEach(function (row, i) { row.rank = i + 1; });
    return rows;
  }

  function wrongKeyFor(q, item, exam, student) {
    var rnd = EX.engine.rng(EX.engine.hash32(exam.id + "|" + student.id + "|" + q.id + "|w"));
    var others = (q.options || []).map(function (o) { return o.key; }).filter(function (k) { return q.answer.indexOf(k) === -1; });
    if (!others.length) return q.answer[0];
    return others[Math.floor(rnd() * others.length)];
  }

  function shortAnswerFor(q, ability) {
    var kps = q.keypoints || [];
    var take = Math.max(1, Math.round(kps.length * ability));
    return kps.slice(0, take).map(function (kp) { return kp.text; }).join("；");
  }

  EX.views["admin.analytics"] = function (params) {
    if (params && params.className) analyticsState.className = params.className;
    var ended = exams().filter(function (e) { return e.status === "ended"; });
    var exam = catalog.getExam(analyticsState.examId) || ended[0] || exams()[0];
    analyticsState.examId = exam.id;

    var classNames = ["全部"].concat(EX.seed.classes.map(function (c) { return c.name; }));
    var rows = simulateExam(exam);
    var scoped = rows.filter(function (r) {
      return analyticsState.className === "全部" || r.student.className === analyticsState.className;
    });
    if (!scoped.length) scoped = rows;

    var scores = scoped.map(function (r) { return r.total; });
    var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : 0;
    var max = scores.length ? Math.max.apply(null, scores) : 0;
    var min = scores.length ? Math.min.apply(null, scores) : 0;
    var pass = scoped.filter(function (r) { return r.total / r.max >= 0.6; }).length;
    var excellent = scoped.filter(function (r) { return r.total / r.max >= 0.85; }).length;

    var bands = [
      { label: "90 分以上", min: 0.9, max: 1.01 },
      { label: "80–90", min: 0.8, max: 0.9 },
      { label: "70–80", min: 0.7, max: 0.8 },
      { label: "60–70", min: 0.6, max: 0.7 },
      { label: "60 分以下", min: -0.01, max: 0.6 }
    ].map(function (b) {
      var n = scoped.filter(function (r) {
        var p = r.total / r.max;
        return p >= b.min && p < b.max;
      }).length;
      return { label: b.label, value: n };
    });

    var tableRows = scoped.map(function (r) {
      var pct = r.max ? (r.total / r.max) * 100 : 0;
      return "<tr>" +
        '<td class="num">' + r.rank + "</td>" +
        '<td><div class="strong" style="font-weight:600">' + h.esc(r.student.name) + "</div>" +
          '<div class="text-xs text-3">' + h.esc(r.student.className) + "</div></td>" +
        '<td class="num">' + fmt.score(r.objective) + "</td>" +
        '<td class="num">' + fmt.score(r.subjective) + "</td>" +
        '<td class="num strong" style="font-weight:600">' + fmt.score(r.total) + " / " + fmt.score(r.max) + "</td>" +
        "<td>" +
          '<div class="meter' + (pct >= 85 ? " is-ok" : pct >= 60 ? " is-warn" : " is-danger") + '"><i style="width:' +
            Math.max(2, Math.min(100, pct)) + '%"></i></div>' +
        "</td>" +
        '<td class="col-actions"><button class="btn btn-sm" data-action="admin.analytics.paper" data-student="' +
          h.esc(r.student.id) + '" data-exam="' + h.esc(exam.id) + '">卷面</button></td></tr>';
    }).join("");

    var qStats = [];
    scoped.forEach(function (r) {
      r.graded.details.forEach(function (d) {
        var st = qStats.filter(function (x) { return x.qid === d.qid; })[0];
        if (!st) {
          var q = d.question;
          st = { qid: d.qid, stem: q.stem, type: q.type, max: d.max, correct: 0, total: 0, score: 0 };
          qStats.push(st);
        }
        st.total += 1;
        st.score += d.score;
        /* 主观题按满分即满分判定为答对，客观题按状态判定 */
        var full = d.type === "short" || d.type === "comprehensive";
        if (full ? d.score >= d.max - 0.001 : d.status === "correct") st.correct += 1;
      });
    });
    var qRows = qStats.map(function (s) {
      var rate = s.total ? (s.correct / s.total) * 100 : 0;
      var avgScore = s.total ? s.score / s.total : 0;
      return "<tr>" +
        '<td class="mono text-xs">' + h.esc(s.qid) + "</td>" +
        "<td>" + typeBadge(s.type) + "</td>" +
        '<td><div class="od-truncate" style="max-width:320px">' + h.esc(s.stem) + "</div></td>" +
        '<td class="num">' + fmt.score(s.max) + "</td>" +
        '<td class="num">' + fmt.pct(rate) + "%</td>" +
        '<td class="num">' + fmt.score(avgScore) + "</td>" +
        "<td>" + '<div class="meter' + (rate >= 80 ? " is-ok" : rate >= 60 ? " is-warn" : " is-danger") + '"><i style="width:' +
          Math.max(2, Math.min(100, rate)) + '%"></i></div>' + "</td></tr>";
    }).join("");

    var classChips = classNames.map(function (c) {
      return '<button type="button" class="chip" data-action="admin.analytics.class" data-value="' + h.esc(c) + '" ' +
        'aria-pressed="' + (analyticsState.className === c ? "true" : "false") + '">' + h.esc(c) + "</button>";
    }).join("");

    var examChips = ended.map(function (e) {
      return '<button type="button" class="chip" data-action="admin.analytics.exam" data-id="' + h.esc(e.id) + '" ' +
        'aria-pressed="' + (e.id === exam.id ? "true" : "false") + '">' + h.esc(e.name) + "</button>";
    }).join("");

    var typeStat = [];
    ["single", "multi", "judge", "short", "comprehensive"].forEach(function (t) {
      var n = 0;
      var sc = 0;
      var mx = 0;
      scoped.forEach(function (r) {
        r.graded.details.forEach(function (d) {
          if (d.type !== t) return;
          n += 1;
          sc += d.score;
          mx += d.max;
        });
      });
      if (n) typeStat.push({ label: EX.seed.typeLabel(t), value: mx ? Math.round((sc / mx) * 1000) / 10 : 0, tone: "is-warn" });
    });

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">成绩分析</h1>' +
        '<p class="page-sub">' + h.esc(exam.name) + " · " + h.esc(EX.engine.MODES[plumCfg(exam).mode].label) +
          " · 共 " + scoped.length + " 名答题者。分数分布与逐题正确率基于各卷作答统计，主观题已合并复核分。</p>" +
      "</div>" +
      '<div class="page-actions">' +
        '<button class="btn" data-action="nav.go" data-key="admin.paper" data-params=\'{"kind":"exam","id":"' + h.esc(exam.id) + '","step":"plum"}\'>查看卷面矩阵</button>' +
      "</div></div>" +
      '<section class="card" style="margin-bottom:var(--sp-4)"><div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)"><span class="text-sm text-3">名单组</span><div class="row-tight">' + classChips + "</div></div>" +
        '<div class="row"><span class="text-sm text-3">试卷</span><div class="row-tight">' + examChips + "</div></div>" +
      "</div></section>" +
      '<div class="stat-row" style="margin-bottom:var(--sp-4)">' +
        statCard("平均分", fmt.score(avg), "分", "满分 " + fmt.score(scoped.length ? scoped[0].max : 0) + " 分") +
        statCard("最高 / 最低", fmt.score(max) + " / " + fmt.score(min), "分", "极差 " + fmt.score(max - min) + " 分") +
        statCard("及格率", fmt.pct(scoped.length ? (pass / scoped.length) * 100 : 0), "%", pass + " / " + scoped.length + " 人") +
        statCard("优秀率", fmt.pct(scoped.length ? (excellent / scoped.length) * 100 : 0), "%", excellent + " / " + scoped.length + " 人") +
      "</div>" +
      '<div class="split" style="margin-bottom:var(--sp-4)">' +
        '<section class="card"><div class="card-head"><h2 class="card-title">成绩明细</h2>' +
          '<span class="text-sm text-3">按总分降序</span></div>' +
          '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
          "<thead><tr><th>总排名</th><th>答题者</th><th>客观题</th><th>主观题</th><th>总分</th><th>得分率</th><th></th></tr></thead>" +
          "<tbody>" + tableRows + "</tbody></table></div></div></section>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><h2 class="card-title">分数段分布</h2></div>' +
            '<div class="card-body">' + EX.chart.bar({ data: bands, title: "分数段分布" }) + "</div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">题型得分率</h2></div>' +
            '<div class="card-body">' + typeStat.map(function (t) {
              return barRow(t.label, t.value, 100, "%", t.tone);
            }).join("") + "</div></section>" +
        "</div>" +
      "</div>" +
      '<section class="card"><div class="card-head"><h2 class="card-title">逐题正确率</h2>' +
        '<span class="text-sm text-3">正确率低于 60% 的题目建议安排讲评</span></div>' +
        '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>题号</th><th>题型</th><th>题干</th><th>满分</th><th>正确率</th><th>平均得分</th><th>掌握度</th></tr></thead>" +
        "<tbody>" + qRows + "</tbody></table></div></div></section>";
  };

  /* ------------------------------------------------------------ 动作实现 */

  function fieldValue(id) {
    var el = doc.getElementById(id);
    return el ? el.value : "";
  }

  /* ---------------------------------------------------------- 标签动作 */
  EX.actions["admin.tag.new"] = function () {
    openTagDialog(null);
  };

  EX.actions["admin.tag.edit"] = function (el) {
    openTagDialog(el.getAttribute("data-id"));
  };

  EX.actions["admin.tag.delete"] = function (el) {
    var id = el.getAttribute("data-id");
    var tag = catalog.getTag(id);
    if (!tag) return;
    var usage = catalog.usageOf(id);
    EX.confirm({
      title: "删除标签",
      message: "将删除标签「" + tag.name + "」，并解除其在 " + usage.total + " 处挂载（题目 " + usage.questions +
        " / 题库 " + usage.banks + " / 试卷 " + usage.exams + " / 练习 " + usage.practices +
        "）。对象本身保留，操作不可撤销。",
      okText: "确认删除",
      onConfirm: function () {
        var res = catalog.removeTag(id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
        EX.toast("已删除标签「" + tag.name + "」并解除 " + usage.total + " 处挂载", "ok");
        EX.router.refresh();
      }
    });
  };

  EX.actions["admin.tag.save"] = function () {
    var name = String(fieldValue("tg-name") || "").trim();
    var group = fieldValue("tg-group") || catalog.tagGroups()[0];
    if (!name) { EX.toast("请填写标签名称", "error"); return; }
    var res = editorState.id
      ? catalog.updateTag(editorState.id, { name: name, group: group })
      : catalog.createTag({ name: name, group: group });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.closeDialog("dlg-tag");
    EX.toast(editorState.id ? "标签已更新" : "标签已创建", "ok");
    EX.router.refresh();
  };

  EX.actions["admin.tag.toggle"] = function (el) {
    var id = el.getAttribute("data-tag");
    if (!id) return;
    var idx = tagState.tags.indexOf(id);
    if (idx !== -1) {
      tagState.tags.splice(idx, 1);
    } else {
      if (tagState.tags.length >= MAX_TAGS) {
        EX.toast("最多只能选择 " + MAX_TAGS + " 个标签", "error");
        return;
      }
      tagState.tags.push(id);
    }
    syncTagPicker();
  };

  /* ---------------------------------------------------------- 题库动作 */
  EX.actions["admin.bank.new"] = function () {
    openBankDialog(null);
  };

  EX.actions["admin.bank.edit"] = function (el) {
    openBankDialog(el.getAttribute("data-id"));
  };

  EX.actions["admin.bank.delete"] = function (el) {
    var id = el.getAttribute("data-id");
    var bank = catalog.getBank(id);
    if (!bank) return;
    EX.confirm({
      title: "删除题库",
      message: "将删除题库「" + bank.name + "」，其中 " + (bank.questionIds || []).length +
        " 道题目的归属会解除，题目本身保留，操作不可撤销。",
      okText: "确认删除",
      onConfirm: function () {
        var res = catalog.removeBank(id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
        EX.toast("已删除题库「" + bank.name + "」", "ok");
        EX.router.refresh();
      }
    });
  };

  EX.actions["admin.bank.save"] = function () {
    var name = String(fieldValue("bk-name") || "").trim();
    if (!name) { EX.toast("请填写题库名称", "error"); return; }
    var res = catalog.upsertBank({
      id: bankEditor.id || "",
      name: name,
      desc: fieldValue("bk-desc"),
      tags: tagState.tags.slice(),
      questionIds: bankEditor.questionIds.slice()
    });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.closeDialog("dlg-bank");
    EX.toast(bankEditor.id ? "题库已更新" : "题库已创建", "ok");
    EX.router.refresh();
  };

  /* ---------------------------------------------------------- 题目动作 */
  EX.actions["admin.question.new"] = function () {
    openQuestionEditor(null);
  };

  EX.actions["admin.question.edit"] = function (el) {
    openQuestionEditor(el.getAttribute("data-id"));
  };

  EX.actions["admin.question.delete"] = function (el) {
    var id = el.getAttribute("data-id");
    var q = catalog.getQuestion(id);
    if (!q) return;
    EX.confirm({
      title: "删除题目",
      message: "将删除题目 " + id + "：" + q.stem + "。题库、试卷与练习中的引用会自动跳过此题，操作不可撤销。",
      okText: "确认删除",
      onConfirm: function () {
        var res = catalog.removeQuestion(id);
        if (!res.ok) { EX.toast(res.message, "error"); return; }
        EX.toast("已删除题目 " + id, "ok");
        EX.router.refresh();
      }
    });
  };

  EX.actions["admin.question.save"] = function () {
    var id = String(fieldValue("qe-id") || "").trim();
    var stem = String(fieldValue("qe-stem") || "").trim();
    if (!id) { EX.toast("请填写题目编号", "error"); return; }
    if (!stem) { EX.toast("请填写题干", "error"); return; }
    if (!editorState.id && questions().some(function (x) { return x.id === id; })) {
      EX.toast("题号 " + id + " 已存在，请更换", "error");
      return;
    }
    var type = fieldValue("qe-type") || "single";
    var payload = {
      id: editorState.id || id,
      type: type,
      score: parseFloat(fieldValue("qe-score")) || 5,
      stem: stem,
      tags: tagState.tags.slice(),
      analysis: fieldValue("qe-analysis"),
      reference: fieldValue("qe-reference"),
      status: fieldValue("qe-status") || "draft"
    };

    if (type === "single" || type === "multi" || type === "judge") {
      var texts = {};
      Array.prototype.forEach.call(doc.querySelectorAll("[data-opt-text]"), function (el) {
        texts[el.getAttribute("data-opt-text")] = el.value;
      });
      var picked = [];
      Array.prototype.forEach.call(doc.querySelectorAll("[data-opt-answer]"), function (el) {
        if (el.checked) picked.push(el.getAttribute("data-opt-answer"));
      });
      var keys = Object.keys(texts);
      if (type === "judge") keys = ["A", "B"];
      if (!picked.length) { EX.toast("请至少勾选一个正确答案", "error"); return; }
      if (type === "single" && picked.length > 1) { EX.toast("单选题只能有一个正确答案", "error"); return; }
      if (type === "multi" && picked.length < 2) { EX.toast("多选题至少需要两个正确答案", "error"); return; }
      payload.options = keys.map(function (k) {
        return { key: k, text: type === "judge" ? (k === "A" ? "正确" : "错误") : (texts[k] || "") };
      });
      payload.answer = picked.slice().sort();
    } else if (type === "short") {
      var kps = [];
      Array.prototype.forEach.call(doc.querySelectorAll("[data-kp-text]"), function (el) {
        var i = el.getAttribute("data-kp-text");
        var kwEl = doc.querySelector('[data-kp-kw="' + i + '"]');
        var text = el.value.trim();
        if (!text) return;
        var keywords = (kwEl ? kwEl.value : "").split(/[,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
        kps.push({ text: text, keywords: keywords.length ? keywords : [text] });
      });
      if (!kps.length) { EX.toast("请至少填写一个评分要点", "error"); return; }
      payload.keypoints = kps;
    } else {
      var steps = [];
      Array.prototype.forEach.call(doc.querySelectorAll("[data-step-prompt]"), function (el) {
        var i = el.getAttribute("data-step-prompt");
        var ansEl = doc.querySelector('[data-step-answer="' + i + '"]');
        var kwEl = doc.querySelector('[data-step-kw="' + i + '"]');
        var scEl = doc.querySelector('[data-step-score="' + i + '"]');
        var prompt = el.value.trim();
        if (!prompt) return;
        var keywords = (kwEl ? kwEl.value : "").split(/[,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
        steps.push({
          id: "s" + (steps.length + 1),
          prompt: prompt,
          answer: ansEl ? ansEl.value : "",
          keywords: keywords.length ? keywords : [prompt],
          score: parseFloat(scEl ? scEl.value : 5) || 5
        });
      });
      if (!steps.length) { EX.toast("请至少填写一个评分步骤", "error"); return; }
      payload.steps = steps;
    }

    var res = catalog.upsertQuestion(payload);
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.closeDialog("dlg-question");
    EX.toast(editorState.id ? "题目已更新" : "题目已新增", "ok");
    EX.router.refresh();
  };

  /* 题型切换：重建动态结构（选项 / 评分要点 / 评分步骤） */
  EX.actions["admin.qtype"] = function (el) {
    var type = el.value || "single";
    editorState.type = type;
    var q = editorState.id ? catalog.getQuestion(editorState.id) : null;
    var dyn = doc.getElementById("qe-dynamic");
    if (dyn) dyn.innerHTML = dynamicEditorHtml(q, type);
  };

  /* -------------------------------------------------- 试卷 / 练习 标签 */
  EX.actions["admin.preview.pick"] = function (el) {
    previewState.index = parseInt(el.value, 10) || 0;
    EX.router.refresh();
  };

  function openEntityTags(kind, id) {
    var item = kind === "exam" ? catalog.getExam(id) : catalog.getPractice(id);
    if (!item) return;
    entityState.kind = kind;
    entityState.id = id;
    var title = doc.getElementById("entity-tags-title");
    if (title) title.textContent = (kind === "exam" ? "试卷标签 · " : "练习标签 · ") + item.name;
    var sub = doc.getElementById("entity-tags-sub");
    if (sub) {
      sub.textContent = "标签用于把" + (kind === "exam" ? "试卷" : "练习") + "接入领域 / 知识点 / 能力等维度，答题端据此筛选与归档。";
    }
    mountTagPicker("entity-tag-picker", "entity-tag-counter", item.tags || []);
    EX.openDialog("dlg-entity-tags");
  }

  EX.actions["admin.entity.tags"] = function (el) {
    openEntityTags(el.getAttribute("data-kind"), el.getAttribute("data-id"));
  };

  EX.actions["admin.entity.tags.save"] = function () {
    var res = catalog.setEntityTags(entityState.kind, entityState.id, tagState.tags.slice());
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.closeDialog("dlg-entity-tags");
    EX.toast("标签已更新", "ok");
    EX.router.refresh();
  };

  /* ---------------------------------------------------------- 阅卷动作 */
  EX.actions["admin.review.open"] = function (el) {
    var id = el.getAttribute("data-id");
    if (!id) return;
    reviewState.currentId = id;
    EX.router.refresh();
  };

  EX.actions["admin.review.filter"] = function (el) {
    reviewState.filter = el.getAttribute("data-value");
    reviewState.currentId = "";
    EX.router.refresh();
  };

  EX.actions["admin.review.setScore"] = function (el) {
    var value = el.getAttribute("data-value");
    var input = doc.getElementById("rv-score");
    if (input) input.value = value;
    var host = el.parentNode;
    if (host && host.children) {
      Array.prototype.forEach.call(host.children, function (btn) {
        if (!btn.setAttribute) return;
        btn.setAttribute("aria-pressed", btn.getAttribute("data-value") === value ? "true" : "false");
      });
    }
  };

  EX.actions["admin.review.save"] = function (el) {
    var id = el && el.getAttribute ? el.getAttribute("data-id") : null;
    var r = reviewById(id || reviewState.currentId);
    if (!r) return;
    var q = catalog.getQuestion(r.qid);
    var auto = autoScoreOf(r);
    var maxScore = auto ? auto.max : (q ? q.score : 0);
    var scoreEl = doc.getElementById("rv-score");
    var score = scoreEl
      ? parseFloat(scoreEl.value)
      : (r.teacherScore === null || r.teacherScore === undefined ? 0 : r.teacherScore);
    if (isNaN(score)) score = 0;
    if (score < 0) score = 0;
    if (maxScore && score > maxScore) score = maxScore;
    var commentEl = doc.getElementById("rv-comment");
    var res = catalog.updateReview(r.id, {
      teacherScore: score,
      comment: commentEl ? commentEl.value.trim() : "",
      status: "reviewed"
    });
    if (!res.ok) { EX.toast(res.message, "error"); return; }
    EX.toast("已保存评分：" + fmt.score(score) + " / " + fmt.score(maxScore) + " 分", "ok");
    EX.router.refresh();
  };

  EX.actions["admin.review.next"] = function () { stepReview(1); };
  EX.actions["admin.review.prev"] = function () { stepReview(-1); };

  function stepReview(delta) {
    var list = reviewList();
    if (!list.length) return;
    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === reviewState.currentId) { idx = i; break; }
    }
    var next = list[(idx + delta + list.length) % list.length];
    reviewState.currentId = next.id;
    EX.router.refresh();
  }

  EX.actions["admin.review.batchAuto"] = function () {
    var pending = reviews().filter(function (r) { return r.status === "pending"; });
    if (!pending.length) { EX.toast("没有待阅卷的作答", "ok"); return; }
    EX.confirm({
      title: "批量采纳初判建议",
      message: "将对 " + pending.length + " 份待阅卷宗采用系统按关键词给出的初判分数，并标记为已阅卷。仍可在队列中逐份复核修改。",
      okText: "批量采纳",
      onConfirm: function () {
        var applied = 0;
        pending.forEach(function (r) {
          var auto = autoScoreOf(r);
          if (!auto) return;
          r.teacherScore = auto.score;
          r.status = "reviewed";
          applied += 1;
        });
        catalog.save();
        EX.toast("已批量采纳 " + applied + " 份卷宗的初判建议", "ok");
        EX.router.refresh();
      }
    });
  };

  /* -------------------------------------------------------- 分析动作 */
  EX.actions["admin.analytics.class"] = function (el) {
    analyticsState.className = el.getAttribute("data-value");
    EX.router.refresh();
  };

  EX.actions["admin.analytics.exam"] = function (el) {
    analyticsState.examId = el.getAttribute("data-id");
    EX.router.refresh();
  };

  EX.actions["admin.analytics.paper"] = function (el) {
    var exam = catalog.getExam(el.getAttribute("data-exam"));
    var student = EX.seed.getStudent(el.getAttribute("data-student"));
    if (!exam || !student) return;
    openPaperPreview(exam, student);
  };

  function openPaperPreview(exam, student) {
    var cfg = plumCfg(exam);
    var students = roster();
    var idx = students.map(function (s) { return s.id; }).indexOf(student.id);
    if (idx === -1) idx = 0;
    var paper = EX.engine.previewPaper(exam, student, cfg, idx);
    var title = doc.getElementById("preview-title");
    if (title) title.textContent = student.name + " · " + exam.name;
    var body = doc.getElementById("preview-body");
    if (body) {
      body.innerHTML =
        '<div class="row" style="margin-bottom:var(--sp-3)">' +
          '<span class="variant-tag">' + h.esc(paper.variantLabel) + "</span>" +
          '<span class="text-sm text-3">卷型 ' + h.esc(EX.engine.MODES[cfg.mode].label) + " · 置换号 " +
          h.esc(paper.seedLabel) + "（系统自动生成）· " + h.esc(student.className) + " · " + h.esc(student.id) + "</span></div>" +
        '<div class="table-wrap"><table class="table"><thead><tr><th>题号</th>' +
        (cfg.mode === "large" ? "<th>标准题号</th>" : "") +
        "<th>题目内容（答题者所见）</th></tr></thead>" +
        "<tbody>" + paperRowsHtml(paper, cfg.mode === "large") + "</tbody></table></div>";
    }
    EX.openDialog("dlg-preview");
  }

  /* ------------------------------------------------------ 事件委托 */
  function updateBankCount() {
    var el = doc.getElementById("bk-count");
    if (el) el.textContent = "已选 " + bankEditor.questionIds.length + " 题";
  }

  doc.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;

    var qid = el.getAttribute("data-bank-qid");
    if (qid) {
      if (el.checked) {
        if (bankEditor.questionIds.indexOf(qid) === -1) bankEditor.questionIds.push(qid);
      } else {
        bankEditor.questionIds = bankEditor.questionIds.filter(function (x) { return x !== qid; });
      }
      updateBankCount();
      return;
    }

    var name = el.getAttribute("data-change");
    if (!name) return;
    var fn = EX.actions[name];
    if (!fn) return;
    fn(el, event);
  });

  var searchTimer = null;
  doc.addEventListener("input", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    var scope = el.getAttribute("data-search");
    if (!scope || scope !== "bank") return;
    if (searchTimer) global.clearTimeout(searchTimer);
    searchTimer = global.setTimeout(function () {
      bankFilter.keyword = el.value;
      EX.router.refresh();
      var box = doc.querySelector('[data-search="' + scope + '"]');
      if (box) {
        box.focus();
        if (box.setSelectionRange) box.setSelectionRange(box.value.length, box.value.length);
      }
    }, 200);
  });

  /* --------------------------------------------------------- 调试出口 */
  EX.admin = {
    bankFilter: bankFilter,
    previewState: previewState,
    reviewState: reviewState,
    analyticsState: analyticsState,
    simulateExam: simulateExam,

    /* 供 admin-workbench.js 复用的渲染与编辑器 */
    typeBadge: typeBadge,
    tagChips: tagChips,
    difficultyChip: difficultyChip,
    knowledgeTag: knowledgeTag,
    statCard: statCard,
    barRow: barRow,
    paperRowsHtml: paperRowsHtml,
    previewSection: previewSection,
    openQuestionEditor: openQuestionEditor,
    openBankDialog: openBankDialog,
    openEntityTags: openEntityTags,
    roster: roster,
    plumCfg: plumCfg
  };
})(window);
