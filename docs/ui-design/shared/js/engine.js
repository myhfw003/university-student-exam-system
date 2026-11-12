/* ==========================================================================
   知行测评 · 判分引擎与梅花卷置换算法
   - 题序：默认按题型分块（单选→多选→判断→简答→综合操作），组内按难度由易到难。
   - 置换：种子化随机源 + Fisher–Yates 洗牌，结果可复现。
   - 标准卷：全体答题者同一份卷面，题序与选项顺序均固定。
   - 小梅花：题序统一保留，仅每位答题者的选项顺序独立置换。
   - 大梅花：保留题型块之间的先后顺序（单选→多选→判断→简答→综合），
     但每个题型块内部的题目顺序按答题者独立打乱，选项顺序同样独立置换。
   - 置换种子由系统按试卷自动派生，不对外暴露输入；同一试卷重复出卷结果恒定可复现。
   - 判断题只有"正确/错误"两项，置换无教学意义，故固定不参与置换。
   ========================================================================== */
(function (global) {
  "use strict";

  var EX = (global.EX = global.EX || {});

  var MODES = {
    standard: {
      id: "standard",
      label: "标准卷",
      short: "题序 · 选项均固定",
      desc: "全体答题者拿到完全相同的题序与选项顺序；题序按题型分块、组内由易到难，用于统一测评。"
    },
    small: {
      id: "small",
      label: "小梅花",
      short: "选项随机 · 题序保留",
      desc: "题目顺序全体统一保留（按题型分块、组内由易到难），仅每位答题者的选项顺序独立打乱，防止相邻抄袭。"
    },
    large: {
      id: "large",
      label: "大梅花",
      short: "题型分块 · 组内题序随机",
      desc: "保留题型分块的先后顺序（单选→多选→判断→简答→综合操作），每个题型内部的题目顺序按答题者独立打乱，选项顺序也独立打乱。"
    }
  };

  var MULTI_POLICY = "多选题计分策略：错选不得分；漏选按答对项占比折半计分（例：正确项 ABD，漏选 A 得该题分值的 1/4）。";

  /* ------------------------------------------------------------ 随机源 */
  function hash32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, random) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* ------------------------------------------------------- 题型与难度排序 */
  var TYPE_FALLBACK = ["single", "multi", "judge", "short", "comprehensive"];

  /** 题型顺序：优先取题库内置的题型定义表 */
  function typeList() {
    var list = (EX.seed && EX.seed.QUESTION_TYPES) || [];
    if (!list.length) return TYPE_FALLBACK;
    return list.map(function (t) { return t.id; });
  }

  /** 题型权重：越小越靠前；未登记的题型排在末尾 */
  function typeRank(type) {
    var list = typeList();
    var idx = list.indexOf(type);
    return idx === -1 ? list.length : idx;
  }

  /** 难度等级：1 基础 / 2 中等 / 3 较难 */
  function difficultyOf(question) {
    if (EX.catalog && EX.catalog.difficultyOf) return EX.catalog.difficultyOf(question);
    return 2;
  }

  /** 标准题序：先按题型分块，组内按难度由易到难；同题型同难度保持原选题顺序 */
  function canonicalOrder(exam) {
    var ids = (exam && exam.questionIds) ? exam.questionIds.slice() : [];
    var seq = {};
    ids.forEach(function (id, i) { seq[id] = i; });
    return ids.sort(function (a, b) {
      var qa = EX.catalog.getQuestion(a);
      var qb = EX.catalog.getQuestion(b);
      var ra = typeRank(qa ? qa.type : "");
      var rb = typeRank(qb ? qb.type : "");
      if (ra !== rb) return ra - rb;
      var da = qa ? difficultyOf(qa) : 2;
      var db = qb ? difficultyOf(qb) : 2;
      if (da !== db) return da - db;
      return (seq[a] || 0) - (seq[b] || 0);
    });
  }

  /** 题序规则：type = 题型分块 + 组内由易到难（默认）；manual = 保持选题顺序 */
  function orderRuleOf(exam) {
    var rule = (exam && exam.orderRule) || "type";
    return rule === "manual" ? "manual" : "type";
  }

  /** 基准题序：试卷出卷前的基础顺序 */
  function baseOrder(exam) {
    var ids = (exam && exam.questionIds) ? exam.questionIds.slice() : [];
    if (orderRuleOf(exam) === "manual") return ids;
    return canonicalOrder(exam);
  }

  /* ------------------------------------------------------- 试卷与置换 */
  /**
   * 系统自动派生的置换种子：按试卷标识计算，恒定且可复现。
   * 使用者无需也无法干预——同一试卷重复出卷得到同一批卷面。
   */
  function autoSeedOf(exam) {
    var id = (exam && exam.id) || "SEED";
    if (EX.catalog && EX.catalog.autoSeed) return EX.catalog.autoSeed(id);
    return "AUTO-" + hash32(String(id)).toString(36).toUpperCase();
  }

  function normalizeConfig(exam, cfg) {
    var base = (exam && exam.plum) || {};
    var input = cfg || {};
    var mode = MODES[input.mode] ? input.mode : base.mode || "standard";
    var seed = (input.seed !== undefined && input.seed !== null && input.seed !== "")
      ? String(input.seed)
      : autoSeedOf(exam);
    return { mode: mode, seed: seed };
  }

  /** 变体键：标准卷恒定；梅花卷按答题者逐人独立 */
  function variantKeyOf(cfg, student, rosterIndex) {
    if (cfg.mode === "standard") return "STD";
    return student.id;
  }

  function variantLabelOf(cfg, student, rosterIndex) {
    if (cfg.mode === "standard") return "标准卷";
    return student.id.slice(-4) + " 号卷";
  }

  /**
   * 按题型分块：沿基准题序切分出「连续同类型」的题型块，块内保持基准顺序。
   * 默认题序（题型分块）下即等于按题型聚合；手动题序下题型交错时，
   * 则忠实保留基准题序的块边界，不会把同类型题目跨块搬动。
   * 用于大梅花"保留题型块先后顺序、仅打乱块内题目"的置换。
   */
  function typeBlocks(ids) {
    var blocks = [];
    ids.forEach(function (id) {
      var q = EX.catalog.getQuestion(id);
      var t = q ? q.type : "";
      var last = blocks[blocks.length - 1];
      if (last && last.type === t) last.ids.push(id);
      else blocks.push({ type: t, ids: [id] });
    });
    return blocks;
  }

  function questionOrderOf(exam, cfg, variantKey) {
    var ids = baseOrder(exam);
    /* 标准卷与小梅花保留基准题序；大梅花保留题型块先后顺序，仅打乱块内题目 */
    if (cfg.mode !== "large") return ids;
    var blocks = typeBlocks(ids);
    var out = [];
    blocks.forEach(function (block, bi) {
      var seedKey = exam.id + "|" + cfg.seed + "|" + variantKey + "|qorder|" + bi + "|" + block.type;
      out = out.concat(shuffle(block.ids, rng(hash32(seedKey))));
    });
    return out;
  }

  var LETTERS = ["A", "B", "C", "D", "E", "F"];

  /**
   * 卷面配分：优先取试卷中为该题设定的分值，未配置时回退题目默认分值。
   * 组卷时的「选题与配分」是成绩口径的唯一来源，判分必须与之一致。
   */
  function itemScoreOf(exam, qid) {
    var items = (exam && exam.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].qid === qid) {
        var v = Number(items[i].score);
        if (!isNaN(v)) return v;
      }
    }
    var q = EX.catalog ? EX.catalog.getQuestion(qid) : null;
    return q ? (Number(q.score) || 0) : 0;
  }

  /**
   * 综合操作题各步骤的分值：按题目内步骤权重等比缩放到卷面配分，
   * 末步吸收舍入余量，保证各步骤满分之和等于该题分值。
   */
  function stepScores(question, itemScore) {
    var steps = (question && question.steps) || [];
    if (!steps.length) return [];
    var max = itemScore === undefined || itemScore === null ? (Number(question.score) || 0) : Number(itemScore);
    var weights = steps.map(function (st) { return Number(st.score) || 0; });
    var totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
    if (totalWeight <= 0) {
      weights = steps.map(function () { return 1; });
      totalWeight = steps.length;
    }
    var out = [];
    var acc = 0;
    steps.forEach(function (st, i) {
      var m = (i === steps.length - 1) ? round2(max - acc) : round2(max * weights[i] / totalWeight);
      if (m < 0) m = 0;
      acc = round2(acc + m);
      out.push(m);
    });
    return out;
  }

  function buildPaper(exam, student, cfgInput, rosterIndex) {
    var cfg = normalizeConfig(exam, cfgInput);
    var idx = rosterIndex === undefined ? 0 : rosterIndex;
    var variantKey = variantKeyOf(cfg, student, idx);
    var order = questionOrderOf(exam, cfg, variantKey);
    var base = baseOrder(exam);
    var baseIndex = {};
    base.forEach(function (qid, i) { baseIndex[qid] = i + 1; });

    var items = order.map(function (qid, slot) {
      var q = EX.catalog.getQuestion(qid);
      if (!q) return null;
      var keys = (q.options || []).map(function (o) { return o.key; });
      var displayKeys;
      if (cfg.mode === "standard" || q.type === "judge") {
        displayKeys = keys.slice();
      } else {
        var seedKey = exam.id + "|" + cfg.seed + "|" + variantKey + "|" + q.id + "|opt";
        displayKeys = shuffle(keys, rng(hash32(seedKey)));
      }
      /* 答题者卷面上看到的字母按位置重新编号：显示字母 → 原题选项键 */
      var toOriginal = {};
      var fromOriginal = {};
      displayKeys.forEach(function (originalKey, pos) {
        var letter = LETTERS[pos];
        toOriginal[letter] = originalKey;
        fromOriginal[originalKey] = letter;
      });
      return {
        slot: slot + 1,
        qid: q.id,
        question: q,
        score: itemScoreOf(exam, q.id),
        originalIndex: baseIndex[q.id] || exam.questionIds.indexOf(q.id) + 1,
        displayKeys: displayKeys,
        toOriginal: toOriginal,
        fromOriginal: fromOriginal,
        orderText: displayKeys.join("·"),
        changed: displayKeys.join("") !== keys.join("")
      };
    }).filter(Boolean);

    return {
      examId: exam.id,
      studentId: student.id,
      mode: cfg.mode,
      cfg: cfg,
      variantKey: variantKey,
      variantLabel: variantLabelOf(cfg, student, idx),
      seedLabel: cfg.seed,
      items: items
    };
  }

  /* ------------------------------------------------------------- 判分 */
  function normalizeText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，。、；：？！“”‘’（）()【】\[\]"'`,.!?;:\-—_/\\|]/g, "");
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function gradeObjective(question, pickedKeys, maxOverride) {
    var max = (maxOverride === undefined || maxOverride === null) ? (Number(question.score) || 0) : Number(maxOverride);
    var picked = (pickedKeys || []).slice();
    var correct = question.answer.slice();
    if (!picked.length) {
      return { score: 0, max: max, status: "blank", picked: picked, correct: correct };
    }
    if (question.type === "single" || question.type === "judge") {
      var ok = picked.length === 1 && picked[0] === correct[0];
      return {
        score: ok ? max : 0,
        max: max,
        status: ok ? "correct" : "wrong",
        picked: picked,
        correct: correct
      };
    }
    var wrongPicked = picked.filter(function (k) { return correct.indexOf(k) === -1; });
    var hit = picked.filter(function (k) { return correct.indexOf(k) !== -1; });
    if (wrongPicked.length) {
      return { score: 0, max: max, status: "wrong", picked: picked, correct: correct };
    }
    if (hit.length === correct.length) {
      return { score: max, max: max, status: "correct", picked: picked, correct: correct };
    }
    var partial = round2(max * (hit.length / correct.length) * 0.5);
    return { score: partial, max: max, status: "partial", picked: picked, correct: correct };
  }

  function gradeShort(question, answerText, maxOverride) {
    var max = (maxOverride === undefined || maxOverride === null) ? (Number(question.score) || 0) : Number(maxOverride);
    var text = normalizeText(answerText);
    var kps = question.keypoints || [];
    var per = round2(max / (kps.length || 1));
    var points = kps.map(function (kp) {
      var hit = kp.keywords.some(function (kw) {
        var n = normalizeText(kw);
        return n.length > 0 && text.indexOf(n) !== -1;
      });
      return { text: kp.text, hit: hit, score: hit ? per : 0, max: per };
    });
    var score = round2(points.reduce(function (sum, p) { return sum + p.score; }, 0));
    return { score: score, max: max, status: "auto", points: points, answered: !!String(answerText || "").trim() };
  }

  function gradeStep(step, answerText, maxOverride) {
    var max = (maxOverride === undefined || maxOverride === null) ? (Number(step.score) || 0) : Number(maxOverride);
    var text = normalizeText(answerText);
    var keywords = step.keywords || [];
    var hit = keywords.some(function (kw) {
      var n = normalizeText(kw);
      return n.length > 0 && text.indexOf(n) !== -1;
    });
    return {
      score: hit ? max : 0,
      max: max,
      hit: hit,
      answered: !!String(answerText || "").trim()
    };
  }

  function gradeComprehensive(question, stepAnswers, maxOverride) {
    var answers = stepAnswers || {};
    var max = (maxOverride === undefined || maxOverride === null) ? (Number(question.score) || 0) : Number(maxOverride);
    var scales = stepScores(question, max);
    var steps = (question.steps || []).map(function (step, i) {
      var res = gradeStep(step, answers[step.id], scales[i]);
      return {
        id: step.id,
        prompt: step.prompt,
        score: res.score,
        max: res.max,
        hit: res.hit,
        answered: res.answered,
        answer: answers[step.id] || ""
      };
    });
    var score = round2(steps.reduce(function (sum, s) { return sum + s.score; }, 0));
    return { score: score, max: max, status: "auto", steps: steps };
  }

  /**
   * 判分一份试卷。responses 结构：
   * { [qid]: { choice: ["A"], text: "……", steps: { stepId: "……" } } }
   * choice 存的是答题者卷面上看到的选项键，需经 paper.items[].toOriginal 还原为原题键。
   */
  function scorePaper(paper, responses) {
    var resp = responses || {};
    var details = [];
    var objective = { score: 0, max: 0 };
    var subjective = { score: 0, max: 0, pending: 0 };

    paper.items.forEach(function (item) {
      var q = item.question;
      var r = resp[q.id] || {};
      /* 卷面配分优先：组卷时设定的分值才是该题在本卷中的满分 */
      var itemMax = (item.score === undefined || item.score === null) ? (Number(q.score) || 0) : Number(item.score);
      var entry = {
        qid: q.id,
        slot: item.slot,
        type: q.type,
        question: q,
        displayKeys: item.displayKeys,
        toOriginal: item.toOriginal,
        fromOriginal: item.fromOriginal
      };

      if (q.type === "single" || q.type === "multi" || q.type === "judge") {
        var originalPicked = (r.choice || []).map(function (k) { return item.toOriginal[k] || k; });
        var res = gradeObjective(q, originalPicked, itemMax);
        entry.score = res.score;
        entry.max = res.max;
        entry.status = res.status;
        entry.correct = res.correct;
        entry.pickedOriginal = originalPicked;
        entry.pickedDisplay = (r.choice || []).slice();
        objective.score = round2(objective.score + res.score);
        objective.max = round2(objective.max + res.max);
      } else if (q.type === "short") {
        var sres = gradeShort(q, r.text, itemMax);
        entry.score = sres.score;
        entry.max = sres.max;
        entry.status = sres.answered ? "pending" : "blank";
        entry.points = sres.points;
        entry.answerText = r.text || "";
        entry.autoScore = sres.score;
        subjective.score = round2(subjective.score + sres.score);
        subjective.max = round2(subjective.max + sres.max);
        subjective.pending = subjective.pending + 1;
      } else if (q.type === "comprehensive") {
        var cres = gradeComprehensive(q, r.steps, itemMax);
        entry.score = cres.score;
        entry.max = cres.max;
        entry.status = cres.steps.some(function (s) { return s.answered; }) ? "pending" : "blank";
        entry.steps = cres.steps;
        entry.autoScore = cres.score;
        subjective.score = round2(subjective.score + cres.score);
        subjective.max = round2(subjective.max + cres.max);
        subjective.pending = subjective.pending + 1;
      }

      details.push(entry);
    });

    return {
      objective: objective,
      subjective: subjective,
      total: round2(objective.score + subjective.score),
      totalMax: round2(objective.max + subjective.max),
      details: details
    };
  }

  /* --------------------------------------------------- 矩阵与差异分析 */
  function buildMatrix(exam, cfgInput, roster) {
    var cfg = normalizeConfig(exam, cfgInput);
    var rows = roster.map(function (student, i) {
      var paper = buildPaper(exam, student, cfg, i);
      var signature = paper.items.map(function (it) { return it.qid + ":" + it.orderText; }).join("|");
      return {
        student: student,
        variantKey: paper.variantKey,
        variantLabel: paper.variantLabel,
        signature: signature,
        items: paper.items.map(function (it) {
          var q = it.question;
          return {
            slot: it.slot,
            qid: it.qid,
            originalIndex: it.originalIndex,
            orderText: it.orderText,
            changed: it.changed,
            moved: it.originalIndex !== it.slot,
            tags: (q.tags || []).slice(),
            tagText: EX.catalog.tagNames(q.tags).join(" · "),
            primaryTag: EX.catalog.primaryTagName(q),
            difficulty: EX.catalog.difficultyLabel(q),
            type: q.type
          };
        })
      };
    });

    var signatures = {};
    rows.forEach(function (r) { signatures[r.signature] = true; });
    var paperCount = Object.keys(signatures).length;

    var slotCount = exam.questionIds.length;
    var questionMovedCount = 0;
    var optionChangedCount = 0;
    var totalCells = 0;

    rows.forEach(function (r) {
      r.items.forEach(function (cell) {
        totalCells += 1;
        if (cell.moved) questionMovedCount += 1;
        if (cell.changed) optionChangedCount += 1;
      });
    });

    return {
      cfg: cfg,
      mode: MODES[cfg.mode],
      rows: rows,
      slotCount: slotCount,
      paperCount: paperCount,
      questionMovedCount: questionMovedCount,
      optionChangedCount: optionChangedCount,
      totalCells: totalCells,
      studentCount: rows.length
    };
  }

  /** 同一道题在不同答题者卷中的选项顺序对照 */
  function optionDiff(exam, cfgInput, roster, qid) {
    var cfg = normalizeConfig(exam, cfgInput);
    var question = EX.catalog.getQuestion(qid);
    if (!question) return null;
    var baseKeys = (question.options || []).map(function (o) { return o.key; });
    var rows = roster.map(function (student, i) {
      var paper = buildPaper(exam, student, cfg, i);
      var item = paper.items.filter(function (it) { return it.qid === qid; })[0];
      var entries = item.displayKeys.map(function (originalKey, pos) {
        var opt = question.options.filter(function (o) { return o.key === originalKey; })[0];
        return {
          pos: pos + 1,
          displayKey: LETTERS[pos],
          originalKey: originalKey,
          text: opt ? opt.text : "",
          moved: originalKey !== baseKeys[pos]
        };
      });
      return {
        student: student,
        variantKey: paper.variantKey,
        variantLabel: paper.variantLabel,
        orderText: item.orderText,
        changed: item.changed,
        entries: entries
      };
    });
    return { question: question, baseKeys: baseKeys, rows: rows };
  }

  /** 某位答题者拿到的试卷（用于卷面预览） */
  function previewPaper(exam, student, cfgInput, rosterIndex) {
    return buildPaper(exam, student, cfgInput, rosterIndex);
  }

  EX.engine = {
    MODES: MODES,
    LETTERS: LETTERS,
    MULTI_POLICY: MULTI_POLICY,
    hash32: hash32,
    rng: rng,
    shuffle: shuffle,
    typeList: typeList,
    typeRank: typeRank,
    difficultyOf: difficultyOf,
    canonicalOrder: canonicalOrder,
    orderRuleOf: orderRuleOf,
    baseOrder: baseOrder,
    typeBlocks: typeBlocks,
    autoSeedOf: autoSeedOf,
    normalizeConfig: normalizeConfig,
    variantKeyOf: variantKeyOf,
    buildPaper: buildPaper,
    buildMatrix: buildMatrix,
    optionDiff: optionDiff,
    previewPaper: previewPaper,
    itemScoreOf: itemScoreOf,
    stepScores: stepScores,
    gradeObjective: gradeObjective,
    gradeShort: gradeShort,
    gradeComprehensive: gradeComprehensive,
    gradeStep: gradeStep,
    scorePaper: scorePaper,
    normalizeText: normalizeText,
    round2: round2
  };
})(window);
