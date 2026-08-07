(() => {
"use strict";
const $ = id => document.getElementById(id);
const API = "https://en.wikipedia.org/w/api.php";

let currentCat = "all", currentChannel = "Anything";
let rouletteTimer = null, busy = false, current = null;
let currentUser = null, userData = null, activeTab = "saved";

const WEIRD = ["Dancing_plague_of_1518","Great_Emu_War","Boston_Molasses_Disaster","Kentucky_meat_shower","Cadaver_Synod","War_of_the_Bucket","Erfurt_latrine_disaster","Toynbee_tiles","Pig_War_(1859)","List_of_unusual_deaths","Tanganyika_laughter_epidemic","London_Beer_Flood"];
const MYSTERIES = ["Dyatlov_Pass_incident","Mary_Celeste","Voynich_manuscript","Tamam_Shud_case","Wow!_signal","D.B._Cooper","Jack_the_Ripper","Roanoke_Colony","Antikythera_mechanism","Nazca_Lines"];

const CATEGORY_MAP = {
  "all": null,
  "philosophy": "Branch_of_philosophy", "psychology": "Psychology", "biology": "Biology",
  "physics": "Physics", "mathematics": "Mathematics", "history": "History", "art": "Art",
  "music": "Music", "geography": "Geography", "technology": "Technology",
  "astronomy": "Astronomy", "human_sexuality": "Human_sexuality", "unsolved_mysteries": "Unsolved_mysteries"
};

/* ============ HELPERS ============ */
const escapeHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const escapeAttr = s => escapeHtml(s);
let tt;
function toast(m) { const t = $("toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2400); }
async function copyHelper(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast(msg); } catch { toast("⚠ CLIPBOARD BLOCKED"); } ta.remove(); }
}

/* ============ SANITIZE — UPGRADE IMAGES TO 960px ============ */
function sanitizeWikiHtml(htmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlStr, 'text/html');

  /* Fix protocol-relative URLs */
  doc.querySelectorAll('img, source, a, iframe, svg').forEach(el => {
    ['src', 'srcset', 'href'].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && val.startsWith('//')) el.setAttribute(attr, 'https:' + val);
    });
  });

  /* IMAGE UPGRADE: 220px thumbs → 960px, strip inline size constraints */
  doc.querySelectorAll('img').forEach(img => {
    let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (src.startsWith('//')) src = 'https:' + src;
    if (src) {
      /* bump thumbnail pixel size to 960 (works on /thumb/ URLs) */
      src = src.replace(/\/(\d+)px-([^/]+)$/, '/960px-$2');
      img.setAttribute('src', src);
    }
    img.removeAttribute('srcset');      /* stop browser picking tiny variants */
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.removeAttribute('style');       /* kill inline width:220px bullshit */
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });

  /* Strip Wikipedia's tiny inline-width wrapper styles */
  doc.querySelectorAll('.thumb, .thumbinner, figure, .image, div[style*="width"]').forEach(el => el.removeAttribute('style'));

  /* File/Image links open on Wikipedia */
  doc.querySelectorAll('a').forEach(a => {
    let href = a.getAttribute('href') || '';
    if (href.includes('File:') || href.includes('Image:') || href.includes('Map:')) {
      const fileName = href.replace(/^(\.\/|\/wiki\/)/, '');
      a.setAttribute('href', 'https://en.wikipedia.org/wiki/' + fileName);
      a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  doc.querySelectorAll('.mw-editsection, .navbox, .vertical-navbox, .mw-empty-elt, style, script, .mw-jump-link, .catlinks, .printfooter').forEach(el => el.remove());
  return doc.body.innerHTML;
}

/* ============ LIGHTBOX ============ */
function createLightbox() {
  if ($("imgLightbox")) return $("imgLightbox");
  const lb = document.createElement("div");
  lb.id = "imgLightbox";
  lb.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out;backdrop-filter:blur(8px);padding:20px;box-sizing:border-box;";
  lb.innerHTML = '<img id="lbImg" style="max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.8);object-fit:contain;">';
  document.body.appendChild(lb);
  lb.addEventListener("click", () => lb.style.display = "none");
  return lb;
}
function openZoomImage(src) { const lb = createLightbox(); const img = $("lbImg"); if (img) img.src = src; lb.style.display = "flex"; beep(1000); }

/* ============ SOUND ============ */
let audio = null, soundOn = localStorage.getItem("wk_sound") !== "0";
if ($("sndBtn")) $("sndBtn").textContent = soundOn ? "🔊 SOUND: ON" : "🔇 SOUND: OFF";
function beep(f = 880, d = 0.07) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.value = f;
    g.gain.value = 0.045; g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d);
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + d);
  } catch(e) {}
}
const jingle = () => { beep(660); setTimeout(() => beep(880), 90); setTimeout(() => beep(1320), 180); };
if ($("sndBtn")) $("sndBtn").addEventListener("click", function() {
  soundOn = !soundOn; localStorage.setItem("wk_sound", soundOn ? "1" : "0");
  this.textContent = soundOn ? "🔊 SOUND: ON" : "🔇 SOUND: OFF";
  if (soundOn) beep(1000); this.blur();
});

/* ============ MOBILE DRAWER — WITH BODY SCROLL LOCK ============ */
const drawerToggle = $("drawerToggle"), drawerOverlay = $("drawerOverlay"), sidebarLeft = $("sidebarLeft");
function openDrawer() {
  if (!sidebarLeft) return;
  sidebarLeft.classList.add("open");
  document.body.classList.add("drawer-open");
  if (drawerOverlay) drawerOverlay.classList.add("show");
  if (drawerToggle) { drawerToggle.classList.add("open"); drawerToggle.textContent = "✕"; }
  beep(700);
}
function closeDrawer() {
  if (!sidebarLeft) return;
  sidebarLeft.classList.remove("open");
  document.body.classList.remove("drawer-open");
  if (drawerOverlay) drawerOverlay.classList.remove("show");
  if (drawerToggle) { drawerToggle.classList.remove("open"); drawerToggle.textContent = "☰"; }
}
if (drawerToggle) drawerToggle.addEventListener("click", () => sidebarLeft && sidebarLeft.classList.contains("open") ? closeDrawer() : openDrawer());
if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);
document.addEventListener("click", e => { if (e.target.closest(".pill") && window.innerWidth <= 1200) closeDrawer(); });
addEventListener("resize", () => { if (window.innerWidth > 1200) closeDrawer(); });

/* ============ AUTH ============ */
const DB_KEY = "wikiverse_db_v1";
const enc = p => btoa(unescape(encodeURIComponent(p)));
function loadDB() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(DB_KEY) || "null"); } catch(e) {}
  if (!db || typeof db !== "object") db = { users: {}, data: {} };
  if (!db.users.krshxcx) { db.users.krshxcx = { password: enc("krshxcx") }; db.data.krshxcx = { saved: [], fav: [], liked: [] }; }
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
}
function persistUser() { if (!currentUser) return; const db = loadDB(); db.data[currentUser] = userData; localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function getSession() { return localStorage.getItem("wk_ses") || sessionStorage.getItem("wk_ses"); }
function setSession(u, remember) { clearSession(); (remember ? localStorage : sessionStorage).setItem("wk_ses", u); }
function clearSession() { localStorage.removeItem("wk_ses"); sessionStorage.removeItem("wk_ses"); }
function authFail(msg) { toast("⚠ " + msg); beep(200, .2); const w = $("authWin"); if (w) { w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake"); } }

if ($("togglePass1")) $("togglePass1").addEventListener("click", () => { const i = $("loginPass"); i.type = i.type === "password" ? "text" : "password"; });
if ($("togglePass2")) $("togglePass2").addEventListener("click", () => { const i = $("regPass"); i.type = i.type === "password" ? "text" : "password"; });
if ($("toRegister")) $("toRegister").addEventListener("click", e => { e.preventDefault(); $("loginForm").style.display = "none"; $("registerForm").style.display = "block"; beep(500); });
if ($("toLogin")) $("toLogin").addEventListener("click", e => { e.preventDefault(); $("registerForm").style.display = "none"; $("loginForm").style.display = "block"; beep(500); });

if ($("loginForm")) $("loginForm").addEventListener("submit", e => {
  e.preventDefault(); beep(700);
  const u = $("loginUser").value.trim(), p = $("loginPass").value;
  if (!u || !p) return authFail("ENTER USERNAME AND PASSWORD");
  const db = loadDB();
  if (!db.users[u] || db.users[u].password !== enc(p)) return authFail("INVALID CREDENTIALS");
  setSession(u, $("loginRemember").checked);
  currentUser = u; userData = db.data[u] || { saved: [], fav: [], liked: [] };
  renderAuth(); toast("✅ WELCOME BACK, " + u.toUpperCase()); jingle();
});

if ($("registerForm")) $("registerForm").addEventListener("submit", e => {
  e.preventDefault(); beep(700);
  const u = $("regUser").value.trim(), p = $("regPass").value;
  if (!/^[a-z0-9_]{3,16}$/i.test(u)) return authFail("USERNAME: 3–16 CHARS (A–Z, 0–9, _)");
  if (p.length < 4) return authFail("PASSWORD TOO SHORT (MIN 4)");
  const db = loadDB();
  if (db.users[u]) return authFail("USERNAME ALREADY TAKEN");
  db.users[u] = { password: enc(p) }; db.data[u] = { saved: [], fav: [], liked: [] };
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  setSession(u, true); currentUser = u; userData = db.data[u];
  renderAuth(); toast("✅ ACCOUNT CREATED — WELCOME, " + u.toUpperCase()); jingle();
});

if ($("logoutBtn")) $("logoutBtn").addEventListener("click", () => { clearSession(); currentUser = null; userData = null; renderAuth(); toast("LOGGED OUT"); beep(400); });
if ($("deleteAccBtn")) $("deleteAccBtn").addEventListener("click", () => {
  if (!currentUser) return;
  if (!confirm("Permanently delete account @" + currentUser + "?")) return;
  const db = loadDB(); delete db.users[currentUser]; delete db.data[currentUser];
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  clearSession(); currentUser = null; userData = null; renderAuth(); toast("🗑 ACCOUNT DELETED"); beep(220, .25);
});

document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", function() {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  this.classList.add("active"); activeTab = this.dataset.tab; renderProfileList(activeTab); beep(800);
}));

function renderProfileList(type) {
  const list = (userData && userData[type]) || [];
  const el = $("profileList"); if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="p-empty">NOTHING HERE YET — GO DISCOVER ✦</div>'; return; }
  el.innerHTML = list.map(a => `<div class="p-item" data-url="${escapeAttr(a.url)}"><span class="p-t">${escapeHtml(a.title)}</span><button class="p-del" data-title="${escapeAttr(a.title)}" title="Remove">✕</button></div>`).join("");
}

if ($("profileList")) $("profileList").addEventListener("click", e => {
  const del = e.target.closest(".p-del");
  if (del) { e.stopPropagation(); removeFromList(activeTab, del.dataset.title); toast("REMOVED"); return; }
  const item = e.target.closest(".p-item");
  if (item && item.dataset.url) { window.open(item.dataset.url, "_blank"); beep(900); }
});

function renderCounts() {
  if ($("cntSaved")) $("cntSaved").textContent = (userData && userData.saved.length) || 0;
  if ($("cntFav")) $("cntFav").textContent = (userData && userData.fav.length) || 0;
  if ($("cntLiked")) $("cntLiked").textContent = (userData && userData.liked.length) || 0;
}
function addToList(type, title, url) {
  if (!currentUser) { toast("⚠ SIGN IN TO USE THIS"); beep(200, .15); return false; }
  if (userData[type].some(a => a.title === title)) return null;
  userData[type].unshift({ title, url }); persistUser(); renderCounts(); renderStats();
  if ($("profileView") && $("profileView").style.display !== "none") renderProfileList(activeTab);
  return true;
}
function removeFromList(type, title) {
  if (!currentUser) return;
  userData[type] = userData[type].filter(a => a.title !== title);
  persistUser(); renderCounts(); renderStats(); renderProfileList(activeTab); updateLikeFavState();
}
function renderAuth() {
  const logged = !!currentUser;
  if ($("authForms")) $("authForms").style.display = logged ? "none" : "block";
  if ($("profileView")) $("profileView").style.display = logged ? "block" : "none";
  if (logged) {
    if ($("welcomeUser")) $("welcomeUser").textContent = "@" + currentUser;
    if ($("avaBig")) $("avaBig").textContent = currentUser[0].toUpperCase();
    renderCounts(); renderProfileList(activeTab);
  }
  if ($("userChipName")) $("userChipName").textContent = logged ? currentUser.toUpperCase() : "PROFILE";
  if ($("userChipAva")) $("userChipAva").textContent = logged ? currentUser[0].toUpperCase() : "◌";
  renderStats(); updateLikeFavState();
}
if ($("userChip")) $("userChip").addEventListener("click", () => {
  if (window.innerWidth <= 1200) openDrawer();
  else if ($("authWin")) $("authWin").scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ============ STATS ============ */
let stats = { total: 0, streak: 0, last: "" };
try { Object.assign(stats, JSON.parse(localStorage.getItem("wk_stats") || "{}")); } catch(e) {}
stats.session = 0;
function bumpStats() {
  stats.total++; stats.session++;
  const today = new Date().toISOString().slice(0, 10);
  if (stats.last !== today) {
    const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    stats.streak = (stats.last === yest) ? (stats.streak || 0) + 1 : 1;
    stats.last = today;
  }
  localStorage.setItem("wk_stats", JSON.stringify({ total: stats.total, streak: stats.streak, last: stats.last }));
  renderStats();
}
function renderStats() {
  if ($("statTotal")) $("statTotal").textContent = stats.total;
  if ($("statSession")) $("statSession").textContent = stats.session;
  if ($("statStreak")) $("statStreak").textContent = (stats.streak || 0) + "d";
  if ($("statSaved")) $("statSaved").textContent = currentUser ? (userData.saved.length + userData.fav.length + userData.liked.length) : "—";
}

/* ============ FETCH ENGINE ============ */
const cache = new Map();
async function fetchPage(t) {
  if (cache.has(t)) return cache.get(t);
  const q = `${API}?action=parse&page=${encodeURIComponent(t)}&prop=text|displaytitle&redirects=1&format=json&origin=*`;
  const res = await fetch(q);
  const json = await res.json();
  if (!json.parse) throw new Error("not found");
  const cleanTitle = json.parse.title;
  const cleanedHtml = sanitizeWikiHtml(json.parse.text["*"] || "");
  const data = {
    title: cleanTitle,
    extract: cleanedHtml,
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(cleanTitle.replace(/ /g, "_"))
  };
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  cache.set(t, data);
  return data;
}

const showLoader = () => { if ($("loader")) $("loader").classList.add("show"); if ($("result")) $("result").classList.remove("show"); };

function render(a, badge, kind) {
  current = a; stopSpeak();
  const b = $("badge"); if (b) { b.textContent = badge; b.className = "badge k-" + (kind || "rand"); }
  if ($("title")) $("title").textContent = a.title;
  if ($("extract")) $("extract").innerHTML = a.extract || "<p>No content available.</p>";
  if ($("wikiSrcBtn")) { $("wikiSrcBtn").onclick = () => window.open(a.url, "_blank"); $("wikiSrcBtn").title = "Open \"" + a.title + "\" on Wikipedia"; }
  const words = (($("extract") && $("extract").innerText) || "").trim().split(/\s+/).filter(Boolean).length;
  if ($("metaLine")) $("metaLine").textContent = `≈ ${Math.max(1, Math.round(words / 220))} MIN READ · ${words.toLocaleString()} WORDS`;
  if ($("loader")) $("loader").classList.remove("show");
  if ($("result")) $("result").classList.add("show");
  const cb = $("cardBody");
  if (cb) { cb.classList.remove("pop"); void cb.offsetWidth; cb.classList.add("pop"); cb.scrollTop = 0; }
  onScrollProgress(); updateLikeFavState(); pushHistory(a.title); bumpStats(); jingle();
}

function showError(msg) {
  busy = false; stopSpeak();
  if ($("loader")) $("loader").classList.remove("show");
  const b = $("badge"); if (b) { b.textContent = "⚠ ERROR"; b.className = "badge k-err"; }
  if ($("title")) $("title").textContent = "Something broke";
  if ($("metaLine")) $("metaLine").textContent = "PRESS NEXT TO RETRY";
  if ($("extract")) $("extract").innerHTML = `<p style="text-align:center;">${escapeHtml(msg)}</p>`;
  if ($("result")) $("result").classList.add("show");
  beep(220, .2);
}

/* Article link + image zoom handler */
if ($("extract")) {
  $("extract").addEventListener("click", e => {
    const clickedImg = e.target.closest("img");
    if (clickedImg && clickedImg.src) { e.preventDefault(); e.stopPropagation(); openZoomImage(clickedImg.src); return; }
    const a = e.target.closest("a");
    if (!a) return;
    let href = a.getAttribute("href") || "";
    if (href.includes("/wiki/File:") || href.includes("File:") || href.includes("Image:")) { a.target = "_blank"; a.rel = "noopener noreferrer"; return; }
    if (href.startsWith("./")) href = href.replace("./", "/wiki/");
    if (href.includes("/wiki/")) {
      const articleTitle = href.split("/wiki/")[1];
      if (articleTitle && !articleTitle.includes(":")) {
        e.preventDefault();
        loadByTitle(decodeURIComponent(articleTitle).replace(/_/g, " "), "🔗 FROM LINK", "link");
      }
    } else if (href.startsWith("http")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  });
}

/* ============ DISCOVERY ============ */
async function roll() {
  if (busy) return; busy = true; showLoader(); beep(1200);
  try {
    if (currentCat === "all") {
      const d = await (await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary")).json();
      render(await fetchPage(d.title), "✨ RANDOM FIND", "rand");
    } else {
      const key = currentCat.toLowerCase();
      const wikiCat = CATEGORY_MAP[key] || currentCat;
      const res = await fetch(`${API}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(wikiCat)}&cmlimit=100&cmtype=page&format=json&origin=*`);
      const m = (await res.json()).query.categorymembers;
      if (!m || !m.length) throw new Error("empty");
      render(await fetchPage(m[Math.floor(Math.random() * m.length)].title), currentChannel.toUpperCase(), "cat");
    }
  } catch(e) { showError("Could not fetch article. Press Next to retry."); }
  busy = false;
}

async function loadByTitle(t, badge, kind) {
  if (busy) return; busy = true; showLoader(); beep(900);
  try { render(await fetchPage(t), badge, kind || "rand"); }
  catch(e) { showError("Article unreachable."); }
  busy = false;
}

if ($("trickRandom")) $("trickRandom").addEventListener("click", () => roll());
if ($("nextBtn")) $("nextBtn").addEventListener("click", () => roll());
if ($("trickWeird")) $("trickWeird").addEventListener("click", async () => { if (busy) return; busy = true; showLoader(); beep(500); try { render(await fetchPage(WEIRD[Math.floor(Math.random() * WEIRD.length)]), "🤪 CERTIFIED WEIRD", "weird"); } catch(e) { showError("Weirdness unavailable."); } busy = false; });
if ($("trickMystery")) $("trickMystery").addEventListener("click", async () => { if (busy) return; busy = true; showLoader(); beep(400); try { render(await fetchPage(MYSTERIES[Math.floor(Math.random() * MYSTERIES.length)]), "🔮 UNSOLVED MYSTERY", "mystery"); } catch(e) { showError("Mystery vanished."); } busy = false; });
if ($("trickTrail")) $("trickTrail").addEventListener("click", async () => { if (busy) return; busy = true; showLoader(); beep(700); try { const d = await (await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary")).json(); const full = await fetchPage(d.title); render({ ...full, extract: '<p style="text-align:center;"><i>Getting to Philosophy: click the first link — you will almost always land on Philosophy.</i></p>' + full.extract }, "🧭 PHILOSOPHY TRAIL", "trail"); } catch(e) { showError("Trail closed."); } busy = false; });

if ($("trickPotd")) $("trickPotd").addEventListener("click", async () => {
  if (busy) return; busy = true; showLoader(); beep(900);
  try {
    const today = new Date();
    const yyyy = today.getUTCFullYear(), mm = String(today.getUTCMonth()+1).padStart(2,"0"), dd = String(today.getUTCDate()).padStart(2,"0");
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`);
    if (!res.ok) throw new Error("fail");
    const d = await res.json();
    let imgUrl = "", titleText = "Picture of the Day", descText = "";
    if (d.image) { imgUrl = (d.image.image || d.image.thumbnail || {}).source || ""; titleText = (d.image.title || "").replace(/^File:/i,"").replace(/_/g," ") || "Featured Picture"; descText = (d.image.description && d.image.description.text) || ""; }
    else if (d.tfa) { imgUrl = (d.tfa.thumbnail || {}).source || ""; titleText = d.tfa.title; descText = d.tfa.extract; }
    render({ title: titleText, extract: imgUrl ? `<div style="text-align:center;margin-bottom:15px;"><img src="${imgUrl}" alt="${escapeAttr(titleText)}"></div><p style="text-align:center;">${descText}</p>` : `<p style="text-align:center;">${descText}</p>`, url: "https://en.wikipedia.org/wiki/Wikipedia:Picture_of_the_day" }, "🖼️ PICTURE OF THE DAY", "media");
  } catch(e) { showError("Picture unavailable."); }
  busy = false;
});

if ($("trickOtd")) $("trickOtd").addEventListener("click", async () => {
  if (busy) return; busy = true; showLoader(); beep(600);
  try {
    const n = new Date(), mm = String(n.getMonth()+1).padStart(2,"0"), dd = String(n.getDate()).padStart(2,"0");
    const d = await (await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`)).json();
    const ev = d.events[Math.floor(Math.random() * d.events.length)];
    const page = ev.pages && ev.pages[0];
    const full = page ? await fetchPage(page.title) : { title: "On This Day", extract: ev.text, url: "https://en.wikipedia.org" };
    render({ ...full, extract: `<p style="text-align:center;"><i>${escapeHtml(ev.text)}</i></p>` + (full.extract || "") }, `📅 ON THIS DAY · ${ev.year}`, "media");
  } catch(e) { showError("History unavailable."); }
  busy = false;
});

function toggleRoulette() {
  const b = $("rouletteBtn"); if (!b) return;
  if (rouletteTimer) { clearInterval(rouletteTimer); rouletteTimer = null; b.classList.remove("on"); b.textContent = "🔁 Auto Roulette"; toast("ROULETTE OFF"); beep(300,.15); }
  else { roll(); rouletteTimer = setInterval(roll, 5000); b.classList.add("on"); b.textContent = "⏸ Roulette · 5s"; toast("🔁 ROULETTE ON"); beep(1500,.15); }
}
if ($("rouletteBtn")) $("rouletteBtn").addEventListener("click", toggleRoulette);

/* ============ PILLS ============ */
document.querySelectorAll(".pill").forEach(p => p.addEventListener("click", () => {
  document.querySelectorAll(".pill").forEach(x => x.classList.remove("active"));
  p.classList.add("active");
  currentCat = p.dataset.cat; currentChannel = p.dataset.name || p.textContent.trim();
  if ($("vibeLabel")) $("vibeLabel").textContent = currentChannel;
  roll(); beep(800);
}));

/* ============ SEARCH ============ */
let scanTimer = null;
async function doSearch(q) {
  const box = $("scanResults"); if (!box) return;
  try {
    const res = await fetch(`${API}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json&origin=*`);
    const list = (await res.json()).query.search;
    if (!list || !list.length) box.innerHTML = '<div class="scan-empty">NO MATCHES FOUND</div>';
    else box.innerHTML = list.map(s => `<div class="scan-item" data-title="${escapeAttr(s.title)}"><b>${escapeHtml(s.title)}</b><span>${s.snippet}…</span></div>`).join("");
    box.classList.add("show");
  } catch(e) { box.classList.remove("show"); }
}
if ($("scanInput")) {
  $("scanInput").addEventListener("input", function() { const q = this.value.trim(); clearTimeout(scanTimer); if (q.length < 2) { if ($("scanResults")) $("scanResults").classList.remove("show"); return; } scanTimer = setTimeout(() => doSearch(q), 320); });
  $("scanInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const first = $("scanResults") ? $("scanResults").querySelector(".scan-item") : null; if (first) openScan(first.dataset.title); } });
}
if ($("scanResults")) $("scanResults").addEventListener("click", e => { const item = e.target.closest(".scan-item"); if (item) openScan(item.dataset.title); });
function openScan(t) { if ($("scanResults")) $("scanResults").classList.remove("show"); if ($("scanInput")) { $("scanInput").value = t; $("scanInput").blur(); } loadByTitle(t, "🔍 SEARCH RESULT", "search"); }
document.addEventListener("click", e => { if (!e.target.closest(".scan-wrap") && $("scanResults")) $("scanResults").classList.remove("show"); });

/* ============ ACTIONS ============ */
function updateLikeFavState() {
  const has = t => currentUser && userData && current && userData[t].some(a => a.title === current.title);
  const lk = has("liked"), fv = has("fav");
  if ($("likeBtn")) { $("likeBtn").classList.toggle("on", !!lk); $("likeBtn").textContent = lk ? "❤️" : "🤍"; }
  if ($("favBtn")) { $("favBtn").classList.toggle("on", !!fv); $("favBtn").textContent = fv ? "★" : "☆"; }
}
function toggleList(type) {
  if (!current) return;
  if (!currentUser) { toast("⚠ SIGN IN TO USE THIS"); beep(200,.15); return; }
  const exists = userData[type].some(a => a.title === current.title);
  if (exists) { removeFromList(type, current.title); toast(type === "liked" ? "💔 REMOVED" : "☆ REMOVED"); beep(500); }
  else { addToList(type, current.title, current.url); toast(type === "liked" ? "❤️ LIKED" : "★ FAVORITED"); beep(1300); }
  updateLikeFavState();
}
if ($("likeBtn")) $("likeBtn").addEventListener("click", () => toggleList("liked"));
if ($("favBtn")) $("favBtn").addEventListener("click", () => toggleList("fav"));
if ($("saveBtn")) $("saveBtn").addEventListener("click", () => { if (!current) return; if (!currentUser) { toast("⚠ SIGN IN TO SAVE"); beep(200,.15); return; } const r = addToList("saved", current.title, current.url); if (r === null) toast("💾 ALREADY SAVED"); else if (r) { toast("💾 SAVED"); beep(1400); } });
if ($("copyTextBtn")) $("copyTextBtn").addEventListener("click", () => { if (current && $("extract")) { copyHelper($("extract").innerText, "📄 TEXT COPIED"); beep(1100); } });
if ($("copyLinkBtn")) $("copyLinkBtn").addEventListener("click", () => { if (current) { copyHelper(current.url, "🔗 LINK COPIED"); beep(1100); } });
if ($("shareBtn")) $("shareBtn").addEventListener("click", () => { if (!current) return; if (navigator.share) navigator.share({ title: current.title, url: current.url }).catch(()=>{}); else copyHelper(current.url, "📡 LINK COPIED"); beep(1100); });

/* Read Aloud */
let speaking = false;
function stopSpeak() { try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch(e) {} speaking = false; if ($("speakBtn")) { $("speakBtn").classList.remove("on"); $("speakBtn").textContent = "🔉"; } }
if ($("speakBtn")) $("speakBtn").addEventListener("click", () => {
  if (!current || !("speechSynthesis" in window)) { toast("⚠ SPEECH NOT SUPPORTED"); return; }
  if (speaking) { stopSpeak(); return; }
  const u = new SpeechSynthesisUtterance(current.title + ". " + (($("extract") && $("extract").innerText) || "").slice(0, 2500));
  u.rate = 1; u.onend = stopSpeak; u.onerror = stopSpeak;
  speechSynthesis.speak(u); speaking = true; $("speakBtn").classList.add("on"); $("speakBtn").textContent = "⏹"; toast("🔉 READING…");
});

/* ============ HISTORY ============ */
const hist = [];
function pushHistory(t) { if (hist[0] === t) return; const i = hist.indexOf(t); if (i > -1) hist.splice(i, 1); hist.unshift(t); if (hist.length > 14) hist.pop(); renderHistory(); }
function renderHistory() { if (!$("histList")) return; $("histList").innerHTML = hist.length ? hist.map(t => `<button class="chip" data-title="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join("") : '<span class="hist-empty">NO ARTICLES YET — START EXPLORING…</span>'; }
if ($("histList")) $("histList").addEventListener("click", e => { const c = e.target.closest(".chip"); if (c) loadByTitle(c.dataset.title, "↩ FROM HISTORY", "link"); });

/* ============ PROGRESS — rAF THROTTLED (kills scroll lag) ============ */
let progTick = false;
function onScrollProgress() {
  if (progTick) return;
  progTick = true;
  requestAnimationFrame(() => {
    progTick = false;
    const cb = $("cardBody"); if (!cb || !$("progressFill")) return;
    const max = cb.scrollHeight - cb.clientHeight;
    $("progressFill").style.width = (max > 0 ? (cb.scrollTop / max) * 100 : 0) + "%";
  });
}
if ($("cardBody")) $("cardBody").addEventListener("scroll", onScrollProgress, { passive: true });

/* ============ KEYBOARD ============ */
document.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (e.key === "Escape") { const lb = $("imgLightbox"); if (lb && lb.style.display !== "none") { lb.style.display = "none"; return; } if (sidebarLeft && sidebarLeft.classList.contains("open")) { closeDrawer(); return; } }
  if (e.target.matches("input,textarea,select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.code === "Space") { e.preventDefault(); roll(); }
  else if (e.code === "KeyR") toggleRoulette();
  else if (e.code === "KeyL") toggleList("liked");
  else if (e.code === "KeyF") toggleList("fav");
  else if (e.code === "KeyS" && $("saveBtn")) $("saveBtn").click();
  else if (e.key === "/" && $("scanInput")) { e.preventDefault(); $("scanInput").focus(); }
});

/* ============ STARFIELD — respects reduced motion ============ */
(function() {
  const cv = $("stars"); if (!cv) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cx = cv.getContext("2d");
  let w, h, starArr = [], shots = [], tick = 0;
  function rs() { w = cv.width = innerWidth; h = cv.height = innerHeight; starArr = []; const n = Math.min(120, Math.floor(w*h/16000)); for (let i=0;i<n;i++) starArr.push({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.6+.5,p:Math.random()*Math.PI*2,s:.006+Math.random()*.015,blue:Math.random()<.25}); }
  addEventListener("resize", rs); rs();
  (function loop() { tick++; cx.clearRect(0,0,w,h); for (const st of starArr) { const a=.12+.3*Math.abs(Math.sin(st.p+tick*st.s)); cx.globalAlpha=a; cx.fillStyle=st.blue?"#3498db":"#9db2c4"; cx.beginPath(); cx.arc(st.x,st.y,st.r,0,7); cx.fill(); } cx.globalAlpha=1; if (tick%460===0&&Math.random()<.7) shots.push({x:Math.random()*w*.8,y:Math.random()*h*.3,vx:5+Math.random()*3,vy:1.5+Math.random()*1.5,life:40}); shots=shots.filter(s=>s.life>0); for (const s of shots) { const g=cx.createLinearGradient(s.x,s.y,s.x-s.vx*8,s.y-s.vy*8); g.addColorStop(0,"rgba(52,152,219,.5)"); g.addColorStop(1,"rgba(52,152,219,0)"); cx.strokeStyle=g; cx.lineWidth=1.2; cx.beginPath(); cx.moveTo(s.x,s.y); cx.lineTo(s.x-s.vx*8,s.y-s.vy*8); cx.stroke(); s.x+=s.vx; s.y+=s.vy; s.life--; } requestAnimationFrame(loop); })();
})();

/* ============ CLOCK ============ */
function tickClock() { if (!$("clock")) return; const d = new Date(); $("clock").textContent = String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0")+":"+String(d.getUTCSeconds()).padStart(2,"0")+" UTC"; }
setInterval(tickClock, 1000); tickClock();

/* ============ THEME ============ */
function applyTheme(t) { const theme = t==='dark'?'dark':'light'; document.documentElement.setAttribute('data-theme',theme); try{localStorage.setItem('wk_theme',theme);}catch(e){} const btn=$("themeBtn"); if(btn) btn.textContent=theme==='dark'?'🌙':'☀️'; }
if ($("themeBtn")) $("themeBtn").addEventListener('click', function() { const cur = document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light'; applyTheme(cur==='dark'?'light':'dark'); beep(600); });

/* ============ INIT ============ */
(function init() {
  const db = loadDB();
  const su = getSession();
  if (su && db.users[su]) { currentUser = su; userData = db.data[su] || { saved:[], fav:[], liked:[] }; }
  try { applyTheme(localStorage.getItem('wk_theme') || 'light'); } catch(e) {}
  renderAuth(); renderHistory(); renderStats(); roll();
})();
})();
