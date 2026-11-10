// Actions the assistant takes on a patient's behalf. Used by the chat workflows AND by the
// public Actions API (so an eGain AI Agent can call the same logic over REST).
// Every result carries a patient-friendly `message` that can be shown as-is.
const store = require('./store');
const { EMAIL_RE } = require('./email');

const NURSE_LINE = '(555) 010-6877';

class ActionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function newRef(prefix, collection) {
  let ref;
  do ref = `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
  while (store.get(collection, ref));
  return ref;
}

function need(fields, body) {
  const missing = fields.filter((f) => !String(body[f] ?? '').trim());
  if (missing.length) throw new ActionError(400, 'missing_fields', `Missing: ${missing.join(', ')}`);
}

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// Accept "apt 123456", "apt-123456", "123456" … and return "APT-123456".
function norm(ref, prefix) {
  const m = String(ref ?? '').match(/(\d{6})/);
  return m ? `${prefix}-${m[1]}` : clean(ref, 20).toUpperCase();
}

// Pick a slot by preference ("earliest", "morning", "afternoon") for callers that can't show a list.
function pickSlot(preference) {
  const slots = listSlots({ count: 12 });
  const p = clean(preference).toLowerCase();
  if (p.startsWith('morn')) return slots.find((s) => /AM$/.test(s));
  if (p.startsWith('after') || p.startsWith('even')) return slots.find((s) => /PM$/.test(s));
  return slots[0];
}

// Resolve a requested time: an exact slot label, or a preference like "morning" / "earliest" in either field.
function resolveTime(body) {
  const open = listSlots({ count: 40 });
  const asked = clean(body.time, 60);
  if (asked && open.includes(asked)) return asked;
  const pref = asked && /\b(morn|after|even|earl|soon|asap|any|first|next)/i.test(asked) ? asked : clean(body.preference);
  if (pref) return pickSlot(pref) || null;
  if (asked) throw new ActionError(409, 'slot_unavailable', `Sorry, ${asked} isn't open. Next available: ${listSlots().join('; ')}.`);
  return null;
}

// Controlled substances are never refilled through chat, whatever the caller says.
const CONTROLLED_RE = /\b(xanax|alprazolam|adderall|amphetamine|ritalin|methylphenidate|vyvanse|oxy\w*|percocet|vicodin|hydrocodone|codeine|morphine|fentanyl|tramadol|valium|diazepam|klonopin|clonazepam|ativan|lorazepam|ambien|zolpidem|suboxone|buprenorphine|opioids?|benzos?)\b/i;

// ---------- Appointments ----------

const VISIT_TYPES = ['Sick visit', 'Annual physical / checkup', 'Follow-up visit', 'Mental health', 'Vaccine only'];
const FORMATS = ['In person', 'Video visit'];

// Next open slots over the next business days, minus anything already booked.
function listSlots({ count = 4 } = {}) {
  const booked = new Set(store.all('appointments').filter((a) => a.status === 'Booked').map((a) => a.time));
  const times = ['9:00 AM', '10:15 AM', '1:00 PM', '3:30 PM'];
  const slots = [];
  const d = new Date();
  for (let day = 0; day < 10 && slots.length < count; day++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    // Two open times per day keeps the choices varied across days.
    for (const t of [times[day % 4], times[(day + 2) % 4]]) {
      const slot = `${label}, ${t}`;
      if (!booked.has(slot) && slots.length < count) slots.push(slot);
    }
  }
  return slots;
}

function bookAppointment(body) {
  need(['visitType', 'format'], body);
  if (!clean(body.time) && !clean(body.preference)) throw new ActionError(400, 'missing_fields', 'Missing: time or preference');
  const visitType = VISIT_TYPES.find((v) => v.toLowerCase() === clean(body.visitType).toLowerCase()) || clean(body.visitType, 60);
  const format = FORMATS.find((v) => v.toLowerCase().startsWith(clean(body.format).toLowerCase().slice(0, 5)));
  if (!format) throw new ActionError(400, 'bad_format', `format must be one of: ${FORMATS.join(', ')}`);
  const email = clean(body.email, 120);
  if (email && !EMAIL_RE.test(email)) throw new ActionError(400, 'bad_email', "That email address doesn't look right. Please check it, like name@example.com.");
  const time = resolveTime(body);
  if (!time) throw new ActionError(409, 'slot_unavailable', 'Sorry, there are no open times like that this week. Please try another time of day.');
  const ref = newRef('APT', 'appointments');
  const rec = store.put('appointments', {
    ref, type: 'appointment', visitType, format, time,
    reason: clean(body.reason) || 'Not given',
    ...(email ? { email } : {}),
    status: 'Booked', sessionId: body.sessionId || null, createdAt: new Date().toISOString(),
  });
  const where = format === 'Video visit'
    ? 'Join from the MyEMedic app about 5 minutes early. The link appears there 15 minutes before.'
    : 'Please arrive 10 minutes early with your insurance card and photo ID.';
  return { ...publicView(rec), message: `You're booked for ${time} (${visitType.toLowerCase()}, ${format.toLowerCase()}). Confirmation ${ref}. ${where}` };
}

function setAppointmentContact(ref, contact) {
  const rec = store.get('appointments', norm(ref, 'APT'));
  if (!rec) return null;
  Object.assign(rec, contact, { updatedAt: new Date().toISOString() });
  return store.put('appointments', rec);
}

function getAppointment(ref) {
  ref = norm(ref, 'APT');
  const rec = store.get('appointments', ref);
  if (!rec) throw new ActionError(404, 'not_found', `I couldn't find an appointment with confirmation number ${clean(ref, 20)}. Please check the number.`);
  return { ...publicView(rec), message: `${rec.ref}: ${rec.visitType} (${rec.format.toLowerCase()}) on ${rec.time}. Status: ${rec.status}.` };
}

function cancelAppointment(ref) {
  ref = norm(ref, 'APT');
  const rec = store.get('appointments', ref);
  if (!rec) return getAppointment(ref);
  if (rec.status === 'Cancelled') return { ...publicView(rec), message: `${rec.ref} was already cancelled.` };
  rec.status = 'Cancelled';
  rec.updatedAt = new Date().toISOString();
  store.put('appointments', rec);
  return { ...publicView(rec), message: `Your ${rec.time} appointment (${rec.ref}) is cancelled. That time is now open for other patients. Thank you for letting us know!` };
}

function rescheduleAppointment(ref, body) {
  ref = norm(ref, 'APT');
  const rec = store.get('appointments', ref);
  if (!rec) return getAppointment(ref);
  if (rec.status === 'Cancelled') throw new ActionError(409, 'cancelled', `${rec.ref} was cancelled, so it can't be moved. Book a new appointment instead.`);
  if (!clean(body.time) && !clean(body.preference)) throw new ActionError(400, 'missing_fields', 'Missing: time or preference');
  const time = resolveTime(body);
  if (!time) throw new ActionError(409, 'slot_unavailable', 'Sorry, that time is no longer available. Please pick another time.');
  const old = rec.time;
  rec.time = time;
  rec.updatedAt = new Date().toISOString();
  store.put('appointments', rec);
  return { ...publicView(rec), message: `Done! ${rec.ref} moved from ${old} to ${time}. You'll get an updated reminder text.` };
}

// ---------- Prescription refills ----------

const DOB_RE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/;

function requestRefill(body) {
  need(['medication', 'dateOfBirth', 'pharmacy'], body);
  if (/^y/i.test(clean(body.controlled)) || CONTROLLED_RE.test(clean(body.medication))) {
    throw new ActionError(422, 'controlled_medication', "Controlled medications can't be refilled through chat for safety reasons. Please contact your provider's office, or a nurse can pass along a message.");
  }
  let dob = clean(body.dateOfBirth, 10);
  const iso = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) dob = `${iso[2]}/${iso[3]}/${iso[1]}`;
  if (!DOB_RE.test(dob) || new Date(dob) > new Date()) throw new ActionError(400, 'bad_dob', 'Date of birth must look like MM/DD/YYYY.');
  const hasRefills = /^y/i.test(clean(body.refillsRemaining));
  const ref = newRef('RX', 'refills');
  const rec = store.put('refills', {
    ref, type: 'refill',
    medication: clean(body.medication, 80), dateOfBirth: dob,
    refillsRemaining: hasRefills ? 'Yes' : /^n(o\b|one)/i.test(clean(body.refillsRemaining)) ? 'No' : 'Not sure',
    pharmacy: clean(body.pharmacy, 100),
    status: hasRefills ? 'Sent to pharmacy' : 'Waiting for provider approval',
    sessionId: body.sessionId || null, createdAt: new Date().toISOString(),
  });
  const timing = hasRefills
    ? "It's usually ready within 24 hours."
    : 'Your provider needs to approve it first. That takes up to 2 business days.';
  return { ...publicView(rec), message: `Refill request ${ref} for ${rec.medication} is in. ${timing} You'll get a text when it's ready. If you're down to your last dose, call the Nurse Line at ${NURSE_LINE}.` };
}

function getRefill(ref) {
  ref = norm(ref, 'RX');
  const rec = store.get('refills', ref);
  if (!rec) throw new ActionError(404, 'not_found', `I couldn't find a refill request numbered ${clean(ref, 20)}. Please check the number.`);
  const next = {
    'Sent to pharmacy': 'It should be ready for pickup within 24 hours of the request.',
    'Waiting for provider approval': 'Your provider usually responds within 2 business days.',
    'Approved, sent to pharmacy': 'It should be ready within 24 hours.',
    'Not approved': 'Your care team will contact you about next steps.',
  }[rec.status] || '';
  return { ...publicView(rec), message: `${rec.ref} (${rec.medication}): **${rec.status}**. ${next}` };
}

function decideRefill(ref, approve) {
  const rec = store.get('refills', norm(ref, 'RX'));
  if (!rec) throw new ActionError(404, 'not_found', 'Refill request not found.');
  rec.status = approve ? 'Approved, sent to pharmacy' : 'Not approved';
  rec.updatedAt = new Date().toISOString();
  store.put('refills', rec);
  return rec;
}

// ---------- Nurse callbacks ----------

const PHONE_RE = /^\D*(\d\D*){10,11}$/;

function requestCallback(body) {
  need(['phone'], body);
  const phone = clean(body.phone, 30);
  if (!PHONE_RE.test(phone)) throw new ActionError(400, 'bad_phone', 'Please give a 10-digit phone number.');
  const ref = newRef('CB', 'callbacks');
  const rec = store.put('callbacks', {
    ref, type: 'callback', phone,
    bestTime: clean(body.bestTime, 40) || 'As soon as possible',
    reason: clean(body.reason, 300) || 'Not given',
    status: 'Waiting for nurse', sessionId: body.sessionId || null, createdAt: new Date().toISOString(),
  });
  return { ...publicView(rec), message: `An EMedic nurse will call ${phone} (${rec.bestTime.toLowerCase()}). Reference ${ref}. If this becomes an emergency, call 911.` };
}

function completeCallback(ref) {
  const rec = store.get('callbacks', norm(ref, 'CB'));
  if (!rec) throw new ActionError(404, 'not_found', 'Callback not found.');
  rec.status = 'Completed';
  rec.updatedAt = new Date().toISOString();
  store.put('callbacks', rec);
  return rec;
}

// ---------- Listing for the nurse console ----------

function listRequests() {
  const rank = (r) => (/Waiting/.test(r.status) ? 0 : 1);
  return [...store.all('refills'), ...store.all('callbacks'), ...store.all('appointments')]
    .sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60)
    .map(publicView);
}

// Never send the internal session id outside the server.
function publicView(rec) {
  const { sessionId, ...rest } = rec;
  return rest;
}

module.exports = {
  setAppointmentContact,
  ActionError, NURSE_LINE, VISIT_TYPES, FORMATS,
  listSlots, bookAppointment, getAppointment, cancelAppointment, rescheduleAppointment,
  requestRefill, getRefill, decideRefill,
  requestCallback, completeCallback, listRequests,
};
