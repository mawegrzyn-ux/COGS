#!/usr/bin/env node
// Parses docs/wingstop_audit_tool_spec.md into a JSON fixture the migration
// can seed into mcogs_qsc_questions. One-shot; re-run when the spec changes.
//
// Usage: node api/scripts/parse-qsc-spec.js
// Output: api/scripts/fixtures/qsc-questions.json

const fs   = require('fs');
const path = require('path');

const SPEC_PATH    = path.resolve(__dirname, '../../docs/wingstop_audit_tool_spec.md');
const OUT_PATH     = path.resolve(__dirname, 'fixtures/qsc-questions.json');

const AUTO_UNACCEPTABLE = new Set(['A105', 'A127', 'A139', 'A141', 'A143', 'OF101']);

// Recognised ancestor heading regex (## / ###)
const H2_RE     = /^##\s+(.+?)\s*$/;
const H3_RE     = /^###\s+(.+?)\s*$/;
const H4_RE     = /^####\s+`([A-Z]{1,3}\d{3}[a-z]?)`\s+—\s+(.+?)\s+—\s+(\d+)\s*(?:pts\s*\(repeat:\s*(\d+)\)|\(information only\))/;

function crossRefs(policy) {
  const out = new Set();
  const re = /\b([A-Z]{1,3}\d{3}[a-z]?)\b/g;
  let m;
  while ((m = re.exec(policy)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

function photoRequired(policy) {
  return /photo\s+is\s+required|take\s+a\s+photo|photo\s+must\s+be\s+taken|must\s+take\s+a\s+photo/i.test(policy);
}

function hasTempInput(code, title, policy) {
  if (/temperature/i.test(title)) return true;
  if (/\b(40°F|140°F|°F|°C|35°F)\b/.test(policy) && /temperature/i.test(policy)) return true;
  return false;
}

function parseRiskLevel(raw) {
  const low = raw.toLowerCase();
  if (low.includes('critical first priority')) return 'Critical First Priority';
  if (low.includes('first priority'))           return 'First Priority';
  if (low.includes('second priority'))          return 'Second Priority';
  if (low.includes('third priority'))           return 'Third Priority';
  if (low.includes('informational'))            return 'Information Only';
  return raw.trim();
}

function run() {
  const raw = fs.readFileSync(SPEC_PATH, 'utf8');
  const lines = raw.split(/\r?\n/);

  const questions = [];
  let department = null;
  let category   = null;
  let sort       = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h2 = line.match(H2_RE);
    if (h2) {
      const v = h2[1].trim();
      // Only Food Safety / Brand Standards count as departments
      if (v === 'Food Safety' || v === 'Brand Standards') {
        department = v;
        category   = null;
      }
      continue;
    }

    const h3 = line.match(H3_RE);
    if (h3) {
      category = h3[1].trim();
      continue;
    }

    const h4 = line.match(H4_RE);
    if (!h4) continue;

    const [, code, riskRaw, ptsStr, repeatStr] = h4;
    const riskLevel = parseRiskLevel(riskRaw);
    const points    = parseInt(ptsStr, 10);
    const repeatPts = repeatStr != null ? parseInt(repeatStr, 10) : points;

    // Title — next non-empty lines until blank. Grab everything between
    // "**Title:**" and the <details> block.
    let title = '';
    let j = i + 1;
    while (j < lines.length && !/^####\s/.test(lines[j]) && !/^<details>/.test(lines[j])) {
      const m = lines[j].match(/^\*\*Title:\*\*\s*(.*)$/);
      if (m) {
        title = m[1].trim();
        // Title can span lines until blank line
        let k = j + 1;
        while (k < lines.length && lines[k].trim() && !/^<details>/.test(lines[k]) && !/^####\s/.test(lines[k])) {
          title += ' ' + lines[k].trim();
          k++;
        }
        break;
      }
      j++;
    }

    // Policy — content of the ```text ... ``` fence inside <details>
    let policy = '';
    let fenceStart = lines.findIndex((l, idx) => idx > i && /^```text\s*$/.test(l));
    if (fenceStart > -1 && fenceStart < i + 40) {
      const fenceEnd = lines.findIndex((l, idx) => idx > fenceStart && /^```\s*$/.test(l));
      if (fenceEnd > fenceStart) {
        policy = lines.slice(fenceStart + 1, fenceEnd).join('\n').trim();
      }
    }

    questions.push({
      code,
      version:            1,
      department:         department || null,
      category:           category   || null,
      title,
      risk_level:         riskLevel,
      points,
      repeat_points:      repeatPts,
      policy,
      auto_unacceptable:  AUTO_UNACCEPTABLE.has(code),
      photo_required:     photoRequired(policy),
      temperature_input:  hasTempInput(code, title, policy),
      cross_refs:         crossRefs(policy).filter(c => c !== code),
      sort_order:         ++sort,
      active:             true,
    });
  }

  // Summary
  const scored = questions.filter(q => q.points > 0);
  const info   = questions.filter(q => q.points === 0);

  console.log(`Parsed ${questions.length} questions:`);
  console.log(`  scored:        ${scored.length}`);
  console.log(`  info-only:     ${info.length}`);
  console.log(`  auto-unaccept: ${questions.filter(q => q.auto_unacceptable).length}`);
  console.log(`  photo reqd:    ${questions.filter(q => q.photo_required).length}`);
  console.log(`  temp input:    ${questions.filter(q => q.temperature_input).length}`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(questions, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
}

run();
