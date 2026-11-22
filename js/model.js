// Family data model.
// A person: { id, first: {fr, ka}, last: {fr, ka}, middle: {fr, ka}, gender: 'm'|'f'|'',
//             birth, death, deceased, notes, parents: [id, id], partners: [id, ...] }
// Names are written in French (Latin letters) and Georgian. Older files also had an
// English name: it is moved into the French one when that is empty.
// Dates are strings: 'YYYY-MM-DD', 'YYYY-MM' or 'YYYY'.

import { compareBirth } from './dates.js';

export const NAME_LANGS = ['fr', 'ka'];

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return 'p' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Older files stored one full name per language ("Levan Beridze"):
// the last word becomes the last name, the rest the first name.
function splitFullName(full) {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function normalizePerson(p) {
  // Read every language that may be in the file (including the old English one)...
  const first = {}, last = {}, middle = {};
  for (const l of ['en', 'fr', 'ka']) {
    if (p.first || p.last) {
      first[l] = ((p.first && p.first[l]) || '').trim();
      last[l] = ((p.last && p.last[l]) || '').trim();
    } else {
      ({ first: first[l], last: last[l] } = splitFullName(p.name && p.name[l]));
    }
    middle[l] = ((p.middle && p.middle[l]) || '').trim();
  }
  // ...then keep French and Georgian, filling empty French fields from English.
  const keep = (o) => ({ fr: o.fr || o.en || '', ka: o.ka || '' });
  return {
    id: p.id || newId(),
    first: keep(first),
    last: keep(last),
    // Other first names (middle names); shown in the details, not on the cards.
    middle: keep(middle),
    gender: p.gender === 'm' || p.gender === 'f' ? p.gender : '',
    birth: p.birth || '',
    death: p.death || '',
    deceased: !!p.deceased || !!p.death,
    notes: p.notes || '',
    parents: Array.isArray(p.parents) ? [...new Set(p.parents)].slice(0, 2) : [],
    partners: Array.isArray(p.partners) ? [...new Set(p.partners)] : [],
    // With several partners: the one they are with now (shown next to them, solid line).
    currentPartner: p.currentPartner || '',
  };
}

export class Family {
  constructor(data) {
    const people = ((data && data.people) || []).map(normalizePerson);
    this.data = { version: 1, people };
    this.reindex();
    // Drop broken links and make partner links symmetric.
    for (const p of people) {
      p.parents = p.parents.filter((id) => id !== p.id && this.map.has(id));
      p.partners = p.partners.filter((id) => id !== p.id && this.map.has(id));
    }
    for (const p of people) {
      if (p.currentPartner && !p.partners.includes(p.currentPartner)) p.currentPartner = '';
      for (const q of p.partners) {
        const other = this.map.get(q);
        if (!other.partners.includes(p.id)) other.partners.push(p.id);
      }
    }
  }

  reindex() { this.map = new Map(this.data.people.map((p) => [p.id, p])); }
  get people() { return this.data.people; }
  get(id) { return this.map.get(id); }

  childrenOf(id) {
    return this.people.filter((p) => p.parents.includes(id)).sort(compareBirth);
  }
  parentsOf(id) {
    const p = this.get(id);
    if (!p) return [];
    return p.parents.map((x) => this.get(x)).filter(Boolean)
      .sort((a, b) => (a.gender === 'm' ? -1 : 0) - (b.gender === 'm' ? -1 : 0));
  }
  // Partners in display order: the current partner first, then the others as entered.
  partnersOf(id) {
    const p = this.get(id);
    if (!p) return [];
    const list = p.partners.map((x) => this.get(x)).filter(Boolean);
    return list.sort((a, b) => (b.id === p.currentPartner) - (a.id === p.currentPartner));
  }

  // Mark (or unmark, with null) someone's current partner; it is mutual.
  setCurrentPartner(id, partnerId) {
    const p = this.get(id);
    if (!p) return;
    const old = p.currentPartner && this.get(p.currentPartner);
    if (old && old.currentPartner === id) old.currentPartner = '';
    p.currentPartner = partnerId || '';
    const q = partnerId && this.get(partnerId);
    if (q) {
      const theirOld = q.currentPartner && this.get(q.currentPartner);
      if (theirOld && theirOld.currentPartner === q.id) theirOld.currentPartner = '';
      q.currentPartner = id;
    }
  }
  siblingsOf(id) {
    const p = this.get(id);
    if (!p || !p.parents.length) return [];
    return this.people
      .filter((q) => q.id !== id && q.parents.some((x) => p.parents.includes(x)))
      .sort(compareBirth);
  }

  add(fields = {}) {
    const p = normalizePerson({ ...fields, id: newId() });
    this.people.push(p);
    this.map.set(p.id, p);
    return p;
  }

  remove(id) {
    this.data.people = this.people.filter((p) => p.id !== id);
    for (const p of this.people) {
      p.parents = p.parents.filter((x) => x !== id);
      p.partners = p.partners.filter((x) => x !== id);
      if (p.currentPartner === id) p.currentPartner = '';
    }
    this.reindex();
  }

  addParent(childId, parentId) {
    const c = this.get(childId);
    if (!c || childId === parentId || !this.get(parentId)) return false;
    if (c.parents.includes(parentId)) return true;
    if (c.parents.length >= 2) return false;
    if (this.isAncestor(childId, parentId)) return false; // would create a loop
    c.parents.push(parentId);
    return true;
  }
  removeParent(childId, parentId) {
    const c = this.get(childId);
    if (c) c.parents = c.parents.filter((x) => x !== parentId);
  }

  // All ancestors of a person: [{ person, gen, side }], gen 1 = parents, 2 = grandparents...
  // side: 'pat' (through the father) or 'mat' (through the mother).
  // Ordered father's side first, then by generation, men first.
  ancestorsOf(id) {
    const out = [];
    const seen = new Set([id]);
    const walk = (pid, gen, side) => {
      this.parentsOf(pid).forEach((par, i) => {
        if (seen.has(par.id)) return;
        seen.add(par.id);
        const s = side || (par.gender === 'f' ? 'mat' : par.gender === 'm' ? 'pat' : (i === 0 ? 'pat' : 'mat'));
        out.push({ person: par, gen, side: s });
        walk(par.id, gen + 1, s);
      });
    };
    walk(id, 1, null);
    const sideOrder = { pat: 0, mat: 1 };
    return out.sort((a, b) => sideOrder[a.side] - sideOrder[b.side] || a.gen - b.gen
      || (a.person.gender === 'm' ? -1 : 0) - (b.person.gender === 'm' ? -1 : 0));
  }

  // Where a person's tree starts by default: up the father's line as far as it goes.
  // Someone with no parents entered (yet) starts from their partner's family instead,
  // so they still appear in a full tree (as the partner).
  defaultHead(id) {
    const p = this.get(id);
    if (p && !p.parents.length) {
      const withFamily = this.partnersOf(id).find((q) => q.parents.length);
      if (withFamily) return this.defaultHead(withFamily.id);
    }
    let cur = id;
    const seen = new Set();
    while (!seen.has(cur)) {
      seen.add(cur);
      // Father first, but prefer a parent whose own parents are in the tree
      // (so a missing gender, or a parent with no family entered, doesn't stop the climb).
      const parents = this.parentsOf(cur);
      const up = parents.find((q) => q.parents.length) || parents[0];
      if (!up) break;
      cur = up.id;
    }
    return cur;
  }

  // Is `a` an ancestor of `b`?
  isAncestor(a, b, seen = new Set()) {
    const p = this.get(b);
    if (!p || seen.has(b)) return false;
    seen.add(b);
    return p.parents.some((x) => x === a || this.isAncestor(a, x, seen));
  }

  addPartner(a, b) {
    const pa = this.get(a), pb = this.get(b);
    if (!pa || !pb || a === b) return false;
    if (!pa.partners.includes(b)) pa.partners.push(b);
    if (!pb.partners.includes(a)) pb.partners.push(a);
    return true;
  }
  removePartner(a, b) {
    const pa = this.get(a), pb = this.get(b);
    if (pa) pa.partners = pa.partners.filter((x) => x !== b);
    if (pb) pb.partners = pb.partners.filter((x) => x !== a);
    if (pa && pa.currentPartner === b) pa.currentPartner = '';
    if (pb && pb.currentPartner === a) pb.currentPartner = '';
  }

  toJSON() { return this.data; }
}

// Names to show, in the order en / ka / fr, for the enabled languages.
// Identical names are shown once. Falls back to any name if none of the enabled ones exist.
// Full name with the other first names: "Jean Paul Marie Dupont" (for the details panel).
export function fullNameLong(p, lang) {
  return [p.first[lang], p.middle[lang], p.last[lang]].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

export function fullName(p, lang) {
  return [p.first[lang], p.last[lang]].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

// Picks one value per enabled language (en / ka / fr order), drops repeats,
// and falls back to any language if none of the enabled ones has a value.
function pick(langs, get) {
  const out = [];
  for (const l of NAME_LANGS) {
    if (!langs[l]) continue;
    const v = get(l);
    if (v && !out.includes(v)) out.push(v);
  }
  if (!out.length) {
    const any = NAME_LANGS.map(get).find(Boolean);
    if (any) out.push(any);
  }
  return out;
}

export function nameLines(p, langs) {
  const out = pick(langs, (l) => fullName(p, l));
  return out.length ? out : ['?'];
}

// For the cards: [first names, last names], each in the chosen languages ("Antoine / ანტუან").
export function cardNames(p, langs) {
  const first = pick(langs, (l) => (p.first[l] || '').trim()).join(' / ');
  const last = pick(langs, (l) => (p.last[l] || '').trim()).join(' / ');
  return first || last ? [first, last] : ['?', ''];
}

export function displayName(p, langs) {
  return nameLines(p, langs).join(' / ');
}

// ---- Family names (last names), for the family filter

// Same family whatever the spelling details: "Béridzé" and "beridze" match.
const fold = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

// Grouping key: the last name in the first language that has one (en, then ka, then fr).
export function familyKey(p) {
  const l = NAME_LANGS.find((x) => (p.last[x] || '').trim());
  return l ? fold(p.last[l]) : '';
}

export function lastNameLabel(p, langs) {
  return pick(langs, (l) => (p.last[l] || '').trim()).join(' / ');
}

// [{ key, label, members: [person] }] sorted by label.
export function familyGroups(fam, langs) {
  const groups = new Map();
  for (const p of fam.people) {
    const key = familyKey(p);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, label: lastNameLabel(p, langs), members: [] });
    groups.get(key).members.push(p);
  }
  for (const g of groups.values()) g.members.sort(compareBirth);
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// The person to start a family's tree from: the eldest member whose parents are not in that family.
export function familyHead(fam, key) {
  const members = fam.people.filter((p) => familyKey(p) === key).sort(compareBirth);
  const heads = members.filter((p) => !p.parents.some((id) => fam.get(id) && familyKey(fam.get(id)) === key));
  return (heads[0] || members[0] || null);
}

// ---- Things to fix, shown as a red triangle in Edit mode

// Keys of the problems found on a person (translated with t()): [] when all is fine.
export function problemsOf(p) {
  const out = [];
  if (!NAME_LANGS.some((l) => (p.first[l] || '').trim() || (p.last[l] || '').trim())) out.push('probNoName');
  if (!p.gender) out.push('probNoGender');
  if (p.birth && p.death && p.death < p.birth) out.push('probDates');
  return out;
}

// A person added by mistake: no name, no dates, no notes and not linked to anyone.
export function isEmptyPerson(fam, p) {
  return !NAME_LANGS.some((l) => (p.first[l] || '').trim() || (p.last[l] || '').trim())
    && !p.birth && !p.death && !p.notes.trim()
    && !p.parents.length && !p.partners.length && !fam.childrenOf(p.id).length;
}
