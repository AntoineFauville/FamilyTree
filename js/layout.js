// Builds the tree for a perspective and computes card positions.
// A node is a "unit": the main person plus (in descendants view) their partners,
// with child units below.

export const CARD_W = 184;
export const GAP_PARTNER = 18;
export const GAP_SIB = 30;
export const LEVEL_GAP = 64;
export const LINE_H = 18;
export const CARD_PAD_TOP = 18;
export const CARD_PAD_BOTTOM = 26;

export function cardHeight(lines) {
  return CARD_PAD_TOP + lines * LINE_H + CARD_PAD_BOTTOM;
}

// The tree from a starting person: them (and partners), their children, grandchildren...
export function buildDescendants(fam, rootId, maxGen) {
  const seen = new Set();
  const build = (id, depth) => {
    seen.add(id);
    const partners = fam.get(id).partners.filter((x) => fam.get(x));
    const node = { people: [id, ...partners], children: [], depth };
    if (depth + 1 < maxGen) {
      const kids = fam.childrenOf(id)
        .filter((k) => !seen.has(k.id))
        .map((k) => {
          const via = k.parents.find((x) => x !== id) || null;
          const idx = via ? partners.indexOf(via) : -1;
          return { k, via, order: idx < 0 ? 999 : idx };
        })
        .sort((a, b) => a.order - b.order); // already sorted by birth inside each group
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

const STEP = CARD_W + GAP_PARTNER;
const unitW = (n) => n.people.length * CARD_W + (n.people.length - 1) * GAP_PARTNER;
const anchorOffset = (n) => (n.people.length > 1 ? CARD_W + GAP_PARTNER / 2 : CARD_W / 2);

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

    n.people.forEach((pid, i) => {
      cards.push({ key: keyFor(pid), pid, x: ux + i * STEP, y, depth: n.depth, partner: i > 0 });
      if (i > 0) {
        const x1 = ux + (i - 1) * STEP + CARD_W;
        edges.push({ cls: 'partner', d: `M${x1},${y + cardH / 2}H${x1 + GAP_PARTNER}` });
      }
    });

    // Lines down to children, starting between the parents when both are shown.
    for (const c of n.children) {
      const j = c.via ? n.people.indexOf(c.via) : -1;
      let ax, ay;
      if (j > 0) { ax = ux + j * STEP - GAP_PARTNER / 2; ay = y + cardH / 2; }
      else { ax = ux + CARD_W / 2; ay = y + cardH; }
      const midY = y + cardH + LEVEL_GAP / 2;
      edges.push({ cls: 'child', d: `M${ax},${ay}V${midY}H${c.ux + CARD_W / 2}V${c.y}` });
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
