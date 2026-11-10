// Tiny JSON-file store for appointments, refill requests and callbacks.
// Good enough for a demo: one process, small data, survives restarts (until the host wipes its disk).
const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'store.json');
const EMPTY = { appointments: {}, refills: {}, callbacks: {}, slots: {}, meta: {} };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

const db = load();

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Could not save data file:', err.message);
  }
}

function put(collection, record) {
  db[collection][record.ref] = record;
  save();
  return record;
}

const get = (collection, ref) => db[collection][String(ref || '').toUpperCase()] || null;
const all = (collection) => Object.values(db[collection]);

function remove(collection, ref) {
  delete db[collection][String(ref || '').toUpperCase()];
  save();
}

module.exports = { put, get, all, remove, save };
