// Nurse console: queue of conversations, live transcript, handoff summary, claim/reply/resolve.
const queueEl = document.getElementById('queue');
const logEl = document.getElementById('log');
const summaryEl = document.getElementById('summary');
const actionsEl = document.getElementById('actions');
const form = document.getElementById('form');
const input = document.getElementById('input');
const canned = document.getElementById('canned');
const nameInput = document.getElementById('agentName');

nameInput.value = CP.store.get('emedic-agent') || 'Nurse Jordan';
nameInput.onchange = () => CP.store.set('emedic-agent', nameInput.value.trim() || 'Nurse Jordan');
const agentName = () => nameInput.value.trim() || 'Nurse Jordan';

// ---- Staff sign-in: the passcode is kept for this browser tab only and sent with every staff request ----
const PASS_KEY = 'emedic-staff-passcode';
const session = {
  get() { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? sessionStorage.setItem(PASS_KEY, v) : sessionStorage.removeItem(PASS_KEY); } catch { /* private mode */ } },
};
let passcode = session.get();
let pollTimer = null;

async function staffApi(url, body) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Staff-Passcode': passcode },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { showLogin(); throw new Error('401'); }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const loginEl = document.getElementById('login');
const loginForm = document.getElementById('loginForm');
const passInput = document.getElementById('passcode');
const loginError = document.getElementById('loginError');

function showLogin() {
  clearInterval(pollTimer);
  pollTimer = null;
  loginEl.hidden = false;
  passInput.focus();
}

function startConsole() {
  loginEl.hidden = true;
  loginError.hidden = true;
  loadQueue();
  if (!pollTimer) pollTimer = setInterval(() => { loadQueue(); loadConvo(); }, 2000);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passcode = passInput.value.trim();
  const res = await fetch('/api/agent/login', { method: 'POST', headers: { 'X-Staff-Passcode': passcode } });
  if (res.ok) {
    session.set(passcode);
    passInput.value = '';
    startConsole();
  } else {
    loginError.hidden = false;
    loginForm.classList.remove('shake');
    void loginForm.offsetWidth; // restart the shake animation
    loginForm.classList.add('shake');
    passInput.select();
  }
});

document.getElementById('signOut').onclick = () => {
  passcode = '';
  session.set('');
  selected = null;
  showLogin();
};

let selected = null;
let lastCount = -1;
let lastWaiting = new Set();

const STATUS_LABEL = { waiting: 'Needs you', human: 'Live', bot: 'With bot' };

async function loadQueue() {
  let list;
  try { list = await staffApi('/api/agent/sessions'); } catch { return; }

  // Little chime + title badge when a new patient is waiting.
  const waiting = new Set(list.filter((s) => s.status === 'waiting').map((s) => s.id));
  if ([...waiting].some((id) => !lastWaiting.has(id))) chime();
  lastWaiting = waiting;
  document.title = waiting.size ? `(${waiting.size}) EMedic AI Nurse Console` : 'EMedic AI Nurse Console';
  setCount('chatCount', waiting.size);
  loadRequests();

  if (!list.length) {
    queueEl.innerHTML = '<div class="empty">No conversations yet. Open the <a href="/" target="_blank">patient chat</a> and say hi.</div>';
    return;
  }
  queueEl.innerHTML = list.map((s) => `
    <button class="item ${s.id === selected ? 'active' : ''}" data-id="${CP.esc(s.id)}">
      <div class="top">
        <span class="pill ${s.status}">${STATUS_LABEL[s.status]}</span>
        ${s.priority && s.priority !== 'Normal' ? `<span class="pill high">${CP.esc(s.priority)}</span>` : ''}
        <span class="when">${CP.ago(s.escalatedAt || s.updatedAt)}</span>
      </div>
      <div class="issue">${s.name ? `<b>${CP.esc(s.name)}</b> · ` : ''}${CP.esc(s.issue || 'Chatting with EMedic AI')}</div>
      <div class="last">${CP.esc(s.lastMessage || '')}</div>
    </button>`).join('');
  queueEl.querySelectorAll('.item').forEach((b) => { b.onclick = () => select(b.dataset.id); });
}

// ---- Requests tab: refills, callbacks and appointments created by the assistant ----
const requestsEl = document.getElementById('requests');
const tabChats = document.getElementById('tabChats');
const tabRequests = document.getElementById('tabRequests');

function setCount(id, n) {
  const el = document.getElementById(id);
  el.hidden = !n;
  el.textContent = n;
}

function showTab(which) {
  tabChats.classList.toggle('on', which === 'chats');
  tabRequests.classList.toggle('on', which === 'requests');
  queueEl.hidden = which !== 'chats';
  requestsEl.hidden = which !== 'requests';
}
tabChats.onclick = () => showTab('chats');
tabRequests.onclick = () => showTab('requests');

const REQ_ICON = { refill: '💊', callback: '📞', appointment: '📅' };

function requestLines(r) {
  if (r.type === 'refill') return [`${r.medication} → ${r.pharmacy}`, `Refills left: ${r.refillsRemaining} · DOB ${r.dateOfBirth}`];
  if (r.type === 'callback') return [`Call ${r.phone} · ${r.bestTime}`, `Reason: ${r.reason}`];
  return [`${r.visitType} · ${r.format}`, `${r.time} · ${r.reason}`];
}

async function loadRequests() {
  let list;
  try { list = await staffApi('/api/agent/requests'); } catch { return; }
  const pending = list.filter((r) => /Waiting/.test(r.status));
  setCount('reqCount', pending.length);
  if (!list.length) {
    requestsEl.innerHTML = '<div class="empty">No requests yet. Refills, callbacks and bookings made in chat show up here.</div>';
    return;
  }
  requestsEl.innerHTML = list.map((r) => {
    const waiting = /Waiting/.test(r.status);
    const acts = r.type === 'refill' && r.status === 'Waiting for provider approval'
      ? `<div class="acts"><button class="approve" data-act="refills/${r.ref}/approve">Approve</button><button data-act="refills/${r.ref}/deny">Deny</button></div>`
      : r.type === 'callback' && waiting
        ? `<div class="acts"><button class="approve" data-act="callbacks/${r.ref}/complete">Mark called</button></div>`
        : '';
    return `<div class="req">
      <div class="top"><span>${REQ_ICON[r.type] || ''}</span><span class="ref">${CP.esc(r.ref)}</span>
        <span class="pill ${waiting ? 'waiting' : ''}">${CP.esc(r.status)}</span><span class="when">${CP.ago(Date.parse(r.updatedAt || r.createdAt))}</span></div>
      ${requestLines(r).map((l) => `<div class="line">${CP.esc(l)}</div>`).join('')}
      ${acts}
    </div>`;
  }).join('');
  requestsEl.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await staffApi(`/api/agent/${b.dataset.act}`, {}); } catch { /* shown on next refresh */ }
      loadRequests();
    };
  });
}

async function select(id) {
  selected = id;
  lastCount = -1;
  await loadConvo();
  loadQueue();
}

async function loadConvo() {
  if (!selected) return;
  let s;
  try { s = await staffApi(`/api/agent/sessions/${selected}`); } catch { return; }

  if (s.messages.length !== lastCount) {
    lastCount = s.messages.length;
    logEl.innerHTML = s.messages.map((m) => {
      if (m.from === 'system') return `<div class="msg system">${CP.esc(m.text)}</div>`;
      const who = m.from === 'agent' ? `<div class="who">${CP.esc(m.name)}</div>`
        : m.from === 'bot' ? '<div class="who" style="color:var(--muted)">EMedic AI (bot)</div>'
        : s.name ? `<div class="who">${CP.esc(s.name)}</div>` : '';
      const body = m.from === 'user' ? `<p>${CP.esc(m.text)}</p>` : CP.md(m.text);
      const src = m.sources?.length ? `<div class="sources">${m.sources.map((x) => `<span>📄 ${CP.esc(x.heading)}</span>`).join('')}</div>` : '';
      return `<div class="msg ${m.from}">${who}${body}${src}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  summaryEl.innerHTML = s.summary
    ? `${CP.summaryHtml(s.summary)}
       <dl class="kv" style="margin-top:10px">
         <dt>Reason</dt><dd>${CP.esc(s.escalationReason)}</dd>
         <dt>Waiting</dt><dd>${CP.ago(s.escalatedAt)}</dd>
         <dt>Summary by</dt><dd>${s.summary.generatedBy === 'AI' ? 'AI' : 'EMedic AI rules'}</dd>
       </dl>`
    : 'The patient is still chatting with the bot. No handoff yet. You can still jump in.';

  const live = s.status === 'human';
  form.hidden = !live;
  canned.hidden = !live;
  actionsEl.innerHTML = live
    ? '<button class="btn secondary" id="resolve">End chat & return to bot</button>'
    : `<button class="btn" id="claim">${s.status === 'waiting' ? 'Accept chat' : 'Take over from bot'}</button>`;
  document.getElementById('claim')?.addEventListener('click', () => act('claim'));
  document.getElementById('resolve')?.addEventListener('click', () => act('resolve'));
}

async function act(action, extra = {}) {
  if (!selected) return;
  await staffApi(`/api/agent/sessions/${selected}/${action}`, { name: agentName(), ...extra });
  await loadConvo();
  loadQueue();
  if (action === 'claim') input.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  act('reply', { text });
});
canned.querySelectorAll('button').forEach((b) => { b.onclick = () => { input.value = b.textContent; input.focus(); }; });

function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch { /* audio blocked until the page is clicked */ }
}

if (passcode) startConsole(); // a bad saved passcode gets a 401 and shows the sign-in screen
else showLogin();
