// Autoplay demo for screen recordings: open /?demo, start recording, then press S.
// It types, clicks and fills forms with a visible cursor while you narrate.
// Keys: S start · → skip the current pause · ↓ pause/resume.
// Demo chats use their own session and never touch your saved name, email or recent chats.
// If you signed in to the Nurse Console in this same tab first, it then continues there by itself.
(function () {
  const onConsole = location.pathname.startsWith('/agent');
  if (!onConsole) {
    const PRIVATE = ['emedic-session', 'emedic-chats', 'emedic-intro-seen', 'emedic-name', 'emedic-email'];
    const mem = {};
    const store = CP.store;
    CP.store = {
      get: (k) => (PRIVATE.includes(k) ? mem[k] ?? null : store.get(k)),
      set: (k, v) => { if (PRIVATE.includes(k)) mem[k] = v; else store.set(k, v); },
    };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let paused = false;
  let skip = false;
  let started = false;

  // Pause between steps so the narration can catch up. Space skips it, P holds it.
  async function hold(ms) {
    const end = Date.now() + ms;
    while ((Date.now() < end || paused) && !skip) await sleep(50);
    skip = false;
  }

  async function until(fn, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('demo: timed out waiting');
  }

  // ---- A visible cursor, so viewers can follow the clicks ----
  const cursor = document.createElement('div');
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.3-3.4-6.9L4 20z" fill="#fff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(cursor.style, { position: 'fixed', left: '50%', top: '60%', zIndex: 99999, pointerEvents: 'none', transition: 'left .55s cubic-bezier(.4,0,.2,1), top .55s cubic-bezier(.4,0,.2,1), transform .12s', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.35))', display: 'none' });

  async function moveTo(el) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await sleep(150);
    const r = el.getBoundingClientRect();
    cursor.style.display = 'block';
    cursor.style.left = `${r.left + Math.min(r.width / 2, 60)}px`;
    cursor.style.top = `${r.top + r.height / 2}px`;
    await sleep(450);
  }
  async function click(el) {
    await moveTo(el);
    cursor.style.transform = 'scale(.82)';
    await sleep(120);
    cursor.style.transform = '';
    el.click();
    await sleep(250);
  }

  // ---- Chat helpers ----
  const botCount = () => document.querySelectorAll('#log .row.bot:not(#thinking)').length;
  async function reply(before) {
    await until(() => botCount() > before && !$('#thinking'));
    await sleep(400); // a step can send more than one message
  }
  async function type(el, text, perChar = 35) {
    el.focus();
    for (let i = 1; i <= text.length; i++) {
      el.value = text.slice(0, i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(perChar);
    }
  }
  async function say(text) {
    const input = $('#input');
    await moveTo(input);
    await type(input, text);
    await sleep(250);
    const before = botCount();
    $('#form').requestSubmit();
    await reply(before);
  }
  async function chip(match) {
    const btn = await until(() => [...document.querySelectorAll('#log .chips button, #log [data-pick]')].find((b) => match.test(b.textContent.trim())));
    const before = botCount();
    await click(btn);
    await reply(before);
  }
  async function fillForm(values) {
    const form = await until(() => $('#log form.intake:not(.locked)'));
    for (const [name, value] of Object.entries(values)) {
      const el = form.elements[name];
      if (!el) continue;
      el.scrollIntoView({ block: 'nearest' });
      if (el.type === 'checkbox') el.checked = value;
      else if (el.tagName === 'SELECT' || el.type === 'date') el.value = value;
      else await type(el, value, 22);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
    }
    const before = botCount();
    await click(form.querySelector('button[type="submit"]'));
    await reply(before);
  }
  const scrollEnd = () => $('#log').lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });

  // ---- The demo ----
  async function run() {
    document.body.appendChild(cursor);
    // 1. Intro screen, then into the app.
    await until(() => $('#startBtn') && !$('#intro')?.hidden);
    await hold(2000);
    await click($('#startBtn'));
    await hold(600);

    // 2. Your name, then a health question answered with its source.
    await moveTo($('#nameInput'));
    await type($('#nameInput'), 'Jordan', 90);
    await click($('#nameSave'));
    await hold(400);
    let before = botCount();
    await click($('#hero [data-say="Myself"]'));
    await reply(before);
    await hold(400);
    await say('How much Tylenol can I take?');
    scrollEnd();
    await hold(3500);

    // 3. Symptom check: a baby with a fever goes straight to the ER.
    await say('Check my symptoms');
    for (const pick of [/^No\b/, /Fever/, /Under 3/, /Mild/, /Less than|1.?2 days|Today/i]) {
      const has = [...document.querySelectorAll('#log .chips button')].some((b) => pick.test(b.textContent));
      if (!has) break;
      await chip(pick);
    }
    scrollEnd();
    await hold(3500);

    // 4. Book a video visit with a nurse by name.
    await say('I want to see Maria Gonzalez');
    await hold(300);
    await chip(/^Sick visit$/);
    await fillForm({ fullName: 'Jordan Smith', dob: '1992-05-14', phone: '(555) 201-3344', insurance: 'Aetna', memberId: 'AET55821', language: 'English', reason: 'Sore throat and fever for 2 days', consent: true });
    await hold(500);
    await chip(/AM|PM/);
    await hold(800);
    await chip(/^Confirm booking$/);
    scrollEnd();
    await hold(3500);

    // 5. Real doctors anywhere in the U.S. for in-person care.
    await say('Find a pediatrician near 10001');
    scrollEnd();
    await hold(3500);

    // 6. Emergencies are caught in any message.
    await say('My dad has chest pain and can\'t breathe');
    scrollEnd();
    await hold(3500);

    // 7. Over to the Nurse Console (only if you're signed in to it in this tab).
    let signedIn = false;
    try { signedIn = Boolean(sessionStorage.getItem('emedic-staff-passcode')); } catch { /* private mode */ }
    if (signedIn) location.href = '/agent?demo';
    else cursor.style.display = 'none';
  }

  // The Nurse Console part: the booking that was just made, then the nurse-managed schedule.
  async function runConsole() {
    document.body.appendChild(cursor);
    await sleep(1200);
    if (!$('#login').hidden) return; // not signed in: leave the page as it is
    await hold(800);
    await click($('#tabRequests'));
    const findCard = () => [...document.querySelectorAll('#requests .req')].find((c) => /Jordan Smith/.test(c.textContent));
    await moveTo(await until(findCard));
    // The list redraws every couple of seconds, so keep putting the highlight back.
    const light = setInterval(() => { const c = findCard(); if (c) c.style.boxShadow = '0 0 0 3px #2dd4bf'; }, 150);
    await hold(3500);
    clearInterval(light);
    const c = findCard();
    if (c) c.style.boxShadow = '';
    await click($('#tabSchedule'));
    await hold(2500);
    cursor.style.display = 'none';
  }
  if (onConsole) {
    started = true; // it carries on from the chat by itself; → and ↓ still work
    (document.readyState === 'loading' ? new Promise((r) => document.addEventListener('DOMContentLoaded', r)) : Promise.resolve())
      .then(runConsole).catch((err) => console.error(err));
  }

  // The demo types into the page itself, so its controls use keys that never type anything.
  document.addEventListener('keydown', (e) => {
    if (!started && e.key.toLowerCase() === 's' && !e.target.closest?.('input, textarea, select')) {
      e.preventDefault();
      started = true;
      run().catch((err) => console.error(err));
    } else if (started && e.key === 'ArrowRight') { e.preventDefault(); skip = true; } // skip this pause
    else if (started && e.key === 'ArrowDown') { e.preventDefault(); paused = !paused; } // pause / resume
  }, true);
}());
