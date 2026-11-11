/* FlareBible — reader app (CUV + KJV + CCB + LZZ + ESV) */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- state ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("nb:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("nb:" + k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign(
  { theme: "dark", version: "cuv", font: "medium", line: "normal", showNums: true, showHeadings: true, poetry: true, copyFormat: "numbered" },
  store.get("settings", {})
);
let books = null;            // index.json
let bookCache = {};          // abbrev -> {cuv} / abbrev-en -> {kjv} / abbrev-ccb / abbrev-lzz
let searchData = null;       // lazy
let headings = null;         // lazy
let current = { book: "gen", chapter: 1 }; // current reading position
let currentVerses = [];      // verse texts of the chapter currently displayed
let currentHeadings = null;  // per-book headings of the current chapter's book (CCB)

/* ---------- versions ---------- */
// id -> {label, dir, copyright, api?}
const VERSIONS = {
  cuv: { label: "和合本", dir: "data/books/", note: "中文 · 新标点和合本（简体）",
         copyright: "和合本 © 1995 Hong Kong Bible Society" },
  kjv: { label: "KJV", dir: "data/books-en/", note: "English · King James Version",
         copyright: "King James Version（公有领域）" },
  ccb: { label: "当代译本", dir: "data/books-ccb/", note: "中文 · 当代译本（简体）",
         copyright: "当代译本 © 1979, 2005, 2007, 2011, 2022 Biblica, Inc.（CC BY-SA 4.0 开放资源）" },
  lzz: { label: "吕振中", dir: "data/books-lzz/", note: "中文 · 吕振中译本（简体）",
         copyright: "吕振中译本（1970，著作权保护期已满）" },
  esv: { label: "ESV", dir: null, note: "English · English Standard Version",
         copyright: "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway. Used by permission. All rights reserved." },
};
const ESV_API = "https://api.esv.org/v3/passage/text/";

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 1800);
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function bookByAbbrev(a) { return books ? books.find((b) => b.abbrev === a) : null; }
function bookIndex(a) { return books ? books.findIndex((b) => b.abbrev === a) : -1; }
function chapterCount(abbrev) { const b = bookByAbbrev(abbrev); return b ? b.chapters : 0; }
function refLabel(abbrev, chapter, verse) {
  const b = bookByAbbrev(abbrev);
  if (!b) return "";
  let s = b.name + " " + chapter + "章";
  if (verse != null) s += verse + "节";
  return s;
}
function verseKey(abbrev, chapter, verse) { return abbrev + ":" + chapter + ":" + verse; }
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

/* ---------- data loading ---------- */
async function loadIndex() {
  if (books) return books;
  const r = await fetch("data/index.json");
  books = await r.json();
  return books;
}
async function loadBook(abbrev, version) {
  if (version === "esv") return loadBookESV(abbrev);
  const ver = VERSIONS[version] || VERSIONS.cuv;
  const key = abbrev + "-" + version;
  if (bookCache[key]) return bookCache[key];
  const r = await fetch(ver.dir + abbrev + ".json");
  const data = await r.json();
  bookCache[key] = data;
  return data;
}
function esvToken() { return (store.get("esvToken", "") || "").trim(); }
let esvChapterCache = {};    // "abbrev:chapter" -> [verses]
async function loadChapterESV(abbrev, chapter) {
  // ESV text comes from Crossway's official API, one chapter at a time.
  // The token is the user's own free key (api.esv.org), stored on their device.
  const key = abbrev + ":" + chapter;
  if (esvChapterCache[key]) return esvChapterCache[key];
  const token = esvToken();
  if (!token) throw new Error("ESV_NEED_TOKEN");
  const book = bookByAbbrev(abbrev);
  const ref = book.name + " " + chapter;
  const url = ESV_API + "?q=" + encodeURIComponent(ref) +
    "&include-passage-references=false&include-footnotes=false" +
    "&include-verse-numbers=true&include-headings=false" +
    "&include-short-copyright=false";
  const r = await fetch(url, { headers: { Authorization: "Token " + token } });
  if (!r.ok) throw new Error("ESV_API_" + r.status);
  const j = await r.json();
  const verses = parseEsvPassage(j.passages ? j.passages[0] : "");
  esvChapterCache[key] = verses;
  return verses;
}
async function loadBookESV(abbrev) {
  // Compatibility shim: returns a book-shaped object whose chapters are
  // filled lazily. renderChapter uses loadChapterESV for ESV, so this is
  // only used where a book object is needed (chapter counts come from index).
  const book = bookByAbbrev(abbrev);
  return { abbrev, name: book.name, testament: book.testament,
           chapters: Array.from({ length: book.chapters }, () => []) };
}
function parseEsvPassage(text) {
  // ESV API plain text marks verses as [16] For God so loved...
  // Split on [N] markers into a verse array.
  const verses = [];
  const re = /\[(\d+)\]\s*/g;
  let m, lastNum = 0;
  const parts = [];
  while ((m = re.exec(text)) !== null) {
    parts.push({ num: parseInt(m[1], 10), start: m.index, end: re.lastIndex });
  }
  if (!parts.length) return text.trim() ? [text.trim()] : [];
  for (let i = 0; i < parts.length; i++) {
    const nextStart = i + 1 < parts.length ? parts[i + 1].start : text.length;
    const vtext = text.slice(parts[i].end, nextStart).replace(/\s+/g, " ").trim();
    while (lastNum + 1 < parts[i].num) { verses.push(""); lastNum++; }
    verses.push(vtext);
    lastNum = parts[i].num;
  }
  return verses;
}
async function loadHeadings() {
  if (headings) return headings;
  try {
    const r = await fetch("data/headings.json");
    headings = await r.json();
  } catch (e) { headings = {}; }
  return headings;
}
async function loadSearch() {
  if (searchData) return searchData;
  const r = await fetch("data/search.json");
  searchData = await r.json();
  return searchData;
}

/* ---------- theme & settings ---------- */
function applySettings() {
  document.documentElement.setAttribute("data-theme", settings.theme);
  $("#btn-theme").textContent = settings.theme === "dark" ? "◐" : "☀";
  $("#set-versenums").checked = settings.showNums;
  $("#set-headings").checked = settings.showHeadings;
  $("#set-poetry").checked = settings.poetry;
  $$("#seg-font button").forEach((b) => b.classList.toggle("active", b.dataset.f === settings.font));
  $$("#seg-line button").forEach((b) => b.classList.toggle("active", b.dataset.l === settings.line));
  $$("#seg-copyfmt button").forEach((b) => b.classList.toggle("active", b.dataset.cf === (settings.copyFormat || "numbered")));
  const v = $("#verses");
  v.classList.toggle("font-small", settings.font === "small");
  v.classList.toggle("font-large", settings.font === "large");
  v.classList.toggle("font-xlarge", settings.font === "xlarge");
  v.classList.toggle("line-tight", settings.line === "tight");
  v.classList.toggle("line-loose", settings.line === "loose");
  store.set("settings", settings);
}
function versionLabel() {
  if (settings.version === "parallel") return "对照";
  const v = VERSIONS[settings.version];
  return v ? v.label : "和合本";
}
function versionCopyright() {
  if (settings.version === "parallel") return VERSIONS.cuv.copyright + " · " + VERSIONS.kjv.copyright;
  const v = VERSIONS[settings.version];
  return v ? v.copyright : VERSIONS.cuv.copyright;
}

/* ---------- views / router ---------- */
const views = ["home", "read", "verse", "search", "bookmarks", "plan"];
function showView(name) {
  views.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== name));
  $$(".bottomnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name || (name === "verse" && a.dataset.nav === "read") || (name === "read" && a.dataset.nav === "read")));
  window.scrollTo({ top: 0 });
}
function route() {
  const h = location.hash || "#/";
  const parts = h.replace(/^#\/?/, "").split("/");
  const page = parts[0] || "";
  if (page === "read") {
    const abbrev = parts[1] || current.book;
    const ch = parseInt(parts[2], 10) || 1;
    showView("read");
    renderChapter(abbrev, ch);
  } else if (page === "verse") {
    const abbrev = parts[1] || "gen";
    const ch = parseInt(parts[2], 10) || 1;
    const v = parseInt(parts[3], 10) || 1;
    showView("verse");
    renderVerse(abbrev, ch, v);
  } else if (page === "search") {
    showView("search");
    const q = new URLSearchParams(location.hash.split("?")[1] || "").get("q");
    if (q) { $("#search-input").value = q; doSearch(q); }
  } else if (page === "bookmarks") {
    showView("bookmarks");
    renderBookmarks();
  } else if (page === "plan") {
    showView("plan");
    renderPlan();
  } else {
    showView("home");
    renderHome();
  }
}
window.addEventListener("hashchange", route);

/* ---------- home ---------- */
const DAILY_VERSES = [
  ["gen", 1, 1], ["jhn", 3, 16], ["psa", 23, 1], ["pro", 3, 5], ["isa", 41, 10],
  ["mat", 11, 28], ["rom", 8, 28], ["php", 4, 13], ["psa", 119, 105], ["jer", 29, 11],
  ["mat", 6, 33], ["jhn", 14, 27], ["psa", 46, 1], ["gal", 5, 22], ["heb", 11, 1],
  ["1co", 13, 4], ["rom", 12, 2], ["psa", 27, 1], ["isa", 40, 31], ["mat", 5, 3],
  ["jhn", 8, 12], ["psa", 34, 8], ["rom", 15, 13], ["eph", 2, 8], ["psa", 19, 1],
  ["mat", 28, 20], ["jhn", 10, 10], ["psa", 37, 4], ["pro", 18, 10], ["isa", 55, 8],
  ["luk", 12, 32],
];
async function renderHome() {
  await loadIndex();
  const ot = books.filter((b) => b.testament === "OT");
  const nt = books.filter((b) => b.testament === "NT");
  const grid = (list) => list.map((b) =>
    `<button data-book="${b.abbrev}">${esc(b.name)}<small>${b.chapters} 章</small></button>`).join("");
  $("#grid-ot").innerHTML = grid(ot);
  $("#grid-nt").innerHTML = grid(nt);
  $$("#grid-ot button, #grid-nt button").forEach((b) =>
    b.addEventListener("click", () => { location.hash = "#/read/" + b.dataset.book + "/1"; }));
  // daily verse
  const d = new Date();
  $("#daily-date").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日";
  const pick = DAILY_VERSES[dayOfYear() % DAILY_VERSES.length];
  const book = await loadBook(pick[0], "cuv");
  const text = book.chapters[pick[1] - 1][pick[2] - 1];
  $("#daily-verse-text").textContent = "“" + text + "”";
  $("#daily-verse-ref").textContent = "— " + refLabel(pick[0], pick[1], pick[2]);
  $("#btn-daily-read").onclick = () => { location.hash = "#/read/" + pick[0] + "/" + pick[1]; };
  const last = store.get("lastRead", null);
  $("#btn-continue").onclick = () => {
    if (last) location.hash = "#/read/" + last.book + "/" + last.chapter;
    else location.hash = "#/read/gen/1";
  };
  $("#btn-continue").textContent = last ? "继续阅读 · " + refLabel(last.book, last.chapter) : "开始阅读 · 创世记 1章";
}

/* ---------- reader ---------- */
let selSet = new Set();          // selected verse numbers in current chapter (tap to select, wd.bible style)
function isPoetryBook(abbrev) {
  return ["job", "psa", "pro", "ecc", "sng"].includes(abbrev);
}
function headingFor(abbrev, chapter, verse) {
  // CCB books carry their own native headings; other versions use the shared file.
  if (currentHeadings && currentHeadings[String(chapter)]) {
    const h = currentHeadings[String(chapter)].find((x) => x.verse === verse);
    if (h) return h;
  }
  if (!headings || !headings[abbrev]) return null;
  const list = headings[abbrev][String(chapter)] || [];
  return list.find((h) => h.verse === verse) || null;
}
async function renderChapter(abbrev, chapter) {
  await loadIndex();
  const book = bookByAbbrev(abbrev);
  if (!book) { location.hash = "#/read/gen/1"; return; }
  chapter = Math.max(1, Math.min(chapter, book.chapters));
  // Navigating to a different chapter clears any verse selection.
  if (current.book !== abbrev || current.chapter !== chapter) {
    selSet.clear();
    syncSelUI();
  }
  current = { book: abbrev, chapter };
  store.set("lastRead", current);
  // history
  const hist = store.get("history", []);
  const entry = { book: abbrev, chapter, t: Date.now() };
  const filtered = hist.filter((h) => !(h.book === abbrev && h.chapter === chapter));
  filtered.unshift(entry);
  store.set("history", filtered.slice(0, 30));
  await loadHeadings();
  const parallel = settings.version === "parallel";
  const activeVer = parallel ? "cuv" : settings.version;
  let verses, versesEn = null, bookData = null;
  try {
    if (activeVer === "esv") {
      verses = await loadChapterESV(abbrev, chapter);
      currentHeadings = null;
    } else {
      bookData = await loadBook(abbrev, activeVer);
      verses = bookData.chapters[chapter - 1];
      currentHeadings = bookData.headings || null;
    }
    if (parallel) {
      const kjv = await loadBook(abbrev, "kjv");
      versesEn = kjv.chapters[chapter - 1];
    }
  } catch (e) {
    // ESV without a token, or the ESV API failed
    const vEl = $("#verses");
    $("#reader-book").textContent = book.name;
    $("#reader-chapter").textContent = "第 " + chapter + " 章";
    $("#btn-version").textContent = versionLabel();
    $("#reader-title").textContent = book.name + " 第 " + chapter + " 章";
    $("#reader-meta").textContent = (book.testament === "OT" ? "旧约" : "新约") + " · 共 " + book.chapters + " 章 · " + versionLabel();
    if (String(e.message || "").indexOf("ESV_NEED_TOKEN") === 0) {
      vEl.innerHTML = `<p class="search-empty">ESV 译本需使用 Crossway 官方 API 密钥（免费）。<br><br>请到 <a href="https://api.esv.org/" target="_blank" rel="noopener">api.esv.org</a> 注册一个免费账号并创建 API 应用，把密钥填到「设置 → ESV API 密钥」里，即可在线阅读 ESV 全文。<br><br>ESV 文本由 Crossway 实时提供，本站不存储 ESV 全文。</p>`;
    } else {
      vEl.innerHTML = `<p class="search-empty">ESV 加载失败（${esc(String(e.message || e))}）。<br>请检查网络与 API 密钥，或稍后再试。</p>`;
    }
    $("#reader-copyright").textContent = versionCopyright();
    applySettings();
    return;
  }
  currentVerses = verses || [];
  $("#reader-book").textContent = book.name;
  $("#reader-chapter").textContent = "第 " + chapter + " 章";
  $("#btn-version").textContent = versionLabel();
  $("#reader-title").textContent = book.name + " 第 " + chapter + " 章";
  $("#reader-meta").textContent = (book.testament === "OT" ? "旧约" : "新约") + " · 共 " + book.chapters + " 章 · " + versionLabel();
  const bms = store.get("bookmarks", {});
  const hls = store.get("highlights", {});
  const notes = store.get("notes", {});
  const poetry = settings.poetry && isPoetryBook(abbrev);
  let html = "";
  verses.forEach((text, i) => {
    const vn = i + 1;
    const key = verseKey(abbrev, chapter, vn);
    let h = "";
    if (settings.showHeadings) {
      const hd = headingFor(abbrev, chapter, vn);
      if (hd) h = `<div class="verse-head">${esc(hd.title)}${hd.xref ? `<span class="xref">${esc(hd.xref)}</span>` : ""}</div>`;
    }
    const cls = ["verse"];
    if (hls[key]) cls.push("hl-" + hls[key]);
    if (bms[key]) cls.push("bookmarked");
    if (selSet.has(vn)) cls.push("selected");
    const noteDot = notes[key] ? '<span class="note-dot"> ●</span>' : "";
    const body = poetry
      ? `<span class="poetry">${esc(text)}</span>`
      : esc(text);
    html += h + `<span class="${cls.join(" ")}" data-v="${vn}" data-key="${key}"><sup class="vn${settings.showNums ? "" : " hidden-num"}">${vn}</sup>${body}${noteDot}</span> `;
    if (parallel && versesEn && versesEn[i]) {
      html += `<span class="verse-en" data-v="${vn}">${esc(versesEn[i])}</span>`;
    }
  });
  const vEl = $("#verses");
  vEl.innerHTML = html;
  applySettings();
  // verse tap toggles selection (wd.bible style); long-press opens the verse action sheet
  vEl.querySelectorAll(".verse").forEach((el) => {
    const vn = parseInt(el.dataset.v, 10);
    let pressTimer = null, longPressed = false;
    el.addEventListener("click", () => {
      if (longPressed) { longPressed = false; return; } // suppress the click that follows a long-press
      toggleVerseSel(vn);
    });
    el.addEventListener("pointerdown", () => {
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        pressTimer = null;
        openVerseSheet(abbrev, chapter, vn, el.textContent.trim());
      }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      el.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }));
  });
  // pager
  const prevBtn = $("#btn-prev"), nextBtn = $("#btn-next");
  const prev = prevChapter(abbrev, chapter), next = nextChapter(abbrev, chapter);
  prevBtn.disabled = !prev;
  nextBtn.disabled = !next;
  prevBtn.onclick = () => { if (prev) location.hash = "#/read/" + prev.book + "/" + prev.chapter; };
  nextBtn.onclick = () => { if (next) location.hash = "#/read/" + next.book + "/" + next.chapter; };
  $("#reader-copyright").textContent = versionCopyright();
}
function prevChapter(abbrev, chapter) {
  if (chapter > 1) return { book: abbrev, chapter: chapter - 1 };
  const i = bookIndex(abbrev);
  if (i > 0) { const p = books[i - 1]; return { book: p.abbrev, chapter: p.chapters }; }
  return null;
}
function nextChapter(abbrev, chapter) {
  const b = bookByAbbrev(abbrev);
  if (chapter < b.chapters) return { book: abbrev, chapter: chapter + 1 };
  const i = bookIndex(abbrev);
  if (i >= 0 && i < books.length - 1) return { book: books[i + 1].abbrev, chapter: 1 };
  return null;
}

/* ---------- verse selection (wd.bible style: tap to select) ---------- */
function clearSelection() {
  selSet.clear();
  syncSelUI();
}
function toggleVerseSel(vn) {
  if (selSet.has(vn)) selSet.delete(vn);
  else selSet.add(vn);
  syncSelUI();
}
function syncSelUI() {
  $$("#verses .verse").forEach((el) => {
    el.classList.toggle("selected", selSet.has(parseInt(el.dataset.v, 10)));
  });
  $("#selbar").classList.toggle("hidden", selSet.size === 0);
  $("#selbar-count").textContent = "已选 " + selSet.size + " 节";
  if (selSet.size === 0) {
    $("#selbar-colors").classList.add("hidden");
    $("#selbar-note-row").classList.add("hidden");
  }
}
function selectedVerseTexts() {
  // returns [{verse, text}] sorted by verse number, from the current chapter
  const verses = currentVerses || [];
  return Array.from(selSet).sort((a, b) => a - b)
    .map((vn) => ({ verse: vn, text: verses[vn - 1] || "" }))
    .filter((x) => x.text);
}
function verseRef(abbrev, chapter, verse) {
  // "以西结书 28:20" style reference used by the inline copy format
  const b = bookByAbbrev(abbrev);
  return b ? b.name + " " + chapter + ":" + verse : "";
}
function formatVerses(items) {
  // items: [{verse, text}] from the current chapter; format follows settings.copyFormat
  if (!items.length) return "";
  const book = bookByAbbrev(current.book);
  const verLabel = VERSIONS[settings.version === "parallel" ? "cuv" : settings.version].label;
  const fmt = settings.copyFormat || "numbered";
  if (fmt === "inline") {
    // one line per verse: text（ref version）, e.g. 这样人们就知道我是耶和华（以西结书 28:20 和合本）
    return items.map((x) => x.text + "（" + verseRef(current.book, current.chapter, x.verse) + " " + verLabel + "）").join("\n");
  }
  if (fmt === "plain") {
    return items.map((x) => x.text).join("\n");
  }
  // numbered: group contiguous verses under a range header
  const groups = [];
  let cur = [items[0]];
  for (let i = 1; i < items.length; i++) {
    if (items[i].verse === items[i - 1].verse + 1) cur.push(items[i]);
    else { groups.push(cur); cur = [items[i]]; }
  }
  groups.push(cur);
  return groups.map((g) => {
    const first = g[0].verse, last = g[g.length - 1].verse;
    const ref = book.name + " " + current.chapter + "章" +
      (first === last ? first : first + "-" + last) + "节";
    const lines = g.map((x) => x.verse + " " + x.text);
    return ref + "\n" + lines.join("\n");
  }).join("\n\n");
}
function formatSelectedVerses() {
  return formatVerses(selectedVerseTexts());
}
function formatOneVerse(abbrev, chapter, verse, text) {
  // single-verse copy/share in the chosen format
  const fmt = settings.copyFormat || "numbered";
  const verLabel = VERSIONS[settings.version === "parallel" ? "cuv" : settings.version].label;
  if (fmt === "inline") return text + "（" + verseRef(abbrev, chapter, verse) + " " + verLabel + "）";
  if (fmt === "plain") return text;
  return refLabel(abbrev, chapter, verse) + "\n" + verse + " " + text;
}
async function copySelectedVerses() {
  const text = formatSelectedVerses();
  if (!text) { toast("请先选择经文"); return; }
  await copyText(text, "已复制 " + selSet.size + " 节经文");
  clearSelection();
}
async function shareSelectedVerses() {
  const text = formatSelectedVerses();
  if (!text) { toast("请先选择经文"); return; }
  await shareText(text);
}
function applyHighlightToSelected(color) {
  if (!selSet.size) return;
  const hls = store.get("highlights", {});
  let n = 0;
  selSet.forEach((vn) => {
    const key = verseKey(current.book, current.chapter, vn);
    if (color) hls[key] = color; else delete hls[key];
    n++;
  });
  store.set("highlights", hls);
  renderChapter(current.book, current.chapter);
  toast(color ? "已为 " + n + " 节经文高亮" : "已清除 " + n + " 节经文的高亮");
  clearSelection();
}
function bookmarkSelected() {
  if (!selSet.size) return;
  const bms = store.get("bookmarks", {});
  let n = 0;
  selSet.forEach((vn) => {
    const key = verseKey(current.book, current.chapter, vn);
    const text = (currentVerses || [])[vn - 1] || "";
    if (!bms[key]) { bms[key] = { book: current.book, chapter: current.chapter, verse: vn, text, t: Date.now() }; n++; }
  });
  store.set("bookmarks", bms);
  renderChapter(current.book, current.chapter);
  toast(n ? "已加入书签 " + n + " 节" : "所选经文已在书签中");
  clearSelection();
}
function saveNoteForSelected(text) {
  if (!selSet.size || !text) return;
  const notes = store.get("notes", {});
  let n = 0;
  selSet.forEach((vn) => {
    const key = verseKey(current.book, current.chapter, vn);
    const vtext = (currentVerses || [])[vn - 1] || "";
    notes[key] = { book: current.book, chapter: current.chapter, verse: vn, text: vtext, note: text, t: Date.now() };
    n++;
  });
  store.set("notes", notes);
  renderChapter(current.book, current.chapter);
  toast("已为 " + n + " 节经文保存笔记");
  clearSelection();
}

/* ---------- verse detail ---------- */
async function renderVerse(abbrev, chapter, verse) {
  await loadIndex();
  const book = bookByAbbrev(abbrev);
  if (!book) { location.hash = "#/"; return; }
  // Show the active version first, then CUV and KJV (dedup) for comparison.
  const want = [];
  const pushVer = (v) => { if (v && !want.includes(v)) want.push(v); };
  pushVer(settings.version === "parallel" ? "cuv" : settings.version);
  pushVer("cuv");
  pushVer("kjv");
  const blocks = [];
  let mainText = "";
  for (const v of want) {
    let text = "";
    try {
      if (v === "esv") {
        const ch = await loadChapterESV(abbrev, chapter);
        text = ch[verse - 1] || "";
      } else {
        const b = await loadBook(abbrev, v);
        text = b.chapters[chapter - 1][verse - 1] || "";
      }
    } catch (e) { text = ""; }
    if (!text && v === want[0]) continue;
    if (v === want[0]) mainText = text;
    if (text) blocks.push({ label: VERSIONS[v].label, text, en: v === "kjv" || v === "esv" });
  }
  if (!mainText) { location.hash = "#/read/" + abbrev + "/" + chapter; return; }
  const key = verseKey(abbrev, chapter, verse);
  $("#verse-ref-label").textContent = refLabel(abbrev, chapter, verse);
  $("#verse-title").textContent = refLabel(abbrev, chapter, verse);
  $("#verse-body").innerHTML = blocks.map((b) =>
    `<div class="verse-block${b.en ? " en" : ""}"><h3>${esc(b.label)}</h3><p>${esc(b.text)}</p></div>`).join("");
  $("#verse-back").onclick = () => { location.hash = "#/read/" + abbrev + "/" + chapter; };
  const fullText = formatOneVerse(abbrev, chapter, verse, mainText);
  $("#verse-copy").onclick = () => copyText(fullText, "已复制经文");
  $("#verse-share").onclick = () => shareText(fullText);
  const bms = store.get("bookmarks", {});
  const bmBtn = $("#verse-bookmark");
  const syncBm = () => { bmBtn.textContent = bms[key] ? "已加书签 ✓" : "书签"; };
  syncBm();
  bmBtn.onclick = () => {
    if (bms[key]) delete bms[key]; else bms[key] = { book: abbrev, chapter, verse, text: mainText, t: Date.now() };
    store.set("bookmarks", bms);
    syncBm();
    toast(bms[key] ? "已加入书签" : "已取消书签");
  };
  // highlight dots
  const hls = store.get("highlights", {});
  $$("#verse-highlight-row .hl-dot").forEach((d) => {
    d.classList.toggle("active", hls[key] === d.dataset.hl && d.dataset.hl !== "");
    d.onclick = () => {
      if (d.dataset.hl) hls[key] = d.dataset.hl; else delete hls[key];
      store.set("highlights", hls);
      $$("#verse-highlight-row .hl-dot").forEach((x) => x.classList.toggle("active", hls[key] === x.dataset.hl && x.dataset.hl !== ""));
      toast(d.dataset.hl ? "已高亮" : "已清除高亮");
    };
  });
  // note
  const notes = store.get("notes", {});
  const noteBox = $("#verse-note-box"), noteView = $("#verse-note-view");
  const syncNote = () => {
    if (notes[key]) {
      noteView.classList.remove("hidden");
      noteView.innerHTML = "<small>我的笔记</small>" + esc(notes[key].text);
      $("#verse-note-text").value = notes[key].text;
    } else {
      noteView.classList.add("hidden");
      $("#verse-note-text").value = "";
    }
  };
  syncNote();
  $("#verse-note").onclick = () => noteBox.classList.toggle("hidden");
  $("#verse-note-save").onclick = () => {
    const t = $("#verse-note-text").value.trim();
    if (t) { notes[key] = { book: abbrev, chapter, verse, text: mainText, note: t, t: Date.now() }; toast("笔记已保存"); }
    else { delete notes[key]; toast("笔记已删除"); }
    store.set("notes", notes);
    noteBox.classList.add("hidden");
    syncNote();
  };
}

/* ---------- copy / share ---------- */
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || "已复制"); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(msg || "已复制"); } catch (e2) { toast("复制失败，请手动选择复制"); }
    document.body.removeChild(ta);
  }
}
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (e) {}
  } else {
    copyText(text, "已复制，可粘贴分享");
  }
}

/* ---------- backup: export / import my data ---------- */
// Bookmarks, highlights, notes, history and settings live in localStorage (persistent
// on this device). Export writes them to a JSON file so they survive a device
// change or a browser data wipe; import restores them.
const BACKUP_KEYS = ["bookmarks", "highlights", "notes", "history", "settings", "lastRead", "plan"];
function exportBackup() {
  const data = { app: "FlareBible", version: 1, exportedAt: new Date().toISOString(), data: {} };
  BACKUP_KEYS.forEach((k) => { data.data[k] = store.get(k, k === "settings" ? settings : (k === "history" ? [] : {})); });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flarebible-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("备份已导出");
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== "FlareBible" || !data.data) throw new Error("not a FlareBible backup");
    let n = 0;
    BACKUP_KEYS.forEach((k) => {
      if (data.data[k] !== undefined) { store.set(k, data.data[k]); n++; }
    });
    if (data.data.settings) Object.assign(settings, data.data.settings);
    applySettings();
    toast("已导入备份（" + n + " 项）");
    renderChapter(current.book, current.chapter);
  } catch (e) {
    toast("导入失败：不是有效的备份文件");
  }
}

/* ---------- verse action sheet ---------- */
let sheetVerse = null;
async function openVerseSheet(abbrev, chapter, verse, snippet) {
  // Use the verse text already displayed (active version), no extra fetch.
  const text = (currentVerses && currentVerses[verse - 1]) || snippet || "";
  sheetVerse = { book: abbrev, chapter, verse, text };
  $("#sheet-ref").textContent = refLabel(abbrev, chapter, verse);
  $("#sheet-text").textContent = text;
  $("#sheet-backdrop").classList.remove("hidden");
  $("#sheet-verse").classList.remove("hidden");
  const key = verseKey(abbrev, chapter, verse);
  const hls = store.get("highlights", {});
  $$("#sheet-verse .hl-dot").forEach((d) => d.classList.toggle("active", hls[key] === d.dataset.hl && d.dataset.hl !== ""));
}
function closeSheet() {
  $("#sheet-backdrop").classList.add("hidden");
  $("#sheet-verse").classList.add("hidden");
  sheetVerse = null;
}

/* ---------- search ---------- */
// Reference parsing: 约3:16, 创1:1, 诗23:1, 约翰福音3:16, 约 3:16, 1co 13:4
const BOOK_ALIASES = {
  "创": "gen", "创世记": "gen", "出": "ex", "出埃及记": "ex", "利": "lv", "利未记": "lv",
  "民": "nm", "民数记": "nm", "申": "dt", "申命记": "dt", "书": "jos", "约书亚记": "jos",
  "士": "jdg", "士师记": "jdg", "得": "rut", "路得记": "rut", "撒上": "1sa", "撒母耳记上": "1sa",
  "撒下": "2sa", "撒母耳记下": "2sa", "王上": "1ki", "列王纪上": "1ki", "王下": "2ki", "列王纪下": "2ki",
  "代上": "1ch", "历代志上": "1ch", "代下": "2ch", "历代志下": "2ch", "拉": "ezr", "以斯拉记": "ezr",
  "尼": "neh", "尼希米记": "neh", "斯": "est", "以斯帖记": "est", "伯": "job", "约伯记": "job",
  "诗": "psa", "诗篇": "psa", "箴": "pro", "箴言": "pro", "传": "ecc", "传道书": "ecc",
  "歌": "sng", "雅歌": "sng", "赛": "isa", "以赛亚书": "isa", "耶": "jer", "耶利米书": "jer",
  "哀": "lam", "耶利米哀歌": "lam", "结": "ezk", "以西结书": "ezk", "但": "dan", "但以理书": "dan",
  "何": "hos", "何西阿书": "hos", "珥": "jol", "约珥书": "jol", "摩": "amo", "阿摩司书": "amo",
  "俄": "oba", "俄巴底亚书": "oba", "拿": "jon", "约拿书": "jon", "弥": "mic", "弥迦书": "mic",
  "鸿": "nam", "那鸿书": "nam", "哈": "hab", "哈巴谷书": "hab", "番": "zep", "西番雅书": "zep",
  "该": "hag", "哈该书": "hag", "亚": "zec", "撒迦利亚书": "zec", "玛": "mal", "玛拉基书": "mal",
  "太": "mat", "马太福音": "mat", "可": "mrk", "马可福音": "mrk", "路": "luk", "路加福音": "luk",
  "约": "jhn", "约翰福音": "jhn", "徒": "act", "使徒行传": "act", "罗": "rom", "罗马书": "rom",
  "林前": "1co", "哥林多前书": "1co", "林后": "2co", "哥林多后书": "2co", "加": "gal", "加拉太书": "gal",
  "弗": "eph", "以弗所书": "eph", "腓": "php", "腓立比书": "php", "西": "col", "歌罗西书": "col",
  "帖前": "1th", "帖撒罗尼迦前书": "1th", "帖后": "2th", "帖撒罗尼迦后书": "2th",
  "提前": "1ti", "提摩太前书": "1ti", "提后": "2ti", "提摩太后书": "2ti",
  "多": "tit", "提多书": "tit", "门": "phm", "腓利门书": "phm", "来": "heb", "希伯来书": "heb",
  "雅": "jas", "雅各书": "jas", "彼前": "1pe", "彼得前书": "1pe", "彼后": "2pe", "彼得后书": "2pe",
  "约一": "1jn", "约翰一书": "1jn", "约二": "2jn", "约翰二书": "2jn", "约三": "3jn", "约翰三书": "3jn",
  "犹": "jud", "犹大书": "jud", "启": "rev", "启示录": "rev",
  "gen": "gen", "ex": "ex", "jhn": "jhn", "mat": "mat", "rom": "rom", "psa": "psa", "1co": "1co", "rev": "rev",
};
function parseReference(q) {
  const m = q.trim().match(/^(.+?)\s*(\d+)\s*[:：]\s*(\d+)\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  const abbrev = BOOK_ALIASES[name] || (books && books.find((b) => b.name === name || b.abbrev === name.toLowerCase()) || {}).abbrev;
  if (!abbrev) return null;
  return { book: abbrev, chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
}
async function doSearch(q) {
  const box = $("#search-results");
  q = (q || "").trim();
  if (!q) { box.innerHTML = ""; return; }
  await loadIndex();
  // Reference direct jump
  const ref = parseReference(q);
  if (ref) {
    const book = bookByAbbrev(ref.book);
    if (book && ref.chapter >= 1 && ref.chapter <= book.chapters) {
      const b = await loadBook(ref.book, "cuv");
      const ch = b.chapters[ref.chapter - 1];
      if (ch && ref.verse >= 1 && ref.verse <= ch.length) {
        const text = ch[ref.verse - 1];
        box.innerHTML = `<button class="search-item" data-goto="${ref.book}/${ref.chapter}/${ref.verse}">
          <div class="ref">${esc(refLabel(ref.book, ref.chapter, ref.verse))} · 出处直达</div>
          <div class="txt">${esc(text)}</div></button>`;
        bindSearchItems();
        return;
      }
    }
  }
  // Keyword search (lazy-load index)
  box.innerHTML = '<p class="search-empty">正在搜索…</p>';
  const data = await loadSearch();
  const needle = q.replace(/\s+/g, "");
  const results = [];
  for (const [bi, ci, vi, text] of data) {
    if (text.includes(needle)) {
      results.push({ bi, ci, vi, text });
      if (results.length >= 100) break;
    }
  }
  if (!results.length) {
    box.innerHTML = '<p class="search-empty">没有找到包含「' + esc(q) + '」的经文。<br>试试换个关键词，或输入出处如 约3:16。</p>';
    return;
  }
  box.innerHTML = results.map((r) => {
    const b = books[r.bi];
    const idx = r.text.indexOf(needle);
    const marked = esc(r.text.slice(0, idx)) + "<mark>" + esc(needle) + "</mark>" + esc(r.text.slice(idx + needle.length));
    return `<button class="search-item" data-goto="${b.abbrev}/${r.ci + 1}/${r.vi + 1}">
      <div class="ref">${esc(b.name)} ${r.ci + 1}章${r.vi + 1}节</div>
      <div class="txt">${marked}</div></button>`;
  }).join("") + (results.length >= 100 ? '<p class="search-empty">仅显示前 100 条结果，请缩小范围。</p>' : "");
  bindSearchItems();
}
function bindSearchItems() {
  $$("#search-results .search-item").forEach((el) => {
    el.addEventListener("click", () => { location.hash = "#/verse/" + el.dataset.goto; });
  });
}

/* ---------- bookmarks / highlights / notes / history ---------- */
let bmTab = "bookmarks";
function renderBookmarks() {
  const list = $("#bm-list");
  $$("#bm-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === bmTab));
  if (bmTab === "bookmarks") {
    const bms = store.get("bookmarks", {});
    const items = Object.values(bms).sort((a, b) => b.t - a.t);
    if (!items.length) { list.innerHTML = '<p class="bm-empty">还没有书签。<br>在阅读时点任意一节经文，即可加入书签。</p>'; return; }
    list.innerHTML = items.map((it) => `<button class="bm-item" data-goto="${it.book}/${it.chapter}/${it.verse}">
      <div class="ref">${esc(refLabel(it.book, it.chapter, it.verse))}</div>
      <div class="txt">${esc(it.text)}</div></button>`).join("");
  } else if (bmTab === "highlights") {
    const hls = store.get("highlights", {});
    const keys = Object.keys(hls);
    if (!keys.length) { list.innerHTML = '<p class="bm-empty">还没有高亮。<br>在阅读时点任意一节经文，即可高亮标记。</p>'; return; }
    list.innerHTML = '<p class="search-hint">高亮按经文保存，颜色：黄 / 绿 / 蓝 / 粉。</p>' + keys.map((k) => {
      const [book, ch, v] = k.split(":");
      return `<button class="bm-item" data-goto="${book}/${ch}/${v}">
        <div class="ref">${esc(refLabel(book, +ch, +v))} · ${{ yellow: "黄色", green: "绿色", blue: "蓝色", pink: "粉色" }[hls[k]] || ""}</div>
        <div class="txt">点此查看该节经文</div></button>`;
    }).join("");
  } else if (bmTab === "notes") {
    const notes = store.get("notes", {});
    const items = Object.values(notes).sort((a, b) => b.t - a.t);
    if (!items.length) { list.innerHTML = '<p class="bm-empty">还没有笔记。<br>在逐节对照页可以为一节经文写笔记。</p>'; return; }
    list.innerHTML = items.map((it) => `<button class="bm-item" data-goto="${it.book}/${it.chapter}/${it.verse}">
      <div class="ref">${esc(refLabel(it.book, it.chapter, it.verse))}</div>
      <div class="txt">${esc(it.text)}</div>
      <div class="meta">笔记：${esc(it.note)}</div></button>`).join("");
  } else {
    const hist = store.get("history", []);
    if (!hist.length) { list.innerHTML = '<p class="bm-empty">还没有阅读记录。</p>'; return; }
    list.innerHTML = hist.map((h) => `<button class="bm-item" data-goto="${h.book}/${h.chapter}">
      <div class="ref">${esc(refLabel(h.book, h.chapter))}</div>
      <div class="meta">${new Date(h.t).toLocaleString("zh-CN")}</div></button>`).join("");
  }
  $$("#bm-list .bm-item").forEach((el) => {
    el.addEventListener("click", () => {
      const parts = el.dataset.goto.split("/");
      location.hash = parts.length === 3 ? "#/verse/" + el.dataset.goto : "#/read/" + el.dataset.goto;
    });
  });
}

/* ---------- reading plan (1 year, 365 days) ---------- */
function buildPlan() {
  // Each day: 1 OT chapter(s) + 1 NT chapter + 1 Psalm/Proverb chapter.
  // OT: 929 chapters over 365 days (~2.5/day -> use 3 on some days); simplify: cycle OT chapters, NT chapters, wisdom chapters.
  const otBooks = books.filter((b) => b.testament === "OT" && b.abbrev !== "psa" && b.abbrev !== "pro");
  const ntBooks = books.filter((b) => b.testament === "NT");
  const wisBooks = books.filter((b) => ["psa", "pro"].includes(b.abbrev));
  const otChs = []; otBooks.forEach((b) => { for (let c = 1; c <= b.chapters; c++) otChs.push({ book: b.abbrev, chapter: c }); });
  const ntChs = []; ntBooks.forEach((b) => { for (let c = 1; c <= b.chapters; c++) ntChs.push({ book: b.abbrev, chapter: c }); });
  const wisChs = []; wisBooks.forEach((b) => { for (let c = 1; c <= b.chapters; c++) wisChs.push({ book: b.abbrev, chapter: c }); });
  const days = [];
  for (let d = 0; d < 365; d++) {
    const ot = otChs[Math.floor((d / 365) * otChs.length)];
    const nt = ntChs[Math.floor((d / 365) * ntChs.length)];
    const wis = wisChs[d % wisChs.length];
    days.push({ day: d + 1, readings: [ot, nt, wis] });
  }
  return days;
}
function renderPlan() {
  const days = buildPlan();
  const done = store.get("planDone", {});
  const doneCount = Object.keys(done).length;
  $("#plan-bar").style.width = Math.round((doneCount / 365) * 100) + "%";
  $("#plan-count").textContent = "已完成 " + doneCount + " / 365 天";
  const today = dayOfYear() % 365;
  const d = new Date();
  $("#plan-today-date").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 · 第 " + (today + 1) + " 天";
  $("#plan-today-go").onclick = () => {
    const r = days[today].readings[0];
    location.hash = "#/read/" + r.book + "/" + r.chapter;
  };
  const start = Math.max(0, today - 2);
  const shown = days.slice(start, start + 14);
  $("#plan-list").innerHTML = shown.map((day) => {
    const isToday = day.day === today + 1;
    const readings = day.readings.map((r) =>
      `<button data-read="${r.book}/${r.chapter}">${esc(refLabel(r.book, r.chapter))}</button>`).join(" · ");
    return `<div class="plan-day${done[day.day] ? " done" : ""}">
      <input type="checkbox" data-day="${day.day}" ${done[day.day] ? "checked" : ""} aria-label="第 ${day.day} 天完成">
      <span class="day-num">第 ${day.day} 天${isToday ? " · 今天" : ""}</span>
      <span class="day-readings">${readings}</span>
    </div>`;
  }).join("");
  $$("#plan-list .plan-day input").forEach((cb) => {
    cb.addEventListener("change", () => {
      const dd = store.get("planDone", {});
      if (cb.checked) dd[cb.dataset.day] = todayKey(); else delete dd[cb.dataset.day];
      store.set("planDone", dd);
      renderPlan();
    });
  });
  $$("#plan-list [data-read]").forEach((b) => {
    b.addEventListener("click", () => { location.hash = "#/read/" + b.dataset.read; });
  });
}

/* ---------- drawers ---------- */
function openDrawer(id) {
  closeDrawers();
  $("#drawer-backdrop").classList.remove("hidden");
  $(id).classList.remove("hidden");
}
function closeDrawers() {
  ["#drawer-picker", "#drawer-version", "#drawer-settings"].forEach((s) => $(s).classList.add("hidden"));
  $("#drawer-backdrop").classList.add("hidden");
}
let pickerTab = "OT";
let pickerBook = null;
async function renderPicker() {
  await loadIndex();
  const list = books.filter((b) => b.testament === pickerTab);
  $$("#picker-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === pickerTab));
  $("#picker-chapters").classList.add("hidden");
  $("#picker-books").classList.remove("hidden");
  $("#picker-books").innerHTML = list.map((b) =>
    `<button data-book="${b.abbrev}" class="${b.abbrev === current.book ? "current" : ""}">${esc(b.name)}</button>`).join("");
  $$("#picker-books button").forEach((b) => b.addEventListener("click", () => showPickerChapters(b.dataset.book)));
}
async function showPickerChapters(abbrev) {
  await loadIndex();
  const book = bookByAbbrev(abbrev);
  pickerBook = abbrev;
  $("#picker-books").classList.add("hidden");
  $("#picker-chapters").classList.remove("hidden");
  $("#picker-book-name").textContent = book.name + " · 共 " + book.chapters + " 章";
  $("#picker-chapter-grid").innerHTML = Array.from({ length: book.chapters }, (_, i) =>
    `<button data-ch="${i + 1}" class="${abbrev === current.book && i + 1 === current.chapter ? "current" : ""}">${i + 1}</button>`).join("");
  $$("#picker-chapter-grid button").forEach((b) => b.addEventListener("click", () => {
    closeDrawers();
    location.hash = "#/read/" + abbrev + "/" + b.dataset.ch;
  }));
}

/* ---------- init ---------- */
function init() {
  applySettings();
  // top bar
  $("#btn-theme").addEventListener("click", () => {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    applySettings();
    toast(settings.theme === "dark" ? "已切换深色主题" : "已切换浅色主题");
  });
  $("#btn-settings").addEventListener("click", () => openDrawer("#drawer-settings"));
  $("#btn-search-top").addEventListener("click", () => { location.hash = "#/search"; });
  // settings
  $$("#seg-font button").forEach((b) => b.addEventListener("click", () => { settings.font = b.dataset.f; applySettings(); renderChapter(current.book, current.chapter); }));
  $$("#seg-line button").forEach((b) => b.addEventListener("click", () => { settings.line = b.dataset.l; applySettings(); }));
  $("#set-versenums").addEventListener("change", (e) => { settings.showNums = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  $("#set-headings").addEventListener("change", (e) => { settings.showHeadings = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  $("#set-poetry").addEventListener("change", (e) => { settings.poetry = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  // drawers
  $("#drawer-backdrop").addEventListener("click", closeDrawers);
  $("#drawer-close").addEventListener("click", closeDrawers);
  $("#version-close").addEventListener("click", closeDrawers);
  $("#settings-close").addEventListener("click", closeDrawers);
  $("#btn-picker").addEventListener("click", () => { renderPicker(); openDrawer("#drawer-picker"); });
  $$("#picker-tabs button").forEach((b) => b.addEventListener("click", () => { pickerTab = b.dataset.t; renderPicker(); }));
  $("#picker-back").addEventListener("click", renderPicker);
  // version
  $("#btn-version").addEventListener("click", () => {
    $$("#version-list .version-item").forEach((b) => b.classList.toggle("current", b.dataset.v === settings.version));
    openDrawer("#drawer-version");
  });
  $$("#version-list .version-item").forEach((b) => b.addEventListener("click", () => {
    settings.version = b.dataset.v;
    applySettings();
    closeDrawers();
    clearSelection();
    renderChapter(current.book, current.chapter);
    toast("已切换为" + versionLabel());
  }));
  // verse selection action bar (wd.bible style)
  $("#selbar-copy").addEventListener("click", copySelectedVerses);
  $("#selbar-share").addEventListener("click", shareSelectedVerses);
  $("#selbar-highlight").addEventListener("click", () => {
    $("#selbar-note-row").classList.add("hidden");
    $("#selbar-colors").classList.toggle("hidden");
  });
  $$("#selbar-colors .hl-dot").forEach((d) => d.addEventListener("click", () => applyHighlightToSelected(d.dataset.hl)));
  $("#selbar-bookmark").addEventListener("click", bookmarkSelected);
  $("#selbar-note").addEventListener("click", () => {
    $("#selbar-colors").classList.add("hidden");
    $("#selbar-note-row").classList.toggle("hidden");
    if (!$("#selbar-note-row").classList.contains("hidden")) $("#selbar-note-input").focus();
  });
  $("#selbar-note-save").addEventListener("click", () => {
    const t = $("#selbar-note-input").value.trim();
    if (!t) { toast("请先写一句笔记"); return; }
    $("#selbar-note-input").value = "";
    saveNoteForSelected(t);
  });
  $("#selbar-cancel").addEventListener("click", clearSelection);
  // copy format
  $$("#seg-copyfmt button").forEach((b) => b.addEventListener("click", () => {
    settings.copyFormat = b.dataset.cf;
    applySettings();
    $$("#seg-copyfmt button").forEach((x) => x.classList.toggle("active", x.dataset.cf === settings.copyFormat));
    toast("复制格式已切换");
  }));
  // backup: export / import my data (bookmarks, highlights, notes, history, settings)
  $("#btn-export").addEventListener("click", exportBackup);
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importBackup(f);
    e.target.value = "";
  });
  // ESV API token (stored locally, never uploaded)
  const esvInput = $("#set-esv-token");
  esvInput.value = esvToken();
  esvInput.addEventListener("change", () => {
    const t = esvInput.value.trim();
    store.set("esvToken", t);
    esvChapterCache = {};
    toast(t ? "ESV 密钥已保存" : "ESV 密钥已清除");
    if (settings.version === "esv") renderChapter(current.book, current.chapter);
  });
  // search
  $("#search-go").addEventListener("click", () => {
    const q = $("#search-input").value.trim();
    if (q) { history.replaceState(null, "", "#/search?q=" + encodeURIComponent(q)); doSearch(q); }
  });
  $("#search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#search-go").click(); });
  // bookmarks tabs
  $$("#bm-tabs button").forEach((b) => b.addEventListener("click", () => { bmTab = b.dataset.tab; renderBookmarks(); }));
  // verse sheet
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-copy").addEventListener("click", () => {
    if (!sheetVerse) return;
    copyText(formatOneVerse(sheetVerse.book, sheetVerse.chapter, sheetVerse.verse, sheetVerse.text), "已复制经文");
  });
  $("#sheet-share").addEventListener("click", () => {
    if (!sheetVerse) return;
    shareText(formatOneVerse(sheetVerse.book, sheetVerse.chapter, sheetVerse.verse, sheetVerse.text));
  });
  $("#sheet-open").addEventListener("click", () => {
    if (!sheetVerse) return;
    const v = sheetVerse;
    closeSheet();
    location.hash = "#/verse/" + v.book + "/" + v.chapter + "/" + v.verse;
  });
  $("#sheet-bookmark").addEventListener("click", () => {
    if (!sheetVerse) return;
    const key = verseKey(sheetVerse.book, sheetVerse.chapter, sheetVerse.verse);
    const bms = store.get("bookmarks", {});
    if (bms[key]) { delete bms[key]; toast("已取消书签"); }
    else { bms[key] = { book: sheetVerse.book, chapter: sheetVerse.chapter, verse: sheetVerse.verse, text: sheetVerse.text, t: Date.now() }; toast("已加入书签"); }
    store.set("bookmarks", bms);
    closeSheet();
    renderChapter(current.book, current.chapter);
  });
  $("#sheet-note").addEventListener("click", () => {
    if (!sheetVerse) return;
    const v = sheetVerse;
    closeSheet();
    location.hash = "#/verse/" + v.book + "/" + v.chapter + "/" + v.verse;
    setTimeout(() => $("#verse-note-box").classList.remove("hidden"), 300);
  });
  $$("#sheet-verse .hl-dot").forEach((d) => d.addEventListener("click", () => {
    if (!sheetVerse) return;
    const key = verseKey(sheetVerse.book, sheetVerse.chapter, sheetVerse.verse);
    const hls = store.get("highlights", {});
    if (d.dataset.hl) hls[key] = d.dataset.hl; else delete hls[key];
    store.set("highlights", hls);
    toast(d.dataset.hl ? "已高亮" : "已清除高亮");
    closeSheet();
    renderChapter(current.book, current.chapter);
  }));
  // keyboard: prev/next chapter
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && !$("#view-read").classList.contains("hidden") && !e.target.matches("input,textarea")) $("#btn-prev").click();
    if (e.key === "ArrowRight" && !$("#view-read").classList.contains("hidden") && !e.target.matches("input,textarea")) $("#btn-next").click();
    if (e.key === "Escape") { closeDrawers(); closeSheet(); }
  });
  route();
}
document.addEventListener("DOMContentLoaded", init);
