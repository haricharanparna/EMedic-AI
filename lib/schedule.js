// Appointment times the care team opens in the Nurse Console. The bot (and the Actions API) only offers these.
// Times are clinic-local "YYYY-MM-DDTHH:MM" strings, so showing them never needs timezone math.
const store = require('./store');
const nurses = require('./nurses');

const TZ = process.env.CLINIC_TZ || 'America/New_York';
const START_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
// The times "Add a standard day" fills in, and what a brand-new schedule starts with.
const STANDARD_TIMES = ['09:00', '10:15', '13:00', '15:30'];

class ScheduleError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// "Now" in clinic time, in the same format as slot times (so plain string comparison works).
function nowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "2026-11-10T09:00" → "Tue, Nov 10, 9:00 AM" (the label patients see and bookings store).
function label(start) {
  const [, y, mo, d, h, mi] = start.match(START_RE).map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day}, ${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function validStart(start) {
  const m = String(start || '').match(START_RE);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60;
}

// First run: open four times a day for the next 10 weekdays, rotating through the care team,
// so the demo has something to book with every nurse.
function seedIfNew() {
  if (store.get('meta', 'SLOTS_SEEDED')) return;
  const today = nowLocal().slice(0, 10);
  const [y, mo, d] = today.split('-').map(Number);
  for (let i = 1, days = 0; days < 10 && i < 20; i++) {
    const dt = new Date(Date.UTC(y, mo - 1, d + i));
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    const date = dt.toISOString().slice(0, 10);
    // Shift the rotation each day so every nurse gets a mix of mornings and afternoons.
    for (const [k, t] of STANDARD_TIMES.entries()) {
      const start = `${date}T${t}`;
      const nurse = nurses.NURSES[(days * 5 + k) % nurses.NURSES.length];
      store.put('slots', { ref: start, start, label: label(start), nurseId: nurse.id, createdBy: 'Default schedule', createdAt: new Date().toISOString() });
    }
    days++;
  }
  store.put('meta', { ref: 'SLOTS_SEEDED', at: new Date().toISOString() });
}

const bookings = () => new Map(store.all('appointments').filter((a) => a.status === 'Booked').map((a) => [a.time, a]));

// Upcoming slots, soonest first, with who (if anyone) has booked each one.
function upcoming() {
  seedIfNew();
  const now = nowLocal();
  const booked = bookings();
  return store.all('slots')
    .filter((s) => s.start > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => ({ ...s, nurseName: nurses.get(s.nurseId)?.name || null, booking: booked.get(s.label) || null }));
}

// What patients can pick from: the next `count` open times.
function openSlots({ count = 4, nurseIds } = {}) {
  return openSlotRecords({ nurseIds }).slice(0, count).map((s) => s.label);
}
function openSlotRecords({ nurseIds } = {}) {
  return upcoming().filter((s) => !s.booking && (!nurseIds || !s.nurseId || nurseIds.includes(s.nurseId)));
}
const slotByLabel = (lbl) => upcoming().find((s) => s.label === lbl) || null;

function addSlot(start, by, nurseId) {
  start = String(start || '').trim();
  if (!validStart(start)) throw new ScheduleError(400, 'bad_time', 'Pick a date and time.');
  if (start <= nowLocal()) throw new ScheduleError(400, 'past_time', `${label(start)} is in the past.`);
  if (store.get('slots', start)) throw new ScheduleError(409, 'duplicate', `${label(start)} is already open.`);
  if (nurseId && !nurses.get(nurseId)) throw new ScheduleError(400, 'bad_nurse', 'Pick a nurse from the list.');
  return store.put('slots', { ref: start, start, label: label(start), ...(nurseId ? { nurseId } : {}), createdBy: String(by || 'Care team').slice(0, 60), createdAt: new Date().toISOString() });
}

function removeSlot(start) {
  const slot = store.get('slots', start);
  if (!slot) throw new ScheduleError(404, 'not_found', 'That time is not on the schedule.');
  const booking = bookings().get(slot.label);
  if (booking) throw new ScheduleError(409, 'booked', `${slot.label} is booked (${booking.ref}). Cancel or move that appointment first.`);
  store.remove('slots', start);
  return { removed: slot.label };
}

module.exports = { ScheduleError, STANDARD_TIMES, TZ, nowLocal, label, upcoming, openSlots, openSlotRecords, slotByLabel, addSlot, removeSlot };
