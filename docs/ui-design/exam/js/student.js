/* ==========================================================================
   知行测评 · 答题端
   工作台 / 练习中心 / 练习会话 / 考试安排 / 考试会话 / 成绩报告 / 错题本 / 个人中心
   内容以标签为组织轴：题库、题目、试卷、练习统一挂载标签（单对象最多 5 个）。
    答题端仅呈现「已发布」题目与「已发布 / 已上架」的卷。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = global.EX;
  var doc = global.document;
  var h = EX.h;
  var fmt = EX.fmt;
  var store = EX.store;
  var catalog = EX.catalog;

  /* ------------------------------------------------------------ 基础 */
  function currentStudent() {
    return EX.seed.getStudent(store.state.studentId) || EX.seed.students[0];
  }

  function rosterIndex() {
    return Math.max(0, EX.seed.students.indexOf(currentStudent()));
  }

  function plumCfg(exam) {
    return catalog.plumCfg(exam.id);
  }

  /** 答题端只呈现「已发布」题目 */
  function studentQids(paper) {
    return catalog.publishedQuestionIds((paper && paper.questionIds) || []);
  }

  /* 练习规则：重复次数、错题回流、反馈时机；单题重做不套用练习规则 */
  function practiceRule(session) {
    var fallback = { repeats: 0, mistakeReflow: false, feedback: "after_submit", name: "错题重做", redo: true };
    if (!session || !session.id || session.id.indexOf("single-") === 0) return fallback;
    var p = catalog.getPractice(session.id);
    if (!p) return fallback;
    return {
      repeats: Math.max(0, parseInt(p.repeats, 10) || 0),
      mistakeReflow: p.mistakeReflow !== false,
      feedback: p.feedback === "immediate" ? "immediate" : "after_submit",
      name: p.name,
      redo: false
    };
  }

  /* 错因摘要：按题型给出可读的错误类型 */
  function mistakeReason(d) {
    if (d.type === "multi") return "多选题漏选或错选";
    if (d.type === "single") return "单选题选项判断错误";
    if (d.type === "judge") return "判断题结论错误";
    if (d.type === "short") return "简答题要点未覆盖";
    if (d.type === "comprehensive") return "综合操作题步骤缺失";
    return "本题作答未得分";
  }

  /* 错题回流：答错入册、错题重做正确后移出错题本 */
  function recordMistakes(graded, session, rule) {
    if (!rule.mistakeReflow && !rule.redo) return;
    var sid = currentStudent().id;
    var today = new Date().toISOString().slice(0, 10);
    var list = store.state.mistakes;
    graded.details.forEach(function (d) {
      var idx = -1;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].qid === d.qid && (!list[i].studentId || list[i].studentId === sid)) { idx = i; break; }
      }
      var wrong = d.status === "wrong" || d.status === "partial";
      if (wrong) {
        if (idx === -1) {
          list.push({
            qid: d.qid,
            studentId: sid,
            wrongCount: 1,
            lastWrongAt: today,
            reason: mistakeReason(d)
          });
        } else {
          list[idx].wrongCount = (list[idx].wrongCount || 0) + 1;
          list[idx].lastWrongAt = today;
          list[idx].reason = mistakeReason(d);
        }
      } else if (rule.redo && idx !== -1 && d.status === "correct") {
        list.splice(idx, 1);
      }
    });
  }

  /* ---------------------------------------------------------- 标签片段 */  /** 标签 chip 组：entity.tags 的可视化呈现 */
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

  /* 多选标签筛选器 */
  function tagFilterHtml(selected, action) {
    return catalog.tagGroups().map(function (group) {
      var tags = catalog.tagsOfGroup(group);
      if (!tags.length) return "";
      var chips = tags.map(function (t) {
        var on = selected.indexOf(t.id) !== -1;
        return '<button type="button" class="chip is-tag" data-action="' + action + '" data-tag="' + h.esc(t.id) + '" ' +
          'aria-pressed="' + (on ? "true" : "false") + '">' + h.esc(t.name) + "</button>";
      }).join("");
      return '<div class="row" style="align-items:flex-start;margin-bottom:var(--sp-2)">' +
        '<span class="text-sm text-3 filter-group-label">' + h.esc(group) + "</span>" +
        '<div class="row-tight">' + chips + "</div></div>";
    }).join("");
  }

  function pseudoExam(id, qids, orderRule) {
    return {
      id: id,
      questionIds: qids,
      orderRule: orderRule || "type",
      plum: { mode: "standard" }
    };
  }

  /** 练习卷题序规则：跟随练习设置；单题重做保持原顺序 */
  function practiceOrderRule(sessionId) {
    if (!sessionId || sessionId.indexOf("single-") === 0) return "manual";
    var practice = catalog.getPractice(sessionId);
    return practice ? catalog.normalizeOrderRule(practice.orderRule) : "type";
  }

  /* 会话与作答记录按「答题者」维度隔离，切换答题者不会串卷 */
  function examSessionKey(examId) {
    return examId + ":" + store.state.studentId;
  }

  function practiceSessionKey(id) {
    return id + ":" + store.state.studentId;
  }

  function examSession(exam) {
    var s = store.state;
    var key = examSessionKey(exam.id);
    if (!s.examSessions[key]) {
      s.examSessions[key] = {
        examId: exam.id,
        studentId: s.studentId,
        responses: {},
        flags: {},
        current: 1,
        startedAt: null,
        deadlineAt: null,
        remainingSec: exam.durationMin * 60,
        submitted: false,
        submittedAt: null
      };
    }
    return s.examSessions[key];
  }

  function practiceSession(id, qids) {
    var s = store.state;
    var key = practiceSessionKey(id);
    if (!s.practiceSessions[key]) {
      s.practiceSessions[key] = {
        id: id,
        key: key,
        qids: qids,
        responses: {},
        flags: {},
        current: 1,
        startedAt: null,
        elapsedSec: 0,
        submitted: false,
        submittedAt: null,
        result: null
      };
    }
    return s.practiceSessions[key];
  }

  function isAnswered(item, resp) {
    var q = item.question;
    if (!resp) return false;
    if (q.type === "single" || q.type === "multi" || q.type === "judge") {
      return !!(resp.choice && resp.choice.length);
    }
    if (q.type === "short") return !!String(resp.text || "").trim();
    if (q.type === "comprehensive") {
      return q.steps.some(function (st) { return !!String((resp.steps || {})[st.id] || "").trim(); });
    }
    return false;
  }

  function countAnswered(paper, session) {
    var n = 0;
    paper.items.forEach(function (item) {
      if (isAnswered(item, session.responses[item.qid])) n += 1;
    });
    return n;
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

  /* ------------------------------------------------- 题目渲染片段 */
  function questionHead(item) {
    var q = item.question;
    return '<div class="q-head">' +
      '<span class="q-index">第 ' + item.slot + " 题</span>" +
      typeBadge(q.type) +
      '<span class="badge badge-neutral">' + q.score + " 分</span>" +
      difficultyChip(q) +
      tagChips(q) +
      (item.changed ? '<span class="variant-tag is-diff">选项已置换</span>' : "") +
      "</div>";
  }

  function stemHtml(q) {
    var html = h.esc(q.stem);
    if (q.figure) {
      html += '<span class="q-figure">' + figureHtml(q.figure) + "</span>";
    }
    return html;
  }

  /* 综合操作题中的示意图：用代码绘制，不外链图片 */
  function figureHtml(figure) {
    if (figure.type === "parabola") {
      return '<div class="q-figure-box">' +
        '<svg viewBox="0 0 420 240" width="420" height="240" role="img" aria-label="抛物线 y = x² 与直线 y = x + 2 的交点示意图">' +
        '<line class="chart-grid" x1="40" y1="200" x2="400" y2="200" stroke="currentColor" stroke-width="1"/>' +
        '<line class="chart-grid" x1="40" y1="20" x2="40" y2="200" stroke="currentColor" stroke-width="1"/>' +
        '<path d="M60 190 Q 220 150 380 40" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M60 178 Q 220 88 380 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.75"/>' +
        '<circle cx="118" cy="167" r="4" fill="currentColor"/><circle cx="330" cy="44" r="4" fill="currentColor"/>' +
        '<text x="126" y="162" font-size="12" fill="currentColor">(-1, 1)</text>' +
        '<text x="338" y="38" font-size="12" fill="currentColor">(2, 4)</text>' +
        '<text x="60" y="218" font-size="12" fill="currentColor">y = x²</text>' +
        '<text x="286" y="18" font-size="12" fill="currentColor">y = x + 2</text>' +
        "</svg></div>";
    }
    return "";
  }

  function optionsHtml(item, resp) {
    var q = item.question;
    var picked = (resp && resp.choice) || [];
    var multi = q.type === "multi";
    return '<div class="q-opts">' + item.displayKeys.map(function (originalKey, pos) {
      var letter = EX.engine.LETTERS[pos];
      var opt = q.options.filter(function (o) { return o.key === originalKey; })[0];
      var checked = picked.indexOf(letter) !== -1;
      return '<label class="opt' + (checked ? " is-selected" : "") + '">' +
        '<input type="' + (multi ? "checkbox" : "radio") + '" name="opt-' + h.esc(q.id) + '"' +
        ' data-choice="' + (multi ? "multi" : "single") + '" data-qid="' + h.esc(q.id) + '" data-letter="' + letter + '"' +
        (checked ? " checked" : "") + ">" +
        '<span class="opt-key" aria-hidden="true">' + letter + "</span>" +
        '<span class="opt-text">' + h.esc(opt ? opt.text : "") + "</span>" +
        "</label>";
    }).join("") + "</div>";
  }

  function shortHtml(item, resp) {
    var q = item.question;
    return '<div class="field">' +
      '<label class="field-label" for="ans-' + h.esc(q.id) + '">作答内容<span class="field-req">*</span></label>' +
      '<textarea class="textarea" id="ans-' + h.esc(q.id) + '" data-text-answer="' + h.esc(q.id) + '" ' +
      'placeholder="按要点分条作答，每行一条要点">' + h.esc((resp && resp.text) || "") + "</textarea>" +
      '<span class="field-hint">要点式作答更容易得分，系统会按关键词自动初判，阅卷人随后复核。</span>' +
      "</div>";
  }

  function comprehensiveHtml(item, resp) {
    var q = item.question;
    var steps = resp && resp.steps ? resp.steps : {};
    return q.steps.map(function (st) {
      return '<div class="field" style="margin-bottom:var(--sp-4)">' +
        '<label class="field-label" for="ans-' + h.esc(q.id) + '-' + h.esc(st.id) + '">' + h.esc(st.prompt) +
        ' <span class="field-hint">（' + st.score + " 分）</span></label>" +
        '<textarea class="textarea" id="ans-' + h.esc(q.id) + '-' + h.esc(st.id) + '" ' +
        'data-step-answer="' + h.esc(st.id) + '" data-qid="' + h.esc(q.id) + '" ' +
        'style="min-height:110px" placeholder="在此作答">' + h.esc(steps[st.id] || "") + "</textarea>" +
        "</div>";
    }).join("");
  }

  function questionBody(item, resp) {
    var q = item.question;
    if (q.type === "single" || q.type === "judge" || q.type === "multi") return optionsHtml(item, resp);
    if (q.type === "short") return shortHtml(item, resp);
    if (q.type === "comprehensive") return comprehensiveHtml(item, resp);
    return "";
  }

  function sheetHtml(items, session, kind) {
    var cells = items.map(function (item) {
      var answered = isAnswered(item, session.responses[item.qid]);
      var flagged = !!session.flags[item.qid];
      var current = item.slot === session.current;
      var cls = "sheet-cell" + (answered ? " is-answered" : "") + (current ? " is-current" : "");
      return '<button type="button" class="' + cls + '" data-action="' + kind + '.goto" data-slot="' + item.slot + '" data-qid="' + h.esc(item.qid) + '" ' +
        'aria-label="第 ' + item.slot + " 题" + (answered ? "（已作答）" : "（未作答）") + (flagged ? "（已标记）" : "") + '">' +
        item.slot + (flagged ? '<span class="sheet-flag"></span>' : "") + "</button>";
    }).join("");
    return '<div class="answer-sheet">' + cells + "</div>" +
      '<div class="sheet-legend" style="margin-top:var(--sp-3)">' +
        '<span><span class="legend-dot is-answered"></span>已作答</span>' +
        '<span><span class="legend-dot"></span>未作答</span>' +
        '<span><span class="legend-dot is-current"></span>当前题</span>' +
        '<span><span class="legend-dot is-flag"></span>已标记</span>' +
      "</div>";
  }

  /* -------------------------------------------------------- 工作台 */
  EX.views["student.dashboard"] = function () {
    var s = currentStudent();
    var exams = catalog.studentExams(s.id);
    var ongoing = exams.filter(function (e) { return e.status === "ongoing"; })[0];
    var session = ongoing ? examSession(ongoing) : null;
    var paper = ongoing ? EX.engine.buildPaper(ongoing, s, plumCfg(ongoing), rosterIndex()) : null;
    var answered = paper ? countAnswered(paper, session) : 0;
    var records = allRecords();
    var avg = averageScore(records);
    var practices = catalog.studentPractices(s.id);
    var pendingPractice = practices.filter(function (p) {
      var res = store.state.practiceResults[practiceSessionKey(p.id)];
      return !res;
    }).length;
    var now = new Date();
    var weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()];

    var html =
      '<div class="page-head">' +
        "<div>" +
          '<h1 class="page-title">' + h.esc(greeting()) + "，" + h.esc(s.name) + "</h1>" +
          '<p class="page-sub">' + h.esc(s.className) + " · 编号 " + h.esc(s.id) + " · 今天 " +
            now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日 " + weekday + "</p>" +
        "</div>" +
        '<div class="page-actions">' +
          '<button class="btn" data-action="nav.go" data-key="student.exams">' + EX.icon("clipboard") + "考试安排</button>" +
          '<button class="btn btn-primary" data-action="nav.go" data-key="student.practice">' + EX.icon("book") + "去练习</button>" +
        "</div>" +
      "</div>" +
      '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
        statCard("待完成练习", pendingPractice, "项", "共 " + practices.length + " 个练习项目") +
        statCard("进行中考试", ongoing ? 1 : 0, "场", ongoing ? ongoing.name : "暂无安排") +
        statCard("学期平均分", fmt.pct(avg), "分", "按百分制折算，共 " + records.length + " 条记录") +
        statCard("待订正错题", myMistakes().length, "题", "来自 " + uniqueKnowledge() + " 个知识点") +
      "</div>" +
      '<div class="split">' +
        '<div class="stack">' +
          (ongoing ? ongoingCard(ongoing, session, paper, answered) : "") +
          practiceCard() +
          recentCard(records) +
        "</div>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><h2 class="card-title">成绩趋势</h2>' +
            '<span class="text-sm text-3">最近 ' + records.length + " 次</span></div>" +
            '<div class="card-body">' + trendChart(records) + "</div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">错题分布</h2>' +
            '<button class="btn btn-sm" data-action="nav.go" data-key="student.mistakes">去订正</button></div>' +
            '<div class="card-body">' + mistakeCard() + "</div></section>" +
        "</div>" +
      "</div>";

    return html;
  };

  function greeting() {
    var hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 12) return "早上好";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function statCard(label, value, unit, hint) {
    return '<div class="stat"><span class="stat-label">' + h.esc(label) + "</span>" +
      '<span class="stat-value">' + h.esc(String(value)) + (unit ? '<span class="unit">' + h.esc(unit) + "</span>" : "") + "</span>" +
      '<span class="stat-hint">' + h.esc(hint) + "</span></div>";
  }

  function ongoingCard(exam, session, paper, answered) {
    var mode = EX.engine.MODES[plumCfg(exam).mode];
    return '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">进行中的考试</h2>' +
        '<span class="badge badge-warn">' + h.esc(exam.status === "ongoing" ? "考试进行中" : exam.status) + "</span></div>" +
      '<div class="card-body">' +
        '<div class="row" style="align-items:flex-start">' +
          '<div class="list-main">' +
            '<div class="list-title">' + h.esc(exam.name) + "</div>" +
            '<div class="list-sub">' + h.esc(exam.batch || "—") + " · " + exam.durationMin + " 分钟 · 总分 " + exam.totalScore +
              " 分 · 开放时间 " + h.esc(exam.openAt) + " — " + h.esc(exam.closeAt) + "</div>" +
            '<div class="row-tight" style="margin-top:var(--sp-2)">' +
              '<span class="variant-tag">' + h.esc(mode.label) + "</span>" +
              '<span class="text-sm text-3">你的卷号 ' + h.esc(paper.variantLabel) + "</span>" +
              '<span class="text-sm text-3">已答 ' + answered + " / " + paper.items.length + "</span>" +
            "</div>" +
            '<div class="row-tight" style="margin-top:var(--sp-2)">' + tagChips(exam) + "</div>" +
          "</div>" +
          '<div class="spacer"></div>' +
          '<button class="btn btn-primary" data-action="nav.go" data-key="student.exam.session" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>' +
            (session.startedAt ? "继续考试" : "进入考试") + "</button>" +
        "</div>" +
        '<div class="callout" style="margin-top:var(--sp-4)">' +
          '<span class="callout-title">' + EX.icon("info") + " 考试须知</span>" +
          "<span>" + h.esc(exam.note) + " 本卷采用" + h.esc(mode.label) + "（" + h.esc(mode.short) + "）：" + h.esc(mode.desc) + "</span>" +
        "</div>" +
      "</div></section>";
  }

  function practiceCard() {
    var items = catalog.studentPractices(currentStudent().id).slice(0, 4).map(function (p) {
      var res = store.state.practiceResults[practiceSessionKey(p.id)];
      var total = studentQids(p).length;
      var done = res ? total : 0;
      var rate = res ? Math.round((res.score / res.total) * 100) : 0;
      return '<div class="list-row">' +
        '<div class="list-main">' +
          '<div class="list-title">' + h.esc(p.name) + "</div>" +
          '<div class="list-sub">' + total + " 题 · 约 " + p.durationMin + " 分钟" +
            (res ? " · 上次得分 " + fmt.score(res.score) + "/" + fmt.score(res.total) + "（" + rate + "%）" : " · 尚未开始") + "</div>" +
          '<div class="row-tight" style="margin-top:var(--sp-2)">' + tagChips(p) + "</div>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm" data-action="practice.start" data-id="' + h.esc(p.id) + '">' +
          (res ? "再练一次" : "开始练习") + "</button>" +
        "</div>";
    }).join("");
    return '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">推荐练习</h2>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.practice">全部练习</button></div>' +
      '<div class="card-body is-flush">' + items + "</div></section>";
  }

  function recentCard(records) {
    var rows = records.slice(-5).reverse().map(function (r) {
      return "<tr><td>" + h.esc(r.name) + "</td><td class=\"text-3\">" + h.esc(r.date) + "</td>" +
        '<td class="right num">' + fmt.score(r.score) + " / " + fmt.score(r.total) + "</td>" +
        '<td class="right"><span class="badge ' + (r.status === "done" ? "badge-ok" : "badge-warn") + '">' +
        (r.status === "done" ? "已完成" : "待阅") + "</span></td></tr>";
    }).join("");
    return '<section class="card"><div class="card-head"><h2 class="card-title">最近成绩</h2>' +
      '<button class="btn btn-sm" data-action="nav.go" data-key="student.reports">全部报告</button></div>' +
      '<div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
      "<thead><tr><th>项目</th><th>日期</th><th class=\"right\">得分</th><th class=\"right\">状态</th></tr></thead><tbody>" +
      rows + "</tbody></table></div></div></section>";
  }

  function allRecords() {
    var s = store.state;
    var sid = currentStudent().id;
    var map = {};
    var order = [];
    function put(key, rec) {
      if (!map[key]) order.push(key);
      map[key] = rec;
    }
    EX.seed.records.filter(function (r) {
      return !r.studentId || r.studentId === sid;
    }).forEach(function (r) {
      put(r.examId + ":" + (catalog.getExam(r.examId) ? "exam" : "practice"), {
        name: r.name, date: r.date, score: r.score, total: r.total, status: r.status,
        examId: r.examId, kind: catalog.getExam(r.examId) ? "exam" : "practice"
      });
    });
    Object.keys(s.attempts).forEach(function (k) {
      var at = s.attempts[k];
      if (at.studentId !== sid) return;
      var exam = catalog.getExam(at.examId);
      if (!exam) return;
      /* 列表与报告详情同源：实时重算分值与待阅状态，避免两处口径不一致 */
      var live = liveAttemptScore(exam, at, currentStudent());
      put(at.examId + ":exam", {
        name: exam.name,
        date: fmt.day(new Date(at.submittedAt)),
        score: live.score,
        total: live.total,
        status: live.pending ? "pending" : "done",
        examId: at.examId,
        kind: "exam"
      });
    });
    Object.keys(s.practiceResults).forEach(function (k) {
      if (k.slice(-(":" + sid).length) !== ":" + sid) return;
      var res = s.practiceResults[k];
      var pid = k.slice(0, k.length - (":" + sid).length);
      var practice = catalog.getPractice(pid);
      if (!practice) return;
      put(pid + ":practice", {
        name: practice.name,
        date: fmt.day(new Date(res.submittedAt)),
        score: res.score,
        total: res.total,
        status: "done",
        examId: pid,
        kind: "practice"
      });
    });
    return order.map(function (k) { return map[k]; });
  }

  function averageScore(records) {
    if (!records.length) return 0;
    var sum = 0;
    records.forEach(function (r) {
      sum += r.total ? (r.score / r.total) * 100 : 0;
    });
    return sum / records.length;
  }

  /* 错题按答题者隔离：切换答题者不会看到别人的错题 */
  function myMistakes() {
    var sid = currentStudent().id;
    return store.state.mistakes.filter(function (m) {
      return !m.studentId || m.studentId === sid;
    });
  }

  /* 错题覆盖的知识点数量：按「知识点」标签聚合，无知识点时回退到领域 */
  function uniqueKnowledge() {
    var set = {};
    myMistakes().forEach(function (m) {
      var q = catalog.getQuestion(m.qid);
      if (!q) return;
      var tag = knowledgeTag(q);
      set[tag ? tag.id : "unknown"] = 1;
    });
    return Object.keys(set).length;
  }

  function trendChart(records) {
    var data = records.slice(-6).map(function (r) {
      return { label: r.date.slice(5), value: Math.round((r.total ? (r.score / r.total) * 100 : 0)) };
    });
    if (!data.length) {
      return '<div class="empty"><span class="empty-title">暂无成绩记录</span>' +
        '<span class="empty-body">完成一次练习或考试后，这里会显示成绩变化曲线。</span></div>';
    }
    return EX.chart.line({ data: data, title: "成绩趋势折线图" });
  }

  /* 错题分布：按「知识点」标签聚合，无知识点时回退到领域标签 */
  function mistakeCard() {
    var groups = {};
    myMistakes().forEach(function (m) {
      var q = catalog.getQuestion(m.qid);
      if (!q) return;
      var tag = knowledgeTag(q);
      var key = tag ? tag.id : "unknown";
      if (!groups[key]) {
        groups[key] = {
          name: tag ? tag.name : "未归类",
          group: tag ? tag.group : "领域",
          count: 0
        };
      }
      groups[key].count += 1;
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.count - a.count; });
    if (!rows.length) {
      return '<div class="empty"><span class="empty-title">错题本是空的</span>' +
        '<span class="empty-body">做错的题目会自动收录到这里，方便反复订正。</span></div>';
    }
    var max = rows[0].count;
    return rows.map(function (r) {
      return '<div class="bar-row" style="margin-bottom:var(--sp-2)">' +
        '<span class="od-truncate">' + h.esc(r.name) + '<span class="text-3 text-xs"> · ' + h.esc(r.group) + "</span></span>" +
        '<span class="bar-track"><span class="bar-fill' + (r.count === max ? "" : " is-warn") + '" style="width:' + (r.count / max * 100) + '%"></span></span>' +
        '<span class="right num text-sm">' + r.count + " 题</span></div>";
    }).join("");
  }

  /* ------------------------------------------------------ 练习中心 */
  var practiceFilter = { tags: [], keyword: "" };

  EX.views["student.practice"] = function () {
    var keyword = practiceFilter.keyword;
    var selected = practiceFilter.tags;
    var list = catalog.studentPractices(currentStudent().id).filter(function (p) {
      if (!catalog.matchTags(p, selected)) return false;
      if (keyword) {
        var names = catalog.tagNames(p.tags).join(" ");
        if (p.name.indexOf(keyword) === -1 && names.indexOf(keyword) === -1) return false;
      }
      return true;
    });

    var cards = list.length ? list.map(function (p) {
      var res = store.state.practiceResults[practiceSessionKey(p.id)];
      var qids = studentQids(p);
      var total = qids.reduce(function (sum, qid) {
        var q = catalog.getQuestion(qid);
        return sum + (q ? q.score : 0);
      }, 0);
      var done = res ? qids.length : 0;
      var rate = res ? Math.round((res.score / res.total) * 100) : 0;
      var types = {};
      qids.forEach(function (qid) {
        var q = catalog.getQuestion(qid);
        if (q) types[q.type] = (types[q.type] || 0) + 1;
      });
      var typeText = Object.keys(types).map(function (t) { return EX.seed.typeLabel(t) + " " + types[t]; }).join(" · ");
      return '<div class="card"><div class="card-body">' +
        '<div class="row" style="align-items:flex-start">' +
          '<div class="list-main">' +
            '<div class="list-title">' + h.esc(p.name) + "</div>" +
            '<div class="list-sub">' + qids.length + " 题 · 约 " + p.durationMin + " 分钟 · 总分 " + fmt.score(total) + " 分</div>" +
            '<div class="list-sub">' + h.esc(typeText) + "</div>" +
            '<div class="row-tight" style="margin-top:var(--sp-2)">' + tagChips(p) + "</div>" +
          "</div>" +
          '<div class="spacer"></div>' +
          '<button class="btn btn-primary" data-action="practice.start" data-id="' + h.esc(p.id) + '">' +
            (res ? "再练一次" : "开始练习") + "</button>" +
        "</div>" +
        '<div class="meter" style="margin-top:var(--sp-3)"><i style="width:' + (res ? 100 : 0) + '%"></i></div>' +
        '<div class="row text-sm text-3" style="margin-top:var(--sp-2)">' +
          "<span>" + (res ? "已完成 " + done + "/" + qids.length + " 题" : "尚未开始") + "</span>" +
          "<span>·</span><span>" + (res ? "正确率 " + rate + "%" : "预计用时 " + p.durationMin + " 分钟") + "</span>" +
        "</div>" +
      "</div></div>";
    }).join("") : "";

    var html =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">练习中心</h1>' +
        '<p class="page-sub">以标签为组织轴的小规模练习：可同时勾选多个标签进行筛选，完成后立即给出解析与要点自评。</p>' +
      "</div></div>" +
      '<div class="card" style="margin-bottom:var(--sp-5)"><div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)">' +
          '<div class="field od-fill"><label class="field-label" for="prac-search">搜索练习</label>' +
          '<input class="input" id="prac-search" type="search" value="' + h.esc(practiceFilter.keyword) + '" placeholder="练习名称或标签" data-search="practice"></div>' +
          '<button class="btn" data-action="practice.filter.clear">清空筛选</button>' +
        "</div>" +
        '<div class="filter-block">' +
          '<span class="text-sm text-3 filter-group-label">按标签筛选</span>' +
          tagFilterHtml(selected, "practice.filter") +
        "</div>" +
      "</div></div>" +
      (list.length ? '<div class="grid-3">' + cards + "</div>" :
        '<div class="card"><div class="empty"><span class="empty-title">没有匹配的练习</span>' +
        '<span class="empty-body">换一个标签或清空筛选条件后再试一次。</span>' +
        '<button class="btn btn-sm" data-action="practice.filter.clear">查看全部练习</button></div></div>');

    return html;
  };

  /* ------------------------------------------------------ 练习会话 */
  EX.views["student.practice.session"] = function (params) {
    var qids;
    var sessionId;
    var title;
    if (params.qid) {
      qids = [params.qid];
      sessionId = "single-" + params.qid;
      title = "错题重做";
    } else {
      var practice = catalog.studentPractice(params.id, currentStudent().id);
      if (!practice) {
        return '<div class="card"><div class="empty"><span class="empty-title">练习不存在</span>' +
          '<span class="empty-body">该练习可能已被移除，请返回练习中心重新选择。</span>' +
          '<button class="btn btn-sm" data-action="nav.go" data-key="student.practice">返回练习中心</button></div></div>';
      }
      qids = studentQids(practice);
      sessionId = practice.id;
      title = practice.name;
    }

    var session = practiceSession(sessionId, qids);
    var exam = pseudoExam("practice-" + sessionId, qids, practiceOrderRule(sessionId));
    var paper = EX.engine.buildPaper(exam, currentStudent(), exam.plum, 0);
    var current = paper.items.filter(function (it) { return it.slot === session.current; })[0] || paper.items[0];
    session.current = current.slot;

    if (session.submitted && session.result) {
      return practiceResultView(session, paper, title);
    }

    var answered = countAnswered(paper, session);
    var html =
      '<div class="exam-bar">' +
        "<div>" +
          '<div class="exam-bar-title">' + h.esc(title) + "</div>" +
          '<div class="timer-note">第 ' + current.slot + " / " + paper.items.length + ' 题 · 已作答 <span class="answer-count" data-fmt="practice">' + answered + "</span> 题 · 练习不计时、不影响考试成绩</div>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<button class="btn" data-action="practice.flag" data-qid="' + h.esc(current.qid) + '">' + EX.icon("flag") + "标记</button>" +
        '<button class="btn btn-primary" data-action="practice.submit" data-id="' + h.esc(sessionId) + '">提交练习</button>' +
      "</div>" +
      '<div class="split">' +
        '<section class="card"><div class="card-body">' +
          questionHead(current) +
          '<div class="q-stem">' + stemHtml(current.question) + "</div>" +
          questionBody(current, session.responses[current.qid]) +
          '<div data-feedback-qid="' + h.esc(current.qid) + '">' + immediateFeedbackHtml(session, current) + "</div>" +
          '<hr class="divider">' +
          '<div class="row">' +
            '<button class="btn" data-action="practice.goto" data-slot="' + (current.slot - 1) + '"' + (current.slot === 1 ? " disabled" : "") + ">" +
              EX.icon("chevronLeft") + "上一题</button>" +
            '<div class="spacer"></div>' +
            '<span class="text-sm text-3">按 ' + h.esc(current.question.type === "multi" ? "Ctrl/⌘ 可多选" : "选择一项") + "</span>" +
            '<button class="btn" data-action="practice.goto" data-slot="' + (current.slot + 1) + '"' +
              (current.slot === paper.items.length ? " disabled" : "") + '>下一题' + EX.icon("chevronRight") + "</button>" +
          "</div>" +
        "</div></section>" +
        '<aside class="card"><div class="card-head"><h2 class="card-title">题号</h2></div>' +
          '<div class="card-body">' + sheetHtml(paper.items, session, "practice") + "</div></aside>" +
      "</div>";

    return html;
  };

  /* ------------------------------------------------- 即时反馈（每题作答后） */
  /** 单题判分：复用引擎的客观题 / 主观题判分口径 */
  function gradeOne(item, resp) {
    var q = item.question;
    var r = resp || {};
    var max = (item.score === undefined || item.score === null) ? undefined : Number(item.score);
    if (q.type === "single" || q.type === "multi" || q.type === "judge") {
      var originalPicked = (r.choice || []).map(function (k) { return item.toOriginal[k] || k; });
      var res = EX.engine.gradeObjective(q, originalPicked, max);
      return {
        score: res.score,
        max: res.max,
        status: res.status,
        correct: res.correct,
        pickedOriginal: originalPicked
      };
    }
    if (q.type === "short") {
      var sres = EX.engine.gradeShort(q, r.text, max);
      return {
        score: sres.score,
        max: sres.max,
        status: sres.answered ? "pending" : "blank",
        points: sres.points
      };
    }
    var cres = EX.engine.gradeComprehensive(q, r.steps, max);
    return {
      score: cres.score,
      max: cres.max,
      status: cres.steps.some(function (s) { return s.answered; }) ? "pending" : "blank",
      steps: cres.steps
    };
  }

  /** 正确答案的可读文本（原始选项键） */
  function correctText(question) {
    if (!question) return "";
    if (question.type === "single" || question.type === "multi") {
      var keys = question.answer || [];
      return (Array.isArray(keys) ? keys : [keys]).map(function (k) {
        var opt = (question.options || []).filter(function (o) { return o.key === k; })[0];
        return k + (opt ? "．" + opt.text : "");
      }).join("；");
    }
    if (question.type === "judge") {
      var jk = (Array.isArray(question.answer) ? question.answer[0] : question.answer) || "";
      if (jk === "A" || jk === "T" || jk === "正确" || jk === true) return "正确";
      if (jk === "B" || jk === "F" || jk === "错误" || jk === false) return "错误";
      return String(jk);
    }
    return question.reference || question.analysis || "";
  }

  /** 即时反馈区块：练习设置为「每题作答后立即反馈」时展示 */
  function immediateFeedbackHtml(session, item) {
    var rule = practiceRule(session);
    if (rule.feedback !== "immediate") return "";
    var resp = session.responses[item.qid];
    if (!resp || !isAnswered(item, resp)) return "";
    var res = gradeOne(item, resp);
    var q = item.question;
    var tone = "info";
    var label = "已记录，等待阅卷";
    if (res.status === "correct") { tone = "ok"; label = "回答正确"; }
    else if (res.status === "partial") { tone = "warn"; label = "部分正确"; }
    else if (res.status === "wrong") { tone = "danger"; label = "回答错误"; }
    else if (res.status === "blank") { tone = "warn"; label = "尚未作答"; }

    var rows = "";
    if (q.type === "single" || q.type === "multi" || q.type === "judge") {
      var pickedKeys = res.pickedOriginal || [];
      var picked = q.type === "judge"
        ? (pickedKeys.length ? (pickedKeys[0] === "A" ? "正确" : "错误") : "未选择")
        : (pickedKeys.join("、") || "未选择");
      rows += '<div class="kv" style="margin-top:var(--sp-2)">' +
        "<dt>你的答案</dt><dd>" + h.esc(picked) + "</dd>" +
        "<dt>正确答案</dt><dd>" + h.esc(correctText(q)) + "</dd>" +
        "<dt>得分</dt><dd>" + fmt.score(res.score) + " / " + fmt.score(res.max) + "</dd></div>";
    } else {
      rows += '<div class="kv" style="margin-top:var(--sp-2)">' +
        "<dt>作答要点</dt><dd>" + (res.points ? pointsHtml(res.points) : "已提交") + "</dd>" +
        "<dt>参考答案</dt><dd>" + h.esc(correctText(q) || "由阅卷人评定") + "</dd></div>";
    }
    var analysis = q.analysis ? '<div class="analysis" style="margin-top:var(--sp-2)">' + h.esc(q.analysis) + "</div>" : "";
    return '<div class="callout is-' + tone + '" role="status">' +
      '<span class="callout-title">' + EX.icon(tone === "ok" ? "check" : "info") + " " + h.esc(label) + "</span>" +
      rows + analysis + "</div>";
  }

  /** 作答后就地刷新即时反馈块，避免整页重绘导致输入框失焦 */
  function refreshImmediateFeedback(session, qid) {
    var box = doc.querySelector('[data-feedback-qid="' + qid + '"]');
    if (!box) return;
    var paper = sessionPaper(session);
    if (!paper) return;
    var item = null;
    for (var i = 0; i < paper.items.length; i += 1) {
      if (paper.items[i].qid === qid) { item = paper.items[i]; break; }
    }
    if (!item) return;
    box.innerHTML = immediateFeedbackHtml(session, item);
  }

  function practiceResultView(session, paper, title) {    var res = session.result;
    var rate = res.total ? Math.round((res.score / res.total) * 100) : 0;
    var detailHtml = res.details.map(function (d) {
      return '<div class="list-row" style="align-items:flex-start;display:grid;grid-template-columns:64px minmax(0,1fr);gap:var(--sp-4)">' +
        "<div>" + practiceStatus(d) + '<div class="text-xs text-3 num">' + fmt.score(d.score) + "/" + fmt.score(d.max) + "</div></div>" +
        '<div class="list-main">' +
          '<div class="list-title" style="font-weight:500;font-size:var(--fs-base)">' + h.esc(d.question.stem) + "</div>" +
          '<div class="list-sub">' + h.esc(EX.seed.typeLabel(d.type)) + "</div>" +
          '<div class="row-tight" style="margin-top:6px">' + tagChips(d.question) + "</div>" +
          answerSummary(d) +
          (d.points ? pointsHtml(d.points) : "") +
          (d.steps ? stepsResultHtml(d.steps) : "") +
          '<details style="margin-top:var(--sp-2)"><summary class="text-sm" style="cursor:pointer">查看解析</summary>' +
            '<div class="analysis" style="margin-top:var(--sp-2)">' + h.esc(d.question.analysis || d.question.reference || "暂无解析") + "</div></details>" +
        "</div></div>";
    }).join("");

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">' + h.esc(title) + "</h1>" +
        '<p class="page-sub">提交于 ' + h.esc(fmt.dateTime(session.submittedAt)) + " · 用时 " + fmt.clock(session.elapsedSec) + "</p>" +
      "</div>" +
      '<div class="page-actions"><button class="btn" data-action="nav.go" data-key="student.practice">返回练习中心</button>' +
        '<button class="btn btn-primary" data-action="practice.redo" data-id="' + h.esc(session.id) + '">重新练习</button></div></div>' +
      '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
        statCard("本次得分", fmt.score(res.score), "分", "总分 " + fmt.score(res.total) + " 分") +
        statCard("得分率", rate, "%", res.details.filter(function (d) { return d.status === "correct"; }).length + " 题完全正确") +
        statCard("待订正", res.details.filter(function (d) { return d.status !== "correct"; }).length, "题", "含部分正确与错误") +
        statCard("覆盖知识点", uniqueInPaper(paper), "个", "按试卷题目统计") +
      "</div>" +
      '<section class="card"><div class="card-head"><h2 class="card-title">逐题解析</h2>' +
        '<span class="text-sm text-3">共 ' + res.details.length + " 题</span></div>" +
        '<div class="card-body is-flush">' + detailHtml + "</div></section>";
  }

  /* 覆盖的知识点数量（按知识点标签去重，无知识点时回退领域） */
  function uniqueInPaper(paper) {
    var set = {};
    paper.items.forEach(function (it) {
      var tag = knowledgeTag(it.question);
      set[tag ? tag.id : "unknown"] = 1;
    });
    return Object.keys(set).length;
  }

  function statusBadge(status) {
    var map = {
      correct: '<span class="badge badge-ok">正确</span>',
      partial: '<span class="badge badge-warn">部分正确</span>',
      wrong: '<span class="badge badge-danger">错误</span>',
      blank: '<span class="badge badge-neutral">未作答</span>',
      pending: '<span class="badge badge-info">待阅</span>',
      auto: '<span class="badge badge-info">待阅</span>'
    };
    return map[status] || '<span class="badge badge-neutral">' + h.esc(status) + "</span>";
  }

  function answerSummary(d) {
    var q = d.question;
    if (q.type === "single" || q.type === "multi" || q.type === "judge") {
      var picked = (d.pickedDisplay || []).join("、") || "未作答";
      var correct = d.correct.map(function (k) { return d.fromOriginal ? d.fromOriginal[k] : k; }).join("、");
      return '<div class="list-sub">你的作答：<span class="strong">' + h.esc(picked) + "</span> · 正确答案：" +
        '<span class="strong">' + h.esc(correct) + "</span></div>";
    }
    if (q.type === "short") {
      return '<div class="list-sub">你的作答：<span class="strong">' + h.esc(d.answerText || "未作答") + "</span></div>";
    }
    if (q.type === "comprehensive" && d.steps) {
      var lines = d.steps.map(function (st) {
        return st.prompt + "：" + (st.answer && st.answer.trim() ? st.answer : "未作答");
      });
      return '<div class="list-sub">你的作答：<span class="strong">' + h.esc(lines.join(" ／ ")) + "</span></div>";
    }
    return "";
  }

  function pointsHtml(points) {
    return '<div class="kp-list" style="margin-top:var(--sp-2)">' + points.map(function (p) {
      return '<div class="kp' + (p.hit ? " is-hit" : "") + '">' +
        '<span class="kp-mark">' + (p.hit ? "✓" : "○") + "</span>" +
        "<span>" + h.esc(p.text) + "</span>" +
        '<span class="num text-3">' + fmt.score(p.score) + "/" + fmt.score(p.max) + "</span></div>";
    }).join("") + "</div>";
  }

  function stepsResultHtml(steps) {
    return '<div class="kp-list" style="margin-top:var(--sp-2)">' + steps.map(function (s) {
      return '<div class="kp' + (s.hit ? " is-hit" : "") + '">' +
        '<span class="kp-mark">' + (s.hit ? "✓" : "○") + "</span>" +
        "<span>" + h.esc(s.prompt) + "</span>" +
        '<span class="num text-3">' + fmt.score(s.score) + "/" + fmt.score(s.max) + "</span></div>";
    }).join("") + "</div>";
  }

  /* ------------------------------------------------------ 考试安排 */
  var examFilter = { tags: [], keyword: "" };

  EX.views["student.exams"] = function () {
    var selected = examFilter.tags;
    var keyword = examFilter.keyword;
    var exams = catalog.studentExams(currentStudent().id).filter(function (exam) {
      if (!catalog.matchTags(exam, selected)) return false;
      if (keyword) {
        var names = catalog.tagNames(exam.tags).join(" ");
        if (exam.name.indexOf(keyword) === -1 && (exam.batch || "").indexOf(keyword) === -1 && names.indexOf(keyword) === -1) return false;
      }
      return true;
    });

    var rows = exams.map(function (exam) {
      var session = store.state.examSessions[examSessionKey(exam.id)];
      var submitted = session && session.submitted;
      var attempt = store.state.attempts[exam.id + ":" + store.state.studentId];
      var mode = EX.engine.MODES[plumCfg(exam).mode];
      var action;
      if (submitted || attempt) {
        action = '<button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>查看报告</button>';
        if (exam.allowRetake) {
          action += ' <button class="btn btn-sm" data-action="exam.retake" data-id="' + h.esc(exam.id) + '">再考一次</button>';
        }
      } else if (exam.status === "ongoing") {
        action = '<button class="btn btn-sm btn-primary" data-action="nav.go" data-key="student.exam.session" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>进入考试</button>';
      } else if (exam.status === "ended" && exam.allowRetake) {
        /* 已结束但允许重考的考试：仍提供补考入口，否则重考功能整体不可达 */
        action = '<button class="btn btn-sm btn-primary" data-action="nav.go" data-key="student.exam.session" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>进入考试</button>' +
          ' <button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>回顾试卷</button>';
      } else {
        action = '<button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>回顾试卷</button>';
      }
      var statusText = submitted ? "已交卷" : exam.status === "ongoing" ? "进行中" : "已结束";
      var statusCls = submitted ? "badge-ok" : exam.status === "ongoing" ? "badge-warn" : "badge-neutral";
      if (submitted && exam.allowRetake) {
        statusText = "已交卷 · 可重考";
        statusCls = "badge-info";
      } else if (!submitted && exam.status === "ended" && exam.allowRetake) {
        statusText = "已结束 · 可补考";
        statusCls = "badge-info";
      }
      return "<tr>" +
        "<td><div class=\"strong\">" + h.esc(exam.name) + "</div><div class=\"text-xs text-3\">" + h.esc(exam.batch || "—") + "</div></td>" +
        "<td>" + tagChips(exam) + "</td>" +
        '<td class="num">' + exam.durationMin + " 分钟</td>" +
        '<td class="num">' + exam.totalScore + " 分</td>" +
        '<td><span class="variant-tag">' + h.esc(mode.label) + "</span></td>" +
        '<td class="text-3 text-sm">' + h.esc(exam.openAt) + "</td>" +
        '<td><span class="badge ' + statusCls + '">' + statusText + "</span></td>" +
        '<td class="col-actions">' + action + "</td></tr>";
    }).join("");

    var html =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">考试安排</h1>' +
        '<p class="page-sub">试卷按卷型生成：标准卷全体答题者同一份卷面（题序按题型分块、组内由易到难）；小梅花题序统一、仅每位答题者的选项顺序打乱；大梅花保留题型分块顺序（单选→多选→判断→简答→综合），每个题型内部的题目顺序与选项顺序均为每位答题者独立打乱。</p>' +
      "</div></div>" +
      '<div class="card" style="margin-bottom:var(--sp-4)"><div class="card-body">' +
        '<div class="row" style="margin-bottom:var(--sp-3)">' +
          '<div class="field od-fill"><label class="field-label" for="exam-search">搜索考试</label>' +
          '<input class="input" id="exam-search" type="search" value="' + h.esc(examFilter.keyword) + '" placeholder="考试名称、批次或标签" data-search="exam"></div>' +
          '<button class="btn" data-action="exam.filter.clear">清空筛选</button>' +
        "</div>" +
        '<div class="filter-block">' +
          '<span class="text-sm text-3 filter-group-label">按标签筛选</span>' +
          tagFilterHtml(selected, "exam.filter") +
        "</div>" +
      "</div></div>" +
      '<section class="card"><div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
      "<thead><tr><th>试卷</th><th>标签</th><th>时长</th><th>总分</th><th>卷型</th><th>开放时间</th><th>状态</th><th></th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div></div></section>" +
      '<section class="card" style="margin-top:var(--sp-5)"><div class="card-head"><h2 class="card-title">考试规则</h2></div>' +
        '<div class="card-body"><ul class="rule-list">' +
        "<li><span class=\"rule-dot\">1</span><span>考试开始后计时，中途离开计时不中断；倒计时归零后系统自动交卷。</span></li>" +
        "<li><span class=\"rule-dot\">2</span><span>客观题（单选、多选、判断）交卷后自动判分；主观题（简答、综合操作题）由管理端复核后计入成绩。</span></li>" +
        "<li><span class=\"rule-dot\">3</span><span>可随时标记题目，交卷前可在答题卡中快速跳转检查。</span></li>" +
        "<li><span class=\"rule-dot\">4</span><span>多选题" + EX.engine.MULTI_POLICY + "</span></li>" +
        "</ul></div></section>";

    return html;
  };


  /* ------------------------------------------------------ 考试会话 */
  EX.views["student.exam.session"] = function (params) {
    var exam = catalog.studentExam(params.id, currentStudent().id);
    if (!exam) {
      return '<div class="card"><div class="empty"><span class="empty-title">考试不存在</span>' +
        '<span class="empty-body">该考试可能尚未发布，或不在你的名单范围内。</span>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.exams">返回考试安排</button></div></div>';
    }

    var session = examSession(exam);
    var paper = EX.engine.buildPaper(exam, currentStudent(), plumCfg(exam), rosterIndex());

    if (session.submitted) {
      return '<div class="card"><div class="empty"><span class="empty-title">本场考试已交卷</span>' +
        '<span class="empty-body">交卷时间 ' + h.esc(fmt.dateTime(session.submittedAt)) + "，可前往成绩报告查看详情。" +
        (exam.allowRetake ? "本场考试允许重考，成绩按最高分计入。" : "") + "</span>" +
        '<div class="row-tight" style="justify-content:center">' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>查看成绩报告</button>' +
        (exam.allowRetake
          ? '<button class="btn btn-sm btn-primary" data-action="exam.retake" data-id="' + h.esc(exam.id) + '">重新作答</button>'
          : "") +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.exams">返回考试安排</button>' +
        "</div></div></div>";
    }

    /* 已结束且不允许重考的考试不可开考，避免通过直接跳转绕过考试窗口 */
    if (exam.status === "ended" && !exam.allowRetake) {
      return '<div class="card"><div class="empty"><span class="empty-title">考试已结束</span>' +
        '<span class="empty-body">本场考试已关闭作答入口，可前往成绩报告回顾试卷与解析。</span>' +
        '<div class="row-tight" style="justify-content:center">' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(exam.id) + '"}\'>回顾试卷</button>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.exams">返回考试安排</button>' +
        "</div></div></div>";
    }

    /* 倒计时以绝对截止时间为准：离开页面、后台标签页节流都不会改变剩余时长 */
    if (!session.startedAt) {
      session.startedAt = new Date().toISOString();
      session.deadlineAt = Date.now() + exam.durationMin * 60 * 1000;
      store.save();
    } else if (!session.deadlineAt) {
      session.deadlineAt = Date.now() + Math.max(0, session.remainingSec) * 1000;
      store.save();
    }
    session.remainingSec = Math.max(0, Math.ceil((session.deadlineAt - Date.now()) / 1000));
    if (session.remainingSec <= 0) {
      submitExam(exam, true);
      return '<div class="card"><div class="empty"><span class="empty-title">考试时间已到</span>' +
        '<span class="empty-body">系统已自动交卷，正在生成成绩报告。</span></div></div>';
    }
    ensureClock();

    var current = paper.items.filter(function (it) { return it.slot === session.current; })[0] || paper.items[0];
    session.current = current.slot;
    var answered = countAnswered(paper, session);
    var mode = EX.engine.MODES[plumCfg(exam).mode];

    var html =
      '<div class="exam-bar">' +
        "<div>" +
          '<div class="exam-bar-title">' + h.esc(exam.name) + "</div>" +
          '<div class="timer-note">' + h.esc(mode.label) + " · 卷号 " + h.esc(paper.variantLabel) + ' · 已答 <span class="answer-count" data-fmt="exam">' + answered + "</span>/" + paper.items.length + " 题</div>" +
        "</div>" +
        '<div class="spacer"></div>' +
        '<div class="right"><div class="timer' + (session.remainingSec <= 300 ? " is-warn" : "") + '" id="exam-timer">' + fmt.clock(session.remainingSec) + "</div>" +
          '<div class="timer-note">剩余时间</div></div>' +
        '<button class="btn" data-action="exam.flag" data-qid="' + h.esc(current.qid) + '">' + EX.icon("flag") +
          (session.flags[current.qid] ? "取消标记" : "标记") + "</button>" +
        '<button class="btn btn-primary" data-action="exam.submit.open">交卷</button>' +
      "</div>" +
      '<div class="split">' +
        '<section class="card"><div class="card-body">' +
          questionHead(current) +
          '<div class="q-stem">' + stemHtml(current.question) + "</div>" +
          questionBody(current, session.responses[current.qid]) +
          '<hr class="divider">' +
          '<div class="row">' +
            '<button class="btn" data-action="exam.goto" data-slot="' + (current.slot - 1) + '"' + (current.slot === 1 ? " disabled" : "") + ">" +
              EX.icon("chevronLeft") + "上一题</button>" +
            '<div class="spacer"></div>' +
            '<span class="text-sm text-3">答案自动保存</span>' +
            '<button class="btn" data-action="exam.goto" data-slot="' + (current.slot + 1) + '"' +
              (current.slot === paper.items.length ? " disabled" : "") + '>下一题' + EX.icon("chevronRight") + "</button>" +
          "</div>" +
        "</div></section>" +
        '<aside class="stack">' +
          '<section class="card"><div class="card-head"><h2 class="card-title">答题卡</h2>' +
            '<span class="text-sm text-3 answer-count" data-fmt="exam">' + answered + "/" + paper.items.length + "</span></div>" +
            '<div class="card-body">' + sheetHtml(paper.items, session, "exam") + "</div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">考试须知</h2></div><div class="card-body">' +
            '<ul class="rule-list">' +
            "<li><span class=\"rule-dot\">·</span><span>" + h.esc(exam.note) + "</span></li>" +
            "<li><span class=\"rule-dot\">·</span><span>本页作答即时保存，关闭浏览器不会丢失。</span></li>" +
            "<li><span class=\"rule-dot\">·</span><span>交卷前请在答题卡确认未答题目的数量。</span></li>" +
            "</ul></div></section>" +
        "</aside>" +
      "</div>";

    return { html: html };
  };

  /* ---------------------------------------------------------- 倒计时时钟 */
  /* 时钟不挂在视图上：离开考试页后继续走表，归零时自动交卷。 */
  var clockId = null;

  function activeExamClockSession() {
    var s = store.state;
    var sid = s.studentId;
    var route = EX.router.current ? EX.router.current() : null;
    var routeExamId = route && route.key === "student.exam.session" ? ((route.params || {}).id || "") : "";
    var fallback = null;
    Object.keys(s.examSessions).forEach(function (k) {
      var sess = s.examSessions[k];
      if (!sess || sess.submitted || !sess.deadlineAt) return;
      if (sess.studentId && sess.studentId !== sid) return;
      if (routeExamId && sess.examId === routeExamId) { fallback = sess; return; }
      if (!fallback || sess.deadlineAt > fallback.deadlineAt) fallback = sess;
    });
    return fallback;
  }

  function tickClock() {
    var sess = activeExamClockSession();
    if (!sess) {
      global.clearInterval(clockId);
      clockId = null;
      return;
    }
    var remain = Math.max(0, Math.ceil((sess.deadlineAt - Date.now()) / 1000));
    sess.remainingSec = remain;
    var el = doc.getElementById("exam-timer");
    if (el) {
      el.textContent = fmt.clock(remain);
      if (remain <= 300) el.classList.add("is-warn");
      else el.classList.remove("is-warn");
    }
    if (remain <= 0) {
      global.clearInterval(clockId);
      clockId = null;
      var exam = catalog.getExam(sess.examId);
      if (exam) submitExam(exam, true);
      return;
    }
    if (remain % 15 === 0) store.save();
  }

  function ensureClock() {
    if (clockId !== null) return;
    clockId = global.setInterval(tickClock, 1000);
  }

  function submitExam(exam, auto) {
    var session = store.state.examSessions[examSessionKey(exam.id)];
    if (!session || session.submitted) return;
    var s = currentStudent();
    var paper = EX.engine.buildPaper(exam, s, plumCfg(exam), rosterIndex());
    var graded = EX.engine.scorePaper(paper, session.responses);
    session.submitted = true;
    session.submittedAt = new Date().toISOString();

    var subjectiveDetails = graded.details.filter(function (d) { return d.status === "pending"; });
    var attemptKey = exam.id + ":" + s.id;
    var prev = store.state.attempts[attemptKey];
    var attemptNo = (prev ? prev.attempts || 1 : 0) + 1;
    var newScore = graded.objective.score;
    if (!prev || newScore >= prev.score) {
      /* 允许重考时按最高分保留：只有本次更高才覆盖成绩明细 */
      store.state.attempts[attemptKey] = {
        examId: exam.id,
        studentId: s.id,
        submittedAt: session.submittedAt,
        responses: JSON.parse(JSON.stringify(session.responses)),
        score: newScore,
        total: graded.totalMax,
        pendingSubjective: subjectiveDetails.length > 0,
        variantLabel: paper.variantLabel,
        attemptNo: attemptNo,
        attempts: attemptNo
      };
    } else if (prev) {
      prev.attempts = attemptNo;
      prev.attemptNo = attemptNo;
    }

    /* 主观题进入管理端阅卷队列（写入共享内容仓库）；
       卷宗编号带上作答次序，重考不会串号；综合题按步骤拆分，阅卷人能看到每一步的作答。 */
    subjectiveDetails.forEach(function (d, i) {
      if (d.type === "comprehensive" && d.steps && d.steps.length) {
        d.steps.forEach(function (st, j) {
          catalog.addReview({
            id: "rv-live-" + exam.id + "-" + s.id + "-a" + attemptNo + "-" + d.qid + "-" + st.id + "-" + j,
            examId: exam.id,
            studentId: s.id,
            qid: d.qid,
            stepId: st.id,
            attempt: attemptNo,
            answerText: st.answer || "",
            submittedAt: session.submittedAt,
            status: "pending",
            teacherScore: null,
            comment: ""
          });
        });
        return;
      }
      catalog.addReview({
        id: "rv-live-" + exam.id + "-" + s.id + "-a" + attemptNo + "-" + d.qid + "-q-" + i,
        examId: exam.id,
        studentId: s.id,
        qid: d.qid,
        stepId: null,
        attempt: attemptNo,
        answerText: d.answerText || "",
        submittedAt: session.submittedAt,
        status: "pending",
        teacherScore: null,
        comment: ""
      });
    });

    store.save();
    EX.refreshShell();
    EX.toast(auto ? "考试时间到，已自动交卷" : "已交卷，正在生成成绩报告", "ok");
    EX.router.go("student.report", { id: exam.id });
  }

  /* ------------------------------------------------------ 成绩报告 */
  EX.views["student.reports"] = function () {
    var records = allRecords().slice().reverse();
    var rows = records.map(function (r) {
      var rate = r.total ? Math.round((r.score / r.total) * 100) : 0;
      return "<tr>" +
        "<td><div class=\"strong\">" + h.esc(r.name) + "</div></td>" +
        '<td class="text-3">' + h.esc(r.date) + "</td>" +
        '<td class="num">' + fmt.score(r.score) + " / " + fmt.score(r.total) + "</td>" +
        '<td class="num">' + rate + "%</td>" +
        '<td><span class="badge ' + (r.status === "done" ? "badge-ok" : "badge-warn") + '">' +
          (r.status === "done" ? "已完成" : "待阅") + "</span></td>" +
        '<td class="col-actions">' + (r.kind === "practice"
          ? '<button class="btn btn-sm" data-action="nav.go" data-key="student.practice.session" data-params=\'{"id":"' + h.esc(r.examId) + '"}\'>查看</button>'
          : '<button class="btn btn-sm" data-action="nav.go" data-key="student.report" data-params=\'{"id":"' + h.esc(r.examId) + '"}\'>查看</button>') + "</td></tr>";
    }).join("");

    var html = '<div class="page-head"><div>' +
        '<h1 class="page-title">成绩报告</h1>' +
        '<p class="page-sub">客观题自动判分，主观题需阅卷人复核后计入最终成绩。</p>' +
      "</div></div>";
    if (!records.length) {
      return html + '<div class="card"><div class="empty"><span class="empty-title">暂无成绩记录</span>' +
        '<span class="empty-body">完成一次练习或考试后，成绩、得分率与逐题解析会汇总到这里。</span>' +
        '<div class="row-tight" style="justify-content:center">' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.practice">去练习</button>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.exams">看考试</button>' +
        "</div></div></div>";
    }
    return html +
      '<section class="card"><div class="card-body is-flush"><div class="table-wrap"><table class="table">' +
      "<thead><tr><th>项目</th><th>日期</th><th>得分</th><th>得分率</th><th>状态</th><th></th></tr></thead><tbody>" +
      rows + "</tbody></table></div></div></section>";
  };

  EX.views["student.report"] = function (params) {
    var exam = catalog.getExam(params.id);
    if (!exam) {
      return '<div class="card"><div class="empty"><span class="empty-title">报告不存在</span>' +
        '<span class="empty-body">请返回成绩报告列表重新选择。</span>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.reports">返回列表</button></div></div>';
    }
    var s = currentStudent();
    var attempt = store.state.attempts[exam.id + ":" + s.id];
    var record = EX.seed.records.filter(function (r) { return r.examId === exam.id; })[0];
    var mode = EX.engine.MODES[plumCfg(exam).mode];

    var summaryHtml;
    var detailHtml = "";

    if (attempt) {
      var paper = EX.engine.buildPaper(exam, s, plumCfg(exam), rosterIndex());
      var graded = EX.engine.scorePaper(paper, attempt.responses);
      applyTeacherScores(graded, exam, s, attempt.attemptNo || attempt.attempts || 1);
      var pending = graded.details.filter(function (d) { return d.status === "pending"; }).length;
      var typeScores = groupByType(graded.details);
      var totalMax = graded.totalMax;

      summaryHtml =
        '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
          statCard("客观题得分", fmt.score(graded.objective.score), "分", "满分 " + fmt.score(graded.objective.max) + " 分，自动判分") +
          statCard("主观题得分", fmt.score(graded.subjective.score), "分", "满分 " + fmt.score(graded.subjective.max) + " 分" + (pending ? "，" + pending + " 题待阅" : "，已复核")) +
          statCard("当前总分", fmt.score(graded.total), "分", "满分 " + fmt.score(totalMax) + " 分") +
          statCard("交卷时间", fmt.time(new Date(attempt.submittedAt)), "", "卷号 " + h.esc(attempt.variantLabel || mode.label)) +
        "</div>" +
        '<section class="card" style="margin-bottom:var(--sp-5)"><div class="card-head"><h2 class="card-title">题型得分</h2></div>' +
          '<div class="card-body">' + typeScores.map(function (t) {
            var pct = t.max ? Math.round((t.score / t.max) * 100) : 0;
            return '<div class="bar-row" style="margin-bottom:var(--sp-2)">' +
              "<span>" + h.esc(t.label) + "</span>" +
              '<span class="bar-track"><span class="bar-fill' + (pct >= 80 ? "" : pct >= 60 ? " is-warn" : " is-danger") +
              '" style="width:' + pct + '%"></span></span>' +
              '<span class="right num text-sm">' + fmt.score(t.score) + "/" + fmt.score(t.max) + "</span></div>";
          }).join("") + "</div></section>";

      detailHtml = '<section class="card"><div class="card-head"><h2 class="card-title">逐题明细</h2>' +
        '<span class="text-sm text-3">共 ' + graded.details.length + " 题</span></div>" +
        '<div class="card-body is-flush">' + graded.details.map(function (d) {
          return '<div class="list-row" style="display:grid;grid-template-columns:78px minmax(0,1fr);gap:var(--sp-4);align-items:flex-start">' +
            "<div>" + statusBadge(d.status) + '<div class="text-xs text-3 num" style="margin-top:4px">' + fmt.score(d.score) + "/" + fmt.score(d.max) + "</div></div>" +
            '<div class="list-main">' +
              '<div class="list-title" style="font-weight:500;font-size:var(--fs-base)">' + h.esc(d.question.stem) + "</div>" +
              '<div class="list-sub">第 ' + d.slot + " 题 · " + h.esc(EX.seed.typeLabel(d.type)) + "</div>" +
              '<div class="row-tight" style="margin-top:6px">' + tagChips(d.question) + "</div>" +
              answerSummary(d) +
              (d.points ? pointsHtml(d.points) : "") +
              (d.steps ? stepsResultHtml(d.steps) : "") +
              '<details style="margin-top:var(--sp-2)"><summary class="text-sm" style="cursor:pointer">查看解析</summary>' +
                '<div class="analysis" style="margin-top:var(--sp-2)">' + h.esc(d.question.analysis || d.question.reference || "暂无解析") + "</div></details>" +
            "</div></div>";
        }).join("") + "</div></section>";
    } else if (record) {
      var rate = Math.round((record.score / record.total) * 100);
      summaryHtml = '<div class="stat-row" style="margin-bottom:var(--sp-5)">' +
        statCard("本卷得分", fmt.score(record.score), "分", "满分 " + fmt.score(record.total) + " 分") +
        statCard("得分率", rate, "%", "成绩已发布") +
        statCard("考试日期", record.date, "", h.esc(exam.batch || "—")) +
        statCard("卷型", mode.label, "", h.esc(mode.short)) +
        "</div>";
      detailHtml = '<section class="card"><div class="card-head"><h2 class="card-title">试卷回顾</h2></div>' +
        '<div class="card-body"><p class="section-note" style="margin-bottom:var(--sp-3)">本场为已结束的考试，此处提供题目与解析回顾，不含个人逐题作答记录。</p>' +
        catalog.itemsOf(exam).map(function (it, i) {
          var q = catalog.getQuestion(it.qid);
          if (!q) return "";
          return '<div class="list-row" style="display:grid;grid-template-columns:64px minmax(0,1fr);gap:var(--sp-4);align-items:flex-start">' +
            '<div class="q-index">第 ' + (i + 1) + " 题</div>" +
            '<div class="list-main">' +
              '<div class="list-title" style="font-weight:500;font-size:var(--fs-base)">' + h.esc(q.stem) + "</div>" +
              '<div class="list-sub">' + h.esc(EX.seed.typeLabel(q.type)) + " · " + (Number(it.score) || 0) + " 分</div>" +
              '<div class="row-tight" style="margin-top:6px">' + tagChips(q) + "</div>" +
              (q.options ? '<div class="list-sub">选项：' + q.options.map(function (o) { return o.key + ". " + h.esc(o.text); }).join("　") + "</div>" : "") +
              '<details style="margin-top:var(--sp-2)"><summary class="text-sm" style="cursor:pointer">查看答案与解析</summary>' +
                '<div class="analysis" style="margin-top:var(--sp-2)">答案：' + h.esc((q.answer || []).join("、")) +
                (q.reference ? "<br>参考答案：" + h.esc(q.reference) : "") +
                (q.analysis ? "<br>解析：" + h.esc(q.analysis) : "") + "</div></details>" +
            "</div></div>";
        }).join("") + "</div></section>";
    } else {
      summaryHtml = '<div class="card"><div class="empty"><span class="empty-title">暂未参加该考试</span>' +
        '<span class="empty-body">本场考试未开放给当前答题者，或尚未生成成绩。</span></div></div>';
    }

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">' + h.esc(exam.name) + "</h1>" +
        '<p class="page-sub">' + h.esc(exam.batch || "—") + " · 卷型：" + h.esc(mode.label) +
          "（" + h.esc(mode.short) + "） · " + h.esc(s.name) + " " + h.esc(s.id) + "</p>" +
        '<div class="row-tight" style="margin-top:var(--sp-2)">' + tagChips(exam) + "</div>" +
      "</div>" +
      '<div class="page-actions"><button class="btn" data-action="nav.go" data-key="student.reports">返回报告列表</button></div>' +
      "</div>" + summaryHtml + detailHtml;
  };

  function applyTeacherScores(graded, exam, s, attemptNo) {
    var allReviews = catalog.reviews();
    var want = attemptNo === undefined || attemptNo === null ? 1 : Number(attemptNo);
    graded.details.forEach(function (d) {
      if (d.type !== "short" && d.type !== "comprehensive") return;
      var reviews = allReviews.filter(function (r) {
        if (r.examId !== exam.id || r.studentId !== s.id || r.qid !== d.qid) return false;
        if (r.status !== "reviewed" || r.teacherScore === null || r.teacherScore === undefined) return false;
        /* 阅卷记录按作答次序归属：只取本次作答的批阅结果 */
        var ra = r.attempt === undefined || r.attempt === null ? 1 : Number(r.attempt);
        return ra === want;
      });
      if (!reviews.length) return;
      var manual = reviews.reduce(function (sum, r) { return sum + (r.teacherScore || 0); }, 0);
      if (d.type === "comprehensive" && reviews.some(function (r) { return r.stepId; })) {
        reviews.forEach(function (r) {
          var step = d.steps.filter(function (st) { return st.id === r.stepId; })[0];
          if (step) {
            step.score = r.teacherScore || 0;
            step.hit = (r.teacherScore || 0) > 0;
          }
        });
        d.score = EX.engine.round2(d.steps.reduce(function (sum, st) { return sum + st.score; }, 0));
        /* 还有步骤未阅卷时整题仍记为待阅：成绩列表不提前显示「已完成」 */
        var allStepsReviewed = d.steps.every(function (st) {
          return reviews.some(function (r) { return r.stepId === st.id; });
        });
        d.status = allStepsReviewed
          ? (d.score >= d.max ? "correct" : d.score > 0 ? "partial" : "wrong")
          : "pending";
      } else if (reviews.length) {
        d.score = EX.engine.round2(manual);
        d.status = d.score >= d.max ? "correct" : d.score > 0 ? "partial" : "wrong";
      } else {
        d.score = 0;
        d.status = "pending";
      }
    });
    var objective = graded.objective.score;
    var subjective = graded.details.reduce(function (sum, d) {
      return sum + (d.type === "short" || d.type === "comprehensive" ? d.score : 0);
    }, 0);
    graded.subjective.score = EX.engine.round2(subjective);
    graded.total = EX.engine.round2(objective + subjective);
  }

  /* 实时重算一次作答的分值与待阅状态：列表、报告详情与概览共用同一口径 */
  function liveAttemptScore(exam, attempt, s) {
    try {
      var paper = EX.engine.buildPaper(exam, s, plumCfg(exam), rosterIndex());
      var graded = EX.engine.scorePaper(paper, attempt.responses || {});
      applyTeacherScores(graded, exam, s, attempt.attemptNo || attempt.attempts || 1);
      var pending = graded.details.some(function (d) { return d.status === "pending"; });
      return { score: graded.total, total: graded.totalMax, pending: pending };
    } catch (e) {
      return {
        score: Number(attempt.score) || 0,
        total: Number(attempt.total) || 0,
        pending: !!attempt.pendingSubjective
      };
    }
  }

  function groupByType(details) {
    var map = {};
    details.forEach(function (d) {
      if (!map[d.type]) map[d.type] = { type: d.type, label: EX.seed.typeLabel(d.type), score: 0, max: 0 };
      map[d.type].score = EX.engine.round2(map[d.type].score + d.score);
      map[d.type].max = EX.engine.round2(map[d.type].max + d.max);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* -------------------------------------------------------- 错题本 */
  EX.views["student.mistakes"] = function () {
    var rows = myMistakes().map(function (m) {
      var q = catalog.getQuestion(m.qid);
      if (!q) return "";
      return '<div class="list-row" style="display:grid;grid-template-columns:minmax(0,1fr) 96px 120px 96px;gap:var(--sp-4);align-items:center">' +
        '<div class="list-main">' +
          '<div class="list-title" style="font-weight:500;font-size:var(--fs-base)">' + h.esc(q.stem) + "</div>" +
          '<div class="list-sub">' + h.esc(EX.seed.typeLabel(q.type)) + "</div>" +
          '<div class="row-tight" style="margin-top:6px">' + tagChips(q) + "</div>" +
          '<div class="list-sub">错因：' + h.esc(m.reason) + "</div>" +
        "</div>" +
        '<div class="text-sm text-3">错 ' + m.wrongCount + " 次</div>" +
        '<div class="text-sm text-3">' + h.esc(m.lastWrongAt) + "</div>" +
        '<div class="right"><button class="btn btn-sm" data-action="mistake.redo" data-qid="' + h.esc(q.id) + '">重做</button></div>' +
        "</div>";
    }).join("");

    var html = '<div class="page-head"><div>' +
        '<h1 class="page-title">错题本</h1>' +
        '<p class="page-sub">做错的题目自动收录，可单题重做；重做后可查看要点命中情况。</p>' +
      "</div></div>";
    if (!rows) {
      html += '<div class="card"><div class="empty"><span class="empty-title">错题本是空的</span>' +
        '<span class="empty-body">完成练习后，答错的题目会自动出现在这里。</span>' +
        '<button class="btn btn-sm" data-action="nav.go" data-key="student.practice">去练习</button></div></div>';
    } else {
      html += '<section class="card"><div class="card-body is-flush">' + rows + "</div></section>";
    }
    return html;
  };

  /* ------------------------------------------------------ 个人中心 */
  EX.views["student.profile"] = function () {
    var s = currentStudent();
    var options = EX.seed.students.map(function (st) {
      return '<option value="' + h.esc(st.id) + '"' + (st.id === s.id ? " selected" : "") + ">" +
        h.esc(st.name + "（" + st.id + " · " + st.className + "）") + "</option>";
    }).join("");

    return '<div class="page-head"><div>' +
        '<h1 class="page-title">个人中心</h1>' +
        '<p class="page-sub">账号信息、界面偏好与本地数据管理。</p>' +
      "</div></div>" +
      '<div class="split">' +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><h2 class="card-title">账号信息</h2></div><div class="card-body">' +
            '<dl class="kv">' +
              "<dt>姓名</dt><dd>" + h.esc(s.name) + "</dd>" +
              "<dt>编号</dt><dd class=\"mono\">" + h.esc(s.id) + "</dd>" +
              "<dt>名单组</dt><dd>" + h.esc(s.className) + "</dd>" +
              "<dt>加入年份</dt><dd class=\"num\">" + s.enrollYear + "</dd>" +
            "</dl></div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">演示：切换答题者</h2></div><div class="card-body">' +
            '<div class="field"><label class="field-label" for="stu-switch">当前答题者</label>' +
            '<div class="select-wrap"><select class="select" id="stu-switch" data-change="student.switch">' + options + "</select></div>" +
            '<span class="field-hint">原型演示用：切换后可查看不同答题者拿到的卷面差异——标准卷完全一致；小梅花选项顺序不同、题序一致；大梅花题型分块顺序一致、组内题序与选项顺序均不同。</span></div>' +
          "</div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">本地数据</h2></div><div class="card-body">' +
            '<p class="section-note" style="margin-bottom:var(--sp-3)">作答记录、练习结果与阅卷进度保存在本机浏览器中。清除后将恢复为初始示例数据。</p>' +
            '<button class="btn btn-danger" data-action="profile.clear">清除本地数据</button>' +
          "</div></section>" +
        "</div>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><h2 class="card-title">界面偏好</h2></div><div class="card-body">' +
            '<div class="field"><span class="field-label">主题</span>' +
              '<div class="seg" role="group" aria-label="主题">' +
                '<button type="button" data-action="profile.theme" data-theme="light" aria-pressed="' + (store.state.theme === "light" ? "true" : "false") + '">浅色</button>' +
                '<button type="button" data-action="profile.theme" data-theme="dark" aria-pressed="' + (store.state.theme === "dark" ? "true" : "false") + '">深色</button>' +
              "</div>" +
              '<span class="field-hint">深色主题使用独立取色，保证正文对比度不低于 4.5:1。</span>' +
            "</div></div></section>" +
          '<section class="card"><div class="card-head"><h2 class="card-title">考试须知</h2></div><div class="card-body">' +
            '<ul class="rule-list">' +
            "<li><span class=\"rule-dot\">1</span><span>客观题交卷后自动判分，主观题由阅卷人复核。</span></li>" +
            "<li><span class=\"rule-dot\">2</span><span>多选题" + EX.engine.MULTI_POLICY + "</span></li>" +
            "<li><span class=\"rule-dot\">3</span><span>考试期间可标记题目，交卷前用答题卡逐一核对。</span></li>" +
            "</ul></div></section>" +
        "</div>" +
      "</div>";
  };

  /* ------------------------------------------------------------ 动作 */
  EX.actions["nav.go"] = function (el) {
    var key = el.getAttribute("data-key");
    var raw = el.getAttribute("data-params");
    var params = {};
    if (raw) {
      try { params = JSON.parse(raw); } catch (e) { params = {}; }
    }
    EX.router.go(key, params);
  };

  EX.actions["practice.filter"] = function (el) {
    var id = el.getAttribute("data-tag");
    if (!id) return;
    var idx = practiceFilter.tags.indexOf(id);
    if (idx === -1) practiceFilter.tags.push(id);
    else practiceFilter.tags.splice(idx, 1);
    EX.router.refresh();
  };

  EX.actions["practice.filter.clear"] = function () {
    practiceFilter.tags = [];
    practiceFilter.keyword = "";
    EX.router.refresh();
  };

  EX.actions["exam.filter"] = function (el) {
    var id = el.getAttribute("data-tag");
    if (!id) return;
    var idx = examFilter.tags.indexOf(id);
    if (idx === -1) examFilter.tags.push(id);
    else examFilter.tags.splice(idx, 1);
    EX.router.refresh();
  };

  EX.actions["exam.filter.clear"] = function () {
    examFilter.tags = [];
    examFilter.keyword = "";
    EX.router.refresh();
  };

  EX.actions["practice.start"] = function (el) {
    var id = el.getAttribute("data-id");
    var practice = catalog.studentPractice(id, currentStudent().id);
    if (!practice) {
      EX.toast("该练习不在你的开放范围内，或已被移除", "error");
      return;
    }
    EX.router.go("student.practice.session", { id: id });
  };

  EX.actions["practice.goto"] = function (el) {
    var slot = parseInt(el.getAttribute("data-slot"), 10);
    if (!slot || slot < 1) return;
    var session = currentPracticeSession();
    if (!session) return;
    session.current = slot;
    store.save();
    EX.router.refresh();
  };

  EX.actions["practice.flag"] = function (el) {
    var qid = el.getAttribute("data-qid");
    var session = currentPracticeSession();
    if (!session) return;
    if (session.flags[qid]) delete session.flags[qid];
    else session.flags[qid] = true;
    store.save();
    EX.router.refresh();
  };

  EX.actions["practice.submit"] = function () {
    var session = currentPracticeSession();
    if (!session) return;
    var rule = practiceRule(session);
    if (rule.repeats > 0 && (session.attempts || 0) >= rule.repeats) {
      EX.toast("「" + rule.name + "」最多提交 " + rule.repeats + " 次，已用完", "error");
      return;
    }
    var paper = EX.engine.buildPaper(pseudoExam("practice-" + session.id, session.qids, practiceOrderRule(session.id)), currentStudent(),
      { mode: "standard" }, 0);
    var graded = EX.engine.scorePaper(paper, session.responses);
    session.submitted = true;
    session.submittedAt = new Date().toISOString();
    session.result = graded;
    session.attempts = (session.attempts || 0) + 1;
    session.elapsedSec = session.elapsedSec || 0;
    store.state.practiceResults[practiceSessionKey(session.id)] = {
      score: graded.total,
      total: graded.totalMax,
      attempts: session.attempts,
      submittedAt: session.submittedAt
    };
    recordMistakes(graded, session, rule);
    store.save();
    EX.toast("练习已提交", "ok");
    EX.router.refresh();
  };

  /* ------------------------------------------------- 会话定位与作答写入 */
  function currentPracticeSession() {
    var route = EX.router.current();
    if (!route || route.key !== "student.practice.session") return null;
    var params = route.params || {};
    var id = params.id || (params.qid ? "single-" + params.qid : "");
    if (!id) return null;
    return store.state.practiceSessions[practiceSessionKey(id)] || null;
  }

  function currentExamSession() {
    var route = EX.router.current();
    if (!route || route.key !== "student.exam.session") return null;
    var exam = catalog.studentExam((route.params || {}).id, currentStudent().id);
    if (!exam) return null;
    return store.state.examSessions[examSessionKey(exam.id)] || null;
  }

  function activeSession() {
    return currentPracticeSession() || currentExamSession();
  }

  function sessionPaper(session) {
    if (!session) return null;
    if (session.qids) {
      var ex = pseudoExam("practice-" + session.id, session.qids, practiceOrderRule(session.id));
      return EX.engine.buildPaper(ex, currentStudent(), ex.plum, 0);
    }
    var exam = catalog.studentExam(session.examId, currentStudent().id);
    if (!exam) return null;
    return EX.engine.buildPaper(exam, currentStudent(), plumCfg(exam), rosterIndex());
  }

  /** 作答写入后只做局部更新，避免整页重绘导致输入框失焦 */
  function updateSessionUI(session) {
    var paper = sessionPaper(session);
    if (!paper) return;
    var answered = countAnswered(paper, session);
    var cells = doc.querySelectorAll(".sheet-cell[data-qid]");
    Array.prototype.forEach.call(cells, function (cell) {
      var id = cell.getAttribute("data-qid");
      var item = null;
      for (var i = 0; i < paper.items.length; i++) {
        if (paper.items[i].qid === id) { item = paper.items[i]; break; }
      }
      if (!item) return;
      cell.classList.toggle("is-answered", isAnswered(item, session.responses[id]));
    });
    var counters = doc.querySelectorAll(".answer-count");
    Array.prototype.forEach.call(counters, function (c) {
      var f = c.getAttribute("data-fmt");
      c.textContent = f === "exam" ? answered + "/" + paper.items.length : String(answered);
    });
  }

  function handleChoice(el) {
    var session = activeSession();
    if (!session) return;
    var qid = el.getAttribute("data-qid");
    var letter = el.getAttribute("data-letter");
    var multi = el.getAttribute("data-choice") === "multi";
    var resp = session.responses[qid];
    if (!resp) { resp = session.responses[qid] = {}; }
    var picked = resp.choice ? resp.choice.slice() : [];
    if (multi) {
      var i = picked.indexOf(letter);
      if (i === -1) picked.push(letter); else picked.splice(i, 1);
      picked.sort();
    } else {
      picked = [letter];
    }
    resp.choice = picked;
    store.save();

    var inputs = doc.querySelectorAll('input[data-choice][data-qid="' + qid + '"]');
    Array.prototype.forEach.call(inputs, function (input) {
      var l = input.getAttribute("data-letter");
      var on = picked.indexOf(l) !== -1;
      input.checked = on;
      var lab = input.closest ? input.closest(".opt") : null;
      if (lab) lab.classList.toggle("is-selected", on);
    });
    updateSessionUI(session);
    refreshImmediateFeedback(session, qid);
  }

  function saveTextAnswer(el) {
    var session = activeSession();
    if (!session) return;
    var qid = el.getAttribute("data-text-answer");
    var resp = session.responses[qid];
    if (!resp) { resp = session.responses[qid] = {}; }
    resp.text = el.value;
    store.save();
    updateSessionUI(session);
    refreshImmediateFeedback(session, qid);
  }

  function saveStepAnswer(el) {
    var session = activeSession();
    if (!session) return;
    var qid = el.getAttribute("data-qid");
    var stepId = el.getAttribute("data-step-answer");
    var resp = session.responses[qid];
    if (!resp) { resp = session.responses[qid] = {}; }
    if (!resp.steps) resp.steps = {};
    resp.steps[stepId] = el.value;
    store.save();
    updateSessionUI(session);
    refreshImmediateFeedback(session, qid);
  }

  function practiceStatus(d) {
    if (d.type === "short" || d.type === "comprehensive") {
      if (d.status === "blank") return statusBadge("blank");
      if (d.score >= d.max) return statusBadge("correct");
      if (d.score > 0) return statusBadge("partial");
      return statusBadge("wrong");
    }
    return statusBadge(d.status);
  }

  /* ------------------------------------------------------------ 动作 */
  EX.actions["practice.redo"] = function (el) {
    var id = el.getAttribute("data-id");
    var key = practiceSessionKey(id);
    var session = store.state.practiceSessions[key];
    if (!session) return;
    var rule = practiceRule(session);
    if (rule.repeats > 0 && (session.attempts || 0) >= rule.repeats) {
      EX.toast("「" + rule.name + "」最多提交 " + rule.repeats + " 次，已用完", "error");
      return;
    }
    session.responses = {};
    session.flags = {};
    session.current = 1;
    session.startedAt = null;
    session.elapsedSec = 0;
    session.submitted = false;
    session.submittedAt = null;
    session.result = null;
    delete store.state.practiceResults[key];
    store.save();
    EX.toast("已重置练习，可以重新作答");
    EX.router.refresh();
  };

  EX.actions["exam.goto"] = function (el) {
    var slot = parseInt(el.getAttribute("data-slot"), 10);
    if (!slot || slot < 1) return;
    var session = currentExamSession();
    if (!session) return;
    session.current = slot;
    store.save();
    EX.router.refresh();
  };

  /** 重考：试卷允许重考时重置作答，历史成绩按最高分保留 */
  EX.actions["exam.retake"] = function (el) {
    var id = el.getAttribute("data-id");
    var exam = catalog.studentExam(id, currentStudent().id);
    if (!exam) {
      EX.toast("该考试不存在或不在你的名单范围内", "error");
      return;
    }
    if (!exam.allowRetake) {
      EX.toast("该试卷不允许重考", "error");
      return;
    }
    var key = examSessionKey(exam.id);
    var session = store.state.examSessions[key];
    if (!session) {
      EX.router.go("student.exam.session", { id: exam.id });
      return;
    }
    session.responses = {};
    session.flags = {};
    session.current = 1;
    session.startedAt = null;
    session.deadlineAt = null;
    session.remainingSec = exam.durationMin * 60;
    session.submitted = false;
    session.submittedAt = null;
    store.save();
    EX.toast("已开启重考，成绩按最高分计入", "ok");
    EX.router.go("student.exam.session", { id: exam.id });
  };

  EX.actions["exam.flag"] = function (el) {    var qid = el.getAttribute("data-qid");
    var session = currentExamSession();
    if (!session) return;
    if (session.flags[qid]) delete session.flags[qid];
    else session.flags[qid] = true;
    store.save();
    EX.router.refresh();
  };

  EX.actions["exam.submit.open"] = function () {
    var route = EX.router.current();
    var exam = catalog.studentExam(((route && route.params) || {}).id, currentStudent().id);
    if (!exam) return;
    var session = currentExamSession();
    if (!session) return;
    var paper = sessionPaper(session);
    var answered = countAnswered(paper, session);
    var blank = paper.items.length - answered;
    var body = doc.getElementById("submit-body");
    if (body) {
      body.innerHTML =
        '<div class="kv">' +
          "<dt>试卷</dt><dd>" + h.esc(exam.name) + "</dd>" +
          "<dt>卷型</dt><dd>" + h.esc(EX.engine.MODES[plumCfg(exam).mode].label) + " · " + h.esc(paper.variantLabel) + "</dd>" +
          "<dt>已作答</dt><dd>" + answered + " / " + paper.items.length + " 题</dd>" +
          "<dt>未作答</dt><dd>" + blank + " 题</dd>" +
          "<dt>剩余时间</dt><dd>" + fmt.clock(session.remainingSec) + "</dd>" +
        "</div>" +
        (blank > 0
          ? '<div class="callout is-warn" style="margin-top:var(--sp-4)"><span class="callout-title">' +
            EX.icon("alert") + "仍有 " + blank + " 题未作答</span><span>交卷后未作答题目按 0 分计，客观题立即判分，主观题进入阅卷队列。</span></div>"
          : '<div class="callout" style="margin-top:var(--sp-4)"><span class="callout-title">' +
            EX.icon("check") + "全部题目已作答</span><span>确认交卷后本次作答不可再修改。</span></div>");
    }
    EX.openDialog("dlg-submit");
  };

  EX.actions["exam.submit.confirm"] = function () {
    EX.closeDialog("dlg-submit");
    var route = EX.router.current();
    var exam = catalog.studentExam(((route && route.params) || {}).id, currentStudent().id);
    if (!exam) return;
    submitExam(exam, false);
  };

  EX.actions["mistake.redo"] = function (el) {
    var qid = el.getAttribute("data-qid");
    if (!qid) return;
    EX.router.go("student.practice.session", { qid: qid });
  };

  EX.actions["profile.theme"] = function (el) {
    var theme = el.getAttribute("data-theme");
    if (!theme || theme === store.state.theme) return;
    store.state.theme = theme;
    store.save();
    doc.documentElement.dataset.theme = theme;
    EX.refreshShell();
    EX.router.refresh();
  };

  EX.actions["profile.clear"] = function () {
    EX.confirm({
      title: "清除本地数据",
      message: "将清除本机保存的全部作答记录、练习结果与阅卷进度，并恢复为初始示例数据。此操作不可撤销。",
      okText: "确认清除",
      onConfirm: function () {
        store.reset();
        doc.documentElement.dataset.theme = store.state.theme;
        EX.refreshShell();
        EX.router.go("student.dashboard", {});
        EX.toast("本地数据已清除");
      }
    });
  };

  EX.actions["student.switch"] = function (el) {
    var id = el.getAttribute("data-value") || el.value;
    if (!id || id === store.state.studentId) return;
    store.state.studentId = id;
    store.save();
    EX.refreshShell();
    EX.router.refresh();
    EX.toast("已切换为 " + (EX.seed.getStudent(id) || {}).name);
  };

  /* ---------------------------------------------------------- 表单委托 */
  doc.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    if (el.hasAttribute("data-choice")) { handleChoice(el); return; }
    if (el.hasAttribute("data-change")) {
      var name = el.getAttribute("data-change");
      if (name === "student.switch") EX.actions["student.switch"](el);
    }
  });

  var searchTimer = null;
  doc.addEventListener("input", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    if (el.hasAttribute("data-text-answer")) { saveTextAnswer(el); return; }
    if (el.hasAttribute("data-step-answer")) { saveStepAnswer(el); return; }
    if (el.hasAttribute("data-search")) {
      var scope = el.getAttribute("data-search");
      if (scope !== "practice" && scope !== "exam") return;
      if (searchTimer) global.clearTimeout(searchTimer);
      searchTimer = global.setTimeout(function () {
        if (scope === "practice") practiceFilter.keyword = el.value;
        else examFilter.keyword = el.value;
        EX.router.refresh();
        var box = doc.querySelector('[data-search="' + scope + '"]');
        if (box) {
          box.focus();
          if (box.setSelectionRange) box.setSelectionRange(box.value.length, box.value.length);
        }
      }, 180);
    }
  });

  /* -------------------------------------------------------- 导出辅助 */
  EX.student = {
    currentStudent: currentStudent,
    rosterIndex: rosterIndex,
    plumCfg: plumCfg,
    sessionPaper: sessionPaper
  };
})(window);
