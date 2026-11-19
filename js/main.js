import { t, setLangs, getLang, getLangs, UI_LANGS } from './i18n.js';
import { Family, nameLines, displayName } from './model.js';
import { yearsLabel, nextBirthday, formatDayMonth } from './dates.js';
import { encryptJson, decryptJson, isEncryptedFile } from './crypto.js';
import { buildDescendants, buildAncestors, layoutTree, layoutFamily, cardHeight } from './layout.js';
import { createTreeView } from './render.js';
import { renderDetails } from './details.js';
import { sampleFamily } from './sample.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SETTINGS_KEY = 'familytree.settings';
const DATA_URL = 'data/family.enc.json';

const state = {
  fam: null,
  pass: null,        // passphrase used to open/save the encrypted file (kept in memory only)
  encFile: null,     // encrypted file waiting for a passphrase
  dirty: false,
  demo: false,
  editMode: false,
  editing: false,
  selected: null,
  s: { uiLangs: [guessLang()], theme: 'auto', langs: { en: true, ka: false, fr: false }, mode: 'anc', gens: 4, root: null },
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
  $('#lockEmpty').hidden = true;
  $('#lockPass').hidden = false;
  $('#passInput').focus();
}

async function tryUnlock(pass) {
  $('#passError').hidden = true;
  $('#passBusy').hidden = false;
  try {
    const data = await decryptJson(state.encFile, pass);
    openFamily(data, { pass });
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
    $('#lockEmpty').hidden = false;
    $('#lockEmpty').innerHTML = '<p class="error">This page must be opened over https:// (or localhost).</p>';
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
    $('#lockEmpty').hidden = false;
  }
}

function openFamily(data, { pass = null, demo = false, edit = false } = {}) {
  state.fam = new Family(data);
  state.pass = pass;
  state.demo = demo;
  state.dirty = false;
  state.editMode = edit;
  state.selected = null;
  state.editing = false;
  const s = state.s;
  if (!state.fam.get(s.root)) s.root = (data.startPerson && state.fam.get(data.startPerson) ? data.startPerson : state.fam.people[0]?.id) || null;
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

function refresh({ fit = false } = {}) {
  const { fam, s } = state;
  if (!fam.get(s.root)) s.root = fam.people[0]?.id || null;
  saveSettings();

  // Sidebar controls
  const sel = $('#rootSelect');
  const sorted = [...fam.people].sort((a, b) => displayName(a, nameOpts()).localeCompare(displayName(b, nameOpts())));
  sel.innerHTML = '';
  for (const p of sorted) sel.add(new Option(displayName(p, nameOpts()) || t('noName'), p.id));
  sel.value = s.root || '';
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
  $('#gens').value = s.gens;
  $('#gensOut').textContent = s.gens;
  $$('[data-name-lang]').forEach((c) => { c.checked = !!s.langs[c.dataset.nameLang]; });
  $('#editToggle').checked = state.editMode;
  $('#editTools').hidden = !state.editMode;
  $('#demoBadge').hidden = !state.demo;
  $('#dirtyBadge').hidden = !state.dirty;

  drawTree(fit);
  drawBirthdays();
  drawDetails();
}

function drawTree(fit) {
  const { fam, s } = state;
  $('#emptyHint').hidden = fam.people.length > 0;
  const langs = nameOpts();
  const lines = Math.max(1, Object.values(langs).filter(Boolean).length);
  const cardH = cardHeight(lines);
  const layout = s.mode === 'desc'
    ? layoutTree(buildDescendants(fam, s.root, s.gens), cardH)
    // Family view: ancestors above, the person with partner(s) in the middle, their children below.
    : layoutFamily(buildDescendants(fam, s.root, 2), buildAncestors(fam, s.root, s.gens), cardH);
  treeView.render({
    layout,
    cardH,
    rootId: s.root,
    selected: state.selected,
    lines: (pid) => { const p = fam.get(pid); return p ? nameLines(p, langs) : ['?']; },
    years: (pid) => { const p = fam.get(pid); return p ? yearsLabel(p) : ''; },
    deceased: (pid) => !!fam.get(pid)?.deceased,
  });
  if (fit) requestAnimationFrame(() => treeView.fit(true));
}

function drawBirthdays() {
  const list = $('#birthdayList');
  const items = state.fam.people
    .map((p) => ({ p, nb: nextBirthday(p) }))
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
    const when = nb.days === 0 ? t('today') : nb.days === 1 ? t('tomorrow') : t('inDays', { n: nb.days });
    const name = document.createElement('span');
    name.textContent = displayName(p, nameOpts());
    const w = document.createElement('span');
    w.className = 'when';
    w.innerHTML = `${when}<br>${formatDayMonth(nb.date, getLang())} · ${t('turns', { n: nb.turns })}`;
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
  perspective: (id, mode) => {
    state.s.root = id;
    state.s.mode = mode;
    closeSidebar();
    refresh({ fit: true });
  },
  changed: (opts) => changed(opts),
  close: () => { state.selected = null; state.editing = false; refresh(); },
  setEditing: (v) => { state.editing = v; drawDetails(); },
  toast,
});

function drawDetails() {
  const box = $('#details');
  if (!state.selected || !state.fam.get(state.selected)) { box.hidden = true; return; }
  renderDetails(box, detailsCtx());
}

function select(id) {
  state.selected = id;
  refresh();
}

function changed({ soft = false } = {}) {
  state.dirty = true;
  $('#dirtyBadge').hidden = false;
  if (soft) {
    // Typing in the form: redraw tree and lists but keep the form (and its focus) as is.
    drawTree(false);
    drawBirthdays();
  } else {
    refresh();
  }
}

// ---------------------------------------------------------------- Saving & sharing

function askPassphrase() {
  const dlg = $('#passDialog');
  const p1 = $('#newPass1'), p2 = $('#newPass2'), err = $('#newPassError');
  p1.value = p2.value = '';
  err.hidden = true;
  dlg.showModal();
  p1.focus();
  return new Promise((resolve) => {
    const finish = (v) => {
      dlg.close();
      $('#passDialogForm').onsubmit = null;
      $('#newPassCancel').onclick = null;
      dlg.oncancel = null;
      resolve(v);
    };
    $('#passDialogForm').onsubmit = (e) => {
      e.preventDefault();
      if (p1.value.length < 12) { err.textContent = t('passTooShort'); err.hidden = false; return; }
      if (p1.value !== p2.value) { err.textContent = t('passMismatch'); err.hidden = false; return; }
      finish(p1.value);
    };
    $('#newPassCancel').onclick = () => finish(null);
    dlg.oncancel = () => finish(null);
  });
}

async function saveEncrypted() {
  if (!state.pass) {
    const p = await askPassphrase();
    if (!p) return;
    state.pass = p;
  }
  const file = await encryptJson({ ...state.fam.toJSON(), startPerson: state.s.root }, state.pass);
  download('family.enc.json', JSON.stringify(file));
  state.dirty = false;
  $('#dirtyBadge').hidden = true;
  toast(t('savedHelp'), 8000);
}

async function changePassphrase() {
  const p = await askPassphrase();
  if (!p) return;
  state.pass = p;
  await saveEncrypted();
}

async function copyShareLink() {
  if (!state.pass) { toast(t('noPassYet')); return; }
  const url = `${location.origin}${location.pathname}#k=${encodeURIComponent(state.pass)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'));
  } catch {
    prompt(t('copyLink'), url);
  }
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

  // Perspective
  $('#rootSelect').onchange = (e) => { state.s.root = e.target.value; refresh({ fit: true }); };
  $$('#modeSeg button').forEach((b) => { b.onclick = () => { state.s.mode = b.dataset.mode; refresh({ fit: true }); }; });
  $('#gens').oninput = (e) => { state.s.gens = +e.target.value; refresh({ fit: true }); };

  // Editing
  $('#editToggle').onchange = (e) => { state.editMode = e.target.checked; if (!state.editMode) state.editing = false; refresh(); };
  const addPerson = () => {
    state.editMode = true;
    const p = state.fam.add();
    if (!state.s.root) state.s.root = p.id;
    state.selected = p.id;
    state.editing = true;
    closeSidebar();
    changed();
    $('#details [data-name]')?.focus();
  };
  $('#btnAdd').onclick = addPerson;
  $('#btnAddFirst').onclick = addPerson;
  $('#btnSave').onclick = saveEncrypted;
  $('#btnPass').onclick = changePassphrase;
  $('#btnExport').onclick = () => download('family.json', JSON.stringify(state.fam.toJSON(), null, 2));
  $('#btnShare').onclick = copyShareLink;
  $('#btnLock').onclick = () => {
    if (state.dirty && !confirm(t('leaveWarning'))) return;
    state.dirty = false;
    location.replace(location.pathname + location.search);
  };

  // Birthdays
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
