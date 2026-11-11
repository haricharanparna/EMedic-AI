// Real Virginia clinicians from the public U.S. NPI Registry (CMS NPPES), for "find a provider near me".
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

// Virginia ZIP codes start with 201 or 220–246.
const VA_ZIP = /^(201|2[23]\d|24[0-6])\d{2}$/;

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
  if (!tax || loc.state !== 'VA') return null;
  const zip = String(loc.postal_code || '').slice(0, 5);
  const street = titleCase([loc.address_1, loc.address_2].filter(Boolean).join(', '));
  const city = titleCase(loc.city);
  const name = [b.first_name, b.middle_name ? `${b.middle_name[0]}.` : '', b.last_name].filter(Boolean).map(titleCase).join(' ');
  return {
    npi: r.number,
    name,
    credential: (b.credential || '').replace(/\./g, '').trim(),
    specialty: tax.desc,
    address: `${street}, ${city}, VA ${zip}`,
    city,
    zip,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${street}, ${city}, VA ${zip}`)}`,
    registryUrl: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
  };
}

// search({ zip: '20171' } or { city: 'Herndon' }, type: 'family', limit) → { results, total, source }
async function search({ zip, city, type = 'family', limit = 8 } = {}) {
  const t = TYPES[type];
  if (!t) throw new Error(`type must be one of: ${Object.keys(TYPES).join(', ')}`);
  zip = String(zip || '').trim().slice(0, 5);
  city = String(city || '').trim().replace(/,?\s*(va|virginia)$/i, '').slice(0, 40);
  if (zip && !VA_ZIP.test(zip)) return { results: [], total: 0, error: 'That ZIP code isn\'t in Virginia. Try a Virginia ZIP like 20171 or 23219.' };
  if (!zip && !city) return { results: [], total: 0, error: 'Tell me a Virginia ZIP code or city.' };

  const params = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', state: 'VA', taxonomy_description: t.query, limit: '200' });
  if (zip) params.set('postal_code', `${zip.slice(0, 3)}*`); else params.set('city', city.toUpperCase());
  const key = params.toString();
  let raw = cache.get(key);
  if (!raw || Date.now() - raw.at > CACHE_MS) {
    const res = await fetch(`${API}?${key}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`NPI Registry error ${res.status}`);
    const json = await res.json();
    raw = { at: Date.now(), results: json.results || [] };
    cache.set(key, raw);
  }

  const seen = new Set();
  const all = raw.results.map((r) => toProvider(r, t)).filter((p) => p && !seen.has(p.npi) && seen.add(p.npi))
    // A search by ZIP keeps practices in that area; by city, practices in that city.
    .filter((p) => (zip ? p.zip.startsWith(zip.slice(0, 3)) : p.city.toLowerCase() === city.toLowerCase()));
  // Same ZIP first, then nearest ZIP number (a rough stand-in for distance), then name.
  const z = Number(zip);
  all.sort((a, b) => (zip ? Math.abs(Number(a.zip) - z) - Math.abs(Number(b.zip) - z) : 0) || a.name.localeCompare(b.name));
  return { results: all.slice(0, limit), total: all.length, type: t.label, where: zip || titleCase(city), source: 'U.S. NPI Registry (CMS)' };
}

module.exports = { TYPES, search, typeFromText, VA_ZIP };
