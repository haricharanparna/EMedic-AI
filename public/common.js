// Shared helpers for the patient chat and the nurse console.
window.CP = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // Tiny, safe markdown: **bold**, [links](https://...), "- " bullet lists and paragraphs.
  md(text) {
    const inline = (s) => CP.esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let list = null;
    for (const line of String(text ?? '').split('\n')) {
      const t = line.trim();
      if (/^[-*•] /.test(t)) {
        list = list || [];
        list.push(`<li>${inline(t.slice(2))}</li>`);
        continue;
      }
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      if (t) out.push(`<p>${inline(t)}</p>`);
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return out.join('');
  },

  summaryHtml(s) {
    if (!s) return '';
    const e = CP.esc;
    const wf = s.workflow
      ? `<div class="label">Workflow</div><div>${e(s.workflow.title)}: <b>${e(s.workflow.outcome)}</b></div>`
      : '';
    const details = s.details?.length
      ? `<div class="label">What they told me</div><ul>${s.details.map((d) => `<li>${e(d)}</li>`).join('')}</ul>`
      : '';
    return `<div class="summary">
      <div class="row">
        <span class="pill ${s.priority === 'Normal' ? '' : 'high'}">${e(s.priority)} priority</span>
        <span class="pill">${e(s.sentiment)}</span>
        ${s.patientName ? `<span class="pill">Patient: ${e(s.patientName)}</span>` : ''}
        ${s.askingFor && s.askingFor !== 'Not specified' ? `<span class="pill">For: ${e(s.askingFor)}</span>` : ''}
      </div>
      <div class="label">Issue</div><div>${e(s.issue)}</div>
      ${wf}${details}
      ${s.suggestedNextStep ? `<div class="label">Suggested next step</div><div>${e(s.suggestedNextStep)}</div>` : ''}
    </div>`;
  },

  ago(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  },

  async api(url, body) {
    const res = await fetch(url, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  },

  store: {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  },
};
