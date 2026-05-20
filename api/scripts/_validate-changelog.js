// One-shot dev validator: reads scripts/migrate.js, finds every changelog
// JSONB literal, simulates JS template-literal evaluation on the captured
// SQL string content, and runs JSON.parse to flag any malformed entry.
// Run with: node scripts/_validate-changelog.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'migrate.js'), 'utf8');
const regex = /INSERT INTO mcogs_changelog[\s\S]+?SELECT '([^']+)', '([^']+)', '(\[[\s\S]*?\])'::jsonb/g;

let m, idx = 0, fail = 0;
while ((m = regex.exec(src)) !== null) {
  idx++;
  const version = m[1];
  const title   = m[2];
  const raw     = m[3];

  // Simulate JS template-literal evaluation: \\ -> \, \" -> ", \` -> `, \n etc.
  let evaluated = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === '\\') { evaluated += '\\'; i++; continue; }
      if (n === '"')  { evaluated += '"';  i++; continue; }
      if (n === '`')  { evaluated += '`';  i++; continue; }
      if (n === 'n')  { evaluated += '\n'; i++; continue; }
      if (n === 't')  { evaluated += '\t'; i++; continue; }
      if (n === 'r')  { evaluated += '\r'; i++; continue; }
    }
    evaluated += raw[i];
  }

  try {
    const parsed = JSON.parse(evaluated);
    console.log(`#${idx} ${version} ${title.slice(0, 50)}: OK (${parsed.length} entries)`);
  } catch (e) {
    fail++;
    console.log(`#${idx} ${version} ${title.slice(0, 50)}: PARSE FAILED — ${e.message}`);
    const around = evaluated.slice(Math.max(0, 100), Math.min(evaluated.length, 350));
    console.log(`  preview: ${around}`);
  }
}

console.log(fail === 0 ? `\nAll ${idx} changelog entries parse cleanly.` : `\n${fail} of ${idx} entries FAILED.`);
process.exit(fail > 0 ? 1 : 0);
