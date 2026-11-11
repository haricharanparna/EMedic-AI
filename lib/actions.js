// Actions the assistant takes on a patient's behalf. Used by the chat workflows AND by the
// public Actions API (so an eGain AI Agent can call the same logic over REST).
// Every result carries a patient-friendly `message` that can be shown as-is.
const crypto = require('node:crypto');
const store = require('./store');
const schedule = require('./schedule');
const nurses = require('./nurses');
const { EMAIL_RE } = require('./email');

const NURSE_LINE = '(555) 010-6877';
const NO_TIMES = "Sorry, there aren't any open appointment times right now. A nurse can find you one: call (555) 010-2273 or ask to talk to a nurse.";

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
function pickSlot(preference, nurseIds) {
  const slots = listSlots({ count: 200, nurseIds }); // look through the whole schedule for the next matching time
  const p = clean(preference).toLowerCase();
  if (p.startsWith('morn')) return slots.find((s) => /AM$/.test(s));
  if (p.startsWith('after') || p.startsWith('even')) return slots.find((s) => /PM$/.test(s));
  return slots[0];
}

// Resolve a requested time: an exact slot label, or a preference like "morning" / "earliest" in either field.
function resolveTime(body, nurseIds) {
  const open = listSlots({ count: 200, nurseIds });
  const asked = clean(body.time, 60);
  if (asked && open.includes(asked)) return asked;
  const pref = asked && /\b(morn|after|even|earl|soon|asap|any|first|next)/i.test(asked) ? asked : clean(body.preference);
  if (pref) return pickSlot(pref, nurseIds) || null;
  if (asked) {
    const next = listSlots({ nurseIds });
    throw new ActionError(409, 'slot_unavailable', next.length ? `Sorry, ${asked} isn't open. Next available: ${next.join('; ')}.` : NO_TIMES);
  }
  return null;
}

// Controlled substances are never refilled through chat, whatever the caller says.
const CONTROLLED_RE = /\b(xanax|alprazolam|adderall|amphetamine|ritalin|methylphenidate|vyvanse|oxy\w*|percocet|vicodin|hydrocodone|codeine|morphine|fentanyl|tramadol|valium|diazepam|klonopin|clonazepam|ativan|lorazepam|ambien|zolpidem|suboxone|buprenorphine|opioids?|benzos?)\b/i;

// ---------- Appointments ----------

const VISIT_TYPES = ['Sick visit', 'Annual physical / checkup', 'Follow-up visit', 'Mental health'];
// EMedic books online (video) visits only. For in-person care, patients look up real providers near them.
const IN_PERSON_MSG = 'EMedic books video visits only. For an in-person visit, search real providers near you by ZIP code or city (the providers lookup), then contact their office.';

// Next open times, from the schedule the care team manages in the Nurse Console.
// `nurseIds` limits it to times with those nurses.
const listSlots = ({ count = 4, nurseIds } = {}) => schedule.openSlots({ count, nurseIds });
const slotNurseId = (label) => schedule.slotByLabel(label)?.nurseId || null;

function bookAppointment(body) {
  need(['visitType'], body);
  if (!clean(body.time) && !clean(body.preference)) throw new ActionError(400, 'missing_fields', 'Missing: time or preference');
  const visitType = VISIT_TYPES.find((v) => v.toLowerCase() === clean(body.visitType).toLowerCase()) || clean(body.visitType, 60);
  if (/person|office|clinic/i.test(clean(body.format))) throw new ActionError(400, 'in_person_unavailable', IN_PERSON_MSG);
  const format = 'Video visit';
  const email = clean(body.email, 120);
  if (email && !EMAIL_RE.test(email)) throw new ActionError(400, 'bad_email', "That email address doesn't look right. Please check it, like name@example.com.");
  // Who: a chosen nurse (by id or name), or anyone who can do this kind of visit.
  const wanted = clean(body.nurseId, 60) || clean(body.nurse, 60);
  const chosen = wanted ? nurses.get(wanted) || nurses.find(wanted) : null;
  if (wanted && !chosen) throw new ActionError(400, 'bad_nurse', `I couldn't find a nurse called ${wanted}. Ask for the list of nurses to see who's available.`);
  const pool = chosen ? [chosen] : nurses.eligible({ visitType: VISIT_TYPES.includes(visitType) ? visitType : null });
  const nurseIds = pool.map((n) => n.id);
  const time = resolveTime(body, nurseIds);
  if (!time) throw new ActionError(409, 'slot_unavailable', listSlots({ nurseIds }).length ? 'Sorry, there are no open times like that right now. Please try another time of day.' : NO_TIMES);
  // The time's own nurse; for a time with no nurse attached, whoever was chosen or the first suitable one.
  const nurse = nurses.get(schedule.slotByLabel(time)?.nurseId) || chosen || pool[0] || null;
  const ref = newRef('APT', 'appointments');
  const intake = {};
  for (const k of ['patientName', 'dateOfBirth', 'phone', 'insurance', 'memberId', 'language']) if (clean(body[k])) intake[k] = clean(body[k], 80);
  const rec = store.put('appointments', {
    ref, type: 'appointment', visitType, format, time,
    reason: clean(body.reason) || 'Not given',
    ...(nurse ? { nurseId: nurse.id, nurseName: `${nurse.name}, ${nurse.title.split(',')[0]}` } : {}),
    ...intake,
    videoLink: videoLinkFor(ref),
    ...(email ? { email } : {}),
    status: 'Booked', sessionId: body.sessionId || null, createdAt: new Date().toISOString(),
  });
  const withWho = rec.nurseName ? ` with ${rec.nurseName}` : '';
  return { ...publicView(rec), message: `You're booked for ${time}${withWho} (${visitType.toLowerCase()}, ${format.toLowerCase()}). Confirmation ${ref}. ${visitInstructions(rec)}` };
}

// Video visits get their own Jitsi Meet room: free, opens in any browser, no app or account for the patient.
// The random part keeps the room name from being guessed from the confirmation number.
function videoLinkFor(ref) {
  return `https://meet.jit.si/EMedic-${ref}-${crypto.randomBytes(4).toString('hex')}`;
}

function visitInstructions(rec) {
  return rec.videoLink
    ? `Join your video visit here: ${rec.videoLink} (opens in your browser, no app needed). Join about 5 minutes early.`
    : 'Please arrive 10 minutes early with your insurance card and photo ID.'; // older in-person bookings
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
  const join = rec.videoLink && rec.status === 'Booked' ? ` Video link: ${rec.videoLink}` : '';
  return { ...publicView(rec), message: `${rec.ref}: ${rec.visitType} (${rec.format.toLowerCase()}) on ${rec.time}. Status: ${rec.status}.${join}` };
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
  // Stay with the same nurse: only their open times count.
  const time = resolveTime(body, rec.nurseId ? [rec.nurseId] : undefined);
  if (!time) throw new ActionError(409, 'slot_unavailable', 'Sorry, that time is no longer available. Please pick another time.');
  const old = rec.time;
  rec.time = time;
  rec.updatedAt = new Date().toISOString();
  store.put('appointments', rec);
  return { ...publicView(rec), message: `Done! ${rec.ref} moved from ${old} to ${time}.${rec.videoLink ? ` Your video link stays the same: ${rec.videoLink}` : ''}` };
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
  setAppointmentContact, visitInstructions, slotNurseId,
  ActionError, NURSE_LINE, VISIT_TYPES,
  listSlots, bookAppointment, getAppointment, cancelAppointment, rescheduleAppointment,
  requestRefill, getRefill, decideRefill,
  requestCallback, completeCallback, listRequests,
};
