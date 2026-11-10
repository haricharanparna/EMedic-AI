// Public health-library pages built from knowledge/*.md, so an eGain AI Agent (or anyone)
// can be trained on the same content the chat answers from: point it at /library or upload the exported HTML.
const kb = require('./kb');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  const out = [];
  let list = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^[-*] /.test(t)) { (list = list || []).push(`<li>${inline(t.slice(2))}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (t) out.push(`<p>${inline(t)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('\n');
}

const slug = (s) => s.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function documents() {
  const docs = new Map();
  for (const c of kb.chunks) {
    if (!docs.has(c.file)) docs.set(c.file, { slug: slug(c.file), title: c.title, sections: [] });
    docs.get(c.file).sections.push(c);
  }
  return [...docs.values()];
}

function page(title, body, { standalone = false } = {}) {
  // Standalone pages (for upload) carry their own minimal styles; served pages use the site CSS.
  const head = standalone
    ? '<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6;color:#0f1f2a}h1{color:#0f766e}h2{margin-top:2em}</style>'
    : '<link rel="stylesheet" href="/style.css">';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>try{var t=localStorage.getItem('emedic-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<title>${esc(title)} · EMedic Health Library</title>
<meta name="description" content="EMedic patient library: ${esc(title)}. Demo content for the EMedic AI virtual care assistant.">
${head}</head>
<body class="doc-page"><main class="doc">
${body}
<p class="doc-foot">EMedic is a fictional health system created for this demo. This page is general health information, not medical advice. In an emergency, call 911. For a mental health crisis, call or text 988.</p>
</main></body></html>`;
}

function renderDoc(doc, opts) {
  const body = `<p class="doc-crumb"><a href="/library">EMedic Health Library</a></p>
<h1>${esc(doc.title)}</h1>
${doc.sections.map((s) => `<section id="${slug(s.heading)}"><h2>${esc(s.heading)}</h2>\n${md(s.text)}</section>`).join('\n')}`;
  return page(doc.title, body, opts);
}

function renderIndex() {
  const docs = documents();
  const body = `<h1>EMedic Health Library</h1>
<p>Clinician-style patient information used by the EMedic AI virtual care assistant. ${kb.chunks.length} topics.</p>
${docs.map((d) => `<h2><a href="/library/${d.slug}">${esc(d.title)}</a></h2>
<ul>${d.sections.map((s) => `<li><a href="/library/${d.slug}#${slug(s.heading)}">${esc(s.heading)}</a></li>`).join('')}</ul>`).join('\n')}`;
  return page('All topics', body);
}

function find(slugName) {
  return documents().find((d) => d.slug === slugName) || null;
}

module.exports = { documents, renderDoc, renderIndex, find };
