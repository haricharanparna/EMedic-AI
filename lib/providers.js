// Real U.S. clinicians from the public NPI Registry (CMS NPPES), for "find a provider near me".
// Shows only who they are and where they practice: name, credential, specialty, practice address, map link.
// Phone and fax numbers are deliberately left out.
const API = 'https://npiregistry.cms.hhs.gov/api/';

// Search types: what to ask the registry for, and how to check a provider really has that specialty.
const TYPES = {
  family: { label: 'Family medicine doctor', query: 'Family Medicine', match: /family medicine/i },
  internal: { label: 'Internal medicine doctor', query: 'Internal Medicine', match: /^internal medicine/i },
  pediatrics: { label: 'Pediatrician (children)', query: 'Pediatrics', match: /pediatric/i },
  np: { label: 'Nurse practitioner', query: 'Nurse Practitioner', match: /nurse practitioner/i },
  // The registry files psychiatrists and neurologists together; keep only the psychiatry ones.
  psychiatry: { label: 'Psychiatrist', query: 'Psychiatry & Neurology', match: /^psychiatry & neurology, .*psychiatry/i },
  therapy: { label: 'Psychologist / therapist', query: 'Psychologist', match: /^psychologist(?!, school)/i },
  obgyn: { label: 'OB-GYN (women\'s health)', query: 'Obstetrics & Gynecology', match: /obstetrics & gynecology/i },
  dentist: { label: 'Dentist', query: 'Dentist', match: /^dentist/i },
};

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
};

// The state for each ZIP code, by its first three digits (USPS ranges: [first, last, state]).
const ZIP3 = [
  [5, 5, 'NY'], [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'],
  [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'],
  [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'], [206, 219, 'MD'],
  [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'],
  [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'],
  [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [569, 569, 'DC'],
  [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
  [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'],
  [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'],
  [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [969, 969, 'GU'], [970, 979, 'OR'], [980, 994, 'WA'],
  [995, 999, 'AK'],
];
const stateForZip = (zip) => {
  const n = Number(String(zip).slice(0, 3));
  return (ZIP3.find(([a, b]) => n >= a && n <= b) || [])[2] || null;
};

// "TX", "tx" or "Texas" → "TX".
function stateCode(s) {
  const t = String(s || '').trim().replace(/\.$/, '');
  if (STATES[t.toUpperCase()]) return t.toUpperCase();
  return Object.keys(STATES).find((k) => STATES[k].toLowerCase() === t.toLowerCase()) || null;
}

// "Austin, TX", "Austin Texas" or "Austin" → { city, state }.
const STATE_NAMES = Object.values(STATES).sort((a, b) => b.length - a.length).map((n) => n.replace(/\./g, '\\.').replace(/ /g, '\\s+')).join('|');
const CITY_STATE_RE = new RegExp(`^(.+?)(?:,\\s*|\\s+)(${STATE_NAMES}|[A-Za-z]{2})$`, 'i');
function splitCityState(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  const m = t.match(CITY_STATE_RE);
  // A two-letter ending only counts as a state after a comma or in capitals ("Austin, tx", "Austin TX"), so "Ft Lee" stays a city.
  if (m && stateCode(m[2]) && (m[2].length > 2 || /,/.test(t) || m[2] === m[2].toUpperCase())) return { city: m[1].trim(), state: stateCode(m[2]) };
  return { city: t, state: null };
}

const cache = new Map(); // query → { at, results }, so repeat searches don't hit the registry again
const CACHE_MS = 60 * 60 * 1000;

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

// Find a type from words like "pediatrician", "therapist", "ob-gyn", "family doctor".
function typeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/pediatric|children'?s doctor|kids? doctor/.test(t)) return 'pediatrics';
  if (/psychiatr/.test(t)) return 'psychiatry';
  if (/therap|psycholog|counsel/.test(t)) return 'therapy';
  if (/ob.?gyn|gyn|obstetric|women'?s health/.test(t)) return 'obgyn';
  if (/dentist|dental/.test(t)) return 'dentist';
  if (/nurse practitioner|\bnp\b/.test(t)) return 'np';
  if (/internist|internal medicine/.test(t)) return 'internal';
  if (/family|primary care|pcp|general|doctor|physician/.test(t)) return 'family';
  return null;
}

function toProvider(r, type) {
  const b = r.basic || {};
  const loc = (r.addresses || []).find((a) => a.address_purpose === 'LOCATION') || {};
  const tax = (r.taxonomies || []).find((t) => type.match.test(t.desc || '') && t.primary)
    || (r.taxonomies || []).find((t) => type.match.test(t.desc || ''));
  if (!tax || !STATES[loc.state]) return null;
  const zip = String(loc.postal_code || '').slice(0, 5);
  const street = titleCase([loc.address_1, loc.address_2].filter(Boolean).join(', '));
  const city = titleCase(loc.city);
  const name = [b.first_name, b.middle_name ? `${b.middle_name[0]}.` : '', b.last_name].filter(Boolean).map(titleCase).join(' ');
  const address = `${street}, ${city}, ${loc.state} ${zip}`;
  return {
    npi: r.number,
    name,
    credential: (b.credential || '').replace(/\./g, '').trim(),
    specialty: tax.desc,
    address,
    city,
    state: loc.state,
    zip,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    registryUrl: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
  };
}

async function lookup(params) {
  const key = params.toString();
  let raw = cache.get(key);
  if (!raw || Date.now() - raw.at > CACHE_MS) {
    const res = await fetch(`${API}?${key}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`NPI Registry error ${res.status}`);
    const json = await res.json();
    raw = { at: Date.now(), results: json.results || [] };
    cache.set(key, raw);
  }
  return raw.results;
}

// search({ zip: '10001' } or { city: 'Austin', state: 'TX' } or { city: 'Austin, TX' }, type: 'family', limit)
// → { results, total, where, source }
async function search({ zip, city, state, type = 'family', limit = 8 } = {}) {
  const t = TYPES[type];
  if (!t) throw new Error(`type must be one of: ${Object.keys(TYPES).join(', ')}`);
  zip = String(zip || '').trim().slice(0, 5);
  const split = splitCityState(String(city || '').slice(0, 60));
  city = split.city;
  state = stateCode(state) || split.state;
  if (zip && !/^\d{5}$/.test(zip)) return { results: [], total: 0, error: 'Please use a 5-digit U.S. ZIP code, like 10001 or 94110.' };
  if (zip && !(state = stateForZip(zip))) return { results: [], total: 0, error: 'I don\'t recognize that ZIP code. Try another U.S. ZIP code or a city and state.' };
  if (!zip && !city) return { results: [], total: 0, error: 'Tell me a U.S. ZIP code, or a city and state (like Austin, TX).' };

  const params = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', taxonomy_description: t.query, limit: '200' });
  if (state) params.set('state', state);
  if (zip) params.set('postal_code', `${zip.slice(0, 3)}*`); else params.set('city', city.toUpperCase());
  const raw = await lookup(params);

  const seen = new Set();
  let all = raw.map((r) => toProvider(r, t)).filter((p) => p && !seen.has(p.npi) && seen.add(p.npi))
    // A search by ZIP keeps practices in that area; by city, practices in that city.
    .filter((p) => (zip ? p.zip.startsWith(zip.slice(0, 3)) : p.city.toLowerCase() === city.toLowerCase()));
  // A city with no state ("Springfield"): use the state where that city has the most listings.
  let guessed = false;
  if (!zip && !state && all.length) {
    const counts = {};
    for (const p of all) counts[p.state] = (counts[p.state] || 0) + 1;
    state = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    guessed = Object.keys(counts).length > 1;
    all = all.filter((p) => p.state === state);
  }
  // Same ZIP first, then nearest ZIP number (a rough stand-in for distance), then name.
  const z = Number(zip);
  all.sort((a, b) => (zip ? Math.abs(Number(a.zip) - z) - Math.abs(Number(b.zip) - z) : 0) || a.name.localeCompare(b.name));
  const where = zip || [titleCase(city), state].filter(Boolean).join(', ');
  return { results: all.slice(0, limit), total: all.length, type: t.label, where, guessedState: guessed, source: 'U.S. NPI Registry (CMS)' };
}

module.exports = { TYPES, STATES, search, typeFromText, stateCode, stateForZip, splitCityState };
