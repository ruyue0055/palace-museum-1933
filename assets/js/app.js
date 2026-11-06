/* 《档案里的木箱山河：故宫南迁万里录》 — 叙事引擎（全屏叙事版 + 典守员工作日志系统） */
(function () {
  "use strict";

  var S = window.STORY, ART = window.ART, MAP = window.MAPS, BG = window.BG;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SAVE_KEY = "wgny_saves_v1", AUTO_KEY = "wgny_auto_v1", META_KEY = "wgny_meta_v1";

  /* 收集进度（结局 / 文物 / 跨周目日志图鉴）跨周目永久保存，与"这一趟"的进度分开存 */
  function loadMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY) || "null") || {};
      return {
        endings: Array.isArray(m.endings) ? m.endings : [],
        relics: Array.isArray(m.relics) ? m.relics : [],
        allDiaries: Array.isArray(m.allDiaries) ? m.allDiaries : []
      };
    } catch (e) { return { endings: [], relics: [], allDiaries: [] }; }
  }
  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify({
        endings: state.endings, relics: state.relics, allDiaries: state.allDiaries, at: Date.now()
      }));
    } catch (e) { }
  }
  function uniq(a) {
    return a.filter(function (v, i) { return a.indexOf(v) === i; });
  }

  window.addEventListener("error", function (e) {
    var t = document.getElementById("toast");
    if (t) { t.textContent = "脚本出错：" + (e.message || "未知错误"); t.classList.add("is-on"); }
    console.error(e.error || e.message);
  });

  var state = {
    node: S.start, line: 0, flags: {}, relics: [], endings: [],
    diaries: [], allDiaries: [],
    stage: 1, history: [], choicePoints: [], started: false
  };
  var typing = null, choiceVisible = false, autoMode = false, autoTimer = null;
  var lastAct = null, sceneNo = 0, currentRelic = null;

  /* ---------- 小工具 ---------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove("is-on"); }, 2400);
  }
  function node() { return S.nodes[state.node]; }
  function updateDiaryCount() {
    var elCount = $("#diaryCount");
    if (elCount) elCount.textContent = state.diaries.length;
  }
  function recordDiary(did) {
    if (!did || !S.diaries || !S.diaries[did]) return false;
    var added = false;
    if (state.diaries.indexOf(did) < 0) {
      state.diaries.push(did);
      added = true;
    }
    if (state.allDiaries.indexOf(did) < 0) {
      state.allDiaries.push(did);
    }
    updateDiaryCount();
    saveMeta();
    return added;
  }

  function snapshot() {
    return {
      v: 3, node: state.node, line: 0, flags: JSON.parse(JSON.stringify(state.flags || {})),
      relics: state.relics.slice(), endings: state.endings.slice(),
      diaries: state.diaries.slice(),
      stage: state.stage, history: state.history.slice(),
      choicePoints: state.choicePoints.slice(-12), at: Date.now()
    };
  }
  function restore(d) {
    state.node = d.node || S.start; state.line = 0;
    state.flags = d.flags || {};
    /* 收藏只增不减：读旧档不应该把已收集的东西抹掉 */
    state.relics = uniq(state.relics.concat(d.relics || []));
    state.endings = uniq(state.endings.concat(d.endings || []));
    state.diaries = Array.isArray(d.diaries) ? d.diaries.slice() : [];
    state.allDiaries = uniq(state.allDiaries.concat(state.diaries));
    state.stage = d.stage || 1;
    state.history = d.history || [];
    state.choicePoints = d.choicePoints || [];
    updateDiaryCount();
    saveMeta();
  }
  function save() {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(snapshot())); } catch (e) { }
  }

  /* ---------- 场景头部 ---------- */
  function setMeta(n) {
    var act = S.acts.filter(function (a) { return a.id === n.act; })[0] || S.acts[0];
    $("#hudAct").textContent = act.no;
    $("#hudTime").textContent = n.time || act.time;
    $("#hudPlace").textContent = n.place || act.place;
  }

  /* ---------- 正文渲染 ---------- */
  function clearTyping() { if (typing) { clearInterval(typing.timer); typing = null; } }

  function finishTyping() {
    if (!typing) return;
    clearInterval(typing.timer);
    typing.node.textContent = typing.text;
    typing = null;
    onLineDone();
  }

  function addLine(l, silent) {
    clearTyping();
    var isNarr = !l.who;
    var d = el("div", "line " + (isNarr ? "is-narr" : "is-dialog") + (l.cls ? " " + l.cls : ""));
    if (l.who) d.appendChild(el("span", "who", l.who === "你" ? "你" : l.who));
    var t = el("span", "txt", "");
    d.appendChild(t);
    $("#textBody").appendChild(d);
    state.history.push({ who: l.who || "", text: l.text });

    if (silent) { t.textContent = l.text; scrollBottom(); return; }

    scrollBottom();
    typing = {
      node: t, text: l.text, timer: null,
      timer: setInterval(function () {
        var cur = t.textContent.length + 1;
        t.textContent = l.text.slice(0, cur);
        scrollBottom();
        if (cur >= l.text.length) {
          clearInterval(typing.timer);
          typing = null;
          onLineDone();
        }
      }, 15)
    };
  }

  function scrollBottom() {
    var b = $("#textBody");
    if (b) b.scrollTop = b.scrollHeight;
  }

  function onLineDone() {
    var n = node();
    if (state.line >= n.lines.length) {
      if (n.choice) showChoices(n);
      else $("#tapHint").hidden = false;
    }
    scrollBottom();
    if (autoMode) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(function () {
        if (autoMode && !typing && !choiceVisible) advance();
      }, n.choice ? 2800 : 1600);
    }
  }

  function revealNext() {
    var n = node();
    if (state.line < n.lines.length) {
      addLine(n.lines[state.line]);
      state.line++;
    }
  }

  function advance() {
    if (!state.started) return;
    if (typing) { finishTyping(); return; }
    if (choiceVisible) return;
    var n = node();
    if (!n) return;
    if (n.choice && state.line >= n.lines.length) { showChoices(n); return; }
    if (state.line < n.lines.length) { revealNext(); return; }

    /* 当前节点台词已全部读完：如果本节点配置了工作日志，先生成并弹出日志手札卡片，再进入下一幕或结局 */
    var proceed = function () {
      if (n.ending) { showEnding(n.ending); return; }
      if (n.next) { startNode(n.next); return; }
    };

    if (n.diary && state.diaries.indexOf(n.diary) < 0) {
      recordDiary(n.diary);
      save();
      showDiaryCard(n.diary, proceed);
      return;
    }
    proceed();
  }

  /* ---------- 节点流转 ---------- */
  function startNode(id) {
    choiceVisible = false;
    clearTyping();
    var oldEnd = document.getElementById("endingStage");
    if (oldEnd) oldEnd.remove();
    document.body.classList.remove("is-ending");

    state.node = id;
    state.line = 0;
    var n = node();
    if (!n) { console.warn("missing node", id); return; }

    if (typeof n.stage === "number" && n.stage > state.stage) state.stage = n.stage;

    setMeta(n);
    if (BG) BG.set(n.mood || "plain", n.bg);

    (n.relics || []).forEach(function (rid) {
      if (state.relics.indexOf(rid) < 0) {
        state.relics.push(rid);
        var r = S.relics.filter(function (x) { return x.id === rid; })[0];
        if (r) setTimeout(function () { toast("收录文物 · " + r.name); }, 600);
      }
    });
    saveMeta();
    renderRelics();
    renderMiniMap();
    save();

    var changed = lastAct && lastAct !== n.act;
    lastAct = n.act;
    if (changed) showActCard(n.act, function () { beginNode(n); });
    else beginNode(n);
  }

  function beginNode(n) {
    sceneNo++;
    var body = $("#textBody");
    body.innerHTML = "";
    body.scrollTop = 0;
    $("#choices").hidden = true;
    $("#choices").innerHTML = "";
    $("#choices").classList.remove("show");
    $("#tapHint").hidden = true;
    $("#stage").classList.remove("is-choosing");
    $("#fileNo").textContent = "檔案 · 第 " + String(sceneNo).padStart(3, "0") + " 號";

    if (n.lines.length === 0) {
      if (n.choice) showChoices(n);
      return;
    }
    revealNext();
  }

  /* ---------- 抉择 ---------- */
  function showChoices(n) {
    if (choiceVisible) return;
    choiceVisible = true;
    $("#tapHint").hidden = true;
    $("#stage").classList.add("is-choosing");

    var box = $("#choices");
    box.innerHTML = "";
    box.appendChild(el("div", "choice-prompt", n.choice.prompt));

    n.choice.options.forEach(function (op) {
      var locked = op.requires && !state.flags[op.requires];
      var b = el("button", "choice" + (locked ? " is-locked" : ""));
      b.innerHTML =
        '<span class="choice-key">' + op.key + "</span>" +
        '<span class="choice-main">' +
        '<span class="choice-title">' + op.title +
        (op.tag ? '<span class="choice-tag">' + op.tag + "</span>" : "") + "</span>" +
        '<span class="choice-sub">' + (op.quote ? "「" + op.quote + "」" : "") +
        (op.desc ? "　" + op.desc : "") + "</span>" +
        (locked && op.lockHint ? '<span class="choice-lock">✕ ' + op.lockHint + "</span>" : "") +
        "</span>";
      if (locked) {
        b.addEventListener("click", function (ev) { ev.stopPropagation(); toast(op.lockHint || "此路尚未开启"); });
      } else {
        b.addEventListener("click", function (ev) { ev.stopPropagation(); choose(op); });
      }
      box.appendChild(b);
    });

    box.hidden = false;
    box.classList.add("show");
    setTimeout(function () { box.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 60);
  }

  function choose(op) {
    state.choicePoints.push(snapshot());
    if (op.flag) for (var k in op.flag) state.flags[k] = op.flag[k];
    if (S.endings[op.to]) { showEnding(op.to); return; }
    startNode(op.to);
  }

  /* ---------- 典守员私人工作日志弹出卡 ---------- */
  function renderDiaryPaperHtml(d, idxNum) {
    var pLabel = idxNum ? ("第" + ["一", "二", "三", "四", "五", "六"][idxNum - 1] + "页") : d.pageNo;
    return (
      '<article class="diary-sheet">' +
      '<div class="ds-head">' +
      '<span class="ds-kicker">故宫博物院 · 典守员私人工作日志</span>' +
      '<span class="ds-seal">' + d.seal + '</span>' +
      '</div>' +
      '<div class="ds-date">' + d.date + '</div>' +
      '<h4 class="ds-vol">' + d.vol + '</h4>' +
      '<div class="ds-role">' + d.roleTag + '</div>' +
      '<div class="ds-lines">' +
      d.lines.map(function (p) { return '<p>' + p + '</p>'; }).join('') +
      '</div>' +
      '<div class="ds-foot">' +
      '<span>典守员的旅程 · ' + pLabel + '</span>' +
      '<em>※ 历史情境互动虚构日记（据南迁史实改编）</em>' +
      '</div>' +
      '</article>'
    );
  }

  function showDiaryCard(diaryId, done) {
    var d = S.diaries && S.diaries[diaryId];
    if (!d) { if (done) done(); return; }

    var wasAuto = autoMode;
    if (autoMode) { clearTimeout(autoTimer); }

    var card = el("div", "diary-pop");
    card.innerHTML =
      '<div class="dp-wrap">' +
      '<div class="dp-badge">✦ 已自动撰入《我的万里典守录》</div>' +
      renderDiaryPaperHtml(d, state.diaries.length) +
      '<div class="dp-actions">' +
      '<button class="btn-primary" id="dpContinue">合上日志 · 继续前行</button>' +
      '</div>' +
      '</div>';

    $("#actcardHost").appendChild(card);
    toast("已记入工作日志 · " + d.vol);

    var closed = false;
    function close(ev) {
      if (ev) ev.stopPropagation();
      if (closed) return;
      closed = true;
      card.classList.add("is-out");
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        if (done) done();
      }, 420);
    }

    var btn = card.querySelector("#dpContinue");
    if (btn) btn.addEventListener("click", close);
    card.addEventListener("click", function (e) {
      if (e.target === card) close(e);
    });
    setTimeout(function () { card.classList.add("is-in"); }, 25);
  }

  /* ---------- 打开《我的万里典守录》完整手札弹窗 ---------- */
  function openDiaryBook(fromEnding) {
    var curList = state.diaries.map(function (id) { return S.diaries[id]; }).filter(Boolean);
    var html = "";

    html += '<div class="diary-book-intro">' +
      '<div class="db-title-row">' +
      '<div><h4>《我的万里典守录》· 个人亲历手札</h4>' +
      '<p>本卷根据你在每一幕的抉择与亲历路线实时生成。不同的去留立场、护展决定与西迁路线，皆会留下截然不同的私人工作日志。</p></div>' +
      (curList.length ? '<button class="btn-ghost db-export-btn" id="btnExportDiary">导出 / 抄录全文</button>' : '') +
      '</div></div>';

    if (!curList.length) {
      html += '<div class="diary-empty">当前旅程尚未完成第一幕启运，暂未写下工作日志。<br>随着每幕落定，你的私人手札将自动在此成册。</div>';
    } else {
      html += '<div class="diary-book-list">' +
        curList.map(function (d, idx) { return renderDiaryPaperHtml(d, idx + 1); }).join("") +
        '</div>';
    }

    /* 展示跨周目已收集的全分支手札进度 */
    var totalKeys = Object.keys(S.diaries || {});
    html += '<div class="diary-meta-bar">' +
      '<span>本趟已写：<b>' + curList.length + '</b> 页</span>' +
      '<span>全分支手札收集：<b>' + state.allDiaries.length + ' / ' + totalKeys.length + '</b> 篇</span>' +
      '<span>注：本手札为第一人称历史互动虚构日记</span>' +
      '</div>';

    openModal("我的万里典守录 · 典守员工作日志", html);

    var expBtn = document.getElementById("btnExportDiary");
    if (expBtn) {
      expBtn.addEventListener("click", function () {
        var txt = "========================================\n" +
          "《我的万里典守录》· 典守员私人工作日志\n" +
          "（基于故宫文物南迁 1933—1949 历史情境虚构日记）\n" +
          "========================================\n\n";
        curList.forEach(function (d, i) {
          txt += "【第" + (i + 1) + "页】" + d.vol + "\n" +
            "时间与地点：" + d.date + "\n" +
            "身份与经历：" + d.roleTag + "\n\n" +
            d.lines.join("\n") + "\n\n" +
            "—— 典守员的旅程 · 第" + (i + 1) + "页 ——\n\n";
        });
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            toast("已将整本《我的万里典守录》复制到剪贴板");
          }).catch(function () { downloadDiaryTxt(txt); });
        } else {
          downloadDiaryTxt(txt);
        }
      });
    }
  }

  function downloadDiaryTxt(txt) {
    var blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "我的万里典守录_典守员工作日志.txt";
    a.click();
    toast("已为你导出《我的万里典守录》文本手札");
  }

  /* ---------- 幕次卡 ---------- */
  function showActCard(actId, done) {
    var a = S.acts.filter(function (x) { return x.id === actId; })[0];
    if (!a) { done(); return; }
    var idx = S.acts.indexOf(a);
    var card = el("div", "actcard");
    card.innerHTML =
      '<div class="ac-inner">' +
      '<div class="ac-left"><div class="ac-num">' + String(idx + 1).padStart(2, "0") + "</div>" +
      '<div class="ac-line"></div></div>' +
      '<div class="ac-title">' + a.name + "</div>" +
      '<div class="ac-meta">' +
      '<div class="ac-no">' + a.no + "</div>" +
      '<div class="ac-sub">' + a.sub + "</div>" +
      '<div class="ac-time">' + a.time + "</div>" +
      '<div class="ac-place">' + a.place + "</div>" +
      "</div></div>" +
      '<div class="ac-hint">点击继续</div>';
    $("#actcardHost").appendChild(card);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      card.classList.add("is-out");
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        done();
      }, 520);
    }
    card.addEventListener("click", close);
    setTimeout(close, 2800);
    setTimeout(function () { card.classList.add("is-in"); }, 30);
  }

  /* ---------- 结局 ---------- */
  /* 这一趟实际走过的路（文字摘要） */
  function journeyText(eid) {
    var r = state.flags.route;
    if (!r) return "北平 · 独自留守";
    var br = { south: "汉口 · 长沙 · 安顺 · 重庆", mid: "汉口 · 宜昌 · 重庆", west: "徐州 · 宝鸡 · 汉中 · 成都 · 峨嵋" }[r] || "";
    if (eid === "e5") return "北平 → 上海 → 南京 → " + br + "（以身护箱）";
    var s = "北平 → 上海 → 南京 → " + br;
    if (eid === "e1") s += " → 南京 → 北平";
    else if (eid === "e2") s += " → 南京 → 上海 → 基隆";
    else if (eid === "e3") s += " → 南京";
    else s += " → 南京";
    return s;
  }

  function showEnding(eid) {
    var e = S.endings[eid];
    if (!e) return;
    if (e.stage && e.stage > state.stage) state.stage = e.stage;

    /* 自动把结局对应的终册日志写入《我的万里典守录》 */
    if (e.diary) {
      recordDiary(e.diary);
    }

    if (state.endings.indexOf(eid) < 0) {
      state.endings.push(eid);
      saveMeta();
      setTimeout(function () { toast("结局收录 · " + e.title); }, 700);
    }
    renderMiniMap();
    save();
    document.body.classList.add("is-ending");

    var old = document.getElementById("endingStage");
    if (old) old.remove();

    var mapHtml = MAP.render({
      stage: e.stage || state.stage,
      chosen: state.flags.route,
      london: state.flags.london,
      id: "ek",
      detail: true,
      extra: eid === "e1" ? "beifan" : null
    });

    /* 生成当前周目完整《我的万里典守录》日志内嵌预览 */
    var curDiaries = state.diaries.map(function (id) { return S.diaries[id]; }).filter(Boolean);
    var diaryBookHtml = "";
    if (curDiaries.length) {
      diaryBookHtml =
        '<div class="ek-diary-section">' +
        '<div class="ek-diary-head">' +
        '<div><h3>《我的万里典守录》· 完整亲历手札（共 ' + curDiaries.length + ' 页）</h3>' +
        '<p>根据你在此趟旅程中的每一次抉择生成 · 正式版历史互动虚构日记</p></div>' +
        '<button class="btn-ghost" id="ekOpenFullDiary">单独翻阅 / 导出手札</button>' +
        '</div>' +
        '<div class="ek-diary-grid">' +
        curDiaries.map(function (d, idx) { return renderDiaryPaperHtml(d, idx + 1); }).join("") +
        '</div>' +
        '</div>';
    }

    var wrap = el("div", "ending-stage");
    wrap.id = "endingStage";
    if (e.bg) {
      wrap.classList.add("has-art");
      wrap.style.backgroundImage = 'url("' + e.bg + '")';
    }
    wrap.innerHTML =
      '<div class="ending-card-big">' +
      '<div class="ending-seal">' + e.seal + "</div>" +
      '<div class="ek-kicker">' + e.no + " · " + e.kind + "</div>" +
      "<h2>" + e.title + "</h2>" +
      '<div class="ek-sub">' + e.sub + "</div>" +
      '<div class="ek-grid">' +
      '<div class="ek-body">' + e.text.map(function (t) { return "<p>" + t + "</p>"; }).join("") + "</div>" +
      '<aside class="ek-side">' +
      '<div class="ek-side-title">此行所历</div>' +
      '<div class="ek-map">' + mapHtml + "</div>" +
      '<div class="ek-route-cap"><b>' + journeyText(eid) + "</b>实线与朱色为亲历之路，虚线为未择或归途；路线为史实示意。</div>" +
      "</aside>" +
      "</div>" +
      diaryBookHtml +
      '<div class="ek-actions">' +
      '<button class="btn-primary" id="ekDiaryBtn">翻阅《我的万里典守录》</button>' +
      '<button class="btn-ghost" id="ekAgain">再走一遍</button>' +
      '<button class="btn-ghost" id="ekBack">回到上一次抉择</button>' +
      '<button class="btn-ghost" id="ekAlbum">结局图鉴</button>' +
      "</div></div>";
    document.body.appendChild(wrap);

    document.getElementById("ekDiaryBtn").addEventListener("click", function () { openDiaryBook(true); });
    var fullBtn = document.getElementById("ekOpenFullDiary");
    if (fullBtn) fullBtn.addEventListener("click", function () { openDiaryBook(true); });
    document.getElementById("ekAgain").addEventListener("click", restart);
    document.getElementById("ekBack").addEventListener("click", backToChoice);
    document.getElementById("ekAlbum").addEventListener("click", openEndings);
  }

  function backToChoice() {
    if (!state.choicePoints.length) { toast("这一程还没有分岔"); return; }
    var snap = state.choicePoints.pop();
    restore(snap);
    var w = document.getElementById("endingStage");
    if (w) w.remove();
    document.body.classList.remove("is-ending");
    startNode(state.node);
    toast("回到上一个分岔口");
  }

  function restart() {
    if (!confirm("重新开始？这一趟的进度会清零，但已收录的文物、结局与全分支日志图鉴会保留。")) return;
    /* 只清"这一趟"的进度；结局与文物属于收藏，跨周目保留 */
    state.flags = {}; state.history = []; state.stage = 1;
    state.diaries = [];
    state.choicePoints = [];
    updateDiaryCount();
    var w = document.getElementById("endingStage");
    if (w) w.remove();
    document.body.classList.remove("is-ending");
    lastAct = null; sceneNo = 0;
    startNode(S.start);
  }

  /* ---------- 文物 ---------- */
  function dimArt() {
    return '<svg viewBox="0 0 200 200"><rect x="60" y="60" width="80" height="80" fill="none" stroke="#6b5b49" stroke-width="1" stroke-dasharray="3 5"/><text x="100" y="106" text-anchor="middle" fill="#6b5b49" font-size="12" font-family="serif">?</text></svg>';
  }

  function renderRelics() {
    var grid = $("#relicGrid");
    if (!grid) return;
    grid.innerHTML = "";
    S.relics.forEach(function (r) {
      var on = state.relics.indexOf(r.id) >= 0;
      var card = el("div", "relic" + (on ? "" : " is-locked"));
      card.innerHTML =
        '<div class="relic-art">' + (on ? ART[r.art] : dimArt()) + "</div>" +
        '<div class="relic-name">' + (on ? r.name : "未 收 录") + "</div>" +
        '<div class="relic-tag">' + (on ? r.tag : "· · · · ·") + "</div>";
      if (on) card.addEventListener("click", function () { openRelic(r.id); });
      grid.appendChild(card);
    });
    $("#relicCount").textContent = state.relics.length + "/" + S.relics.length;
  }

  function openRelic(id) {
    var list = S.relics.filter(function (r) { return state.relics.indexOf(r.id) >= 0; });
    var idx = list.map(function (r) { return r.id; }).indexOf(id);
    if (idx < 0) return;
    showRelicOverlay(list, idx);
  }

  function showRelicOverlay(list, idx) {
    currentRelic = { list: list, idx: idx };
    var r = list[idx];
    $("#ovTitle").textContent = "文物鉴赏 · " + r.name;
    $("#ovPrev").hidden = $("#ovNext").hidden = list.length < 2;
    var thumbs = list.map(function (x, i) {
      return '<button class="ov-thumb' + (i === idx ? " is-on" : "") + '" data-i="' + i + '">' + ART[x.art] + "</button>";
    }).join("");
    $("#overlayBody").innerHTML =
      '<div class="ov-relic">' +
      '<div class="ov-art">' + ART[r.art] + "</div>" +
      '<div class="ov-info">' +
      '<div class="ov-kicker">' + r.year + " · " + r.tag + "</div>" +
      '<h2 class="ov-name">' + r.name + "</h2>" +
      '<div class="ov-sub">' + r.sub + "</div>" +
      '<div class="ov-line"></div>' +
      '<p class="ov-note">' + r.note + "</p>" +
      '<div class="ov-source">' + r.source + "</div>" +
      '<div class="ov-thumbs">' + thumbs + "</div>" +
      "</div></div>";
    $("#overlay").hidden = false;
    $$(".ov-thumb", $("#overlayBody")).forEach(function (t) {
      t.addEventListener("click", function () { showRelicOverlay(list, +t.dataset.i); });
    });
  }

  /* ---------- 地图 ---------- */
  var STAGE_LABEL = { 1: "北平", 2: "北平 → 上海", 3: "上海 → 伦敦", 4: "南京", 5: "三路西迁", 6: "东归南京", 7: "渡海" };

  function renderMiniMap() {
    var box = $("#mapMini");
    if (!box) return;
    box.innerHTML = MAP.render({ stage: state.stage, chosen: state.flags.route, london: state.flags.london, id: "mini", detail: true });
    $("#mapStageLabel").textContent = STAGE_LABEL[state.stage] || "北平";
  }

  function openMap() {
    var stage = state.stage, chosen = state.flags.route;
    $("#ovTitle").textContent = "万里行程 · 1933—1949";
    $("#ovPrev").hidden = $("#ovNext").hidden = true;
    var rows = S.routes.filter(function (r) { return stage >= r.stage; }).map(function (r) {
      var isB = ["south", "mid", "west"].indexOf(r.id) >= 0;
      var ghost = isB && chosen && chosen !== r.id;
      var names = r.via.map(function (id) { return id === "exit" ? "出洋" : S.cities[id].name; }).join(" · ");
      return '<div class="ov-route' + (ghost ? " is-ghost" : "") + '"><i></i><div><b>' + r.name + "</b>" + names + "</div></div>";
    }).join("");
    $("#overlayBody").innerHTML =
      '<div class="ov-map">' +
      '<div class="ov-map-canvas">' + MAP.render({ stage: stage, chosen: chosen, london: state.flags.london, id: "big", detail: false }) + "</div>" +
      '<div class="ov-map-side"><h4>已行之路</h4><div class="ov-routes">' + rows + "</div>" +
      '<div class="ov-map-note">底图据 Natural Earth 1:110m 国界简化；路线为史实示意，非精确测绘。</div></div></div>';
    $("#overlay").hidden = false;
  }

  /* ---------- 浮层 / 弹窗 ---------- */
  function closeOverlay() { $("#overlay").hidden = true; }
  function closeModal() { $("#modal").hidden = true; }
  function openModal(title, html) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = html;
    $("#modal").hidden = false;
  }

  $("#ovClose").addEventListener("click", closeOverlay);
  $("#overlay").addEventListener("click", function (e) {
    if (e.target === $("#overlay") || e.target.classList.contains("overlay-body")) closeOverlay();
  });
  $("#ovPrev").addEventListener("click", function () {
    if (!currentRelic) return;
    showRelicOverlay(currentRelic.list, (currentRelic.idx - 1 + currentRelic.list.length) % currentRelic.list.length);
  });
  $("#ovNext").addEventListener("click", function () {
    if (!currentRelic) return;
    showRelicOverlay(currentRelic.list, (currentRelic.idx + 1) % currentRelic.list.length);
  });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", function (e) { if (e.target === $("#modal")) closeModal(); });

  function openSaves() {
    var saves = [];
    try { saves = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); } catch (e) { }
    var html = '<div class="slots">';
    for (var i = 0; i < 3; i++) {
      var s = saves[i];
      if (s) {
        var n = S.nodes[s.node] || {};
        html += '<div class="slot" data-load="' + i + '"><div class="slot-no">卷 ' + (i + 1) + "</div>" +
          '<div class="slot-main"><b>' + (n.place || "—") + "・" + (n.time || "") + "</b>" +
          "<span>" + new Date(s.at).toLocaleString("zh-CN") + " · 日志 " + (s.diaries || []).length + " 页 · 文物 " + (s.relics || []).length + " 件</span></div>" +
          '<div class="slot-del" data-del="' + i + '">删除</div></div>';
      } else {
        html += '<div class="slot" data-save="' + i + '"><div class="slot-no">卷 ' + (i + 1) + "</div>" +
          '<div class="slot-main"><b>空 卷</b><span class="slot-empty">点击存入当前进度</span></div></div>';
      }
    }
    html += "</div><p style='margin-top:16px;font-size:12px;color:#7b7364'>自动存档在每次换场时更新；「卷」为手动存档，可存三处。</p>";
    openModal("卷宗 · 存取", html);

    $$("[data-save]", $("#modalBody")).forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = +b.dataset.save;
        saves[idx] = snapshot();
        localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
        toast("已存入卷 " + (idx + 1));
        closeModal(); openSaves();
      });
    });
    $$("[data-load]", $("#modalBody")).forEach(function (b) {
      b.addEventListener("click", function () {
        restore(saves[+b.dataset.load]);
        closeModal();
        startNode(state.node);
        toast("已读取卷宗");
      });
    });
    $$("[data-del]", $("#modalBody")).forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var idx = +b.dataset.del;
        saves.splice(idx, 1);
        saves = saves.filter(Boolean);
        localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
        openSaves();
      });
    });
  }

  function openHistory() {
    if (!state.history.length) { toast("尚无已读记录"); return; }
    var html = state.history.map(function (h) {
      return "<p>" + (h.who ? "<b style='color:#d9b877;font-family:var(--kai)'>" + h.who + "　</b>" : "") + h.text + "</p>";
    }).join("");
    openModal("回想 · 已读", html);
    setTimeout(function () { var b = $("#modalBody"); b.scrollTop = b.scrollHeight; }, 30);
  }

  function openEndings() {
    var html = '<div class="endings-grid">';
    Object.keys(S.endings).forEach(function (k) {
      var e = S.endings[k], on = state.endings.indexOf(k) >= 0;
      html += '<div class="ending-card' + (on ? "" : " is-locked") + '">' +
        '<div><div class="ec-no">' + e.no + " · " + e.kind + "</div>" +
        '<div class="ec-title">' + (on ? e.title : "？？？？") + "</div>" +
        '<div class="ec-sub">' + (on ? e.sub : "尚未抵达") + "</div></div>" +
        '<div class="ec-kind">' + (on ? "已收录" : "未解锁") + "</div>" +
        (on ? '<div class="ec-seal">' + e.seal + "</div>" : "") + "</div>";
    });
    html += "</div><p style='margin-top:18px;font-size:12px;color:#7b7364'>结局三需在第二幕选择「请缨加入海外护展团」；结局四、五分别藏在第一幕与第三幕的分岔里。已收录的结局与文物会跨周目保留。</p>" +
      "<p style='margin-top:2px'><a href='#' id='resetMeta' style='color:#b06a52;font-size:11.5px;text-decoration:none;border-bottom:1px dotted #7a3a2a'>清空收集记录</a></p>";
    openModal("结局图鉴 · " + state.endings.length + " / " + Object.keys(S.endings).length, html);

    var rm = document.getElementById("resetMeta");
    if (rm) rm.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!confirm("清空全部收集记录（结局、文物与日志图鉴）？此操作不可撤销。")) return;
      state.endings = []; state.relics = []; state.allDiaries = [];
      try { localStorage.removeItem(META_KEY); } catch (e) { }
      renderRelics();
      closeModal();
      openEndings();
      toast("收集记录已清空");
    });
  }

  function openAbout() {
    var html =
      "<p><b style='color:#e6d6b6'>这是一部怎样的作品</b><br>" +
      "《档案里的木箱山河：故宫南迁万里录》以第一人称视角重走 1933—1949 年故宫文物南迁之路。五次抉择决定你走上哪条线，每幕结束自动生成专属《典守员私人工作日志》，最终汇编成属于你自己的《我的万里典守录》。</p>" +
      "<p><b style='color:#e6d6b6'>操作</b><br>" +
      "点击画面推进；有抉择时点选项。空格 / 回车 = 继续，Esc = 关闭浮层。<br>" +
      "顶栏「日志」可随时翻阅已生成的《我的万里典守录》；左侧「文物」抽拉栏随剧情解锁；右下角小图是南迁路线。</p>" +
      "<p><b style='color:#e6d6b6'>史料依据</b><br>" +
      S.sources.map(function (s) { return '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + "</a>"; }).join("<br>") +
      "</p><p style='font-size:12px;color:#7b7364'>说明：叙事文本依据剧本原稿整理；典守员私人工作日志为基于史实情境创作的游戏虚构日记；文物插图为手绘矢量示意；地图路线为史实示意。</p>";
    openModal("史料与说明", html);
  }

  /* ---------- 交互 ---------- */
  $("#btnRelics").addEventListener("click", function () {
    var d = $("#relicDrawer");
    d.classList.toggle("is-open");
    d.setAttribute("aria-hidden", d.classList.contains("is-open") ? "false" : "true");
    renderRelics();
  });
  $("#drawerClose").addEventListener("click", function () {
    $("#relicDrawer").classList.remove("is-open");
  });
  $("#btnMap").addEventListener("click", openMap);

  $("#btnAuto").addEventListener("click", function () {
    autoMode = !autoMode;
    this.classList.toggle("is-on", autoMode);
    if (autoMode && !typing && !choiceVisible) advance();
    else clearTimeout(autoTimer);
  });
  $("#btnSkip").addEventListener("click", function (e) {
    e.stopPropagation();
    if (typing) finishTyping();
    var n = node();
    if (state.line < n.lines.length) {
      while (state.line < n.lines.length) { addLine(n.lines[state.line], true); state.line++; }
      onLineDone();
    } else advance();
  });
  $("#btnReplay").addEventListener("click", function (e) { e.stopPropagation(); backToChoice(); });

  $$(".hud-actions button").forEach(function (b) {
    b.addEventListener("click", function () {
      var a = b.dataset.act;
      if (a === "diary") openDiaryBook(false);
      else if (a === "history") openHistory();
      else if (a === "save") openSaves();
      else if (a === "endings") openEndings();
      else if (a === "about") openAbout();
    });
  });

  $("#stage").addEventListener("click", function (ev) {
    if (ev.target.closest(".choice") || ev.target.closest(".sub-ctrl")) return;
    advance();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      closeOverlay(); closeModal();
      $("#relicDrawer").classList.remove("is-open");
      return;
    }
    if (!$("#overlay").hidden || !$("#modal").hidden) return;
    if ($("#actcardHost").children.length > 0) {
      var dpBtn = $("#dpContinue");
      if (dpBtn && (ev.key === " " || ev.key === "Enter")) {
        ev.preventDefault();
        dpBtn.click();
      }
      return;
    }
    if (ev.key === " " || ev.key === "Enter" || ev.key === "ArrowRight") {
      if (ev.target.tagName === "BUTTON") return;
      ev.preventDefault();
      advance();
    }
    if (/^[1-9]$/.test(ev.key) && choiceVisible) {
      var btns = $$(".choice:not(.is-locked)");
      if (btns[+ev.key - 1]) btns[+ev.key - 1].click();
    }
  });

  /* ---------- 启动 ---------- */
  if (BG) {
    BG.init();
    BG.set("night");

    /* 排队预载插画：一张一张来，换场时不会白一下；流量/慢网下直接跳过 */
    var conn = navigator.connection || {};
    if (!conn.saveData && !/2g/.test(conn.effectiveType || "")) {
      var list = [], seen = {};
      Object.keys(S.nodes).forEach(function (k) {
        var b = S.nodes[k].bg;
        if (b && !seen[b]) { seen[b] = 1; list.push(b); }
      });
      Object.keys(S.endings).forEach(function (k) {
        var b = S.endings[k].bg;
        if (b && !seen[b]) { seen[b] = 1; list.push(b); }
      });
      var idx = 0;
      setTimeout(function step() {
        if (idx >= list.length) return;
        BG.preload([list[idx++]]);
        setTimeout(step, 400);
      }, 1400);
    }
  }

  var autoSave = null;
  try { autoSave = JSON.parse(localStorage.getItem(AUTO_KEY) || "null"); } catch (e) { }
  if (autoSave && autoSave.node) {
    var cb = $("#btnContinue");
    cb.hidden = false;
    var nn = S.nodes[autoSave.node] || {};
    cb.textContent = "续上旧档 · " + (nn.time || "上一程");
    cb.addEventListener("click", function () {
      restore(autoSave);
      state.started = true;
      $("#curtain").classList.add("is-off");
      startNode(state.node);
    });
  }

  $("#btnStart").addEventListener("click", function () {
    state.started = true;
    state.node = S.start; state.line = 0; state.stage = 1;
    state.flags = {}; state.diaries = []; state.history = []; state.choicePoints = [];
    updateDiaryCount();
    lastAct = null; sceneNo = 0;
    $("#curtain").classList.add("is-off");
    startNode(S.start);
  });

  /* ---------- 载入跨周目收藏 ---------- */
  var meta = loadMeta();
  state.relics = meta.relics.slice();
  state.endings = meta.endings.slice();
  state.allDiaries = meta.allDiaries.slice();

  updateDiaryCount();
  renderRelics();
  renderMiniMap();
})();