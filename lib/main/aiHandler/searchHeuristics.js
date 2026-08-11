'use strict';

// ─── looksSearchWorthy ──────────────────────────────────────────────────────
// Deterministic fallback so search doesn't depend entirely on a small local
// model's judgement about when to emit @@SEARCH:. If the user's message has
// clear "needs current info" signals and the model didn't search, we force
// a search using the user's own text as the query.
function looksSearchWorthy(text) {
  const t = (text || '').toLowerCase();
  const hasSignal = /\b(latest|current|currently|today|now|recent|recently|news|update|updates|trend|trending|price|prices|release date|released|who is|what is happening|redeem code|redeem codes|score|scores|weather)\b/.test(t)
      || /\b20(2[5-9]|3\d)\b/.test(t); // years 2025+
  const isPureConceptQuestion = /\b(explain|how does|what is a|define|difference between)\b/.test(t);
  return hasSignal && !isPureConceptQuestion;
}

module.exports = { looksSearchWorthy };
