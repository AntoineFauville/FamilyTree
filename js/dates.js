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

// Next birthday for living people with a full birth date: { date, days, turns }.
export function nextBirthday(p, today = new Date()) {
  if (p.deceased || p.death) return null;
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
