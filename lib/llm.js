// Optional AI integration (any OpenAI-compatible chat completions API).
// Everything works without a key; the key makes answers conversational.
const API_URL = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

function enabled() {
  return Boolean(process.env.AI_API_KEY);
}

async function complete(system, messages, maxTokens = 600) {
  if (!enabled()) return null;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.AI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error('AI API error', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const json = await res.json();
    const text = (json.choices?.[0]?.message?.content || '')
      .replace(/<think>[\s\S]*?<\/think>/g, '') // some models include their reasoning inline
      .replace(/【(\d+)(?:†[^】]*)?】/g, '[$1]') // normalize full-width citation brackets to [1]
      .trim();
    return text || null;
  } catch (err) {
    console.error('AI API call failed:', err.message);
    return null;
  }
}

// Answer strictly from the retrieved passages. Returns null (no key / error) or 'NO_ANSWER'.
async function groundedAnswer(question, passages, history) {
  const sources = passages
    .map((p, i) => `[${i + 1}] ${p.title} > ${p.heading}\n${p.text}`)
    .join('\n\n');
  const system = `You are EMedic AI, the friendly virtual care assistant for EMedic.
Answer the patient's latest question using ONLY the numbered sources below. Do not use outside knowledge.
If the sources do not contain the answer, reply with exactly: NO_ANSWER
Keep answers under 120 words. Use short paragraphs or "- " bullet lists and **bold** for key numbers.
Cite sources inline like [1]. Never invent doses, phone numbers, prices or policies. Never diagnose.

SOURCES:
${sources}`;
  return complete(system, toMessages(history, question), 500);
}

// General health education when EMedic's health library has nothing on the topic.
async function generalHealthAnswer(question, history) {
  const system = `You are EMedic AI, a virtual care assistant for EMedic (a demo health system).
The patient asked something not covered by EMedic's health library. Give clear, accurate, general health education.
Rules:
- If the question is not about health, medicine, wellness or healthcare, reply with exactly: NOT_HEALTH
- Do not diagnose, and do not give personalized medication doses beyond "follow the label or ask your pharmacist".
- If anything described could be an emergency, start with: "**Call 911** if..." and the warning signs.
- End with one short line on when to see a provider.
- Under 130 words. Use "- " bullets and **bold** for key points. Plain, warm language at an 8th-grade reading level.`;
  return complete(system, toMessages(history, question), 450);
}

// The API needs alternating roles starting with the user; merge where needed.
function toMessages(history, question) {
  const recent = history.slice(-6).map((m) => ({
    role: m.from === 'user' ? 'user' : 'assistant',
    content: m.text || '(no text)',
  }));
  const msgs = [];
  for (const m of recent) {
    if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1].content += '\n' + m.content;
    else msgs.push({ ...m });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: question });
  return msgs;
}

// Summarize a conversation for the human agent. Returns parsed JSON or null.
async function handoffSummary(transcript, reason) {
  const system = `You write handoff notes for a nurse taking over a patient chat from a health system's virtual assistant.
Return ONLY a JSON object: {"issue": string (one sentence), "details": string[] (max 4 short facts the patient already gave, e.g. symptoms, age, duration), "sentiment": "calm"|"confused"|"frustrated"|"urgent", "suggestedNextStep": string (one sentence)}.`;
  const text = await complete(system, [{
    role: 'user',
    content: `Reason for handoff: ${reason}\n\nTranscript:\n${transcript}`,
  }], 400);
  if (!text) return null;
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

module.exports = { MODEL, enabled, groundedAnswer, generalHealthAnswer, handoffSummary };
