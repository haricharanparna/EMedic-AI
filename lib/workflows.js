// Guided workflows: small step machines. Each step asks something, saves the answer, and picks the next step.
// A step's next() returns another step id, or { end, options?, handoff?, outcome? } to finish.
// `options` can be an array or a function of the collected data. next() may also return
// { goto, say } to jump to another step with a note (e.g. "that time was just taken").
const actions = require('./actions');
const email = require('./email');
const nurses = require('./nurses');

const { EMAIL_RE } = email;
const MENU_OPTION = 'Main menu';
const NURSE_OPTION = 'Talk to a nurse';
const BOOK_OPTION = 'Book an appointment';
const USE_LOCATION = 'Use my location'; // the chat page asks the browser for the location when this is tapped
const { NURSE_LINE } = actions;
const APT_RE = /\bAPT-?\s?(\d{6})\b/i;
const RX_RE = /\bRX-?\s?(\d{6})\b/i;

// Run an action; turn a friendly ActionError into a chat reply instead of crashing the workflow.
function attempt(fn) {
  try {
    return { ok: true, result: fn() };
  } catch (err) {
    if (err instanceof actions.ActionError) return { ok: false, error: err };
    throw err;
  }
}

// ---------- Symptom check (triage) ----------

const SELF_CARE = {
  Fever: 'Rest, drink plenty of fluids, and use acetaminophen or ibuprofen as the label directs.\n\n**Get care if** the fever reaches 103°F (39.4°C), lasts more than 3 days, or comes with a stiff neck, confusion, a rash or trouble breathing.',
  'Cough, cold or sore throat': 'Rest, drink fluids, and try honey for a cough (not for babies under 1), saline nose spray, and warm salt-water gargles. Most colds improve in 7–10 days.\n\n**Get care if** you have trouble breathing, a fever lasting more than 3 days, symptoms lasting more than 10 days, or a sore throat with fever and no cough (possible strep).',
  'Stomach (vomiting, diarrhea, pain)': 'Take small, frequent sips of water or an oral rehydration drink, then add bland foods as you feel better.\n\n**Get care if** you can\'t keep fluids down for 24 hours, see blood, have severe or constant belly pain, or show signs of dehydration (very little urine, dizziness).',
  'Pain or injury': 'Use **RICE**: rest, ice for 20 minutes at a time, compression, and elevation. Over-the-counter pain relievers can help (follow the label).\n\n**Get care if** you can\'t put weight on it, it looks deformed, you have numbness, or it isn\'t improving after a few days.',
  'Rash or skin': 'Avoid anything that might have triggered it, use a fragrance-free moisturizer, and try 1% hydrocortisone cream for itching.\n\n**Get care if** it spreads quickly, blisters, comes with a fever, is near the eyes, or looks infected (warm, swollen, oozing). **Call 911** if you have swelling of the face or lips or trouble breathing.',
  'Something else': 'Rest, stay hydrated, and keep an eye on how you feel.\n\n**Get care if** it gets worse, new symptoms appear, or it isn\'t better in a few days.',
};

function triageResult(d) {
  const symptom = d['Main symptom'];
  const age = d['Age group'];
  const severity = d.Severity;
  const duration = d['How long'];
  const infant = age.startsWith('Under 3');
  const older = age.startsWith('65');
  const note = '\n\nThis is general guidance, not a diagnosis. Trust your instincts: if something feels wrong, get care.';

  if (infant && (symptom === 'Fever' || !severity.startsWith('Mild'))) {
    return {
      end: `🚨 **Get care right away. Go to the ER or call the Nurse Line at ${NURSE_LINE}.**\n\nBabies under 3 months with a fever of 100.4°F (38°C) or higher, or who seem unwell, need to be checked right away.${note}`,
      options: [NURSE_OPTION, MENU_OPTION],
      outcome: 'Advised: ER now (infant)',
    };
  }
  if (severity.startsWith('Severe')) {
    return {
      end: `⚠️ **Get care today.** Go to an **urgent care center** near you. Go to the **ER** instead if it's getting worse quickly or there's trouble breathing, confusion, fainting or signs of dehydration.${note}`,
      options: [NURSE_OPTION, MENU_OPTION],
      outcome: 'Advised: urgent care today',
    };
  }
  if (symptom === 'Urinary symptoms' || (severity.startsWith('Moderate') && (older || symptom === 'Pain or injury'))) {
    const why = symptom === 'Urinary symptoms'
      ? 'Urinary symptoms are often a UTI, which usually needs antibiotics. A **video visit today** is usually the fastest way to get treated. Get same-day care in person if you have fever, back or side pain, or vomiting.'
      : 'Based on your answers, it\'s best to **be seen today**. An EMedic video visit (7 AM–11 PM) or an urgent care center near you are good options.';
    return { end: `🩺 ${why}${note}`, options: [BOOK_OPTION, NURSE_OPTION, MENU_OPTION], outcome: 'Advised: same-day visit' };
  }
  if (severity.startsWith('Moderate') || duration.startsWith('More than')) {
    return {
      end: `📅 **Book a visit in the next 1–2 days.** A video visit or your primary care provider can help figure out what's going on.\n\nIn the meantime:\n${SELF_CARE[symptom] || SELF_CARE['Something else']}${note}`,
      options: [BOOK_OPTION, NURSE_OPTION, MENU_OPTION],
      outcome: 'Advised: visit in 1–2 days',
    };
  }
  return {
    end: `🏠 **This can likely be managed at home for now.**\n\n${SELF_CARE[symptom] || SELF_CARE['Something else']}${note}`,
    options: [BOOK_OPTION, NURSE_OPTION, MENU_OPTION],
    outcome: 'Advised: self-care',
  };
}

const PHONE_RE = /^\D*(\d\D*){10,11}$/;
const DOB_RE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/;

// Workflows are matched in this order, so the more specific ones come first.
const WORKFLOWS = {
  manage: {
    id: 'manage',
    title: 'Manage an appointment',
    label: 'Change or cancel an appointment',
    trigger: /\b(cancel|reschedule|change|move|check)\b.*\b(appointment|appt|visit|booking)\b|\bAPT-?\s?\d{6}\b/i,
    first: 'ref',
    prefill: (text, d) => {
      const m = text.match(APT_RE);
      if (!m) return null;
      d['Confirmation #'] = `APT-${m[1]}`;
      return 'lookup';
    },
    steps: {
      ref: {
        say: () => "Sure. What's your **confirmation number**? It starts with APT (for example, APT-123456).",
        validate: (a) => APT_RE.test(a) ? null : 'Confirmation numbers look like APT-123456. You can find it in your booking text.',
        save: 'Confirmation #',
        next: () => 'lookup',
      },
      lookup: {
        say: (d) => {
          const r = attempt(() => actions.getAppointment(normalizeRef(d['Confirmation #'], 'APT')));
          d._found = r.ok && r.result.status === 'Booked';
          d._nurseId = r.ok ? r.result.nurseId || null : null; // reschedule stays with the same nurse
          if (!r.ok) return `${r.error.message}\n\nWhat would you like to do?`;
          return r.result.status === 'Booked'
            ? `I found it: **${r.result.visitType}** (${r.result.format.toLowerCase()})${r.result.nurseName ? ` with **${r.result.nurseName}**` : ''} on **${r.result.time}**.${r.result.videoLink ? `\n\n🎥 **[Join your video visit](${r.result.videoLink})**` : ''}\n\nWhat would you like to do?`
            : `${r.result.message}\n\nWhat would you like to do?`;
        },
        options: (d) => (d._found ? ['Reschedule', 'Cancel it', 'Keep it'] : ['Try another number', BOOK_OPTION, MENU_OPTION]),
        next: (a, d) => {
          if (a === 'Reschedule') return actions.listSlots({ nurseIds: d._nurseId ? [d._nurseId] : undefined }).length ? 'newSlot' : noOpenTimes();
          if (a === 'Cancel it') return 'confirmCancel';
          if (a === 'Try another number') return 'ref';
          if (a === BOOK_OPTION) return { end: 'Just tap **Book an appointment** below to start.', options: [BOOK_OPTION, MENU_OPTION], outcome: 'Not found' };
          return { end: "Great, you're all set. See you then!", outcome: 'Kept appointment' };
        },
      },
      confirmCancel: {
        say: () => 'Are you sure you want to cancel?',
        options: ['Yes, cancel it', 'No, keep it'],
        next: (a, d) => {
          if (!a.startsWith('Yes')) return { end: "Okay, I've left it as is.", outcome: 'Kept appointment' };
          const r = attempt(() => actions.cancelAppointment(normalizeRef(d['Confirmation #'], 'APT')));
          return { end: r.ok ? `✅ ${r.result.message}` : r.error.message, options: [BOOK_OPTION, MENU_OPTION], outcome: r.ok ? 'Cancelled' : 'Cancel failed' };
        },
      },
      newSlot: {
        say: (d) => (d._nurseId ? `Here are the next open times with **${nurses.get(d._nurseId)?.name}**:` : 'Here are the next available times:'),
        options: (d) => actions.listSlots({ nurseIds: d._nurseId ? [d._nurseId] : undefined }),
        save: 'New time',
        next: (a, d) => {
          const r = attempt(() => actions.rescheduleAppointment(normalizeRef(d['Confirmation #'], 'APT'), { time: a }));
          if (!r.ok && r.error.code === 'slot_unavailable') return { goto: 'newSlot', say: r.error.message };
          return { end: r.ok ? `✅ ${chatLinks(r.result.message)}` : r.error.message, outcome: r.ok ? 'Rescheduled' : 'Reschedule failed' };
        },
      },
    },
  },

  refillStatus: {
    id: 'refillStatus',
    title: 'Refill status',
    label: 'Check a refill status',
    trigger: /\b(status|check|track|where('?s| is))\b.*\b(refill|prescription|rx)\b|\bRX-?\s?\d{6}\b/i,
    first: 'ref',
    prefill: (text, d) => {
      const m = text.match(RX_RE);
      if (!m) return null;
      d['Reference #'] = `RX-${m[1]}`;
      return 'show';
    },
    steps: {
      ref: {
        say: () => "What's the refill **reference number**? It starts with RX (for example, RX-123456).",
        validate: (a) => RX_RE.test(a) ? null : 'Refill numbers look like RX-123456.',
        save: 'Reference #',
        next: () => 'show',
      },
      show: {
        auto: true, // runs immediately, no question
        next: (a, d) => {
          const r = attempt(() => actions.getRefill(normalizeRef(d['Reference #'], 'RX')));
          return r.ok
            ? { end: `💊 ${r.result.message}`, options: [NURSE_OPTION, MENU_OPTION], outcome: `Checked: ${r.result.status}` }
            : { end: r.error.message, options: ['Check a refill status', NURSE_OPTION], outcome: 'Not found' };
        },
      },
    },
  },

  triage: {
    id: 'triage',
    title: 'Symptom check',
    label: 'Check my symptoms',
    trigger: /\b(check (my )?symptoms?|symptom check\w*|where should i go|should i go to (the )?(er|emergency|urgent care|doctor)|do i need to (see|go to)|i (feel|am feeling|'m feeling) (sick|ill|unwell|bad)|i('m| am) (sick|ill)|not feeling well)\b/i,
    first: 'emergency',
    steps: {
      emergency: {
        say: () => "Let's figure out the right care. It takes about a minute.\n\n**First, safety check.** Is the person having any of these **right now**?\n- Chest pain or pressure\n- Trouble breathing\n- Stroke signs: face drooping, arm weakness, slurred speech\n- Severe bleeding, fainting or sudden confusion\n- Thoughts of harming themselves",
        options: ['Yes, one of these', 'No, none of these'],
        save: 'Emergency signs',
        next: (a) => a.startsWith('Yes')
          ? {
            end: "🚨 **Call 911 now** or go to the nearest emergency room. Don't drive yourself.\n\nFor thoughts of self-harm, **call or text 988** (Suicide & Crisis Lifeline), available 24/7.",
            options: [NURSE_OPTION, MENU_OPTION],
            outcome: 'Emergency: told to call 911',
          }
          : 'symptom',
      },
      symptom: {
        say: () => "Okay, good. What's the **main problem**?",
        options: ['Fever', 'Cough, cold or sore throat', 'Stomach (vomiting, diarrhea, pain)', 'Pain or injury', 'Rash or skin', 'Urinary symptoms', 'Something else'],
        save: 'Main symptom',
        next: () => 'age',
      },
      age: {
        say: () => 'How old is the person?',
        options: ['Under 3 months', '3 months to 17 years', '18 to 64', '65 or older'],
        save: 'Age group',
        next: () => 'severity',
      },
      severity: {
        say: () => 'How bad is it right now?',
        options: ['Mild: doing normal activities', 'Moderate: hard to do normal activities', "Severe: getting worse fast or can't keep fluids down"],
        save: 'Severity',
        next: () => 'duration',
      },
      duration: {
        say: () => 'How long has it been going on?',
        options: ['Less than 2 days', '2 to 7 days', 'More than a week'],
        save: 'How long',
        next: (a, d) => triageResult(d),
      },
    },
  },

  refill: {
    id: 'refill',
    title: 'Prescription refill',
    label: 'Refill a prescription',
    trigger: /\b(refill|renew)\b.*\b(prescription|medication|medicine|meds|rx)\b|\b(prescription|medication|medicine|meds|rx)\b.*\b(refill|renew)|\brefill\b|\b(run|running|ran) out of (my )?(meds|medication|medicine|pills)\b/i,
    first: 'med',
    steps: {
      med: {
        say: () => "I can send a refill request.\n\nWhich medication do you need? Include the strength if you know it (for example, *lisinopril 10 mg*).",
        save: 'Medication',
        validate: (a) => /[a-z]{3,}/i.test(a) ? null : 'Please type the medication name (for example, lisinopril 10 mg).',
        next: () => 'controlled',
      },
      controlled: {
        say: () => 'Is this a **controlled medication**, like an opioid pain medicine, an ADHD stimulant, or a benzodiazepine?',
        options: ['No', 'Yes', 'Not sure'],
        save: 'Controlled medication',
        next: (a) => a === 'Yes'
          ? {
            end: "🛑 Controlled medications can't be refilled through chat for safety reasons. Your provider's office needs to handle these directly.\n\nI can connect you with a nurse, who can pass a message to your provider.",
            options: [NURSE_OPTION, MENU_OPTION],
            outcome: 'Stopped: controlled medication',
          }
          : 'dob',
      },
      dob: {
        say: () => "To match the request to the right patient, what's the patient's **date of birth**? (MM/DD/YYYY)\n\nThis is a demo, so please use a made-up date.",
        save: 'Date of birth',
        validate: (a) => DOB_RE.test(a) && new Date(a) < new Date() ? null : 'Please use the format MM/DD/YYYY, for example 04/17/1985.',
        next: () => 'refillsLeft',
      },
      refillsLeft: {
        say: () => 'Does your prescription label show any **refills remaining**?',
        options: ['Yes, refills left', 'No refills left', 'Not sure'],
        save: 'Refills remaining',
        next: () => 'pharmacy',
      },
      pharmacy: {
        say: () => 'Where should we send it?',
        options: ['EMedic Pharmacy (pick up)', 'Mail order (3–5 days)', 'Another pharmacy'],
        save: 'Pharmacy',
        next: (a) => a.startsWith('Another') ? 'pharmacyName' : 'confirm',
      },
      pharmacyName: {
        say: () => 'Which pharmacy? Please include the name and city (for example, *Walgreens, Main St, Springfield*).',
        save: 'Pharmacy',
        validate: (a) => a.length >= 4 ? null : 'Please include the pharmacy name and city.',
        next: () => 'confirm',
      },
      confirm: {
        say: (d) => `Here's your refill request:\n- **Medication:** ${d.Medication}\n- **Date of birth:** ${d['Date of birth']}\n- **Refills remaining:** ${d['Refills remaining']}\n- **Send to:** ${d.Pharmacy}\n\nShould I submit it?`,
        options: ['Submit request', 'Cancel'],
        next: (a, d, s) => {
          if (!a.startsWith('Submit')) return { end: 'Cancelled. Nothing was sent.', outcome: 'Cancelled by patient' };
          const r = attempt(() => actions.requestRefill({
            medication: d.Medication, dateOfBirth: d['Date of birth'], refillsRemaining: d['Refills remaining'],
            pharmacy: d.Pharmacy, controlled: d['Controlled medication'], sessionId: s.id,
          }));
          if (!r.ok) return { end: r.error.message, options: [NURSE_OPTION, MENU_OPTION], outcome: 'Refill failed' };
          d['Reference #'] = r.result.ref;
          return {
            end: `✅ **Refill request sent!** Reference **${r.result.ref}**. Status: *${r.result.status}*.\n\n${r.result.message.replace(/^Refill request \S+ for .+? is in\. /, '')}\n\nCheck anytime by asking **"status of ${r.result.ref}"**.`,
            outcome: 'Submitted',
          };
        },
      },
    },
  },

  appointment: {
    id: 'appointment',
    title: 'Book an appointment',
    label: BOOK_OPTION,
    trigger: /\b(book|schedule|make|need|get|set up)\b.*\b(appointment|appt|visit|checkup|physical)\b|\bsee a (doctor|provider|nurse)\b|^book (an appointment )?with\b/i,
    first: 'type',
    // "Book with Maria Gonzalez" (from the nurse directory) picks the nurse up front.
    prefill: (text, d) => {
      const m = text.match(/\bwith\s+(.+)$/i);
      const n = m && nurses.find(m[1]);
      if (n) d._nurseId = n.id;
      return null;
    },
    steps: {
      type: {
        say: (d) => {
          const n = nurses.get(d._nurseId);
          const start = n ? `Let's book you with **${n.name}**.` : "Let's get you booked.";
          return `${start} EMedic visits are **by video**, so you can join from anywhere in the U.S. What kind of visit do you need?`;
        },
        options: (d) => [...(nurses.get(d._nurseId)?.visits || actions.VISIT_TYPES), IN_PERSON],
        save: 'Visit type',
        next: (a, d, s) => {
          if (a === IN_PERSON) {
            // EMedic doesn't book in person: help them find a real provider nearby instead.
            s.providerAsk = 'family';
            return {
              end: "EMedic only books **video visits**, but I can help you find a real in-person provider near you. Tap **Use my location**, or type your **ZIP code** or **city and state**. (You can also say the type, like *a pediatrician near 10001*.)",
              options: [USE_LOCATION, MENU_OPTION],
              outcome: 'Pointed to in-person providers',
            };
          }
          d['Visit format'] = 'Video visit';
          return 'intake';
        },
      },
      // One form instead of six questions: who, how to reach them, where, insurance, language, why.
      intake: {
        say: () => 'Please fill in your visit details so the care team is ready for you.',
        form: (d, s, values, error) => intakeForm(d, s, values, error),
        validateForm: (v, d) => validateIntake(v, d),
        saveForm: (v, d) => saveIntake(v, d),
        next: (a, d) => {
          const chosen = nurses.get(d._nurseId);
          if (chosen) {
            if (actions.listSlots({ nurseIds: [chosen.id] }).length) { d.Nurse = chosen.name; return 'slot'; }
            d._nurseId = null;
            return nursePool(d).length ? { goto: 'nurse', say: `${chosen.name} doesn't have any open times right now, so here's who does.` } : noOpenTimes();
          }
          return nursePool(d).length ? 'nurse' : noOpenTimes();
        },
      },
      nurse: {
        say: (d) => `Choose your nurse. These are the people who can see you by video for a **${d['Visit type'].toLowerCase()}**:`,
        options: (d) => [...nursePool(d).map((n) => n.name), NO_PREFERENCE],
        cards: (d) => nursePool(d).map((n) => nurses.card(n, {
          next: actions.listSlots({ nurseIds: [n.id], count: 1 })[0] || null,
          speaksYourLanguage: Boolean(d.Language && d.Language !== 'English' && n.languages.includes(d.Language)),
        })),
        save: 'Nurse',
        next: (a, d) => {
          d._nurseId = a === NO_PREFERENCE ? null : nurses.find(a)?.id || null;
          return 'slot';
        },
      },
      slot: {
        say: (d) => (d._nurseId ? `Here are the next open times with **${nurses.get(d._nurseId).name}**:` : 'Here are the next available times:'),
        options: (d) => actions.listSlots({ nurseIds: poolIds(d) }),
        save: 'Time',
        next: () => 'confirm',
      },
      confirm: {
        say: (d) => {
          const lines = [
            `- **Visit:** ${d['Visit type']} (${d['Visit format'].toLowerCase()})`,
            `- **With:** ${d._nurseId ? nurseLabel(nurses.get(d._nurseId)) : nurseLabel(nurses.get(actions.slotNurseId(d.Time))) || 'The first available nurse'}`,
            `- **When:** ${d.Time}`,
            '- **Where:** Video visit (you\'ll get a link)',
            `- **Insurance:** ${d.Insurance}${d['Member ID'] ? ` (member ID ${d['Member ID']})` : ''}`,
            `- **Reason:** ${d.Reason}`,
          ];
          return `Here's your appointment:\n${lines.join('\n')}\n\n${insuranceNote(d)}Book it?`;
        },
        options: ['Confirm booking', 'Cancel'],
        next: (a, d, s) => {
          if (!a.startsWith('Confirm')) return { end: 'No problem. Nothing was booked.', outcome: 'Cancelled by patient' };
          const r = attempt(() => actions.bookAppointment({
            visitType: d['Visit type'], format: d['Visit format'], time: d.Time, reason: d.Reason,
            nurseId: d._nurseId || undefined,
            patientName: d.Name, dateOfBirth: d['Date of birth'], phone: d.Phone,
            insurance: d.Insurance, memberId: d['Member ID'], language: d.Language, sessionId: s.id,
          }));
          if (!r.ok && r.error.code === 'slot_unavailable') return { goto: 'slot', say: r.error.message };
          if (!r.ok) return { end: r.error.message, options: [NURSE_OPTION, MENU_OPTION], outcome: 'Booking failed' };
          d['Reference #'] = r.result.ref;
          s.lastWorkflow.outcome = 'Booked';
          const booked = `✅ **You're booked!** ${chatLinks(r.result.message.replace(/^You're booked for /, ''))}\n\nNeed to change it? Just say **"reschedule ${r.result.ref}"**.`;
          const more = `Anything else I can help with${s.name ? `, ${s.name}` : ''}?`;
          // Email from the form (or saved in Settings): send the confirmation there.
          const to = d.Email || s.email;
          if (to) {
            const rec = actions.setAppointmentContact(r.result.ref, { email: to });
            return {
              end: `${booked}\n\nSending your confirmation to **${to}**…`,
              outcome: 'Booked',
              after: async () => `${(await email.sendAppointmentConfirmation(rec, to, s.name || d.Name.split(' ')[0])).message} ${more}`,
            };
          }
          return { end: `${booked}\n\n📱 We'll text a reminder to **${d.Phone}** 24 hours before your visit. ${more}`, outcome: 'Booked' };
        },
      },
    },
  },

  contact: {
    id: 'contact',
    title: 'Contact the care team',
    label: NURSE_OPTION,
    trigger: /^talk to a nurse$/i,
    first: 'how',
    steps: {
      how: {
        say: () => 'Our nurses are here **24/7**. How would you like to reach them?',
        options: ['Chat with a nurse now', 'Call the Nurse Line', 'Request a callback'],
        save: 'Contact method',
        next: (a) => {
          if (a.startsWith('Chat')) return { end: 'Connecting you now.', handoff: 'Patient asked to chat with a nurse', outcome: 'Live chat requested' };
          if (a.startsWith('Call')) {
            return {
              end: `📞 Call the **24/7 Nurse Line at ${NURSE_LINE}**. The average wait is under 10 minutes.\n\nCalling about an emergency? Hang up and **call 911**.\n\n(Demo number for this prototype.)`,
              options: ['Chat with a nurse now', MENU_OPTION],
              outcome: 'Given Nurse Line number',
            };
          }
          return 'phone';
        },
      },
      phone: {
        say: () => 'What number should the nurse call? (This is a demo, so a made-up number is fine.)',
        save: 'Callback number',
        validate: (a) => PHONE_RE.test(a) ? null : 'Please enter a 10-digit phone number, like (555) 123-4567.',
        next: () => 'time',
      },
      time: {
        say: () => 'When is the best time to call?',
        options: ['As soon as possible', 'Morning (8 AM–12 PM)', 'Afternoon (12–5 PM)', 'Evening (5–9 PM)'],
        save: 'Best time',
        next: (a, d, s) => {
          const r = attempt(() => actions.requestCallback({ phone: d['Callback number'], bestTime: a, reason: s.lastQuestion, sessionId: s.id }));
          if (!r.ok) return { goto: 'phone', say: r.error.message };
          d['Reference #'] = r.result.ref;
          return {
            end: `✅ ${r.result.message} If a nurse is free sooner, they may also reply right here in this chat.`,
            handoff: `Callback requested: ${d['Callback number']}, ${a}`,
            outcome: 'Callback requested',
          };
        },
      },
    },
  },
};

const YES = /^(y|yes|yeah|yep|yup|sure|ok|okay|correct)\b/i;
const NO = /^(n|no|nope|nah|not yet|none)\b/i;

// Map free text (or a clicked button) onto one of the step's options.
function matchOption(input, options) {
  const t = input.toLowerCase().trim();
  const exact = options.find((o) => o.toLowerCase() === t);
  if (exact) return exact;
  const contains = options.find((o) => t.length >= 3 && o.toLowerCase().includes(t));
  if (contains) return contains;
  if (YES.test(t)) { const y = options.find((o) => /^yes/i.test(o)); if (y) return y; }
  if (NO.test(t)) { const n = options.find((o) => /^(no|not yet)\b/i.test(o)); if (n) return n; }
  const keyword = options.find((o) => {
    const words = o.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => t.includes(w));
  });
  return keyword || null;
}

function findWorkflow(text) {
  const t = text.toLowerCase().trim();
  return Object.values(WORKFLOWS).find((w) => t === w.label.toLowerCase() || w.trigger.test(text)) || null;
}

// ---------- Booking helpers: intake form and choosing a nurse ----------

const NO_PREFERENCE = 'No preference (first available)';
const IN_PERSON = 'I need an in-person visit';
const INSURANCE = ['Aetna', 'Blue Cross Blue Shield', 'Cigna', 'UnitedHealthcare', 'Medicare', 'Medicaid', 'Other insurance', 'Self-pay (no insurance)'];
const SELF_PAY = 'Self-pay (no insurance)';

const nurseLabel = (n) => (n ? `${n.name}, ${n.title.split(',')[0]}` : '');

// Nurses who can see this patient and have at least one open time, best fits first
// (speaks their language, then soonest available).
function nursePool(d) {
  const pool = nurses.eligible({ visitType: d['Visit type'] });
  return pool
    .map((n) => ({ n, next: actions.listSlots({ nurseIds: [n.id], count: 1 })[0] }))
    .filter((x) => x.next)
    .sort((a, b) => Number(b.n.languages.includes(d.Language)) - Number(a.n.languages.includes(d.Language)))
    .map((x) => x.n);
}
const poolIds = (d) => (d._nurseId ? [d._nurseId] : nursePool(d).map((n) => n.id));

function insuranceNote(d) {
  if (d.Insurance === SELF_PAY) return 'ℹ️ **Self-pay:** video visits are **$49**, and payment plans are available.\n\n';
  if (d.Insurance === 'Other insurance') return "ℹ️ We'll check your coverage before the visit and let you know if anything isn't covered.\n\n";
  return '';
}

function intakeForm(d, s, values = {}, error) {
  const v = (k, fallback = '') => values[k] ?? fallback;
  const fields = [
    { name: 'fullName', label: 'Full name', type: 'text', required: true, autocomplete: 'name', value: v('fullName', s.name || '') },
    { name: 'dob', label: 'Date of birth', type: 'date', required: true, half: true, value: v('dob') },
    { name: 'phone', label: 'Mobile phone', type: 'tel', required: true, half: true, autocomplete: 'tel', placeholder: '(555) 123-4567', value: v('phone') },
    { name: 'email', label: 'Email for your confirmation', type: 'email', autocomplete: 'email', placeholder: 'Optional', value: v('email', s.email || '') },
  ];
  fields.push(
    { name: 'insurance', label: 'Insurance', type: 'select', required: true, half: true, options: INSURANCE, value: v('insurance') },
    { name: 'memberId', label: 'Member ID', type: 'text', half: true, placeholder: 'On your insurance card', value: v('memberId'), showIf: { field: 'insurance', not: SELF_PAY } },
    { name: 'language', label: 'Preferred language', type: 'select', required: true, options: nurses.LANGUAGES, value: v('language', 'English') },
    { name: 'reason', label: 'Reason for the visit', type: 'textarea', required: true, placeholder: 'For example: sore throat and fever for 2 days', value: v('reason') },
    { name: 'consent', label: 'I agree to share these details with EMedic to schedule my visit.', type: 'checkbox', required: true, value: Boolean(values.consent) },
  );
  return { id: 'intake', title: 'Visit details', submit: 'Continue', error, note: 'Demo: please use made-up details, not real health information.', fields };
}

// Accepts the browser's YYYY-MM-DD or MM/DD/YYYY; returns MM/DD/YYYY or null.
function normDob(raw) {
  const t = String(raw || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [mo, dd, yy] = m ? [m[2], m[3], m[1]] : (t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) || []).slice(1);
  if (!yy) return null;
  const date = new Date(Number(yy), Number(mo) - 1, Number(dd));
  if (date.getMonth() !== Number(mo) - 1 || date > new Date() || Number(yy) < new Date().getFullYear() - 120) return null;
  return `${String(mo).padStart(2, '0')}/${String(dd).padStart(2, '0')}/${yy}`;
}

function validateIntake(v, d) {
  if (!v.fullName || v.fullName.length < 2) return 'Please enter your full name.';
  if (!normDob(v.dob)) return 'Please enter a valid date of birth.';
  if (!PHONE_RE.test(v.phone || '')) return 'Please enter a 10-digit phone number, like (555) 123-4567.';
  if (v.email && !EMAIL_RE.test(v.email)) return "That email doesn't look right. Try name@example.com, or leave it blank.";
  if (!INSURANCE.includes(v.insurance)) return 'Please choose your insurance, or Self-pay.';
  if (!nurses.LANGUAGES.includes(v.language)) return 'Please choose a language.';
  if (!v.reason || v.reason.length < 2) return 'Please add a few words about the reason for your visit.';
  if (!v.consent) return 'Please tick the box to agree to share these details.';
  return null;
}

function saveIntake(v, d) {
  d.Name = v.fullName;
  d['Date of birth'] = normDob(v.dob);
  d.Phone = v.phone;
  if (v.email) d.Email = v.email;
  d.Insurance = v.insurance;
  if (v.memberId && v.insurance !== SELF_PAY) d['Member ID'] = v.memberId;
  d.Language = v.language;
  d.Reason = v.reason;
}

// Words that show someone is asking for a particular nurse ("I'd like to see Maria", "book with Wei").
const NURSE_INTENT = /\b(book|schedule|appointment|appt|visit|see|seeing|with|want|wanna|prefer|like|choose|pick|instead|switch|nurse|np|doctor)\b/i;

// Why this nurse can't do the visit chosen so far, or null if they can.
function nurseMismatch(n, d) {
  const type = d['Visit type'];
  if (type && !n.visits.includes(type)) return `${n.name} doesn't do ${type.toLowerCase()} visits. ${n.name.split(' ')[0]} sees patients for: ${n.visits.join(', ').toLowerCase()}.`;
  return null;
}

// A nurse named partway through a booking: switch to them if they can do this visit, then carry on.
// Returns a step to show, or null if the message doesn't name a nurse.
function nurseRequest(s, text) {
  if (s.workflow?.id !== 'appointment' || s.workflow.step === 'nurse') return null; // the nurse step matches names itself
  const n = nurses.find(text);
  if (!n) return null;
  const wf = WORKFLOWS.appointment;
  const d = s.workflow.data;
  const step = s.workflow.step;
  const again = (note) => ({ ...render(wf, step, d, s), text: `${note}\n\n${render(wf, step, d, s).text}` });
  if (d._nurseId === n.id) return again(`You're already booking with **${n.name}**.`);
  const why = nurseMismatch(n, d);
  if (why) return again(why);
  if (step === 'slot' || step === 'confirm') {
    if (!actions.listSlots({ nurseIds: [n.id] }).length) return again(`${n.name} doesn't have any open times right now.`);
    d._nurseId = n.id;
    d.Nurse = n.name;
    delete d.Time;
    return enter(s, wf, 'slot', `Got it, switching to **${n.name}**.`);
  }
  d._nurseId = n.id;
  d.Nurse = n.name;
  return enter(s, wf, step, `Got it, I'll book you with **${n.name}** (${n.title.split(',')[0]}).`);
}

function noOpenTimes() {
  return {
    end: "📅 There aren't any open appointment times right now. A nurse can find you one, or call **(555) 010-2273**.",
    options: [NURSE_OPTION, MENU_OPTION],
    outcome: 'No open times',
  };
}

// Action messages carry plain URLs (fine for other agent platforms); in this chat, show the video link as a link.
function chatLinks(text) {
  return String(text)
    .replace(/ ?Join your video visit here: (https:\/\/\S+) \(opens in your browser, no app needed\)\./, '\n\n🎥 **[Join your video visit]($1)** (opens in your browser, no app needed).')
    .replace(/Your video link stays the same: (https:\/\/\S+)/, 'Your [video visit link]($1) stays the same.');
}

const optionsFor = (step, data) => (typeof step.options === 'function' ? step.options(data) : step.options);

function render(wf, stepId, data, s, { values, error } = {}) {
  const step = wf.steps[stepId];
  const r = { text: step.say(data, s), options: optionsFor(step, data), workflow: wf.title };
  if (step.form) r.form = step.form(data, s, values, error);
  if (step.cards) r.nurses = step.cards(data, s);
  return r;
}

function start(s, wf, text = '') {
  const data = {};
  const first = (wf.prefill && wf.prefill(text, data)) || wf.first;
  s.workflow = { id: wf.id, step: first, data };
  s.lastWorkflow = { id: wf.id, title: wf.title, data, outcome: 'In progress' };
  return enter(s, wf, first);
}

// Move to a step: ask its question, or run it straight away if it's an `auto` step.
function enter(s, wf, stepId, note = '') {
  const step = wf.steps[stepId];
  if (step.auto) return finish(s, wf, step.next(null, s.workflow.data, s), note);
  s.workflow.step = stepId;
  const r = render(wf, stepId, s.workflow.data, s);
  return note ? { ...r, text: `${note}\n\n${r.text}` } : r;
}

function finish(s, wf, next, note = '') {
  s.workflow = null;
  s.lastWorkflow.outcome = next.outcome || 'Completed';
  return {
    text: note ? `${note}\n\n${next.end}` : next.end,
    options: next.options || [MENU_OPTION], handoff: next.handoff, after: next.after, workflow: wf.title, done: true,
  };
}

function normalizeRef(text, prefix) {
  const m = String(text).match(new RegExp(`${prefix}-?\\s?(\\d{6})`, 'i'));
  return m ? `${prefix}-${m[1]}` : String(text).trim().toUpperCase();
}

// Collected data without internal "_" keys (for summaries and the console).
function visibleData(data) {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
}

// Form fields as plain, trimmed values (checkboxes stay true/false).
function cleanForm(form) {
  const out = {};
  for (const [k, val] of Object.entries(form || {}).slice(0, 30)) out[k] = typeof val === 'boolean' ? val : String(val ?? '').trim().slice(0, 300);
  return out;
}

function advance(s, text, form) {
  const wf = WORKFLOWS[s.workflow.id];
  const step = wf.steps[s.workflow.step];
  const data = s.workflow.data;
  // Form steps take the submitted fields; typed text just gets a nudge back to the form.
  if (step.form) {
    if (!form || typeof form !== 'object') return { ...render(wf, s.workflow.step, data, s), text: 'Please fill in the form below, or type **cancel** to stop.', unmatched: true };
    const values = cleanForm(form);
    const err = step.validateForm(values, data, s);
    if (err) return render(wf, s.workflow.step, data, s, { values, error: err });
    step.saveForm(values, data, s);
    return go(s, wf, step.next(null, data, s));
  }
  const options = optionsFor(step, data);
  let answer = text;
  if (options && !step.freeText) {
    answer = matchOption(text, options);
    // `unmatched` lets the bot decide whether the patient changed the subject.
    if (!answer) return { text: 'Please choose one of the options below, or type **cancel** to stop.', options, workflow: wf.title, unmatched: true };
  } else if (step.validate) {
    const err = step.validate(text);
    // On an optional step, a reply that isn't even an attempt (no @, too few digits for a phone) means they've moved on.
    const movedOn = step.optional && !text.includes('@') && text.replace(/\D/g, '').length < 7;
    if (err) return { text: err, workflow: wf.title, unmatched: true, movedOn };
  }
  if (step.save) data[step.save] = answer;
  return go(s, wf, step.next(answer, data, s));
}

function go(s, wf, next) {
  if (typeof next === 'string') return enter(s, wf, next);
  if (next.goto) return enter(s, wf, next.goto, next.say);
  return finish(s, wf, next);
}

module.exports = { WORKFLOWS, findWorkflow, start, advance, nurseRequest, NURSE_INTENT, triageResult, visibleData, MENU_OPTION, NURSE_OPTION, USE_LOCATION };
