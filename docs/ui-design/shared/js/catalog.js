/* ==========================================================================
   知行测评 · 共享内容仓库
   题库 / 标签 / 题目 / 试卷 / 练习 / 阅卷队列的唯一数据源。
   管理端写入、答题端读取；读取失败时静默回退到示例数据。
   题目状态机：draft（草稿）→ published（已发布）→ disabled（已停用）。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = (global.EX = global.EX || {});

  var STORAGE_KEY = "zhixing.catalog.v1";
  /* 跨页面同步标记：与正文分键存放，便于在 storage 事件中判断共享仓库是否被更新 */
  var REV_KEY = "zhixing.catalog.rev";
  var SCHEMA_VERSION = 4;
  var MAX_TAGS = (EX.seed && EX.seed.MAX_TAGS) || 5;
  var TAG_GROUPS = (EX.seed && EX.seed.TAG_GROUPS) || ["领域", "知识点", "能力", "难度"];
  var STATUS_LABEL = (EX.seed && EX.seed.STATUS_LABEL) || { draft: "草稿", published: "已发布", disabled: "已停用" };
  var SOURCE_LABEL = { manual: "手工录入", import: "批量导入", ai: "AI 生成" };

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      return value;
    }
  }

  /**
   * 置换种子：按试卷标识自动派生（FNV-1a）。
   * 使用者无需输入，也不应对结果有控制权——同一试卷重复出卷得到同一批卷面。
   */
  function autoSeed(examId) {
    var id = String(examId || "SEED");
    var h = 2166136261 >>> 0;
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return "AUTO-" + (h >>> 0).toString(36).toUpperCase();
  }

  function defaults() {
    var seed = EX.seed;
    return {
      schema: SCHEMA_VERSION,
      rev: 0,
      tags: clone(seed.TAGS),
      questions: clone(seed.questions),
      banks: clone(seed.banks),
      exams: clone(seed.exams),
      practices: clone(seed.practices),
      reviews: clone(seed.buildReviewQueue()),
      imports: clone(seed.imports || []),
      generations: clone(seed.generations || []),
      paperTemplates: clone(seed.paperTemplates || []),
      plumCfg: {}
    };
  }

  var state = defaults();
  var storageOk = true;
  /* 本页已知的共享仓库原始快照：用于跨页面读取前的一致性校验 */
  var rawSnapshot = null;

  /* --------------------------------------------------------------- 持久化 */
  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return false;
      if (parsed.schema !== SCHEMA_VERSION) {
        global.localStorage.removeItem(STORAGE_KEY);
        rawSnapshot = null;
        return false;
      }
      var base = defaults();
      Object.keys(base).forEach(function (k) {
        if (parsed[k] !== undefined && parsed[k] !== null) base[k] = parsed[k];
      });
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(base).forEach(function (k) { state[k] = base[k]; });
      rawSnapshot = raw;
      currentStamp = remoteStamp();
      return true;
    } catch (e) {
      storageOk = false;
      var fresh = defaults();
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(fresh).forEach(function (k) { state[k] = fresh[k]; });
      rawSnapshot = null;
      currentStamp = "";
      return false;
    }
  }

  /* 跨页面同步用的版本标记：任意一次写入都会变化 */
  var currentStamp = "";

  function newStamp() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* 本页已知的共享仓库版本 */
  function stamp() { return currentStamp; }

  /* localStorage 中共享仓库的最新版本（可能来自另一个页面） */
  function remoteStamp() {
    try { return global.localStorage.getItem(REV_KEY) || ""; } catch (e) { return ""; }
  }

  function save() {
    try {
      state.rev = (Number(state.rev) || 0) + 1;
      currentStamp = newStamp();
      var raw = JSON.stringify(state);
      global.localStorage.setItem(STORAGE_KEY, raw);
      rawSnapshot = raw;
      try { global.localStorage.setItem(REV_KEY, currentStamp); } catch (e2) { /* 忽略 */ }
      storageOk = true;
      return true;
    } catch (e) {
      storageOk = false;
      return false;
    }
  }

  /* 重新读取共享仓库：用于跨页面（管理端 / 答题端）同步 */
  function reload() {
    var ok = load();
    return { changed: ok, rev: currentStamp };
  }

  /* 读取前的一致性校验：若另一个页面改写了共享仓库，本页立即读取最新内容。
     依据内容快照判断，因此即使外部只写入正文键（未更新版本键）也能被感知。 */
  function ensureFresh() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw || raw === rawSnapshot) return false;
      return load();
    } catch (e) {
      return false;
    }
  }

  function reset() {
    var fresh = defaults();
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.keys(fresh).forEach(function (k) { state[k] = fresh[k]; });
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
    currentStamp = newStamp();
    try { global.localStorage.setItem(REV_KEY, currentStamp); } catch (e) { /* 忽略 */ }
    return state;
  }

  /* --------------------------------------------------------------- 读取器 */
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /* 每次读取前先确认共享仓库未被其他页面改写 */
  function getTag(id) { ensureFresh(); return byId(state.tags, id); }
  function getQuestion(id) { ensureFresh(); return byId(state.questions, id); }
  function getBank(id) { ensureFresh(); return byId(state.banks, id); }
  function getExam(id) { ensureFresh(); return byId(state.exams, id); }
  function getPractice(id) { ensureFresh(); return byId(state.practices, id); }
  function getImport(id) { ensureFresh(); return byId(state.imports, id); }
  function getGeneration(id) { ensureFresh(); return byId(state.generations, id); }
  function getPaperTemplate(id) { ensureFresh(); return byId(state.paperTemplates, id); }

  function tagName(id) {
    var t = getTag(id);
    return t ? t.name : "";
  }

  function tagNames(ids) {
    return (ids || []).map(tagName).filter(Boolean);
  }

  function tagGroups() { return TAG_GROUPS.slice(); }

  function tagsOfGroup(group) {
    return state.tags.filter(function (t) { return t.group === group; });
  }

  /* 主体标签：优先取「领域」，其次「知识点」，用于列表主标识 */
  function primaryTagId(entity) {
    var ids = (entity && entity.tags) || [];
    for (var i = 0; i < ids.length; i++) {
      var t = getTag(ids[i]);
      if (t && t.group === "领域") return t.id;
    }
    for (var j = 0; j < ids.length; j++) {
      var t2 = getTag(ids[j]);
      if (t2 && t2.group === "知识点") return t2.id;
    }
    return ids[0] || "";
  }

  function primaryTagName(entity) {
    return tagName(primaryTagId(entity));
  }

  /* 难度等级：取「难度」分组标签的 level，缺省为 2（中等） */
  function difficultyOf(entity) {
    var ids = (entity && entity.tags) || [];
    for (var i = 0; i < ids.length; i++) {
      var t = getTag(ids[i]);
      if (t && t.group === "难度") return t.level || 2;
    }
    return 2;
  }

  var DIFFICULTY_LABEL = { 1: "基础", 2: "中等", 3: "较难" };
  var DIFFICULTY_LEVEL_MAP = { "基础": 1, "中等": 2, "较难": 3 };
  function difficultyLabel(entity) {
    return DIFFICULTY_LABEL[difficultyOf(entity)] || DIFFICULTY_LABEL[2];
  }

  /* 引用计数：标签在各类对象中的挂载次数 */
  function usageOf(tagId) {
    var usage = { questions: 0, banks: 0, exams: 0, practices: 0, total: 0 };
    usage.questions = countTags(state.questions, tagId);
    usage.banks = countTags(state.banks, tagId);
    usage.exams = countTags(state.exams, tagId);
    usage.practices = countTags(state.practices, tagId);
    usage.total = usage.questions + usage.banks + usage.exams + usage.practices;
    return usage;
  }

  function countTags(list, tagId) {
    var n = 0;
    (list || []).forEach(function (item) {
      if ((item.tags || []).indexOf(tagId) !== -1) n += 1;
    });
    return n;
  }

  /* 标签命中的对象筛选：任一命中即算匹配 */
  function matchTags(entity, ids) {
    if (!ids || !ids.length) return true;
    var own = entity.tags || [];
    for (var i = 0; i < ids.length; i++) {
      if (own.indexOf(ids[i]) !== -1) return true;
    }
    return false;
  }

  /* --------------------------------------------------------- 标签写入校验 */
  function validateTags(ids) {
    var list = (ids || []).filter(function (id) { return !!id; });
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i]]) return { ok: false, message: "标签不可重复选择" };
      seen[list[i]] = true;
      if (!getTag(list[i])) return { ok: false, message: "存在无效标签，请重新选择" };
    }
    if (list.length > MAX_TAGS) {
      return { ok: false, message: "最多只能选择 " + MAX_TAGS + " 个标签，当前已选 " + list.length + " 个" };
    }
    return { ok: true, ids: list };
  }

  function nextId(prefix) {
    var n = 1;
    var taken = {};
    state.tags.forEach(function (t) { taken[t.id] = true; });
    while (taken[prefix + n]) n += 1;
    return prefix + n;
  }

  /* ------------------------------------------------------------- 标签 CRUD */
  function createTag(input) {
    var name = String((input && input.name) || "").trim();
    var group = String((input && input.group) || TAG_GROUPS[0]);
    if (!name) return { ok: false, message: "请填写标签名称" };
    if (TAG_GROUPS.indexOf(group) === -1) return { ok: false, message: "请选择有效的标签分组" };
    var dup = state.tags.some(function (t) { return t.name === name && t.group === group; });
    if (dup) return { ok: false, message: "同一分组内已存在同名标签" };
    var tag = { id: nextId("t-user-"), name: name, group: group };
    if (group === "难度") tag.level = DIFFICULTY_LEVEL_MAP[name] || 2;
    state.tags.push(tag);
    save();
    return { ok: true, tag: tag };
  }

  function updateTag(id, patch) {
    var tag = getTag(id);
    if (!tag) return { ok: false, message: "标签不存在" };
    var name = patch && patch.name !== undefined ? String(patch.name).trim() : tag.name;
    var group = patch && patch.group !== undefined ? String(patch.group) : tag.group;
    if (!name) return { ok: false, message: "请填写标签名称" };
    if (TAG_GROUPS.indexOf(group) === -1) return { ok: false, message: "请选择有效的标签分组" };
    var dup = state.tags.some(function (t) { return t.id !== id && t.name === name && t.group === group; });
    if (dup) return { ok: false, message: "同一分组内已存在同名标签" };
    tag.name = name;
    tag.group = group;
    if (group === "难度") {
      tag.level = DIFFICULTY_LEVEL_MAP[name] || 2;
    } else {
      delete tag.level;
    }
    save();
    return { ok: true, tag: tag };
  }

  /* 删除标签并级联解除所有对象的挂载 */
  function removeTag(id) {
    var tag = getTag(id);
    if (!tag) return { ok: false, message: "标签不存在" };
    var usage = usageOf(id);
    state.tags = state.tags.filter(function (t) { return t.id !== id; });
    function detach(list) {
      (list || []).forEach(function (item) {
        if ((item.tags || []).indexOf(id) !== -1) {
          item.tags = item.tags.filter(function (x) { return x !== id; });
        }
      });
    }
    detach(state.questions);
    detach(state.banks);
    detach(state.exams);
    detach(state.practices);
    save();
    return { ok: true, usage: usage, tag: tag };
  }

  /* ------------------------------------------------------------ 题库 CRUD */
  function upsertBank(input) {
    var id = input && input.id;
    var name = String((input && input.name) || "").trim();
    if (!name) return { ok: false, message: "请填写题库名称" };
    var check = validateTags(input.tags);
    if (!check.ok) return check;
    var bank = id ? getBank(id) : null;
    if (!bank) {
      bank = { id: "bank-u" + Date.now().toString(36), name: name, desc: "", tags: [], questionIds: [] };
      state.banks.push(bank);
    }
    bank.name = name;
    bank.desc = String((input && input.desc) || "");
    bank.tags = check.ids;
    bank.questionIds = (input && input.questionIds ? input.questionIds : []).filter(function (qid) {
      return !!getQuestion(qid);
    });
    save();
    return { ok: true, bank: bank };
  }

  function removeBank(id) {
    var bank = getBank(id);
    if (!bank) return { ok: false, message: "题库不存在" };
    state.banks = state.banks.filter(function (b) { return b.id !== id; });
    save();
    return { ok: true, bank: bank };
  }

  /* ------------------------------------------------------------ 题目 CRUD */
  function upsertQuestion(input) {
    var id = input && input.id;
    var stem = String((input && input.stem) || "").trim();
    if (!stem) return { ok: false, message: "请填写题干" };
    var check = validateTags(input.tags);
    if (!check.ok) return check;
    var question = id ? getQuestion(id) : null;
    var isNew = !question;
    if (!question) {
      var newId = String((input && input.id) || "").trim() || ("q-u" + Date.now().toString(36));
      question = {
        id: newId,
        type: "single",
        score: 5,
        status: "draft",
        source: "manual",
        tags: [],
        stem: stem,
        options: [],
        answer: [],
        analysis: ""
      };
      state.questions.push(question);
    }
    question.type = String((input && input.type) || question.type);
    question.score = Math.max(1, parseInt(input && input.score, 10) || question.score || 5);
    question.tags = check.ids;
    question.stem = stem;
    question.analysis = String((input && input.analysis) || "");
    question.reference = String((input && input.reference) || "");
    if (question.type === "single" || question.type === "multi" || question.type === "judge") {
      question.options = (input && input.options ? input.options : []).filter(function (o) {
        return o && String(o.text || "").trim();
      }).map(function (o, i) {
        return { key: String(o.key || "ABCDEF".charAt(i)), text: String(o.text).trim() };
      });
      question.answer = (input && input.answer ? input.answer : []).filter(function (k) {
        return question.options.some(function (o) { return o.key === k; });
      });
      delete question.keypoints;
      delete question.steps;
    } else if (question.type === "short") {
      question.keypoints = (input && input.keypoints ? input.keypoints : []).filter(function (kp) {
        return kp && String(kp.text || "").trim();
      }).map(function (kp) {
        var keywords = (kp.keywords || []).map(function (k) { return String(k).trim(); }).filter(Boolean);
        var text = String(kp.text).trim();
        return { text: text, keywords: keywords.length ? keywords : [text] };
      });
      delete question.steps;
    } else {
      question.steps = (input && input.steps ? input.steps : []).filter(function (st) {
        return st && String(st.prompt || "").trim();
      }).map(function (st, i) {
        var keywords = (st.keywords || []).map(function (k) { return String(k).trim(); }).filter(Boolean);
        var prompt = String(st.prompt).trim();
        return {
          id: String(st.id || "s" + (i + 1)),
          prompt: prompt,
          answer: String(st.answer || ""),
          keywords: keywords.length ? keywords : [prompt],
          score: Math.max(1, parseFloat(st.score) || 5)
        };
      });
      delete question.keypoints;
    }
    /* 状态机：新建题目一律进入草稿，需审核发布后方可组卷 */
    var wantStatus = String((input && input.status) || "").trim();
    if (wantStatus === "draft" || wantStatus === "published" || wantStatus === "disabled") {
      question.status = wantStatus;
    } else if (isNew) {
      question.status = "draft";
    }
    if (!question.source) question.source = "manual";
    save();
    return { ok: true, question: question };
  }

  function removeQuestion(id) {
    var question = getQuestion(id);
    if (!question) return { ok: false, message: "题目不存在" };
    state.questions = state.questions.filter(function (q) { return q.id !== id; });
    state.banks.forEach(function (b) {
      b.questionIds = (b.questionIds || []).filter(function (x) { return x !== id; });
    });
    state.exams.forEach(function (e) {
      e.questionIds = (e.questionIds || []).filter(function (x) { return x !== id; });
    });
    state.practices.forEach(function (p) {
      p.questionIds = (p.questionIds || []).filter(function (x) { return x !== id; });
    });
    save();
    return { ok: true, question: question };
  }

  /* ------------------------------------------------- 试卷 / 练习 删除 */
  function removePaper(kind, id) {
    var list = kind === "exam" ? state.exams : state.practices;
    var item = byId(list, id);
    if (!item) return { ok: false, message: "对象不存在" };
    if (kind === "exam") {
      state.exams = state.exams.filter(function (e) { return e.id !== id; });
      state.reviews = state.reviews.filter(function (r) { return r.examId !== id; });
      delete state.plumCfg[id];
    } else {
      state.practices = state.practices.filter(function (p) { return p.id !== id; });
    }
    save();
    return { ok: true, item: item };
  }

  /* ------------------------------------------------------ 题目状态机 */
  function statusOf(question) {
    return (question && question.status) || "published";
  }

  function isPublished(question) { return statusOf(question) === "published"; }

  function statusLabel(question) {
    var s = statusOf(question);
    return STATUS_LABEL[s] || s;
  }

  function sourceLabel(question) {
    var s = (question && question.source) || "manual";
    return SOURCE_LABEL[s] || SOURCE_LABEL.manual;
  }

  /* 仅「已发布」题目可被组卷与练习引用 */
  function publishedQuestionIds(ids) {
    return (ids || []).filter(function (id) {
      var q = getQuestion(id);
      return !!q && isPublished(q);
    });
  }

  function questionsByStatus(status) {
    return state.questions.filter(function (q) { return statusOf(q) === status; });
  }

  /* 题库题目；bankId 为空或 __all__ 时返回全量题目 */
  function questionsOfBank(bankId) {
    if (!bankId || bankId === "__all__") return state.questions.slice();
    var bank = getBank(bankId);
    if (!bank) return [];
    var out = [];
    (bank.questionIds || []).forEach(function (qid) {
      var q = getQuestion(qid);
      if (q) out.push(q);
    });
    return out;
  }

  /* 题库内的候选题（草稿） */
  function candidatesOf(bankId) {
    return questionsOfBank(bankId).filter(function (q) { return statusOf(q) === "draft"; });
  }

  function bankStats(bankId) {
    var list = questionsOfBank(bankId);
    var stats = { total: list.length, published: 0, draft: 0, disabled: 0, objective: 0, subjective: 0, score: 0 };
    list.forEach(function (q) {
      var st = statusOf(q);
      if (st === "published") stats.published += 1;
      else if (st === "draft") stats.draft += 1;
      else stats.disabled += 1;
      if (st !== "published") return;
      var v = q.score || 0;
      stats.score += v;
      if (q.type === "short" || q.type === "comprehensive") stats.subjective += v;
      else stats.objective += v;
    });
    return stats;
  }

  /* 状态流转：draft → published → disabled；已停用可恢复为已发布 */
  function setQuestionStatus(id, status) {
    var question = getQuestion(id);
    if (!question) return { ok: false, message: "题目不存在" };
    if (["draft", "published", "disabled"].indexOf(status) === -1) {
      return { ok: false, message: "不支持的题目状态" };
    }
    if (statusOf(question) === status) return { ok: true, question: question, changed: false };
    question.status = status;
    save();
    return { ok: true, question: question, changed: true };
  }

  function setQuestionsStatus(ids, status) {
    var changed = 0;
    var failed = 0;
    (ids || []).forEach(function (id) {
      var r = setQuestionStatus(id, status);
      if (r.ok && r.changed) changed += 1;
      else if (!r.ok) failed += 1;
    });
    return { ok: true, changed: changed, failed: failed };
  }

  /* 丢弃候选题：仅草稿可丢弃 */
  function discardQuestion(id) {
    var question = getQuestion(id);
    if (!question) return { ok: false, message: "题目不存在" };
    if (statusOf(question) !== "draft") return { ok: false, message: "仅草稿状态的题目可以丢弃" };
    return removeQuestion(id);
  }

  function attachToBank(bankId, ids) {
    if (!bankId || bankId === "__all__") return;
    var bank = getBank(bankId);
    if (!bank) return;
    bank.questionIds = bank.questionIds || [];
    (ids || []).forEach(function (id) {
      if (bank.questionIds.indexOf(id) === -1) bank.questionIds.push(id);
    });
  }

  /* ------------------------------------------------ 试卷条目（题目 + 分值） */
  function itemsOf(item) {
    if (item && item.items && item.items.length) return item.items;
    return ((item && item.questionIds) || []).map(function (qid) {
      var q = getQuestion(qid);
      return { qid: qid, score: q ? (q.score || 5) : 5 };
    });
  }

  function setPaperItems(kind, id, items) {
    var item = kind === "exam" ? getExam(id) : getPractice(id);
    if (!item) return { ok: false, message: "对象不存在" };
    var list = (items || []).filter(function (it) { return it && it.qid; }).map(function (it) {
      return { qid: String(it.qid), score: Math.max(0, Number(it.score) || 0) };
    });
    item.items = list;
    item.questionIds = list.map(function (it) { return it.qid; });
    save();
    return { ok: true, item: item };
  }

  /* ------------------------------------------------- 内容生产（模拟流程） */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function stampText(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function seqId(prefix, list) {
    var d = new Date();
    var base = prefix + "-" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-";
    var taken = {};
    (list || []).forEach(function (x) { taken[x.id] = true; });
    var n = 1;
    while (taken[base + pad2(n)]) n += 1;
    return base + pad2(n);
  }

  /* 导入解析样例：用于演示真实的解析预览与列映射流程 */
  var IMPORT_SAMPLE = [
    {
      stem: "在等差数列 {a_n} 中，若 a_3 = 7，a_7 = 15，则该数列的通项公式是：",
      type: "single",
      score: 5,
      options: [
        { key: "A", text: "a_n = 2n + 1" }, { key: "B", text: "a_n = 2n + 3" },
        { key: "C", text: "a_n = 2n - 1" }, { key: "D", text: "a_n = 4n - 5" }
      ],
      answer: ["A"],
      analysis: "公差 d = (15 - 7) ÷ (7 - 3) = 2，a_1 = 3，故 a_n = 2n + 1。",
      tags: ["t-dom-math", "t-pt-calc", "t-df2"]
    },
    {
      stem: "下列说法中，属于一元二次方程特征的有：",
      type: "multi",
      score: 6,
      options: [
        { key: "A", text: "只含一个未知数" }, { key: "B", text: "未知数最高次数为 2" },
        { key: "C", text: "未知数系数均为常数且不为 0" }, { key: "D", text: "含两个未知数" }
      ],
      answer: ["A", "B", "C"],
      analysis: "一元二次方程只含一个未知数，最高次数为 2，且二次项系数不为 0。",
      tags: ["t-dom-math", "t-pt-calc", "t-df2"]
    },
    {
      stem: "TCP 三次握手中，客户端发送的第一个报文段携带的标志位是：",
      type: "single",
      score: 5,
      options: [
        { key: "A", text: "SYN = 1, ACK = 0" }, { key: "B", text: "SYN = 1, ACK = 1" },
        { key: "C", text: "FIN = 1, ACK = 0" }, { key: "D", text: "RST = 1, ACK = 1" }
      ],
      answer: ["A"],
      analysis: "第一次握手客户端只发送 SYN，ACK 位为 0。",
      tags: ["t-dom-net", "t-pt-tcp", "t-df2"]
    },
    {
      stem: "在传输层中，UDP 是面向连接的协议，TCP 是无连接的协议。",
      type: "judge",
      score: 2,
      options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }],
      answer: ["B"],
      analysis: "恰好相反：UDP 无连接，TCP 面向连接。",
      tags: ["t-dom-net", "t-pt-app", "t-df1"]
    }
  ];

  /* AI 生成样例：按题型与难度产出示例题，仅用于演示交互流程 */
  var GEN_SAMPLE = [
    {
      type: "single",
      stem: "对长度为 n 的序列做归并排序，其时间复杂度是：",
      options: [
        { key: "A", text: "O(log n)" }, { key: "B", text: "O(n)" },
        { key: "C", text: "O(n log n)" }, { key: "D", text: "O(n²)" }
      ],
      answer: ["C"],
      analysis: "递归层数 log n，每层合并代价 O(n)，总计 O(n log n)。",
      tags: ["t-dom-ds", "t-pt-sort", "t-df2"]
    },
    {
      type: "single",
      stem: "OSI 参考模型中，负责端到端可靠传输的层次是：",
      options: [
        { key: "A", text: "网络层" }, { key: "B", text: "传输层" },
        { key: "C", text: "会话层" }, { key: "D", text: "表示层" }
      ],
      answer: ["B"],
      analysis: "传输层提供端到端的可靠传输与流量控制。",
      tags: ["t-dom-net", "t-pt-tcp", "t-df1"]
    },
    {
      type: "multi",
      stem: "关于二叉搜索树（BST），下列说法正确的有：",
      options: [
        { key: "A", text: "中序遍历得到有序序列" },
        { key: "B", text: "左子树所有键值均小于该节点" },
        { key: "C", text: "右子树所有键值均大于该节点" },
        { key: "D", text: "插入顺序不会影响树形" }
      ],
      answer: ["A", "B", "C"],
      analysis: "BST 即左小右大，中序遍历必有序；插入顺序会影响树形，故 D 错误。",
      tags: ["t-dom-ds", "t-pt-tree", "t-df3"]
    },
    {
      type: "judge",
      stem: "HTTP/2 在应用层使用二进制分帧编码，并可在同一条连接上并发承载多个请求。",
      options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }],
      answer: ["A"],
      analysis: "HTTP/2 引入二进制分帧层，天然支持多路复用。",
      tags: ["t-dom-net", "t-pt-app", "t-df1"]
    }
  ];

  function createImportBatch(input) {
    var fileName = String((input && input.fileName) || "").trim();
    if (!fileName) return { ok: false, message: "请填写待导入的文件名" };
    var count = Math.max(1, Math.min(parseInt(input && input.count, 10) || 3, IMPORT_SAMPLE.length));
    var batch = {
      id: seqId("imp", state.imports),
      fileName: fileName,
      operator: String((input && input.operator) || "当前管理员"),
      createdAt: stampText(new Date()),
      status: "parsed",
      rowCount: count,
      columns: ["题干", "题型", "选项", "答案", "解析", "知识点"],
      mapping: { stem: "题干", type: "题型", options: "选项", answer: "答案", analysis: "解析", tags: "知识点" },
      rows: []
    };
    for (var i = 0; i < count; i += 1) {
      var r = IMPORT_SAMPLE[i];
      batch.rows.push({
        no: i + 1,
        stem: r.stem,
        type: r.type,
        score: r.score,
        options: clone(r.options),
        answer: r.answer.slice(),
        analysis: r.analysis,
        tags: r.tags.slice(),
        valid: true
      });
    }
    state.imports.push(batch);
    save();
    return { ok: true, batch: batch };
  }

  function commitImport(batchId, bankId) {
    var batch = getImport(batchId);
    if (!batch) return { ok: false, message: "导入批次不存在" };
    if (batch.status === "adopted") return { ok: false, message: "该批次已导入，请勿重复提交" };
    var suffix = String(batch.id).replace(/^imp-/, "");
    var created = [];
    (batch.rows || []).forEach(function (row, i) {
      if (!row || row.valid === false) return;
      var q = {
        id: "q-imp-" + suffix + "-" + pad2(i + 1),
        type: row.type || "single",
        score: row.score || 5,
        tags: (row.tags || []).slice(),
        stem: row.stem,
        options: clone(row.options || []),
        answer: (row.answer || []).slice(),
        analysis: row.analysis || "",
        status: "draft",
        source: "import",
        batchId: batch.id
      };
      state.questions.push(q);
      created.push(q);
    });
    attachToBank(bankId, created.map(function (q) { return q.id; }));
    batch.status = "adopted";
    batch.adoptedAt = stampText(new Date());
    batch.adoptedCount = created.length;
    save();
    return { ok: true, created: created, batch: batch };
  }

  function buildGenRows(gen) {
    var pool = GEN_SAMPLE.filter(function (r) { return r.type === gen.type; });
    if (!pool.length) pool = GEN_SAMPLE.slice();
    var rows = [];
    for (var i = 0; i < gen.count; i += 1) {
      var r = pool[i % pool.length];
      var tags = (gen.tagIds && gen.tagIds.length) ? gen.tagIds.slice() : r.tags.slice();
      var diffTag = { "基础": "t-df1", "中等": "t-df2", "较难": "t-df3" }[gen.difficulty] || "t-df2";
      if (tags.indexOf(diffTag) === -1) tags.push(diffTag);
      rows.push({
        no: i + 1,
        stem: r.stem,
        type: r.type,
        score: gen.difficulty === "较难" ? 6 : 5,
        options: clone(r.options),
        answer: r.answer.slice(),
        analysis: r.analysis,
        tags: tags,
        valid: true
      });
    }
    return rows;
  }

  function createGeneration(input) {
    var gen = {
      id: seqId("gen", state.generations),
      operator: String((input && input.operator) || "当前管理员"),
      createdAt: stampText(new Date()),
      status: "generated",
      count: Math.max(1, Math.min(parseInt(input && input.count, 10) || 3, 8)),
      type: String((input && input.type) || "single"),
      difficulty: String((input && input.difficulty) || "中等"),
      prompt: String((input && input.prompt) || "").trim() || "（未填写生成指令，按默认模板生成）",
      tagIds: (input && input.tagIds) || [],
      rows: []
    };
    gen.rows = buildGenRows(gen);
    state.generations.push(gen);
    save();
    return { ok: true, batch: gen };
  }

  function commitGeneration(batchId, bankId) {
    var batch = getGeneration(batchId);
    if (!batch) return { ok: false, message: "生成批次不存在" };
    if (batch.status === "adopted") return { ok: false, message: "该批次已采纳，请勿重复提交" };
    var suffix = String(batch.id).replace(/^gen-/, "");
    var created = [];
    (batch.rows || []).forEach(function (row, i) {
      if (!row || row.valid === false) return;
      var q = {
        id: "q-gen-" + suffix + "-" + pad2(i + 1),
        type: row.type || "single",
        score: row.score || 5,
        tags: (row.tags || []).slice(),
        stem: row.stem,
        options: clone(row.options || []),
        answer: (row.answer || []).slice(),
        analysis: row.analysis || "",
        status: "draft",
        source: "ai",
        batchId: batch.id
      };
      state.questions.push(q);
      created.push(q);
    });
    attachToBank(bankId, created.map(function (q) { return q.id; }));
    batch.status = "adopted";
    batch.adoptedAt = stampText(new Date());
    batch.adoptedCount = created.length;
    save();
    return { ok: true, created: created, batch: batch };
  }

  /* ------------------------------------------------------------ 卷型模板 */
  function paperTemplates() { return state.paperTemplates; }

  function savePaperTemplate(input) {
    var name = String((input && input.name) || "").trim();
    if (!name) return { ok: false, message: "请填写模板名称" };
    var items = (input && input.items ? input.items : []).filter(function (it) { return it && it.qid; })
      .map(function (it) { return { qid: String(it.qid), score: Math.max(0, Number(it.score) || 0) }; });
    if (!items.length) return { ok: false, message: "模板至少需要一道题目" };
    var tpl = input && input.id ? getPaperTemplate(input.id) : null;
    if (!tpl) {
      tpl = { id: "tpl-u" + Date.now().toString(36) };
      state.paperTemplates.push(tpl);
    }
    tpl.name = name;
    tpl.kind = String((input && input.kind) || "exam");
    tpl.mode = String((input && input.mode) || "standard");
    tpl.durationMin = Math.max(1, parseInt(input && input.durationMin, 10) || 60);
    tpl.passScore = Math.max(0, Number(input && input.passScore) || 0);
    tpl.items = items;
    save();
    return { ok: true, template: tpl };
  }

  function removePaperTemplate(id) {
    var tpl = getPaperTemplate(id);
    if (!tpl) return { ok: false, message: "模板不存在" };
    state.paperTemplates = state.paperTemplates.filter(function (t) { return t.id !== id; });
    save();
    return { ok: true, template: tpl };
  }

  /* ------------------------------------------------- 试卷 / 练习 元数据写入 */
  function scopeStudents(scope) {
    var ids = scope || [];
    var all = (EX.seed && EX.seed.students) || [];
    var classes = (EX.seed && EX.seed.classes) || [];
    var names = ids.map(function (id) {
      for (var i = 0; i < classes.length; i += 1) {
        if (classes[i].id === id) return classes[i].name;
      }
      return id;
    });
    if (!names.length) return all.slice();
    return all.filter(function (s) { return names.indexOf(s.className) !== -1; });
  }

  /* 名单判定：scope 为空表示全员开放；否则按名单组判定指定答题者是否在名单内 */
  function isInScope(scope, studentId) {
    var ids = scope || [];
    if (!ids.length) return true;
    if (!studentId) return false;
    var seed = EX.seed || {};
    var st = seed.getStudent ? seed.getStudent(studentId) : null;
    if (!st) return false;
    var classes = seed.classes || [];
    var names = ids.map(function (id) {
      for (var i = 0; i < classes.length; i += 1) {
        if (classes[i].id === id) return classes[i].name;
      }
      return id;
    });
    return names.indexOf(st.className) !== -1;
  }

  /* --------------------------------------------------------- 题序规则 */
  var ORDER_RULES = [
    {
      id: "type",
      label: "按题型分块",
      desc: "单选 → 多选 → 判断 → 简答 → 综合操作；同一题型内按难度从基础到较难排列。"
    },
    {
      id: "manual",
      label: "按选题顺序",
      desc: "保持组卷时的勾选顺序，不再自动重排题序。"
    }
  ];

  function normalizeOrderRule(rule) {
    return rule === "manual" ? "manual" : "type";
  }

  function orderRuleLabel(rule) {
    var id = normalizeOrderRule(rule);
    var hit = ORDER_RULES.filter(function (r) { return r.id === id; })[0];
    return hit ? hit.label : ORDER_RULES[0].label;
  }

  function setExamMeta(id, patch) {
    var exam = getExam(id);
    if (!exam) return { ok: false, message: "试卷不存在" };
    var p = patch || {};
    if (p.name !== undefined) exam.name = String(p.name).trim() || exam.name;
    if (p.batch !== undefined) exam.batch = String(p.batch).trim();
    if (p.note !== undefined) exam.note = String(p.note);
    if (p.durationMin !== undefined) exam.durationMin = Math.max(1, parseInt(p.durationMin, 10) || exam.durationMin);
    if (p.totalScore !== undefined) exam.totalScore = Math.max(0, Number(p.totalScore) || 0);
    if (p.passScore !== undefined) exam.passScore = Math.max(0, Number(p.passScore) || 0);
    if (p.openAt !== undefined) exam.openAt = String(p.openAt);
    if (p.closeAt !== undefined) exam.closeAt = String(p.closeAt);
    if (p.allowRetake !== undefined) exam.allowRetake = !!p.allowRetake;
    if (p.publishAnswer !== undefined) exam.publishAnswer = String(p.publishAnswer);
    if (p.scope !== undefined) exam.scope = (p.scope || []).slice();
    if (p.status !== undefined) exam.status = String(p.status);
    if (p.published !== undefined) exam.published = !!p.published;
    if (p.orderRule !== undefined) exam.orderRule = normalizeOrderRule(p.orderRule);
    if (p.tags !== undefined) {
      var check = validateTags(p.tags);
      if (!check.ok) return check;
      exam.tags = check.ids;
    }
    save();
    return { ok: true, exam: exam };
  }

  function setPracticeMeta(id, patch) {
    var practice = getPractice(id);
    if (!practice) return { ok: false, message: "练习不存在" };
    var p = patch || {};
    if (p.name !== undefined) practice.name = String(p.name).trim() || practice.name;
    if (p.durationMin !== undefined) practice.durationMin = Math.max(1, parseInt(p.durationMin, 10) || practice.durationMin);
    if (p.note !== undefined) practice.note = String(p.note);
    if (p.totalScore !== undefined) practice.totalScore = Math.max(0, Number(p.totalScore) || 0);
    if (p.status !== undefined) practice.status = String(p.status);
    if (p.published !== undefined) practice.published = !!p.published;
    if (p.scope !== undefined) practice.scope = (p.scope || []).slice();
    if (p.repeats !== undefined) practice.repeats = Math.max(0, parseInt(p.repeats, 10) || 0);
    if (p.feedback !== undefined) practice.feedback = String(p.feedback);
    if (p.mistakeReflow !== undefined) practice.mistakeReflow = !!p.mistakeReflow;
    if (p.orderRule !== undefined) practice.orderRule = normalizeOrderRule(p.orderRule);
    if (p.tags !== undefined) {
      var check = validateTags(p.tags);
      if (!check.ok) return check;
      practice.tags = check.ids;
    }
    save();
    return { ok: true, practice: practice };
  }

  function createExam(input) {
    var p = input || {};
    var name = String(p.name || "").trim() || "未命名试卷";
    var exam = {
      id: "exam-u" + Date.now().toString(36),
      name: name,
      batch: String(p.batch || ""),
      tags: [],
      durationMin: Math.max(1, parseInt(p.durationMin, 10) || 60),
      totalScore: Math.max(0, Number(p.totalScore) || 100),
      passScore: Math.max(0, Number(p.passScore) || 60),
      openAt: String(p.openAt || ""),
      closeAt: String(p.closeAt || ""),
      status: "draft",
      published: false,
      allowRetake: false,
      publishAnswer: "after_close",
      scope: [],
      questionIds: [],
      items: [],
      orderRule: normalizeOrderRule(p.orderRule),
      plum: { mode: "standard" },
      note: String(p.note || "")
    };
    state.exams.push(exam);
    save();
    return { ok: true, exam: exam };
  }

  function createPractice(input) {
    var p = input || {};
    var name = String(p.name || "").trim() || "未命名练习";
    var practice = {
      id: "prac-u" + Date.now().toString(36),
      name: name,
      tags: [],
      questionIds: [],
      items: [],
      orderRule: normalizeOrderRule(p.orderRule),
      durationMin: Math.max(1, parseInt(p.durationMin, 10) || 20),
      totalScore: 0,
      status: "draft",
      published: false,
      scope: [],
      repeats: 0,
      feedback: "after_submit",
      mistakeReflow: true,
      note: String(p.note || "")
    };
    state.practices.push(practice);
    save();
    return { ok: true, practice: practice };
  }

  /* --------------------------------------------------- 发布前校验清单 */
  function preflight(kind, id) {
    var item = kind === "exam" ? getExam(id) : getPractice(id);
    var checks = [];
    if (!item) {
      return {
        ok: false, kind: kind, id: id,
        checks: [{ key: "exist", label: "对象存在", ok: false, detail: "对象不存在" }]
      };
    }
    var items = itemsOf(item);

    checks.push({
      key: "count",
      label: "至少选择一道题目",
      ok: items.length > 0,
      detail: items.length ? "已选 " + items.length + " 道题目" : "尚未选题"
    });

    var unpublished = items.filter(function (it) {
      var q = getQuestion(it.qid);
      return !q || !isPublished(q);
    });
    checks.push({
      key: "published",
      label: "所选题目均为「已发布」",
      ok: unpublished.length === 0,
      detail: unpublished.length
        ? unpublished.length + " 道题目为草稿或已停用，请先发布或替换"
        : "共 " + items.length + " 道题目全部处于已发布状态"
    });

    var sum = items.reduce(function (a, b) { return a + (Number(b.score) || 0); }, 0);
    var target = Number(item.totalScore) || 0;
    checks.push({
      key: "score",
      label: "总分等于各题分值之和",
      ok: items.length > 0 && sum === target,
      detail: "各题合计 " + sum + " 分 / 目标总分 " + target + " 分"
    });

    var seen = {};
    var dup = [];
    items.forEach(function (it) {
      if (seen[it.qid]) dup.push(it.qid);
      seen[it.qid] = true;
    });
    checks.push({
      key: "dup",
      label: "试卷内无重复题目",
      ok: dup.length === 0,
      detail: dup.length ? dup.length + " 道题目重复出现" : "无重复题目"
    });

    var obj = 0;
    var sub = 0;
    items.forEach(function (it) {
      var q = getQuestion(it.qid);
      if (!q) return;
      var v = Number(it.score) || 0;
      if (q.type === "short" || q.type === "comprehensive") sub += v;
      else obj += v;
    });
    var objRatio = sum ? Math.round((obj / sum) * 100) : 0;
    var subRatio = sum ? Math.round((sub / sum) * 100) : 0;
    var mixOk = kind === "practice" ? true : subRatio <= 40;
    checks.push({
      key: "mix",
      label: "客观 / 主观分值占比合理",
      ok: mixOk,
      detail: "客观 " + obj + " 分（" + objRatio + "%），主观 " + sub + " 分（" + subRatio + "%）" +
        (mixOk ? "" : "；主观题占比超过 40%，建议调整")
    });

    var dur = Number(item.durationMin) || 0;
    var perQ = items.length ? Math.round((dur / items.length) * 10) / 10 : 0;
    var perPoint = target ? Math.round((dur / target) * 100) / 100 : 0;
    /* 题均时长与「每分耗时」双阈值：前者防过密，后者防时长与分值严重失衡 */
    var durOk = items.length > 0 && dur > 0 && perQ >= 0.5 && perQ <= 20 && perPoint >= 0.3 && perPoint <= 3;
    checks.push({
      key: "duration",
      label: "时长与题量匹配",
      ok: durOk,
      detail: dur + " 分钟 / " + items.length + " 题，题均约 " + perQ + " 分钟，每分约 " + perPoint + " 分钟"
    });

    var tagCount = (item.tags || []).length;
    checks.push({
      key: "tags",
      label: "标签不超过 " + MAX_TAGS + " 个",
      ok: tagCount <= MAX_TAGS,
      detail: "已选 " + tagCount + " 个标签"
    });

    if (kind === "exam") {
      var scope = item.scope || [];
      var students = scopeStudents(scope);
      checks.push({
        key: "roster",
        label: "已选择考试名单组",
        ok: scope.length > 0,
        detail: scope.length
          ? "覆盖 " + scope.length + " 个名单组，共 " + students.length + " 名答题者"
          : "尚未选择考试名单组，名单为空时不可发布"
      });
    } else {
      var pScope = item.scope || [];
      checks.push({
        key: "open",
        label: "开放范围已配置",
        ok: true,
        detail: pScope.length ? "限定 " + pScope.length + " 个名单组" : "全员开放"
      });
    }

    var failed = checks.filter(function (c) { return !c.ok; });
    return {
      ok: failed.length === 0,
      kind: kind,
      id: id,
      checks: checks,
      failed: failed.length,
      total: checks.length
    };
  }

  /* 答题端可见的试卷与练习：过滤未发布内容、非已发布题目，并按名单范围过滤 */
  function studentExams(studentId) {
    return state.exams.filter(function (e) {
      if (e.status === "draft" || e.published === false) return false;
      return !studentId || isInScope(e.scope, studentId);
    });
  }

  function studentPractices(studentId) {
    return state.practices.filter(function (p) {
      if (p.status !== "published" || p.published === false) return false;
      return !studentId || isInScope(p.scope, studentId);
    });
  }

  function studentExam(id, studentId) {
    var exam = getExam(id);
    if (!exam) return null;
    if (exam.status === "draft" || exam.published === false) return null;
    if (studentId && !isInScope(exam.scope, studentId)) return null;
    var ids = publishedQuestionIds(exam.questionIds);
    var copy = clone(exam);
    copy.questionIds = ids;
    copy.items = (itemsOf(exam)).filter(function (it) { return ids.indexOf(it.qid) !== -1; });
    return copy;
  }

  function studentPractice(id, studentId) {
    var practice = getPractice(id);
    if (!practice) return null;
    if (practice.status !== "published" || practice.published === false) return null;
    if (studentId && !isInScope(practice.scope, studentId)) return null;
    var ids = publishedQuestionIds(practice.questionIds);
    var copy = clone(practice);
    copy.questionIds = ids;
    copy.items = (itemsOf(practice)).filter(function (it) { return ids.indexOf(it.qid) !== -1; });
    return copy;
  }

  /* ------------------------------------------------- 试卷 / 练习 标签写入 */
  function setEntityTags(kind, id, tags) {
    var list = kind === "exam" ? state.exams : state.practices;
    var item = byId(list, id);
    if (!item) return { ok: false, message: "对象不存在" };
    var check = validateTags(tags);
    if (!check.ok) return check;
    item.tags = check.ids;
    save();
    return { ok: true, item: item };
  }

  function updateExamMeta(id, patch) { return setExamMeta(id, patch); }

  function updatePracticeMeta(id, patch) { return setPracticeMeta(id, patch); }

  /* ------------------------------------------------------------ 阅卷队列 */
  function reviews() { ensureFresh(); return state.reviews; }

  function reviewOf(id) { ensureFresh(); return byId(state.reviews, id); }

  /* 新增阅卷记录（答题端交卷后写入，主观题进入管理端队列） */
  function addReview(input) {
    if (!input || !input.id) return { ok: false, message: "缺少阅卷记录标识" };
    var existing = reviewOf(input.id);
    if (existing) {
      /* 同一份卷宗重复入队时补齐作答文本，避免阅卷人看到空作答 */
      if (!existing.answerText && input.answerText) {
        existing.answerText = String(input.answerText);
        save();
      }
      return { ok: true, review: existing };
    }
    var review = {
      id: String(input.id),
      examId: String(input.examId || ""),
      studentId: String(input.studentId || ""),
      qid: String(input.qid || ""),
      stepId: input.stepId || null,
      attempt: input.attempt === undefined || input.attempt === null ? 1 : Number(input.attempt),
      answerText: String(input.answerText || ""),
      submittedAt: input.submittedAt || new Date().toISOString(),
      status: input.status || "pending",
      teacherScore: input.teacherScore === undefined ? null : input.teacherScore,
      comment: String(input.comment || "")
    };
    state.reviews.push(review);
    save();
    return { ok: true, review: review };
  }

  function updateReview(id, patch) {
    var review = reviewOf(id);
    if (!review) return { ok: false, message: "阅卷记录不存在" };
    if (patch && patch.teacherScore !== undefined) {
      review.teacherScore = patch.teacherScore === null ? null : Number(patch.teacherScore);
    }
    if (patch && patch.comment !== undefined) review.comment = String(patch.comment);
    if (patch && patch.status !== undefined) review.status = patch.status;
    save();
    return { ok: true, review: review };
  }

  /* --------------------------------------------------------- 梅花卷配置 */
  function plumCfg(examId) {
    var exam = getExam(examId);
    var base = exam && exam.plum ? exam.plum : { mode: "standard" };
    var custom = state.plumCfg[examId];
    var mode = (custom && custom.mode) || base.mode || "standard";
    return { mode: mode, seed: autoSeed(examId) };
  }

  function setPlumCfg(examId, cfg) {
    state.plumCfg[examId] = { mode: (cfg && cfg.mode) || "standard" };
    save();
    return state.plumCfg[examId];
  }

  load();

  EX.catalog = {
    STORAGE_KEY: STORAGE_KEY,
    REV_KEY: REV_KEY,
    MAX_TAGS: MAX_TAGS,
    state: state,
    isStorageReady: function () { return storageOk; },
    load: load,
    save: save,
    reset: reset,
    reload: reload,
    ensureFresh: ensureFresh,
    stamp: stamp,
    remoteStamp: remoteStamp,

    tags: function () { ensureFresh(); return state.tags; },
    questions: function () { ensureFresh(); return state.questions; },
    banks: function () { ensureFresh(); return state.banks; },
    exams: function () { ensureFresh(); return state.exams; },
    practices: function () { ensureFresh(); return state.practices; },
    reviews: reviews,
    imports: function () { ensureFresh(); return state.imports; },
    generations: function () { ensureFresh(); return state.generations; },
    paperTemplates: function () { ensureFresh(); return state.paperTemplates; },

    getTag: getTag,
    getQuestion: getQuestion,
    getBank: getBank,
    getExam: getExam,
    getPractice: getPractice,
    getImport: getImport,
    getGeneration: getGeneration,
    getPaperTemplate: getPaperTemplate,
    reviewOf: reviewOf,
    addReview: addReview,

    tagName: tagName,
    tagNames: tagNames,
    tagGroups: tagGroups,
    tagsOfGroup: tagsOfGroup,
    primaryTagId: primaryTagId,
    primaryTagName: primaryTagName,
    difficultyOf: difficultyOf,
    difficultyLabel: difficultyLabel,
    ORDER_RULES: ORDER_RULES,
    normalizeOrderRule: normalizeOrderRule,
    orderRuleLabel: orderRuleLabel,
    usageOf: usageOf,
    matchTags: matchTags,
    validateTags: validateTags,

    createTag: createTag,
    updateTag: updateTag,
    removeTag: removeTag,
    upsertBank: upsertBank,
    removeBank: removeBank,
    upsertQuestion: upsertQuestion,
    removeQuestion: removeQuestion,
    removePaper: removePaper,
    discardQuestion: discardQuestion,
    setEntityTags: setEntityTags,
    updateExamMeta: updateExamMeta,
    updatePracticeMeta: updatePracticeMeta,

    statusOf: statusOf,
    isPublished: isPublished,
    statusLabel: statusLabel,
    sourceLabel: sourceLabel,
    publishedQuestionIds: publishedQuestionIds,
    questionsByStatus: questionsByStatus,
    questionsOfBank: questionsOfBank,
    candidatesOf: candidatesOf,
    bankStats: bankStats,
    setQuestionStatus: setQuestionStatus,
    setQuestionsStatus: setQuestionsStatus,
    itemsOf: itemsOf,
    setPaperItems: setPaperItems,
    createImportBatch: createImportBatch,
    commitImport: commitImport,
    createGeneration: createGeneration,
    commitGeneration: commitGeneration,
    savePaperTemplate: savePaperTemplate,
    removePaperTemplate: removePaperTemplate,
    setExamMeta: setExamMeta,
    setPracticeMeta: setPracticeMeta,
    createExam: createExam,
    createPractice: createPractice,
    preflight: preflight,
    scopeStudents: scopeStudents,
    isInScope: isInScope,
    studentExams: studentExams,
    studentPractices: studentPractices,
    studentExam: studentExam,
    studentPractice: studentPractice,

    updateReview: updateReview,
    plumCfg: plumCfg,
    setPlumCfg: setPlumCfg,
    autoSeed: autoSeed
  };
})(window);
