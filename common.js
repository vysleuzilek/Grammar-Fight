import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, push, get, remove, runTransaction,
  increment, serverTimestamp, onChildAdded, query, limitToLast,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export {
  ref, onValue, set, update, push, get, remove, runTransaction,
  increment, serverTimestamp, onChildAdded, query, limitToLast,
};

// Server time sync, so the timer is the same on the board and on phones
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

export const MISS_LOCK_MS = 2000;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// players object -> array sorted by join time (stable positions in the ring)
export function playerList(obj) {
  return Object.entries(obj || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

// Deathmatch balancing: HP depends on how strong the class got in training
export function computeHp(players) {
  const list = playerList(players);
  if (!list.length) return 20;
  const avg = list.reduce((s, p) => s + (p.strength || 0), 0) / list.length;
  return Math.max(20, Math.round(avg * 5));
}
export const damageOf = (p) => Math.max(1, p?.strength || 0);
