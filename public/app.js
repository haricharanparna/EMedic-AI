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
  $('meText').textContent = myName || 'Add your name';
  $('meBtn').classList.toggle('empty', !myName);
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
    if (m.from === 'bot') body += `<div class="msg-actions"><button type="button" class="copy" title="Copy">${COPY_ICON}</button></div>`;
    row.innerHTML = `${av}<div class="content">${body}</div>`;
    row.querySelector('.copy')?.addEventListener('click', (e) => copyText(m.text, e.currentTarget));
    if (m.options?.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const o of m.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o;
        b.onclick = () => send(o);
        chips.appendChild(b);
      }
      row.querySelector('.content').appendChild(chips);
    }
  }
  log.appendChild(row);
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
async function send(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true;
  input.value = '';
  autosize();
  if (isEmpty()) { setEmpty(false); renderAll(); }
  clearChips();
  pendingEcho++;
  const row = document.createElement('div');
  row.className = 'row user';
  row.innerHTML = `<div class="bubble">${CP.esc(text)}</div>`;
  log.appendChild(row);
  rememberChat(text);
  showThinking();
  try {
    apply(await CP.api('/api/chat', { sessionId: sid, message: text, since: seen, name: myName || undefined }));
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

// Edit the name in place from the sidebar.
$('meBtn').onclick = () => {
  const text = $('meText');
  if (text.querySelector('input')) return;
  const field = document.createElement('input');
  field.className = 'me-input';
  field.maxLength = 30;
  field.placeholder = 'Your first name';
  field.value = myName;
  text.textContent = '';
  text.appendChild(field);
  field.focus();
  let finished = false;
  const done = (save) => {
    if (finished) return;
    finished = true;
    if (save) setMyName(field.value);
    renderName();
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') done(false);
  });
  field.addEventListener('blur', () => done(true));
};
renderName();

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
