// Family data model.
// A person: { id, name: {en, ka, fr}, gender: 'm'|'f'|'', birth, death, deceased, notes,
//             parents: [id, id], partners: [id, ...] }
// Dates are strings: 'YYYY-MM-DD', 'YYYY-MM' or 'YYYY'.

import { compareBirth } from './dates.js';

export const NAME_LANGS = ['en', 'ka', 'fr'];

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return 'p' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function normalizePerson(p) {
  const name = p.name || {};
  return {
    id: p.id || newId(),
    name: { en: name.en || '', ka: name.ka || '', fr: name.fr || '' },
    gender: p.gender === 'm' || p.gender === 'f' ? p.gender : '',
    birth: p.birth || '',
    death: p.death || '',
    deceased: !!p.deceased || !!p.death,
    notes: p.notes || '',
    parents: Array.isArray(p.parents) ? [...new Set(p.parents)].slice(0, 2) : [],
    partners: Array.isArray(p.partners) ? [...new Set(p.partners)] : [],
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
  partnersOf(id) {
    const p = this.get(id);
    return p ? p.partners.map((x) => this.get(x)).filter(Boolean) : [];
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
  }

  toJSON() { return this.data; }
}

// Names to show, in the order en / ka / fr, for the enabled languages.
// Identical names are shown once. Falls back to any name if none of the enabled ones exist.
export function nameLines(p, langs) {
  const out = [];
  for (const l of NAME_LANGS) {
    if (!langs[l]) continue;
    const n = (p.name[l] || '').trim();
    if (n && !out.includes(n)) out.push(n);
  }
  if (!out.length) {
    const any = NAME_LANGS.map((l) => (p.name[l] || '').trim()).find(Boolean);
    out.push(any || '?');
  }
  return out;
}

export function displayName(p, langs) {
  return nameLines(p, langs).join(' / ');
}
