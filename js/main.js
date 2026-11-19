import { t, tFirst, setLangs, getLang, getLangs, UI_LANGS } from './i18n.js';
import { Family, nameLines, displayName, familyGroups, familyKey, familyHead, problemsOf, isEmptyPerson } from './model.js';
import { yearsLabel, nextBirthday, formatDayMonth, age } from './dates.js';
import { openFile, sealFile, createVault, addKey, removeKey, isEncryptedFile, MIN_KEY_LENGTH } from './crypto.js';
import { buildDescendants, layoutTree, cardHeight, CARD_W } from './layout.js';
import { createTreeView } from './render.js';
import { renderDetails } from './details.js';
import { sampleFamily } from './sample.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SETTINGS_KEY = 'familytree.settings';
const DATA_URL = 'data/family.enc.json';
const MAX_GENERATIONS = 12;

const state = {
  fam: null,
  encFile: null,     // encrypted file waiting for a key
  vault: null,       // data key + locked copies of it, one per access key (memory only)
  keyLabels: {},     // slot id -> name ("Beridze side"); saved inside the encrypted data
  keyRoles: {},      // slot id -> 'viewer' | 'editor'; saved inside the encrypted data
  canEdit: false,    // opened with an editor code: show the editing tools
  known: {},         // slot id -> key as typed, for keys known in this session (to build links)
  pass: null,        // key used to open the tree (for the share link)
  dirty: false,
  demo: false,
  editMode: false,
  editing: false,
  selected: null,
  // person: who we look from (highlighted); head: the ancestor the tree starts from.
  s: { uiLangs: [guessLang()], theme: 'auto', langs: { en: true, ka: false, fr: false }, person: null, head: null, family: '' },
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

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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

async function tryUnlock(pass) {
  $('#passError').hidden = true;
  if (!state.encFile) {
    $('#passError').textContent = t('noFile');
    $('#passError').hidden = false;
    return;
  }
  $('#passBusy').hidden = false;
  try {
    const { vault, data, slotId } = await openFile(state.encFile, pass);
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

  if (!window.crypto || !crypto.subtle) {
    $('#passError').textContent = 'This page must be opened over https:// (or localhost).';
    $('#passError').hidden = false;
    return;
  }

  let file = null;
  try {
    const r = await fetch(DATA_URL, { cache: 'no-store' });
    if (r.ok) file = await r.json();
  } catch { /* no file yet */ }

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
  state.known = slotId ? { [slotId]: pass } : {};
  state.pass = pass;
  state.demo = demo;
  state.dirty = false;
  // Editing tools only for an editor code. Files from before roles existed (no keyRoles):
  // every code could edit. A new tree, the demo or an opened file: you are the editor.
  const roles = data.keyRoles;
  state.canEdit = !slotId || !roles || Object.keys(roles).length === 0 || roles[slotId] === 'editor';
  state.editMode = edit && state.canEdit;
  state.selected = null;
  state.editing = false;
  const s = state.s;
  const fam = state.fam;
  // Always open on the view saved in the file (chosen when it was saved),
  // rather than whatever this browser looked at last time.
  if (fam.get(data.startPerson)) {
    s.person = data.startPerson;
    s.head = fam.get(data.startHead) ? data.startHead : null;
  } else if (!fam.get(s.person)) {
    s.person = fam.people[0]?.id || null;
    s.head = null;
  }
  $('#lock').hidden = true;
  $('#app').hidden = false;
  refresh({ fit: true });
}

// ---------------------------------------------------------------- Main view

let treeView;

function nameOpts() {
  const l = state.s.langs;
  return (l.en || l.ka || l.fr) ? l : { en: true };
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
  saveSettings();

  // Sidebar controls
  drawPerspective();
  $$('[data-name-lang]').forEach((c) => { c.checked = !!s.langs[c.dataset.nameLang]; });
  $('#editSection').hidden = !state.canEdit;
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
  const lines = Math.max(1, Object.values(langs).filter(Boolean).length);
  const cardH = cardHeight(lines);
  // Everyone descending from the chosen ancestor, each shown with their partner(s).
  const layout = layoutTree(buildDescendants(fam, s.head, MAX_GENERATIONS), cardH);
  // The direct line from that ancestor down to the person gets highlighted.
  const line = new Set([s.head, s.person].filter(Boolean));
  for (const a of fam.ancestorsOf(s.person)) {
    if (a.person.id === s.head || fam.isAncestor(s.head, a.person.id)) line.add(a.person.id);
  }
  // On small screens the view centers on the person rather than the top of the tree.
  const pc = layout.cards.find((c) => c.pid === s.person);
  if (pc && layout.bounds) layout.bounds.focusX = pc.x + CARD_W / 2;
  treeView.render({
    layout,
    cardH,
    rootId: s.person,
    line: (pid) => line.has(pid),
    selected: state.selected,
    lines: (pid) => {
      const p = fam.get(pid);
      if (!p) return ['?'];
      const lines = nameLines(p, langs);
      if (p.deceased) lines[0] = `† ${lines[0]}`; // cross before the name of people who have died
      return lines;
    },
    // "1994 – 32 years old" for living people with a full birth date; "1905 – 1980" otherwise.
    years: (pid) => {
      const p = fam.get(pid);
      if (!p) return '';
      const a = p.deceased ? null : age(p);
      return a === null ? yearsLabel(p) : `${yearsLabel(p)} ${tFirst('ageYears', { n: a })}`;
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

function drawBirthdays() {
  const list = $('#birthdayList');
  const includeDeceased = !!state.s.bdayDeceased;
  $('#bdayDeceased').checked = includeDeceased;
  const items = state.fam.people
    .map((p) => ({ p, nb: nextBirthday(p, new Date(), { includeDeceased }) }))
    .filter((x) => x.nb)
    .sort((a, b) => a.nb.days - b.nb.days)
    .slice(0, 8);
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

// ---- Saving & sharing

async function saveEncrypted() {
  if (!state.vault.slots.length) { toast(t('needKey')); openKeys(); return; }
  dropAllEmpty();
  refresh();
  const ids = new Set(state.vault.slots.map((s) => s.id));
  const keyLabels = Object.fromEntries(Object.entries(state.keyLabels).filter(([id]) => ids.has(id)));
  const keyRoles = Object.fromEntries(Object.entries(state.keyRoles).filter(([id]) => ids.has(id)));
  // The view you save with is what people see first when they open the tree.
  const file = await sealFile(state.vault, {
    ...state.fam.toJSON(), startPerson: state.s.person, startHead: state.s.head, keyLabels, keyRoles,
  });
  download('family.enc.json', JSON.stringify(file));
  state.dirty = false;
  $('#dirtyBadge').hidden = true;
  toast(t('savedHelp'), 8000);
}

function copyShareLink() {
  if (!state.pass) { toast(t('noPassYet')); openKeys(); return; }
  copyText(shareLink(state.pass), t('linkCopied'));
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

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;
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
  $('#btnKeys').onclick = openKeys;
  $('#keyAddForm').addEventListener('submit', onAddKey);
  $('#keysDone').onclick = () => $('#keysDialog').close();
  $('#btnExport').onclick = () => download('family.json', JSON.stringify(state.fam.toJSON(), null, 2));
  $('#btnShare').onclick = copyShareLink;
  $('#btnLock').onclick = () => {
    if (state.dirty && !confirm(t('leaveWarning'))) return;
    state.dirty = false;
    location.replace(location.pathname + location.search);
  };

  // Birthdays
  $('#bdayDeceased').onchange = (e) => { state.s.bdayDeceased = e.target.checked; saveSettings(); drawBirthdays(); };
  $('#birthdayList').onclick = (e) => {
    const li = e.target.closest('li[data-pid]');
    if (li) { closeSidebar(); select(li.dataset.pid); }
  };

  // Zoom
  $('#zoomIn').onclick = () => treeView.zoomIn();
  $('#zoomOut').onclick = () => treeView.zoomOut();
  $('#zoomFit').onclick = () => treeView.fit(true);

  // Mobile menu
  $('#btnMenu').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; };
  $('#scrim').onclick = closeSidebar;

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

boot();
