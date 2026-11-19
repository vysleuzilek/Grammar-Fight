import {
  db, ref, onValue, set, update, get, remove, serverTimestamp, onChildAdded, query, limitToLast, increment,
  now, esc, fmtTime, playerList, computeHp,
} from "./common.js";
import { DeathRing, colorOf, thump } from "./ring.js";
import {
  ROUNDS, DEFAULT_PLAN, DEALS, DEAL_MS, REVEAL_MS, BUILD_POINTS, WORD_KC, DIALOG, GAP_MS,
  PITCH_WRITE_MS, PITCH_VOTE_MS, PITCH_SUBMIT_POINTS, PITCH_VOTE_POINTS, BUILD_MS, WORDS_MS,
} from "./content.js";

const $ = (id) => document.getElementById(id);
let code = null, meta = {}, players = {}, ans = {}, pitches = {}, votes = {}, hidden = {};
let unsubs = [], seen = new Set(), dmRing = null, lastKey = "";
const busy = new Set();
const path = (p = "") => ref(db, `games/${code}${p ? "/" + p : ""}`);
const GAPS = DIALOG.map((d, i) => (d.o ? i : -1)).filter((i) => i >= 0);
const rid = () => (meta.plan || [])[meta.ri ?? 0];

// ---------- boot ----------
function randomCode() { const L = "ABCDEFGHJKLMNPQRSTUVWXYZ"; return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(""); }
async function createGame() {
  code = randomCode();
  localStorage.setItem("hostCode", code);
  await set(ref(db, `games/${code}`), { meta: { state: "lobby", plan: loadPlan(), ri: 0, phaseStart: 0, createdAt: serverTimestamp() } });
  await set(ref(db, "current"), { code });
}
function loadPlan() { try { const p = JSON.parse(localStorage.getItem("plan") || "null"); if (Array.isArray(p) && p.length) return p; } catch (e) {} return DEFAULT_PLAN.slice(); }
async function boot() {
  const saved = localStorage.getItem("hostCode");
  if (saved) { const s = await get(ref(db, `games/${saved}/meta/state`)); if (s.exists()) code = saved; }
  if (!code) await createGame(); else await set(ref(db, "current"), { code });
  const url = new URL("play.html", location.href).href;
  $("joinUrl").textContent = url;
  $("qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=" + encodeURIComponent(url);
  listen();
}
function listen() {
  unsubs.forEach((u) => u()); unsubs = []; seen = new Set();
  let first = true;
  unsubs.push(onValue(path("meta"), (s) => {
    meta = s.val() || {};
    if (meta.plan && !Array.isArray(meta.plan)) meta.plan = Object.keys(meta.plan).sort((a, b) => a - b).map((k) => meta.plan[k]);
    if (first) { first = false; unsubs.push(onChildAdded(query(path("events"), limitToLast(40)), (e) => onEvent(e.key, e.val()))); }
    render();
  }));
  unsubs.push(onValue(path("players"), (s) => { players = s.val() || {}; render(); }));
  unsubs.push(onValue(path("ans"), (s) => { ans = s.val() || {}; render(); }));
  unsubs.push(onValue(path("pitches"), (s) => { pitches = s.val() || {}; render(); }));
  unsubs.push(onValue(path("votes"), (s) => { votes = s.val() || {}; render(); }));
  unsubs.push(onValue(path("hidden"), (s) => { hidden = s.val() || {}; render(); }));
}

// ---------- helpers ----------
const plist = () => playerList(players);
const pcount = () => Object.keys(players).length;
function show(id) { for (const s of ["lobby", "intro", "play", "results", "deathmatch"]) $("s-" + s).classList.toggle("hidden", s !== id); }
function steps() {
  const plan = meta.plan || [];
  $("steps").innerHTML = plan.map((r, i) => `<span class="${i < meta.ri ? "done" : i === meta.ri ? "on" : ""}">${i + 1}</span>`).join("") + `<span class="${meta.state === "deathmatch" ? "on" : ""}">🥊</span>`;
}
function topbar(tag, title, timerMs) {
  $("topbar").classList.remove("hidden");
  $("tbTag").textContent = tag; $("tbTitle").textContent = title;
  $("timer").textContent = timerMs == null ? "" : fmtTime(timerMs);
  steps();
}
function setPlay(key, html) { if (lastKey !== key) { lastKey = key; $("play").innerHTML = html; } }
const qAns = (q) => (ans[meta.ri] || {})[q] || {};

// ---------- render ----------
function render() {
  const st = meta.state || "lobby";
  $("winner").classList.toggle("hidden", st !== "over");
  if (st === "lobby") { $("topbar").classList.add("hidden"); show("lobby"); renderLobby(); return; }
  const r = ROUNDS[rid()] || {};
  if (st === "intro") {
    show("intro"); $("topbar").classList.add("hidden");
    $("inTag").textContent = `Round ${meta.ri + 1} of ${meta.plan.length}`; $("inTitle").textContent = r.title; $("inSub").textContent = r.sub;
  } else if (st === "play") {
    show("play");
    const fn = { deal: renderDeal, builder: renderBuilder, words: renderWords, dialog: renderDialog, pitch: renderPitch }[rid()];
    fn && fn(r);
  } else if (st === "results") {
    show("results"); topbar(`After round ${meta.ri + 1}`, "Results", null); $("topbar").classList.add("hidden");
    renderResults();
  } else if (st === "deathmatch" || st === "over") {
    $("topbar").classList.add("hidden"); show("deathmatch"); renderDeathmatch(); if (st === "over") $("winnerName").textContent = players[meta.winner]?.name || "Draw!";
  }
}

let chipsKey = "";
function renderLobby() {
  const list = plist();
  $("lobbyCount").textContent = list.length;
  const key = list.map((p) => p.id + p.name).join("|");
  if (key !== chipsKey) {
    chipsKey = key;
    $("chips").innerHTML = list.map((p) => `<div class="chip"><span class="dot" style="background:${colorOf(p)}"></span>${esc(p.name)}<button class="x" data-kick="${p.id}">×</button></div>`).join("");
    $("chips").querySelectorAll("[data-kick]").forEach((b) => b.addEventListener("click", () => remove(path(`players/${b.dataset.kick}`))));
  }
  if (!$("roundPick").dataset.done) {
    $("roundPick").dataset.done = 1;
    const plan = loadPlan();
    $("roundPick").innerHTML = DEFAULT_PLAN.map((k) => `<label><input type="checkbox" value="${k}" ${plan.includes(k) ? "checked" : ""}>${ROUNDS[k].n}. ${ROUNDS[k].title}</label>`).join("") + `<label style="background:var(--card2)">🥊 Final: Deathmatch</label>`;
  }
}

// ----- Round 1: Deal or No Deal -----
function renderDeal() {
  const q = meta.q ?? 0, d = DEALS[q], a = qAns(q), n = Object.keys(a).length;
  topbar(`Round ${meta.ri + 1} · Deal or No Deal?`, `Sentence ${q + 1} of ${DEALS.length}`, meta.reveal ? null : meta.qEnd - now());
  setPlay(`deal${q}${meta.reveal}`, `<div class="center-col">
    <div class="bigcard">${esc(d.s)}</div>
    ${meta.reveal ? `<div class="stamp ${d.ok ? "ok" : "no"}">${d.ok ? "✓ DEAL" : "✗ NO DEAL"}</div>
      ${d.fix ? `<div style="font-size:40px;font-weight:800">Correct: <span style="color:var(--green)">${esc(d.fix)}</span></div>` : `<div style="font-size:36px;color:var(--muted)">This sentence is correct!</div>`}
      <div class="pbars"><div class="pbar"><div class="lab"><span>✗ No deal</span><span id="pN"></span></div><div class="tr"><div id="bN" style="background:var(--red)"></div></div></div>
      <div class="pbar"><div class="lab"><span>✓ Deal</span><span id="pY"></span></div><div class="tr"><div id="bY" style="background:var(--green)"></div></div></div></div>`
    : `<div class="tbar"><div id="tb"></div></div><div style="font-size:30px;color:var(--muted)"><b id="cnt" style="color:var(--light)"></b> answered · swipe on your phone!</div>`}
  </div>`);
  if (meta.reveal) {
    const vals = Object.values(a), y = vals.filter((v) => v.a === true).length, no = vals.length - y, tot = Math.max(1, vals.length);
    $("pY").textContent = Math.round((y / tot) * 100) + "%"; $("pN").textContent = Math.round((no / tot) * 100) + "%";
    $("bY").style.width = (y / tot) * 100 + "%"; $("bN").style.width = (no / tot) * 100 + "%";
  } else { $("cnt").textContent = `${n} / ${pcount()}`; }
}

// ----- Round 2: Sentence Builder (race) -----
function renderBuilder() {
  topbar(`Round ${meta.ri + 1} · Sentence Builder`, "Build sentences, win the race!", meta.phaseEnd - now());
  const list = plist(), goal = BUILD_POINTS * 8;
  setPlay("builder" + list.map((p) => p.id).join(), `<div class="race" id="race">${list.map((p) => `<div class="lane"><div class="nm">${esc(p.name)}</div><div class="tk"><div class="rn" id="rn_${p.id}" style="left:0;background:${colorOf(p)}">${esc(p.name[0] || "?")}</div></div><div class="sc" id="sc_${p.id}">0</div></div>`).join("")}</div>
    <div style="text-align:center;color:var(--muted);font-size:22px;margin-top:18px">Every correct sentence = +${BUILD_POINTS} strength · 8 sentences = finish line</div>`);
  for (const p of list) {
    const v = p.rs?.builder || 0, rn = $("rn_" + p.id); if (!rn) continue;
    rn.style.left = `calc(${Math.min(1, v / goal) * 100}% - ${Math.min(1, v / goal) * 32}px)`;
    $("sc_" + p.id).textContent = v / BUILD_POINTS;
  }
}

// ----- Round 3: Shop Words (money) -----
function renderWords() {
  topbar(`Round ${meta.ri + 1} · Shop Words`, "Every correct pair = 50 Kč", meta.phaseEnd - now());
  const list = plist().sort((a, b) => (b.rs?.words || 0) - (a.rs?.words || 0) || a.name.localeCompare(b.name));
  const max = Math.max(4, ...list.map((p) => p.rs?.words || 0));
  setPlay("words" + list.map((p) => p.id).join(), `<div class="center-col" style="justify-content:flex-start"><div class="money">${list.map((p, i) => `<div class="mrow"><div class="muted">${i + 1}.</div><div>${esc(p.name)}</div><div class="tr"><div id="mb_${p.id}"></div></div><div class="v" id="mv_${p.id}"></div></div>`).join("")}</div></div>`);
  for (const p of list) { const v = p.rs?.words || 0; if (!$("mb_" + p.id)) continue; $("mb_" + p.id).style.width = (v / max) * 100 + "%"; $("mv_" + p.id).textContent = (v * WORD_KC).toLocaleString("cs-CZ") + " Kč"; }
}

// ----- Round 4: Max & Zoe dialogue -----
const AV = {
  max: `<svg viewBox="0 0 70 70" class="av"><circle cx="35" cy="40" r="26" fill="#F2C79B" stroke="#14161F" stroke-width="3"/><path d="M9 34 Q35 2 61 34 Z" fill="#F2B33D" stroke="#14161F" stroke-width="3"/><path d="M45 30 Q62 28 68 34 Q58 36 47 34 Z" fill="#E0A024" stroke="#14161F" stroke-width="2"/><circle cx="28" cy="42" r="3" fill="#14161F"/><circle cx="42" cy="42" r="3" fill="#14161F"/><path d="M28 52 Q35 58 42 52" stroke="#14161F" stroke-width="3" fill="none"/></svg>`,
  zoe: `<svg viewBox="0 0 70 70" class="av"><circle cx="35" cy="12" r="10" fill="#4A2C20" stroke="#14161F" stroke-width="3"/><circle cx="35" cy="40" r="25" fill="#F2C79B" stroke="#14161F" stroke-width="3"/><path d="M10 38 Q14 12 35 14 Q56 12 60 38 Q45 26 35 28 Q22 28 10 38 Z" fill="#4A2C20" stroke="#14161F" stroke-width="3"/><circle cx="28" cy="43" r="3" fill="#14161F"/><circle cx="42" cy="43" r="3" fill="#14161F"/><path d="M29 53 Q35 57 41 53" stroke="#14161F" stroke-width="3" fill="none"/></svg>`,
};
function renderDialog() {
  const g = meta.q ?? 0, li = GAPS[g], a = qAns(g);
  topbar(`Round ${meta.ri + 1} · Max & Zoe`, `Gap ${g + 1} of ${GAPS.length}`, meta.reveal ? null : meta.qEnd - now());
  const from = Math.max(0, li - 3);
  const lines = DIALOG.slice(from, li + 1).map((d, k) => {
    const i = from + k, cur = i === li;
    let s = esc(d.s);
    if (d.o) s = s.replace("___", cur && !meta.reveal ? `<span class="gapw">?</span>` : `<span class="gapw">${esc(d.o[d.k])}</span>`);
    return `<div class="msg ${d.who} ${cur ? "cur" : ""}">${AV[d.who]}<div class="bub">${s}</div></div>`;
  }).join("");
  const counts = DIALOG[li].o.map((_, j) => Object.values(a).filter((v) => v.a === j).length);
  setPlay(`dlg${g}${meta.reveal}`, `<div class="center-col" style="gap:24px"><div class="chat">${lines}</div>
    <div class="optrow">${DIALOG[li].o.map((o, j) => `<div class="optc ${meta.reveal && j === DIALOG[li].k ? "ok" : ""}" style="${meta.reveal && j !== DIALOG[li].k ? "opacity:.35" : ""}">${"ABC"[j]} · ${esc(o)}<span class="cnt" id="oc${j}">${meta.reveal ? counts[j] : ""}</span></div>`).join("")}</div>
    ${meta.reveal ? "" : `<div class="tbar"><div id="tb"></div></div><div style="font-size:26px;color:var(--muted)"><b id="cnt" style="color:var(--light)"></b> answered</div>`}</div>`);
  if (!meta.reveal) $("cnt").textContent = `${Object.keys(a).length} / ${pcount()}`;
}

// ----- Round 5: Pitch Battle -----
function renderPitch() {
  const ph = meta.pphase || "write";
  const list = plist();
  if (ph === "write") {
    topbar(`Round ${meta.ri + 1} · Pitch Battle`, "Write your pitch on your phone!", meta.phaseEnd - now());
    setPlay("pw" + list.map((p) => p.id + (pitches[p.id]?.text ? 1 : 0)).join(), `<div class="center-col">
      <div style="font-size:54px;font-weight:900">Sell your product in ONE sentence!</div>
      <div class="bigcard" style="font-size:44px"><span style="color:#1F6F62">If you buy it,</span> <span style="color:#B07800">you'll …</span></div>
      <div class="wchips">${list.map((p) => `<span class="${pitches[p.id]?.text ? "ok" : ""}">${pitches[p.id]?.text ? "✓ " : "✍️ "}${esc(p.name)}</span>`).join("")}</div>
      <button id="btnVoteNow" class="ghost">Start voting now ▶</button></div>`);
    const b = $("btnVoteNow"); if (b && !b.dataset.on) { b.dataset.on = 1; b.onclick = () => startVote(); }
  } else {
    const shown = pitchOrder();
    const vc = voteCounts();
    if (ph === "vote") topbar(`Round ${meta.ri + 1} · Pitch Battle`, "Vote for the best pitch on your phone!", meta.phaseEnd - now());
    else topbar(`Round ${meta.ri + 1} · Pitch Battle`, "And the best sellers are…", null);
    const top = ph === "done" ? Object.entries(vc).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]) : [];
    const key = `pv${ph}${shown.map((x) => x.id).join()}${ph === "done" ? JSON.stringify(vc) : ""}`;
    setPlay(key, `<div style="display:flex;flex-direction:column;gap:20px">
      ${ph === "vote" ? `<div style="text-align:center;font-size:26px;color:var(--muted)"><b id="vcnt" style="color:var(--light)"></b> voted · tap × to hide a pitch</div>` : `<div style="text-align:center"><button id="btnPitchRes">Results ▶</button></div>`}
      <div class="pgrid">${shown.filter((x) => ph === "vote" || true).map((x, i) => `<div class="pcard ${top.includes(x.id) ? "win" : ""}" style="${ph === "done" && !top.includes(x.id) ? "opacity:.45" : ""}">
        <div class="no">${i + 1}</div>${ph === "vote" ? `<button class="hide" data-hide="${x.id}">×</button>` : ""}
        <div class="pr">${esc(x.product)}</div><div class="tx">${esc(x.text)}</div>
        ${ph === "done" ? `<div class="votes">${top.indexOf(x.id) === 0 ? "🥇 " : top.indexOf(x.id) === 1 ? "🥈 " : top.indexOf(x.id) === 2 ? "🥉 " : ""}${vc[x.id] || 0} votes · ${esc(players[x.id]?.name || "")}</div>` : ""}</div>`).join("")}</div></div>`);
    $("play").querySelectorAll("[data-hide]").forEach((b) => { if (!b.dataset.on) { b.dataset.on = 1; b.onclick = () => set(path(`hidden/${b.dataset.hide}`), true); } });
    const r = $("btnPitchRes"); if (r && !r.dataset.on) { r.dataset.on = 1; r.onclick = () => endRound(); }
    if ($("vcnt")) $("vcnt").textContent = `${Object.keys(votes).length} / ${pcount()}`;
  }
}
function pitchOrder() {
  return Object.entries(pitches).filter(([id, p]) => p.text && !hidden[id] && players[id]).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function voteCounts() { const c = {}; for (const [v, t] of Object.entries(votes)) if (players[v] && pitches[t] && !hidden[t]) c[t] = (c[t] || 0) + 1; return c; }

// ----- Results -----
function renderResults() {
  const r = rid(), list = plist().sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const max = Math.max(1, ...list.map((p) => p.strength || 0));
  const last = meta.ri >= (meta.plan.length - 1);
  $("resTag").textContent = `After round ${meta.ri + 1}: ${ROUNDS[r]?.title || ""}`;
  $("btnNext").textContent = last ? "🥊 FINAL: DEATHMATCH" : `Round ${meta.ri + 2}: ${ROUNDS[meta.plan[meta.ri + 1]].title} ▶`;
  $("hpInfo").textContent = last ? `Everyone will start with ${computeHp(players)} HP · 1 punch = your strength` : "";
  const html = list.map((p, i) => `<div class="board-row ${i === 0 ? "top1" : ""}" style="animation-delay:${i * 70}ms">
    <div class="rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
    <div>${esc(p.name)}${p.rs?.[r] ? `<span class="delta">+${p.rs[r]}</span>` : ""}<div class="bar" style="width:${((p.strength || 0) / max) * 100}%;background:${colorOf(p)}"></div></div>
    <div class="val">💪 ${p.strength || 0}</div></div>`).join("");
  if ($("board").dataset.html !== html) { $("board").innerHTML = html; $("board").dataset.html = html; }
}

// ----- Deathmatch -----
function renderDeathmatch() {
  if (!dmRing) dmRing = new DeathRing($("dmRing"));
  const list = plist();
  dmRing.update(list);
  const alive = list.filter((p) => p.alive !== false);
  $("aliveCount").textContent = alive.length;
  if (meta.state === "deathmatch" && !busy.has("dmend") && list.length >= 2 && alive.length <= 1) {
    busy.add("dmend"); update(path("meta"), { state: "over", winner: alive[0]?.id || null });
  }
}
function feed(html, cls = "") {
  const d = document.createElement("div"); d.className = "ev " + cls; d.innerHTML = html;
  const f = $("feed"); f.insertBefore(d, f.children[1] || null); while (f.children.length > 16) f.lastChild.remove();
}
function onEvent(key, ev) {
  if (!ev || seen.has(key)) return; seen.add(key);
  if ((ev.t || 0) < (meta.phaseStart || 0) - 1000) return;
  if (ev.type === "build" || ev.type === "pair") thump(false);
  if ((ev.type === "hit" || ev.type === "miss") && dmRing) {
    const missed = ev.type === "miss";
    dmRing.attack(ev.from, ev.to, ev.dmg, missed, ev.ko);
    const a = esc(players[ev.from]?.name || "?"), b = esc(players[ev.to]?.name || "?");
    if (missed) feed(`${a} missed ${b}`); else { thump(true); feed(`<b>${a}</b> → ${b} −${ev.dmg}`); if (ev.ko) feed(`💥 ${b} is KO! (by ${a})`, "ko"); }
  }
}

// ---------- game flow ----------
function award(list, pts, r) {
  if (!list.length) return Promise.resolve();
  const u = {};
  for (const id of list) { if (!players[id]) continue; u[`players/${id}/strength`] = increment(pts); u[`players/${id}/rs/${r}`] = increment(pts); }
  return update(path(), u);
}
async function startRound() {
  thump(false);
  const r = rid(), t = now();
  const u = { "meta/state": "play", "meta/phaseStart": t, "meta/q": 0, "meta/reveal": false };
  if (r === "deal") u["meta/qEnd"] = t + DEAL_MS;
  if (r === "dialog") u["meta/qEnd"] = t + GAP_MS;
  if (r === "builder") u["meta/phaseEnd"] = t + BUILD_MS;
  if (r === "words") u["meta/phaseEnd"] = t + WORDS_MS;
  if (r === "pitch") { u["meta/pphase"] = "write"; u["meta/phaseEnd"] = t + PITCH_WRITE_MS; u.pitches = null; u.votes = null; u.hidden = null; }
  await update(path(), u);
}
async function reveal() {
  const k = `rev${meta.ri}_${meta.q}`; if (busy.has(k)) return; busy.add(k);
  const r = rid(), q = meta.q ?? 0, a = qAns(q);
  const right = r === "deal" ? DEALS[q].ok : DIALOG[GAPS[q]].k;
  const winners = Object.entries(a).filter(([, v]) => v.a === right).map(([id]) => id);
  await award(winners, 1, r);
  await update(path("meta"), { reveal: true, revealEnd: now() + REVEAL_MS });
}
async function nextQ() {
  const k = `next${meta.ri}_${meta.q}`; if (busy.has(k)) return; busy.add(k);
  const r = rid(), total = r === "deal" ? DEALS.length : GAPS.length, q = (meta.q ?? 0) + 1;
  if (q >= total) return endRound();
  await update(path("meta"), { q, reveal: false, qEnd: now() + (r === "deal" ? DEAL_MS : GAP_MS) });
}
async function startVote() {
  const k = `vote${meta.ri}`; if (busy.has(k)) return; busy.add(k);
  await update(path("meta"), { pphase: "vote", phaseEnd: now() + PITCH_VOTE_MS });
}
async function finishPitch() {
  const k = `pfin${meta.ri}`; if (busy.has(k)) return; busy.add(k);
  const vc = voteCounts(), u = {};
  for (const [id, p] of Object.entries(pitches)) {
    if (!players[id] || !p.text) continue;
    const pts = PITCH_SUBMIT_POINTS + (hidden[id] ? 0 : (vc[id] || 0) * PITCH_VOTE_POINTS);
    u[`players/${id}/strength`] = increment(pts); u[`players/${id}/rs/pitch`] = increment(pts);
  }
  u["meta/pphase"] = "done";
  await update(path(), u);
}
async function endRound() {
  const k = `end${meta.ri}`; if (busy.has(k)) return; busy.add(k);
  await update(path("meta"), { state: "results" });
}

setInterval(() => {
  if (meta.state !== "play") return;
  const r = rid(), t = now();
  if (r === "deal" || r === "dialog") {
    const a = qAns(meta.q ?? 0), n = pcount();
    if (!meta.reveal) {
      const left = meta.qEnd - t; $("timer").textContent = fmtTime(left);
      const tb = $("tb"); if (tb) tb.style.width = Math.max(0, left / (r === "deal" ? DEAL_MS : GAP_MS)) * 100 + "%";
      if (left <= 0 || (n > 0 && Object.keys(a).length >= n)) reveal();
    } else if (t >= (meta.revealEnd || 0)) nextQ();
  } else if (r === "builder" || r === "words") {
    const left = meta.phaseEnd - t; $("timer").textContent = fmtTime(left);
    if (left <= 0) endRound();
  } else if (r === "pitch") {
    const left = meta.phaseEnd - t;
    if (meta.pphase !== "done") $("timer").textContent = fmtTime(left);
    const n = pcount();
    if (meta.pphase === "write" && (left <= 0 || (n > 0 && plist().every((p) => pitches[p.id]?.text)))) startVote();
    if (meta.pphase === "vote" && (left <= 0 || (n > 0 && Object.keys(votes).filter((v) => players[v]).length >= n))) finishPitch();
  }
}, 200);

// ---------- buttons ----------
$("btnStart").onclick = async () => {
  const plan = [...$("roundPick").querySelectorAll("input:checked")].map((i) => i.value);
  localStorage.setItem("plan", JSON.stringify(plan));
  if (!pcount() && !confirm("No players yet. Start anyway?")) return;
  thump(false);
  const u = { events: null, ans: null, pitches: null, votes: null, hidden: null };
  for (const id of Object.keys(players)) Object.assign(u, { [`players/${id}/strength`]: 0, [`players/${id}/rs`]: null, [`players/${id}/alive`]: true, [`players/${id}/hp`]: 0, [`players/${id}/maxHp`]: 0, [`players/${id}/kills`]: 0 });
  busy.clear();
  if (plan.length) Object.assign(u, { "meta/state": "intro", "meta/plan": plan, "meta/ri": 0, "meta/winner": null });
  await update(path(), u);
  if (!plan.length) startDeathmatch();
};
$("btnGo").onclick = () => startRound();
$("btnSkip").onclick = () => {
  if (meta.state !== "play") return;
  const r = rid();
  if (r === "pitch") { if (meta.pphase === "write") startVote(); else if (meta.pphase === "vote") finishPitch(); else endRound(); }
  else endRound();
};
$("btnNext").onclick = () => {
  if (meta.ri >= meta.plan.length - 1) startDeathmatch();
  else update(path("meta"), { state: "intro", ri: meta.ri + 1, q: 0, reveal: false });
};
async function startDeathmatch() {
  thump(true);
  const hp = computeHp(players), u = { events: null };
  for (const id of Object.keys(players)) Object.assign(u, { [`players/${id}/hp`]: hp, [`players/${id}/maxHp`]: hp, [`players/${id}/alive`]: true, [`players/${id}/kills`]: 0 });
  Object.assign(u, { "meta/state": "deathmatch", "meta/phaseStart": now(), "meta/hp": hp });
  busy.delete("dmend");
  await update(path(), u);
}
$("btnEndDM").onclick = () => {
  const alive = plist().filter((p) => p.alive !== false).sort((a, b) => (b.hp || 0) - (a.hp || 0));
  busy.add("dmend"); update(path("meta"), { state: "over", winner: alive[0]?.id || null });
};
$("btnLobby").onclick = () => {
  dmRing = null; $("dmRing").innerHTML = ""; $("feed").innerHTML = '<div class="tag">Fight log</div>';
  chipsKey = ""; lastKey = ""; busy.clear();
  update(path("meta"), { state: "lobby", winner: null, ri: 0 });
};
$("btnNew").onclick = async () => {
  if (!confirm("Start a completely new game? All players will be removed.")) return;
  await createGame(); chipsKey = ""; lastKey = ""; busy.clear(); listen();
};

boot();
