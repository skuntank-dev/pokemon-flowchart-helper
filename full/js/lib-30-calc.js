/* =====================================================================
   lib-30-calc.js — bridge from the app's existing state to Smogon's
   damage calculator.

   Deliberately built around the state model that was already here: a
   Pokemon's set keeps EVs/IVs as the same free-text strings the team panel
   edits, and battle HP stays a percentage string on snapshot.active. Damage
   is computed in HP points and written back as a percentage, so the log
   format, the export format, flipSides() and every existing UI surface keep
   working untouched.

   The calculator's own mechanics modules already implement every ability and
   item interaction that changes a damage number (champions.js alone is 1154
   lines). None of that is reimplemented here — this file only fills in the
   Pokemon / Move / Field objects and reads the rolls back out.
   ===================================================================== */

const Calc = (function () {

  const WEATHER_MAP = {
    sunnyday:'Sun', desolateland:'Harsh Sunshine',
    raindance:'Rain', primordialsea:'Heavy Rain',
    sandstorm:'Sand', hail:'Hail', snow:'Snow', snowscape:'Snow',
    deltastream:'Strong Winds',
  };
  const TERRAIN_MAP = {
    electricterrain:'Electric', grassyterrain:'Grassy',
    psychicterrain:'Psychic', mistyterrain:'Misty',
  };
  function mapWeather(n) { return WEATHER_MAP[toID(stripEffectPrefix(n))] || null; }
  function mapTerrain(n) { return TERRAIN_MAP[toID(stripEffectPrefix(n))] || null; }

  /* Champions is generation 0: level is pinned to 50, IVs are ignored, and
     the stat points are used verbatim. calc.Pokemon handles all of that. */
  function levelFor(p) {
    if (state.gen === 0) return 50;
    const n = parseInt(p.level, 10);
    return n || 50;
  }

  function buildPokemon(slot, snap, opts) {
    opts = opts || {};
    const p = state.pokemon[slot];
    if (!p || !p.name) return null;
    const ms = (snap && snap.active[slot]) || {};
    const speciesName = ms.species || p.name;   // after a mega the species really changed

    // Canonicalise whatever casing/spacing the ability arrived in (typed by
    // hand, or pasted). The calculator's own Cloud Nine / Air Lock handling
    // (mechanics/util.js checkAirLock) matches by exact string against
    // 'Cloud Nine' / 'Air Lock', so 'cloud nine' silently never matched.
    const rawAbility = ms.ability || p.ability || undefined;
    const ability = rawAbility ? ((Dex.ability(rawAbility) || {}).name || rawAbility) : undefined;

    const options = {
      level: levelFor(p),
      ability,
      item: ms.itemUsed ? undefined : (ms.item || p.item || undefined),
      nature: p.nature || undefined,
      evs: parseStatSpread(p.evs) || {},
      ivs: fillIvs(parseStatSpread(p.ivs)) || {},
      boosts: ms.boosts || {},
      status: ms.status || '',
      gender: p.gender || undefined,
      teraType: ms.terast ? (p.tera || undefined) : undefined,
      isDynamaxed: !!ms.dynamax,
      alliesFainted: alliesFainted(slot, snap),
      moves: (p.moves || []).filter(Boolean),
    };

    let mon;
    try { mon = new calc.Pokemon(Dex.gen, speciesName, options); }
    catch (e) { return null; }

    if (snap) {
      const pct = hpPctOf(snap, slot);
      mon.originalCurHP = Math.max(0, Math.round(mon.rawStats.hp * (pct / 100)));
    }
    return mon;
  }

  function alliesFainted(slot, snap) {
    if (!snap || !snap.active) return 0;
    const mine = SLOTS_SELF.includes(slot) ? SLOTS_SELF : SLOTS_OPP;
    return mine.filter(s => s !== slot && snap.active[s] &&
      String(snap.active[s].hp).indexOf('0%') === 0).length;
  }

  function maxHP(slot) {
    const mon = buildPokemon(slot, null);
    return mon ? mon.rawStats.hp : 100;
  }

  /* The existing field-effect list ({name, turns}) drives the calculator's
     Field. Entries whose name matches a weather or terrain set that; the rest
     map onto side flags, using the attacker's side to decide which side of
     the Field they land on.

     Setting f.terrain is the whole of our terrain job. Everything the terrain
     then does to a damage number lives in the calculator's own mechanics: the
     1.3x on the matching type, Grassy Terrain halving Earthquake and Bulldoze,
     Misty halving Dragon, Expanding Force / Rising Voltage / Terrain Pulse /
     Psyblade / Misty Explosion, the Psychic Terrain priority block, Grass Pelt,
     and the four terrain seeds (mechanics/util.js checkSeedBoost).

     Do NOT also record those as stat stages on snapshot.active -- calc.Pokemon
     copies the boosts object it is given (Pokemon.withDefault builds a fresh
     one), so the calculator applies the seed to its own copy on every call and
     a state-side duplicate would be counted twice. NOTES.md §7 is the general
     rule; the seeds are the case where it is easiest to get wrong. */
  function buildField(attackerSlot, defenderSlot, snap) {
    const f = new calc.Field({ gameType: state.fieldSize > 1 ? 'Doubles' : 'Singles' });
    const atkSide = sideOf(attackerSlot);

    ((snap && snap.fieldEffects) || []).forEach(e => {
      const id = toID(stripEffectPrefix(e.name));
      const w = mapWeather(e.name), t = mapTerrain(e.name);
      if (w) { f.weather = w; return; }
      if (t) { f.terrain = t; return; }
      if (id === 'magicroom')  { f.isMagicRoom = true; return; }
      if (id === 'wonderroom') { f.isWonderRoom = true; return; }
      if (id === 'gravity')    { f.isGravity = true; return; }
      if (id === 'trickroom')  { return; }   // affects order, not damage

      const target = (e.side === atkSide) ? f.attackerSide
                   : (e.side ? f.defenderSide : null);
      const both = [f.attackerSide, f.defenderSide];
      const apply = (fn) => { if (target) fn(target); else both.forEach(fn); };
      switch (id) {
        case 'reflect':      apply(s => s.isReflect = true); break;
        case 'lightscreen':  apply(s => s.isLightScreen = true); break;
        case 'auroraveil':   apply(s => s.isAuroraVeil = true); break;
        case 'tailwind':     apply(s => s.isTailwind = true); break;
        case 'helpinghand':  apply(s => s.isHelpingHand = true); break;
        case 'friendguard':  apply(s => s.isFriendGuard = true); break;
        case 'battery':      apply(s => s.isBattery = true); break;
        case 'powerspot':    apply(s => s.isPowerSpot = true); break;
        /* Entry hazards are deliberately NOT passed to the calculator.
           They are recorded in the field-effect list and shown on the
           battlefield, but they must not reach a damage number.

           The calculator reads them in two places and both are wrong for us:
           `desc.js` folds their chip damage into the KO-chance text ("2HKO
           after Stealth Rock"), and `mechanics/gen789.js` (isSR / spikes)
           switches off Multiscale, Shadow Shield and Tera Shell on the
           reasoning that a Pokemon which switched into hazards cannot still
           be at full HP -- which doubles the damage shown against a
           Dragonite. This layer never applies hazard damage to HP, so the
           snapshot still reads 100% while the calculator is told otherwise;
           the two cannot both be true. Hazards are also stored with
           turns: 99 and never expire, so the suppression would stick for the
           rest of the chart, including for a Pokemon that was already on the
           field when the hazard went up and never switched into it.

           Leech Seed and Salt Cure below are not hazards -- they are
           residual effects on one Pokemon -- so they stay. */
        case 'leechseed':
        case 'seeded':       apply(s => s.isSeeded = true); break;
        case 'saltcure':     apply(s => s.isSaltCured = true); break;
        case 'charge':       apply(s => s.isCharge = true); break;
        default: break;
      }
    });

    // Ruin and aura abilities belong to whoever is on the field.
    const AURA = {
      fairyaura:'isFairyAura', darkaura:'isDarkAura', aurabreak:'isAuraBreak',
      beadsofruin:'isBeadsOfRuin', swordofruin:'isSwordOfRuin',
      tabletsofruin:'isTabletsOfRuin', vesselofruin:'isVesselOfRuin',
    };
    // Cloud Nine / Air Lock the same way: the calculator's own checkAirLock
    // only looks at the two Pokemon actually trading the hit, so in a double
    // battle a Cloud Nine ally sitting in the other active slot was never
    // consulted and weather still applied.
    const WEATHER_SUPPRESSORS = { cloudnine: true, airlock: true };
    if (snap && snap.field) {
      [].concat(snap.field.self || [], snap.field.opp || []).forEach(s => {
        const ms = snap.active[s] || {};
        const ab = toID(ms.ability || (state.pokemon[s] && state.pokemon[s].ability));
        if (AURA[ab]) f[AURA[ab]] = true;
        if (WEATHER_SUPPRESSORS[ab]) f.weather = undefined;
      });
    }

    if (snap && defenderSlot) {
      const dms = snap.active[defenderSlot] || {};
      if (dms.protected) f.defenderSide.isProtected = true;
    }
    return f;
  }

  /* The 0.75x spread reduction applies only when the move actually hits more
     than one Pokemon. With a single target left -- the other foe fainted, or
     the user aimed a spread move at one slot -- the move does full damage, so
     a 2v1 endgame was reading 25% low.

     The calculator derives that purely from move.target (`isSpread` in every
     mechanics module) and it is not an option we can pass. Two levers look
     right and are not:

       * gameType also picks the doubles screen multiplier (2/3 vs 1/2), so
         flipping it to 'Singles' would quietly change Reflect and Light Screen.
       * writing to the Move we build is pointless: calc.calculate() hands the
         mechanics `move.clone()`, and Move.clone() re-derives target from the
         move data, so only the clone's value is ever read.

     So mark our Move and pin `target` on the clone, with a no-op setter. The
     setter matters: Expanding Force (grounded, Psychic Terrain) and
     Terapagos-Stellar's Tera Starstorm re-assign move.target from inside
     calculate(), and a plain value would be overwritten again. Everything else
     in those branches still runs -- the BP boost, the Stellar typing -- because
     move.target is read nowhere else in the mechanics, only in isSpread. */
  function pinSingleTarget(mv) {
    try {
      Object.defineProperty(mv, 'target', {
        get: function () { return 'normal'; },
        set: function () {},
        configurable: true, enumerable: true,
      });
    } catch (e) { try { mv.target = 'normal'; } catch (e2) {} }
  }

  const __origMoveClone = calc.Move.prototype.clone;
  calc.Move.prototype.clone = function () {
    const c = __origMoveClone.call(this);
    if (this.__hitsOne) pinSingleTarget(c);
    return c;
  };

  function forceSingleTarget(mv) {
    mv.__hitsOne = true;   // read by the clone wrapper above
    pinSingleTarget(mv);   // keep the object we hold consistent with the clone
  }

  /* Never throws: importing a long replay must not die on one odd move. */
  function run(attackerSlot, moveName, defenderSlot, snap, opts) {
    opts = opts || {};
    try {
      const atk = buildPokemon(attackerSlot, snap);
      const def = buildPokemon(defenderSlot, snap);
      if (!atk || !def) return null;
      const mv = new calc.Move(Dex.gen, moveName, {
        ability: atk.ability, item: atk.item, species: atk.species.name,
        useZ: !!opts.useZ, useMax: !!opts.useMax, isCrit: !!opts.isCrit,
      });
      if (!mv || !mv.bp) return null;                 // status move: no damage
      if (opts.hitCount === 1) forceSingleTarget(mv);
      const field = opts.field || buildField(attackerSlot, defenderSlot, snap);
      return normalise(calc.calculate(Dex.gen, atk, def, mv, field), def);
    } catch (e) { return null; }
  }

  /* Result.damage is a number, a 16-roll array, or an array of arrays for a
     multi-hit move. Flatten all three into one comparable shape. */
  function normalise(res, def) {
    let rolls = res.damage;
    if (typeof rolls === 'number') rolls = [rolls];
    else if (Array.isArray(rolls) && Array.isArray(rolls[0])) {
      const hits = rolls;
      rolls = hits[0].map((_, i) => hits.reduce((sum, h) => sum + h[i], 0));
    }
    rolls = (rolls || []).slice();
    const maxHp = def.rawStats.hp;
    const pct = rolls.map(d => (d / maxHp) * 100);
    let desc = '', ko = '';
    try { desc = res.desc(); } catch (e) {}
    try { ko = (res.kochance() || {}).text || ''; } catch (e) {}
    return {
      rolls, pct, maxHp, desc, ko,
      minPct: pct.length ? pct[0] : 0,
      maxPct: pct.length ? pct[pct.length - 1] : 0,
    };
  }

  const ROLL_PRESETS = [
    { label:'Min',  idx:0  }, { label:'Low',  idx:3  }, { label:'Avg', idx:8 },
    { label:'High', idx:12 }, { label:'Max',  idx:15 },
  ];
  const DEFAULT_ROLL = 8;    // the average roll, applied with no extra clicks

  function rollIndexFor(r, idx) {
    if (!r || !r.rolls.length) return 0;
    return clamp(idx, 0, r.rolls.length - 1);
  }

  return { buildPokemon, buildField, maxHP, run, mapWeather, mapTerrain,
           ROLL_PRESETS, DEFAULT_ROLL, rollIndexFor, levelFor };
})();
