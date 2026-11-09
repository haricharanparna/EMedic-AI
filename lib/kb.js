// Knowledge base: loads knowledge/*.md, splits on "## " headings, and ranks sections with BM25.
const fs = require('node:fs');
const path = require('node:path');

const KB_DIR = path.join(__dirname, '..', 'knowledge');
const STOP = new Set(`a an the is are was were be been to of and or in on at for with how what when where who whom why
do does did doing i my me we our can could you your it its this that these those from by as about if will would should
there their they them get got have has had am any some much many please tell know need want just like so than then into
also not no yes up out more most very really all feel feeling cant can't dont don't wont won't im i'm ive
been being something anything thing things`.split(/\s+/));

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

function load() {
  const chunks = [];
  for (const file of fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = fs.readFileSync(path.join(KB_DIR, file), 'utf8').replace(/\r\n/g, '\n');
    const title = (raw.match(/^# (.+)$/m) || [, file])[1].trim();
    for (const part of raw.split(/^## /m).slice(1)) {
      const [heading, ...rest] = part.split('\n');
      let body = rest.join('\n').trim();
      const wf = body.match(/<!--\s*workflow:\s*([\w-]+)\s*-->/);
      const keywords = body.match(/<!--\s*keywords:\s*(.+?)\s*-->/);
      body = body.replace(/<!--[\s\S]*?-->/g, '').trim();
      const tokens = [
        ...tokenize(heading), ...tokenize(heading), // headings count double
        ...tokenize(keywords ? keywords[1] : ''),
        ...tokenize(body),
      ];
      chunks.push({
        id: `${file}#${chunks.length}`,
        file, title, heading: heading.trim(), text: body,
        workflow: wf ? wf[1] : null,
        tokens, tf: counts(tokens),
      });
    }
  }
  return chunks;
}

function counts(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

const chunks = load();
const avgLen = chunks.reduce((n, c) => n + c.tokens.length, 0) / chunks.length;
const df = new Map();
for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);

function idf(t) {
  const n = df.get(t) || 0;
  return Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
}

// Returns [{ chunk, score, coverage, confident }] best first.
function search(query, k = 3) {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const k1 = 1.4, b = 0.75;
  const results = chunks.map((c) => {
    let score = 0, matched = 0, weightAll = 0, weightMatched = 0;
    for (const t of q) {
      const w = idf(t);
      weightAll += w;
      const f = c.tf.get(t) || 0;
      if (!f) continue;
      matched++;
      weightMatched += w;
      score += w * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.tokens.length / avgLen));
    }
    // Coverage is IDF-weighted so rare, meaningful words matter more than common ones.
    const coverage = weightAll ? weightMatched / weightAll : 0;
    return { chunk: c, score, matched, coverage };
  }).filter((r) => r.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
  for (const r of results) r.confident = r.score >= 1.5 && r.coverage >= 0.45;
  return results;
}

module.exports = { search, tokenize, chunks };
