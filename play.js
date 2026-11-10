import {
  db, ref, onValue, set, update, push, runTransaction, increment, serverTimestamp,
  onChildAdded, query, limitToLast, now, esc, fmtTime, shuffle, playerList, damageOf, MISS_LOCK_MS,
} from "./common.js";
import { MiniRing, DeathRing, colorOf } from "./ring.js";
import { QUESTIONS } from "./questions.js";

const $ = (id) => document.getElementById(id);
let code = null, pid = null, meta = {}, players = {};
let unsubs = [];
let seen = new Set();
let lobbyRing = null, trRing = null, dmRing = null;
let target = null;
let lastHp = null;
let deck = [];
let screenNow = "";

const path = (p = "") => ref(db, `games/${code}${p ? "/" + p : ""}`);

// ---------- game switching ----------
onValue(ref(db, "current/code"), (s) => {
  const c = s.val();
  if (c !== code) switchGame(c);
});

function switchGame(c) {
  unsubs.forEach((u) => u());
  unsubs = [];
  seen = new Set();
  code = c;
  meta = {}; players = {};
  lobbyRing = trRing = dmRing = null;
  ["lobbyRing", "trRing", "dmRingP"].forEach((id) => ($(id).innerHTML = ""));
  if (!c) { screen("wait"); return; }
  pid = localStorage.getItem("pid_" + c);
  let metaLoaded = false;
  unsubs.push(onValue(path("meta"), (s) => {
    meta = s.val() || {};
    if (!metaLoaded) {
      metaLoaded = true;
      unsubs.push(onChildAdded(query(path("events"), limitToLast(30)), (e) => onEvent(e.key, e.val())));
    }
    render();
  }));
  unsubs.push(onValue(path("players"), (s) => { players = s.val() || {}; render(); }));
}

function screen(id) {
  if (screenNow === id) return;
  screenNow = id;
  for (const s of ["wait", "join", "running", "lobby", "training", "results", "deathmatch", "over"]) $("p-" + s).classList.toggle("hidden", s !== id);
}

// ---------- render ----------
function render() {
  const st = meta.state;
  if (!st) { screen("wait"); return; }
  const me = players[pid];
  if (!me) {
    if (st === "lobby" || st === "training") screen("join");
    else screen("running");
    return;
  }
  if (st === "lobby") {
    screen("lobby");
    $("lobbyName").textContent = me.name;
    if (!lobbyRing) lobbyRing = new MiniRing($("lobbyRing"), colorOf(me));
  } else if (st === "training") {
    if (screenNow !== "training") { screen("training"); deck = []; nextQ("tr"); }
    if (!trRing) trRing = new MiniRing($("trRing"), colorOf(me));
    $("trStr").textContent = me.strength || 0;
  } else if (st === "results") {
    screen("results");
    const list = playerList(players).sort((a, b) => (b.strength || 0) - (a.strength || 0));
    $("resStr").textContent = me.strength || 0;
    $("resRank").textContent = `You are #${list.findIndex((p) => p.id === pid) + 1} of ${list.length}`;
  } else if (st === "deathmatch") {
    if (screenNow !== "deathmatch") { screen("deathmatch"); deck = []; nextQ("dm"); lastHp = null; }
    renderDeathmatch(me);
  } else if (st === "over") {
    screen("over");
    const w = players[meta.winner];
    $("overName").textContent = w ? w.name : "Draw!";
    $("overMe").textContent = meta.winner === pid ? "That's YOU! 🎉" : `Your knockouts: ${me.kills || 0}`;
  }
}

function renderDeathmatch(me) {
  const list = playerList(players);
  if (!dmRing) dmRing = new DeathRing($("dmRingP"), { big: true, meId: pid, onSelect: (id) => choose(id) });
  dmRing.update(list);
  const hp = Math.max(0, me.hp || 0), max = me.maxHp || 1;
  $("dmHp").textContent = `${hp} / ${max}`;
  $("dmStr").textContent = damageOf(me);
  $("dmHpBar").style.width = `${(hp / max) * 100}%`;
  if (lastHp !== null && hp < lastHp) {
    document.body.classList.remove("flash-hit"); void document.body.offsetWidth; document.body.classList.add("flash-hit");
    if (navigator.vibrate) navigator.vibrate(120);
  }
  lastHp = hp;
  const dead = me.alive === false;
  $("dmAlive").classList.toggle("hidden", dead);
  $("dmDead").classList.toggle("hidden", !dead);
  $("dmTarget").classList.toggle("hidden", dead);
  if (dead) return;
  const t = players[target];
  if (!t || t.alive === false || target === pid) autoTarget();
  else updateTargetText();
}

function aliveOthers() {
  return playerList(players).filter((p) => p.id !== pid && p.alive !== false);
}

function autoTarget() {
  const others = aliveOthers();
  target = others.length ? others[Math.floor(Math.random() * others.length)].id : null;
  dmRing?.setSelected(target);
  updateTargetText();
}

function choose(id) {
  const p = players[id];
  if (!p || p.alive === false || id === pid) return;
  target = id;
  dmRing.setSelected(id);
  updateTargetText();
}

function updateTargetText() {
  const p = players[target];
  $("dmTarget").innerHTML = p ? `🎯 Target: <b style="color:var(--orange)">${esc(p.name)}</b> · tap another boxer to switch` : "No targets left";
}

// ---------- questions ----------
let locked = false;
function nextQ(prefix) {
  if (!deck.length) deck = shuffle(QUESTIONS);
  const q = deck.pop();
  const parts = esc(q.s).split("___");
  $(prefix + "Q").innerHTML = `<div>${parts[0]}<span class="gap">&nbsp;?&nbsp;</span>${parts[1] || ""}</div>`;
  const box = $(prefix + "Opts");
  box.innerHTML = "";
  locked = false;
  for (const o of shuffle(q.o)) {
    const b = document.createElement("button");
    b.textContent = o;
    b.addEventListener("click", () => answer(prefix, q, o, b));
    box.appendChild(b);
  }
}

async function answer(prefix, q, o, btn) {
  if (locked) return;
  if (prefix === "tr" && (meta.phaseEnd || 0) - now() <= 0) return;
  locked = true;
  const box = $(prefix + "Opts");
  if (o === q.a) {
    btn.classList.add("ok");
    if (prefix === "tr") await trainingHit();
    else await deathmatchHit();
    setTimeout(() => nextQ(prefix), 250);
  } else {
    btn.classList.add("bad");
    [...box.children].forEach((b) => { if (b.textContent === q.a) b.classList.add("ok"); });
    if (prefix === "dm" && target) push(path("events"), { type: "miss", from: pid, to: target, t: serverTimestamp() });
    const lock = document.createElement("div");
    lock.className = "lock";
    box.appendChild(lock);
    const end = Date.now() + MISS_LOCK_MS;
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) { nextQ(prefix); return; }
      lock.textContent = `Miss! ${Math.ceil(left / 1000)}s`;
      setTimeout(tick, 100);
    };
    tick();
  }
}

async function trainingHit() {
  trRing?.hit();
  update(path(`players/${pid}`), { strength: increment(1) });
  push(path("events"), { type: "bag", from: pid, t: serverTimestamp() });
}

async function deathmatchHit() {
  const me = players[pid];
  if (!me || me.alive === false) return;
  if (!target || players[target]?.alive === false) autoTarget();
  if (!target) return;
  const to = target;
  const dmg = damageOf(me);
  const res = await runTransaction(path(`players/${to}`), (p) => {
    if (p === null) return p;
    if (p.alive === false || (p.hp || 0) <= 0) return; // already KO -> abort
    p.hp = Math.max(0, (p.hp || 0) - dmg);
    if (p.hp === 0) p.alive = false;
    return p;
  });
  if (!res.committed) { autoTarget(); return; }
  const ko = res.snapshot.val()?.alive === false;
  push(path("events"), { type: "hit", from: pid, to, dmg, ko, t: serverTimestamp() });
  if (ko) {
    update(path(`players/${pid}`), { kills: increment(1) });
    autoTarget();
  }
}

// ---------- animations from everybody ----------
function onEvent(key, ev) {
  if (!ev || seen.has(key)) return;
  seen.add(key);
  if ((ev.t || 0) < (meta.phaseStart || 0) - 1000) return;
  if ((ev.type === "hit" || ev.type === "miss") && dmRing) {
    dmRing.attack(ev.from, ev.to, ev.dmg, ev.type === "miss", ev.ko);
    if (ev.ko && ev.to === pid) $("dmDeadMsg").textContent = `${players[ev.from]?.name || "Someone"} knocked you out. Watch the board!`;
  }
}

// ---------- timer ----------
setInterval(() => {
  if (meta.state === "training") $("trTimer").textContent = fmtTime((meta.phaseEnd || 0) - now());
}, 250);

// ---------- join ----------
$("btnJoin").addEventListener("click", join);
$("nameIn").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });

async function join() {
  const name = $("nameIn").value.trim().slice(0, 14);
  if (!name || !code) { $("nameIn").focus(); return; }
  $("btnJoin").disabled = true;
  const r = push(path("players"));
  pid = r.key;
  localStorage.setItem("pid_" + code, pid);
  await set(r, {
    name, strength: 0, hp: 0, maxHp: 0, alive: true, kills: 0,
    color: Object.keys(players).length % 12, joinedAt: serverTimestamp(),
  });
  $("btnJoin").disabled = false;
}
