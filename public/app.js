// Patient chat: ChatGPT-style layout with a splash → intro → app transition.
const $ = (id) => document.getElementById(id);
const log = $('log');
const thread = $('thread');
const form = $('form');
const input = $('input');
const sendBtn = $('send');

const KEY = 'emedic-session';
const CHATS_KEY = 'emedic-chats';
const INTRO_KEY = 'emedic-intro-seen';
const NAME_KEY = 'emedic-name';
const BOT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5H7v14h9"/><path d="M7 12h3l1.2-2.8 1.9 5.6 1.2-2.8H17"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const PRECHAT = ['Myself', 'My child', 'Someone I care for'];
// The splash (with the intro) is removed once the app opens, so keep a copy for the About dialog.
const INTRO_HTML = $('introBody').innerHTML;

const newId = () => 's-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());

// ---------------- State ----------------
let sid = CP.store.get(KEY) || newId();
CP.store.set(KEY, sid);
let history = [];          // messages from the server, in order
const known = new Set();   // their ids
let seen = 0;              // count of server messages received
let pendingEcho = 0;       // user messages drawn locally, still to be echoed by the server
let busy = false;
let myName = CP.store.get(NAME_KEY) || '';
const EMAIL_KEY = 'emedic-email';
let myEmail = CP.store.get(EMAIL_KEY) || '';   // sent with each message so bookings can email the confirmation
let serverName;            // the name the server last reported for this chat (undefined = not checked yet)

// ---------------- Patient name (optional) ----------------
const cleanName = (raw) => String(raw || '').replace(/<[^>]*>?/g, '').replace(/[^\p{L}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30)
  .replace(/(^|[ -])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());

function setMyName(raw, { fromServer = false } = {}) {
  const name = cleanName(raw);
  if (name === myName) return;
  myName = name;
  CP.store.set(NAME_KEY, name);
  renderName();
  // The bot hears the new name with the next message; refresh the greeting now.
  if (!fromServer && !isEmpty()) renderAll();
}

function renderName() {
  $('heroName').textContent = myName ? ` ${myName}` : '';
  if (document.activeElement !== $('nameInput')) $('nameInput').value = myName;
  $('meAv').textContent = myName ? myName[0] : '?';
  $('meText').textContent = myName || 'Add your name & email';
  $('meBtn').classList.toggle('empty', !myName);
  $('meBtn').title = myEmail ? `Booking confirmations go to ${myEmail}` : 'Add your name and email in Settings';
}

// ---------------- Recent chats (this browser only) ----------------
function loadChats() {
  try { return JSON.parse(CP.store.get(CHATS_KEY) || '[]'); } catch { return []; }
}
function saveChats(list) { CP.store.set(CHATS_KEY, JSON.stringify(list.slice(0, 30))); }

function rememberChat(text) {
  const list = loadChats();
  const existing = list.find((c) => c.id === sid);
  const isTitleWorthy = !PRECHAT.includes(text);
  if (existing) {
    if (existing.title === 'New conversation' && isTitleWorthy) existing.title = text.slice(0, 60);
    existing.at = Date.now();
  } else {
    list.unshift({ id: sid, title: isTitleWorthy ? text.slice(0, 60) : 'New conversation', at: Date.now() });
  }
  list.sort((a, b) => b.at - a.at);
  saveChats(list);
  renderRecent();
}

const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

function renderRecent() {
  const el = $('recent');
  const list = loadChats();
  if (!list.length) { el.innerHTML = '<div class="empty-note">Your chats will show up here.</div>'; return; }
  el.innerHTML = list.map((c) => `
    <div class="chat-item${c.id === sid ? ' active' : ''}" data-id="${CP.esc(c.id)}">
      <button type="button" class="open" title="${CP.esc(c.title)}"><span>${CP.esc(c.title)}</span></button>
      <div class="chat-acts">
        <button type="button" class="rename" aria-label="Rename chat" title="Rename">${EDIT_ICON}</button>
        <button type="button" class="delete" aria-label="Delete chat" title="Delete">${TRASH_ICON}</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('.chat-item').forEach((item) => {
    const id = item.dataset.id;
    item.querySelector('.open').onclick = () => { switchTo(id); closeSide(); };
    item.querySelector('.rename').onclick = () => renameChat(item, id);
    item.querySelector('.delete').onclick = () => confirmDelete(item, id);
  });
}

// Rename in place: Enter saves, Escape cancels.
function renameChat(item, id) {
  const chat = loadChats().find((c) => c.id === id);
  if (!chat) return;
  const field = document.createElement('input');
  field.className = 'chat-rename';
  field.maxLength = 60;
  field.value = chat.title;
  item.replaceChildren(field);
  field.focus();
  field.select();
  let finished = false;
  const done = (save) => {
    if (finished) return;
    finished = true;
    const title = field.value.trim();
    if (save && title) {
      const list = loadChats();
      const c = list.find((x) => x.id === id);
      if (c) { c.title = title.slice(0, 60); c.custom = true; saveChats(list); }
    }
    renderRecent();
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') done(false);
  });
  field.addEventListener('blur', () => done(true));
}

// Ask "Delete?" inline instead of a browser pop-up.
function confirmDelete(item, id) {
  const acts = item.querySelector('.chat-acts');
  item.classList.add('confirming');
  acts.innerHTML = '<span class="ask">Delete?</span><button type="button" class="yes">Yes</button><button type="button" class="no">No</button>';
  acts.querySelector('.no').onclick = () => renderRecent();
  acts.querySelector('.yes').onclick = () => {
    saveChats(loadChats().filter((c) => c.id !== id));
    if (id === sid) newChat(); else renderRecent();
  };
}

// ---------------- Rendering ----------------
const isEmpty = () => document.body.classList.contains('empty');
const setEmpty = (on) => document.body.classList.toggle('empty', on);

function nearBottom() { return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160; }
function scrollDown(force) { if (force || nearBottom()) thread.scrollTop = thread.scrollHeight; }
function clearChips() { log.querySelectorAll('.chips').forEach((c) => c.remove()); }

function initials(name) {
  return String(name || 'RN').replace(/^nurse\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function renderMessage(m, { animate = true } = {}) {
  if (m.from === 'user' && pendingEcho > 0) { pendingEcho--; return; }
  clearChips();
  lockOld();
  const row = document.createElement('div');
  row.className = `row ${m.from === 'agent' ? 'bot' : m.from}${animate ? '' : ' static'}${m.emergency ? ' emergency' : ''}`;

  if (m.from === 'user') {
    row.innerHTML = `<div class="bubble">${CP.esc(m.text)}</div>`;
  } else if (m.from === 'system') {
    row.innerHTML = `<span>${CP.esc(m.text)}</span>`;
  } else {
    const av = m.from === 'agent'
      ? `<div class="av nurse">${CP.esc(initials(m.name))}</div>`
      : `<div class="av bot">${BOT_ICON}</div>`;
    let body = '';
    if (m.from === 'agent') body += `<div class="who-name">${CP.esc(m.name)} · EMedic Nurse</div>`;
    if (m.workflow) body += `<div class="tag">${CP.esc(m.workflow)}</div>`;
    // The greeting is created before we know their name, so personalize it here.
    const raw = m.id === 0 && myName ? m.text.replace(/^Hi! /, `Hi ${myName}! `) : m.text;
    const text = m.from === 'agent' ? `<p>${CP.esc(raw)}</p>` : CP.md(raw);
    const wrap = m.emergency ? 'card-alert' : m.update ? 'card-update' : m.declined ? 'card-declined' : '';
    body += wrap ? `<div class="${wrap}">${text}</div>` : text;
    if (m.general) body += '<div class="general-note">ℹ️ General health information, not from EMedic\'s library. Not a diagnosis.</div>';
    if (m.sources?.length) {
      body += `<div class="sources">${m.sources.map((s, i) => `<a href="/library/${CP.esc(s.doc || slug(s.title))}#${slug(s.heading)}" target="_blank" rel="noopener">📄 ${m.numbered ? `[${i + 1}] ` : ''}${CP.esc(s.heading)}</a>`).join('')}</div>`;
    }
    if (m.summary) body += CP.summaryHtml(m.summary);
    if (m.nurses?.length) body += nurseCardsHtml(m.nurses);
    if (m.providers?.length) body += providerCardsHtml(m.providers, m.providerTotal);
    if (m.form) body += formHtml(m.form, m.id);
    if (m.from === 'bot') body += `<div class="msg-actions"><button type="button" class="copy" title="Copy">${COPY_ICON}</button></div>`;
    row.innerHTML = `${av}<div class="content">${body}</div>`;
    row.querySelector('.copy')?.addEventListener('click', (e) => copyText(m.text, e.currentTarget));
    row.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => send(b.dataset.pick); });
    const form = row.querySelector('form.intake');
    if (form) wireForm(form);
    // With nurse cards, the names are buttons on the cards; only extra choices stay as chips.
    const options = (m.options || []).filter((o) => !m.nurses?.some((n) => n.name === o));
    if (options.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const o of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o;
        b.onclick = o === 'Use my location' ? () => sendLocation() : () => send(o);
        chips.appendChild(b);
      }
      row.querySelector('.content').appendChild(chips);
    }
  }
  log.appendChild(row);
}

// ---------------- Forms and nurse cards inside the chat ----------------
// Only the newest form / set of cards can be used; older ones are locked once the chat moves on.
function lockOld() {
  log.querySelectorAll('form.intake:not(.locked)').forEach((f) => {
    f.classList.add('locked');
    f.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.textContent = 'Sent ✓';
  });
  log.querySelectorAll('.nurse-cards:not(.locked)').forEach((c) => {
    c.classList.add('locked');
    c.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  });
}

function nurseCardsHtml(list) {
  const e = CP.esc;
  return `<div class="nurse-cards">${list.map((n) => `
    <div class="ncard">
      <div class="ncard-top"><span class="n-av">${e(n.initials)}</span><div><b>${e(n.name)}</b><small>${e(n.title)}</small></div></div>
      <div class="n-meta">Video visits · Speaks ${e(n.languages.join(', '))}${n.speaksYourLanguage ? ' <span class="n-badge">Your language</span>' : ''}</div>
      <div class="n-tags">${n.specialties.map((t) => `<span>${e(t)}</span>`).join('')}</div>
      ${n.next ? `<div class="n-next">Next opening: <b>${e(n.next)}</b></div>` : ''}
      <button type="button" class="n-pick" data-pick="${e(n.name)}">Choose ${e(n.name.split(' ')[0])}</button>
    </div>`).join('')}</div>`;
}

// Real clinicians from the NPI Registry: who and where only (no phone numbers).
function providerCardsHtml(list, total) {
  const e = CP.esc;
  const initials = (n) => n.split(' ').filter((w) => !/\.$/.test(w)).map((w) => w[0]).join('').slice(0, 2);
  return `<div class="provider-cards">${list.map((p) => `
    <div class="pcard">
      <div class="ncard-top"><span class="p-av">${e(initials(p.name))}</span><div><b>${e(p.name)}</b><small>${e(p.credential || 'Licensed clinician')}</small></div></div>
      <div class="p-spec">${e(p.specialty)}</div>
      <div class="p-addr">${e(p.address)}</div>
      <div class="p-links"><a href="${e(p.mapUrl)}" target="_blank" rel="noopener">Map</a><a href="${e(p.registryUrl)}" target="_blank" rel="noopener">NPI record</a></div>
    </div>`).join('')}</div>
    <div class="p-source">Source: U.S. NPI Registry (CMS), public data${total > list.length ? ` · showing ${list.length} of ${total}` : ''}. A listing isn't a recommendation.</div>`;
}

function formHtml(f, mid) {
  const e = CP.esc;
  const today = new Date().toISOString().slice(0, 10);
  const field = (x) => {
    const id = `f${mid}-${x.name}`;
    const show = x.showIf ? ` data-show-field="${e(x.showIf.field)}" data-show-not="${e(x.showIf.not)}"` : '';
    if (x.type === 'checkbox') {
      return `<label class="f-check"${show}><input type="checkbox" name="${e(x.name)}"${x.value ? ' checked' : ''}${x.required ? ' required' : ''}><span>${e(x.label)}</span></label>`;
    }
    const common = `id="${id}" name="${e(x.name)}"${x.required ? ' required' : ''}${x.placeholder ? ` placeholder="${e(x.placeholder)}"` : ''}${x.autocomplete ? ` autocomplete="${e(x.autocomplete)}"` : ''}`;
    let input;
    if (x.type === 'select') {
      const opts = x.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
      input = `<select ${common}>${opts.length > 1 ? '<option value="">Choose…</option>' : ''}${opts.map((o) => `<option value="${e(o.value)}"${o.value === x.value ? ' selected' : ''}>${e(o.label)}</option>`).join('')}</select>`;
    } else if (x.type === 'textarea') {
      input = `<textarea ${common} rows="2" maxlength="300">${e(x.value || '')}</textarea>`;
    } else {
      input = `<input ${common} type="${e(x.type)}" value="${e(x.value || '')}"${x.type === 'date' ? ` max="${today}"` : ''} maxlength="120">`;
    }
    return `<div class="f-field${x.half ? ' half' : ''}"${show}><label for="${id}">${e(x.label)}${x.required ? '' : ' <span class="f-opt">optional</span>'}</label>${input}</div>`;
  };
  return `<form class="intake" novalidate>
    <div class="f-head">${e(f.title || 'Details')}</div>
    ${f.error ? `<div class="f-err" role="alert">${e(f.error)}</div>` : ''}
    <div class="f-grid">${f.fields.map(field).join('')}</div>
    <div class="f-foot"><button type="submit">${e(f.submit || 'Continue')}</button>${f.note ? `<span class="f-note">${e(f.note)}</span>` : ''}</div>
  </form>`;
}

function wireForm(form) {
  // Show/hide fields that depend on another (e.g. member ID only with insurance).
  const sync = () => form.querySelectorAll('[data-show-field]').forEach((el) => {
    const ctl = form.elements[el.dataset.showField];
    el.hidden = Boolean(ctl) && ctl.value === el.dataset.showNot;
  });
  form.addEventListener('change', sync);
  sync();
  // Clear a field's red outline as soon as it's fixed.
  const clearMark = (ev) => ev.target.closest('.f-invalid')?.classList.remove('f-invalid');
  form.addEventListener('input', clearMark);
  form.addEventListener('change', clearMark);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (form.classList.contains('locked')) return;
    // Quick check for empty required fields; the server checks everything else.
    const missing = [...form.querySelectorAll('[required]')].filter((el) => !el.closest('[hidden]') && (el.type === 'checkbox' ? !el.checked : !el.value.trim()));
    form.querySelectorAll('.f-invalid').forEach((el) => el.classList.remove('f-invalid'));
    if (missing.length) {
      missing.forEach((el) => (el.closest('.f-field, .f-check') || el).classList.add('f-invalid'));
      missing[0].focus();
      return;
    }
    const values = {};
    for (const el of form.elements) {
      if (!el.name || el.closest('[hidden]')) continue;
      values[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
    send(`📋 Visit details sent: ${[values.fullName, values.insurance].filter(Boolean).join(' · ')}`, { form: values });
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text.replace(/\*\*/g, ''));
    btn.innerHTML = CHECK_ICON;
    setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1500);
  } catch { /* clipboard blocked */ }
}

function renderAll() {
  log.innerHTML = '';
  const echo = pendingEcho;
  pendingEcho = 0;
  history.forEach((m) => renderMessage(m, { animate: false }));
  pendingEcho = echo;
}

function setStatus(status, agentName) {
  $('dot').className = 'dot ' + (status === 'bot' ? '' : status);
  $('status').classList.toggle('live', status !== 'bot');
  $('statusText').textContent = status === 'waiting' ? 'Connecting you to a nurse…'
    : status === 'human' ? `Live with ${agentName || 'a nurse'}` : 'Virtual care assistant';
}

function apply(data) {
  const fresh = [];
  for (const m of data.messages) {
    if (known.has(m.id)) continue;
    known.add(m.id);
    history.push(m);
    fresh.push(m);
  }
  seen = Math.max(seen, data.total);
  setStatus(data.status, data.agentName);
  // They just told the bot their name in chat ("my name is David"). Only a *change* counts,
  // so an older name stored on the server never overwrites one they edited here.
  if (serverName === undefined) serverName = data.name ?? null;
  else if ((data.name ?? null) !== serverName) {
    serverName = data.name ?? null;
    if (serverName) setMyName(serverName, { fromServer: true });
  }

  // The hero stays until the patient says something.
  const started = pendingEcho > 0 || history.some((m) => m.from === 'user');
  if (!started) { setEmpty(true); return; }
  if (isEmpty()) {
    setEmpty(false);
    renderAll();
  } else {
    fresh.forEach((m) => renderMessage(m));
  }
  scrollDown(fresh.length > 0);
}

function showThinking() {
  const row = document.createElement('div');
  row.className = 'row bot';
  row.id = 'thinking';
  row.innerHTML = `<div class="av bot">${BOT_ICON}</div><div class="content"><div class="thinking"><b>Thinking…</b></div></div>`;
  log.appendChild(row);
  scrollDown(true);
}

// ---------------- Sending ----------------
// The "Use my location" chip: ask the browser, then send the rounded point with the message.
async function sendLocation() {
  try { send('Use my location', { coords: await myLocation() }); } catch (err) {
    const note = document.createElement('div');
    note.className = 'row system';
    note.innerHTML = `<span>${CP.esc(err.message)}</span>`;
    log.appendChild(note);
    note.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
}

async function send(text, extra = {}) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true;
  input.value = '';
  autosize();
  if (isEmpty()) { setEmpty(false); renderAll(); }
  clearChips();
  pendingEcho++;
  lockOld();
  const row = document.createElement('div');
  row.className = 'row user';
  row.innerHTML = `<div class="bubble">${CP.esc(text)}</div>`;
  log.appendChild(row);
  rememberChat(text);
  showThinking();
  try {
    apply(await CP.api('/api/chat', { sessionId: sid, message: text, since: seen, name: myName || undefined, email: myEmail, ...extra }));
  } catch {
    $('thinking')?.remove();
    const err = document.createElement('div');
    err.className = 'row system';
    err.innerHTML = "<span>Couldn't reach EMedic AI. Check your connection and try again.</span>";
    log.appendChild(err);
  } finally {
    $('thinking')?.remove();
    busy = false;
    updateSend();
    scrollDown(true);
    if (matchMedia('(hover: hover)').matches) input.focus();
  }
}

async function poll() {
  if (busy) return;
  try { apply(await CP.api(`/api/session/${sid}?since=${seen}`)); } catch { /* retry next tick */ }
}

function resetThread() {
  history = [];
  known.clear();
  seen = 0;
  pendingEcho = 0;
  serverName = undefined;
  log.innerHTML = '';
  setEmpty(true);
}

function switchTo(id) {
  if (id === sid) return;
  sid = id;
  CP.store.set(KEY, sid);
  resetThread();
  renderRecent();
  poll();
}

function newChat() {
  sid = newId();
  CP.store.set(KEY, sid);
  resetThread();
  renderRecent();
  closeSide();
  poll();
  input.focus();
}

// ---------------- Composer ----------------
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  input.style.overflowY = input.scrollHeight > 200 ? 'auto' : 'hidden'; // scrollbar only when it's really needed
}
function updateSend() { sendBtn.disabled = busy || !input.value.trim(); }

input.addEventListener('input', () => { autosize(); updateSend(); });
if (matchMedia('(max-width: 600px)').matches) input.placeholder = 'Message EMedic AI…';
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
});
form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => { closeSide(); send(b.dataset.say); }; });
$('newChat').onclick = newChat;
$('newChatTop').onclick = newChat;

// ---------------- Name field + sidebar chip ----------------
$('nameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  setMyName($('nameInput').value);
  $('nameInput').value = myName;
  $('nameForm').classList.add('saved');
  $('nameSave').textContent = myName ? 'Saved ✓' : 'Save';
  setTimeout(() => { $('nameForm').classList.remove('saved'); $('nameSave').textContent = 'Save'; }, 1600);
  input.focus();
});

// The sidebar name chip opens Settings, where name and email live together.
$('meBtn').onclick = () => openSettings('setName');
renderName();

// ---------------- Settings: your details, appearance, accessibility ----------------
const EMAIL_OK = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
let lastFocus = null;

function openSettings(focusId) {
  lastFocus = document.activeElement;
  $('setName').value = myName;
  $('setEmail').value = myEmail;
  $('setErr').hidden = true;
  $('setOk').hidden = true;
  paintSettings();
  $('settings').hidden = false;
  closeSide();
  (focusId ? $(focusId) : $('settingsClose')).focus();
}
function closeSettings() {
  $('settings').hidden = true;
  lastFocus?.focus?.();
}

// Reflect the current choices on the segmented buttons and switches.
function paintSettings() {
  const a = CP.a11y.get();
  const mark = (group, value) => $(group).querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === value)));
  mark('segTheme', CP.theme.choice());
  mark('segText', a.text === 'lg' || a.text === 'xl' ? a.text : 'normal');
  document.querySelectorAll('#settings .switch').forEach((s) => { s.checked = Boolean(a[s.dataset.opt]); });
}

$('settingsBtn').onclick = () => openSettings();
$('settingsClose').onclick = closeSettings;
$('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settings').hidden) closeSettings(); });
document.addEventListener('themechange', paintSettings);

$('segTheme').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) { CP.theme.set(b.dataset.v); paintSettings(); }
});
$('segText').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) { CP.a11y.set({ text: b.dataset.v }); paintSettings(); }
});
document.querySelectorAll('#settings .switch').forEach((s) => {
  s.addEventListener('change', () => CP.a11y.set({ [s.dataset.opt]: s.checked }));
});
$('a11yReset').onclick = () => { CP.a11y.set({ text: 'normal', hc: false, rm: false, readable: false }); paintSettings(); };

$('detailsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('setEmail').value.trim();
  if (email && !EMAIL_OK.test(email)) {
    $('setErr').textContent = "That email doesn't look right. Try something like name@example.com.";
    $('setErr').hidden = false;
    $('setEmail').focus();
    return;
  }
  $('setErr').hidden = true;
  setMyName($('setName').value);
  myEmail = email;
  CP.store.set(EMAIL_KEY, email);
  renderName();
  $('setOk').hidden = false;
  setTimeout(() => { $('setOk').hidden = true; }, 2000);
});

// ---------------- Sidebar (mobile) ----------------
const openSide = () => document.body.classList.add('side-open');
const closeSide = () => document.body.classList.remove('side-open');
$('openSide').onclick = openSide;
$('closeSide').onclick = closeSide;
$('scrim').onclick = closeSide;

// ---------------- About dialog ----------------
$('aboutBtn').onclick = () => {
  $('aboutBody').innerHTML = INTRO_HTML;
  $('about').hidden = false;
  closeSide();
};
$('aboutClose').onclick = () => { $('about').hidden = true; };
$('about').addEventListener('click', (e) => { if (e.target.id === 'about') $('about').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('about').hidden = true; });

// ---------------- Splash → intro → app ----------------
const splash = $('splash');
const stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));

function buildWordmark() {
  let i = 0;
  $('wordmark').innerHTML = [...'EMedic'].map((c) => `<span style="--i:${i++}">${c}</span>`).join('')
    + [...' AI'].map((c) => `<span class="accent" style="--i:${i++}">${c}</span>`).join('');
}

function setProgress(pct, text) {
  $('bar').style.width = `${pct}%`;
  $('pct').textContent = `${pct}%`;
  if (text) $('stepText').textContent = text;
}

function showIntro() {
  stage.classList.add('intro-on');
  $('intro').hidden = false;
  splash.scrollTop = 0;
  $('startBtn').focus({ preventScroll: true });
  document.addEventListener('keydown', introKeys);
  // Show "scroll for more" until they reach the end; the Start button stays pinned either way.
  const checkEnd = () => splash.classList.toggle('at-end', splash.scrollTop + splash.clientHeight >= splash.scrollHeight - 12);
  splash.addEventListener('scroll', checkEnd, { passive: true });
  window.addEventListener('resize', checkEnd);
  setTimeout(checkEnd, 900); // after the cards finish rising in
  $('moreHint').addEventListener('click', () => splash.scrollBy({ top: splash.clientHeight * 0.7, behavior: 'smooth' }));
}

function introKeys(e) {
  if (e.key === 'Enter' && !splash.classList.contains('leaving')) { e.preventDefault(); enterApp(); }
}

let entered = false;
function enterApp() {
  if (entered) return;
  entered = true;
  document.removeEventListener('keydown', introKeys);
  if ($('skipIntro').checked) CP.store.set(INTRO_KEY, '1');
  // Close the splash like an iris onto the composer, then let the app slide in.
  const r = form.getBoundingClientRect();
  splash.style.setProperty('--x', `${r.left + r.width / 2}px`);
  splash.style.setProperty('--y', `${r.top + r.height / 2}px`);
  splash.classList.add('leaving');
  document.body.classList.add('ready');
  document.body.classList.remove('booting');
  setTimeout(() => {
    splash.remove();
    if (matchMedia('(hover: hover)').matches) input.focus();
  }, 950);
}

async function boot() {
  document.body.classList.add('booting');
  buildWordmark();
  renderRecent();
  $('skip').onclick = enterApp;
  $('startBtn').onclick = enterApp;
  const introSeen = CP.store.get(INTRO_KEY) === '1';

  setProgress(12, 'Loading health library…');
  await wait(500);
  const health = CP.api('/api/health').catch(() => null);
  setProgress(40, 'Preparing symptom checker…');
  await Promise.all([health, wait(450)]);
  setProgress(72, 'Connecting to the care team…');
  await Promise.all([poll(), wait(450)]);
  setProgress(100, 'Ready');
  setInterval(poll, 2000); // picks up nurse replies and refill updates
  await wait(450);
  if (entered) return;
  if (introSeen) enterApp(); else showIntro();
}

boot();

// ---------------- Nurse directory ("Meet our nurses") ----------------
let dirLoaded = false;
async function loadDirectory() {
  const q = new URLSearchParams();
  if ($('dirLanguage').value) q.set('language', $('dirLanguage').value);
  let data;
  try { data = await (await fetch(`/api/nurses?${q}`)).json(); } catch { $('dirGrid').innerHTML = '<div class="dir-empty">Could not load the care team. Try again in a moment.</div>'; return; }
  if (!dirLoaded) {
    dirLoaded = true;
    $('dirLanguage').insertAdjacentHTML('beforeend', data.languages.map((l) => `<option>${CP.esc(l)}</option>`).join(''));
  }
  const e = CP.esc;
  $('dirGrid').innerHTML = data.nurses.length ? data.nurses.map((n) => `
    <div class="ncard">
      <div class="ncard-top"><span class="n-av">${e(n.initials)}</span><div><b>${e(n.name)}</b><small>${e(n.title)}</small></div></div>
      <div class="n-bio">${e(n.bio)}</div>
      <div class="n-meta">Video visits · Speaks ${e(n.languages.join(', '))}</div>
      <div class="n-tags">${n.specialties.map((t) => `<span>${e(t)}</span>`).join('')}</div>
      <div class="n-next">${n.next ? `Next opening: <b>${e(n.next)}</b>` : 'No open times right now'}</div>
      <button type="button" class="n-pick" data-book="${e(n.name)}"${n.next ? '' : ' disabled'}>Book with ${e(n.name.split(' ')[0])}</button>
    </div>`).join('') : '<div class="dir-empty">No nurses match those filters.</div>';
  $('dirGrid').querySelectorAll('[data-book]').forEach((b) => {
    b.onclick = () => { closeDirectory(); send(`Book with ${b.dataset.book}`); };
  });
}
function openDirectory() {
  lastFocus = document.activeElement;
  $('nursesModal').hidden = false;
  closeSide();
  loadDirectory();
  $('nursesClose').focus();
}
function closeDirectory() {
  $('nursesModal').hidden = true;
  lastFocus?.focus?.();
}
$('nursesBtn').onclick = openDirectory;
$('nursesClose').onclick = closeDirectory;
$('nursesModal').addEventListener('click', (e) => { if (e.target.id === 'nursesModal') closeDirectory(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('nursesModal').hidden) closeDirectory(); });
$('dirLanguage').addEventListener('change', loadDirectory);

// ---------------- Find a real provider (NPI Registry) ----------------
// "Use my location": asks the browser only when tapped, rounds to about 1 km, and is used for one search.
function myLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This browser can't share your location. Please type your ZIP code instead.")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      (e) => reject(new Error(e.code === 1
        ? "Location is turned off for this site, so I can't use it. Please type your ZIP code or city instead."
        : "Couldn't get your location just now. Please type your ZIP code or city instead.")),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

async function searchProviders(ev, near) {
  ev?.preventDefault();
  const where = $('provWhere').value.trim();
  if (!where && !near) { $('provWhere').focus(); return; }
  const q = new URLSearchParams({ type: $('provType').value, limit: '12' });
  if (near) { q.set('lat', near.lat); q.set('lon', near.lon); } else q.set(/^\d{5}(-\d{4})?$/.test(where) ? 'zip' : 'city', where);
  $('provResults').innerHTML = '<div class="dir-empty">Searching the NPI Registry…</div>';
  let data;
  try {
    // One quiet retry: the connection can drop for a moment (e.g. while the server restarts after an update).
    let res;
    try { res = await fetch(`/api/providers?${q}`); } catch {
      await new Promise((r) => setTimeout(r, 2500));
      res = await fetch(`/api/providers?${q}`);
    }
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The search didn't work this time. Please try again.");
  } catch (err) {
    const offline = err instanceof TypeError; // the browser couldn't reach the server at all
    $('provResults').innerHTML = `<div class="dir-empty">${CP.esc(offline
      ? "Couldn't reach EMedic right now. If the site was just updated, wait a minute and try again."
      : err.message)}</div>`;
    return;
  }
  if (near && data.zip) $('provWhere').value = data.zip; // show which ZIP your location matched
  $('provResults').innerHTML = data.results.length
    ? (data.guessedState ? `<div class="dir-empty">Showing ${CP.esc(data.where)}. Not the right one? Add the state after the city name.</div>` : '')
      + providerCardsHtml(data.results, data.total)
    : `<div class="dir-empty">No ${CP.esc(data.type.toLowerCase())} listings found for ${CP.esc(data.where)}. Try a nearby ZIP or a bigger city.</div>`;
}
function openProviders() {
  lastFocus = document.activeElement;
  $('providersModal').hidden = false;
  closeSide();
  $('provWhere').focus();
}
function closeProviders() {
  $('providersModal').hidden = true;
  lastFocus?.focus?.();
}
$('providersBtn').onclick = openProviders;
$('providersClose').onclick = closeProviders;
$('providersModal').addEventListener('click', (e) => { if (e.target.id === 'providersModal') closeProviders(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('providersModal').hidden) closeProviders(); });
$('provForm').addEventListener('submit', searchProviders);
$('provNear').onclick = async () => {
  $('provResults').innerHTML = '<div class="dir-empty">Finding your location…</div>';
  try { await searchProviders(null, await myLocation()); } catch (err) {
    $('provResults').innerHTML = `<div class="dir-empty">${CP.esc(err.message)}</div>`;
  }
};
