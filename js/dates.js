// Date helpers. Dates are stored as 'YYYY-MM-DD', 'YYYY-MM' or 'YYYY'.

export function parseDate(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec((s || '').trim());
  if (!m) return null;
  return { y: +m[1], m: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null };
}

export function isValidDate(s) {
  if (!s) return true;
  const p = parseDate(s);
  if (!p) return false;
  if (p.m !== null && (p.m < 1 || p.m > 12)) return false;
  if (p.d !== null) {
    const dt = new Date(p.y, p.m - 1, p.d);
    if (dt.getMonth() !== p.m - 1) return false;
  }
  return true;
}

// Reads a date as people type it: day first, any separator.
//   "29 03 1994", "29.03.1994", "29-03-1994", "29/03/1994", "29.3.1994"  -> "1994-03-29"
//   "03.1994" -> "1994-03"     "1994" -> "1994"     (also accepts "1994-03-29")
// Returns '' for an empty field and null if it can't be read or isn't a real date.
export function parseUserDate(input) {
  const s = (input || '').trim();
  if (!s) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const sep = '[\\s./\\-]+';
  let m, out = null;
  if ((m = new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{4})$`).exec(s))) out = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  else if ((m = new RegExp(`^(\\d{1,2})${sep}(\\d{4})$`).exec(s))) out = `${m[2]}-${pad(m[1])}`;
  else if ((m = /^(\d{4})$/.exec(s))) out = m[1];
  else if ((m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s))) out = m[3] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : `${m[1]}-${pad(m[2])}`;
  return out && isValidDate(out) ? out : null;
}

// The stored date shown the way people type it: "29.03.1994", "03.1994", "1994".
export function toUserDate(stored) {
  const p = parseDate(stored);
  if (!p) return stored || '';
  const pad = (n) => String(n).padStart(2, '0');
  if (p.d) return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
  if (p.m) return `${pad(p.m)}.${p.y}`;
  return String(p.y);
}

export function compareBirth(a, b) {
  return (a.birth || '9999').localeCompare(b.birth || '9999');
}

export function yearsLabel(p) {
  const b = parseDate(p.birth);
  const d = parseDate(p.death);
  const by = b ? b.y : '?';
  if (d) return `${by} – ${d.y}`;
  if (p.deceased) return `${by} – ?`;
  return b ? `${by} –` : '';
}

const LOCALES = { en: 'en-GB', fr: 'fr-FR', ka: 'ka-GE' };

export function formatDate(s, lang) {
  const p = parseDate(s);
  if (!p) return s || '';
  const locale = LOCALES[lang] || 'en-GB';
  if (p.d) return new Date(p.y, p.m - 1, p.d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  if (p.m) return new Date(p.y, p.m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return String(p.y);
}

export function formatDayMonth(date, lang) {
  return date.toLocaleDateString(LOCALES[lang] || 'en-GB', { day: 'numeric', month: 'long' });
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// Age in whole years today (or at death). null if unknown.
export function age(p, today = new Date()) {
  const b = parseDate(p.birth);
  if (!b) return null;
  const end = parseDate(p.death);
  const ref = end ? new Date(end.y, (end.m || 12) - 1, end.d || 28) : today;
  if (!end && p.deceased) return null;
  let a = ref.getFullYear() - b.y;
  if (b.m && b.d) {
    if (ref.getMonth() + 1 < b.m || (ref.getMonth() + 1 === b.m && ref.getDate() < b.d)) a--;
  } else if (!end) {
    return null;
  }
  return a;
}

// Gap between two birth dates: { y, m, d, approx, firstIsOlder } (y/m/d always positive).
// Exact with two full dates; with only years it is approximate (years only). null if unknown.
export function birthGap(a, b) {
  const p = parseDate(a), q = parseDate(b);
  if (!p || !q) return null;
  if (p.m && p.d && q.m && q.d) {
    const ta = Date.UTC(p.y, p.m - 1, p.d), tb = Date.UTC(q.y, q.m - 1, q.d);
    const [o, tn] = ta <= tb ? [p, tb] : [q, ta];
    // Whole months from the older date (a 31st becomes the month's last day when needed),
    // then the days that are left.
    const after = (k) => {
      const y = o.y + Math.floor((o.m - 1 + k) / 12), m0 = (o.m - 1 + k) % 12;
      return Date.UTC(y, m0, Math.min(o.d, new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()));
    };
    const tOld = Math.min(ta, tb), tNew = Math.max(ta, tb);
    const n = tOld === ta ? q : p;
    let k = (n.y - o.y) * 12 + (n.m - o.m);
    if (after(k) > tn) k--;
    const d = Math.round((tNew - after(k)) / 86400000);
    return { y: Math.floor(k / 12), m: k % 12, d, approx: false, firstIsOlder: ta < tb, same: ta === tb };
  }
  return { y: Math.abs(q.y - p.y), m: 0, d: 0, approx: true, firstIsOlder: p.y < q.y, same: false };
}

// How old someone born on `birth` was on `date` (e.g. a parent when their child was born).
// Exact with two full dates; with only years it is approximate. null if unknown.
export function ageAtDate(birth, date) {
  const b = parseDate(birth), d = parseDate(date);
  if (!b || !d) return null;
  if (b.m && b.d && d.m && d.d) {
    let n = d.y - b.y;
    if (d.m < b.m || (d.m === b.m && d.d < b.d)) n--;
    return n >= 0 ? { n, approx: false } : null;
  }
  const n = d.y - b.y;
  return n >= 0 ? { n, approx: true } : null;
}

// Next birthday for people with a full birth date: { date, days, turns }.
// People who have died are included only when asked (for "would have been N").
export function nextBirthday(p, today = new Date(), { includeDeceased = false } = {}) {
  if ((p.deceased || p.death) && !includeDeceased) return null;
  const b = parseDate(p.birth);
  if (!b || !b.m || !b.d) return null;
  const t = startOfDay(today);
  const make = (y) => {
    // 29 February -> 28 February in non-leap years
    const d = new Date(y, b.m - 1, b.d);
    return d.getMonth() === b.m - 1 ? d : new Date(y, b.m - 1, 28);
  };
  let date = make(t.getFullYear());
  if (date < t) date = make(t.getFullYear() + 1);
  const days = Math.round((date - t) / 86400000);
  return { date, days, turns: date.getFullYear() - b.y };
}
