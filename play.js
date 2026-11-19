import {
  db, ref, onValue, set, update, push, runTransaction, increment, serverTimestamp,
  onChildAdded, query, limitToLast, now, esc, fmtTime, shuffle, playerList, damageOf, MISS_LOCK_MS, rankInfo,
} from "./common.js";
import { MiniRing, DeathRing, colorOf } from "./ring.js";
import { QUESTIONS } from "./questions.js";
import { ROUNDS, DEALS, BUILDS, BUILD_POINTS, WORDS, WORD_KC, WORD_WRONG_KC, DIALOG, PRODUCTS, STREAK_EVERY, STREAK_BONUS, ITEMS } from "./content.js";

const $ = (id) => document.getElementById(id);
let code = null, pid = null, meta = {}, players = {}, pitches = {}, hidden = {}, myVote = null, myAns = {};
let unsubs = [], seen = new Set();
let lobbyRing = null, dmRing = null, target = null, lastHp = null, deck = [], screenNow = "", roundKey = "";
const path = (p = "") => ref(db, `games/${code}${p ? "/" + p : ""}`);
const GAPS = DIALOG.map((d, i) => (d.o ? i : -1)).filter((i) => i >= 0);
const rid = () => (meta.plan || [])[meta.ri ?? 0];

// ---------- game switching ----------
onValue(ref(db, "current/code"), (s) => { const c = s.val(); if (c !== code) switchGame(c); });
function switchGame(c) {
  unsubs.forEach((u) => u()); unsubs = []; seen = new Set();
  code = c; meta = {}; players = {}; pitches = {}; hidden = {}; myAns = {};
  lobbyRing = dmRing = null; roundKey = ""; screenNow = "";
  ["lobbyRing", "dmRingP"].forEach((id) => ($(id).innerHTML = ""));
  if (!c) { screen("wait"); return; }
  pid = localStorage.getItem("pid_" + c);
  let first = true;
  unsubs.push(onValue(path("meta"), (s) => {
    meta = s.val() || {};
    if (meta.plan && !Array.isArray(meta.plan)) meta.plan = Object.keys(meta.plan).sort((a, b) => a - b).map((k) => meta.plan[k]);
    if (first) { first = false; unsubs.push(onChildAdded(query(path("events"), limitToLast(30)), (e) => onEvent(e.key, e.val()))); }
    render();
  }));
  unsubs.push(onValue(path("players"), (s) => { players = s.val() || {}; render(); }));
  unsubs.push(onValue(path("pitches"), (s) => { pitches = s.val() || {}; render(); }));
  unsubs.push(onValue(path("hidden"), (s) => { hidden = s.val() || {}; render(); }));
}
function screen(id) {
  if (screenNow === id) return; screenNow = id;
  for (const s of ["wait", "join", "running", "lobby", "intro", "round", "results", "shop", "deathmatch", "over"]) $("p-" + s).classList.toggle("hidden", s !== id);
  $("pTop").classList.toggle("hidden", id !== "round");
  $("pRank").classList.toggle("hidden", !["intro", "round", "results", "shop"].includes(id));
}

// ---------- render ----------
function render() {
  const st = meta.state;
  if (!st) { screen("wait"); return; }
  const me = players[pid];
  if (!me) { screen(st === "deathmatch" || st === "over" ? "running" : "join"); return; }
  $("pStr").textContent = me.strength || 0;
  if (!selfPaced()) myStreak = me.streak || 0;
  const ri = rankInfo(players, pid);
  if (ri) $("pRank").innerHTML = `<span>${ri.pos === 1 ? "👑 <b>#1</b> · you're leading!" : `<b>#${ri.pos}</b>/${ri.of} · ${ri.gap > 0 ? `${ri.gap} 💪 to <b>${esc(ri.aboveName)}</b>` : `same as <b>${esc(ri.aboveName)}</b>`}`}</span><span class="fire">${myStreak >= 2 ? `🔥 ${myStreak}` : ""}</span>`;
  if (st === "lobby") {
    screen("lobby"); $("lobbyName").textContent = me.name;
    if (!lobbyRing) lobbyRing = new MiniRing($("lobbyRing"), colorOf(me));
  } else if (st === "intro") {
    screen("intro"); const r = ROUNDS[rid()] || {};
    $("inTag").textContent = `Round ${meta.ri + 1} of ${meta.plan.length}`; $("inTitle").textContent = r.title; $("inSub").textContent = r.sub;
    roundKey = "";
  } else if (st === "play") {
    screen("round");
    ({ deal: rDeal, builder: rBuilder, words: rWords, dialog: rDialog, pitch: rPitch })[rid()]?.(me);
  } else if (st === "results") {
    screen("results"); roundKey = "";
    const list = playerList(players).sort((a, b) => (b.strength || 0) - (a.strength || 0));
    $("resTag").textContent = `After round ${meta.ri + 1}: ${ROUNDS[rid()]?.title || ""}`;
    $("resStr").textContent = me.strength || 0;
    const d = me.rs?.[rid()] || 0;
    $("resDelta").textContent = d ? `+${d} in this round` : "";
    $("resRank").textContent = `You are #${list.findIndex((p) => p.id === pid) + 1} of ${list.length}`;
  } else if (st === "shop") {
    screen("shop"); renderShop(me);
  } else if (st === "deathmatch") {
    if (screenNow !== "deathmatch") { screen("deathmatch"); deck = []; nextDmQ(); lastHp = null; }
    renderDeathmatch(me);
  } else if (st === "over") {
    screen("over");
    const w = players[meta.winner];
    $("overName").textContent = w ? w.name : "Draw!";
    $("overMe").textContent = meta.winner === pid ? "That's YOU! 🎉" : `Your strength: ${me.strength || 0} · knockouts: ${me.kills || 0}`;
  }
}
function setRound(key, html) { if (roundKey === key) return false; roundKey = key; $("p-round").innerHTML = html; return true; }
const ansKey = (q) => `${meta.ri}_${q}`;
function sendAns(q, a) { myAns[ansKey(q)] = a; set(path(`ans/${meta.ri}/${q}/${pid}`), { a, t: serverTimestamp() }); }
const selfPaced = () => meta.state === "play" && (rid() === "builder" || rid() === "words");
let myStreak = 0;
function ptoast(t) { const d = document.createElement("div"); d.className = "ptoast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2500); }
function selfResult(ok, r) {
  myStreak = ok ? myStreak + 1 : 0;
  const me = players[pid] || {};
  const u = { streak: myStreak, bestStreak: Math.max(me.bestStreak || 0, myStreak) };
  if (ok && myStreak % STREAK_EVERY === 0) {
    u.strength = increment(STREAK_BONUS); u[`rs/${r}`] = increment(STREAK_BONUS);
    push(path("events"), { type: "streak", from: pid, n: myStreak, t: serverTimestamp() });
    ptoast(`🔥 ${myStreak} in a row! +${STREAK_BONUS} 💪`);
  }
  update(path(`players/${pid}`), u);
  render();
}
function lastFb(me, key) {
  const L = me.last && me.last.k === key ? me.last : null;
  if (!L) return `<div class="fb wait">Checking…</div>`;
  if (L.ok === null) return `<div class="fb wait">Too slow! 🔥 streak lost</div>`;
  if (!L.ok) return `<div class="fb bad">Wrong! ${L.pts} 💪${L.pts === 0 ? "" : ""}<br><small>🔥 streak lost</small></div>`;
  const medal = L.rank === 1 ? "🥇 1st!" : L.rank === 2 ? "🥈 2nd!" : L.rank === 3 ? "🥉 3rd!" : "Correct!";
  return `<div class="fb ok">${medal} +${L.pts} 💪${L.bonus ? `<br><small>🔥 streak bonus included</small>` : ""}</div>`;
}

// ----- Round 1: Deal or No Deal -----
function rDeal() {
  const q = meta.q ?? 0, d = DEALS[q], mine = myAns[ansKey(q)];
  if (meta.reveal) {
    const me = players[pid] || {}, k = ansKey(q), has = me.last?.k === k ? 1 : 0;
    setRound(`deal${q}r${has}`, `<div class="pair" style="font-size:22px;font-weight:800">${esc(d.s)}</div>
      ${lastFb(me, k)}
      <div class="pair">${d.ok ? "✓ This sentence is correct." : `✗ Correct version:<br><b>${esc(d.fix)}</b>`}</div>`);
    return;
  }
  if (mine !== undefined) { setRound(`deal${q}l`, `<div class="pair" style="font-size:22px;font-weight:800">${esc(d.s)}</div><div class="fb wait">Locked in: ${mine ? "✓ DEAL" : "✗ NO DEAL"}<br><small style="font-weight:600">Wait for the answer…</small></div>`); return; }
  if (!setRound(`deal${q}`, `<div class="tag" style="text-align:center">Sentence ${q + 1} / ${DEALS.length} · Is it correct?</div>
    <div class="swipe-wrap"><div class="swipe" id="card"><span class="tagl">NO DEAL</span><span class="tagr">DEAL</span>${esc(d.s)}</div></div>
    <div class="duo"><button class="no" id="bNo">✗ No deal</button><button class="yes" id="bYes">✓ Deal</button></div>
    <div class="hint">Swipe right = correct · swipe left = wrong</div>`)) return;
  const card = $("card");
  const decide = (v) => { card.style.transition = "transform .25s"; card.style.transform = `translateX(${v ? 500 : -500}px) rotate(${v ? 25 : -25}deg)`; setTimeout(() => { sendAns(q, v); render(); }, 220); };
  $("bNo").onclick = () => decide(false); $("bYes").onclick = () => decide(true);
  let sx = null, dx = 0;
  card.addEventListener("pointerdown", (e) => { sx = e.clientX; card.setPointerCapture(e.pointerId); card.style.transition = "none"; });
  card.addEventListener("pointermove", (e) => {
    if (sx === null) return; dx = e.clientX - sx;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 15}deg)`;
    card.querySelector(".tagr").style.opacity = Math.max(0, dx / 100); card.querySelector(".tagl").style.opacity = Math.max(0, -dx / 100);
  });
  card.addEventListener("pointerup", () => {
    if (sx === null) return; sx = null;
    if (Math.abs(dx) > 90) decide(dx > 0); else { card.style.transition = "transform .2s"; card.style.transform = ""; card.querySelectorAll(".tagl,.tagr").forEach((t) => (t.style.opacity = 0)); }
    dx = 0;
  });
}

// ----- Round 2: Sentence Builder -----
let bDeck = [], bItem = null, bAns = [], bLock = false;
function rBuilder() {
  if (!setRound(`builder${meta.ri}`, `<div id="bWrap" style="display:flex;flex-direction:column;gap:14px"></div>`)) return;
  myStreak = players[pid]?.streak || 0; bDeck = shuffle(BUILDS); nextBuild();
}
function nextBuild() {
  if (!bDeck.length) bDeck = shuffle(BUILDS);
  bItem = bDeck.pop(); bAns = []; bLock = false;
  bItem.pool = shuffle([...bItem.t, bItem.d].map((w, i) => ({ w, i })));
  drawBuild();
}
function drawBuild() {
  const w = $("bWrap"); if (!w) return;
  w.innerHTML = `<div class="pair">${esc(bItem.a)}<br>${esc(bItem.b)}<br><span style="font-size:15px">Join them with: <b>${esc(bItem.use)}</b></span></div>
    <div class="answer" id="bA">${bAns.map((x) => `<span class="tile" data-i="${x.i}">${esc(x.w)}</span>`).join("")}</div>
    <div class="pool">${bItem.pool.filter((x) => !bAns.includes(x)).map((x) => `<span class="tile" data-p="${x.i}">${esc(x.w)}</span>`).join("")}</div>
    <div class="hint">One word is a trap! Correct sentence = +${BUILD_POINTS} 💪</div>`;
  w.querySelectorAll("[data-p]").forEach((t) => (t.onclick = () => { if (bLock) return; bAns.push(bItem.pool.find((x) => x.i == t.dataset.p)); drawBuild(); checkBuild(); }));
  w.querySelectorAll("[data-i]").forEach((t) => (t.onclick = () => { if (bLock) return; bAns = bAns.filter((x) => x.i != t.dataset.i); drawBuild(); }));
}
function checkBuild() {
  if (bAns.length !== bItem.t.length) return;
  const ok = bAns.map((x) => x.w).join(" ") === bItem.t.join(" ");
  const a = $("bA");
  if (ok) {
    bLock = true; a.style.borderColor = "var(--green)"; a.style.background = "#244a37";
    update(path(`players/${pid}`), { strength: increment(BUILD_POINTS), [`rs/builder`]: increment(BUILD_POINTS) });
    push(path("events"), { type: "build", from: pid, t: serverTimestamp() });
    selfResult(true, "builder");
    setTimeout(nextBuild, 700);
  } else {
    bLock = true; a.classList.add("shake"); a.style.borderColor = "var(--red)"; selfResult(false, "builder");
    a.insertAdjacentHTML("afterend", `<div class="fb bad" id="bMsg">Not quite! 2s…<br><small>${esc(bItem.t.join(" "))}</small></div>`);
    setTimeout(() => { bAns = []; bLock = false; drawBuild(); }, MISS_LOCK_MS + 500);
  }
}

// ----- Round 3: Shop Words -----
let wSet = [], wSel = null, wLock = false, wDone = new Set(), wDeck = [];
function rWords() {
  if (!setRound(`words${meta.ri}`, `<div class="tag" style="text-align:center">Tap a word, then its meaning</div><div class="match" id="wM"></div><div class="hint">Correct pair = +${WORD_KC} Kč + 1 💪 · wrong pair = ${WORD_WRONG_KC} Kč</div>`)) return;
  myStreak = players[pid]?.streak || 0; nextWords();
}
function nextWords() {
  if (wDeck.length < 4) { const used = new Set(wDeck.map((w) => w[0])); wDeck = wDeck.concat(shuffle(WORDS.filter((w) => !used.has(w[0])))); }
  wSet = wDeck.splice(0, 4); wDone = new Set(); wSel = null; wLock = false; drawWords(); }
function drawWords() {
  const m = $("wM"); if (!m) return;
  const defs = m.dataset.order ? JSON.parse(m.dataset.order) : null;
  const order = defs && defs.length === 4 && defs.every((d) => wSet.some((w) => w[1] === d)) ? defs : shuffle(wSet.map((w) => w[1]));
  m.dataset.order = JSON.stringify(order);
  m.innerHTML = wSet.map((w, i) => `<button class="word ${wDone.has(w[0]) ? "done" : ""} ${wSel === w[0] ? "sel" : ""}" data-w="${esc(w[0])}">${esc(w[0])}</button><button class="${wDone.has(wSet.find((x) => x[1] === order[i])[0]) ? "done" : ""}" data-d="${i}">${esc(order[i])}</button>`).join("");
  m.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { if (wLock) return; wSel = b.dataset.w; drawWords(); }));
  m.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
    if (wLock || !wSel) return;
    const def = order[+b.dataset.d], ok = wSet.find((w) => w[0] === wSel)[1] === def;
    if (ok) {
      wDone.add(wSel); wSel = null;
      update(path(`players/${pid}`), { strength: increment(1), [`rs/words`]: increment(1), money: increment(WORD_KC) });
      selfResult(true, "words");
      push(path("events"), { type: "pair", from: pid, t: serverTimestamp() });
      if (wDone.size === 4) { setTimeout(() => { m.dataset.order = ""; nextWords(); }, 350); } else drawWords();
    } else {
      wLock = true; b.classList.add("bad"); m.classList.add("shake"); selfResult(false, "words");
      runTransaction(path(`players/${pid}/money`), (v) => Math.max(0, (v || 0) + WORD_WRONG_KC));
      ptoast(`${WORD_WRONG_KC} Kč`);
      setTimeout(() => { wLock = false; wSel = null; m.classList.remove("shake"); drawWords(); }, 1500);
    }
  }));
}

// ----- Round 4: Max & Zoe -----
function rDialog() {
  const g = meta.q ?? 0, d = DIALOG[GAPS[g]], mine = myAns[ansKey(g)];
  const prev = DIALOG[GAPS[g] - 1];
  const ctx = prev && !prev.o ? `<div class="pair" style="text-align:left"><b>${prev.who === "max" ? "Max" : "Zoe"}:</b> ${esc(prev.s)}</div>` : "";
  const line = (fill) => `<div class="pair" style="text-align:left;font-size:20px;font-weight:700;background:var(--light);color:var(--bg)"><b>${d.who === "max" ? "Max" : "Zoe"}:</b> ${esc(d.s).replace("___", `<span style="color:#1F6F62;border-bottom:3px solid #F2B33D">${fill}</span>`)}</div>`;
  if (meta.reveal) {
    const me = players[pid] || {}, k = ansKey(g), has = me.last?.k === k ? 1 : 0;
    setRound(`dlg${g}r${has}`, `${ctx}${line(esc(d.o[d.k]))}${lastFb(me, k)}`);
    return;
  }
  if (mine !== undefined) { setRound(`dlg${g}l`, `${ctx}${line("___")}<div class="fb wait">Locked in: ${esc(d.o[mine])}<br><small style="font-weight:600">Wait for the answer…</small></div>`); return; }
  if (!setRound(`dlg${g}`, `<div class="tag" style="text-align:center">Gap ${g + 1} / ${GAPS.length}</div>${ctx}${line("___")}<div class="opts" id="dO">${d.o.map((o, j) => `<button data-j="${j}">${esc(o)}</button>`).join("")}</div>`)) return;
  $("dO").querySelectorAll("button").forEach((b) => (b.onclick = () => { sendAns(g, +b.dataset.j); render(); }));
}

// ----- Round 5: Pitch Battle -----
function rPitch() {
  const ph = meta.pphase || "write", mine = pitches[pid];
  if (ph === "write") {
    myVote = null;
    if (mine?.text) { setRound(`pw_sent${meta.ri}`, `<div class="center"><h1>Sent! ✅</h1><div class="pair" style="text-align:left"><b>${esc(mine.product)}</b><br>${esc(mine.text)}</div><p class="muted">Wait for the voting…</p></div>`); return; }
    if (!mine?.product) { set(path(`pitches/${pid}`), { product: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)], at: Date.now() }); return; }
    if (!setRound(`pw${meta.ri}`, `<div class="tag" style="text-align:center">Your product</div><h1 style="text-align:center;color:var(--orange)">${esc(mine.product)}</h1>
      <div class="pair">Sell it in ONE sentence with the first conditional:<br><b>If you buy it, you'll …</b> · <b>When you …, you'll …</b></div>
      <textarea id="pT" maxlength="110" placeholder="If you drink this, you'll never fall asleep in maths!"></textarea>
      <div id="pW" class="hint"></div><button class="wide" id="pS">Send my pitch 🚀</button>`)) return;
    $("pS").onclick = () => {
      const t = $("pT").value.trim();
      if (t.length < 10) { $("pW").textContent = "Write a full sentence 🙂"; return; }
      if (!/\b(if|when|unless|as soon as|before|after|until)\b/i.test(t)) { $("pW").textContent = "Use IF / WHEN / UNLESS / AS SOON AS!"; return; }
      if (!/('ll|\bwill\b|\bwon't\b)/i.test(t) && $("pS").dataset.warned !== "1") { $("pW").textContent = "Don't forget WILL ('ll) in the result part! Tap again to send anyway."; $("pS").dataset.warned = "1"; return; }
      update(path(`pitches/${pid}`), { text: t, at: Date.now() });
    };
  } else if (ph === "vote") {
    const list = Object.entries(pitches).filter(([id, p]) => p.text && !hidden[id] && players[id]).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.at || 0) - (b.at || 0));
    const key = `pv${list.map((x) => x.id).join()}${myVote}`;
    if (!setRound(key, `<div class="tag" style="text-align:center">Vote for the best pitch!</div><div class="vlist">${list.map((x, i) => x.id === pid ? `<button disabled><small>${i + 1} · ${esc(x.product)} (yours)</small>${esc(x.text)}</button>` : `<button class="${myVote === x.id ? "sel" : ""}" data-v="${x.id}"><small>${i + 1} · ${esc(x.product)}</small>${esc(x.text)}</button>`).join("")}</div><div class="hint">You can change your vote until the time is up.</div>`)) return;
    $("p-round").querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { myVote = b.dataset.v; set(path(`votes/${pid}`), myVote); render(); }));
  } else {
    setRound(`pd${meta.ri}`, `<div class="center"><h1>🏆</h1><p style="font-size:22px;font-weight:800">Look at the board!</p></div>`);
  }
}

// ---------- SHOP ----------
function renderShop(me) {
  $("shMoney").textContent = me.money || 0;
  const key = JSON.stringify([me.money, me.items]);
  if ($("shItems").dataset.k === key) return; $("shItems").dataset.k = key;
  $("shItems").innerHTML = Object.entries(ITEMS).map(([k, it]) => {
    const own = me.items?.[k], can = (me.money || 0) >= it.price;
    return `<div class="shopcard ${own ? "owned" : ""}"><div class="ic">${it.icon}</div><div class="tx"><b>${it.name}</b><div>${it.desc}</div></div>
      ${own ? `<span style="color:var(--green);font-weight:900">✓ yours</span>` : `<button data-buy="${k}" ${can ? "" : "disabled"}>${it.price} Kč</button>`}</div>`;
  }).join("");
  $("shItems").querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
}
async function buy(k) {
  const it = ITEMS[k];
  const res = await runTransaction(path(`players/${pid}`), (p) => {
    if (p === null) return p;
    if (p.items?.[k] || (p.money || 0) < it.price) return;
    p.money = (p.money || 0) - it.price; p.items = { ...(p.items || {}), [k]: true }; return p;
  });
  if (res.committed) { push(path("events"), { type: "buy", from: pid, item: k, t: serverTimestamp() }); ptoast(`${it.icon} ${it.name} bought!`); if (navigator.vibrate) navigator.vibrate(60); }
}

// ---------- timer ----------
setInterval(() => {
  if (meta.state === "shop") $("shTime").textContent = `The fight starts in ${fmtTime((meta.phaseEnd || 0) - now())}`;
  if (meta.state !== "play") return;
  const r = rid();
  let left = null;
  if ((r === "deal" || r === "dialog") && !meta.reveal) left = meta.qEnd - now();
  if (r === "builder" || r === "words" || (r === "pitch" && meta.pphase !== "done")) left = meta.phaseEnd - now();
  $("pTimer").textContent = left == null ? "" : fmtTime(left);
  if (meta.state === "shop") $("shTime").textContent = `The fight starts in ${fmtTime((meta.phaseEnd || 0) - now())}`;
  if (left != null && left <= 0) { if (r === "builder") bLock = true; if (r === "words") wLock = true; }
}, 250);

// ---------- DEATHMATCH (same as before) ----------
function renderDeathmatch(me) {
  const list = playerList(players);
  if (!dmRing) dmRing = new DeathRing($("dmRingP"), { big: true, meId: pid, onSelect: (id) => choose(id) });
  dmRing.update(list);
  const hp = Math.max(0, me.hp || 0), max = me.maxHp || 1;
  $("dmHp").textContent = `${hp} / ${max}`; $("dmStr").textContent = damageOf(me); $("dmHpBar").style.width = `${(hp / max) * 100}%`;
  if (lastHp !== null && hp < lastHp) { document.body.classList.remove("flash-hit"); void document.body.offsetWidth; document.body.classList.add("flash-hit"); if (navigator.vibrate) navigator.vibrate(120); }
  lastHp = hp;
  const dead = me.alive === false;
  $("dmAlive").classList.toggle("hidden", dead); $("dmDead").classList.toggle("hidden", !dead); $("dmTarget").classList.toggle("hidden", dead);
  if (dead) return;
  const t = players[target];
  if (!t || t.alive === false || target === pid) autoTarget(); else updateTargetText();
}
const aliveOthers = () => playerList(players).filter((p) => p.id !== pid && p.alive !== false);
function autoTarget() { const o = aliveOthers(); target = o.length ? o[Math.floor(Math.random() * o.length)].id : null; dmRing?.setSelected(target); updateTargetText(); }
function choose(id) { const p = players[id]; if (!p || p.alive === false || id === pid) return; target = id; dmRing.setSelected(id); updateTargetText(); }
function updateTargetText() { const p = players[target]; $("dmTarget").innerHTML = p ? `🎯 Target: <b style="color:var(--orange)">${esc(p.name)}</b> · tap another boxer to switch` : "No targets left"; }
let locked = false;
function nextDmQ() {
  if (!deck.length) deck = shuffle(QUESTIONS);
  const q = deck.pop(), parts = esc(q.s).split("___");
  $("dmQ").innerHTML = `<div>${parts[0]}<span class="gap">&nbsp;?&nbsp;</span>${parts[1] || ""}</div>`;
  const box = $("dmOpts"); box.innerHTML = ""; locked = false;
  for (const o of shuffle(q.o)) { const b = document.createElement("button"); b.textContent = o; b.onclick = () => dmAnswer(q, o, b); box.appendChild(b); }
}
async function dmAnswer(q, o, btn) {
  if (locked) return; locked = true;
  const box = $("dmOpts");
  if (o === q.a) { btn.classList.add("ok"); await dmHit(); setTimeout(nextDmQ, 250); }
  else {
    btn.classList.add("bad"); [...box.children].forEach((b) => { if (b.textContent === q.a) b.classList.add("ok"); });
    if (target) push(path("events"), { type: "miss", from: pid, to: target, t: serverTimestamp() });
    const lock = document.createElement("div"); lock.className = "lock"; box.appendChild(lock);
    const end = Date.now() + (players[pid]?.items?.energy ? 500 : MISS_LOCK_MS);
    const tick = () => { const left = end - Date.now(); if (left <= 0) { nextDmQ(); return; } lock.textContent = players[pid]?.items?.energy ? "⚡ Miss!" : `Miss! ${Math.ceil(left / 1000)}s`; setTimeout(tick, 100); };
    tick();
  }
}
async function dmHit() {
  const me = players[pid]; if (!me || me.alive === false) return;
  if (!target || players[target]?.alive === false) autoTarget(); if (!target) return;
  const to = target, dmg = damageOf(me);
  const res = await runTransaction(path(`players/${to}`), (p) => {
    if (p === null) return p;
    if (p.alive === false || (p.hp || 0) <= 0) return;
    p.hp = Math.max(0, (p.hp || 0) - dmg); if (p.hp === 0) p.alive = false; return p;
  });
  if (!res.committed) { autoTarget(); return; }
  const ko = res.snapshot.val()?.alive === false;
  push(path("events"), { type: "hit", from: pid, to, dmg, ko, t: serverTimestamp() });
  if (ko) { update(path(`players/${pid}`), { kills: increment(1) }); autoTarget(); }
}
function onEvent(key, ev) {
  if (!ev || seen.has(key)) return; seen.add(key);
  if ((ev.t || 0) < (meta.phaseStart || 0) - 1000) return;
  if ((ev.type === "hit" || ev.type === "miss") && dmRing) {
    dmRing.attack(ev.from, ev.to, ev.dmg, ev.type === "miss", ev.ko);
    if (ev.ko && ev.to === pid) $("dmDeadMsg").textContent = `${players[ev.from]?.name || "Someone"} knocked you out. Watch the board!`;
  }
}

// ---------- join ----------
$("btnJoin").onclick = join;
$("nameIn").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
async function join() {
  const name = $("nameIn").value.trim().slice(0, 14);
  if (!name || !code) { $("nameIn").focus(); return; }
  $("btnJoin").disabled = true;
  const r = push(path("players")); pid = r.key; localStorage.setItem("pid_" + code, pid);
  await set(r, { name, strength: 0, hp: 0, maxHp: 0, alive: true, kills: 0, color: Object.keys(players).length % 12, joinedAt: serverTimestamp() });
  $("btnJoin").disabled = false;
}
