// SVG drawing of boxers, bags and rings. Shared by the board (host) and phones.
const NS = "http://www.w3.org/2000/svg";
export const COLORS = ["#f28a4b", "#7fa6f5", "#5cc98a", "#e9c46a", "#c77dff", "#ff6b9a",
  "#4dd4d4", "#f4f1de", "#a3b18a", "#ff9f1c", "#8ecae6", "#e76f51"];
export const colorOf = (p) => COLORS[(p?.color ?? 0) % COLORS.length];

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Boxer facing right, centered around (0,0)
function boxer(parent, color) {
  const g = el("g", { class: "boxer" }, parent);
  el("circle", { cx: -13, cy: -2, r: 8, fill: "#9e1b24", stroke: "#14161f", "stroke-width": 2 }, g);
  el("ellipse", { cx: 0, cy: 14, rx: 15, ry: 21, fill: color, stroke: "#14161f", "stroke-width": 2 }, g);
  el("rect", { x: -15, y: 24, width: 30, height: 10, rx: 3, fill: "#1d2030", opacity: 0.55 }, g);
  el("circle", { cx: 0, cy: -19, r: 12, fill: "#f2c79b", stroke: "#14161f", "stroke-width": 2 }, g);
  el("circle", { cx: 6, cy: -21, r: 1.8, fill: "#14161f" }, g);
  el("circle", { cx: 13, cy: -7, r: 8.5, fill: "#c1272d", stroke: "#14161f", "stroke-width": 2 }, g);
  el("circle", { cx: 18, cy: 6, r: 10, fill: "#e63946", stroke: "#14161f", "stroke-width": 2, class: "glove-front" }, g);
  return g;
}

function restart(node, cls, ms) {
  node.classList.remove(cls);
  void node.getBoundingClientRect();
  node.classList.add(cls);
  clearTimeout(node["_t" + cls]);
  node["_t" + cls] = setTimeout(() => node.classList.remove(cls), ms);
}

function punch(boxerG) { restart(boxerG, "punch", 160); }

// ---------- Training ring: one boxer + one bag ----------
export class MiniRing {
  constructor(container, color) {
    this.svg = el("svg", { viewBox: "0 0 220 150", class: "mini-ring" });
    container.appendChild(this.svg);
    el("rect", { x: 6, y: 34, width: 208, height: 110, rx: 10, fill: "#2f3554" }, this.svg);
    el("rect", { x: 6, y: 120, width: 208, height: 24, rx: 10, fill: "#262b45" }, this.svg);
    ["#e63946", "#f6f2ea", "#7fa6f5"].forEach((c, i) =>
      el("line", { x1: 10, y1: 44 + i * 9, x2: 210, y2: 44 + i * 9, stroke: c, "stroke-width": 2.5, opacity: 0.8 }, this.svg));
    [[10, 40], [210, 40]].forEach(([x, y]) => el("rect", { x: x - 4, y: y - 8, width: 8, height: 36, rx: 3, fill: "#d9d4ca" }, this.svg));
    this.bag = el("g", { class: "bag" }, this.svg);
    el("line", { x1: 158, y1: 4, x2: 158, y2: 30, stroke: "#c9c6d6", "stroke-width": 2 }, this.bag);
    el("rect", { x: 144, y: 30, width: 28, height: 66, rx: 11, fill: "#8b4a2b", stroke: "#14161f", "stroke-width": 2 }, this.bag);
    el("rect", { x: 144, y: 44, width: 28, height: 6, fill: "#5e3220" }, this.bag);
    el("rect", { x: 144, y: 78, width: 28, height: 6, fill: "#5e3220" }, this.bag);
    const pos = el("g", { transform: "translate(100 92) scale(1.45)" }, this.svg);
    this.boxer = boxer(pos, color);
  }
  hit() {
    punch(this.boxer);
    restart(this.bag, "swing", 650);
  }
}

// ---------- Deathmatch ring: everybody in one ring ----------
export class DeathRing {
  constructor(container, { onSelect, meId, big } = {}) {
    this.onSelect = onSelect;
    this.big = !!big;
    this.meId = meId;
    this.svg = el("svg", { viewBox: "0 0 1000 620", class: "death-ring" });
    container.appendChild(this.svg);
    el("rect", { x: 40, y: 40, width: 920, height: 540, rx: 26, fill: "#262b45" }, this.svg);
    el("rect", { x: 70, y: 70, width: 860, height: 480, rx: 16, fill: "#2f3554" }, this.svg);
    ["#e63946", "#f6f2ea", "#7fa6f5"].forEach((c, i) =>
      el("rect", { x: 70 + i * 10, y: 70 + i * 10, width: 860 - i * 20, height: 480 - i * 20, rx: 14, fill: "none", stroke: c, "stroke-width": 4, opacity: 0.75 }, this.svg));
    [[70, 70], [930, 70], [70, 550], [930, 550]].forEach(([x, y]) =>
      el("circle", { cx: x, cy: y, r: 16, fill: "#d9d4ca", stroke: "#14161f", "stroke-width": 3 }, this.svg));
    this.layer = el("g", {}, this.svg);
    this.fx = el("g", {}, this.svg);
    this.nodes = {};
    this.pos = {};
    this.key = "";
    this.selected = null;
  }

  layout(list) {
    const n = list.length;
    const s = this.big ? (n > 14 ? 1.5 : n > 8 ? 2.0 : 2.5) : (n > 14 ? 0.85 : n > 8 ? 1.0 : 1.2);
    const ry = this.big ? 135 : 170;
    list.forEach((p, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
      const x = 500 + Math.cos(a) * 330, y = 300 + Math.sin(a) * ry;
      this.pos[p.id] = { x, y, s };
    });
  }

  build(list) {
    this.layer.innerHTML = "";
    this.nodes = {};
    this.layout(list);
    for (const p of list) {
      const { x, y, s } = this.pos[p.id];
      const outer = el("g", { transform: `translate(${x} ${y})`, class: "fighter", "data-id": p.id }, this.layer);
      const sel = el("ellipse", { cx: 0, cy: 38 * s, rx: 44 * s, ry: 12 * s, fill: "none", stroke: "#f28a4b", "stroke-width": 5, class: "sel", opacity: 0 }, outer);
      el("ellipse", { cx: 0, cy: 38 * s, rx: 30 * s, ry: 7 * s, fill: "#000", opacity: 0.25 }, outer);
      const shake = el("g", { class: "shaker" }, outer);
      const flip = x > 500 ? -1 : 1;
      const scaled = el("g", { transform: `scale(${flip * s} ${s})` }, shake);
      const b = boxer(scaled, colorOf(p));
      const name = el("text", { x: 0, y: 64 * s, "text-anchor": "middle", class: "f-name", "font-size": this.big ? (list.length > 8 ? 34 : 44) : (list.length > 12 ? 18 : 22) }, outer);
      name.textContent = p.id === this.meId ? `${p.name} (you)` : p.name;
      const bw = this.big ? 150 : 80, bh = this.big ? 18 : 10;
      el("rect", { x: -bw / 2, y: 72 * s, width: bw, height: bh, rx: bh / 2, fill: "#14161f" }, outer);
      const hp = el("rect", { x: -bw / 2, y: 72 * s, width: bw, height: bh, rx: bh / 2, fill: "#5cc98a" }, outer);
      const str = el("text", { x: 0, y: -48 * s, "text-anchor": "middle", class: "f-str", "font-size": 18, display: this.big ? "none" : "inline" }, outer);
      const hit = el("rect", { x: -60 * s, y: -75 * s, width: 120 * s, height: 170 * s, fill: "transparent" }, outer);
      if (this.onSelect && p.id !== this.meId) {
        outer.style.cursor = "pointer";
        hit.addEventListener("click", () => this.onSelect(p.id));
      }
      this.nodes[p.id] = { outer, sel, shake, b, hp, str, name, bw };
    }
    this.setSelected(this.selected);
  }

  update(list) {
    const key = list.map((p) => p.id).join(",");
    if (key !== this.key) { this.key = key; this.build(list); }
    for (const p of list) {
      const n = this.nodes[p.id];
      if (!n) continue;
      const max = p.maxHp || 1, hp = Math.max(0, p.hp ?? max);
      const r = hp / max;
      n.hp.setAttribute("width", String(n.bw * r));
      n.hp.setAttribute("fill", r > 0.5 ? "#5cc98a" : r > 0.25 ? "#e9c46a" : "#f06a5a");
      n.str.textContent = `STR ${p.strength || 0}`;
      n.outer.classList.toggle("ko", p.alive === false);
    }
  }

  setSelected(id) {
    this.selected = id;
    for (const [pid, n] of Object.entries(this.nodes)) n.sel.setAttribute("opacity", pid === id ? 1 : 0);
  }

  attack(from, to, dmg, missed, ko) {
    const a = this.pos[from], b = this.pos[to];
    if (!a || !b) return;
    if (this.nodes[from]) punch(this.nodes[from].b);
    const glove = el("circle", { cx: 0, cy: 0, r: 13, fill: "#e63946", stroke: "#14161f", "stroke-width": 3 }, this.fx);
    const ex = missed ? b.x + (Math.random() > 0.5 ? 70 : -70) : b.x;
    const ey = missed ? b.y - 60 : b.y - 5;
    const anim = glove.animate(
      [{ transform: `translate(${a.x}px, ${a.y - 5}px)` }, { transform: `translate(${ex}px, ${ey}px)` }],
      { duration: 280, easing: "ease-in", fill: "forwards" });
    anim.onfinish = () => {
      glove.remove();
      if (!missed && this.nodes[to]) restart(this.nodes[to].shake, "shake", 380);
      this.floatText(b.x, b.y - 70, missed ? "MISS" : ko ? `-${dmg} KO!` : `-${dmg}`, missed ? "#c9c6d6" : "#f06a5a");
    };
  }

  floatText(x, y, txt, color) {
    const t = el("text", { x: 0, y: 0, "text-anchor": "middle", fill: color, "font-size": 38, "font-weight": 800, class: "float" }, this.fx);
    t.textContent = txt;
    const a = t.animate(
      [{ transform: `translate(${x}px, ${y}px)`, opacity: 1 }, { transform: `translate(${x}px, ${y - 60}px)`, opacity: 0 }],
      { duration: 1000, easing: "ease-out", fill: "forwards" });
    a.onfinish = () => t.remove();
  }
}

// Little punch sound (board only)
let ac;
export function thump(strong = false) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(strong ? 140 : 180, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(50, ac.currentTime + 0.15);
    g.gain.setValueAtTime(strong ? 0.5 : 0.25, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.22);
  } catch (e) { /* no sound, no problem */ }
}
