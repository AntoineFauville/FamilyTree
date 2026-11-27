// Builds the tree for a perspective and computes card positions.
// A node is a "unit": the main person plus (in descendants view) their partners,
// with child units below.

// Compact cards: first name / last name / years / age, each on its own short line.
export const CARD_W = 136;
export const GAP_PARTNER = 18;
export const GAP_SIB = 22;
export const LEVEL_GAP = 56;
export const LINE_H = 16;        // name lines
export const SUB_H = 14;         // years / age lines
export const CARD_PAD_TOP = 14;
export const CARD_PAD_BOTTOM = 8;

export function cardHeight() {
  return CARD_PAD_TOP + 2 * LINE_H + 2 * SUB_H + CARD_PAD_BOTTOM;
}

// The tree from a starting person: them (and partners), their children, grandchildren...
// Each unit is a row of cards: the person, then each partner. A partner's own other
// partners (e.g. a grandmother's second husband) come right after that partner.
// rel[i] says who card i is joined to: { of: index of the card it is joined to,
// order: which of the main person's partners it is (-1 for a partner's partner) }.
// opts.hideLoose: leave out companions and former partners who had no child with that person
// (a per-device choice); partners with a child together always stay, they are part of the genealogy.
export function buildDescendants(fam, rootId, maxGen, opts = {}) {
  const loose = (a, b) => opts.hideLoose && fam.partnerType(a, b) !== 'married' && !fam.haveChild(a, b);
  const seen = new Set();
  const build = (id, depth) => {
    seen.add(id);
    const people = [id];
    const rel = [null];
    fam.partnersOf(id).filter((q) => !loose(id, q.id)).forEach((q, k) => { // married first
      const qi = people.length;
      people.push(q.id);
      rel.push({ of: 0, order: k, type: fam.partnerType(id, q.id) });
      for (const r of fam.partnersOf(q.id)) {
        if (r.id === id || people.includes(r.id) || seen.has(r.id) || loose(q.id, r.id)) continue;
        people.push(r.id);
        rel.push({ of: qi, order: -1, type: fam.partnerType(q.id, r.id) });
      }
    });
    const node = { people, rel, children: [], depth };
    if (depth + 1 < maxGen) {
      const kids = [];
      const added = new Set();
      const addKid = (k, via) => {
        if (seen.has(k.id) || added.has(k.id)) return;
        added.add(k.id);
        const idx = via ? people.indexOf(via) : -1;
        kids.push({ k, via, order: idx < 0 ? 999 : idx });
      };
      // The person's children (with whichever partner)...
      for (const k of fam.childrenOf(id)) addKid(k, k.parents.find((x) => x !== id) || null);
      // ...and children a partner had with their other partner (half-brothers and sisters).
      rel.forEach((r, i) => {
        if (!r || r.of === 0) return;
        const q = people[r.of], other = people[i];
        for (const k of fam.childrenOf(other)) if (k.parents.includes(q) && !k.parents.includes(id)) addKid(k, other);
      });
      kids.sort((a, b) => a.order - b.order); // already sorted by birth inside each group
      for (const { k, via } of kids) {
        if (seen.has(k.id)) continue;
        const child = build(k.id, depth + 1);
        child.via = via;
        node.children.push(child);
      }
    }
    return node;
  };
  return fam.get(rootId) ? build(rootId, 0) : null;
}

// Line style of a couple: married solid (with ⚭), companion dotted, former partners dashed.
const TYPE_STYLE = { married: 'solid', companion: 'dot', former: 'dash' };
const PARTNER_LINE_GAP = 8; // vertical space between stacked partner lines
// Someone with several partners gets wider gaps between the cards,
// so the stacked partner lines can be seen clearly.
const gapOf = (n) => (n.people.length > 2 ? GAP_PARTNER * 2 : GAP_PARTNER);
const stepOf = (n) => CARD_W + gapOf(n);
const unitW = (n) => n.people.length * CARD_W + (n.people.length - 1) * gapOf(n);
const anchorOffset = (n) => (n.people.length > 1 ? CARD_W + gapOf(n) / 2 : CARD_W / 2);

function measure(n) {
  n.uw = unitW(n);
  n.cw = 0;
  n.children.forEach((c, i) => { measure(c); n.cw += c.w + (i ? GAP_SIB : 0); });
  n.w = Math.max(n.uw, n.cw);
}

// Lays out a tree from buildDescendants: the starting person at the top, generations going down.
// Returns { cards: [{ key, pid, x, y, depth, partner }], edges: [{ cls, d }], bounds }.
export function layoutTree(root, cardH) {
  const cards = [];
  const edges = [];
  if (!root) return { cards, edges, bounds: null };
  measure(root);

  const levelH = cardH + LEVEL_GAP;
  const used = new Map();
  const keyFor = (pid) => {
    const c = used.get(pid) || 0;
    used.set(pid, c + 1);
    return c ? `${pid}#${c}` : pid;
  };

  const place = (n, left) => {
    n.y = n.depth * levelH;
    let cx = left + (n.w - n.cw) / 2;
    for (const c of n.children) { place(c, cx); cx += c.w + GAP_SIB; }

    // Center the unit's anchor (couple midpoint, or the person) above its children.
    let ux;
    if (n.children.length) {
      const first = n.children[0].ux + CARD_W / 2;
      const last = n.children[n.children.length - 1].ux + CARD_W / 2;
      ux = (first + last) / 2 - anchorOffset(n);
      ux = Math.max(left, Math.min(ux, left + n.w - n.uw));
    } else {
      ux = left + (n.w - n.uw) / 2;
    }
    n.ux = ux;
    const y = n.y;

    // Each couple's line shows its kind: married solid (with ⚭), companion dotted, former
    // partners dashed; the lines to their children use the same style. Each line starts at
    // the main person and runs (behind the cards in between) to that partner; with several
    // partners the lines are stacked a few pixels apart so they can be told apart.
    const mainPartners = n.rel.filter((r) => r && r.of === 0).length;
    const stacked = mainPartners > 1;
    const styleOf = (i) => TYPE_STYLE[(n.rel[i] && n.rel[i].type) || 'married'] || 'solid';
    const lineY = (i) => {
      const r = n.rel[i];
      if (!stacked || !r) return y + cardH / 2;
      if (r.of === 0) return y + cardH / 2 + (r.order - (mainPartners - 1) / 2) * PARTNER_LINE_GAP;
      return y + cardH / 2 + ((mainPartners - 1) / 2 + 1) * PARTNER_LINE_GAP; // a partner's partner: just below
    };
    const STEP = stepOf(n);

    n.people.forEach((pid, i) => {
      cards.push({ key: keyFor(pid), pid, x: ux + i * STEP, y, depth: n.depth, partner: i > 0 });
      if (i > 0) {
        const from = n.rel[i] ? n.rel[i].of : 0;
        edges.push({ cls: `partner ${styleOf(i)}`, d: `M${ux + from * STEP + CARD_W},${lineY(i)}H${ux + i * STEP}` });
        // ⚭ (married) just above the line, in the gap before that partner's card.
        if ((n.rel[i] && n.rel[i].type) === 'married') {
          edges.push({ cls: 'mark', x: ux + i * STEP - gapOf(n) / 2, y: lineY(i) - 3, text: '⚭' });
        }
      }
    });

    // Lines down to children, starting from their parents' line when both are shown.
    for (const c of n.children) {
      const j = c.via ? n.people.indexOf(c.via) : -1;
      let ax, ay;
      if (j > 0) { ax = ux + j * STEP - gapOf(n) / 2; ay = lineY(j); }
      else { ax = ux + CARD_W / 2; ay = y + cardH; }
      // With several couples in a row, each couple's horizontal line sits a little lower
      // than the previous one, so the lines don't run on top of each other.
      const offset = n.people.length > 2 ? Math.min(24, j > 0 ? (j - 1) * 8 : -8) : 0;
      const midY = y + cardH + LEVEL_GAP / 2 + offset;
      edges.push({ cls: `child ${j > 0 ? styleOf(j) : 'solid'}`, d: `M${ax},${ay}V${midY}H${c.ux + CARD_W / 2}V${c.y}` });
    }
  };
  place(root, 0);

  const bounds = {
    minX: Math.min(...cards.map((c) => c.x)),
    minY: Math.min(...cards.map((c) => c.y)),
    maxX: Math.max(...cards.map((c) => c.x + CARD_W)),
    maxY: Math.max(...cards.map((c) => c.y + cardH)),
    // horizontal point to center on when the tree is too wide for a small screen
    focusX: root.ux + anchorOffset(root),
  };
  return { cards, edges, bounds };
}
