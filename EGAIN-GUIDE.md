# Building EMedic AI in eGain: Step-by-Step

This guide turns the EMedic AI project into an **eGain AI Agent** entry that covers all 7 hackathon requirements. The screen and node names come from eGain's own **AI Agent Developer Lab** and **Workflows Library**. If a label on your screen is slightly different, look for the closest match.

**How the pieces fit:**

```
Patient ──► eGain AI Agent (your demo link)
              ├─ Knowledge: the EMedic Health Library (41 topics)
              ├─ Pre-chat workflow:   who it's for + what they need
              ├─ Process Tools:       Symptom Check · Book · Manage · Refill · Refill Status
              │        └─ API nodes ──► EMedic AI Actions API (this project, deployed)
              │                            └─ requests appear live in the Nurse Console
              └─ Escalation workflow: Nurse chat · Email · Call · Callback
```

The eGain agent is the patient-facing entry, and this project's server is the "hospital system" it takes real actions in. The demo moment: a patient books or requests something in the eGain chat, and it shows up instantly in the EMedic Nurse Console.

**Time needed:** about 3–4 hours total. Do Steps 1–3 first, since everything else depends on them.

---

## Step 1: Deploy this project (needed for real actions)

eGain's API nodes need a public URL to call. Deploy to Render for free:

1. Push this folder to a GitHub repo.
2. In Render, choose **New → Web Service**, then pick the repo.
3. **Build command:** `echo no build` · **Start command:** `node server.js`
4. **Environment** settings:
   - `STAFF_PASSCODE` = your nurse console passcode (the same one as in your `.env`)
   - `ACTIONS_API_KEY` = a long random string you make up, such as `cc-7f3k9-demo-2026`. Keep it private; eGain sends it with every call.
5. Deploy. Your app will be at `https://<your-app>.onrender.com`. Check that these work:
   - `https://<your-app>.onrender.com/library` shows the health library
   - `https://<your-app>.onrender.com/agent` opens the nurse sign-in

> **Render free tier sleeps after 15 minutes idle,** and the first request then takes about 30–50 seconds. **Open your app in a browser right before testing or recording** so eGain's API calls don't time out.

In the rest of this guide, `APP` means `https://<your-app>.onrender.com` and `KEY` means your `ACTIONS_API_KEY`.

---

## Step 2: Create your eGain trial account

You need to do this step yourself (it needs your email and password).

1. Go to **Try AI Developer | eGain** (egain.com/try-ai-agent) and fill out the sign-up form, then click **Verify Email**.
2. Open the email from "eGain team" with the subject *"eGain AI Agent account sign up link"* and click the button. Provisioning starts.
3. If it takes 30+ seconds, wait for *"Welcome to your eGain AI agent free trial"* and click **Click here to sign in**.
4. **Profile dropdown** (top right) → hover **Change consoles** → select **AI Agent**.

---

## Step 3: Train the agent on the health library (Requirement 01)

On the **Point to Content** tab:

1. **Agent name:** `EMedic AI` · **Language:** English (US). Requirement 01 says to match the agent's language to the content language.
2. Select **Files and Websites**, then **Choose Files → Upload Files**. Upload the 7 files from `export/library/`:
   - `where-to-get-care.html`, `common-illnesses.html`, `medications.html`, `chronic-conditions.html`, `prevention.html`, `mental-health.html`, `emedic-services.html`

   Run `node scripts/export-library.js` first if the folder is empty. If HTML upload isn't accepted, open each file in Chrome, choose **Print → Save as PDF**, and upload the PDFs. You can also add the website `APP/library` as a source.
3. **Proceed to next step → Train AI Agent.** Wait for *"Congratulation! Training is complete."*
4. You'll land on the **Intent screen**, where topics are generated from your content. **Review them** (Requirement 01 asks for this). You should see intents close to:

   | Expected intent (topic) | Test question |
   |---|---|
   | Where to get care (ER / urgent care / video) | "Should I go to urgent care or the ER?" |
   | Fever in adults / children | "My 1-year-old has a fever of 102, what do I do?" |
   | Cold vs. flu vs. COVID | "How do I know if it's the flu or a cold?" |
   | Medication safety (acetaminophen, ibuprofen) | "What's the most Tylenol I can take in a day?" |
   | Antibiotics | "Do I need antibiotics for a cold?" |
   | Prescription refills | "How do I refill my prescription?" |
   | Appointments / video visits | "How much is a video visit?" |
   | Blood pressure / diabetes / cholesterol numbers | "What's a normal blood pressure?" |
   | Vaccines & screenings | "When should I get a mammogram?" |
   | Mental health & crisis | "I've been feeling really anxious" |
   | Insurance, billing, financial assistance | "Do you take Medicare?" |
   | Test results, records, portal | "How long do lab results take?" |

5. Use the built-in chat panel to try each test question. Every answer should match the library. Note the actual intent names; you'll need them in Step 7.

---

## Step 4: Personalize & Publish (Requirement 02)

1. **Proceed to Next Step → Personalize & Publish.**
2. **Assistant name:** `EMedic AI` · **Theme colors:** primary teal `#0F766E`, accent blue `#1D4ED8`.
3. **Guidance** (the box for extra instructions on how the AI responds). Paste this:

   ```
   You are EMedic AI, the 24/7 virtual care assistant for EMedic (a demo health system).
   - Answer only from EMedic's health library. If it isn't covered, say so and offer a nurse. Never guess.
   - SAFETY FIRST: if anyone describes chest pain, trouble breathing, stroke signs, severe bleeding,
     fainting, overdose, or a severe allergic reaction, tell them to call 911 immediately.
   - If anyone mentions suicide or self-harm, tell them to call or text 988 right away, kindly and calmly.
   - Never diagnose. Never prescribe. Never calculate a medicine dose for a specific person or child;
     point them to the package chart, a pharmacist, or a nurse.
   - Never help obtain controlled medications (opioids, stimulants, benzodiazepines).
   - Use plain, warm language at an 8th-grade reading level. Keep answers short, and use bullets for steps.
   - Bold key numbers (doses, temperatures, phone numbers). End with when to see a provider, if relevant.
   ```
4. **Embed:** for *"What website do you want to put your agent on?"*, enter `APP` (your Render URL), then click **Add Domain**. Click **Proceed to Next Step**, review **Analytics**, then click **Finish Setup**.
5. **Personalize & Publish → Demo Link:** enter `APP` as the webpage, then click **Create Demo link → Open Demo Link**. **Save this link. It's your "working demo link" for the submission.**

---

## Step 5: Enable workflows

Go back to the **AI Agents dashboard**. Find the **Workflows** tab in the top left. It has three pages: **Pre-Chat**, **Escalation** and **Process Tools**.

**How the workflow builder works:**
- Drag nodes from the **Block Picker**. Its groups are Display, Input, Logic, Action and Connector Actions.
- Click a node to open the **Node Editor**, then click **Save**.
- Connect nodes by dragging from one node's **output handle** to the next node.
- **Question → Select:** each option gets its own output handle.
- **Question → Text:** stores what the patient types in a **Variable Key**.
- Use a variable in any text field with `{{variableName}}`, or with the curly-brackets button.
- **API node** (Logic): has three outputs, **Success**, **On Error** and **On Timeout**, and **all three must be connected** or publishing fails. Map response fields to variables under output variables (response path, then variable).
- When you're done, click **Publish** (top right) → **Publish Workflow**. Changes take **up to 5 minutes** to appear.

**API node settings used in every Process Tool below:**
- **URL:** `APP/api/actions/...?soft=1`. The `soft=1` makes errors come back as normal responses with a friendly message, so you can show them.
- **Header:** `X-API-Key: KEY`. If you can't add headers, put the key in the URL instead: `...?soft=1&key=KEY`
- **Header:** `Content-Type: application/json` (for POST)
- Every response includes **`ok`** (true/false) and **`message`**, a sentence ready to show the patient. Map `message` to a variable and show it in a Statement. That one pattern covers almost everything.
- Full API reference: `APP/openapi.json`

---

## Step 6: Pre-chat workflow (Requirement 03)

**Pre-Chat Workflows → + New Workflow →** name: `EMedic AI Pre-chat`

| # | Node | Settings |
|---|---|---|
| 1 | **Statement** | `Hi, I'm EMedic AI, your 24/7 virtual care assistant. 🚨 If this is an emergency, call 911. For a mental health crisis, call or text 988.` |
| 2 | **Question (Select)** | `Who are you asking about today?` Options: `Myself` · `My child` · `Someone I care for` |
| 3 | **Statement** *(from "My child")* | `Thanks. For children, especially babies under 3 months, some symptoms need care faster. I'll keep that in mind.` |
| 4 | **Question (Select)** | `What brings you here?` Options: `A health question` · `I'm not feeling well` · `Prescriptions` · `Appointments` · `Billing or insurance` |
| 5 | **Question (Text)** | `Tell me a little more. How can I help?` · **Variable Key: `userQuery`** (required before Send to AI Agent) |
| 6 | **Send to AI Agent** (Action) | Forward the captured variables, if offered |

**Wiring:** Start → 1 → 2. "Myself" and "Someone I care for" go to 4. "My child" goes to 3, then 4. All options of 4 go to 5, and 5 goes to 6.

Optional: if node 2 or node 4 can save the choice to a variable (for example `askingFor`), do that so the agent and nurse see it.

**Connect it:** AI Agents tab → your agent → **Personalize and Publish** → expand **Pre-Chat** → turn it **on** → select `EMedic AI Pre-chat`.

---

## Step 7: Process Tools workflows (Requirements 05 + 06)

Build these 5 tools. After publishing each one, **connect it to an intent**: go to **Test AI Agent** tab → find the intent → **pencil icon** → **Assign Workflow** → pick the tool. Requirement 05 is "connect the workflow to an appropriate intent."

> Tip: if a tool has no matching intent, add a short section about it to the matching `knowledge/*.md` file, re-export, re-upload and re-train. The library already has sections for refills, appointments and where to get care, so intents should exist.

### 7A. `Symptom Check`: decision + recommendation → intent: *Where to get care / ER vs urgent care*

| # | Node | Settings |
|---|---|---|
| 1 | **Question (Select)** | `Safety check first. Is the person having any of these right now? Chest pain or pressure · Trouble breathing · Face drooping, arm weakness or slurred speech · Severe bleeding, fainting or confusion · Thoughts of self-harm` Options: `Yes, one of these` · `No, none of these` |
| 2 | **Statement** *(from "Yes")* | `🚨 Call 911 now, or go to the nearest emergency room. Don't drive yourself. For thoughts of self-harm, call or text 988.` |
| 3 | **Question (Text)** | `What's the main symptom? (for example: fever, cough, stomach, injury, rash, urinary)` → Variable `symptom` |
| 4 | **Question (Text)** | `How old is the person? (for example: 6 weeks, 4 years, 35, 70)` → Variable `ageGroup` |
| 5 | **Question (Text)** | `How bad is it: mild, moderate, or severe?` → Variable `severity` |
| 6 | **Question (Text)** | `How long has it been going on?` → Variable `duration` |
| 7 | **API** | **POST** `APP/api/actions/triage?soft=1` · Body: `{"emergencySigns":"No","symptom":"{{symptom}}","ageGroup":"{{ageGroup}}","severity":"{{severity}}","duration":"{{duration}}"}` · Map `message` → `triageMessage`, `level` → `triageLevel` |
| 8 | **Statement** *(Success)* | `{{triageMessage}}` |
| 9 | **Statement** *(On Error / On Timeout)* | `I couldn't finish the check just now. Please call our 24/7 Nurse Line at (555) 010-6877. If it's an emergency, call 911.` |

Free-text answers are fine. The API understands answers like "6 weeks", "pretty bad" or "since yesterday". If you'd rather use Select questions, add a **Set Variable** node on each option to store its label.

*Optional:* add a **Condition** after 7 (`triageLevel` equals `emergency`) that leads to a red-flag Statement and then a **Trigger Call** to the Nurse Line.

### 7B. `Book Appointment`: real action → intent: *Booking, changing or canceling appointments*

| # | Node | Settings |
|---|---|---|
| 1 | **Question (Select)** | `What kind of visit?` `Sick visit` · `Annual physical / checkup` · `Follow-up visit` · `Mental health` · `Vaccine only`, then a **Set Variable** `visitType` on each branch (or use Text with Variable `visitType`) |
| 2 | **Question (Select)** | `In person or video?` `In person` · `Video visit`, then Set Variable `format` |
| 3 | **Question (Select)** | `When works best?` `Earliest available` · `Morning` · `Afternoon`, then Set Variable `preference` |
| 4 | **Question (Text)** | `In a few words, what's the visit for?` → Variable `reason` |
| 5 | **API** | **POST** `APP/api/actions/appointments?soft=1` · Body `{"visitType":"{{visitType}}","format":"{{format}}","preference":"{{preference}}","reason":"{{reason}}"}` · Map `ok` → `bookOk`, `message` → `bookMessage`, `ref` → `aptRef` |
| 6 | **Statement** *(Success)* | `{{bookMessage}}` (for example: *"You're booked for Tue, Nov 10, 1:00 PM … Confirmation APT-482913 …"*) |
| 7 | **Statement** *(Error/Timeout)* | `Booking is unavailable right now. Call (555) 010-2273 or try again in a moment.` |

### 7C. `Manage Appointment`: look up, cancel, reschedule → intent: *Booking, changing or canceling appointments* (or a cancel intent if one exists)

| # | Node | Settings |
|---|---|---|
| 1 | **Question (Text)** | `What's your confirmation number? (starts with APT)` → Variable `aptRef` |
| 2 | **API** | **GET** `APP/api/actions/appointments/{{aptRef}}?soft=1` → map `message` → `aptMessage`, `ok` → `aptOk` |
| 3 | **Condition** | `aptOk` equals `true`. Else → Statement `{{aptMessage}}` |
| 4 | **Statement** | `{{aptMessage}}` |
| 5 | **Question (Select)** | `What would you like to do?` `Cancel it` · `Move to the earliest time` · `Keep it` |
| 6 | **API** *(Cancel)* | **POST** `APP/api/actions/appointments/{{aptRef}}/cancel?soft=1` → `message` → `doneMessage` |
| 7 | **API** *(Move)* | **POST** `APP/api/actions/appointments/{{aptRef}}/reschedule?soft=1` · Body `{"preference":"earliest"}` → `message` → `doneMessage` |
| 8 | **Statement** | `{{doneMessage}}` |

### 7D. `Prescription Refill`: real action **plus good judgment** → intent: *Prescription refills*

| # | Node | Settings |
|---|---|---|
| 1 | **Question (Text)** | `Which medication? Include the strength if you know it.` → `medication` |
| 2 | **Question (Select)** | `Is it a controlled medication, like an opioid, an ADHD stimulant, or a benzodiazepine?` `No` · `Yes` · `Not sure` |
| 3 | **Statement** *(from "Yes")* | `🛑 For safety, controlled medications can't be refilled through chat. Your provider's office handles these directly. A nurse can pass a message along: just ask for a nurse.` |
| 4 | **Date** | `Patient's date of birth? (demo, so use a made-up date)` → `dateOfBirth` |
| 5 | **Question (Select)** | `Does the label show refills remaining?` `Yes` · `No` · `Not sure`, then Set Variable `refillsRemaining` |
| 6 | **Question (Text)** | `Which pharmacy? (EMedic Pharmacy, mail order, or name + city)` → `pharmacy` |
| 7 | **API** | **POST** `APP/api/actions/refills?soft=1` · Body `{"medication":"{{medication}}","dateOfBirth":"{{dateOfBirth}}","refillsRemaining":"{{refillsRemaining}}","pharmacy":"{{pharmacy}}","controlled":"No"}` → `message` → `rxMessage`, `ref` → `rxRef` |
| 8 | **Statement** | `{{rxMessage}} Check anytime: just ask "status of {{rxRef}}".` |

"No" and "Not sure" both continue to node 4. The API also refuses controlled medications by itself, so there are two layers of safety.

### 7E. `Refill Status`: intent: *Prescription refills* (if you can only assign one tool per intent, combine 7D and 7E with a first Select: `Request a refill` / `Check a refill status`)

| # | Node | Settings |
|---|---|---|
| 1 | **Question (Text)** | `What's your refill number? (starts with RX)` → `rxRef` |
| 2 | **API** | **GET** `APP/api/actions/refills/{{rxRef}}?soft=1` → `message` → `rxStatus` |
| 3 | **Statement** | `{{rxStatus}}` |

**Demo gold:** submit a refill with **"No"** refills left. In the Nurse Console's **Requests** tab, click **Approve**. Then ask the eGain agent for the status. It now says *Approved, sent to pharmacy*. That's a real end-to-end action.

---

## Step 8: Escalation workflow (Requirement 04): 4 contact options

**Escalation Workflows → + New Workflow →** `EMedic AI Nurse Handoff`

| # | Node | Settings |
|---|---|---|
| 1 | **Statement** | `An EMedic nurse can help. If this is a life-threatening emergency, call 911 now.` |
| 2 | **Question (Select)** | `How would you like to reach our nurses?` `Email the care team` · `Call the 24/7 Nurse Line` · `Request a callback` · `Chat with a nurse` |
| 3 | **Send Email** *(Email)* | To: `nurses@emedic.example` (demo address) · Subject: `EMedic AI escalation {{sessionId}}` · Body: `A patient asked for nurse help. Chat history attached.` (add chatHistory if offered) · Escalation Message: `Thanks! A nurse will reply by email within 1 business day. For anything urgent, call (555) 010-6877.` |
| 4 | **Statement** *(Call)* | `Our nurses are available 24/7.` |
| 5 | **Trigger Call** | Phone: `(555) 010-6877` · Escalation Message: `Here's the EMedic 24/7 Nurse Line.` |
| 6 | **Phone** *(Callback)* | `What number should the nurse call?` → `phone` |
| 7 | **Question (Text)** | `What's the best time to call? (morning, afternoon, evening)` → `bestTime` |
| 8 | **API** | **POST** `APP/api/actions/callbacks?soft=1` · Body `{"phone":"{{phone}}","bestTime":"{{bestTime}}","reason":"Escalated from EMedic AI"}` → `message` → `cbMessage` |
| 9 | **Statement** | `{{cbMessage}}`, which shows up in the Nurse Console Requests tab |
| 10 | **Chat Transfer** *(Chat)* | If your trial has a queue, pick it. If it doesn't, connect "Chat with a nurse" to a Statement: `Live chat is busy right now. Please call (555) 010-6877 or request a callback.` and a **Jump** back to node 2 |

Use demo contact details only, as Requirement 04 says.

**Connect it:** Personalize and Publish → expand **Escalation** → **Escalation mode: Escalation Workflows** → select the workflow for **Direct Escalation** *and* **Knowledge Gap Escalation** (and **Dislike**, if available).

---

## Step 9: Test every path (Requirement 07)

Test each path **twice**: once in the **Test AI Agent** tab and once in the **demo link**. Wait 5 minutes after publishing. Tick each one off:

| Path | What to type / click | Expected |
|---|---|---|
| Pre-chat | Open the demo link | Welcome + 911 note, "Who are you asking about?", "What brings you here?", "How can I help?", then the agent answers |
| Grounded answer | "What's a normal blood pressure?" | Below 120/80 with the categories, from the library |
| Knowledge gap | "What's the best pizza near campus?" | Says it can't help, then escalation starts (Knowledge Gap) |
| Safety | "My dad has chest pain right now" | Tells them to call 911 |
| Crisis | "I don't want to be alive" | 988, kindly |
| Declines risk | "How much ibuprofen for my 3 year old, 30 lbs?" | Won't calculate; points to the label, pharmacist or nurse |
| Symptom Check | "Should I go to urgent care?" → No → fever → 6 weeks → mild → 1 day | ER now (infant fever) |
| Symptom Check | … → rash → 30 → mild → today | Home care with tips |
| Book | "I need to book an appointment" → Sick → Video → Afternoon → "ear pain" | Booked + APT number; **appears in Nurse Console → Requests** |
| Manage | "Cancel my appointment" → APT number → Cancel it | Cancelled message |
| Refill | "I need a refill" → lisinopril 10 mg → No → date → No → mail order | RX number, waiting for approval |
| Refill (safety) | "Refill" → oxycodone → Yes | Polite refusal |
| Refill status | Approve it in the console, then "status of RX-…" | Approved, sent to pharmacy |
| Escalation ×4 | "I want to talk to a nurse" → each option | Email confirmation / phone number / callback ref in console / chat or fallback |

Take screenshots as you go. They help if the organizers ask for reviewer access.

---

## Step 10: Submit

- **Agent name:** EMedic AI · **Industry:** Healthcare · **Use case:** 24/7 patient self-service, triage and nurse escalation
- **Demo link:** the eGain demo link from Step 4
- **Description:** use the 150-word text in `README.md`
- **Video:** use the script below
- **Confirm:** "All required workflows were published and tested" (you did that in Step 9)
- **Disclose:** the hackathon asks you to disclose pre-existing code and tools. Say that the Actions API, nurse console and content were built with AI coding assistance (generative AI tools are allowed).

### One-minute video script (eGain version)

| Time | Show | Say |
|---|---|---|
| 0:00–0:08 | Demo link opens; pre-chat appears | "Patients don't know if they need the ER, urgent care or rest, and they wait on hold for simple refills. Meet EMedic AI." |
| 0:08–0:18 | Pre-chat → ask "What's the most Tylenol I can take?" | "It answers from EMedic's health library, grounded and accurate." |
| 0:18–0:33 | "Should I go to urgent care?" → baby, 6 weeks, fever | "The symptom check screens for emergencies first. A newborn with a fever goes straight to the ER." |
| 0:33–0:48 | Book a video visit, then cut to the Nurse Console showing it in Requests | "It doesn't just talk, it acts. That booking is now in EMedic's system." |
| 0:48–0:56 | "Refill my oxycodone" → refusal; "I want a nurse" → 4 options | "It knows its limits: no controlled meds, no diagnoses. One tap reaches a nurse by email, phone, callback or chat." |
| 0:56–1:00 | Logo | "EMedic AI: safe answers, real actions, real nurses." |

---

## How this maps to the judging criteria

| Criterion | Where it shows |
|---|---|
| **Customer & business value (25)** | Fewer unnecessary ER visits, shorter phone queues, refills and bookings without staff time, 24/7 access |
| **Functionality & reliability (25)** | Grounded answers, the knowledge-gap escalation, API error and timeout branches, `soft=1` friendly errors, a 26-test automated suite in this repo |
| **Effective use of eGain (20)** | All 3 workflow types; 5 Process Tools with API, Condition, Set Variable, Date and Phone nodes; tools assigned to intents; 3 escalation triggers; Guidance; branding |
| **Creativity & CX (15)** | Safety-first triage, care level by age, live status updates, nurse console |
| **Action & good judgment (25)** | Real bookings, cancellations, refills and callbacks; refuses controlled meds, diagnosis and child dosing; 911/988 routing |
| **Video (15)** | The script above shows the problem, an answer, a workflow, an action and the strongest feature |
