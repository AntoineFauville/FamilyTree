// Right-hand panel: shows one person, or an editing form in edit mode.

import { t, getLang, getLangs } from './i18n.js';
import { nameLines, displayName, NAME_LANGS, problemsOf } from './model.js';
import { formatDate, age, parseUserDate, toUserDate } from './dates.js';

// "29 March 1994 / 29 მარტი 1994 / 29 mars 1994" in the interface language(s).
function datePreview(stored) {
  if (!stored) return '';
  const out = [];
  for (const l of getLangs()) {
    const s = formatDate(stored, l);
    if (!out.includes(s)) out.push(s);
  }
  return out.join(' / ');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ctx: { fam, id, langs, editMode, editing, select(id), perspective(id, mode),
//        changed(), close(), setEditing(bool), toast(msg) }
export function renderDetails(box, ctx) {
  const p = ctx.fam.get(ctx.id);
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  if (ctx.editMode && ctx.editing) renderForm(box, p, ctx);
  else renderView(box, p, ctx);
}

const nameOf = (ctx, p) => displayName(p, ctx.langs) || t('noName');

function renderView(box, p, ctx) {
  const lang = getLang();
  const a = age(p);
  let dates = '';
  if (p.birth) {
    dates += `<div>${esc(t('born'))}: ${esc(formatDate(p.birth, lang))}${a !== null && !p.deceased ? ` · ${esc(t('ageYears', { n: a }))}` : ''}</div>`;
  }
  if (p.death) {
    dates += `<div>${esc(t('died'))}: ${esc(formatDate(p.death, lang))}${a !== null ? ` · ${esc(t('agedYears', { n: a }))}` : ''}</div>`;
  } else if (p.deceased) {
    dates += `<div>${esc(t('deceased'))}</div>`;
  }

  const rel = (key, list) => list.length ? `
    <div class="d-rel"><h3>${esc(t(key))}</h3><div class="chips">
      ${list.map((q) => {
        // Several partners: ★ before the current one.
        const star = key === 'partners' && list.length > 1 && p.currentPartner === q.id ? '★ ' : '';
        return `<span class="chip" data-go="${q.id}" ${star ? `title="${esc(t('currentPartner'))}"` : ''}>${star}${esc(nameOf(ctx, q))}</span>`;
      }).join('')}
    </div></div>` : '';

  box.innerHTML = `
    <div class="d-head">
      <div class="d-names">${nameLines(p, { en: 1, ka: 1, fr: 1 }).map((n, i) => `<div>${i === 0 && p.deceased ? '† ' : ''}${esc(n)}</div>`).join('')}</div>
      <button class="d-close" data-act="close" title="${esc(t('close'))}">×</button>
    </div>
    <div class="d-dates">${dates}</div>
    <div class="d-actions">
      <button data-act="person">${esc(t('lookFromHere'))}</button>
      <button data-act="head">${esc(t('startTreeHere'))}</button>
      ${ctx.editMode ? `<button class="primary" data-act="edit">${esc(t('edit'))}</button>` : ''}
    </div>
    ${rel('parents', ctx.fam.parentsOf(p.id))}
    ${rel('partners', ctx.fam.partnersOf(p.id))}
    ${rel('siblings', ctx.fam.siblingsOf(p.id))}
    ${rel('children', ctx.fam.childrenOf(p.id))}
    ${p.notes ? `<div class="d-rel"><h3>${esc(t('notes'))}</h3><div class="d-notes">${esc(p.notes)}</div></div>` : ''}
  `;

  box.onclick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go) return ctx.select(go.dataset.go);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') ctx.close();
    if (act === 'person') ctx.perspective(p.id, 'person');
    if (act === 'head') ctx.perspective(p.id, 'head');
    if (act === 'edit') ctx.setEditing(true);
  };
  box.onchange = null;
  box.oninput = null;
}

function renderForm(box, p, ctx) {
  const fam = ctx.fam;
  const others = fam.people
    .filter((q) => q.id !== p.id)
    .sort((a, b) => nameOf(ctx, a).localeCompare(nameOf(ctx, b)));

  const relBlock = (kind, list, canAdd = true) => {
    const linked = new Set(list.map((q) => q.id));
    const options = others.filter((q) => !linked.has(q.id))
      .map((q) => `<option value="${q.id}">${esc(nameOf(ctx, q))}</option>`).join('');
    return `
      <div class="d-rel"><h3>${esc(t(kind))}</h3>
        <div class="chips">
          ${list.map((q) => `<span class="chip${kind === 'partners' && p.currentPartner === q.id ? ' on' : ''}" data-go="${q.id}">${
            // Several partners: a star marks the current one (click to set or clear).
            kind === 'partners' && list.length > 1
              ? `<button class="star" data-current="${q.id}" title="${esc(t('currentPartner'))}">${p.currentPartner === q.id ? '★' : '☆'}</button>`
              : ''}${esc(nameOf(ctx, q))}<button class="x" data-unlink="${kind}" data-id="${q.id}" title="${esc(t('remove'))}">×</button></span>`).join('')}
        </div>
        ${kind === 'partners' && list.length > 1 ? `<p class="muted small">${esc(t('currentPartnerHint'))}</p>` : ''}
        ${canAdd ? `<select data-link="${kind}">
          <option value="">${esc(t('addLink'))}</option>
          <option value="__new">${esc(t('newPerson'))}</option>
          ${options}
        </select>` : ''}
      </div>`;
  };

  const parents = fam.parentsOf(p.id);
  box.innerHTML = `
    <div class="d-head">
      <div class="d-names">${esc(nameOf(ctx, p))}</div>
      <button class="d-close" data-act="close" title="${esc(t('close'))}">×</button>
    </div>
    <div class="d-form">
      <div class="warn-box" data-problems hidden></div>
      ${NAME_LANGS.map((l) => `
        <div class="name-lang">${esc(t('lang' + l[0].toUpperCase() + l[1]))}</div>
        <div class="two">
          <label class="field"><span>${esc(t('firstName'))}</span>
            <input data-first="${l}" value="${esc(p.first[l])}" ${l === 'ka' ? 'lang="ka"' : ''}></label>
          <label class="field"><span>${esc(t('lastName'))}</span>
            <input data-last="${l}" value="${esc(p.last[l])}" ${l === 'ka' ? 'lang="ka"' : ''}></label>
        </div>`).join('')}
      <label class="field"><span>${esc(t('gender'))}</span>
        <select data-field="gender">
          <option value="">${esc(t('unknown'))}</option>
          <option value="m" ${p.gender === 'm' ? 'selected' : ''}>${esc(t('male'))}</option>
          <option value="f" ${p.gender === 'f' ? 'selected' : ''}>${esc(t('female'))}</option>
        </select></label>
      <div class="two">
        ${['birth', 'death'].map((k) => `
        <label class="field"><span>${esc(t(k))}</span>
          <input data-date="${k}" value="${esc(toUserDate(p[k]))}" placeholder="${esc(t('dateHint'))}" inputmode="numeric">
          <small class="date-preview" data-preview="${k}">${esc(datePreview(p[k]))}</small></label>`).join('')}
      </div>
      <label class="toggle"><input type="checkbox" data-field="deceased" ${p.deceased ? 'checked' : ''}><span>${esc(t('deceased'))}</span></label>
      <label class="field"><span>${esc(t('notes'))}</span><textarea data-field="notes">${esc(p.notes)}</textarea></label>

      ${relBlock('parents', parents, parents.length < 2)}
      ${relBlock('partners', fam.partnersOf(p.id))}
      ${relBlock('children', fam.childrenOf(p.id))}

      <div class="row" style="justify-content:space-between;margin-top:18px">
        <button class="danger" data-act="delete">${esc(t('delete'))}</button>
        <button class="primary" data-act="done">${esc(t('done'))}</button>
      </div>
    </div>
  `;

  // "To fix: gender not set..." at the top of the form, kept up to date while typing.
  const el = box.querySelector('[data-problems]');
  const showProblems = () => {
    if (!box.contains(el)) return; // the form was redrawn (e.g. for another person)
    const list = problemsOf(p);
    el.hidden = !list.length;
    el.innerHTML = list.length
      ? `⚠ ${esc(t('probTitle'))}<ul>${list.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>` : '';
  };
  showProblems();

  box.oninput = (e) => {
    const tg = e.target;
    if (tg.dataset.first) { p.first[tg.dataset.first] = tg.value; ctx.changed({ soft: true }); }
    else if (tg.dataset.last) { p.last[tg.dataset.last] = tg.value; ctx.changed({ soft: true }); }
    else if (tg.dataset.field === 'notes') { p.notes = tg.value; ctx.changed({ soft: true }); }
    else if (tg.dataset.date) {
      const v = parseUserDate(tg.value);
      const ok = v !== null;
      tg.closest('.field').classList.toggle('invalid', !ok);
      // Under the field: the date in words ("29 mars 1994"), or how to type it.
      box.querySelector(`[data-preview=${tg.dataset.date}]`).textContent = ok ? datePreview(v) : t('badDate');
      if (ok) {
        p[tg.dataset.date] = v;
        if (tg.dataset.date === 'death' && v) {
          p.deceased = true;
          box.querySelector('[data-field=deceased]').checked = true;
        }
        ctx.changed({ soft: true });
      }
    }
  };

  box.onchange = (e) => {
    const tg = e.target;
    if (tg.dataset.field === 'gender') { p.gender = tg.value; ctx.changed(); }
    else if (tg.dataset.field === 'deceased') { p.deceased = tg.checked; ctx.changed({ soft: true }); }
    else if (tg.dataset.link) {
      const kind = tg.dataset.link;
      let target = tg.value;
      if (!target) return;
      let created = null;
      if (target === '__new') {
        // A new child starts with this person's last names; easy to change afterwards.
        created = fam.add(kind === 'children' ? { last: { ...p.last } } : {});
        target = created.id;
      }
      let ok = true;
      if (kind === 'parents') ok = fam.addParent(p.id, target);
      if (kind === 'children') ok = fam.addParent(target, p.id);
      if (kind === 'partners') ok = fam.addPartner(p.id, target);
      if (!ok) {
        if (created) fam.remove(created.id);
        const child = kind === 'children' ? fam.get(target) : p;
        ctx.toast(child.parents.length >= 2 ? t('tooManyParents') : t('loopError'));
        tg.value = '';
        return;
      }
      // A new child of someone with exactly one partner gets that partner as second parent.
      if (kind === 'children' && created && p.partners.length === 1) fam.addParent(target, p.partners[0]);
      ctx.changed();
      if (created) ctx.select(created.id, true);
      else renderDetails(box, ctx);
    }
  };

  // Keep the "To fix" list current after every edit.
  const onInput = box.oninput, onChange = box.onchange;
  box.oninput = (e) => { onInput(e); showProblems(); };
  box.onchange = (e) => { onChange(e); showProblems(); };

  box.onclick = (e) => {
    const star = e.target.closest('[data-current]');
    if (star) {
      e.stopPropagation();
      const id = star.dataset.current;
      fam.setCurrentPartner(p.id, p.currentPartner === id ? null : id);
      ctx.changed();
      renderDetails(box, ctx);
      return;
    }
    const un = e.target.closest('[data-unlink]');
    if (un) {
      e.stopPropagation();
      const id = un.dataset.id;
      if (un.dataset.unlink === 'parents') fam.removeParent(p.id, id);
      if (un.dataset.unlink === 'children') fam.removeParent(id, p.id);
      if (un.dataset.unlink === 'partners') fam.removePartner(p.id, id);
      ctx.changed();
      renderDetails(box, ctx);
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) return ctx.select(go.dataset.go, true);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') ctx.close();
    if (act === 'done') ctx.setEditing(false);
    if (act === 'delete' && confirm(t('confirmDelete', { name: nameOf(ctx, p) }))) {
      fam.remove(p.id);
      ctx.changed();
      ctx.close();
    }
  };
}
