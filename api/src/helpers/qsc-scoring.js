// Pure scoring engine for QSC audits.
// Given the question bank + responses on an audit, compute:
//   - overall_score       (numeric, 0–100, rounded to 1dp)
//   - overall_rating      ('Acceptable' | 'Needs Improvement' | 'Unacceptable')
//   - auto_unacceptable   (boolean)
//   - points_deducted_total
//   - per-response deductions (for persisting onto mcogs_qsc_responses.points_deducted)
//
// Rules (from docs/wingstop_audit_tool_spec.md):
//   • Start at 100.
//   • status = not_compliant && !is_repeat   → deduct question.points
//   • status = not_compliant &&  is_repeat   → deduct question.repeat_points
//   • status in (compliant, not_observed, not_applicable, informational) → 0
//   • If ANY response on an auto_unacceptable question is not_compliant,
//     overall_rating = 'Unacceptable' regardless of numeric score.
//   • Bands: >= 90 → Acceptable, 70–89.9 → Needs Improvement, < 70 → Unacceptable.
//
// Rating band thresholds can be overridden per-audit via the opts argument
// (supports future tunability from a config table).

const DEFAULT_BANDS = {
  acceptable:       90,
  needs_improvement: 70,
};

function rateBand(score, bands = DEFAULT_BANDS) {
  if (score >= bands.acceptable)        return 'Acceptable';
  if (score >= bands.needs_improvement) return 'Needs Improvement';
  return 'Unacceptable';
}

/**
 * @param {Array<{code, points, repeat_points, auto_unacceptable, risk_level}>} questions
 * @param {Array<{question_code, status, is_repeat}>} responses
 * @param {{bands?: {acceptable:number, needs_improvement:number}}} [opts]
 */
function scoreAudit(questions, responses, opts = {}) {
  const bands = opts.bands || DEFAULT_BANDS;
  const byCode = new Map(questions.map(q => [q.code, q]));

  let totalDeduct = 0;
  let autoUnaccept = false;
  const perResponse = []; // {question_code, points_deducted}

  for (const r of responses) {
    const q = byCode.get(r.question_code);
    if (!q) { perResponse.push({ question_code: r.question_code, points_deducted: 0 }); continue; }

    let deduct = 0;
    if (r.status === 'not_compliant') {
      deduct = r.is_repeat ? (q.repeat_points | 0) : (q.points | 0);
      if (q.auto_unacceptable) autoUnaccept = true;
    }
    totalDeduct += deduct;
    perResponse.push({ question_code: r.question_code, points_deducted: deduct });
  }

  const rawScore = Math.max(0, 100 - totalDeduct);
  const score    = Math.round(rawScore * 10) / 10;
  const rating   = autoUnaccept ? 'Unacceptable' : rateBand(score, bands);

  return {
    overall_score:        score,
    overall_rating:       rating,
    auto_unacceptable:    autoUnaccept,
    points_deducted_total: totalDeduct,
    per_response:         perResponse,
  };
}

module.exports = { scoreAudit, rateBand, DEFAULT_BANDS };
