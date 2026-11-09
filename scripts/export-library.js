// Export the health library as standalone HTML files you can upload to eGain (or any AI agent builder).
// Run: node scripts/export-library.js   →   writes export/library/*.html
const fs = require('node:fs');
const path = require('node:path');
const library = require('../lib/library');

const out = path.join(__dirname, '..', 'export', 'library');
fs.mkdirSync(out, { recursive: true });

let count = 0;
for (const doc of library.documents()) {
  const file = path.join(out, `${doc.slug}.html`);
  fs.writeFileSync(file, library.renderDoc(doc, { standalone: true }));
  console.log(`wrote ${path.relative(process.cwd(), file)}  (${doc.sections.length} topics)`);
  count += doc.sections.length;
}
console.log(`\n${count} topics exported to ${path.relative(process.cwd(), out)}`);
