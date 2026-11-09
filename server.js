// EMedic AI server: zero dependencies, just Node's built-in http module.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Load .env so plain `node server.js` picks up settings too (not just `npm start`).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file */ }

const bot = require('./lib/bot');
const actions = require('./lib/actions');
const library = require('./lib/library');
const { triageResult } = require('./lib/workflows');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ID_RE = /^[\w-]{6,64}$/;
// Nurse console passcode. Set STAFF_PASSCODE in .env (or your host's settings) to change it.
const STAFF_PASSCODE = process.env.STAFF_PASSCODE || 'emedic-staff';
// Key that external callers (like an eGain AI Agent action) send as the X-API-Key header.
const ACTIONS_API_KEY = process.env.ACTIONS_API_KEY || 'emedic-actions-demo';

function safeEqual(got, want) {
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isStaff = (req) => safeEqual(req.headers['x-staff-passcode'], STAFF_PASSCODE);
const hasActionsKey = (req) => safeEqual(req.headers['x-api-key'] || url(req).searchParams.get('key'), ACTIONS_API_KEY);
const url = (req) => new URL(req.url, 'http://localhost');

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function serveStatic(res, urlPath) {
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/agent') urlPath = '/agent.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// Run an action and reply with its result, or with its friendly error.
// soft = true answers errors with HTTP 200 + ok:false, so a no-code workflow (like eGain's API node)
// can branch on `ok` and still show the friendly `message`, instead of landing in a generic error path.
async function runAction(res, fn, headers, soft = false) {
  try {
    return send(res, 200, { ok: true, ...(await fn()) }, headers);
  } catch (err) {
    if (err instanceof actions.ActionError) {
      return send(res, soft ? 200 : err.status, { ok: false, error: err.code, message: err.message }, headers);
    }
    throw err;
  }
}

// Map loosely worded answers ("my kid is 2", "pretty bad", "about 3 days") onto the symptom-check options,
// so a workflow can use exact button labels or free-text questions alike.
function normalizeTriage(b) {
  const s = String(b.symptom).toLowerCase();
  const symptom = /fever|temperature/.test(s) ? 'Fever'
    : /cough|cold|throat|congest|runny|sneez/.test(s) ? 'Cough, cold or sore throat'
      : /stomach|vomit|diarr|nause|belly|throw/.test(s) ? 'Stomach (vomiting, diarrhea, pain)'
        : /pain|injur|sprain|hurt|fall|cut|broke/.test(s) ? 'Pain or injury'
          : /rash|skin|itch|hives/.test(s) ? 'Rash or skin'
            : /urin|pee|uti|bladder|burn/.test(s) ? 'Urinary symptoms' : 'Something else';

  const a = String(b.ageGroup).toLowerCase();
  const n = Number((a.match(/\d+/) || [NaN])[0]);
  const ageGroup = /under 3 month|newborn|infant|\bweeks?\b/.test(a) || (/month/.test(a) && n < 3) ? 'Under 3 months'
    : /65|older|senior|elderly/.test(a) || n >= 65 ? '65 or older'
      : /month|child|kid|teen|17 years|baby|toddler/.test(a) || n < 18 ? '3 months to 17 years' : '18 to 64';

  const v = String(b.severity).toLowerCase();
  const severity = /sev|worse|can'?t keep|really bad|terrible/.test(v) ? 'Severe' : /mod|hard|pretty bad/.test(v) ? 'Moderate' : 'Mild';

  const d = String(b.duration).toLowerCase();
  const dn = Number((d.match(/\d+/) || [NaN])[0]);
  const duration = /more than a week|weeks|month/.test(d) || (/week/.test(d) && !/less/.test(d)) || dn > 7 ? 'More than a week'
    : /less than|today|hours?|yesterday|just started/.test(d) || dn < 2 ? 'Less than 2 days' : '2 to 7 days';

  return { symptom, ageGroup, severity, duration };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function route(req, res) {
  const p = url(req).pathname;
  let m;

  // ---- Patient chat API ----
  if (req.method === 'POST' && p === '/api/chat') {
    const { sessionId, message, since } = await readBody(req);
    if (!ID_RE.test(sessionId || '') || typeof message !== 'string' || !message.trim()) {
      return send(res, 400, { error: 'sessionId and message are required' });
    }
    const s = bot.getSession(sessionId);
    await bot.handleMessage(s, message.trim().slice(0, 1000));
    return send(res, 200, bot.messagesSince(s, since));
  }
  if (req.method === 'GET' && (m = p.match(/^\/api\/session\/([\w-]+)$/))) {
    if (!ID_RE.test(m[1])) return send(res, 400, { error: 'bad session id' });
    const s = bot.getSession(m[1]);
    return send(res, 200, bot.messagesSince(s, url(req).searchParams.get('since')));
  }

  // ---- Actions API: lets an external AI agent (e.g. eGain) take the same real actions over REST ----
  if (p.startsWith('/api/actions/')) {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (!hasActionsKey(req)) return send(res, 401, { error: 'unauthorized', message: 'Missing or wrong X-API-Key.' }, CORS);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const soft = /^(1|true|yes)$/i.test(url(req).searchParams.get('soft') || '');
    const act = (fn) => runAction(res, fn, CORS, soft);
    const ref = (s) => decodeURIComponent(s);

    if (req.method === 'GET' && p === '/api/actions/slots') {
      return act(() => {
        const slots = actions.listSlots();
        return { slots, message: `Next available times: ${slots.join('; ')}.` };
      });
    }
    if (req.method === 'POST' && p === '/api/actions/appointments') return act(() => actions.bookAppointment(body));
    // References may arrive loosely typed ("apt 123456"); the actions normalize them.
    if ((m = p.match(/^\/api\/actions\/appointments\/([^/]+)$/)) && req.method === 'GET') return act(() => actions.getAppointment(ref(m[1])));
    if ((m = p.match(/^\/api\/actions\/appointments\/([^/]+)\/cancel$/)) && req.method === 'POST') return act(() => actions.cancelAppointment(ref(m[1])));
    if ((m = p.match(/^\/api\/actions\/appointments\/([^/]+)\/reschedule$/)) && req.method === 'POST') return act(() => actions.rescheduleAppointment(ref(m[1]), body));
    if (req.method === 'POST' && p === '/api/actions/refills') return act(() => actions.requestRefill(body));
    if ((m = p.match(/^\/api\/actions\/refills\/([^/]+)$/)) && req.method === 'GET') return act(() => actions.getRefill(ref(m[1])));
    if (req.method === 'POST' && p === '/api/actions/callbacks') return act(() => actions.requestCallback(body));
    if (req.method === 'POST' && p === '/api/actions/triage') {
      return act(() => {
        const fields = ['emergencySigns', 'symptom', 'ageGroup', 'severity', 'duration'];
        const missing = fields.filter((k) => !String(body[k] || '').trim());
        if (missing.length) throw new actions.ActionError(400, 'missing_fields', `Missing: ${missing.join(', ')}`);
        if (/^y/i.test(body.emergencySigns)) {
          return { level: 'emergency', message: 'Call 911 now or go to the nearest emergency room. For thoughts of self-harm, call or text 988.' };
        }
        const t = normalizeTriage(body);
        const r = triageResult({ 'Main symptom': t.symptom, 'Age group': t.ageGroup, Severity: t.severity, 'How long': t.duration });
        const level = /ER now/.test(r.outcome) ? 'emergency' : /urgent care/.test(r.outcome) ? 'urgent_care_today'
          : /same-day/.test(r.outcome) ? 'same_day_visit' : /1–2 days/.test(r.outcome) ? 'visit_1_2_days' : 'self_care';
        return { level, recommendation: r.outcome, message: r.end.replace(/\*\*/g, '') };
      });
    }
    return send(res, 404, { error: 'not_found', message: 'Unknown action.' }, CORS);
  }

  // ---- Nurse console API: every route needs the passcode ----
  if (p.startsWith('/api/agent/')) {
    if (!isStaff(req)) {
      await new Promise((r) => setTimeout(r, 400)); // slow down passcode guessing
      return send(res, 401, { error: 'staff passcode required' });
    }
    if (req.method === 'POST' && p === '/api/agent/login') return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/agent/sessions') {
    return send(res, 200, bot.listSessions());
  }
  if (req.method === 'GET' && p === '/api/agent/requests') {
    return send(res, 200, actions.listRequests());
  }
  if (req.method === 'POST' && (m = p.match(/^\/api\/agent\/refills\/([\w-]+)\/(approve|deny)$/))) {
    return runAction(res, () => {
      const rec = actions.decideRefill(m[1], m[2] === 'approve');
      bot.notify(rec.sessionId, m[2] === 'approve'
        ? `🔔 **Update on ${rec.ref}:** your provider approved your ${rec.medication} refill. It's been sent to ${rec.pharmacy} and should be ready within 24 hours.`
        : `🔔 **Update on ${rec.ref}:** your provider wasn't able to approve this refill without a visit. A nurse will reach out about next steps, or you can book a video visit here.`);
      return { ok: true };
    });
  }
  if (req.method === 'POST' && (m = p.match(/^\/api\/agent\/callbacks\/([\w-]+)\/complete$/))) {
    return runAction(res, () => { actions.completeCallback(m[1]); return { ok: true }; });
  }
  if ((m = p.match(/^\/api\/agent\/sessions\/([\w-]+)(?:\/(claim|reply|resolve))?$/))) {
    const s = bot.findSession(m[1]);
    if (!s) return send(res, 404, { error: 'session not found' });
    const action = m[2];
    if (req.method === 'GET' && !action) return send(res, 200, bot.sessionDetail(s));
    if (req.method === 'POST' && action) {
      const body = await readBody(req);
      const name = String(body.name || 'EMedic Nurse').slice(0, 60);
      if (action === 'claim') bot.claim(s, name);
      if (action === 'resolve') bot.resolve(s, name);
      if (action === 'reply') {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) return send(res, 400, { error: 'text required' });
        bot.agentReply(s, name, text);
      }
      return send(res, 200, bot.sessionDetail(s));
    }
  }

  // ---- Public health library (HTML pages for people and for training an AI agent) ----
  if (req.method === 'GET' && (p === '/library' || p === '/library/')) return sendHtml(res, library.renderIndex());
  if (req.method === 'GET' && (m = p.match(/^\/library\/([\w-]+)$/))) {
    const doc = library.find(m[1]);
    return doc ? sendHtml(res, library.renderDoc(doc)) : send(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, llm: bot.llmEnabled() });
  if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`EMedic AI running: http://localhost:${PORT}`);
    console.log(`Nurse console:       http://localhost:${PORT}/agent`);
    console.log(`Health library:      http://localhost:${PORT}/library`);
    console.log(process.env.STAFF_PASSCODE
      ? 'Nurse passcode:      (set from STAFF_PASSCODE)'
      : `Nurse passcode:      ${STAFF_PASSCODE}  (default; set STAFF_PASSCODE to change it)`);
    console.log(process.env.ACTIONS_API_KEY
      ? 'Actions API key:     (set from ACTIONS_API_KEY)'
      : `Actions API key:     ${ACTIONS_API_KEY}  (default; set ACTIONS_API_KEY to change it)`);
    console.log(bot.llmEnabled()
      ? `AI answers ON (model ${require('./lib/llm').MODEL})`
      : 'AI answers OFF (no AI_API_KEY) - using health-library excerpts');
  });
}

module.exports = server;
