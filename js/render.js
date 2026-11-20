// Draws the laid-out tree as SVG, with animated moves, pan and pinch/wheel zoom.

import { CARD_W, LINE_H, SUB_H, CARD_PAD_TOP } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const GEN_COLORS = ['#2f6fdb', '#159a7f', '#8048d8', '#d6335b', '#e07b1a', '#4f9a2a', '#2a8fb8', '#b5428f'];

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Puts text in an SVG text element, shortened with "…" if it is wider than maxWidth.
// (The full text stays in the card's tooltip.)
function fitText(t, text, maxWidth) {
  t.textContent = text;
  let len = text.length;
  while (len > 1 && t.getComputedTextLength() > maxWidth) {
    len--;
    t.textContent = text.slice(0, len).trimEnd() + '…';
  }
}

export function createTreeView(svg, { onSelect }) {
  const viewport = svg.querySelector('#viewport');
  const edgesG = svg.querySelector('#edges');
  const cardsG = svg.querySelector('#cards');
  const cardEls = new Map();
  let view = { x: 0, y: 0, k: 1 };
  let bounds = null;

  function applyView(animate) {
    viewport.style.transition = animate ? 'transform 0.6s ease' : 'none';
    viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  function fit(animate = true) {
    if (!bounds) return;
    const r = svg.getBoundingClientRect();
    const pad = 32;
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    const k = Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh, 1.1);
    const MIN_READABLE = 0.45;
    if (k < MIN_READABLE) {
      // Too big to read when fully fitted (e.g. on a phone): keep it readable, centered on the chosen person.
      view = { k: MIN_READABLE, x: r.width / 2 - bounds.focusX * MIN_READABLE, y: pad - bounds.minY * MIN_READABLE };
    } else {
      view = {
        k,
        x: (r.width - bw * k) / 2 - bounds.minX * k,
        y: Math.max(pad, (r.height - bh * k) / 2) - bounds.minY * k,
      };
    }
    applyView(animate);
  }

  function zoomAt(px, py, factor) {
    const k = Math.max(0.08, Math.min(4, view.k * factor));
    view.x = px - (px - view.x) * (k / view.k);
    view.y = py - (py - view.y) * (k / view.k);
    view.k = k;
    applyView(false);
  }

  function zoomCenter(factor) {
    const r = svg.getBoundingClientRect();
    const k = Math.max(0.08, Math.min(4, view.k * factor));
    view.x = r.width / 2 - (r.width / 2 - view.x) * (k / view.k);
    view.y = r.height / 2 - (r.height / 2 - view.y) * (k / view.k);
    view.k = k;
    applyView(true);
  }

  // opts: { layout, cardH, lines(pid) -> string[], years(pid) -> string, rootId, selected, deceased(pid) }
  function render(opts) {
    const { layout, cardH } = opts;
    bounds = layout.bounds;

    edgesG.replaceChildren();
    for (const e of layout.edges) el('path', { d: e.d, class: `edge ${e.cls}` }, edgesG);
    // Restart the fade-in so lines appear after the cards have moved.
    edgesG.classList.remove('fade-in');
    edgesG.getBoundingClientRect();
    edgesG.classList.add('fade-in');

    const keep = new Set();
    for (const c of layout.cards) {
      keep.add(c.key);
      let g = cardEls.get(c.key);
      const isNew = !g;
      if (isNew) {
        g = el('g', { class: 'card' }, cardsG);
        cardEls.set(c.key, g);
        g.style.opacity = '0';
        g.style.transition = 'none';
        g.style.transform = `translate(${c.x}px, ${c.y}px)`;
      }
      g.dataset.pid = c.pid;
      g.classList.toggle('root', c.pid === opts.rootId);
      g.classList.toggle('line', !!(opts.line && opts.line(c.pid)));
      g.classList.toggle('selected', c.pid === opts.selected);
      g.classList.toggle('partner', c.partner);
      g.classList.toggle('deceased', opts.deceased(c.pid));
      g.classList.toggle('dim', !!(opts.dim && opts.dim(c.pid)));
      g.replaceChildren();

      // Four short lines: first name, last name, then years and age (smaller, grey).
      const lines = opts.lines(c.pid); // [first names, last names]
      const subs = opts.years(c.pid);  // ['1994 –', '32 years old'] (age only for living people)
      const title = el('title', {}, g);
      title.textContent = [lines.join(' '), ...subs].filter(Boolean).join('\n');
      el('rect', { class: 'card-bg', width: CARD_W, height: cardH, rx: 6 }, g);
      el('rect', { class: 'card-bar', width: CARD_W, height: 4, rx: 2,
        fill: GEN_COLORS[((c.depth % GEN_COLORS.length) + GEN_COLORS.length) % GEN_COLORS.length] }, g);
      lines.forEach((line, i) => {
        const t = el('text', { x: CARD_W / 2, y: CARD_PAD_TOP + 12 + i * LINE_H, class: i ? 'card-name last' : 'card-name' }, g);
        fitText(t, line, CARD_W - 12);
      });
      subs.forEach((line, i) => {
        const t = el('text', { x: CARD_W / 2, y: CARD_PAD_TOP + 2 * LINE_H + 12 + i * SUB_H, class: 'card-years' }, g);
        fitText(t, line, CARD_W - 10);
      });

      // Small red triangle in the corner when something needs fixing (Edit mode only).
      const warning = opts.warn ? opts.warn(c.pid) : '';
      if (warning) {
        const w = el('g', { class: 'card-warn' }, g);
        el('title', {}, w).textContent = warning;
        el('path', { d: `M${CARD_W - 16},9 L${CARD_W - 7},24 L${CARD_W - 25},24 Z` }, w);
        el('text', { x: CARD_W - 16, y: 22 }, w).textContent = '!';
      }

      if (isNew) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          g.style.transition = '';
          g.style.opacity = '1';
        }));
      } else {
        g.style.opacity = '1';
        g.style.transform = `translate(${c.x}px, ${c.y}px)`;
      }
    }
    for (const [key, g] of cardEls) {
      if (keep.has(key)) continue;
      cardEls.delete(key);
      g.style.opacity = '0';
      g.style.pointerEvents = 'none';
      setTimeout(() => g.remove(), 450);
    }
  }

  // ---- Pointer interaction: drag to pan, pinch / wheel to zoom, tap to select ----
  const pointers = new Map();
  let moved = false;
  let downCard = null;

  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      moved = false;
      downCard = e.target.closest('.card');
    } else {
      moved = true;
    }
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (!moved && Math.hypot(dx, dy) < 4) return; // small jitter: still a tap
      moved = true;
      view.x += dx; view.y += dy;
      applyView(false);
      pointers.set(e.pointerId, cur);
    } else if (pointers.size === 2) {
      const [idA, idB] = [...pointers.keys()];
      const other = pointers.get(idA === e.pointerId ? idB : idA);
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(cur.x - other.x, cur.y - other.y);
      const r = svg.getBoundingClientRect();
      if (before > 0) zoomAt((cur.x + other.x) / 2 - r.left, (cur.y + other.y) / 2 - r.top, after / before);
      pointers.set(e.pointerId, cur);
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && !moved && downCard && e.type === 'pointerup') {
      onSelect(downCard.dataset.pid);
    }
    if (pointers.size === 0) downCard = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  return { render, fit, zoomIn: () => zoomCenter(1.25), zoomOut: () => zoomCenter(0.8) };
}
