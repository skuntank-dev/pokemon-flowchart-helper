/* =====================================================================
   11-gendetect.js — resolve a Showdown format id to a calculator generation.

   Champions is generation 0 in the Smogon calculator, not a mod or a flag:
     MECHANICS  = [calculateChampions, calculateRBYGSC, ...]
     SPECIES    = [CHAMPIONS, RBY, GSC, ADV, DPP, BW, XY, SM, SS, SV]
   and it has its own stat formula (no level term, no IVs, level pinned to 50)
   plus its own 1154-line mechanics module. Getting this wrong is silent and
   severe, so the resolved generation is surfaced in the UI, never buried.
   ===================================================================== */

const GenDetect = (function () {

  /* Champions ids seen in the wild: gen9championsvgc2026regmc,
     gen9championsbssregmc, gen9championsvgc2026regmcbo3, and the reg-mb
     ones before them. The match is on "champions" rather than on the
     regulation, so a new regulation needs no change here. */
  function fromFormatId(formatId) {
    if (!formatId) return null;
    const id = toID(formatId);
    if (id.includes('champions')) return { gen: 0, why: 'format "' + formatId + '" is a Champions format' };
    const m = id.match(/^gen(\d)/);
    if (m) return { gen: parseInt(m[1], 10), why: 'format "' + formatId + '"' };
    return null;
  }

  /* pokepast.es puts "Format: gen9championsvgc2026regmb" in its notes field. */
  function fromNotes(notes) {
    if (!notes) return null;
    const m = String(notes).match(/format\s*:\s*([a-z0-9]+)/i);
    return m ? fromFormatId(m[1]) : null;
  }

  /* Last resort. Champions stat points are 0-32 per stat, 66 total, whereas
     classic EVs run 0-252 / 510. A spread that fits the first and not the
     second is a strong signal -- but only a signal, so we report low
     confidence and let the caller ask instead of silently switching. */
  function fromSpreads(sets) {
    const spreads = sets.map(s => s && s.evs).filter(Boolean);
    if (!spreads.length) return null;
    let anyNonzero = false, allFit = true;
    for (const ev of spreads) {
      const vals = Object.values(ev).map(Number).filter(n => !isNaN(n));
      const total = vals.reduce((a, b) => a + b, 0);
      const max = vals.length ? Math.max(...vals) : 0;
      if (total > 0) anyNonzero = true;
      if (total > 66 || max > 32) { allFit = false; break; }
    }
    if (allFit && anyNonzero) {
      return { gen: 0, why: 'every spread fits the Champions scale (max 32/stat, 66 total)', weak: true };
    }
    return null;
  }

  /* Ordered resolution. Returns {gen, why, weak?}. */
  function resolve({ formatId, notes, sets } = {}) {
    return fromFormatId(formatId)
        || fromNotes(notes)
        || (sets ? fromSpreads(sets) : null)
        || { gen: 9, why: 'defaulted (no format information found)', weak: true };
  }

  function label(n) { return n === 0 ? 'Champions' : 'Gen ' + n; }

  return { fromFormatId, fromNotes, fromSpreads, resolve, label };
})();
