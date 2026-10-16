/* =====================================================================
   10-dex.js — one facade over two data sources.

   Source A: the vendored Smogon calculator data (vendor/calc/data/*).
             Gen-indexed arrays where index 0 IS Champions:
               SPECIES = [CHAMPIONS, RBY, GSC, ADV, DPP, BW, XY, SM, SS, SV]
             This is what the damage math reads, so it is authoritative for
             base stats, types, move power and the type chart.

   Source B: the Showdown data snapshot (data/ps-*.js), loaded through the
             same three-line CommonJS shim. Adds what the calculator omits:
             descriptions, genderRatio, evolution lines, tiers.

   Precedence for damage-relevant facts is always A. B is decoration.
   ===================================================================== */

const Dex = (function () {
  const _speciesMiss = Object.create(null);
  let genNum = 9;
  let gen = null;                 // calc Generation object
  const genCache = {};

  /* ---- Showdown snapshot (optional; app still works if absent) -------- */
  const PS = {
    pokedex:  (typeof BattlePokedex      !== 'undefined') ? BattlePokedex      : null,
    moves:    (typeof BattleMovedex      !== 'undefined') ? BattleMovedex      : null,
    abilities:(typeof BattleAbilities    !== 'undefined') ? BattleAbilities    : null,
    items:    (typeof BattleItems        !== 'undefined') ? BattleItems        : null,
    typechart:(typeof BattleTypeChart    !== 'undefined') ? BattleTypeChart    : null,
    formats:  (typeof BattleFormatsData  !== 'undefined') ? BattleFormatsData  : null,
  };

  function getGen(n) {
    if (!genCache[n]) genCache[n] = calc.Generations.get(n);
    return genCache[n];
  }

  function setGen(n) {
    genNum = n;
    gen = getGen(n);
    invalidateLists();
    for (const k in _speciesMiss) delete _speciesMiss[k];
    return gen;
  }

  /* ---- name lists, rebuilt when the generation changes ---------------- */
  let _lists = null;
  function invalidateLists() { _lists = null; }

  function lists() {
    if (_lists) return _lists;
    const g = gen || setGen(genNum);
    const collect = (coll) => {
      const out = [];
      for (const x of coll) out.push(x.name);
      return out.sort((a, b) => a.localeCompare(b));
    };
    _lists = {
      species:   collect(g.species),
      moves:     collect(g.moves),
      abilities: collect(g.abilities),
      items:     collect(g.items),
      natures:   collect(g.natures),
      types:     collect(g.types).filter(t => t !== '???'),
    };
    return _lists;
  }

  /* ---- lookups -------------------------------------------------------- */
  const g = () => gen || setGen(genNum);

  /* The calculator's species table is keyed for damage maths, not for every
     name a replay can produce. Three real gaps, all found by running a
     51-replay corpus rather than by guessing:
       - cosmetic formes (Vivillon-Elegant, Gastrodon-East) simply are not there
       - stance-split species have no bare key (no "Aegislash", only
         Aegislash-Shield / -Blade / -Both)
       - forme suffixes the calculator spells differently
     A miss here is not cosmetic: it silently disables damage calculation for
     that Pokemon, so we resolve rather than return nothing. The Showdown
     snapshot knows the real answer (isCosmeticForme/baseSpecies, baseForme)
     and is used first, with structural fallbacks behind it. */
  function species(name) {
    if (!name) return undefined;
    const gg = g();
    const direct = gg.species.get(toID(name));
    if (direct) return direct;

    const key = gg.num + '|' + toID(name);
    if (key in _speciesMiss) return _speciesMiss[key];

    let found;
    const ps = psSpecies(name);

    // 1. a cosmetic forme is mechanically its base species
    if (!found && ps.isCosmeticForme && ps.baseSpecies) {
      found = gg.species.get(toID(ps.baseSpecies));
    }
    // 2. a species whose default forme is spelled out: Aegislash -> Aegislash-Shield
    if (!found && ps.baseForme) {
      found = gg.species.get(toID(name + '-' + ps.baseForme));
    }
    // 3. strip the forme suffix: Gastrodon-East -> Gastrodon
    if (!found) {
      const dash = String(name).indexOf('-');
      if (dash > 0) found = gg.species.get(toID(String(name).slice(0, dash)));
    }
    // 4. a forme that declares this name as its base
    if (!found) {
      const want = toID(name);
      for (const sp of gg.species) {
        if (toID(sp.baseSpecies || '') === want) { found = sp; break; }
      }
    }
    // 5. last resort: any forme with this name as its prefix
    if (!found) {
      const pre = toID(name);
      for (const sp of gg.species) {
        if (sp.id.startsWith(pre)) { found = sp; break; }
      }
    }
    _speciesMiss[key] = found;
    return found;
  }

  function move(name)    { return name ? g().moves.get(toID(name))   : undefined; }
  function ability(name) { return name ? g().abilities.get(toID(name)): undefined; }
  function item(name)    { return name ? g().items.get(toID(name))   : undefined; }
  function nature(name)  { return name ? g().natures.get(toID(name)) : undefined; }

  /* Resolve a user-typed or replay-supplied name to the canonical one.
     Falls back to the input so unknown names still round-trip. */
  function canonSpecies(name) { const s = species(name); return s ? s.name : (name || ''); }
  function canonMove(name)    { const m = move(name);    return m ? m.name : (name || ''); }

  /* PS decoration; returns {} rather than null so callers can dot into it. */
  function psSpecies(name) { return (PS.pokedex   && PS.pokedex[toID(name)])   || {}; }
  function psMove(name)    { return (PS.moves     && PS.moves[toID(name)])     || {}; }
  function psAbility(name) { return (PS.abilities && PS.abilities[toID(name)]) || {}; }
  function psItem(name)    { return (PS.items     && PS.items[toID(name)])     || {}; }

  function describeAbility(name) { return psAbility(name).shortDesc || psAbility(name).desc || ''; }
  function describeItem(name)    { return psItem(name).shortDesc    || psItem(name).desc    || ''; }
  function describeMove(name)    { return psMove(name).shortDesc    || psMove(name).desc    || ''; }

  /* Every forme a species can turn into, for the mega/tera pickers. */
  function formesOf(name) {
    const s = species(name);
    if (!s) return [];
    return [].concat(s.otherFormes || []);
  }

  /* Which mega stone turns this species into what. calc.MEGA_STONES merges
     the Gen 6 stones with the Z-A / Champions ones. */
  function megaEvolution(speciesName, itemName) {
    if (!itemName) return null;
    const entry = calc.MEGA_STONES && calc.MEGA_STONES[item(itemName)?.name || itemName];
    if (!entry) return null;
    const base = species(speciesName);
    if (!base) return null;
    // entry maps base species name -> mega forme name
    const key = Object.keys(entry).find(k => toID(k) === toID(base.baseSpecies || base.name));
    return key ? entry[key] : null;
  }

  return {
    get genNum() { return genNum; },
    get gen()    { return g(); },
    getGen, setGen, lists, invalidateLists,
    species, move, ability, item, nature,
    canonSpecies, canonMove,
    psSpecies, psMove, psAbility, psItem,
    describeAbility, describeItem, describeMove,
    formesOf, megaEvolution,
    PS,
  };
})();
