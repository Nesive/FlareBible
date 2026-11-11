/* FlareBible — reader app (CUV + KJV + CCB + LZZ + ESV) */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- state ---------- */
/* ---------- profiles: one local profile per person, no account ---------- */
// Personal data (bookmarks, highlights, notes, reading progress, ESV key) is
// stored per profile under "nb:p:<profileId>:<key>"; display settings stay
// global under "nb:<key>". Switching profiles reloads the page so every view
// re-reads the new profile's data. The first run after this feature migrates
// any legacy un-profiled data into the default profile ("我") so nothing is lost.
const PERSONAL_KEYS = new Set(["bookmarks", "highlights", "notes", "history", "lastRead", "plan", "planDone", "esvToken", "typingProgress", "typingBest", "typingMistakes", "typingStats"]);
let profiles = [];
let currentProfileId = "default";
function profileKey(k) {
  return PERSONAL_KEYS.has(k) ? "p:" + currentProfileId + ":" + k : k;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("nb:" + profileKey(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("nb:" + profileKey(k), JSON.stringify(v)); } catch (e) {} },
  getRaw(k, d) { try { const v = localStorage.getItem("nb:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  setRaw(k, v) { try { localStorage.setItem("nb:" + k, JSON.stringify(v)); } catch (e) {} },
  removeRaw(k) { try { localStorage.removeItem("nb:" + k); } catch (e) {} },
};
function initProfiles() {
  profiles = store.getRaw("profiles", null);
  currentProfileId = store.getRaw("profile", null);
  if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
    const legacy = {};
    let hasLegacy = false;
    PERSONAL_KEYS.forEach((k) => {
      const v = store.getRaw(k, undefined);
      if (v !== undefined) { legacy[k] = v; hasLegacy = true; }
    });
    profiles = [{ id: "default", name: "我", createdAt: Date.now() }];
    currentProfileId = "default";
    store.setRaw("profiles", profiles);
    store.setRaw("profile", currentProfileId);
    if (hasLegacy) {
      Object.keys(legacy).forEach((k) => { store.set(k, legacy[k]); store.removeRaw(k); });
    }
  } else if (!profiles.some((p) => p.id === currentProfileId)) {
    currentProfileId = profiles[0].id;
    store.setRaw("profile", currentProfileId);
  }
}
initProfiles();
function currentProfile() { return profiles.find((p) => p.id === currentProfileId) || profiles[0]; }
function switchProfile(id) {
  if (id === currentProfileId || !profiles.some((p) => p.id === id)) return;
  currentProfileId = id;
  store.setRaw("profile", id);
  location.reload();
}
function addProfile(name) {
  name = (name || "").trim();
  if (!name) return null;
  const id = "p" + Date.now().toString(36);
  profiles.push({ id, name, createdAt: Date.now() });
  store.setRaw("profiles", profiles);
  return id;
}
function renameProfile(id, name) {
  name = (name || "").trim();
  if (!name) return;
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  p.name = name;
  store.setRaw("profiles", profiles);
}
function deleteProfile(id) {
  if (profiles.length <= 1) { toast("至少保留一个档案"); return false; }
  const p = profiles.find((x) => x.id === id);
  if (!p) return false;
  PERSONAL_KEYS.forEach((k) => store.removeRaw("p:" + id + ":" + k));
  profiles = profiles.filter((x) => x.id !== id);
  store.setRaw("profiles", profiles);
  if (id === currentProfileId) {
    currentProfileId = profiles[0].id;
    store.setRaw("profile", currentProfileId);
    location.reload();
  }
  return true;
}
function renderProfiles() {
  const list = $("#profile-list");
  if (!list) return;
  list.innerHTML = profiles.map((p) => (
    `<div class="profile-row${p.id === currentProfileId ? " active" : ""}">` +
    `<button class="profile-name" data-pid="${p.id}" title="切换到此档案">${esc(p.name)}</button>` +
    `<button class="profile-rename" data-pid="${p.id}" title="改名">✎</button>` +
    `<button class="profile-del" data-pid="${p.id}" title="删除档案">✕</button></div>`
  )).join("");
  list.querySelectorAll(".profile-name").forEach((b) => b.addEventListener("click", () => switchProfile(b.dataset.pid)));
  list.querySelectorAll(".profile-rename").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const p = profiles.find((x) => x.id === b.dataset.pid);
    const name = prompt("档案改名", p ? p.name : "");
    if (name !== null) { renameProfile(b.dataset.pid, name); renderProfiles(); }
  }));
  list.querySelectorAll(".profile-del").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const p = profiles.find((x) => x.id === b.dataset.pid);
    if (!p) return;
    if (!confirm("删除档案「" + p.name + "」？它名下的书签、高亮、笔记与阅读记录都会一并删除。")) return;
    if (deleteProfile(b.dataset.pid)) renderProfiles();
  }));
}
const settings = Object.assign(
  { theme: "dark", version: "cuv", font: "medium", line: "normal", showNums: true, showHeadings: true, poetry: true, copyFormat: "numbered", readingMode: "scroll", original: false },
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
// id -> {label, dir, copyright, api?, lang}
const VERSIONS = {
  cuv: { label: "和合本", dir: "data/books/", note: "中文 · 新标点和合本（简体）", lang: "zh",
         copyright: "和合本 © 1995 Hong Kong Bible Society" },
  kjv: { label: "KJV", dir: "data/books-en/", note: "English · King James Version", lang: "en",
         copyright: "King James Version（公有领域）" },
  ccb: { label: "当代译本", dir: "data/books-ccb/", note: "中文 · 当代译本（简体）", lang: "zh",
         copyright: "当代译本 © 1979, 2005, 2007, 2011, 2022 Biblica, Inc.（CC BY-SA 4.0 开放资源）" },
  lzz: { label: "吕振中", dir: "data/books-lzz/", note: "中文 · 吕振中译本（简体）", lang: "zh",
         copyright: "吕振中译本（1970，著作权保护期已满）" },
  esv: { label: "ESV", dir: null, note: "English · English Standard Version", lang: "en",
         copyright: "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway. Used by permission. All rights reserved." },
  wenli: { label: "文理和合本", dir: "data/books-wenli/", note: "中文 · 文理和合本 1919（文言）", lang: "zh",
         copyright: "文理和合本 1919（公有领域）" },
  asv: { label: "ASV 1901", dir: "data/books-asv/", note: "English · American Standard Version 1901", lang: "en",
         copyright: "American Standard Version 1901（公有领域）" },
  web: { label: "WEB", dir: "data/books-web/", note: "English · World English Bible", lang: "en",
         copyright: "World English Bible（公有领域）" },
  ylt: { label: "YLT 1898", dir: "data/books-ylt/", note: "English · Young's Literal Translation 1898", lang: "en",
         copyright: "Young's Literal Translation 1898（公有领域）" },
  darby: { label: "Darby 1890", dir: "data/books-darby/", note: "English · Darby Translation 1890", lang: "en",
         copyright: "Darby Translation 1890（公有领域）" },
  geneva: { label: "Geneva 1599", dir: "data/books-geneva/", note: "English · Geneva Bible 1599", lang: "en",
         copyright: "Geneva Bible 1599（公有领域）" },
  bbe: { label: "BBE", dir: "data/books-bbe/", note: "English · Bible in Basic English", lang: "en",
         copyright: "Bible in Basic English（美国公有领域）" },
  luther1912: { label: "Luther 1912", dir: "data/books-luther1912/", note: "Deutsch · Lutherbibel 1912", lang: "de",
         copyright: "Lutherbibel 1912（公有领域）" },
  segond1910: { label: "Segond 1910", dir: "data/books-segond1910/", note: "Français · Louis Segond 1910", lang: "fr",
         copyright: "Louis Segond 1910（公有领域）" },
  rv1909: { label: "RV 1909", dir: "data/books-rv1909/", note: "Español · Reina-Valera 1909", lang: "es",
         copyright: "Reina-Valera 1909（公有领域）" },
  almeida: { label: "Almeida ARC", dir: "data/books-almeida/", note: "Português · Almeida Revista e Corrigida", lang: "pt",
         copyright: "Almeida Revista e Corrigida（公有领域）" },
  staten: { label: "Statenvertaling", dir: "data/books-staten/", note: "Nederlands · Statenvertaling 1637", lang: "nl",
         copyright: "Statenvertaling 1637（公有领域）" },
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
  $("#set-original").checked = !!settings.original;
  $$("#seg-font button").forEach((b) => b.classList.toggle("active", b.dataset.f === settings.font));
  $$("#seg-line button").forEach((b) => b.classList.toggle("active", b.dataset.l === settings.line));
  $$("#seg-copyfmt button").forEach((b) => b.classList.toggle("active", b.dataset.cf === (settings.copyFormat || "numbered")));
  $$("#seg-reading button").forEach((b) => b.classList.toggle("active", b.dataset.rm === (settings.readingMode || "scroll")));
  document.body.classList.toggle("page-mode", settings.readingMode === "page");
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
const views = ["home", "read", "verse", "search", "bookmarks", "plan", "typing"];
function showView(name) {
  views.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== name));
  $$(".bottomnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name || (name === "verse" && a.dataset.nav === "read") || (name === "read" && a.dataset.nav === "read")));
  window.scrollTo({ top: 0 });
}
function route() {
  const h = location.hash || "#/";
  const [pathPart, queryPart] = h.replace(/^#\/?/, "").split("?");
  const parts = pathPart.split("/");
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
    const q = new URLSearchParams(queryPart || "").get("q");
    if (q) { $("#search-input").value = q; doSearch(q); }
  } else if (page === "bookmarks") {
    showView("bookmarks");
    renderBookmarks();
  } else if (page === "plan") {
    showView("plan");
    renderPlan();
  } else if (page === "typing") {
    showView("typing");
    const q = new URLSearchParams(queryPart || "");
    const tb = q.get("book"), tc = parseInt(q.get("chapter"), 10), tv = parseInt(q.get("verse"), 10);
    if (tb && tc) renderTyping(tb, tc, tv || null);
    else renderTypingHome();
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
  // Same-chapter re-render (font / version / settings): keep the page position.
  if (current.book === abbrev && current.chapter === chapter) rememberPageAnchor();
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
    requestAnimationFrame(() => applyPageMode());
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
  let lexMap = null;
  if (settings.original) {
    try { lexMap = await loadLexiconBook(abbrev); } catch (e) { lexMap = null; }
  }
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
    if (lexMap) {
      const words = lexMap.get(chapter + ":" + vn);
      if (words && words.length) {
        const rtl = book.testament === "OT";
        html += `<span class="orig-line" data-v="${vn}" dir="${rtl ? "rtl" : "ltr"}">` +
          words.map((w, wi) => `<span class="oword" data-s="${w.s}" data-w="${wi}">${esc(w.t)}</span>`).join(" ") +
          `</span>`;
      }
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
  requestAnimationFrame(() => { applyPageMode(); maybeHighlightLexTarget(); });
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

/* ---------- page-turn mode (wd.bible style) ---------- */
let pageState = { total: 0, index: 0, anchorVerse: null, pendingPage: null, _fadeTimer: null, _scrollTimer: null };
function isPageMode() { return settings.readingMode === "page"; }
function readViewVisible() { return !$("#view-read").classList.contains("hidden"); }
function firstVerseOfPage(pg) {
  if (!pg) return null;
  const first = pg.querySelector(".verse");
  return first ? parseInt(first.dataset.v, 10) : null;
}
function rememberPageAnchor() {
  // keep the first verse of the current page across a re-pagination
  const vEl = $("#verses");
  if (!isPageMode() || !vEl.classList.contains("paged")) { pageState.anchorVerse = null; return; }
  const pages = vEl.querySelectorAll(".page");
  pageState.anchorVerse = firstVerseOfPage(pages[pageState.index] || pages[0]);
}
function unwrapPages() {
  const vEl = $("#verses");
  const pages = Array.from(vEl.querySelectorAll(".page"));
  pages.forEach((pg) => {
    while (pg.firstChild) vEl.insertBefore(pg.firstChild, pg);
    pg.remove();
  });
  // always reset: renderChapter replaces innerHTML but leaves class + inline height behind
  vEl.classList.remove("paged");
  vEl.style.height = "";
}
function applyPageMode() {
  const vEl = $("#verses");
  const ind = $("#page-indicator");
  if (!isPageMode() || !readViewVisible()) {
    unwrapPages();
    ind.classList.add("hidden");
    ind.classList.remove("show");
    pageState.total = 0; pageState.index = 0;
    return;
  }
  // preserve position across re-pagination (font / resize / mode switch);
  // only re-derive the anchor when there are real pages and none was saved
  // (renderChapter saves it before replacing innerHTML)
  if (pageState.anchorVerse == null && pageState.pendingPage == null && vEl.querySelector(".page")) rememberPageAnchor();
  unwrapPages();
  // measure one page of room: viewport minus the verses top, bottom nav, and indicator space
  const nav = document.querySelector(".bottomnav");
  const navH = nav ? nav.getBoundingClientRect().height : 64;
  const top = vEl.getBoundingClientRect().top;
  // 12px safety margin: verses re-wrap a hair differently inside .page
  const pageH = Math.max(200, Math.floor(window.innerHeight - top - navH - 48 - 12));
  vEl.style.height = pageH + "px";
  // group child nodes into units: heading + verse (+ parallel English line);
  // whitespace text nodes ride with the preceding unit
  const units = [];
  let cur = null, pendingText = [];
  Array.from(vEl.childNodes).forEach((n) => {
    if (n.nodeType === 3) { if (cur) cur.push(n); else pendingText.push(n); return; }
    if (n.nodeType !== 1) return;
    if (n.classList.contains("verse-head")) { cur = pendingText.concat([n]); pendingText = []; units.push(cur); return; }
    if (n.classList.contains("verse")) { cur = pendingText.concat([n]); pendingText = []; units.push(cur); return; }
    if (n.classList.contains("verse-en")) { if (cur) cur.push(n); else { cur = [n]; units.push(cur); } return; }
    if (n.classList.contains("search-empty")) { cur = pendingText.concat([n]); pendingText = []; units.push(cur); return; }
    if (cur) cur.push(n); else { cur = [n]; units.push(cur); }
  });
  if (pendingText.length && cur) pendingText.forEach((t) => cur.push(t));
  // measure units in the still-unpaginated (scroll) layout
  const vTop = vEl.getBoundingClientRect().top;
  const pages = [];
  let page = [], pageStart = null;
  units.forEach((u) => {
    const firstEl = u.find((n) => n.nodeType === 1);
    if (!firstEl) { if (page.length) page[page.length - 1].push(...u); return; }
    const r = firstEl.getBoundingClientRect();
    // the first element's top margin collapses out in scroll layout but stays
    // inside a .page (a BFC), so count it in the page budget
    const mTop = parseFloat(getComputedStyle(firstEl).marginTop) || 0;
    const effTop = r.top - mTop;
    let bottom = r.bottom;
    u.forEach((el) => { if (el.nodeType === 1) { const er = el.getBoundingClientRect(); if (er.bottom > bottom) bottom = er.bottom; } });
    const uTop = effTop - vTop, uH = bottom - effTop;
    if (page.length && pageStart !== null && (uTop - pageStart + uH > pageH)) {
      pages.push(page); page = []; pageStart = null;
    }
    if (pageStart === null) pageStart = uTop;
    page.push(u);
  });
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([]);
  vEl.classList.add("paged");
  pages.forEach((pg) => {
    const d = document.createElement("div");
    d.className = "page";
    pg.forEach((u) => u.forEach((n) => d.appendChild(n)));
    vEl.appendChild(d);
  });
  pageState.total = pages.length;
  let idx = 0;
  if (pageState.pendingPage === "last") idx = pages.length - 1;
  else if (pageState.anchorVerse != null) {
    const pi = pages.findIndex((pg) => pg.some((u) => u.some((n) => n.nodeType === 1 && n.classList && n.classList.contains("verse") && parseInt(n.dataset.v, 10) === pageState.anchorVerse)));
    if (pi >= 0) idx = pi;
  }
  pageState.pendingPage = null;
  pageState.anchorVerse = null;
  pageState.index = idx;
  vEl.scrollLeft = idx * vEl.clientWidth;
  updatePageIndicator(true);
}
function updatePageIndicator(show) {
  const ind = $("#page-indicator");
  if (!isPageMode() || !pageState.total) { ind.classList.add("hidden"); ind.classList.remove("show"); return; }
  ind.classList.remove("hidden");
  ind.textContent = "第 " + (pageState.index + 1) + " / " + pageState.total + " 页";
  if (show) {
    ind.classList.add("show");
    clearTimeout(pageState._fadeTimer);
    pageState._fadeTimer = setTimeout(() => ind.classList.remove("show"), 1500);
  }
}
function goPage(i) {
  const vEl = $("#verses");
  if (!isPageMode() || !pageState.total) return;
  if (i < 0) {
    const prev = prevChapter(current.book, current.chapter);
    if (prev) { pageState.pendingPage = "last"; location.hash = "#/read/" + prev.book + "/" + prev.chapter; }
    return;
  }
  if (i >= pageState.total) {
    const next = nextChapter(current.book, current.chapter);
    if (next) { pageState.pendingPage = "first"; location.hash = "#/read/" + next.book + "/" + next.chapter; }
    return;
  }
  pageState.index = i;
  vEl.scrollTo({ left: i * vEl.clientWidth, behavior: "smooth" });
  updatePageIndicator(true);
}
function initPageGestures() {
  const vEl = $("#verses");
  // native horizontal scroll + snap does the dragging; just track the page
  vEl.addEventListener("scroll", () => {
    if (!isPageMode() || !pageState.total) return;
    clearTimeout(pageState._scrollTimer);
    pageState._scrollTimer = setTimeout(() => {
      const i = Math.round(vEl.scrollLeft / vEl.clientWidth);
      if (i !== pageState.index && i >= 0 && i < pageState.total) {
        pageState.index = i;
        updatePageIndicator(true);
      }
    }, 120);
  }, { passive: true });
  // boundary swipe: at the first/last page, a deliberate swipe crosses chapters
  let tx = 0, ty = 0;
  vEl.addEventListener("touchstart", (e) => {
    if (!isPageMode()) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  vEl.addEventListener("touchend", (e) => {
    if (!isPageMode() || !pageState.total) return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 && pageState.index === 0) goPage(-1);
    else if (dx < 0 && pageState.index === pageState.total - 1) goPage(pageState.total);
  }, { passive: true });
  // tap the blank left/right quarters to turn; taps on verse text still select
  vEl.addEventListener("click", (e) => {
    if (!isPageMode() || !pageState.total) return;
    if (e.target.closest(".verse, .verse-head, .verse-en, .orig-line, .search-empty, a, button")) return;
    const r = vEl.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < r.width * 0.25) goPage(pageState.index - 1);
    else if (x > r.width * 0.75) goPage(pageState.index + 1);
  });
  // tap an original-language word to open the lexicon drawer
  vEl.addEventListener("click", (e) => {
    const w = e.target.closest(".oword");
    if (!w) return;
    const line = w.closest(".orig-line");
    if (!line) return;
    const vn = parseInt(line.dataset.v, 10);
    const map = lexBookCache[current.book];
    const words = map && map.get(current.chapter + ":" + vn);
    const tok = words && words[+w.dataset.w];
    if (tok) openLexicon(tok, current.book, current.chapter, vn);
  });
  // keyboard
  document.addEventListener("keydown", (e) => {
    if (!isPageMode() || !readViewVisible() || !pageState.total) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (document.querySelector(".drawer:not(.hidden), .sheet:not(.hidden)")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goPage(pageState.index + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goPage(pageState.index - 1); }
  });
  // re-paginate on resize (font/width changes move the breaks)
  let rzTimer = null;
  window.addEventListener("resize", () => {
    if (!isPageMode() || !readViewVisible()) return;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => applyPageMode(), 200);
  });
}

/* ---------- original-language lexicon (Strong's, no API) ---------- */
/* Data: data/lexicon/ — hebrew/greek per-book word lists (OSHB / TAGNT),
   strongs-zh.json (Strong's + UBS Chinese glosses), concordance shards.
   Word files are keyed by KJV versification; a few CUV chapters drift
   (e.g. Num 1). Verses with no lexicon words simply show no orig line. */
const LEX_CONC_ABBREV = {
  Gen: "gen", Exod: "ex", Lev: "lv", Num: "nm", Deu: "dt", Josh: "jos", Judg: "jdg",
  Ruth: "rut", "1Sam": "1sa", "2Sam": "2sa", "1Kgs": "1ki", "2Kgs": "2ki",
  "1Chr": "1ch", "2Chr": "2ch", Ezra: "ezr", Neh: "neh", Esth: "est", Job: "job",
  Ps: "psa", Prov: "pro", Eccl: "ecc", Song: "sng", Isa: "isa", Jer: "jer", Lam: "lam",
  Ezek: "ezk", Dan: "dan", Hos: "hos", Joel: "jol", Amos: "amo", Obad: "oba",
  Jonah: "jon", Mic: "mic", Nah: "nam", Hab: "hab", Zeph: "zep", Hag: "hag",
  Zech: "zec", Mal: "mal", Matt: "mat", Mark: "mrk", Luke: "luk", John: "jhn",
  Acts: "act", Rom: "rom", "1Cor": "1co", "2Cor": "2co", Gal: "gal", Eph: "eph",
  Phil: "php", Col: "col", "1Thess": "1th", "2Thess": "2th", "1Tim": "1ti",
  "2Tim": "2ti", Titus: "tit", Phlm: "phm", Heb: "heb", Jas: "jas", "1Pet": "1pe",
  "2Pet": "2pe", "1John": "1jn", "2John": "2jn", "3John": "3jn", Jude: "jud", Rev: "rev",
};
const LEX_POS_ZH = {
  noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词",
  preposition: "介词", conjunction: "连词", pronoun: "代词", particle: "小品词",
  interjection: "感叹词", article: "冠词", prefix: "前缀", numeral: "数词",
};
const lexBookCache = {};
const concShardCache = {};
let strongsDict = null;
let lexHighlight = null; // {book, chapter, verse, strong} — jump target from a ref tap
let lexCurrent = null; // {strong, form, entry, conc, curKey} — current drawer content

async function loadLexiconBook(abbrev) {
  if (lexBookCache[abbrev]) return lexBookCache[abbrev];
  const book = bookByAbbrev(abbrev);
  const dir = book && book.testament === "OT" ? "hebrew" : "greek";
  const data = await (await fetch("data/lexicon/" + dir + "/" + abbrev + ".json")).json();
  const map = new Map();
  data.forEach((entry) => map.set(entry.v[0] + ":" + entry.v[1], entry.w));
  lexBookCache[abbrev] = map;
  return map;
}
async function loadStrongsDict() {
  if (strongsDict) return strongsDict;
  strongsDict = await (await fetch("data/lexicon/strongs-zh.json")).json();
  return strongsDict;
}
async function loadConcordance(strong) {
  const n = parseInt(strong.slice(1), 10);
  const shard = String(Math.floor(n / 100) * 100).padStart(4, "0");
  const key = strong[0] + shard;
  if (!concShardCache[key]) {
    concShardCache[key] = await (await fetch("data/lexicon/concordance/" + key + ".json")).json();
  }
  return concShardCache[key][strong] || null;
}

/* Robinson morphology code → Chinese, Greek only. Returns null when the
   code does not match a known pattern; the caller then shows the raw code. */
const GREEK_CASE = { N: "主格", G: "属格", D: "与格", A: "宾格", V: "呼格" };
const GREEK_NUM = { S: "单数", P: "复数" };
const GREEK_GEN = { M: "阳性", F: "阴性", N: "中性" };
const GREEK_TENSE = { P: "现在时", I: "未完成时", F: "将来时", A: "不定过去时", X: "完成时", Y: "过去完成时" };
const GREEK_VOICE = { A: "主动", M: "中间", P: "被动", E: "中间/被动", D: "异相" };
const GREEK_MOOD = { I: "直陈", S: "虚拟", O: "祈愿", M: "命令", N: "不定式", P: "分词" };
function lexTense(code) {
  const second = code.charAt(0) === "2";
  const base = second ? code.charAt(1) : code.charAt(0);
  return (second ? "第二" : "") + (GREEK_TENSE[base] || "");
}
function decodeGreekMorph(m) {
  if (!m) return null;
  if (m === "CONJ") return "连词";
  if (m === "PREP") return "介词";
  if (m === "ADV") return "副词";
  if (m === "PRT" || m.indexOf("PRT-") === 0) return "小品词";
  if (m === "I") return "感叹词";
  let mm = m.match(/^([NATP])-([NGDAV])([SP])([MFN])$/);
  if (mm) {
    const pos = { N: "名词", A: "形容词", T: "冠词", P: "代词" }[mm[1]];
    return pos + " · " + GREEK_CASE[mm[2]] + GREEK_NUM[mm[3]] + GREEK_GEN[mm[4]];
  }
  mm = m.match(/^V-([123]?[PIFAXY])([AMPED])([ISOM])-([123])([SP])$/);
  if (mm) return "动词 · " + lexTense(mm[1]) + GREEK_VOICE[mm[2]] + GREEK_MOOD[mm[3]] + " " + mm[4] + GREEK_NUM[mm[5]];
  mm = m.match(/^V-([123]?[PIFAXY])([AMPED])N$/);
  if (mm) return "动词 · " + lexTense(mm[1]) + GREEK_VOICE[mm[2]] + "不定式";
  mm = m.match(/^V-([123]?[PIFAXY])([AMPED])P-([NGDAV])([SP])([MFN])$/);
  if (mm) return "动词 · " + lexTense(mm[1]) + GREEK_VOICE[mm[2]] + "分词 · " + GREEK_CASE[mm[3]] + GREEK_NUM[mm[4]] + GREEK_GEN[mm[5]];
  return null;
}
function lexMorphText(tok, isGreek) {
  const decoded = isGreek ? decodeGreekMorph(tok.m) : null;
  if (decoded) return { main: decoded, code: tok.m };
  return { main: null, code: tok.m };
}

/* Group concordance refs ("Gen.2.4") by book, keeping canonical order. */
function lexGroupRefs(refs) {
  const groups = [];
  const byBook = {};
  (refs || []).forEach((r) => {
    const parts = r.split(".");
    const ab = LEX_CONC_ABBREV[parts[0]];
    if (!ab || parts.length !== 3) return;
    if (!byBook[ab]) { byBook[ab] = { book: ab, items: [] }; groups.push(byBook[ab]); }
    byBook[ab].items.push({ chapter: +parts[1], verse: +parts[2] });
  });
  return groups;
}
function lexRefHtml(item, book, curKey) {
  const key = book + ":" + item.chapter + ":" + item.verse;
  const isCur = key === curKey;
  return `<button class="lex-ref${isCur ? " current" : ""}" data-book="${book}" data-ch="${item.chapter}" data-v="${item.verse}">${item.chapter}:${item.verse}${isCur ? " · 当前" : ""}</button>`;
}
function lexGroupHtml(group, curKey) {
  const head = `<div class="lex-group-head">${esc(bookByAbbrev(group.book).name)} <span class="lex-group-count">${group.items.length} 节</span></div>`;
  const shown = group.items.slice(0, 10);
  const rest = group.items.slice(10);
  const refs = shown.map((it) => lexRefHtml(it, group.book, curKey)).join("") +
    (rest.length ? `<span class="lex-ref-rest hidden">${rest.map((it) => lexRefHtml(it, group.book, curKey)).join("")}</span>` : "");
  const more = rest.length ? `<button class="lex-ref-more" data-rest="${rest.length}">展开全部（还有 ${rest.length} 条）</button>` : "";
  return `<div class="lex-group">${head}<div class="lex-group-refs">${refs}${more}</div></div>`;
}
function lexRefsHtml(conc, curKey) {
  const groups = lexGroupRefs(conc.refs);
  return groups.map((g) => lexGroupHtml(g, curKey)).join("");
}
function lexDistHtml(conc) {
  const groups = lexGroupRefs(conc.refs);
  const rows = groups.map((g) =>
    `<div class="lex-dist-row"><span>${esc(bookByAbbrev(g.book).name)}</span><b>${g.items.length} 节</b></div>`).join("");
  return `<p class="lex-dist-note">出现 ${conc.count.toLocaleString()} 次，分布在 ${groups.length} 卷。先显示各卷分布：</p>` +
    `<div class="lex-dist">${rows}</div>` +
    `<button class="btn-ghost lex-show-all" id="lex-show-all">查看全部出处</button>`;
}

function lexEntryText(strong, form, entry, conc) {
  const lines = [form + "  " + strong];
  if (entry.translit) lines.push("音译：" + entry.translit);
  if (entry.lemma) lines.push("词元：" + entry.lemma);
  const pos = LEX_POS_ZH[entry.pos] || entry.pos || "";
  if (pos) lines.push("词性：" + pos);
  if (entry.gloss_zh) lines.push("中文释义：" + entry.gloss_zh);
  else if (entry.gloss_en) lines.push("英文释义：" + entry.gloss_en + "（暂无中文释义）");
  if (entry.def_zh) lines.push("详细释义：" + entry.def_zh);
  if (conc) lines.push("全圣经出现 " + conc.count.toLocaleString() + " 次（分布在 " + conc.refs.length + " 节）");
  lines.push("—— Nesive Bible 原文词典");
  return lines.join("\n");
}

async function openLexicon(tok, bookAbbrev, chapter, verse) {
  const body = $("#lex-body");
  const book = bookByAbbrev(bookAbbrev);
  const isGreek = book && book.testament === "NT";
  body.innerHTML = `<p class="lex-loading">正在查词典…</p>`;
  openDrawer("#drawer-lexicon");
  let dict, conc;
  try {
    [dict, conc] = await Promise.all([loadStrongsDict(), loadConcordance(tok.s)]);
  } catch (e) {
    body.innerHTML = `<p class="lex-loading">词典加载失败（${esc(String(e.message || e))}）。<br>请检查网络后重新点词。</p>`;
    return;
  }
  const entry = dict[tok.s] || {};
  const curKey = bookAbbrev + ":" + chapter + ":" + verse;
  const posZh = LEX_POS_ZH[entry.pos] || entry.pos || "—";
  const morph = lexMorphText(tok, isGreek);
  const strong = tok.s;
  const form = tok.t;
  let html = `<div class="lex-head" dir="${isGreek ? "ltr" : "rtl"}"><div class="lex-form">${esc(form)}</div>` +
    (entry.translit ? `<div class="lex-translit">${esc(entry.translit)}</div>` : "") + `</div>`;
  html += `<div class="lex-rows">`;
  html += `<div class="lex-row"><span>Strong's</span><div><button class="lex-strong" id="lex-copy-strong">${esc(strong)}</button><span class="lex-hint">点编号复制</span></div></div>`;
  if (entry.lemma) html += `<div class="lex-row"><span>词元</span><div class="lex-lemma" dir="${isGreek ? "ltr" : "rtl"}">${esc(entry.lemma)}</div></div>`;
  html += `<div class="lex-row"><span>词性</span><div>${esc(posZh)}</div></div>`;
  if (morph.main) html += `<div class="lex-row"><span>形态</span><div>${esc(morph.main)} <code class="lex-code">${esc(morph.code)}</code></div></div>`;
  else if (morph.code) html += `<div class="lex-row"><span>形态码</span><div><code class="lex-code">${esc(morph.code)}</code></div></div>`;
  if (entry.gloss_zh) html += `<div class="lex-row"><span>中文释义</span><div class="lex-gloss">${esc(entry.gloss_zh)}</div></div>`;
  else html += `<div class="lex-row"><span>中文释义</span><div class="lex-nozh">暂无中文释义</div></div>`;
  if (!entry.gloss_zh && entry.gloss_en) html += `<div class="lex-row"><span>英文释义</span><div>${esc(entry.gloss_en)}</div></div>`;
  if (entry.def_zh) html += `<div class="lex-row"><span>详细释义</span><div>${esc(entry.def_zh)}</div></div>`;
  else if (entry.gloss_en && entry.gloss_zh) html += `<div class="lex-row"><span>英文释义</span><div>${esc(entry.gloss_en)}</div></div>`;
  if (conc) html += `<div class="lex-row"><span>出现</span><div>全圣经出现 <b>${conc.count.toLocaleString()}</b> 次（分布在 ${conc.refs.length} 节）</div></div>`;
  html += `</div>`;
  if (conc && conc.refs && conc.refs.length) {
    html += `<div class="lex-refs-head">全部出处</div><div id="lex-refs">`;
    if (conc.count > 500) html += lexDistHtml(conc);
    else html += lexRefsHtml(conc, curKey);
    html += `</div>`;
  } else if (conc) {
    html += `<p class="lex-loading">本词无汇编出处。</p>`;
  }
  html += `<div class="lex-actions"><button class="btn-ghost" id="lex-copy">复制词条</button></div>`;
  html += `<p class="drawer-note">原文数据：希伯来文（OSHB / WLC，公有领域；标注 CC BY 4.0）、希腊文（STEPBible TAGNT，CC BY 4.0）、中文释义（UBS 词典，CC BY-SA 4.0）。<a href="data/lexicon/LICENSE-DATA.md" target="_blank" rel="noopener">来源与许可</a></p>`;
  body.innerHTML = html;
  lexCurrent = { strong, form, entry, conc, curKey };
}

/* One delegated handler for the whole lexicon drawer, so re-rendered
   ref lists (show-all / expand) keep working without re-binding. */
function initLexiconDrawer() {
  $("#lex-body").addEventListener("click", (e) => {
    if (e.target.closest("#lex-copy-strong") && lexCurrent) {
      copyText(lexCurrent.strong, "已复制 " + lexCurrent.strong);
      return;
    }
    if (e.target.closest("#lex-copy") && lexCurrent) {
      copyText(lexEntryText(lexCurrent.strong, lexCurrent.form, lexCurrent.entry, lexCurrent.conc), "词条已复制");
      return;
    }
    if (e.target.closest("#lex-show-all") && lexCurrent) {
      $("#lex-refs").innerHTML = lexRefsHtml(lexCurrent.conc, lexCurrent.curKey);
      return;
    }
    const more = e.target.closest(".lex-ref-more");
    if (more) {
      const rest = more.parentElement.querySelector(".lex-ref-rest");
      if (rest) rest.classList.remove("hidden");
      more.remove();
      return;
    }
    const ref = e.target.closest(".lex-ref");
    if (ref && lexCurrent) {
      const target = { book: ref.dataset.book, chapter: +ref.dataset.ch, verse: +ref.dataset.v, strong: lexCurrent.strong };
      closeDrawers();
      if (target.book === current.book && target.chapter === current.chapter) {
        lexHighlight = target;
        highlightLexTarget();
      } else {
        lexHighlight = target;
        location.hash = "#/read/" + target.book + "/" + target.chapter;
      }
    }
  });
}

function maybeHighlightLexTarget() {
  if (!lexHighlight) return;
  if (lexHighlight.book !== current.book || lexHighlight.chapter !== current.chapter) return;
  highlightLexTarget();
}
function highlightLexTarget() {
  if (!lexHighlight) return;
  const { verse, strong } = lexHighlight;
  lexHighlight = null;
  const vEl = $("#verses");
  const verseEl = vEl.querySelector(`.verse[data-v="${verse}"]`);
  if (!verseEl) return;
  if (isPageMode() && pageState.total) {
    const pages = Array.from(vEl.querySelectorAll(".page"));
    const idx = pages.findIndex((pg) => pg.contains(verseEl));
    if (idx >= 0 && idx !== pageState.index) goPage(idx);
  } else {
    verseEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  verseEl.classList.add("lex-target");
  setTimeout(() => verseEl.classList.remove("lex-target"), 2600);
  if (settings.original) {
    const line = vEl.querySelector(`.orig-line[data-v="${verse}"]`);
    if (line) {
      line.querySelectorAll(`.oword[data-s="${strong}"]`).forEach((w) => {
        w.classList.add("lex-target-word");
        setTimeout(() => w.classList.remove("lex-target-word"), 2600);
      });
    }
  }
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
    if (text) blocks.push({ label: VERSIONS[v].label, text, en: VERSIONS[v].lang === "en" });
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
const BACKUP_KEYS = ["bookmarks", "highlights", "notes", "history", "settings", "lastRead", "plan", "typingProgress", "typingBest", "typingMistakes", "typingStats"];
function exportBackup() {
  const data = { app: "FlareBible", version: 1, exportedAt: new Date().toISOString(), profile: currentProfile().name, data: {} };
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
    // The backup restores into the CURRENT profile; note when it came from another profile.
    const from = data.profile ? "（备份来自档案「" + data.profile + "」，已导入当前档案「" + currentProfile().name + "」）" : "";
    toast("已导入备份（" + n + " 项）" + from);
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
  ["#drawer-picker", "#drawer-version", "#drawer-settings", "#drawer-lexicon"].forEach((s) => $(s).classList.add("hidden"));
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
    if (pickerMode === "typing") {
      pickerMode = "read";
      location.hash = "#/typing?book=" + abbrev + "&chapter=" + b.dataset.ch;
    } else {
      location.hash = "#/read/" + abbrev + "/" + b.dataset.ch;
    }
  }));
}

/* ---------- typing: learn English through the Bible (earthworm style) ---------- */
let typingIpa = null, typingIpaLoading = null;
let typingSet = null;        // {title, verses: [{book, chapter, verse, zh, en}]}
let typingIdx = 0;
let typingMode = "dictation"; // dictation | copy | listen
let typingShowIpa = true;
let typingAttempt = null;    // {typed:[], cur:0, startedAt, submitted, revealed}
let typingSession = null;    // {verses, words, correct, wpmTotal, wpmCount}
let pickerMode = "read";     // "read" | "typing"
const TYPING_CLASSICS = [
  { name: "约翰福音 3:16", refs: [["jhn", 3, 16]] },
  { name: "诗篇 23 篇", refs: [["psa", 23, 1], ["psa", 23, 2], ["psa", 23, 3], ["psa", 23, 4], ["psa", 23, 5], ["psa", 23, 6]] },
  { name: "主祷文", refs: [["mat", 6, 9], ["mat", 6, 10], ["mat", 6, 11], ["mat", 6, 12], ["mat", 6, 13]] },
  { name: "爱篇 · 林前 13:4-7", refs: [["1co", 13, 4], ["1co", 13, 5], ["1co", 13, 6], ["1co", 13, 7]] },
  { name: "约翰福音 1:1", refs: [["jhn", 1, 1]] },
  { name: "创世记 1:1", refs: [["gen", 1, 1]] },
];
function normWord(w) { return String(w || "").toLowerCase().replace(/[^a-z']/g, ""); }
function typingTokens(enText) {
  return String(enText || "").split(/\s+/).filter(Boolean).map((tok) => ({ disp: tok, norm: normWord(tok) }));
}
async function loadTypingIpa() {
  if (typingIpa) return typingIpa;
  if (!typingIpaLoading) {
    typingIpaLoading = fetch("data/ipa.json").then((r) => r.json()).then((j) => {
      typingIpa = j;
      if (typingSet && !$("#typing-practice").classList.contains("hidden")) renderTypingSlots();
      return j;
    }).catch(() => { typingIpa = {}; return typingIpa; });
  }
  return typingIpaLoading;
}
function typingPickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return null;
  const pref = vs.filter((v) => v.lang && v.lang.toLowerCase().indexOf("en-us") === 0);
  const pool = pref.length ? pref : vs.filter((v) => v.lang && v.lang.toLowerCase().indexOf("en") === 0);
  if (!pool.length) return null;
  return pool.find((v) => /google|natural|samantha|zira|aria/i.test(v.name)) || pool[0];
}
function typingSpeak(text, onEnd) {
  if (!("speechSynthesis" in window)) { toast("本机不支持语音朗读"); return false; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    const v = typingPickVoice();
    if (v) u.voice = v;
    u.onerror = () => { toast("本机无英文语音，无法朗读"); };
    if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}
if ("speechSynthesis" in window) {
  speechSynthesis.addEventListener("voiceschanged", () => {});
}
function typingMistakes() { return store.get("typingMistakes", {}); }
function typingStats() { return store.get("typingStats", { verses: 0, words: 0, correct: 0, wpmTotal: 0, wpmCount: 0, bestWpm: 0 }); }
async function buildTypingVerses(refs) {
  const out = [];
  const cache = {};
  for (const [book, ch, vs] of refs) {
    if (!cache[book]) {
      const [cuv, kjv] = await Promise.all([loadBook(book, "cuv"), loadBook(book, "kjv")]);
      cache[book] = { cuv, kjv };
    }
    const zh = cache[book].cuv.chapters[ch - 1] ? cache[book].cuv.chapters[ch - 1][vs - 1] : "";
    const en = cache[book].kjv.chapters[ch - 1] ? cache[book].kjv.chapters[ch - 1][vs - 1] : "";
    if (en && en.trim()) out.push({ book, chapter: ch, verse: vs, zh: zh || "", en });
  }
  return out;
}
async function startTypingSet(title, refs) {
  const verses = await buildTypingVerses(refs);
  if (!verses.length) { toast("没有可练习的经文"); return; }
  typingSet = { title, verses };
  typingIdx = 0;
  typingSession = { verses: 0, words: 0, correct: 0, wpmTotal: 0, wpmCount: 0 };
  store.set("typingProgress", { title, idx: 0, at: Date.now() });
  showTypingView();
  showTypingVerse();
}
function showTypingView() {
  $("#typing-home").classList.add("hidden");
  $("#typing-summary").classList.add("hidden");
  $("#typing-practice").classList.remove("hidden");
}
async function renderTypingHome() {
  await loadIndex();
  $("#typing-practice").classList.add("hidden");
  $("#typing-summary").classList.add("hidden");
  $("#typing-home").classList.remove("hidden");
  const last = store.get("lastRead", null);
  const cur = (current && current.book) ? current : last;
  const chRef = cur ? refLabel(cur.book, cur.chapter) : "创世记 1章";
  const chBook = cur ? cur.book : "gen", chNum = cur ? cur.chapter : 1;
  const daily = DAILY_VERSES[dayOfYear() % DAILY_VERSES.length];
  const mistakes = typingMistakes();
  const mCount = Object.keys(mistakes).length;
  const st = typingStats();
  const acc = st.words ? Math.round((st.correct / st.words) * 100) : null;
  const cards = [
    { id: "chapter", name: "练本章", desc: chRef, go: () => startTypingChapter(chBook, chNum) },
    { id: "daily", name: "今日金句", desc: refLabel(daily[0], daily[1], daily[2]), go: () => startTypingSet("今日金句 · " + refLabel(daily[0], daily[1], daily[2]), [[daily[0], daily[1], daily[2]]]) },
    { id: "mistakes", name: "复习错词", desc: mCount ? mCount + " 个词待复习" : "暂无错词，先练几节", go: () => startMistakeReview(), disabled: !mCount },
    { id: "pick", name: "自选章节", desc: "选一卷一章来练", go: () => { pickerMode = "typing"; renderPicker(); openDrawer("#drawer-picker"); } },
  ];
  let html = cards.map((c) =>
    `<button class="typing-set-card" data-set="${c.id}" ${c.disabled ? "disabled" : ""}><strong>${esc(c.name)}</strong><span>${esc(c.desc)}</span></button>`).join("");
  html += `<h2 class="typing-sec">经典段落</h2><div class="typing-sets">` +
    TYPING_CLASSICS.map((c, i) =>
      `<button class="typing-set-card" data-classic="${i}"><strong>${esc(c.name)}</strong><span>${c.refs.length} 节</span></button>`).join("") + `</div>`;
  $("#typing-sets").innerHTML = html;
  $$("#typing-sets .typing-set-card").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.set) { const c = cards.find((x) => x.id === b.dataset.set); if (c) c.go(); }
    else if (b.dataset.classic !== undefined) {
      const c = TYPING_CLASSICS[parseInt(b.dataset.classic, 10)];
      startTypingSet(c.name, c.refs);
    }
  }));
  $("#typing-stats").innerHTML =
    `<div class="typing-stat"><b>${st.verses}</b><span>已练节数</span></div>` +
    `<div class="typing-stat"><b>${st.words}</b><span>累计单词</span></div>` +
    `<div class="typing-stat"><b>${acc === null ? "—" : acc + "%"}</b><span>平均正确率</span></div>` +
    `<div class="typing-stat"><b>${st.bestWpm ? Math.round(st.bestWpm) : "—"}</b><span>最佳 WPM</span></div>`;
  const prog = store.get("typingProgress", null);
  if (prog && prog.title && typingSet && typingSet.title === prog.title && prog.idx > 0 && prog.idx < typingSet.verses.length) {
    typingIdx = prog.idx;
  }
}
let typingBookCache = {};
async function startTypingChapter(book, chapter) {
  if (!typingBookCache[book]) typingBookCache[book] = await loadBook(book, "kjv");
  const n = typingBookCache[book].chapters[chapter - 1] ? typingBookCache[book].chapters[chapter - 1].length : 0;
  const refs = [];
  for (let v = 1; v <= n; v++) refs.push([book, chapter, v]);
  await startTypingSet("练本章 · " + refLabel(book, chapter), refs);
}
function startMistakeReview() {
  const mistakes = typingMistakes();
  const refs = [];
  const seen = new Set();
  Object.values(mistakes).forEach((m) => {
    const k = m.book + ":" + m.chapter + ":" + m.verse;
    if (!seen.has(k)) { seen.add(k); refs.push([m.book, m.chapter, m.verse]); }
  });
  if (!refs.length) { toast("暂无错词"); return; }
  startTypingSet("复习错词", refs);
}
async function renderTyping(book, chapter, verse) {
  await loadIndex();
  if (verse) {
    await startTypingSet(refLabel(book, chapter, verse), [[book, chapter, verse]]);
  } else {
    await startTypingChapter(book, chapter);
  }
}
function currentTypingVerse() { return typingSet ? typingSet.verses[typingIdx] : null; }
function showTypingVerse(autoSpeak) {
  const v = currentTypingVerse();
  if (!v) return;
  loadTypingIpa();
  typingAttempt = { typed: [], cur: 0, startedAt: 0, submitted: false, revealed: false, results: [] };
  typingAttempt.tokens = typingTokens(v.en);
  $("#typing-ref").textContent = typingSet.title + " · 第 " + (typingIdx + 1) + " / " + typingSet.verses.length + " 节";
  $("#typing-count").textContent = refLabel(v.book, v.chapter, v.verse);
  $("#typing-bar").style.width = Math.round((typingIdx / typingSet.verses.length) * 100) + "%";
  $$("#typing-mode button").forEach((b) => b.classList.toggle("active", b.dataset.m === typingMode));
  renderTypingPrompt();
  renderTypingSlots();
  $("#typing-input").value = "";
  $("#typing-next").textContent = typingIdx === typingSet.verses.length - 1 ? "看总结 →" : "下一节 →";
  if (autoSpeak && typingMode === "listen") typingSpeak(v.en);
}
function renderTypingPrompt() {
  const v = currentTypingVerse();
  const p = $("#typing-prompt");
  if (!v) { p.textContent = ""; return; }
  if (typingMode === "dictation") { p.textContent = v.zh; p.classList.remove("typing-prompt-en"); }
  else if (typingMode === "copy") { p.textContent = v.en; p.classList.add("typing-prompt-en"); }
  else { p.innerHTML = "🔊 点右上角喇叭听读音，凭听到的打出来"; p.classList.remove("typing-prompt-en"); }
}
function renderTypingSlots() {
  const v = currentTypingVerse();
  const a = typingAttempt;
  const box = $("#typing-slots");
  if (!v || !a) { box.innerHTML = ""; return; }
  box.innerHTML = a.tokens.map((t, i) => {
    const typed = a.typed[i] || "";
    let cls = "tslot";
    if (a.submitted) cls += a.results[i] ? " t-ok" : " t-bad";
    else if (i === a.cur) cls += " t-cur";
    const ipa = (typingShowIpa && typingIpa && typingIpa[t.norm]) ? `<span class="tipa">/${esc(typingIpa[t.norm])}/</span>` : `<span class="tipa"></span>`;
    const fix = (a.submitted && !a.results[i]) ? `<span class="tfix">${esc(t.disp)}</span>` : "";
    return `<span class="${cls}" data-i="${i}" style="min-width:${Math.max(3, t.disp.length)}ch"><span class="tword">${esc(typed)}</span><span class="tline"></span>${ipa}${fix}</span>`;
  }).join(" ");
  const curEl = box.querySelector(".tslot.t-cur");
  if (curEl) curEl.scrollIntoView({ block: "nearest" });
}
function typingCommitCurrent() {
  const a = typingAttempt;
  const inp = $("#typing-input");
  const w = inp.value.trim();
  if (!a || a.submitted) return false;
  if (!w) return false;
  if (!a.startedAt) a.startedAt = Date.now();
  a.typed[a.cur] = w;
  inp.value = "";
  if (a.cur < a.tokens.length - 1) a.cur++;
  else { renderTypingSlots(); typingSubmit(); return true; }
  renderTypingSlots();
  return true;
}
function typingSubmit() {
  const a = typingAttempt;
  const v = currentTypingVerse();
  if (!a || a.submitted || !v) return;
  a.submitted = true;
  let correct = 0;
  a.results = a.tokens.map((t, i) => {
    const ok = normWord(a.typed[i] || "") === t.norm && (a.typed[i] || "") !== "";
    if (ok) correct++;
    return ok;
  });
  const total = a.tokens.length;
  const mins = Math.max((Date.now() - (a.startedAt || Date.now())) / 60000, 1 / 60);
  const wpm = correct / mins;
  typingSession.verses++;
  typingSession.words += total;
  typingSession.correct += correct;
  typingSession.wpmTotal += wpm;
  typingSession.wpmCount++;
  // mistakes book: wrong words in, words typed right in review come out
  const mistakes = typingMistakes();
  let changed = false;
  a.tokens.forEach((t, i) => {
    if (!t.norm) return;
    if (!a.results[i]) {
      if (!mistakes[t.norm]) mistakes[t.norm] = { word: t.norm, disp: t.disp, book: v.book, chapter: v.chapter, verse: v.verse, count: 0 };
      mistakes[t.norm].count++;
      changed = true;
    } else if (mistakes[t.norm]) {
      delete mistakes[t.norm];
      changed = true;
    }
  });
  if (changed) store.set("typingMistakes", mistakes);
  const st = typingStats();
  st.verses++; st.words += total; st.correct += correct;
  st.wpmTotal += wpm; st.wpmCount++;
  if (wpm > (st.bestWpm || 0)) st.bestWpm = Math.round(wpm);
  store.set("typingStats", st);
  store.set("typingProgress", { title: typingSet.title, idx: typingIdx + 1, at: Date.now() });
  renderTypingSlots();
  toast(correct === total ? "全对！" : "对了 " + correct + " / " + total + " 词");
  typingSpeak(v.en);
}
function typingReveal() {
  const a = typingAttempt;
  const v = currentTypingVerse();
  if (!a || !v || a.submitted) return;
  typingSubmit(); // honest score of what was actually typed; untyped = wrong
  // then fill the untyped slots so the full sentence is readable (they stay red = missed)
  a.tokens.forEach((t, i) => { if (!a.typed[i]) a.typed[i] = t.disp.replace(/[.,;:!?""''()]/g, ""); });
  renderTypingSlots();
  toast("已揭晓答案");
}
function typingHint() {
  const a = typingAttempt;
  if (!a || a.submitted) return;
  const t = a.tokens[a.cur];
  if (!t) return;
  if (!a.startedAt) a.startedAt = Date.now();
  a.typed[a.cur] = t.disp.replace(/[.,;:!?""''()]/g, "");
  if (a.cur < a.tokens.length - 1) a.cur++;
  else { renderTypingSlots(); typingSubmit(); return; }
  renderTypingSlots();
  $("#typing-input").focus();
}
function typingNextVerse() {
  if (!typingSet) return;
  const a = typingAttempt;
  if (a && !a.submitted) {
    const typedCount = a.typed.filter(Boolean).length;
    if (typedCount === 0) {
      // skipped without typing anything: no stats, just move on
      if (typingIdx < typingSet.verses.length - 1) { typingIdx++; showTypingVerse(true); }
      else renderTypingSummary();
      return;
    }
    typingSubmit(); // score what was typed, stay to see the feedback; next tap advances
    return;
  }
  if (typingIdx < typingSet.verses.length - 1) {
    typingIdx++;
    showTypingVerse(true);
  } else {
    renderTypingSummary();
  }
}
function renderTypingSummary() {
  $("#typing-practice").classList.add("hidden");
  $("#typing-summary").classList.remove("hidden");
  const s = typingSession || { verses: 0, words: 0, correct: 0, wpmTotal: 0, wpmCount: 0 };
  const acc = s.words ? Math.round((s.correct / s.words) * 100) : 0;
  const avgWpm = s.wpmCount ? Math.round(s.wpmTotal / s.wpmCount) : 0;
  $("#typing-summary-body").innerHTML =
    `<div class="typing-stat"><b>${s.verses}</b><span>完成节数</span></div>` +
    `<div class="typing-stat"><b>${s.words}</b><span>总词数</span></div>` +
    `<div class="typing-stat"><b>${acc}%</b><span>平均正确率</span></div>` +
    `<div class="typing-stat"><b>${avgWpm || "—"}</b><span>平均 WPM</span></div>` +
    `<p class="typing-summary-note">${acc === 100 ? "全对，太棒了！" : acc >= 80 ? "很不错，继续保持。" : "多练几遍，错词已收进错词本。"}</p>`;
}
function initTyping() {
  $("#typing-back").addEventListener("click", () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); renderTypingHome(); });
  $("#typing-speak").addEventListener("click", () => { const v = currentTypingVerse(); if (v) typingSpeak(v.en); });
  $$("#typing-mode button").forEach((b) => b.addEventListener("click", () => {
    typingMode = b.dataset.m;
    $$("#typing-mode button").forEach((x) => x.classList.toggle("active", x.dataset.m === typingMode));
    renderTypingPrompt();
    if (typingMode === "listen") { const v = currentTypingVerse(); if (v) typingSpeak(v.en); }
    $("#typing-input").focus();
  }));
  $("#typing-slots").addEventListener("click", (e) => {
    const slot = e.target.closest(".tslot");
    const a = typingAttempt;
    if (slot && a && a.submitted) {
      const t = a.tokens[parseInt(slot.dataset.i, 10)];
      if (t) typingSpeak(t.disp);
      return;
    }
    $("#typing-input").focus();
  });
  const inp = $("#typing-input");
  inp.addEventListener("input", () => {
    const a = typingAttempt;
    if (!a || a.submitted) return;
    const val = inp.value;
    if (val.indexOf(" ") >= 0) {
      inp.value = val.split(" ")[0];
      typingCommitCurrent();
      return;
    }
    if (!a.startedAt && val) a.startedAt = Date.now();
    const cur = a.tokens[a.cur];
    if (cur) {
      const slot = $("#typing-slots").querySelector('.tslot[data-i="' + a.cur + '"] .tword');
      if (slot) slot.textContent = val;
    }
  });
  inp.addEventListener("keydown", (e) => {
    const a = typingAttempt;
    if (!a) return;
    if (e.key === "Backspace" && !inp.value && a.cur > 0 && !a.submitted) {
      e.preventDefault();
      a.cur--;
      inp.value = a.typed[a.cur] || "";
      a.typed[a.cur] = "";
      renderTypingSlots();
      const slot = $("#typing-slots").querySelector('.tslot[data-i="' + a.cur + '"] .tword');
      if (slot) slot.textContent = inp.value;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (a.submitted) { typingNextVerse(); return; }
      if (inp.value.trim()) typingCommitCurrent();
      else if (a.cur === a.tokens.length - 1 && (a.typed[a.cur] || "")) typingSubmit();
      else if (a.typed.filter(Boolean).length === a.tokens.length) typingSubmit();
    }
  });
  $("#typing-hint").addEventListener("click", typingHint);
  $("#typing-reveal").addEventListener("click", typingReveal);
  $("#typing-next").addEventListener("click", typingNextVerse);
  $("#typing-again").addEventListener("click", () => { renderTypingHome(); });
  $("#typing-goread").addEventListener("click", () => {
    const last = store.get("lastRead", null);
    location.hash = last ? "#/read/" + last.book + "/" + last.chapter : "#/read/gen/1";
  });
  $("#sheet-typing").addEventListener("click", () => {
    if (!sheetVerse) return;
    const v = sheetVerse;
    closeSheet();
    location.hash = "#/typing?book=" + v.book + "&chapter=" + v.chapter + "&verse=" + v.verse;
  });
  $("#btn-typing-chapter").addEventListener("click", () => {
    location.hash = "#/typing?book=" + current.book + "&chapter=" + current.chapter;
  });
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
  $("#btn-settings").addEventListener("click", () => { renderProfiles(); openDrawer("#drawer-settings"); });
  $("#btn-search-top").addEventListener("click", () => { location.hash = "#/search"; });
  // settings
  $$("#seg-font button").forEach((b) => b.addEventListener("click", () => { settings.font = b.dataset.f; applySettings(); renderChapter(current.book, current.chapter); }));
  $$("#seg-line button").forEach((b) => b.addEventListener("click", () => { settings.line = b.dataset.l; applySettings(); applyPageMode(); }));
  $$("#seg-reading button").forEach((b) => b.addEventListener("click", () => {
    settings.readingMode = b.dataset.rm; applySettings();
    if (readViewVisible()) applyPageMode();
    toast(settings.readingMode === "page" ? "已切换为翻页阅读" : "已切换为滚动阅读");
  }));
  initPageGestures();
  $("#set-versenums").addEventListener("change", (e) => { settings.showNums = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  $("#set-headings").addEventListener("change", (e) => { settings.showHeadings = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  $("#set-poetry").addEventListener("change", (e) => { settings.poetry = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  $("#set-original").addEventListener("change", (e) => { settings.original = e.target.checked; applySettings(); renderChapter(current.book, current.chapter); });
  // drawers
  $("#drawer-backdrop").addEventListener("click", closeDrawers);
  $("#drawer-close").addEventListener("click", closeDrawers);
  $("#version-close").addEventListener("click", closeDrawers);
  $("#settings-close").addEventListener("click", closeDrawers);
  $("#lexicon-close").addEventListener("click", closeDrawers);
  initLexiconDrawer();
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
  $("#btn-add-profile").addEventListener("click", () => {
    const name = prompt("新档案名称（例如：妻子）");
    if (name === null) return;
    const id = addProfile(name);
    if (!id) { toast("请输入档案名称"); return; }
    renderProfiles();
    toast("已新增档案「" + name.trim() + "」，点档案名即可切换");
  });
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
  // typing
  initTyping();
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
  // keyboard: prev/next chapter (in scroll mode; page mode owns ← → for turning pages)
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && !isPageMode() && !$("#view-read").classList.contains("hidden") && !e.target.matches("input,textarea")) $("#btn-prev").click();
    if (e.key === "ArrowRight" && !isPageMode() && !$("#view-read").classList.contains("hidden") && !e.target.matches("input,textarea")) $("#btn-next").click();
    if (e.key === "Escape") { closeDrawers(); closeSheet(); }
  });
  route();
}
document.addEventListener("DOMContentLoaded", init);
