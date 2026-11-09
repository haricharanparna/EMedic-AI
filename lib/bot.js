// The bot brain: pre-chat, emergency screening, workflows, handoff, and knowledge answers.
const kb = require('./kb');
const llm = require('./llm');
const workflows = require('./workflows');

const { WORKFLOWS, NURSE_OPTION, MENU_OPTION } = workflows;
const MENU = [WORKFLOWS.triage.label, WORKFLOWS.refill.label, WORKFLOWS.appointment.label, NURSE_OPTION];
const FULL_MENU = [
  WORKFLOWS.triage.label, WORKFLOWS.refill.label, WORKFLOWS.refillStatus.label,
  WORKFLOWS.appointment.label, WORKFLOWS.manage.label, NURSE_OPTION,
];
const PRECHAT_OPTIONS = ['Myself', 'My child', 'Someone I care for'];
const GREETING = "Hi! I'm **EMedic AI**, your virtual care assistant. 👋\n\nAsk me any health question, check your symptoms, refill a prescription, book a visit, or reach a nurse 24/7.\n\n**Before we start: who are you asking about today?**";

// Emergencies are checked on every message, even mid-workflow or while a nurse is chatting.
const EMERGENCY_RE = /\b(chest (pain|pressure|tightness)|can'?t breathe|cannot breathe|trouble breathing|hard to breathe|not breathing|stopped breathing|face (is )?droop\w*|slurred speech|having a stroke|unconscious|passed out|won'?t wake up|overdos\w*|severe bleeding|bleeding (a lot|heavily|badly|won'?t stop)|seizure|anaphyla\w*|throat (is )?(closing|swelling)|lips (are )?(swelling|blue))\b/i;
const CRISIS_RE = /\b(suicid\w*|kill (myself|me)|end (my|it all)|end my life|want to die|don'?t want to (live|be alive)|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself)\b/i;
const INFO_QUESTION_RE = /^(what|how|when|which|are|is|can|signs|symptoms)\b.*\b(signs?|symptoms?|warning|know|tell|recogni[sz]e)\b/i;

// Requests a virtual assistant should not fulfil. It declines kindly, then still helps where it safely can.
const RISKY = [
  {
    id: 'diagnosis',
    re: /\b(do i have|have i got|does (he|she|my \w+) have|could (it|this|i) (be|have)|am i)\b.{0,40}\b(cancer|tumou?r|diabetes|covid|strep|pregnant|uti|infection|flu|pneumonia|disease|std|sti|hiv|heart attack|stroke|appendicitis|broken|fractured?|concussion|depression|adhd|autism|lupus)\b|\bdiagnos(e|is)\b.{0,15}\b(me|my|this)\b/i,
    say: "I can't diagnose conditions. That takes a clinician who can examine you and order tests. But I can help you figure out **where to get care**, or share general information.",
    options: ['Check my symptoms', 'Book an appointment', NURSE_OPTION],
  },
  {
    id: 'controlled',
    re: /\b(xanax|alprazolam|adderall|ritalin|vyvanse|oxy\w*|percocet|vicodin|hydrocodone|codeine|morphine|fentanyl|tramadol|valium|diazepam|klonopin|ativan|ambien|opioids?|benzos?)\b/i,
    when: /\b(get|need|want|prescribe|give|refill|more|buy|order|send)\b/i,
    say: "🛑 I can't help get controlled medications like opioids, stimulants or benzodiazepines. For safety, those can only be handled directly by your provider. If you're running low on something you're already prescribed, a nurse can pass a message to your provider today.",
    options: [NURSE_OPTION, MENU_OPTION],
    stop: true,
  },
  {
    id: 'prescribe',
    re: /\b(prescribe|write me|give me|send me|call in|can i get|i need|i want)\b.{0,25}\b(antibiotics?|amoxicillin|azithromycin|a prescription|prescription for|meds for|medication for|ozempic|wegovy|viagra|birth control|paxlovid|tamiflu)\b|\bprescribe me\b/i,
    say: "I can't prescribe medicine. A provider has to evaluate you first. A **video visit** (7 AM–11 PM daily) is usually the fastest way to get a prescription if you need one.",
    options: ['Book an appointment', 'Check my symptoms', NURSE_OPTION],
  },
  {
    id: 'dosing',
    re: /\b(how much|how many|what dose|which dose|dosage|dose)\b.{0,50}\b(my (son|daughter|child|kid|baby|toddler|infant)|\d+\s?(lbs?|pounds|kg|kilos)|\d+[- ](year|month|week)s?[- ]old|for (him|her))\b/i,
    say: "I can't calculate a medicine dose for a specific person. Children's doses depend on **weight and age**, and mistakes can be dangerous. Use the dosing chart on the package, or ask a pharmacist or nurse to confirm the right amount.",
    options: [NURSE_OPTION, MENU_OPTION],
  },
];

const ESCALATE_RE =/\b(human|real person|live (agent|person|chat|nurse)|representative|(talk|speak|chat) (to|with) (a |an |some |the |my )?(person|someone|human|staff|agent|nurse|doctor|provider)|connect me|call me back)\b/i;
const FRUSTRATED_RE = /\b(useless|frustrat\w*|angry|ridiculous|not helpful|unhelpful|this sucks|terrible|annoy\w*|wtf|stupid bot)\b/i;
const URGENT_RE = /\b(urgent|asap|emergency|getting worse|really bad|severe|unbearable|worst)\b/i;

const MAX_SESSIONS = 500;
const sessions = new Map();

function addMessage(s, from, text, extra = {}) {
  const msg = { id: s.messages.length, from, text, at: Date.now(), ...extra };
  s.messages.push(msg);
  s.updatedAt = msg.at;
  return msg;
}

const say = (s, text, extra) => addMessage(s, 'bot', text, extra);

function getSession(id) {
  let s = sessions.get(id);
  if (s) return s;
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  s = {
    id, messages: [], status: 'bot', workflow: null, lastWorkflow: null,
    profile: null, misses: 0, topics: [], flags: new Set(), summary: null, agentName: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  sessions.set(id, s);
  say(s, GREETING, { options: PRECHAT_OPTIONS });
  return s;
}

const findSession = (id) => sessions.get(id) || null;

function messagesSince(s, since) {
  const n = Math.max(0, Number(since) || 0);
  return { messages: s.messages.slice(n), total: s.messages.length, status: s.status, agentName: s.agentName };
}

// Returns true if the message was an emergency and the bot should stop there.
function screenEmergency(s, text) {
  if (CRISIS_RE.test(text)) {
    s.flags.add('crisis');
    say(s, "💛 I'm really glad you reached out. You don't have to go through this alone.\n\n**Call or text 988** to reach the Suicide & Crisis Lifeline, free and 24/7. You can also chat at 988lifeline.org.\n\nIf you or someone else is in immediate danger, **call 911** now.", {
      emergency: true,
      options: ['Chat with a nurse now', MENU_OPTION],
    });
    return true;
  }
  if (EMERGENCY_RE.test(text)) {
    s.flags.add('emergency');
    say(s, "🚨 **This could be a medical emergency. Call 911 now** or go to the nearest emergency room. Don't drive yourself.\n\nWhile you wait: stay with the person, unlock the door, and follow the 911 dispatcher's instructions.", {
      emergency: true,
    });
    // A question *about* warning signs still gets an answer after the safety message.
    return !INFO_QUESTION_RE.test(text);
  }
  return false;
}

async function handleMessage(s, text) {
  addMessage(s, 'user', text);
  if (FRUSTRATED_RE.test(text)) s.flags.add('frustrated');
  if (URGENT_RE.test(text)) s.flags.add('urgent');

  const stop = screenEmergency(s, text);

  // Once a nurse has the conversation, the bot stays quiet (apart from emergency warnings).
  if (s.status === 'waiting' || s.status === 'human') return;
  if (stop) {
    if (s.workflow) { s.lastWorkflow.outcome = 'Interrupted by emergency'; s.workflow = null; }
    if (!s.profile) s.profile = { who: 'Not specified' };
    return;
  }

  // Pre-chat: who is this for?
  if (!s.profile) {
    const who = PRECHAT_OPTIONS.find((o) => o.toLowerCase() === text.toLowerCase())
      || (/^(me|myself|for me|just me|me myself)$/i.test(text) ? 'Myself' : null)
      || (/^(my |for my )?(child|kid|son|daughter|baby)$/i.test(text) ? 'My child' : null);
    s.profile = { who: who || 'Not specified' };
    if (who) {
      const line = who === 'My child' ? "Thanks. I'll keep in mind we're talking about your child. "
        : who === 'Someone I care for' ? "Thanks for looking out for them. " : 'Thanks! ';
      return say(s, `${line}What can I help with? You can pick an option or just type any health question.`, { options: MENU });
    }
    // They skipped straight to a question, so answer it.
  }

  if (s.workflow) {
    if (/^(cancel|stop|exit|quit|never ?mind|main menu|menu|start over)$/i.test(text)) {
      s.lastWorkflow.outcome = 'Cancelled by patient';
      s.workflow = null;
      return say(s, "No problem, I've stopped that. What else can I help with?", { options: FULL_MENU });
    }
    // Asking for a nurse mid-task jumps to the contact menu, unless they're already answering it.
    if (ESCALATE_RE.test(text) && s.workflow.id !== 'contact') return applyStep(s, workflows.start(s, WORKFLOWS.contact));
    const step = workflows.advance(s, text);
    // If they typed a whole new question instead of answering, drop the workflow and handle the question.
    const changedSubject = step.unmatched && text.split(/\s+/).length >= 4
      && (workflows.findWorkflow(text) || /\?$|^(what|how|when|why|where|can|is|are|do|does|should)\b/i.test(text));
    if (!changedSubject) return applyStep(s, step);
    s.lastWorkflow.outcome = 'Patient changed the subject';
    s.workflow = null;
  }

  if (/^chat with a nurse now$/i.test(text)) return escalate(s, 'Patient asked to chat with a nurse');
  if (s.flags.has('frustrated') && FRUSTRATED_RE.test(text)) return escalate(s, 'Patient seems frustrated with the bot');
  if (ESCALATE_RE.test(text)) return applyStep(s, workflows.start(s, WORKFLOWS.contact));

  if (/^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/i.test(text) && text.split(/\s+/).length <= 4) {
    return say(s, 'Hi there! What can I help you with today?', { options: MENU });
  }
  if (/^(thanks|thank you|thx|ty|that helps|perfect|great)\b/i.test(text)) {
    return say(s, "You're welcome! Take care. Anything else I can help with?", { options: MENU });
  }
  if (/^(menu|main menu|help|options|start over|what can you do\??)$/i.test(text)) {
    return say(s, 'Here are some things I can do. You can also type any health question.', { options: FULL_MENU });
  }

  // Good judgment: decline what a bot shouldn't do, then help as far as it safely can.
  const risky = RISKY.find((r) => r.re.test(text) && (!r.when || r.when.test(text)));
  if (risky) {
    s.flags.add(`declined:${risky.id}`);
    say(s, risky.say, { declined: true, options: risky.options });
    if (risky.stop) return;
    return answerQuestion(s, text, { quietMiss: true });
  }

  const wf = workflows.findWorkflow(text);
  if (wf) return applyStep(s, workflows.start(s, wf, text));

  return answerQuestion(s, text);
}

async function applyStep(s, step) {
  say(s, step.text, { options: step.options, workflow: step.workflow });
  if (step.handoff) await escalate(s, step.handoff, { quiet: true });
}

async function answerQuestion(s, text, { quietMiss = false } = {}) {
  s.lastQuestion = text;
  let hits = kb.search(text, 3);
  // Short follow-ups ("how much is it?") borrow context from the previous question.
  if (!hits[0]?.confident) {
    const prev = [...s.messages].reverse().filter((m) => m.from === 'user')[1];
    if (prev && kb.tokenize(text).length <= 4) hits = kb.search(`${prev.text} ${text}`, 3);
  }
  const good = hits.filter((h) => h.confident);

  if (!good.length) {
    if (quietMiss) return; // already replied (e.g. after declining a risky request)
    // Not in EMedic's health library: with AI enabled, give careful general health information.
    const general = await llm.generalHealthAnswer(text, s.messages);
    if (general && !general.includes('NOT_HEALTH')) {
      s.misses = 0;
      return say(s, general, { general: true, options: [NURSE_OPTION, MENU_OPTION] });
    }
    return miss(s);
  }

  const passages = good.map((h) => h.chunk);
  let answer = await llm.groundedAnswer(text, passages, s.messages);
  if (answer && answer.includes('NO_ANSWER')) answer = null;
  let sources = passages;
  const fromAI = Boolean(answer);
  if (!answer) {
    // No API key (or API error): answer with the best-matching library section itself.
    const top = passages[0];
    answer = `From EMedic's health library, **${top.heading}**:\n\n${top.text}`;
    sources = [top];
  } else {
    // Only show sources the AI actually cited.
    const cited = passages.filter((_, i) => answer.includes(`[${i + 1}]`));
    if (cited.length) sources = cited;
  }

  s.misses = 0;
  s.topics.push(`${passages[0].title} › ${passages[0].heading}`);
  const wfId = sources.map((p) => p.workflow).find(Boolean);
  const options = wfId ? [WORKFLOWS[wfId].label, NURSE_OPTION] : [NURSE_OPTION, MENU_OPTION];
  say(s, answer, {
    sources: sources.map((p) => ({ title: p.title, heading: p.heading, doc: p.file.replace(/\.md$/, '') })),
    options,
    numbered: fromAI,
  });
}

function miss(s) {
  s.misses++;
  if (s.misses >= 2) {
    return escalate(s, "Bot couldn't find an answer twice in a row");
  }
  say(s, "I don't have trusted information on that in EMedic's health library, and I don't want to guess about your health. Could you rephrase it? Or a nurse can help.", {
    options: [NURSE_OPTION, MENU_OPTION],
  });
}

async function escalate(s, reason, { quiet = false } = {}) {
  s.workflow = null;
  s.status = 'waiting';
  s.escalatedAt = Date.now();
  s.escalationReason = reason;
  s.summary = await buildSummary(s, reason);
  say(s, `${quiet ? '' : "I'm connecting you with an EMedic nurse. "}I've shared this summary with the care team so **you won't have to repeat yourself**:`, { summary: s.summary });
  addMessage(s, 'system', 'Waiting for a nurse to join. Average wait: under 10 minutes. If this becomes an emergency, call 911.');
}

async function buildSummary(s, reason) {
  const userMsgs = s.messages.filter((m) => m.from === 'user').map((m) => m.text);
  const wf = s.lastWorkflow;
  const sentiment = s.flags.has('crisis') || s.flags.has('emergency') ? 'urgent'
    : s.flags.has('frustrated') ? 'frustrated' : s.flags.has('urgent') ? 'urgent' : 'calm';
  const triageOutcome = wf?.id === 'triage' ? wf.outcome : '';
  const base = {
    reason,
    priority: s.flags.has('crisis') || s.flags.has('emergency') ? 'Urgent'
      : sentiment !== 'calm' || /ER|urgent care|same-day/i.test(triageOutcome) ? 'High' : 'Normal',
    askingFor: s.profile?.who || 'Not specified',
    workflow: wf ? { title: wf.title, outcome: wf.outcome, data: workflows.visibleData(wf.data) } : null,
    topics: [...new Set(s.topics)].slice(-3),
  };

  const transcript = s.messages
    .filter((m) => m.from !== 'system')
    .slice(-16)
    .map((m) => `${m.from === 'user' ? 'Patient' : 'Bot'}: ${m.text}`)
    .join('\n');
  const ai = await llm.handoffSummary(transcript, reason);
  if (ai && ai.issue) {
    return {
      ...base,
      issue: ai.issue,
      details: Array.isArray(ai.details) ? ai.details.slice(0, 4) : [],
      sentiment: ai.sentiment || sentiment,
      suggestedNextStep: ai.suggestedNextStep || '',
      generatedBy: 'AI',
    };
  }

  // Rule-based summary when AI isn't configured.
  const skip = new Set([...MENU, ...PRECHAT_OPTIONS, MENU_OPTION, 'Chat with a nurse now', 'Request a callback', 'Call the Nurse Line']);
  // "Talk to a nurse" says how they want help, not what it's about, so leave it out of the topic search.
  const questions = userMsgs.filter((t) => !skip.has(t) && t.length > 8 && !ESCALATE_RE.test(t)).slice(-3);
  const details = wf && wf.id !== 'contact' ? Object.entries(workflows.visibleData(wf.data)).map(([k, v]) => `${k}: ${v}`) : [];
  if (wf?.id === 'contact' && wf.data['Callback number']) details.push(`Call back: ${wf.data['Callback number']} (${wf.data['Best time'] || 'any time'})`);
  // The latest message usually says what they actually need, even if it also asks for a person.
  const latestHit = questions.length ? kb.search(questions.at(-1), 1)[0] : null;
  const latestTopic = latestHit?.score >= 1.5 ? `${latestHit.chunk.title} › ${latestHit.chunk.heading}` : null;
  const issue = wf && wf.id !== 'contact' ? `${wf.title} (${wf.outcome})`
    : latestTopic || base.topics.at(-1) || questions.at(-1) || reason || 'General health question';
  return {
    ...base,
    issue,
    details: [...details, ...questions.map((q) => `Patient said: "${q}"`)].slice(0, 6),
    sentiment,
    suggestedNextStep: suggestedStep(s, wf),
    generatedBy: 'rules',
  };
}

function suggestedStep(s, wf) {
  if (s.flags.has('crisis')) return 'Check on safety first. Confirm whether they have contacted 988 or 911.';
  if (s.flags.has('emergency')) return 'Confirm the patient has called 911 or is getting emergency care.';
  if (wf?.data?.['Callback number']) return `Call the patient back at ${wf.data['Callback number']}.`;
  if (wf?.id === 'triage') return 'Review the symptom check answers and confirm the right level of care.';
  if (wf?.id === 'refill') return 'Review the refill request and route it to the prescribing provider.';
  if (wf?.id === 'appointment') return 'Help the patient finish or adjust their booking.';
  return "Review the patient's question above and reply directly.";
}

// ---- Care team console actions ----

function claim(s, name) {
  if (s.status === 'human') return;
  s.status = 'human';
  s.agentName = name;
  addMessage(s, 'system', `${name} joined the chat.`);
}

function agentReply(s, name, text) {
  if (s.status !== 'human') claim(s, name);
  addMessage(s, 'agent', text, { name });
}

function resolve(s, name) {
  s.status = 'bot';
  s.agentName = null;
  s.misses = 0;
  s.flags.clear();
  s.resolvedAt = Date.now();
  addMessage(s, 'system', `${name} ended the chat.`);
  say(s, "I'm back! If you need anything else, just ask.", { options: MENU });
}

// Post an update into a patient's chat (e.g. a nurse approved their refill).
function notify(sessionId, text) {
  const s = sessionId && sessions.get(sessionId);
  if (s) say(s, text, { update: true });
}

function listSessions() {
  const rank = { waiting: 0, human: 1, bot: 2 };
  return [...sessions.values()]
    .filter((s) => s.messages.length > 1)
    .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      status: s.status,
      agentName: s.agentName,
      priority: s.summary?.priority || (s.flags.has('emergency') || s.flags.has('crisis') ? 'Urgent' : undefined),
      issue: s.summary?.issue,
      escalatedAt: s.escalatedAt,
      updatedAt: s.updatedAt,
      lastMessage: s.messages.filter((m) => m.from !== 'system').at(-1)?.text?.slice(0, 90),
    }));
}

function sessionDetail(s) {
  return {
    id: s.id, status: s.status, agentName: s.agentName, summary: s.summary,
    escalationReason: s.escalationReason, escalatedAt: s.escalatedAt, messages: s.messages,
  };
}

module.exports = {
  getSession, findSession, handleMessage, messagesSince,
  claim, agentReply, resolve, listSessions, sessionDetail, notify,
  llmEnabled: llm.enabled,
};
