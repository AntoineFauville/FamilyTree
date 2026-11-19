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

// Descendants view: the chosen person (and partners), their children, grandchildren...
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

// Ancestors view: the chosen person, their parents, grandparents... (drawn downward).
export function buildAncestors(fam, rootId, maxGen) {
  const seen = new Set();
  const build = (id, depth) => {
    seen.add(id);
    const node = { people: [id], children: [], depth };
    if (depth + 1 < maxGen) {
      for (const p of fam.parentsOf(id)) {
        if (!seen.has(p.id)) node.children.push(build(p.id, depth + 1));
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

function makeKeyFor() {
  const used = new Map();
  return (pid) => {
    const c = used.get(pid) || 0;
    used.set(pid, c + 1);
    return c ? `${pid}#${c}` : pid;
  };
}

// Places a measured tree. Tree children are drawn below (down) or above (up, for ancestors).
// opts: { up, left, keyFor, skipRoot, genSign }
function placeTree(root, cardH, opts) {
  const { up = false, left = 0, keyFor, skipRoot = false, genSign = 1 } = opts;
  const cards = [];
  const edges = [];
  const levelH = cardH + LEVEL_GAP;
  const dir = up ? -1 : 1;

  const place = (n, l) => {
    n.y = dir * n.depth * levelH;
    let cx = l + (n.w - n.cw) / 2;
    for (const c of n.children) { place(c, cx); cx += c.w + GAP_SIB; }

    // Center the unit's anchor (couple midpoint, or the person) on its children.
    let ux;
    if (n.children.length) {
      const first = n.children[0].ux + CARD_W / 2;
      const last = n.children[n.children.length - 1].ux + CARD_W / 2;
      ux = (first + last) / 2 - anchorOffset(n);
      ux = Math.max(l, Math.min(ux, l + n.w - n.uw));
    } else {
      ux = l + (n.w - n.uw) / 2;
    }
    n.ux = ux;
    const y = n.y;

    n.people.forEach((pid, i) => {
      if (!(skipRoot && n === root)) {
        cards.push({ key: keyFor(pid), pid, x: ux + i * STEP, y, depth: genSign * n.depth, partner: i > 0 });
      }
      if (i > 0) {
        const x1 = ux + (i - 1) * STEP + CARD_W;
        edges.push({ cls: 'partner', d: `M${x1},${y + cardH / 2}H${x1 + GAP_PARTNER}` });
      }
    });

    if (!up) {
      // Lines down to children, starting between the parents when both are shown.
      for (const c of n.children) {
        const j = c.via ? n.people.indexOf(c.via) : -1;
        let ax, ay;
        if (j > 0) { ax = ux + j * STEP - GAP_PARTNER / 2; ay = y + cardH / 2; }
        else { ax = ux + CARD_W / 2; ay = y + cardH; }
        const midY = y + cardH + LEVEL_GAP / 2;
        edges.push({ cls: 'child', d: `M${ax},${ay}V${midY}H${c.ux + CARD_W / 2}V${c.y}` });
      }
    } else if (n.children.length) {
      // Ancestors: join the two parents with a line, and hang the child from its middle.
      const ps = [...n.children].sort((a, b) => a.ux - b.ux);
      const nx = ux + CARD_W / 2;
      const midY = y - LEVEL_GAP / 2;
      const py = ps[0].y;
      let ax, ay;
      if (ps.length === 2) {
        const x1 = ps[0].ux + CARD_W, x2 = ps[1].ux;
        edges.push({ cls: 'partner', d: `M${x1},${py + cardH / 2}H${x2}` });
        ax = (x1 + x2) / 2; ay = py + cardH / 2;
      } else {
        ax = ps[0].ux + CARD_W / 2; ay = py + cardH;
      }
      edges.push({ cls: 'child', d: `M${ax},${ay}V${midY}H${nx}V${y}` });
    }
  };
  place(root, left);
  return { cards, edges };
}

function boundsOf(cards, cardH, focusX) {
  return {
    minX: Math.min(...cards.map((c) => c.x)),
    minY: Math.min(...cards.map((c) => c.y)),
    maxX: Math.max(...cards.map((c) => c.x + CARD_W)),
    maxY: Math.max(...cards.map((c) => c.y + cardH)),
    // horizontal center of the chosen person (or couple), used to center small screens on them
    focusX,
  };
}

// Descendants view: the chosen person at the top, generations going down.
export function layoutTree(root, cardH) {
  if (!root) return { cards: [], edges: [], bounds: null };
  measure(root);
  const { cards, edges } = placeTree(root, cardH, { keyFor: makeKeyFor() });
  return { cards, edges, bounds: boundsOf(cards, cardH, root.ux + anchorOffset(root)) };
}

// Family view: ancestors above, the chosen person with partner(s) in the middle, children below.
// `family` is a descendants tree of the person (person + partners, then children);
// `ancestors` is the ancestors tree of the same person.
export function layoutFamily(family, ancestors, cardH) {
  if (!family) return { cards: [], edges: [], bounds: null };
  const keyFor = makeKeyFor();
  measure(family);
  const down = placeTree(family, cardH, { keyFor });

  measure(ancestors);
  // Dry run to find where the person lands, then shift so they line up with the middle row.
  placeTree(ancestors, cardH, { up: true, keyFor: () => '', skipRoot: true });
  const shift = family.ux - ancestors.ux;
  const up = placeTree(ancestors, cardH, { up: true, left: shift, keyFor, skipRoot: true });

  const cards = [...down.cards, ...up.cards];
  // Descendants below the middle row get negative "generation" numbers so they get their own colors.
  for (const c of down.cards) c.depth = -c.depth;
  return {
    cards,
    edges: [...down.edges, ...up.edges],
    bounds: boundsOf(cards, cardH, family.ux + anchorOffset(family)),
  };
}
