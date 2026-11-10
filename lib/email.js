// Optional confirmation emails, sent through Brevo's HTTP API (works on hosts that block SMTP ports).
// Set EMAIL_API_KEY (a Brevo API key) and EMAIL_FROM (a sender address verified in Brevo, e.g. your Gmail).
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

function enabled() {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send({ to, toName, subject, text, html }) {
  if (!enabled()) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.EMAIL_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || 'EMedic AI' },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        subject, textContent: text, htmlContent: html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error('Email API error', res.status, (await res.text()).slice(0, 300));
      return { ok: false, reason: 'api_error' };
    }
    return { ok: true };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { ok: false, reason: 'network' };
  }
}

// Appointment confirmation. Returns a short sentence for the patient.
async function sendAppointmentConfirmation(rec, to, name) {
  const where = rec.format === 'Video visit'
    ? 'Join from the MyEMedic app about 5 minutes early. The video link appears there 15 minutes before your visit.'
    : 'Please arrive 10 minutes early with your insurance card and photo ID.';
  const rows = [
    ['Confirmation #', rec.ref], ['When', rec.time], ['Visit', rec.visitType], ['Format', rec.format],
    ...(rec.reason && rec.reason !== 'Not given' ? [['Reason', rec.reason]] : []),
  ];
  const hello = name ? `Hi ${name},` : 'Hi,';
  const subject = `Your EMedic appointment is confirmed: ${rec.time}`;
  const text = [
    hello, '', 'Your appointment is booked.', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', where, '',
    `Need to change it? Ask EMedic AI to "reschedule ${rec.ref}" or "cancel ${rec.ref}".`,
    'Emergency? Call 911. Mental health crisis? Call or text 988.', '',
    'EMedic is a fictional health system created for a hackathon demo.',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
  <div style="background:#0f766e;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0;font-size:18px;font-weight:bold">EMedic AI</div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:22px">
    <p style="margin:0 0 12px">${esc(hello)}</p>
    <p style="margin:0 0 16px;font-size:17px"><b>✅ Your appointment is booked.</b></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#64748b;width:140px">${esc(k)}</td><td style="padding:7px 0;font-weight:bold">${esc(v)}</td></tr>`).join('')}
    </table>
    <p style="margin:16px 0 0;font-size:14px">${esc(where)}</p>
    <p style="margin:12px 0 0;font-size:14px">Need to change it? Ask EMedic AI to <b>"reschedule ${esc(rec.ref)}"</b> or <b>"cancel ${esc(rec.ref)}"</b>.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#b91c1c">Emergency? Call 911. Mental health crisis? Call or text 988.</p>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">EMedic is a fictional health system created for a hackathon demo.</p>
  </div>
</div>`;
  const r = await send({ to, toName: name, subject, text, html });
  if (r.ok) return { ok: true, message: `📧 Confirmation sent to **${to}**. If you don't see it in a minute, check your spam folder.` };
  if (r.reason === 'not_configured') return { ok: false, message: `I couldn't email **${to}** because email isn't set up on this server yet. Your booking is still confirmed: **${rec.ref}**.` };
  return { ok: false, message: `Sorry, the confirmation email to **${to}** didn't go through. Your booking is still confirmed: **${rec.ref}**.` };
}

module.exports = { EMAIL_RE, enabled, send, sendAppointmentConfirmation };
