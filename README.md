# EMedic AI: 24/7 Virtual Care Assistant

EMedic AI is a patient support bot for **EMedic**, a fictional health system. Patients can ask any health question, find out where to get care, refill prescriptions, book visits, and reach a nurse, who sees a summary of the whole conversation.

- **Industry:** Healthcare
- **Use case:** Patient self-service and nurse triage, with human escalation

> **Building the hackathon entry in eGain?** Follow **[EGAIN-GUIDE.md](EGAIN-GUIDE.md)**. It walks through every eGain screen and workflow, using this project as the live "hospital system" that eGain's API nodes call.

## What it does

1. **Sourced health answers.** A health library of **40+ topics** in `knowledge/`: where to get care, common illnesses, medications, chronic conditions, prevention, mental health, and clinic services. Every answer shows its source. If a topic isn't covered, EMedic AI says so instead of guessing. With an AI API key, it also gives careful **general health info** on any other health topic, clearly labeled as such.
2. **Pre-chat:** asks "Who are you asking about: myself, my child, or someone I care for?" The answer is passed to the nurse.
3. **Guided workflows** (`lib/workflows.js`):
   - **Symptom check:** a red-flag safety screen, then symptom, age, severity and duration. It recommends **ER, urgent care, a same-day video visit, a visit in 1–2 days, or home care**, with self-care tips.
   - **Prescription refill:** medication, a controlled-substance check (stops and routes to a nurse), date of birth (validated), refills remaining, pharmacy, confirm, and an `RX-` reference.
   - **Book an appointment:** visit type, in person or video, real upcoming time slots, reason, confirm, and an `APT-` reference.
   - **Talk to a nurse**, with **3 contact options**: live chat, the 24/7 Nurse Line, or a callback (phone number validated).
4. **Safety first:** every message is screened for emergencies (chest pain, stroke signs, trouble breathing, overdose and more), which get **call 911** guidance. Signs of a mental health crisis get **988**. This works even in the middle of a workflow or while a nurse is chatting.
5. **Real actions, saved and trackable.** Bookings, cancellations, reschedules, refill requests and callbacks are stored in `data/store.json`. Patients can manage an appointment by confirmation number ("reschedule APT-123456") or check a refill ("status of RX-123456").
6. **Good judgment.** It declines diagnosis ("do I have strep?"), prescribing, controlled substances, and dose calculations for a specific child. Each refusal is kind, and it then still shares safe library information or routes to the right next step.
7. **Nurse Console Requests tab.** Nurses see every refill, callback and booking. When they **Approve** or **Deny** a refill, the patient gets a live update in their chat.
   **Booking:** a visit-details form in the chat (name, date of birth, phone, email, clinic, insurance and member ID, language, reason, consent), then **choose your nurse** from cards filtered by clinic, visit type and video, with speakers of your language first. **Meet our nurses** in the sidebar is a filterable directory with "Book with" buttons.
   **Schedule tab:** nurses open the appointment times patients can book (one time, or a standard day in one click) and remove open ones. The bot and the Actions API only offer those times. A new install starts with a default week. Times use `CLINIC_TZ` (default `America/New_York`).
8. **Actions API** (`/api/actions/*`, key-protected, spec at `/openapi.json`). External agents, like an eGain AI Agent's API nodes, can take the same actions over REST. Add `?soft=1` to get friendly `ok:false` errors instead of HTTP errors.
9. **Public health library** at `/library`. Export it for upload with `node scripts/export-library.js`, which writes `export/library/*.html`.
10. **Smart nurse handoff:** the nurse sees priority (Urgent, High or Normal), sentiment, who the patient is asking about, workflow answers, what the patient said, and a suggested next step. They take over in the **Nurse Console** (`/agent`, protected by a passcode).

## Run it

You need **Node.js 22 or newer**. There are no npm dependencies.

```bash
node server.js
```

- Patient chat: http://localhost:3000
- Nurse console: http://localhost:3000/agent (open it in a second window for the demo)

The nurse console passcode comes from `STAFF_PASSCODE` in `.env`. If that isn't set, the default is `emedic-staff`. `.env` is gitignored.

Run the tests (26 end-to-end checks):

```bash
node test/smoke.js
```

### Optional: AI-powered answers

Without an API key, EMedic AI answers with the matching library section and writes the handoff summary with rules. **With a key, it can answer any health question.** Library topics get conversational, cited answers. Other health topics get general health information with safety guardrails. The AI also writes the nurse handoff summary. It works with any OpenAI-compatible API. Add this to `.env`:

```
AI_API_KEY=your-key
# optional: AI_MODEL=gpt-4o-mini
# optional: AI_API_URL=https://api.openai.com/v1/chat/completions
```

### Optional: confirmation emails

After a booking, EMedic AI asks for an email (or a phone number for a reminder text) and emails the confirmation **from your own address**. It uses [Brevo](https://www.brevo.com)'s free HTTP API (300 emails/day), because many free hosts, Render included, block outgoing SMTP.

1. Sign up at Brevo, go to **Senders, Domains & Dedicated IPs → Senders**, add your email, and click the verification link it sends you.
2. Create an API key under **SMTP & API → API Keys**.
3. Add to `.env` (and to Render's Environment):

```
EMAIL_API_KEY=xkeysib-...
EMAIL_FROM=you@gmail.com
EMAIL_FROM_NAME=EMedic AI
```

Without these, bookings still work and the bot says honestly that the email couldn't be sent. Reminder texts are a demo: the number is saved with the booking, but no SMS is sent.

## Deploy (for the "working demo link")

**Render (free):**
1. Push this repo to GitHub.
2. In Render, choose **New → Web Service** and pick the repo.
3. Set **Build command** to `echo no build` and **Start command** to `node server.js`.
4. Under Environment, add `STAFF_PASSCODE`, `ACTIONS_API_KEY` (a long random string) and, optionally, `AI_API_KEY`.

Chats are kept in memory. Bookings, refills and callbacks are saved to `data/store.json`. On Render's free tier, both reset when the app redeploys. That's fine for a demo.

## Project layout

```
server.js            HTTP server + API routes (no framework)
lib/kb.js            Loads knowledge/*.md, splits by "## " section, ranks with BM25
lib/workflows.js     Symptom check, refill, refill status, booking, manage-appointment and contact workflows
lib/actions.js       The real actions (book/cancel/reschedule, refills, callbacks), shared by chat and API
lib/store.js         Saves actions to data/store.json
lib/library.js       Public /library pages built from knowledge/
lib/bot.js           Pre-chat, emergency screening, good-judgment checks, routing, handoff summaries
public/openapi.json  Actions API spec (for eGain API nodes or any REST client)
scripts/             export-library.js: library → standalone HTML files for upload
EGAIN-GUIDE.md       Step-by-step build of the eGain AI Agent entry
lib/llm.js           Optional AI calls (grounded answers, general health info, summaries)
lib/email.js         Optional booking confirmation emails (Brevo HTTP API)
lib/schedule.js      Appointment times the nurses open in the Schedule tab
lib/nurses.js        The care team (fictional nurses), clinics and languages
knowledge/*.md       The health library. Edit these to change what the bot knows
public/              Patient chat (index.html, app.js) and Nurse Console (agent.html, agent.js)
test/smoke.js        End-to-end tests
```

To add knowledge, add a `## Heading` section to any file in `knowledge/`. Optional hidden lines: `<!-- keywords: extra search words -->` and `<!-- workflow: triage -->` (offers that workflow as a button after the answer).

## Submission text (150 words)

> **EMedic AI** gives patients trustworthy health help at any hour. Patients often can't tell whether they need the ER, urgent care or just rest. They wait on hold for simple refills, and they repeat their story to every nurse.
>
> EMedic AI answers health questions from a clinician-style library and shows the source for every answer. It never guesses. A symptom checker screens for red flags first, then recommends the right level of care. Guided workflows handle prescription refills (with a controlled-medication safety stop) and appointment booking. Every message is screened for emergencies, which get immediate 911 or 988 guidance.
>
> What sets it apart is **safety-first handoff**. Patients can chat live with a nurse, call, or request a callback. The nurse gets a prioritized summary: who's sick, symptoms, triage result and next step. That means fewer unnecessary ER visits, shorter phone queues, and patients who never repeat themselves.

## 1-minute demo video script

| Time | Show | Say |
|---|---|---|
| 0:00–0:07 | Loading screen → landing page | "This is EMedic AI, a 24/7 virtual care assistant for EMedic." |
| 0:07–0:17 | Click **Myself**, then ask *"How much Tylenol can I take?"* and point at the source chip | "Ask any health question. Answers come from a trusted library, with the source shown." |
| 0:17–0:35 | **New chat** → **My child** → **Check my symptoms** → No → Fever → Under 3 months → Mild → Less than 2 days | "The symptom checker screens for emergencies first, then tells you where to go. A fever in a newborn means the ER, right away." |
| 0:35–0:50 | Click **Talk to a nurse** → **Chat with a nurse now**, then switch to the Nurse Console and accept | "Here's the distinctive part: one tap reaches a nurse by chat, phone or callback, and the nurse gets a prioritized summary." |
| 0:50–1:00 | Type *"my dad has chest pain"* in a new chat | "And every message is screened for emergencies. EMedic AI always puts safety first." |

## Checklist before submitting

- [ ] `node test/smoke.js` passes (proves every workflow was tested)
- [ ] Deployed, and the demo link opens
- [ ] All four workflows clicked through on the deployed link
- [ ] Video recorded (Windows: Win+Alt+R, or OBS)

> EMedic, its phone numbers, prices and policies are fictional demo content. Health information is general education, not medical advice. This prototype is not for real patient data.
