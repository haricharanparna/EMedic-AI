// Shared helpers for the patient chat and the nurse console.
window.CP = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // Tiny, safe markdown: **bold**, [links](https://...), "- " bullet lists and paragraphs.
  md(text) {
    const inline = (s) => CP.esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[(\d{1,2})\](?!\()/g, '<sup class="cite">$1</sup>'); // source markers like [1]
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

  // Light/dark: follow the system until the user picks one with a toggle button (data-theme-toggle).
  theme: {
    KEY: 'emedic-theme',
    current() {
      const t = document.documentElement.dataset.theme;
      if (t === 'light' || t === 'dark') return t;
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    // 'light', 'dark', or 'system' (follow the device again).
    set(t) {
      const root = document.documentElement;
      root.classList.add('theme-anim');
      if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
      CP.store.set(CP.theme.KEY, t === 'light' || t === 'dark' ? t : '');
      CP.theme.paint();
      setTimeout(() => root.classList.remove('theme-anim'), 300);
      document.dispatchEvent(new CustomEvent('themechange'));
    },
    choice() {
      const t = document.documentElement.dataset.theme;
      return t === 'light' || t === 'dark' ? t : 'system';
    },
    paint() {
      const dark = CP.theme.current() === 'dark';
      document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
        b.innerHTML = dark ? CP.theme.SUN : CP.theme.MOON;
        b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        b.setAttribute('aria-label', b.title);
      });
    },
    init() {
      document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
        b.addEventListener('click', () => CP.theme.set(CP.theme.current() === 'dark' ? 'light' : 'dark'));
      });
      // Until they choose, keep following the system setting live.
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', CP.theme.paint);
      CP.theme.paint();
    },
    SUN: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    MOON: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  },
  // Accessibility settings, saved in this browser and applied as classes on <html> (see the head script).
  a11y: {
    KEY: 'emedic-a11y',
    FONT: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap',
    get() { try { return JSON.parse(CP.store.get(CP.a11y.KEY) || '{}'); } catch { return {}; } },
    set(patch) {
      const a = { ...CP.a11y.get(), ...patch };
      CP.store.set(CP.a11y.KEY, JSON.stringify(a));
      CP.a11y.apply(a);
      return a;
    },
    apply(a) {
      const r = document.documentElement;
      if (a.text === 'lg' || a.text === 'xl') r.dataset.text = a.text; else delete r.dataset.text;
      r.classList.toggle('hc', Boolean(a.hc));
      r.classList.toggle('rm', Boolean(a.rm));
      r.classList.toggle('readable', Boolean(a.readable));
      if (a.readable && !document.getElementById('readableFont')) {
        const l = document.createElement('link');
        l.id = 'readableFont';
        l.rel = 'stylesheet';
        l.href = CP.a11y.FONT;
        document.head.appendChild(l);
      }
    },
  },
};
CP.theme.init();
