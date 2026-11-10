// End-to-end smoke test: starts the server on a random port and runs the demo paths.
// Run with: npm test
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.STAFF_PASSCODE = 'test-passcode';
process.env.ACTIONS_API_KEY = 'test-actions-key';
process.env.DATA_FILE = path.join(os.tmpdir(), `emedic-test-${Date.now()}.json`);
const server = require('../server');
delete process.env.AI_API_KEY; // test the offline path so results are deterministic
delete process.env.EMAIL_API_KEY; // never send real email from tests
delete process.env.EMAIL_FROM;

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Staff-Passcode': 'test-passcode' };
  const post = (url, body) => fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
  const get = (url) => fetch(base + url, { headers }).then((r) => r.json());
  // Returns only the replies to this message (everything after the patient's own message).
  const chat = async (sid, message) => {
    const { messages } = await post('/api/chat', { sessionId: sid, message });
    const at = messages.findLastIndex((m) => m.from === 'user');
    return messages.slice(at + 1);
  };
  // New session that has already answered the pre-chat question.
  const fresh = async (sid, who = 'Myself') => { await chat(sid, who); return sid; };
  let failures = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log('PASS', name); } catch (e) { failures++; console.log('FAIL', name, '-', e.message); }
  };

  await check('greeting asks the pre-chat question', async () => {
    const r = await get('/api/session/test-greet');
    assert.match(r.messages[0].text, /EMedic AI/);
    assert.deepEqual(r.messages[0].options, ['Myself', 'My child', 'Someone I care for']);
    const [m] = await chat('test-greet', 'My child');
    assert.match(m.text, /your child/);
    assert.ok(m.options.includes('Check my symptoms'));
  });

  await check('question before pre-chat still gets answered', async () => {
    const [m] = await chat('test-skip-prechat', 'What is a normal blood pressure?');
    assert.match(m.text, /120\/80/);
  });

  await check('sourced health answer', async () => {
    const sid = await fresh('test-kb-1');
    const [m] = await chat(sid, 'How much Tylenol can I take?');
    assert.match(m.text, /3,000 mg/);
    assert.equal(m.sources[0].heading, 'Acetaminophen (Tylenol) safety');
  });

  await check('off-topic question is not guessed', async () => {
    const sid = await fresh('test-kb-2');
    const [m] = await chat(sid, 'Who won the Super Bowl?');
    assert.match(m.text, /don't want to guess/);
  });

  await check('emergency message triggers 911 guidance', async () => {
    const sid = await fresh('test-emergency');
    const msgs = await chat(sid, 'my dad has crushing chest pain right now');
    assert.ok(msgs[0].emergency);
    assert.match(msgs[0].text, /Call 911/);
  });

  await check('crisis message triggers 988', async () => {
    const sid = await fresh('test-crisis');
    const [m] = await chat(sid, 'I want to end my life');
    assert.match(m.text, /988/);
  });

  await check('symptom check: infant fever goes to ER', async () => {
    const sid = await fresh('test-triage-infant', 'My child');
    assert.match((await chat(sid, 'Check my symptoms'))[0].text, /safety check/i);
    await chat(sid, 'No, none of these');
    await chat(sid, 'Fever');
    await chat(sid, 'Under 3 months');
    await chat(sid, 'mild');
    const [m] = await chat(sid, 'Less than 2 days');
    assert.match(m.text, /ER/);
  });

  await check('symptom check: mild cold gets home care', async () => {
    const sid = await fresh('test-triage-mild');
    await chat(sid, 'I feel sick');
    await chat(sid, 'no');
    await chat(sid, 'Cough, cold or sore throat');
    await chat(sid, '18 to 64');
    await chat(sid, 'Mild: doing normal activities');
    const [m] = await chat(sid, 'Less than 2 days');
    assert.match(m.text, /managed at home/);
  });

  await check('refill workflow with validation', async () => {
    const sid = await fresh('test-refill');
    assert.match((await chat(sid, 'I need a refill on my prescription'))[0].text, /Which medication/);
    await chat(sid, 'lisinopril 10 mg');
    await chat(sid, 'No');
    assert.match((await chat(sid, 'yesterday'))[0].text, /MM\/DD\/YYYY/);
    await chat(sid, '04/17/1985');
    await chat(sid, 'Yes, refills left');
    await chat(sid, 'EMedic Pharmacy (pick up)');
    const [m] = await chat(sid, 'Submit request');
    assert.match(m.text, /RX-\d{6}/);
  });

  await check('refill: controlled medication is stopped', async () => {
    const sid = await fresh('test-refill-controlled');
    await chat(sid, 'Refill a prescription');
    await chat(sid, 'adderall');
    const [m] = await chat(sid, 'Yes');
    assert.match(m.text, /can't be refilled through chat/);
  });

  await check('appointment booking', async () => {
    const sid = await fresh('test-appt');
    await chat(sid, 'Book an appointment');
    await chat(sid, 'Sick visit');
    const [slots] = await chat(sid, 'Video visit');
    assert.ok(slots.options.length >= 3);
    await chat(sid, slots.options[0]);
    await chat(sid, 'ear pain');
    const [m] = await chat(sid, 'Confirm booking');
    assert.match(m.text, /APT-\d{6}/);
  });

  await check('talk to a nurse: callback with summary', async () => {
    const sid = await fresh('test-callback');
    const [opts] = await chat(sid, 'Can I talk to a nurse?');
    assert.deepEqual(opts.options, ['Chat with a nurse now', 'Call the Nurse Line', 'Request a callback']);
    await chat(sid, 'Request a callback');
    assert.match((await chat(sid, '123'))[0].text, /10-digit/);
    await chat(sid, '(555) 123-4567');
    const msgs = await chat(sid, 'Morning (8 AM–12 PM)');
    const withSummary = msgs.find((m) => m.summary);
    assert.ok(withSummary, 'expected a handoff summary');
    assert.ok(withSummary.summary.details.some((d) => d.includes('555')));
    assert.equal((await get(`/api/agent/sessions/${sid}`)).status, 'waiting');
  });

  await check('nurse claim, reply and resolve', async () => {
    const sid = await fresh('test-human');
    await chat(sid, 'Talk to a nurse');
    await chat(sid, 'Chat with a nurse now');
    assert.equal((await get(`/api/session/${sid}`)).status, 'waiting', 'the button should hand off, not repeat the menu');
    await post(`/api/agent/sessions/${sid}/claim`, { name: 'Nurse Jordan' });
    await post(`/api/agent/sessions/${sid}/reply`, { name: 'Nurse Jordan', text: 'Hi, how can I help?' });
    const quiet = await chat(sid, 'my throat hurts');
    assert.equal(quiet.length, 0, 'bot should stay quiet while a nurse is live');
    const r = await get(`/api/session/${sid}`);
    assert.ok(r.messages.some((m) => m.from === 'agent' && m.name === 'Nurse Jordan'));
    await post(`/api/agent/sessions/${sid}/resolve`, { name: 'Nurse Jordan' });
    assert.equal((await get(`/api/session/${sid}`)).status, 'bot');
  });

  await check('patient name: from the welcome field and from "my name is"', async () => {
    // Sent with the message (the welcome-screen field).
    const { messages } = await post('/api/chat', { sessionId: 'test-name-field', message: 'Myself', name: '  david<script> ' });
    assert.match(messages.at(-1).text, /^Thanks, David!/);
    const [ans] = await chat('test-name-field', "What's a normal blood pressure?");
    assert.match(ans.text, /^David, here's what/);
    // Typed in chat.
    const [hi] = await chat('test-name-chat', 'my name is maria lopez');
    assert.match(hi.text, /Nice to meet you, Maria Lopez!/);
    assert.equal((await get('/api/session/test-name-chat')).name, 'Maria Lopez');
    // A symptom isn't a name.
    await chat('test-name-chat', 'Myself');
    await chat('test-name-chat', 'call me ill');
    assert.equal((await get('/api/session/test-name-chat')).name, 'Maria Lopez');
    // The nurse sees it.
    await chat('test-name-chat', 'Talk to a nurse');
    await chat('test-name-chat', 'Chat with a nurse now');
    const s = await (await fetch(`${base}/api/agent/sessions/test-name-chat`, { headers })).json();
    assert.equal(s.name, 'Maria Lopez');
    assert.equal(s.summary.patientName, 'Maria Lopez');
  });

  await check('nurses manage the open appointment times', async () => {
    const staff = (method, url, body) => fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    assert.equal((await fetch(`${base}/api/agent/slots`)).status, 401, 'staff only');
    const before = await (await staff('GET', '/api/agent/slots')).json();
    assert.ok(before.slots.length > 0, 'a new schedule starts with default times');
    assert.deepEqual(before.standardTimes, ['09:00', '10:15', '13:00', '15:30']);
    // Add a time; it shows up for patients once it's among the soonest.
    const added = await (await staff('POST', '/api/agent/slots', { start: '2031-03-04T08:30', name: 'Nurse Jordan' })).json();
    assert.deepEqual(added.added, ['Tue, Mar 4, 8:30 AM']);
    assert.equal((await staff('POST', '/api/agent/slots', { start: '2031-03-04T08:30' })).status, 409, 'no duplicates');
    assert.equal((await staff('POST', '/api/agent/slots', { start: '2020-01-01T09:00' })).status, 400, 'no past times');
    assert.equal((await staff('POST', '/api/agent/slots', { start: 'tomorrow' })).status, 400);
    // A standard day opens four times at once and skips ones already open.
    const day = await (await staff('POST', '/api/agent/slots', { starts: ['09:00', '10:15', '13:00', '15:30', '08:30'].map((t) => `2031-03-04T${t}`) })).json();
    assert.equal(day.added.length, 4);
    assert.equal(day.skipped.length, 1);
    // Booked times can't be removed; open ones can.
    const apiKey = { 'Content-Type': 'application/json', 'X-API-Key': 'test-actions-key' };
    const booked = await (await fetch(`${base}/api/actions/appointments`, { method: 'POST', headers: apiKey, body: JSON.stringify({ visitType: 'Sick visit', format: 'In person', preference: 'earliest' }) })).json();
    const list = (await (await staff('GET', '/api/agent/slots')).json()).slots;
    const mine = list.find((s) => s.label === booked.time);
    assert.equal(mine.booking.ref, booked.ref);
    assert.equal((await staff('DELETE', `/api/agent/slots/${encodeURIComponent(mine.start)}`)).status, 409);
    const rm = await (await staff('DELETE', `/api/agent/slots/${encodeURIComponent('2031-03-04T08:30')}`)).json();
    assert.equal(rm.removed, 'Tue, Mar 4, 8:30 AM');
    // With nothing open, the bot says so instead of showing an empty list.
    const open = (await (await staff('GET', '/api/agent/slots')).json()).slots.filter((s) => !s.booking);
    for (const s of open) await staff('DELETE', `/api/agent/slots/${encodeURIComponent(s.start)}`);
    await fresh('test-no-slots');
    await chat('test-no-slots', 'Book an appointment');
    await chat('test-no-slots', 'Sick visit');
    assert.match((await chat('test-no-slots', 'In person'))[0].text, /aren't any open appointment times/);
    const none = await fetch(`${base}/api/actions/appointments`, { method: 'POST', headers: apiKey, body: JSON.stringify({ visitType: 'Sick visit', format: 'In person', preference: 'earliest' }) });
    assert.equal(none.status, 409);
    // Put a normal week back for the tests that follow.
    for (let day = 5; day <= 18; day++) {
      const d = `2031-03-${String(day).padStart(2, '0')}`;
      await staff('POST', '/api/agent/slots', { starts: ['09:00', '10:15', '13:00', '15:30'].map((t) => `${d}T${t}`) });
    }
  });

  await check('nurse console requires the passcode', async () => {
    assert.equal((await fetch(`${base}/api/agent/sessions`)).status, 401);
    const wrong = await fetch(`${base}/api/agent/sessions`, { headers: { 'X-Staff-Passcode': 'guess' } });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/agent/login`, { method: 'POST', headers });
    assert.equal(login.status, 200);
  });

  // ---- Good judgment ----

  await check('declines diagnosis but still shares info', async () => {
    const sid = await fresh('test-judgment-dx');
    const msgs = await chat(sid, 'Do I have strep throat?');
    assert.match(msgs[0].text, /can't diagnose/);
    assert.ok(msgs[1] && /strep/i.test(msgs[1].text), 'expected a follow-up library answer');
  });

  await check('refuses controlled substances', async () => {
    const sid = await fresh('test-judgment-ctrl');
    const msgs = await chat(sid, 'can I get more xanax');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].text, /can't help get controlled/);
  });

  await check('declines personal child dosing', async () => {
    const sid = await fresh('test-judgment-dose');
    const [m] = await chat(sid, 'how much ibuprofen for my 3 year old');
    assert.match(m.text, /can't calculate a medicine dose/);
  });

  await check('new question mid-workflow switches topic', async () => {
    const sid = await fresh('test-switch');
    await chat(sid, 'Book an appointment');
    const [m] = await chat(sid, 'what is a normal blood pressure?');
    assert.match(m.text, /120\/80/);
  });

  // ---- Real actions: manage appointments, refill status, nurse approval ----

  await check('reschedule and cancel by confirmation number', async () => {
    const sid = await fresh('test-manage');
    await chat(sid, 'Book an appointment');
    await chat(sid, 'Follow-up visit');
    const [slots] = await chat(sid, 'In person');
    await chat(sid, slots.options[0]);
    await chat(sid, 'skip');
    const apt = (await chat(sid, 'Confirm booking'))[0].text.match(/APT-\d{6}/)[0];
    const [found] = await chat(sid, `please reschedule ${apt}`);
    assert.match(found.text, /I found it/);
    const [newSlots] = await chat(sid, 'Reschedule');
    assert.ok(!newSlots.options.includes(slots.options[0]), 'booked slot should not be offered again');
    assert.match((await chat(sid, newSlots.options[0]))[0].text, /moved from/);
    await chat(sid, `cancel ${apt}`);
    await chat(sid, 'Cancel it');
    assert.match((await chat(sid, 'Yes, cancel it'))[0].text, /is cancelled/);
  });

  await check('booking confirmation: email, phone, skip, and bad input', async () => {
    const book = async (sid) => {
      await fresh(sid);
      await chat(sid, 'Book an appointment');
      await chat(sid, 'Sick visit');
      const [slots] = await chat(sid, 'Video visit');
      await chat(sid, slots.options[0]);
      await chat(sid, 'sore throat');
      const msgs = await chat(sid, 'Confirm booking');
      // Video visits get a clickable join link in the chat.
      assert.match(msgs[0].text, /\[Join your video visit\]\(https:\/\/meet\.jit\.si\/EMedic-APT-\d{6}-[0-9a-f]{8}\)/);
      return { apt: msgs[0].text.match(/APT-\d{6}/)[0], ask: msgs[0] };
    };
    // Bad input, then email with sending stubbed out (no real email leaves the test).
    const { apt, ask } = await book('test-email');
    assert.match(ask.text, /Want a confirmation\?/);
    assert.deepEqual(ask.options, ['No thanks']);
    assert.match((await chat('test-email', 'not sure'))[0].text, /what can i help|anything|library|rephrase/i, 'non-answers move on');
    const { apt: apt2 } = await book('test-email2');
    assert.match((await chat('test-email2', 'david@gmail'))[0].text, /doesn't look like an email/);
    const realFetch = global.fetch;
    const sent = [];
    process.env.EMAIL_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'clinic@example.com';
    global.fetch = async (url, opts) => {
      if (String(url).includes('api.brevo.com')) { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 201 }); }
      return realFetch(url, opts);
    };
    try {
      const msgs = await chat('test-email2', 'David@Example.com');
      assert.match(msgs[0].text, /Sending your confirmation/);
      assert.match(msgs[1].text, /Confirmation sent to \*\*David@Example.com\*\*/);
    } finally {
      global.fetch = realFetch;
      delete process.env.EMAIL_API_KEY;
      delete process.env.EMAIL_FROM;
    }
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0].email, 'David@Example.com');
    assert.equal(sent[0].sender.email, 'clinic@example.com');
    assert.match(sent[0].subject, /appointment is confirmed/);
    assert.match(sent[0].htmlContent, new RegExp(apt2));
    assert.match(sent[0].htmlContent, /Join video visit/);
    assert.match(sent[0].htmlContent, /https:\/\/meet\.jit\.si\/EMedic-APT-/);
    assert.match(sent[0].textContent, /Join your video visit: https:\/\/meet\.jit\.si\//);
    // Not configured: says so honestly, booking still stands.
    await book('test-email3');
    assert.match((await chat('test-email3', 'pat@example.com'))[1].text, /email isn't set up/);
    // Phone and skip.
    await book('test-phone');
    assert.match((await chat('test-phone', '(555) 123-4567'))[0].text, /text a reminder to \*\*\(555\) 123-4567\*\*/);
    await book('test-skip');
    assert.match((await chat('test-skip', 'No thanks'))[0].text, /Your confirmation number is \*\*APT-\d{6}\*\*/);
    assert.ok(apt);
  });

  await check('email saved in Settings: booking emails it without asking', async () => {
    // The chat page sends the saved email with every message.
    const say = async (sid, message, email) => {
      const { messages } = await post('/api/chat', { sessionId: sid, message, email });
      return messages.slice(messages.findLastIndex((m) => m.from === 'user') + 1);
    };
    const book = async (sid, email) => {
      await say(sid, 'Myself', email);
      await say(sid, 'Book an appointment', email);
      await say(sid, 'Follow-up visit', email);
      const [slots] = await say(sid, 'In person', email);
      await say(sid, slots.options[0], email);
      await say(sid, 'skip', email);
      return say(sid, 'Confirm booking', email);
    };
    const realFetch = global.fetch;
    const sent = [];
    process.env.EMAIL_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'clinic@example.com';
    global.fetch = async (url, opts) => {
      if (String(url).includes('api.brevo.com')) { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 201 }); }
      return realFetch(url, opts);
    };
    let msgs;
    try { msgs = await book('test-saved-email', 'saved@example.com'); } finally {
      global.fetch = realFetch;
      delete process.env.EMAIL_API_KEY;
      delete process.env.EMAIL_FROM;
    }
    assert.match(msgs[0].text, /You're booked!/);
    assert.match(msgs[0].text, /Sending your confirmation to \*\*saved@example.com\*\* \(from your settings\)/);
    assert.ok(!msgs.some((m) => /Want a confirmation\?/.test(m.text)), 'no need to ask');
    assert.match(msgs[1].text, /Confirmation sent to \*\*saved@example.com\*\*/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0].email, 'saved@example.com');
    // A malformed saved email is ignored, so the bot asks as usual.
    const asked = await book('test-bad-saved-email', 'not-an-email');
    assert.match(asked[0].text, /Want a confirmation\?/);
  });

  await check('actions API: booking with an email', async () => {
    const apiKey = { 'Content-Type': 'application/json', 'X-API-Key': 'test-actions-key' };
    const call = (body) => fetch(`${base}/api/actions/appointments`, { method: 'POST', headers: apiKey, body: JSON.stringify(body) });
    assert.equal((await call({ visitType: 'Sick visit', format: 'video', preference: 'earliest', email: 'nope' })).status, 400);
    const ok = await (await call({ visitType: 'Sick visit', format: 'video', preference: 'earliest', email: 'pat@example.com' })).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.emailSent, false);
    assert.match(ok.message, /You're booked/);
    assert.match(ok.message, /email isn't set up/);
    // Video visits come back with a unique join link; in-person visits don't get one.
    assert.match(ok.videoLink, /^https:\/\/meet\.jit\.si\/EMedic-APT-\d{6}-[0-9a-f]{8}$/);
    assert.ok(ok.message.includes(ok.videoLink));
    const inPerson = await (await call({ visitType: 'Sick visit', format: 'In person', preference: 'earliest' })).json();
    assert.equal(inPerson.videoLink, undefined);
    const again = await (await call({ visitType: 'Sick visit', format: 'video', preference: 'earliest' })).json();
    assert.notEqual(again.videoLink, ok.videoLink, 'each visit gets its own room');
  });

  await check('nurse approves refill and patient gets an update', async () => {
    const sid = await fresh('test-approve');
    await chat(sid, 'Refill a prescription');
    await chat(sid, 'metformin 500 mg');
    await chat(sid, 'No');
    await chat(sid, '01/02/1980');
    await chat(sid, 'No refills left');
    await chat(sid, 'Mail order (3–5 days)');
    const rx = (await chat(sid, 'Submit request'))[0].text.match(/RX-\d{6}/)[0];
    assert.match((await chat(sid, `status of ${rx}`))[0].text, /Waiting for provider approval/);
    const reqs = await get('/api/agent/requests');
    assert.ok(reqs.some((r) => r.ref === rx && !('sessionId' in r)), 'request listed without internal session id');
    await post(`/api/agent/refills/${rx}/approve`, {});
    const r = await get(`/api/session/${sid}`);
    assert.ok(r.messages.some((m) => m.update && m.text.includes(rx)));
    assert.match((await chat(sid, `status of ${rx}`))[0].text, /Approved/);
  });

  // ---- Actions API (what an eGain AI Agent would call) ----

  const apiKey = { 'Content-Type': 'application/json', 'X-API-Key': 'test-actions-key' };
  const apiPost = (u, body) => fetch(base + u, { method: 'POST', headers: apiKey, body: JSON.stringify(body) });
  const apiGet = (u) => fetch(base + u, { headers: apiKey });

  await check('actions API requires its key', async () => {
    assert.equal((await fetch(`${base}/api/actions/slots`)).status, 401);
    assert.equal((await fetch(`${base}/api/actions/slots`, { headers: { 'X-API-Key': 'nope' } })).status, 401);
  });

  await check('actions API: book, double-book, look up, cancel', async () => {
    const { slots } = await (await apiGet('/api/actions/slots')).json();
    const booked = await (await apiPost('/api/actions/appointments', { visitType: 'Sick visit', format: 'Video visit', time: slots[0], reason: 'cough' })).json();
    assert.match(booked.ref, /^APT-\d{6}$/);
    assert.match(booked.message, /You're booked/);
    const again = await apiPost('/api/actions/appointments', { visitType: 'Sick visit', format: 'Video visit', time: slots[0] });
    assert.equal(again.status, 409);
    assert.equal((await (await apiGet(`/api/actions/appointments/${booked.ref}`)).json()).status, 'Booked');
    assert.equal((await (await apiPost(`/api/actions/appointments/${booked.ref}/cancel`, {})).json()).status, 'Cancelled');
    assert.equal((await apiGet('/api/actions/appointments/APT-000000')).status, 404);
    // A preference word in the time field books the next matching slot.
    const morning = await (await apiPost('/api/actions/appointments', { visitType: 'Checkup', format: 'In person', time: 'morning' })).json();
    assert.match(morning.time, /AM$/);
    assert.equal((await apiPost('/api/actions/appointments', { visitType: 'Checkup', format: 'In person', time: 'Sun, Jan 1, 9:00 AM' })).status, 409);
  });

  await check('actions API: refill rules and callback', async () => {
    const ctrl = await apiPost('/api/actions/refills', { medication: 'oxycodone', dateOfBirth: '01/01/1990', pharmacy: 'x', controlled: 'Yes' });
    assert.equal(ctrl.status, 422);
    // Refused by name even when the caller doesn't flag it; similar-looking names still go through.
    assert.equal((await apiPost('/api/actions/refills', { medication: 'Adderall XR 20mg', dateOfBirth: '01/01/1990', pharmacy: 'x' })).status, 422);
    assert.equal((await apiPost('/api/actions/refills', { medication: 'amoxicillin', dateOfBirth: '01/01/1990', pharmacy: 'x' })).status, 200);
    const badDob = await apiPost('/api/actions/refills', { medication: 'lisinopril', dateOfBirth: '13/45/1990', pharmacy: 'x' });
    assert.equal(badDob.status, 400);
    const ok = await (await apiPost('/api/actions/refills', { medication: 'lisinopril 10 mg', dateOfBirth: '01/01/1990', pharmacy: 'EMedic Pharmacy', refillsRemaining: 'Yes' })).json();
    assert.equal(ok.status, 'Sent to pharmacy');
    assert.equal((await (await apiGet(`/api/actions/refills/${ok.ref}`)).json()).ref, ok.ref);
    const cb = await (await apiPost('/api/actions/callbacks', { phone: '555-123-4567', bestTime: 'Morning (8 AM–12 PM)' })).json();
    assert.match(cb.ref, /^CB-\d{6}$/);
  });

  await check('actions API: eGain-friendly inputs (preference, soft errors, loose refs, ISO dates)', async () => {
    const booked = await (await apiPost('/api/actions/appointments', { visitType: 'Sick visit', format: 'video', preference: 'Afternoon' })).json();
    assert.ok(booked.ok);
    assert.match(booked.time, /PM$/);
    const loose = await (await apiGet(`/api/actions/appointments/${encodeURIComponent(booked.ref.toLowerCase().replace('-', ' '))}`)).json();
    assert.equal(loose.ref, booked.ref);
    const soft = await apiGet('/api/actions/refills/RX-000000?soft=1');
    assert.equal(soft.status, 200);
    const body = await soft.json();
    assert.equal(body.ok, false);
    assert.match(body.message, /couldn't find/);
    const iso = await (await apiPost('/api/actions/refills', { medication: 'atorvastatin 20 mg', dateOfBirth: '1975-06-30', pharmacy: 'Mail order', refillsRemaining: 'No' })).json();
    assert.equal(iso.dateOfBirth, '06/30/1975');
  });

  await check('actions API: triage levels', async () => {
    const t = async (b) => (await (await apiPost('/api/actions/triage', b)).json()).level;
    assert.equal(await t({ emergencySigns: 'Yes', symptom: 'Fever', ageGroup: '18 to 64', severity: 'Mild', duration: 'Less than 2 days' }), 'emergency');
    assert.equal(await t({ emergencySigns: 'No', symptom: 'Fever', ageGroup: 'Under 3 months', severity: 'Mild', duration: 'Less than 2 days' }), 'emergency');
    assert.equal(await t({ emergencySigns: 'No', symptom: 'Urinary symptoms', ageGroup: '18 to 64', severity: 'Mild', duration: 'Less than 2 days' }), 'same_day_visit');
    assert.equal(await t({ emergencySigns: 'No', symptom: 'Rash or skin', ageGroup: '18 to 64', severity: 'Mild', duration: 'Less than 2 days' }), 'self_care');
    // Free-text answers work too (for workflows built with Text questions).
    assert.equal(await t({ emergencySigns: 'no', symptom: 'my baby has a temperature', ageGroup: '6 weeks', severity: 'seems ok', duration: 'since yesterday' }), 'emergency');
    assert.equal(await t({ emergencySigns: 'no', symptom: 'twisted ankle', ageGroup: '70', severity: 'moderate', duration: '3 days' }), 'same_day_visit');
  });

  await check('public library pages and OpenAPI spec', async () => {
    const index = await (await fetch(`${base}/library`)).text();
    assert.match(index, /EMedic Health Library/);
    const page = await (await fetch(`${base}/library/medications`)).text();
    assert.match(page, /Acetaminophen/);
    const spec = await (await fetch(`${base}/openapi.json`)).json();
    assert.ok(spec.paths['/api/actions/appointments']);
  });

  server.close();
  console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
});
