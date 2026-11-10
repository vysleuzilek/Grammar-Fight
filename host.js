import {
  db, ref, onValue, set, update, get, remove, serverTimestamp, onChildAdded, query, limitToLast,
  now, esc, fmtTime, playerList, computeHp,
} from "./common.js";
import { MiniRing, DeathRing, colorOf, thump } from "./ring.js";

const $ = (id) => document.getElementById(id);
let code = null;
let meta = {};
let players = {};
let unsubs = [];
let ending = false;
let seen = new Set();
const trainCards = {};
let dmRing = null;
let lastState = null;

const path = (p = "") => ref(db, `games/${code}${p ? "/" + p : ""}`);

function randomCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
}

async function createGame() {
  code = randomCode();
  localStorage.setItem("hostCode", code);
  await set(ref(db, `games/${code}`), { meta: { state: "lobby", phaseStart: 0, createdAt: serverTimestamp() } });
  await set(ref(db, "current"), { code });
}

async function boot() {
  const saved = localStorage.getItem("hostCode");
  if (saved) {
    const s = await get(ref(db, `games/${saved}/meta/state`));
    if (s.exists()) code = saved;
  }
  if (!code) await createGame();
  else await set(ref(db, "current"), { code });
  const url = new URL("play.html", location.href).href;
  $("joinUrl").textContent = url;
  $("qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=" + encodeURIComponent(url);
  listen();
}

function listen() {
  unsubs.forEach((u) => u());
  unsubs = [];
  seen = new Set();
  let metaLoaded = false;
  unsubs.push(onValue(path("meta"), (s) => {
    meta = s.val() || {};
    if (!metaLoaded) {
      metaLoaded = true;
      unsubs.push(onChildAdded(query(path("events"), limitToLast(40)), (e) => onEvent(e.key, e.val())));
    }
    render();
  }));
  unsubs.push(onValue(path("players"), (s) => { players = s.val() || {}; render(); }));
}

// ---------- rendering ----------
function show(id) {
  for (const s of ["lobby", "training", "results", "deathmatch"]) $("s-" + s).classList.toggle("hidden", s !== id);
}

function render() {
  const st = meta.state || "lobby";
  if (st !== lastState) { ending = false; lastState = st; }
  $("winner").classList.toggle("hidden", st !== "over");
  if (st === "lobby") { show("lobby"); renderLobby(); }
  else if (st === "training") { show("training"); renderTraining(); }
  else if (st === "results") { show("results"); renderResults(); }
  else if (st === "deathmatch" || st === "over") { show("deathmatch"); renderDeathmatch(); if (st === "over") renderWinner(); }
}

let chipsKey = "";
function renderLobby() {
  const list = playerList(players);
  $("lobbyCount").textContent = list.length;
  const key = list.map((p) => p.id + p.name).join("|");
  if (key === chipsKey) return;
  chipsKey = key;
  $("chips").innerHTML = list.map((p) =>
    `<div class="chip"><span class="dot" style="background:${colorOf(p)}"></span>${esc(p.name)}<button class="x" data-kick="${p.id}" title="Remove">×</button></div>`).join("");
  $("chips").querySelectorAll("[data-kick]").forEach((b) =>
    b.addEventListener("click", () => remove(path(`players/${b.dataset.kick}`))));
}

function renderTraining() {
  const list = playerList(players);
  for (const p of list) {
    if (!trainCards[p.id]) {
      const card = document.createElement("div");
      card.className = "train-card";
      card.innerHTML = `<div class="mini"></div><div class="row"><span class="nm"></span><span class="st">0</span></div>`;
      $("trainGrid").appendChild(card);
      trainCards[p.id] = { card, ring: new MiniRing(card.querySelector(".mini"), colorOf(p)), st: card.querySelector(".st"), nm: card.querySelector(".nm") };
    }
    trainCards[p.id].nm.textContent = p.name;
    trainCards[p.id].st.textContent = p.strength || 0;
  }
  for (const id of Object.keys(trainCards)) {
    if (!players[id]) { trainCards[id].card.remove(); delete trainCards[id]; }
  }
}

function renderResults() {
  const list = playerList(players).sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const max = Math.max(1, ...list.map((p) => p.strength || 0));
  const html = list.map((p, i) => `
    <div class="board-row ${i === 0 ? "top1" : ""}" style="animation-delay:${i * 80}ms">
      <div class="rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
      <div>${esc(p.name)}<div class="bar" style="width:${((p.strength || 0) / max) * 100}%;background:${colorOf(p)}"></div></div>
      <div class="val">${p.strength || 0}</div>
    </div>`).join("");
  if ($("board").dataset.html !== html) { $("board").innerHTML = html; $("board").dataset.html = html; }
  $("hpInfo").textContent = `Everyone will start with ${computeHp(players)} HP · 1 punch = your strength`;
}

function renderDeathmatch() {
  if (!dmRing) dmRing = new DeathRing($("dmRing"));
  const list = playerList(players);
  dmRing.update(list);
  const alive = list.filter((p) => p.alive !== false);
  $("aliveCount").textContent = alive.length;
  if (meta.state === "deathmatch" && !ending && list.length >= 2 && alive.length <= 1) {
    ending = true;
    update(path("meta"), { state: "over", winner: alive[0]?.id || null });
  }
}

function renderWinner() {
  const w = players[meta.winner];
  $("winnerName").textContent = w ? w.name : "Draw!";
}

function feed(html, cls = "") {
  const d = document.createElement("div");
  d.className = "ev " + cls;
  d.innerHTML = html;
  const f = $("feed");
  f.insertBefore(d, f.children[1] || null);
  while (f.children.length > 16) f.lastChild.remove();
}

// ---------- events from phones ----------
function onEvent(key, ev) {
  if (!ev || seen.has(key)) return;
  seen.add(key);
  if ((ev.t || 0) < (meta.phaseStart || 0) - 1000) return;
  if (ev.type === "bag" && meta.state === "training") {
    trainCards[ev.from]?.ring.hit();
    thump(false);
  } else if ((ev.type === "hit" || ev.type === "miss") && dmRing) {
    const missed = ev.type === "miss";
    dmRing.attack(ev.from, ev.to, ev.dmg, missed, ev.ko);
    const a = esc(players[ev.from]?.name || "?"), b = esc(players[ev.to]?.name || "?");
    if (missed) feed(`${a} missed ${b}`);
    else {
      thump(true);
      feed(`<b>${a}</b> → ${b} −${ev.dmg}`);
      if (ev.ko) feed(`💥 ${b} is KO! (by ${a})`, "ko");
    }
  }
}

// ---------- timer ----------
setInterval(() => {
  if (meta.state !== "training") return;
  const left = (meta.phaseEnd || 0) - now();
  $("tTimer").textContent = fmtTime(left);
  if (left <= 0 && !ending) {
    ending = true;
    update(path("meta"), { state: "results" });
  }
}, 250);

// ---------- buttons ----------
function resetPlayers(extra) {
  const u = {};
  for (const id of Object.keys(players)) Object.assign(u, extra(id));
  return u;
}

$("btnPlay").addEventListener("click", async () => {
  if (!Object.keys(players).length && !confirm("No players yet. Start anyway?")) return;
  thump(false);
  const t = now();
  await remove(path("events"));
  const u = resetPlayers((id) => ({ [`players/${id}/strength`]: 0, [`players/${id}/alive`]: true, [`players/${id}/hp`]: 0, [`players/${id}/maxHp`]: 0, [`players/${id}/kills`]: 0 }));
  u["meta/state"] = "training";
  u["meta/phaseStart"] = t;
  u["meta/phaseEnd"] = t + Number($("trainLen").value) * 1000;
  u["meta/winner"] = null;
  await update(path(), u);
});

$("btnEndTrain").addEventListener("click", () => update(path("meta"), { state: "results" }));

$("btnDM").addEventListener("click", async () => {
  thump(true);
  const hp = computeHp(players);
  await remove(path("events"));
  const u = resetPlayers((id) => ({ [`players/${id}/hp`]: hp, [`players/${id}/maxHp`]: hp, [`players/${id}/alive`]: true, [`players/${id}/kills`]: 0 }));
  u["meta/state"] = "deathmatch";
  u["meta/phaseStart"] = now();
  u["meta/hp"] = hp;
  await update(path(), u);
});

$("btnEndDM").addEventListener("click", () => {
  const alive = playerList(players).filter((p) => p.alive !== false).sort((a, b) => (b.hp || 0) - (a.hp || 0));
  ending = true;
  update(path("meta"), { state: "over", winner: alive[0]?.id || null });
});

$("btnLobby").addEventListener("click", () => {
  dmRing = null;
  $("dmRing").innerHTML = "";
  $("feed").innerHTML = '<div class="tag">Fight log</div>';
  for (const id of Object.keys(trainCards)) { trainCards[id].card.remove(); delete trainCards[id]; }
  chipsKey = "";
  update(path("meta"), { state: "lobby", winner: null });
});

$("btnNew").addEventListener("click", async () => {
  if (!confirm("Start a completely new game? All players will be removed.")) return;
  await createGame();
  chipsKey = "";
  listen();
});

boot();
