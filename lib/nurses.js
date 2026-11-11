// EMedic's care team (fictional). EMedic visits are by video, so they see patients anywhere in the U.S.
// Patients can pick who they see; each open time belongs to one of them.
const ALL_VISITS = ['Sick visit', 'Annual physical / checkup', 'Follow-up visit', 'Mental health'];

const NURSES = [
  { id: 'jordan-lee', name: 'Jordan Lee', title: 'RN, BSN',
    languages: ['English', 'Korean'], specialties: ['General care', 'Chronic conditions'],
    visits: ['Sick visit', 'Follow-up visit', 'Annual physical / checkup'],
    bio: 'Twelve years in primary care. Loves helping people get blood pressure and diabetes under control.' },
  { id: 'maria-gonzalez', name: 'Maria Gonzalez', title: 'FNP-C, Nurse Practitioner',
    languages: ['English', 'Spanish'], specialties: ['Family medicine', "Women's health"],
    visits: ALL_VISITS.filter((v) => v !== 'Mental health'),
    bio: 'Family nurse practitioner who sees patients of all ages, from newborn checkups to grandparents.' },
  { id: 'aisha-rahman', name: 'Aisha Rahman', title: 'PMHNP, Psychiatric Nurse Practitioner',
    languages: ['English', 'Arabic'], specialties: ['Mental health', 'Anxiety and depression'],
    visits: ['Mental health', 'Follow-up visit'],
    bio: 'Calm, judgment-free care for anxiety, depression, sleep and stress.' },
  { id: 'daniel-okafor', name: 'Daniel Okafor', title: 'RN',
    languages: ['English'], specialties: ['Sick visits', 'Colds, flu and infections'],
    visits: ['Sick visit', 'Follow-up visit'],
    bio: 'Quick, friendly sick visits for colds, flu, rashes and UTIs. Great with nervous patients.' },
  { id: 'linh-tran', name: 'Linh Tran', title: 'FNP-C, Pediatric focus',
    languages: ['English', 'Vietnamese'], specialties: ['Children and teens', 'Growth and development'],
    visits: ['Sick visit', 'Annual physical / checkup', 'Follow-up visit'],
    bio: 'Sees kids from babies to teens. Parents say she explains things in a way everyone understands.' },
  { id: 'wei-chen', name: 'Wei Chen', title: 'NP, Nurse Practitioner',
    languages: ['English', 'Mandarin'], specialties: ['Diabetes', 'Heart health'],
    visits: ['Follow-up visit', 'Annual physical / checkup', 'Sick visit'],
    bio: 'Focuses on long-term conditions: diabetes, high blood pressure and cholesterol.' },
  { id: 'sarah-mitchell', name: 'Sarah Mitchell', title: 'RN, BSN',
    languages: ['English'], specialties: ['Annual checkups', 'Prevention'],
    visits: ['Annual physical / checkup', 'Follow-up visit'],
    bio: 'Keeps your screenings and vaccines on track so problems are caught early.' },
  { id: 'carlos-rivera', name: 'Carlos Rivera', title: 'PMHNP, Psychiatric Nurse Practitioner',
    languages: ['English', 'Spanish'], specialties: ['Mental health', 'Teens and young adults'],
    visits: ['Mental health', 'Follow-up visit'],
    bio: 'Works with teens and adults on stress, mood and ADHD. Bilingual visits in English or Spanish.' },
];

const LANGUAGES = ['English', 'Spanish', 'Mandarin', 'Vietnamese', 'Korean', 'Arabic'];

const get = (id) => NURSES.find((n) => n.id === id) || null;

// Find a nurse by id or by (part of) their name: "maria", "Nurse Maria Gonzalez", "maria-gonzalez".
function find(text) {
  const t = String(text || '').toLowerCase().replace(/^(nurse|np|rn)\s+/, '').trim();
  if (!t) return null;
  return get(t) || NURSES.find((n) => n.name.toLowerCase() === t)
    || NURSES.find((n) => t.includes(n.name.toLowerCase()))
    || NURSES.find((n) => n.name.toLowerCase().split(' ').some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`).test(t))) || null;
}

// Who can see this patient: offers that visit type.
function eligible({ visitType } = {}) {
  return NURSES.filter((n) => !visitType || n.visits.includes(visitType));
}

// Public view for cards and the API.
function card(n, extra = {}) {
  return {
    id: n.id, name: n.name, title: n.title, initials: n.name.split(' ').map((w) => w[0]).join(''),
    video: true, languages: n.languages,
    specialties: n.specialties, visits: n.visits, bio: n.bio, ...extra,
  };
}

module.exports = { LANGUAGES, NURSES, get, find, eligible, card };
