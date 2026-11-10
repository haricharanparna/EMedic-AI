// EMedic's care team (fictional). Patients can pick who they see; each open time belongs to one of them.
const LOCATIONS = [
  { id: 'main', name: 'Main St Clinic', address: '120 Main St', hours: 'Mon–Fri 8 AM–6 PM' },
  { id: 'northgate', name: 'Northgate Clinic', address: '45 Northgate Blvd', hours: 'Mon–Sat 8 AM–8 PM' },
  { id: 'center', name: 'EMedic Medical Center', address: '900 Health Way', hours: 'Open 24/7 (clinic visits 7 AM–7 PM)' },
];

const ALL_VISITS = ['Sick visit', 'Annual physical / checkup', 'Follow-up visit', 'Mental health', 'Vaccine only'];

const NURSES = [
  { id: 'jordan-lee', name: 'Jordan Lee', title: 'RN, BSN', location: 'main', video: true,
    languages: ['English', 'Korean'], specialties: ['General care', 'Chronic conditions'],
    visits: ['Sick visit', 'Follow-up visit', 'Annual physical / checkup'],
    bio: 'Twelve years in primary care. Loves helping people get blood pressure and diabetes under control.' },
  { id: 'maria-gonzalez', name: 'Maria Gonzalez', title: 'FNP-C, Nurse Practitioner', location: 'northgate', video: true,
    languages: ['English', 'Spanish'], specialties: ['Family medicine', "Women's health"],
    visits: ALL_VISITS.filter((v) => v !== 'Mental health'),
    bio: 'Family nurse practitioner who sees patients of all ages, from newborn checkups to grandparents.' },
  { id: 'aisha-rahman', name: 'Aisha Rahman', title: 'PMHNP, Psychiatric Nurse Practitioner', location: 'center', video: true,
    languages: ['English', 'Arabic'], specialties: ['Mental health', 'Anxiety and depression'],
    visits: ['Mental health', 'Follow-up visit'],
    bio: 'Calm, judgment-free care for anxiety, depression, sleep and stress. Most visits are by video.' },
  { id: 'daniel-okafor', name: 'Daniel Okafor', title: 'RN', location: 'main', video: false,
    languages: ['English'], specialties: ['Vaccines', 'Sick visits'],
    visits: ['Sick visit', 'Vaccine only'],
    bio: 'Runs the Main St vaccine clinic. Quick, friendly and great with nervous patients.' },
  { id: 'linh-tran', name: 'Linh Tran', title: 'FNP-C, Pediatric focus', location: 'northgate', video: true,
    languages: ['English', 'Vietnamese'], specialties: ['Children and teens', 'Vaccines'],
    visits: ['Sick visit', 'Annual physical / checkup', 'Vaccine only', 'Follow-up visit'],
    bio: 'Sees kids from babies to teens. Parents say she explains things in a way everyone understands.' },
  { id: 'wei-chen', name: 'Wei Chen', title: 'NP, Nurse Practitioner', location: 'center', video: true,
    languages: ['English', 'Mandarin'], specialties: ['Diabetes', 'Heart health'],
    visits: ['Follow-up visit', 'Annual physical / checkup', 'Sick visit'],
    bio: 'Focuses on long-term conditions: diabetes, high blood pressure and cholesterol.' },
  { id: 'sarah-mitchell', name: 'Sarah Mitchell', title: 'RN, BSN', location: 'center', video: false,
    languages: ['English'], specialties: ['Annual physicals', 'Prevention'],
    visits: ['Annual physical / checkup', 'Vaccine only'],
    bio: 'Keeps your screenings and vaccines on track so problems are caught early.' },
  { id: 'carlos-rivera', name: 'Carlos Rivera', title: 'PMHNP, Psychiatric Nurse Practitioner', location: 'main', video: true,
    languages: ['English', 'Spanish'], specialties: ['Mental health', 'Teens and young adults'],
    visits: ['Mental health', 'Follow-up visit'],
    bio: 'Works with teens and adults on stress, mood and ADHD. Bilingual visits in English or Spanish.' },
];

const LANGUAGES = ['English', 'Spanish', 'Mandarin', 'Vietnamese', 'Korean', 'Arabic'];

const location = (id) => LOCATIONS.find((l) => l.id === id || l.name.toLowerCase() === String(id || '').toLowerCase()) || null;
const get = (id) => NURSES.find((n) => n.id === id) || null;

// Find a nurse by id or by (part of) their name: "maria", "Nurse Maria Gonzalez", "maria-gonzalez".
function find(text) {
  const t = String(text || '').toLowerCase().replace(/^(nurse|np|rn)\s+/, '').trim();
  if (!t) return null;
  return get(t) || NURSES.find((n) => n.name.toLowerCase() === t)
    || NURSES.find((n) => t.includes(n.name.toLowerCase()))
    || NURSES.find((n) => n.name.toLowerCase().split(' ').some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`).test(t))) || null;
}

// Who can see this patient: right visit type, offers video if needed, works at the chosen clinic for in-person.
function eligible({ visitType, format, locationId } = {}) {
  return NURSES.filter((n) => (!visitType || n.visits.includes(visitType))
    && (format !== 'Video visit' || n.video)
    && (format !== 'In person' || !locationId || n.location === locationId));
}

// Public view for cards and the API.
function card(n, extra = {}) {
  const loc = location(n.location);
  return {
    id: n.id, name: n.name, title: n.title, initials: n.name.split(' ').map((w) => w[0]).join(''),
    location: loc.name, address: loc.address, video: n.video, languages: n.languages,
    specialties: n.specialties, visits: n.visits, bio: n.bio, ...extra,
  };
}

module.exports = { LOCATIONS, LANGUAGES, NURSES, location, get, find, eligible, card };
