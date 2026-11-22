import { t, tFirst, setLangs, getLang, getLangs, UI_LANGS } from './i18n.js';
import { Family, cardNames, displayName, familyGroups, familyKey, familyHead, problemsOf, isEmptyPerson } from './model.js';
import { yearsLabel, nextBirthday, formatDayMonth, age } from './dates.js';
import { openFile, sealFile, openBox, createVault, addKey, removeKey, keyOpens, randomCode, rotateVault, normalizeKey, isEncryptedFile, MIN_KEY_LENGTH } from './crypto.js';
import { buildDescendants, layoutTree, cardHeight, CARD_W } from './layout.js';
import { createTreeView } from './render.js';
import { renderDetails } from './details.js';
import { sampleFamily } from './sample.js';
import * as cloud from './cloud.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SETTINGS_KEY = 'familytree.settings';
const DATA_URL = 'data/family.enc.json';
const SETUP_URL = 'data/setup.enc.json';
const MAX_GENERATIONS = 12;

const state = {
  fam: null,
  encFile: null,     // encrypted file waiting for a key
  setup: null,       // extra codes and starting views waiting to be merged into the tree (encrypted)
  setupApplied: [],  // ids of setups already saved inside the tree
  vault: null,       // data key + locked copies of it, one per access key (memory only)
  keyLabels: {},     // slot id -> name ("Beridze side"); saved inside the encrypted data
  keyRoles: {},      // slot id -> 'viewer' | 'editor'; saved inside the encrypted data
  keyStarts: {},     // slot id -> { person, head }: where that code's link opens
  canEdit: false,    // opened with an editor code: show the editing tools
  known: {},         // slot id -> key as typed, for keys known in this session (to build links)
  pass: null,        // key used to open the tree (for the share link)
  dirty: false,
  demo: false,
  editMode: false,
  editing: false,
  selected: null,
  // Online editing (Firebase): version this browser started from (null = not loaded),
  // signed-in user and their role ('admin' | 'editor' | null).
  cloud: { version: null, user: null, role: null, saving: false },
  // person: who we look from (highlighted); head: the ancestor the tree starts from.
  s: { uiLangs: [guessLang()], theme: 'auto', langs: { fr: true, ka: false }, person: null, head: null, family: '' },
};

function guessLang() {
  const l = (navigator.language || 'en').slice(0, 2);
  return UI_LANGS.includes(l) ? l : 'en';
}

// Settings (display preferences only, never family data) are remembered on this device.
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(state.s, saved, { langs: { ...state.s.langs, ...(saved.langs || {}) } });
    // Older versions stored a single interface language.
    if (typeof saved.ui === 'string' && !Array.isArray(saved.uiLangs)) state.s.uiLangs = [saved.ui];
    state.s.ui = undefined;
    // Older versions had a "root" person and ancestors/descendants modes.
    if (saved.root && !saved.person) state.s.person = saved.root;
    // Names are no longer written in English: English names on becomes French names on.
    state.s.views = undefined; // replaced by lastViews: it also remembered views nobody had chosen
    if (state.s.langs.en) state.s.langs.fr = true;
    state.s.langs = { fr: !!state.s.langs.fr, ka: !!state.s.langs.ka };
    state.s.root = state.s.mode = state.s.gens = undefined;
  } catch { /* storage unavailable */ }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.s)); } catch { /* ignore */ }
}

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- Lock screen

function keyFromHash() {
  return new URLSearchParams(location.hash.slice(1)).get('k');
}

function showPassForm() {
  $('#passInput').focus();
}

// The link can carry a view: #k=code&p=person&h=tree start (both are anonymous ids).
function viewFromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const person = q.get('p');
  return person ? { person, head: q.get('h') || null } : null;
}

// Opens the tree, adding the codes and starting views of data/setup.enc.json.
// Once an editor has saved the tree, they are part of it and the setup is ignored
// (so removing a code in Access codes really removes it).
async function openWithSetup(file, pass) {
  const setup = state.setup;
  if (!setup || !Array.isArray(file.keys)) return openFile(file, pass);
  const own = new Set(file.keys.map((k) => k.id));
  const extra = setup.keys.filter((k) => !own.has(k.id));
  const opened = await openFile({ ...file, keys: [...file.keys, ...extra] }, pass);
  const { vault, data } = opened;
  let box = null;
  if (!(data.setupApplied || []).includes(setup.id)) {
    try { box = await openBox(vault, setup); } catch { /* setup of another tree */ }
  }
  if (!box) {
    if (!own.has(opened.slotId)) throw new Error('removed code');
    vault.slots = vault.slots.filter((k) => own.has(k.id));
    return opened;
  }
  for (const part of ['keyLabels', 'keyRoles', 'keyStarts']) data[part] = { ...(box[part] || {}), ...(data[part] || {}) };
  data.setupApplied = [...(data.setupApplied || []), setup.id];
  return opened;
}

async function tryUnlock(pass) {
  $('#passError').hidden = true;
  if (!state.encFile) {
    $('#passError').textContent = t('noFile');
    $('#passError').hidden = false;
    return;
  }
  $('#passBusy').hidden = false;
  try {
    const { vault, data, slotId } = await openWithSetup(state.encFile, pass);
    openFamily(data, { vault, slotId, pass });
  } catch {
    $('#passError').textContent = t('wrongPass');
    $('#passError').hidden = false;
    $('#passInput').select();
  } finally {
    $('#passBusy').hidden = true;
  }
}

async function boot() {
  loadSettings();
  setLangs(state.s.uiLangs);
  wireStatic();
  syncLangSegs();
  drawCloud();

  if (!window.crypto || !crypto.subtle) {
    $('#passError').textContent = 'This page must be opened over https:// (or localhost).';
    $('#passError').hidden = false;
    return;
  }

  let file = null;
  if (cloud.cloudEnabled) {
    // Back from a sign-in email: finish signing in (the family code is not in that link).
    try {
      if (await cloud.completeEmailLink(() => prompt(t('confirmEmail')))) toast(t('signedInNowOpen'), 8000);
    } catch (e) { console.warn(e); toast(t('signInFailed')); }
    // The online tree is the current one; the GitHub copy is the fallback.
    try {
      const online = await cloud.loadTree();
      state.cloud.version = online ? online.version : 0;
      if (online && isEncryptedFile(online.file)) file = online.file;
    } catch (e) { console.warn('online tree unavailable, using the GitHub copy', e); }
  }
  if (!file) {
    try {
      const r = await fetch(DATA_URL, { cache: 'no-store' });
      if (r.ok) file = await r.json();
    } catch { /* no file yet */ }
  }

  try {
    const r = await fetch(SETUP_URL, { cache: 'no-store' });
    if (r.ok) state.setup = await r.json();
  } catch { /* no setup file */ }

  if (isEncryptedFile(file)) {
    state.encFile = file;
    showPassForm();
    const k = keyFromHash();
    if (k) { $('#passInput').value = k; tryUnlock(k); }
  } else {
    // Nothing published yet: offer the one-time setup (new tree / open a file).
    $('#ownerSetup').hidden = false;
  }
}

function openFamily(data, { vault = null, slotId = null, pass = null, demo = false, edit = false } = {}) {
  state.fam = new Family(data);
  state.vault = vault || createVault();
  state.keyLabels = { ...(data.keyLabels || {}) };
  state.keyRoles = { ...(data.keyRoles || {}) };
  // slot id -> { person, head }: where that code's link opens.
  state.keyStarts = { ...(data.keyStarts || {}) };
  state.setupApplied = [...(data.setupApplied || [])];
  state.known = slotId ? { [slotId]: pass } : {};
  state.slotId = slotId;
  state.rotated = false;
  state.pass = pass;
  state.demo = demo;
  state.dirty = false;
  // Editing tools only for an editor code. Files from before roles existed (no keyRoles):
  // every code could edit. A new tree, the demo or an opened file: you are the editor.
  const roles = data.keyRoles;
  state.canEdit = !slotId || !roles || Object.keys(roles).length === 0 || roles[slotId] === 'editor';
  state.editMode = edit && state.canEdit;
  if (state.canEdit) startCloud();
  state.selected = null;
  state.editing = false;
  const s = state.s;
  const fam = state.fam;
  // The starting view: the code's own (📍 in Access codes), else the one saved with the tree.
  const own = slotId && state.keyStarts[slotId];
  if (own && fam.get(own.person)) {
    state.startView = { person: own.person, head: fam.get(own.head) ? own.head : null };
  } else if (fam.get(data.startPerson)) {
    state.startView = { person: data.startPerson, head: fam.get(data.startHead) ? data.startHead : null };
  } else {
    state.startView = { person: fam.people[0]?.id || null, head: null };
  }
  // A shared link can carry its own view; it wins over the code's starting view.
  const linked = slotId && viewFromHash();
  if (linked && fam.get(linked.person)) {
    state.startView = { person: linked.person, head: fam.get(linked.head) ? linked.head : null };
  }
  // This browser remembers the last view chosen for each link, so people come back where they left off.
  state.viewKey = (slotId || 'file') + (linked ? `|${linked.person}|${linked.head || ''}` : '');
  const last = (s.lastViews || {})[state.viewKey];
  const view = last && fam.get(last.person) ? { person: last.person, head: fam.get(last.head) ? last.head : null } : state.startView;
  s.person = view.person;
  s.head = view.head;
  $('#lock').hidden = true;
  $('#app').hidden = false;
  refresh({ fit: true });
}

// ---------------------------------------------------------------- Main view

let treeView;

function nameOpts() {
  const l = state.s.langs;
  return (l.fr || l.ka) ? { fr: !!l.fr, ka: !!l.ka } : { fr: true };
}

// ---- Perspective: a person, and the ancestor their tree starts from.

function setPerson(id) {
  const { fam, s } = state;
  s.person = id;
  // Same tree if the new person also descends from the current start (e.g. a cousin);
  // otherwise switch to that person's own family line.
  if (!(s.head === id || fam.isAncestor(s.head, id))) s.head = fam.defaultHead(id);
}

function setHead(id) {
  state.s.head = id;
}

function ensureView() {
  const { fam, s } = state;
  if (!fam.get(s.person)) s.person = fam.people[0]?.id || null;
  if (s.person && !fam.get(s.head)) s.head = fam.defaultHead(s.person);
  if (!s.person) s.head = null;
}

// "grandfather (father's side)", "great-grandmother (mother's side)"...
function relationLabel({ person, gen, side }) {
  const g = person.gender === 'm' ? 'M' : person.gender === 'f' ? 'F' : '';
  const word = gen === 1 ? t('relParent' + g)
    : gen === 2 ? t('relGrand' + g)
    : gen === 3 ? t('relGreat' + g)
    : t('relUp', { n: gen });
  return gen === 1 ? word : `${word} (${t(side === 'pat' ? 'sidePat' : 'sideMat')})`;
}

function drawPerspective() {
  const { fam, s } = state;
  const opts = nameOpts();
  const psel = $('#personSelect');
  const sorted = [...fam.people].sort((a, b) => displayName(a, opts).localeCompare(displayName(b, opts)));
  psel.innerHTML = '';
  for (const p of sorted) psel.add(new Option(displayName(p, opts) || t('noName'), p.id));
  psel.value = s.person || '';

  const hsel = $('#headSelect');
  hsel.innerHTML = '';
  const person = fam.get(s.person);
  if (!person) return;
  const ancestors = fam.ancestorsOf(person.id);
  // The start chosen another way (e.g. "Start tree from here") may not be an ancestor: list it first.
  if (s.head !== person.id && !ancestors.some((a) => a.person.id === s.head) && fam.get(s.head)) {
    hsel.add(new Option(displayName(fam.get(s.head), opts), s.head));
  }
  for (const a of ancestors) hsel.add(new Option(`${displayName(a.person, opts)} — ${relationLabel(a)}`, a.person.id));
  hsel.add(new Option(`${displayName(person, opts)} — ${t('relSelf')}`, person.id));
  hsel.value = s.head || person.id;
}

function refresh({ fit = false } = {}) {
  const { s } = state;
  ensureView();
  // Remember this link's view in this browser (only the two ids, no names), but only once the
  // visitor has moved away from the starting view: otherwise they follow the starting view.
  if (state.viewKey && s.person) {
    const views = { ...(s.lastViews || {}) };
    const st = state.startView || {};
    const atStart = s.person === st.person && s.head === (st.head || state.fam.defaultHead(s.person));
    if (atStart) delete views[state.viewKey];
    else views[state.viewKey] = { person: s.person, head: s.head };
    s.lastViews = views;
  }
  saveSettings();

  // Sidebar controls
  drawPerspective();
  $$('[data-name-lang]').forEach((c) => { c.checked = !!s.langs[c.dataset.nameLang]; });
  $('#editSection').hidden = !state.canEdit;
  $('#toolEdit').hidden = !state.canEdit;
  drawCloud();
  $('#editToggle').checked = state.editMode;
  $('#editTools').hidden = !state.editMode;
  $('#demoBadge').hidden = !state.demo;
  $('#dirtyBadge').hidden = !state.dirty;

  drawFamilyFilter();
  drawTree(fit);
  drawBirthdays();
  drawDetails();
}

// Family filter: pick a last name to highlight that family and list its members.
function drawFamilyFilter() {
  const { fam, s } = state;
  const groups = familyGroups(fam, nameOpts());
  if (s.family && !groups.some((g) => g.key === s.family)) s.family = '';
  const sel = $('#familySelect');
  sel.innerHTML = '';
  sel.add(new Option(t('allFamilies'), ''));
  for (const g of groups) sel.add(new Option(`${g.label} (${g.members.length})`, g.key));
  sel.value = s.family || '';

  const group = groups.find((g) => g.key === s.family);
  $('#familyPanel').hidden = !group;
  const box = $('#familyMembers');
  box.innerHTML = '';
  if (!group) return;
  for (const p of group.members) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.classList.toggle('on', p.id === state.selected);
    chip.dataset.pid = p.id;
    chip.textContent = displayName(p, nameOpts());
    box.appendChild(chip);
  }
}

function inFamily(pid) {
  const p = state.fam.get(pid);
  return !!p && familyKey(p) === state.s.family;
}

function drawTree(fit) {
  const { fam, s } = state;
  $('#emptyHint').hidden = fam.people.length > 0;
  const langs = nameOpts();
  const cardH = cardHeight();
  // Everyone descending from the chosen ancestor, each shown with their partner(s).
  const layout = layoutTree(buildDescendants(fam, s.head, MAX_GENERATIONS), cardH);
  // The direct line from that ancestor down to the person gets highlighted.
  const line = new Set([s.head, s.person].filter(Boolean));
  for (const a of fam.ancestorsOf(s.person)) {
    if (a.person.id === s.head || fam.isAncestor(s.head, a.person.id)) line.add(a.person.id);
  }
  state.treePids = new Set(layout.cards.map((c) => c.pid)); // who is in this view (for birthdays)
  // On small screens the view centers on the person rather than the top of the tree.
  const pc = layout.cards.find((c) => c.pid === s.person);
  if (pc && layout.bounds) layout.bounds.focusX = pc.x + CARD_W / 2;
  state.lastLayout = layout; // for the PDF export
  treeView.render({
    layout,
    cardH,
    rootId: s.person,
    line: (pid) => line.has(pid),
    selected: state.selected,
    // Card lines: first name(s), then last name(s), in the chosen name languages.
    lines: (pid) => {
      const p = fam.get(pid);
      if (!p) return ['?'];
      const [first, last] = cardNames(p, langs);
      return [p.deceased ? `† ${first}` : first, last]; // cross before the name of people who have died
    },
    // Then the years ("1994 –", "1905 – 1980") and, for living people with a full birth date, the age.
    years: (pid) => {
      const p = fam.get(pid);
      if (!p) return [];
      const a = p.deceased ? null : age(p);
      return [yearsLabel(p), a === null ? '' : tFirst('ageYears', { n: a })];
    },
    deceased: (pid) => !!fam.get(pid)?.deceased,
    dim: (pid) => !!s.family && !inFamily(pid),
    // Red triangle with what to fix, only while editing (visitors never see it).
    warn: (pid) => {
      const p = fam.get(pid);
      return state.editMode && p ? problemsOf(p).map((k) => t(k)).join(' · ') : '';
    },
  });
  if (fit) requestAnimationFrame(() => treeView.fit(true));
}

// The close circle for birthdays: everyone in the tree being viewed, plus the chosen
// person's own close family on the other side: their partner's parents and siblings
// (and their own parents, siblings, partners and children, in case they're not in the tree).
function circleIds() {
  const { fam, s } = state;
  const ids = new Set(state.treePids || []);
  const add = (list) => list.forEach((p) => ids.add(p.id));
  if (fam.get(s.person)) {
    ids.add(s.person);
    add(fam.parentsOf(s.person));
    add(fam.siblingsOf(s.person));
    add(fam.childrenOf(s.person));
    for (const partner of fam.partnersOf(s.person)) {
      ids.add(partner.id);
      add(fam.parentsOf(partner.id));
      add(fam.siblingsOf(partner.id));
    }
  }
  return ids;
}

// ---- Birthdays into a calendar app: a .ics file with one yearly all-day event per person.

function birthdayPeople() {
  const circle = state.s.bdayAll ? null : circleIds();
  return state.fam.people.filter((p) => (!circle || circle.has(p.id)) && !p.deceased && /^\d{4}-\d{2}-\d{2}$/.test(p.birth));
}

function makeIcs(people) {
  // Calendar text escaping: backslash, comma and semicolon get a backslash; new lines become \n.
  const esc = (x) => String(x).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  // Lines longer than 75 bytes must be folded (continued on the next line after a space).
  const fold = (line) => {
    const out = [];
    let cur = '';
    for (const ch of line) {
      if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' '; }
      cur += ch;
    }
    out.push(cur);
    return out.join('\r\n');
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FamilyTree//Birthdays//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(tFirst('birthdays'))}`];
  for (const p of people) {
    const [y, m, d] = p.birth.split('-');
    const name = displayName(p, nameOpts());
    // 29 February: on the last day of February in other years.
    const rule = m === '02' && d === '29' ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY';
    lines.push('BEGIN:VEVENT', `UID:${p.id}-birthday@familytree`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${y}${m}${d}`, rule, `SUMMARY:${esc(`🎂 ${name} (${y})`)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${esc(`🎂 ${name}`)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function exportBirthdays() {
  const people = birthdayPeople();
  if (!people.length) { toast(t('noBirthdays')); return; }
  const url = URL.createObjectURL(new Blob([makeIcs(people)], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'birthdays.ics' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(t('calendarDone', { n: people.length }), 12000);
}

function drawBirthdays() {
  const list = $('#birthdayList');
  const includeDeceased = !!state.s.bdayDeceased;
  const everyone = !!state.s.bdayAll;
  $('#bdayDeceased').checked = includeDeceased;
  $('#bdayAll').checked = everyone;
  const person = state.fam.get(state.s.person);
  $('#bdayScopeHint').textContent = everyone || !person ? '' : t('bdayCircleHint', { name: displayName(person, nameOpts()) });
  const circle = everyone ? null : circleIds();
  const all = state.fam.people
    .filter((p) => !circle || circle.has(p.id))
    .map((p) => ({ p, nb: nextBirthday(p, new Date(), { includeDeceased }) }))
    .filter((x) => x.nb)
    .sort((a, b) => a.nb.days - b.nb.days);
  // Counter on the toolbar icon: living people with a birthday in the next 7 days.
  const soon = all.filter((x) => x.nb.days <= 7 && !x.p.deceased).length;
  $('#bdayBadge').hidden = !soon;
  $('#bdayBadge').textContent = soon;
  const items = all.slice(0, 12);
  if (!items.length) {
    list.innerHTML = `<li class="muted">${t('noBirthdays')}</li>`;
    return;
  }
  list.innerHTML = '';
  for (const { p, nb } of items) {
    const li = document.createElement('li');
    li.dataset.pid = p.id;
    li.classList.toggle('soon', nb.days <= 7);
    li.classList.toggle('deceased', !!p.deceased);
    const when = nb.days === 0 ? t('today') : nb.days === 1 ? t('tomorrow') : t('inDays', { n: nb.days });
    const name = document.createElement('span');
    name.textContent = `${p.deceased ? '† ' : ''}${displayName(p, nameOpts())}`;
    const w = document.createElement('span');
    w.className = 'when';
    const age = p.deceased ? t('wouldHaveBeen', { n: nb.turns }) : t('turns', { n: nb.turns });
    w.innerHTML = `${when}<br>${formatDayMonth(nb.date, getLang())} · ${age}`;
    li.append(name, w);
    list.appendChild(li);
  }
}

const detailsCtx = () => ({
  fam: state.fam,
  id: state.selected,
  langs: nameOpts(),
  editMode: state.editMode,
  editing: state.editing,
  select: (id) => select(id),
  // 'head': start the tree from this person; 'person': look from this person.
  perspective: (id, what) => {
    if (what === 'head') setHead(id); else setPerson(id);
    closeSidebar();
    refresh({ fit: true });
  },
  changed: (opts) => changed(opts),
  close: () => { dropIfEmpty(state.selected); state.selected = null; state.editing = false; refresh(); },
  setEditing: (v) => {
    state.editing = v;
    if (!v && dropIfEmpty(state.selected)) { state.selected = null; refresh(); return; }
    drawDetails();
  },
  toast,
});

function drawDetails() {
  const box = $('#details');
  if (!state.selected || !state.fam.get(state.selected)) { box.hidden = true; return; }
  renderDetails(box, detailsCtx());
}

function select(id) {
  if (state.selected !== id) dropIfEmpty(state.selected);
  state.selected = id;
  refresh();
}

// A person added by mistake and left empty ("?") is removed when you leave their form.
function dropIfEmpty(id) {
  const p = id && state.fam.get(id);
  if (!p || !isEmptyPerson(state.fam, p)) return false;
  state.fam.remove(id);
  state.dirty = true;
  return true;
}

function dropAllEmpty() {
  for (const p of [...state.fam.people]) dropIfEmpty(p.id);
}

function changed({ soft = false } = {}) {
  state.dirty = true;
  $('#dirtyBadge').hidden = false;
  if (soft) {
    // Typing in the form: redraw tree and lists but keep the form (and its focus) as is.
    drawFamilyFilter();
    drawTree(false);
    drawBirthdays();
  } else {
    refresh();
  }
}

// ---------------------------------------------------------------- Saving & sharing

const shareLink = (key) => `${location.origin}${location.pathname}#k=${encodeURIComponent(key)}`;

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    prompt(t('copyLink'), text);
  }
}

// ---- Access keys dialog: list, add and remove the keys that open the tree.

function keyName(id, i) {
  return state.keyLabels[id] || t('keyN', { n: i + 1 });
}

// A code's role. Files from before roles existed have none: every code could edit.
function roleOf(id) {
  return state.keyRoles[id] || (Object.keys(state.keyRoles).length ? 'viewer' : 'editor');
}

// Write every code's role down explicitly before changing one.
function fixRoles() {
  for (const s of state.vault.slots) state.keyRoles[s.id] = roleOf(s.id);
}

function editorCount() {
  return state.vault.slots.filter((s) => roleOf(s.id) === 'editor').length;
}

function drawKeyList() {
  const list = $('#keyList');
  list.innerHTML = '';
  state.vault.slots.forEach((slot, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'k-name';
    name.textContent = keyName(slot.id, i);
    li.appendChild(name);
    // View only / Can edit, changeable here.
    const role = document.createElement('select');
    role.className = 'k-role';
    for (const r of ['viewer', 'editor']) role.add(new Option(t(r === 'editor' ? 'roleEditor' : 'roleViewer'), r));
    role.value = roleOf(slot.id);
    role.onchange = () => {
      if (role.value === 'viewer' && roleOf(slot.id) === 'editor' && editorCount() === 1) {
        showKeyError(t('lastEditor'));
        role.value = 'editor';
        return;
      }
      fixRoles();
      state.keyRoles[slot.id] = role.value;
      showKeyError('');
      changed();
    };
    li.appendChild(role);
    // Where this code's link opens: set it to the person and tree start shown now.
    const start = document.createElement('button');
    start.type = 'button';
    const st = state.keyStarts[slot.id];
    const stP = st && state.fam.get(st.person), stH = st && state.fam.get(st.head);
    start.textContent = stP ? `📍 ${displayName(stP, nameOpts())}${stH ? ` · ${displayName(stH, nameOpts())}` : ''}` : `📍 ${t('setStartView')}`;
    start.title = t('setStartViewHint');
    start.onclick = () => {
      state.keyStarts[slot.id] = { person: state.s.person, head: state.s.head };
      changed();
      drawKeyList();
      toast(t('startViewSet'), 6000);
    };
    li.appendChild(start);
    if (state.known[slot.id]) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = t('copyKeyLink');
      copy.onclick = () => copyText(shareLink(state.known[slot.id]), t('linkCopied'));
      li.appendChild(copy);
    } else {
      const hint = document.createElement('span');
      hint.className = 'k-link';
      hint.textContent = t('keyLinkUnknown');
      li.appendChild(hint);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'danger';
    rm.textContent = '×';
    rm.title = t('remove');
    rm.onclick = () => {
      if (state.vault.slots.length === 1) { showKeyError(t('lastKey')); return; }
      if (roleOf(slot.id) === 'editor' && editorCount() === 1) { showKeyError(t('lastEditor')); return; }
      if (!confirm(t('confirmRemoveKey', { name: keyName(slot.id, i) }))) return;
      fixRoles();
      removeKey(state.vault, slot.id);
      delete state.keyLabels[slot.id];
      delete state.keyRoles[slot.id];
      delete state.keyStarts[slot.id];
      delete state.known[slot.id];
      changed();
      drawKeyList();
    };
    li.appendChild(rm);
    list.appendChild(li);
  });
}

function showKeyError(msg) {
  $('#keyError').textContent = msg;
  $('#keyError').hidden = !msg;
}

function openKeys() {
  showKeyError('');
  $('#keyLabel').value = '';
  $('#keyValue').value = '';
  $('#keyRole').value = 'viewer';
  drawKeyList();
  $('#keysDialog').showModal();
  (state.vault.slots.length ? $('#keysDone') : $('#keyLabel')).focus();
}

async function onAddKey(e) {
  e.preventDefault();
  const key = $('#keyValue').value.trim();
  if (key.length < MIN_KEY_LENGTH) { showKeyError(t('keyTooShort')); $('#keyValue').focus(); return; }
  showKeyError('');
  fixRoles();
  const id = await addKey(state.vault, key);
  // The very first code of a new tree is yours: it must be able to edit.
  state.keyRoles[id] = state.vault.slots.length === 1 ? 'editor' : $('#keyRole').value;
  const label = $('#keyLabel').value.trim();
  if (label) state.keyLabels[id] = label;
  state.known[id] = key;
  if (!state.pass) state.pass = key;
  $('#keyLabel').value = '';
  $('#keyValue').value = '';
  changed();
  drawKeyList();
  $('#keyLabel').focus();
}

// ---- Replace all codes: new encryption key and new codes (e.g. if a code became public).

let rotateRows = []; // [{ id, name, input }]
let rotateKept = ''; // the exact links the user last copied or downloaded

function openRotate() {
  if (cloud.cloudEnabled && !state.cloud.role) { showKeyError(t('signInToSave')); return; }
  const list = $('#rotateList');
  list.innerHTML = '';
  rotateKept = '';
  rotateRows = state.vault.slots.map((slot, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'k-name';
    name.textContent = `${keyName(slot.id, i)} (${t(roleOf(slot.id) === 'editor' ? 'roleEditor' : 'roleViewer')})`;
    const input = document.createElement('input');
    input.value = randomCode();
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.oninput = drawRotate;
    li.append(name, input);
    list.appendChild(li);
    return { id: slot.id, name: name.textContent, input };
  });
  $('#rotateError').hidden = true;
  drawRotate();
  $('#keysDialog').close();
  $('#rotateDialog').showModal();
}

const rotateLinks = () => rotateRows.map((r) => `${r.name}\n${shareLink(r.input.value.trim())}`).join('\n\n');

// The button only works once exactly these codes have been kept somewhere.
function drawRotate() {
  $('#rotateApply').disabled = rotateKept !== rotateLinks();
}

function rotateError(msg) {
  $('#rotateError').textContent = msg;
  $('#rotateError').hidden = !msg;
}

async function applyRotate() {
  const entries = rotateRows.map((r) => ({ id: r.id, code: r.input.value.trim() }));
  if (entries.some((e) => normalizeKey(e.code).length < MIN_KEY_LENGTH)) { rotateError(t('keyTooShort')); return; }
  if (new Set(entries.map((e) => normalizeKey(e.code))).size !== entries.length) { rotateError(t('rotateSame')); return; }
  const btn = $('#rotateApply');
  btn.disabled = true;
  rotateError(t('unlocking'));
  for (const e of entries) {
    if (await keyOpens(state.vault, e.code)) { rotateError(t('rotateOld', { code: e.code })); drawRotate(); return; }
  }
  fixRoles();
  const { vault, ids } = await rotateVault(entries);
  const moved = (o) => Object.fromEntries(Object.entries(o).filter(([id]) => ids[id]).map(([id, v]) => [ids[id], v]));
  state.keyLabels = moved(state.keyLabels);
  state.keyRoles = moved(state.keyRoles);
  state.keyStarts = moved(state.keyStarts);
  state.known = Object.fromEntries(entries.map((e) => [ids[e.id], e.code]));
  const mine = entries.find((e) => e.id === state.slotId);
  if (mine) { state.pass = mine.code; state.slotId = state.viewKey = ids[mine.id]; }
  state.vault = vault;
  state.rotated = true;
  rotateError('');
  $('#rotateDialog').close();
  changed();
  toast(t('rotateDone'), 12000);
}

// ---- Saving & sharing

// The encrypted file for the current tree (null if there is no code to lock it with yet).
async function sealCurrent() {
  if (!state.vault.slots.length) { toast(t('needKey')); openKeys(); return null; }
  dropAllEmpty();
  refresh();
  const ids = new Set(state.vault.slots.map((s) => s.id));
  const keyLabels = Object.fromEntries(Object.entries(state.keyLabels).filter(([id]) => ids.has(id)));
  const keyRoles = Object.fromEntries(Object.entries(state.keyRoles).filter(([id]) => ids.has(id)));
  // The view you save with is what people see first when they open the tree.
  return sealFile(state.vault, {
    ...state.fam.toJSON(), startPerson: state.s.person, startHead: state.s.head, keyLabels, keyRoles,
    keyStarts: Object.fromEntries(Object.entries(state.keyStarts).filter(([id]) => ids.has(id))),
    setupApplied: state.setupApplied,
  });
}

function markSaved() {
  state.dirty = false;
  $('#dirtyBadge').hidden = true;
}

// Save as a file (to publish with publish.cmd, or keep as a backup).
async function saveEncrypted() {
  const file = await sealCurrent();
  if (!file) return;
  download('family.enc.json', JSON.stringify(file));
  if (!cloud.cloudEnabled) markSaved(); // online, only Save online counts as saved
  toast(t(cloud.cloudEnabled ? 'downloadedBackup' : 'savedHelp'), 8000);
}

// ---- Online editing (Firebase)

// Save online: live for everyone straight away.
async function saveOnline() {
  if (!state.cloud.user) { toast(t('signInToSave')); return; }
  if (!state.cloud.role) { toast(t('notEditor')); return; }
  if (state.cloud.version === null) { toast(t('onlineUnavailable')); return; }
  if (state.cloud.saving) return; // already saving: a second click must not start a second save
  state.cloud.saving = true;
  const btn = $('#btnSaveOnline');
  btn.disabled = true;
  try {
    const file = await sealCurrent();
    if (!file) return;
    state.cloud.version = await cloud.saveTree(file, state.cloud.version);
    markSaved();
    if (state.rotated) {
      // The codes were replaced: the address must not keep the old one.
      state.rotated = false;
      if (state.pass) history.replaceState(null, '', `#k=${encodeURIComponent(state.pass)}`);
    }
    drawCloud();
    toast(t('savedOnline'), 6000);
  } catch (e) {
    if (e.message === 'conflict') {
      // Someone else saved since this page was opened: don't overwrite their work.
      if (confirm(t('conflict'))) {
        const file = await sealCurrent();
        if (file) download('family.enc.json', JSON.stringify(file));
      }
    } else {
      console.warn(e);
      toast(`${t('saveFailed')} (${e.code || e.message})`, 8000);
    }
  } finally {
    state.cloud.saving = false;
    drawCloud();
  }
}

function drawCloud() {
  const on = cloud.cloudEnabled;
  const { user, role, version } = state.cloud;
  $('#cloudBox').hidden = !on;
  $('#fileSaveBox').hidden = on;
  $('#btnDownload').hidden = !on;
  if (!on) return;
  $('#cloudSignedOut').hidden = !!user;
  $('#cloudSignedIn').hidden = !user;
  $('#cloudEmail').textContent = user ? user.email : '';
  $('#cloudNotEditor').hidden = !user || !!role;
  // Redrawing the page while a save is running must not re-enable the button.
  $('#btnSaveOnline').disabled = !user || !role || !!state.cloud.saving;
  $('#btnEditors').hidden = role !== 'admin';
  $('#btnHistory').hidden = !role;
  $('#cloudInfo').textContent = version === null ? t('onlineUnavailable') : version ? t('onlineVersion', { n: version }) : '';
}

// Sign-in tracking loads Firebase's code, so it only starts for editors (not for viewers).
let cloudStarted = false;
async function startCloud() {
  if (!cloud.cloudEnabled || cloudStarted) return;
  cloudStarted = true;
  try {
    await cloud.onUser(async (u) => {
      state.cloud.user = u;
      state.cloud.role = u ? await cloud.myRole() : null;
      drawCloud();
    });
  } catch (e) { console.warn('sign-in unavailable', e); }
}

// ---- Editors list (admins)

async function openEditors() {
  $('#editorError').hidden = true;
  $('#editorsDialog').showModal();
  await drawEditors();
}

async function drawEditors() {
  const list = $('#editorList');
  list.innerHTML = `<li class="muted">…</li>`;
  try {
    const editors = await cloud.listEditors();
    list.innerHTML = '';
    for (const ed of editors) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'k-name';
      name.textContent = ed.email;
      const role = document.createElement('select');
      role.className = 'k-role';
      role.add(new Option(t('roleEditor'), 'editor'));
      role.add(new Option(t('isAdmin'), 'admin'));
      role.value = ed.admin ? 'admin' : 'editor';
      role.onchange = async () => {
        if (ed.email === state.cloud.user?.email && role.value !== 'admin' && !confirm(t('dropOwnAdmin'))) { role.value = 'admin'; return; }
        try { await cloud.setEditor(ed.email, role.value === 'admin'); } catch (e) { showEditorError(e); }
        if (ed.email === state.cloud.user?.email) { state.cloud.role = await cloud.myRole(); drawCloud(); }
        drawEditors();
      };
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'danger';
      rm.textContent = '×';
      rm.title = t('remove');
      rm.onclick = async () => {
        if (ed.email === state.cloud.user?.email) { showEditorError(new Error(t('cantRemoveSelf'))); return; }
        if (!confirm(t('confirmRemoveEditor', { email: ed.email }))) return;
        try { await cloud.removeEditor(ed.email); } catch (e) { showEditorError(e); }
        drawEditors();
      };
      li.append(name, role, rm);
      list.appendChild(li);
    }
  } catch (e) { showEditorError(e); }
}

function showEditorError(e) {
  $('#editorError').textContent = e.message || String(e);
  $('#editorError').hidden = false;
}

async function onAddEditor(e) {
  e.preventDefault();
  const email = $('#editorEmail').value.trim().toLowerCase();
  if (!email) return;
  try {
    await cloud.setEditor(email, $('#editorAdmin').checked);
    $('#editorEmail').value = '';
    $('#editorAdmin').checked = false;
    $('#editorError').hidden = true;
  } catch (err) { showEditorError(err); }
  drawEditors();
}

// ---- History: every version saved online; load an older one to undo a mistake.

async function openHistory() {
  const list = $('#historyList');
  list.innerHTML = `<li class="muted">…</li>`;
  $('#historyDialog').showModal();
  try {
    const entries = await cloud.listHistory(30);
    list.innerHTML = '';
    for (const h of entries) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.className = 'k-name';
      const when = h.savedAt ? h.savedAt.toLocaleString(getLang() === 'ka' ? 'ka-GE' : getLang() === 'fr' ? 'fr-FR' : 'en-GB') : '';
      info.textContent = `v${h.version} · ${when}`;
      const by = document.createElement('span');
      by.className = 'k-link';
      by.textContent = h.savedBy || '';
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = t('restore');
      load.disabled = h.version === state.cloud.version;
      load.onclick = async () => {
        if (state.dirty && !confirm(t('leaveWarning'))) return;
        try {
          const { data } = await openFile(h.file, state.pass);
          const keep = { vault: state.vault, keyLabels: state.keyLabels, keyRoles: state.keyRoles, keyStarts: state.keyStarts };
          state.fam = new Family(data);
          Object.assign(state, keep); // keep the current codes; only the people change
          state.dirty = true;
          $('#historyDialog').close();
          refresh({ fit: true });
          toast(t('restored', { n: h.version }), 8000);
        } catch (err) { toast(`${t('saveFailed')} (${err.message})`); }
      };
      li.append(info, by, load);
      list.appendChild(li);
    }
    if (!entries.length) list.innerHTML = `<li class="muted">—</li>`;
  } catch (e) {
    list.innerHTML = '';
    toast(`${t('saveFailed')} (${e.code || e.message})`);
  }
}

function copyShareLink() {
  if (!state.pass) { toast(t('noPassYet')); openKeys(); return; }
  // The link opens on what is shown now: this person, and the tree from this ancestor.
  const { person, head } = state.s;
  const view = person ? `&p=${encodeURIComponent(person)}${head ? `&h=${encodeURIComponent(head)}` : ''}` : '';
  copyText(shareLink(state.pass) + view, t(state.canEdit ? 'linkCopiedEditor' : 'linkCopiedView'));
}

// ---------------------------------------------------------------- Wiring

// Theme: 'auto' follows the device setting; 'light' / 'dark' force it.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const th = state.s.theme;
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.themeOpt === (th || 'auto')));
  const dark = th === 'dark' || (th !== 'light' && darkQuery.matches);
  $$('.theme-btn').forEach((b) => { b.textContent = dark ? '☀' : '☾'; });
}

function setTheme(th) {
  state.s.theme = th;
  applyTheme();
  saveSettings();
}

// Quick button: flip whatever is currently shown.
function flipTheme() {
  const dark = state.s.theme === 'dark' || (state.s.theme !== 'light' && darkQuery.matches);
  setTheme(dark ? 'light' : 'dark');
}

function syncLangSegs() {
  const on = getLangs();
  $$('[data-ui-lang-seg] button').forEach((b) => {
    b.classList.toggle('on', on.includes(b.dataset.lang));
    b.setAttribute('aria-pressed', on.includes(b.dataset.lang));
  });
}

// ---- PDF of the current view: one page the exact size of the tree, printed by the browser
// (choose "Save as PDF"). Vector text, so it stays sharp at any size, Georgian included.

const PX_TO_MM = 25.4 / 96;

// Letters and digits only, accents removed: "Jean Dupont" -> "JeanDupont".
const fileWord = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]/g, '');

function pdfFileName() {
  const p = state.fam.get(state.s.person), h = state.fam.get(state.s.head);
  const first = (x) => x ? (x.first.fr || x.first.ka) : '';
  const last = (x) => x ? (x.last.fr || x.last.ka) : '';
  const who = fileWord(first(p)) || 'Person';
  const from = fileWord(first(h) + last(h)) || 'Family';
  return `familytree${who}To${from}`;
}

function exportPdf() {
  const layout = state.lastLayout;
  if (!layout || !layout.bounds) return;
  const { minX, minY, maxX, maxY } = layout.bounds;
  const pad = 40, titleH = 70;
  const vx = minX - pad, vy = minY - pad - titleH;
  const w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad + titleH;

  // Copy the tree as drawn now, without animations, highlights for editing, or cards fading out.
  const edges = $('#edges').cloneNode(true);
  edges.removeAttribute('id');
  edges.removeAttribute('class');
  const cards = $('#cards').cloneNode(true);
  cards.removeAttribute('id');
  for (const g of [...cards.querySelectorAll('.card')]) {
    if (g.style.pointerEvents === 'none') { g.remove(); continue; } // was leaving the view
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(g.style.transform || '');
    g.removeAttribute('style');
    if (m) g.setAttribute('transform', `translate(${m[1]} ${m[2]})`);
    g.classList.remove('selected', 'dim');
    g.querySelectorAll('.card-warn').forEach((x) => x.remove());
  }

  const p = state.fam.get(state.s.person), hd = state.fam.get(state.s.head);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const title = tFirst('pdfTitle', { person: p ? displayName(p, nameOpts()) : '', head: hd ? displayName(hd, nameOpts()) : '' });
  const date = new Date().toLocaleDateString(getLang() === 'ka' ? 'ka-GE' : getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const wMm = (w * PX_TO_MM).toFixed(1), hMm = (h * PX_TO_MM).toFixed(1);
  const css = $('link[rel="stylesheet"]').href;

  const html = `<!doctype html>
<html lang="${getLang()}" data-theme="light">
<head>
<meta charset="utf-8">
<title>${esc(pdfFileName())}</title>
<link rel="stylesheet" href="${esc(css)}">
<style>
  @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
  html, body { margin: 0; background: #fff; overflow: visible; height: auto; }
  svg { display: block; width: ${wMm}mm; height: ${hMm}mm; }
  .card { transition: none !important; opacity: 1 !important; }
  .card-bg { filter: none; }
  .pdf-title { font: 600 26px system-ui, "Segoe UI", "Noto Sans Georgian", sans-serif; fill: #1d2330; }
  .pdf-date { font: 14px system-ui, "Segoe UI", sans-serif; fill: #6b7280; }
  .hint { font: 15px system-ui, sans-serif; padding: 12px 16px; background: #e8f0fd; color: #1d2330; }
  @media print { .hint { display: none; } }
</style>
</head>
<body>
<div class="hint">${esc(tFirst('pdfHint'))}</div>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${w} ${h}">
  <text class="pdf-title" x="${vx + pad}" y="${vy + 42}">${esc(title)}</text>
  <text class="pdf-date" x="${vx + pad}" y="${vy + 64}">${esc(date)}</text>
  ${edges.outerHTML}
  ${cards.outerHTML}
</svg>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { toast(t('popupBlocked'), 8000); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---- Toolbar panels: one open at a time; the same button, a click on the tree or Esc closes it.

function openPanel(name) {
  const already = !$(`#panel-${name}`).hidden;
  closeSidebar();
  if (already) return;
  $(`#panel-${name}`).hidden = false;
  $(`.tool[data-panel="${name}"]`).classList.add('on');
}

function closeSidebar() {
  $$('#panels .panel').forEach((p) => { p.hidden = true; });
  $$('.tool[data-panel]').forEach((b) => b.classList.remove('on'));
}

function wireStatic() {
  treeView = createTreeView($('#tree'), { onSelect: (id) => select(id) });

  // Lock screen
  $('#passForm').addEventListener('submit', (e) => { e.preventDefault(); tryUnlock($('#passInput').value); });
  $('#btnDemo').onclick = () => openFamily(sampleFamily(), { demo: true });
  $('#btnNew').onclick = () => openFamily({ people: [] }, { edit: true });
  $('#fileOpen').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (isEncryptedFile(obj)) { state.encFile = obj; showPassForm(); }
      else if (Array.isArray(obj.people)) openFamily(obj, { edit: true });
      else throw new Error('bad');
    } catch { toast(t('badFile')); }
  });

  // Languages
  $$('[data-ui-lang-seg] button').forEach((b) => {
    // Each button switches its language on or off; at least one always stays on.
    b.onclick = () => {
      const lang = b.dataset.lang;
      const on = getLangs();
      if (on.includes(lang)) {
        if (on.length === 1) return;
        state.s.uiLangs = on.filter((l) => l !== lang);
      } else {
        state.s.uiLangs = [...on, lang];
      }
      setLangs(state.s.uiLangs);
      state.s.uiLangs = getLangs();
      syncLangSegs();
      saveSettings();
      if (state.fam) refresh();
    };
  });
  $$('[data-name-lang]').forEach((c) => {
    c.onchange = () => { state.s.langs[c.dataset.nameLang] = c.checked; refresh({ fit: true }); };
  });

  // Theme
  applyTheme();
  $$('#themeSeg button').forEach((b) => { b.onclick = () => setTheme(b.dataset.themeOpt); });
  $$('.theme-btn').forEach((b) => { b.onclick = flipTheme; });
  darkQuery.addEventListener('change', applyTheme);

  // Family filter
  $('#familySelect').onchange = (e) => { state.s.family = e.target.value; refresh(); };
  $('#familyMembers').onclick = (e) => {
    const chip = e.target.closest('[data-pid]');
    if (chip) { closeSidebar(); select(chip.dataset.pid); }
  };
  $('#btnFamilyTree').onclick = () => {
    const head = familyHead(state.fam, state.s.family);
    if (!head) return;
    setHead(head.id);
    closeSidebar();
    refresh({ fit: true });
  };

  // Perspective
  $('#personSelect').onchange = (e) => { setPerson(e.target.value); refresh({ fit: true }); };
  $('#headSelect').onchange = (e) => { setHead(e.target.value); refresh({ fit: true }); };
  $('#btnPdf').onclick = () => { closeSidebar(); exportPdf(); };
  // Lost? Back to the view this link opens on.
  $('#btnStartView').onclick = () => {
    if (!state.startView) return;
    state.s.person = state.startView.person;
    state.s.head = state.startView.head;
    state.selected = null;
    closeSidebar();
    refresh({ fit: true });
  };

  // Editing
  $('#editToggle').onchange = (e) => { state.editMode = e.target.checked; if (!state.editMode) state.editing = false; refresh(); };
  const addPerson = () => {
    state.editMode = true;
    const p = state.fam.add();
    if (!state.s.person) state.s.person = state.s.head = p.id;
    state.selected = p.id;
    state.editing = true;
    closeSidebar();
    changed();
    $('#details [data-first]')?.focus();
  };
  $('#btnAdd').onclick = addPerson;
  $('#btnAddFirst').onclick = addPerson;
  $('#btnSave').onclick = saveEncrypted;
  $('#btnDownload').onclick = saveEncrypted;

  // Online editing
  $('#btnSaveOnline').onclick = saveOnline;
  $('#btnGoogle').onclick = async () => {
    try { await cloud.signInWithGoogle(); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(`${t('signInFailed')} (${e.code || e.message})`); }
  };
  $('#emailLinkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#signInEmail').value.trim();
    try { await cloud.sendEmailLink(email); toast(t('linkSent', { email }), 10000); }
    catch (err) { toast(`${t('signInFailed')} (${err.code || err.message})`, 8000); }
  });
  $('#btnSignOut').onclick = () => cloud.signOutUser();
  $('#btnEditors').onclick = openEditors;
  $('#editorAddForm').addEventListener('submit', onAddEditor);
  $('#editorsDone').onclick = () => $('#editorsDialog').close();
  $('#btnHistory').onclick = openHistory;
  $('#historyDone').onclick = () => $('#historyDialog').close();
  $('#btnKeys').onclick = openKeys;
  $('#keyAddForm').addEventListener('submit', onAddKey);
  $('#keysDone').onclick = () => $('#keysDialog').close();
  $('#btnRotate').onclick = openRotate;
  $('#rotateCancel').onclick = () => $('#rotateDialog').close();
  $('#rotateApply').onclick = applyRotate;
  $('#rotateCopy').onclick = async () => {
    const text = rotateLinks();
    try { await navigator.clipboard.writeText(text); } catch { rotateError(t('rotateCopyFailed')); return; }
    rotateError('');
    rotateKept = text;
    drawRotate();
    $('#rotateCopy').textContent = `✓ ${t('rotateCopy')}`;
  };
  $('#rotateDownload').onclick = () => {
    const text = rotateLinks();
    download('family-links.txt', text, 'text/plain');
    rotateKept = text;
    drawRotate();
  };
  $('#btnExport').onclick = () => download('family.json', JSON.stringify(state.fam.toJSON(), null, 2));
  $('#btnShare').onclick = copyShareLink;
  $('#btnLock').onclick = () => {
    if (state.dirty && !confirm(t('leaveWarning'))) return;
    state.dirty = false;
    location.replace(location.pathname + location.search);
  };

  // Birthdays
  $('#bdayDeceased').onchange = (e) => { state.s.bdayDeceased = e.target.checked; saveSettings(); drawBirthdays(); };
  $('#btnCalendar').onclick = exportBirthdays;
  $('#bdayAll').onchange = (e) => { state.s.bdayAll = e.target.checked; saveSettings(); drawBirthdays(); };
  $('#birthdayList').onclick = (e) => {
    const li = e.target.closest('li[data-pid]');
    if (li) { closeSidebar(); select(li.dataset.pid); }
  };

  // Zoom
  $('#zoomIn').onclick = () => treeView.zoomIn();
  $('#zoomOut').onclick = () => treeView.zoomOut();
  $('#zoomFit').onclick = () => treeView.fit(true);

  // Toolbar panels
  $$('.tool[data-panel]').forEach((b) => { b.onclick = () => openPanel(b.dataset.panel); });
  $('#stage').addEventListener('pointerdown', closeSidebar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });

  // Another family link opened in the same tab only changes the part after #: reload to follow it.
  window.addEventListener('hashchange', () => location.reload());

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

boot();
