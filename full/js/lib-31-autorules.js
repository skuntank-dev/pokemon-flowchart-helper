/* =====================================================================
   lib-31-autorules.js — automatic abilities, field effects and items.

   Written against the existing snapshot shape: field effects stay
   {name, turns} entries on snapshot.fieldEffects (an optional `side` and
   `auto` flag are added, which the original code simply ignores), and stat
   stages live on snapshot.active[slot].boosts.

   Scope boundary: this only tracks STATE. Every interaction that changes a
   damage number is already implemented inside the calculator's own mechanics
   modules and is never duplicated here.

   Everything applied automatically is tagged {auto:true} so it can be shown
   as a removable chip. Automatic by default, always overridable.
   ===================================================================== */

const AutoRules = (function () {

  const WEATHER_ABILITY = {
    drought:'Sunny Day', orichalcumpulse:'Sunny Day', desolateland:'Desolate Land',
    drizzle:'Rain Dance', primordialsea:'Primordial Sea',
    sandstream:'Sandstorm', sandspit:'Sandstorm',
    snowwarning:'Snowscape', deltastream:'Delta Stream',
  };
  const TERRAIN_ABILITY = {
    electricsurge:'Electric Terrain', hadronengine:'Electric Terrain',
    grassysurge:'Grassy Terrain', mistysurge:'Misty Terrain', psychicsurge:'Psychic Terrain',
  };
  const SELF_BOOST_ABILITY = {
    intrepidsword:{ atk:1 }, dauntlessshield:{ def:1 },
    embodyaspectteal:{ spe:1 }, embodyaspectwellspring:{ spd:1 },
    embodyaspecthearthflame:{ atk:1 }, embodyaspectcornerstone:{ def:1 },
  };
  const FOE_BOOST_ABILITY = { intimidate:{ atk:-1 }, supersweetsyrup:{ eva:-1 } };

  /* --- a stat drop inflicted by a foe, and everything that answers it -------
     Modelled on the calculator's own checkIntimidate (vendor/calc/mechanics/
     util.js) so the stages shown here agree with the numbers its mechanics
     would produce from them.

     The rule that was wrong before: an ability that *retaliates* does not stop
     the drop landing. Intimidate lowers Attack by one stage and only then does
     Defiant answer with two, so the mon ends on **+1**, not +2. Competitive
     had the same bug in reverse — it took its +2 SpA but the -1 Atk was never
     applied at all. Guard Dog is the genuinely different case: it *prevents*
     the drop and takes +1 Atk instead, which also lands on +1 but by another
     route, and that route is why it cannot share a branch with Defiant.

     These are keyed off the drop, not off Intimidate, because Defiant answers
     any stat a foe lowers — Super Sweet Syrup's evasion drop included. */

  /* Ignores Intimidate itself; not general stat-drop immunities, and only from
     gen 8 on (Champions included), which is when they gained this. */
  const INTIMIDATE_IGNORE = new Set(['innerfocus','owntempo','oblivious','scrappy']);
  /* Blocks a foe-inflicted drop. null = every stat, a stat id = only that one,
     so Hyper Cutter stops Intimidate but not Super Sweet Syrup's evasion. */
  const DROP_BLOCK = { clearbody:null, whitesmoke:null, fullmetalbody:null,
    hypercutter:'atk', bigpecks:'def', keeneye:'acc', illuminate:'acc' };
  const DROP_BLOCK_ITEM = new Set(['clearamulet']);
  const DROP_RETALIATE = { defiant:{ atk:2 }, competitive:{ spa:2 } };  // after it lands
  const DROP_INVERT  = new Set(['contrary']);      // the drop becomes a rise
  const DROP_AMPLIFY = new Set(['simple']);        // ...and goes twice as far
  const DROP_REFLECT = new Set(['mirrorarmor']);   // sent back at its source
  /* Prevents the drop and takes +1 Atk instead. Intimidate only. */
  const INTIMIDATE_REVERSE = { guarddog:{ atk:1 } };
  /* The drop lands, and then this. Intimidate only — Rattled does not answer
     an evasion drop the way Defiant does. */
  const INTIMIDATE_REACT  = { rattled:{ spe:1 } };
  const PARADOX_ABILITY = { protosynthesis:'Sun', quarkdrive:'Electric' };

  /* Held rocks extend what a Pokemon sets. FIELD_MOVES already honoured this
     (fm.rock / fm.clay below); the entry abilities did not, so Drought + Heat
     Rock ran five turns instead of eight and Grassy Surge + Terrain Extender
     lost three turns of terrain — and with it three turns of the damage boost
     the terrain was applying. */
  const WEATHER_ROCK = { 'Sunny Day':'heatrock', 'Rain Dance':'damprock',
    'Sandstorm':'smoothrock', 'Snowscape':'icyrock', 'Hail':'icyrock' };
  const TERRAIN_ROCK = 'terrainextender';

  /* side:'user' | 'target' | null(global) */
  const FIELD_MOVES = {
    reflect:      { name:'Reflect',      turns:5, side:'user', clay:true },
    lightscreen:  { name:'Light Screen', turns:5, side:'user', clay:true },
    auroraveil:   { name:'Aurora Veil',  turns:5, side:'user', clay:true },
    tailwind:     { name:'Tailwind',     turns:4, side:'user' },
    trickroom:    { name:'Trick Room',   turns:5, side:null, toggle:true },
    magicroom:    { name:'Magic Room',   turns:5, side:null, toggle:true },
    wonderroom:   { name:'Wonder Room',  turns:5, side:null, toggle:true },
    gravity:      { name:'Gravity',      turns:5, side:null },
    sunnyday:     { name:'Sunny Day',    turns:5, side:null, rock:'heatrock',   kind:'weather' },
    raindance:    { name:'Rain Dance',   turns:5, side:null, rock:'damprock',   kind:'weather' },
    sandstorm:    { name:'Sandstorm',    turns:5, side:null, rock:'smoothrock', kind:'weather' },
    hail:         { name:'Hail',         turns:5, side:null, rock:'icyrock',    kind:'weather' },
    snowscape:    { name:'Snowscape',    turns:5, side:null, rock:'icyrock',    kind:'weather' },
    chillyreception:{name:'Snowscape',   turns:5, side:null, rock:'icyrock',    kind:'weather' },
    electricterrain:{name:'Electric Terrain',turns:5,side:null,rock:'terrainextender',kind:'terrain'},
    grassyterrain:{ name:'Grassy Terrain',turns:5,side:null,rock:'terrainextender',kind:'terrain'},
    mistyterrain: { name:'Misty Terrain',turns:5,side:null,rock:'terrainextender',kind:'terrain'},
    psychicterrain:{name:'Psychic Terrain',turns:5,side:null,rock:'terrainextender',kind:'terrain'},
    stealthrock:  { name:'Stealth Rock', turns:99, side:'target', hazard:true },
    spikes:       { name:'Spikes',       turns:99, side:'target', hazard:true, layers:3 },
    toxicspikes:  { name:'Toxic Spikes', turns:99, side:'target', hazard:true, layers:2 },
    stickyweb:    { name:'Sticky Web',   turns:99, side:'target', hazard:true },
    helpinghand:  { name:'Helping Hand', turns:1, side:'user' },
    safeguard:    { name:'Safeguard',    turns:5, side:'user' },
    mist:         { name:'Mist',         turns:5, side:'user' },
    luckychant:   { name:'Lucky Chant',  turns:5, side:'user' },
    wideguard:    { name:'Wide Guard',   turns:1, side:'user' },
    quickguard:   { name:'Quick Guard',  turns:1, side:'user' },
    craftyshield: { name:'Crafty Shield',turns:1, side:'user' },
    matblock:     { name:'Mat Block',    turns:1, side:'user' },
  };
  const PROTECT_MOVES = new Set(['protect','detect','spikyshield','banefulbunker',
    'silktrap','burningbulwark','kingsshield','obstruct','maxguard']);
  const CLEAR_MOVES = {
    /* Defog also takes the terrain down, but only from gen 8 on -- gated at
       the call site, since this table has no generation of its own. */
    defog:      { ownHaz:true, foeHaz:true, foeScreens:true, terrain:true, terrainGen8:true },
    rapidspin:  { ownHaz:true },
    mortalspin: { ownHaz:true },
    tidyup:     { ownHaz:true, foeHaz:true },
    /* Purely terrain removal. Steel Roller additionally fails outright with no
       terrain up, which the calculator already scores as zero damage. */
    steelroller:{ terrain:true },
    icespinner: { terrain:true },
    courtchange:{ swap:true },
    brickbreak: { foeScreens:true },
    psychicfangs:{ foeScreens:true },
  };
  const ITEM_HEAL = {
    sitrusberry:{ at:0.5, frac:0.25 }, oranberry:{ at:0.5, flat:10 },
    figyberry:{ at:0.25, frac:1/3 }, wikiberry:{ at:0.25, frac:1/3 },
    magoberry:{ at:0.25, frac:1/3 }, aguavberry:{ at:0.25, frac:1/3 },
    iapapaberry:{ at:0.25, frac:1/3 },
  };
  const RESIST_BERRY = {
    occaberry:'Fire', passhoberry:'Water', wacanberry:'Electric', rindoberry:'Grass',
    yacheberry:'Ice', chopleberry:'Fighting', kebiaberry:'Poison', shucaberry:'Ground',
    cobaberry:'Flying', payapaberry:'Psychic', tangaberry:'Bug', chartiberry:'Rock',
    kasibberry:'Ghost', habanberry:'Dragon', colburberry:'Dark', babiriberry:'Steel',
    roseliberry:'Fairy', chilanberry:'Normal',
  };

  function enabled() { return state.autoRules !== false; }

  function fxList(snap) { return (snap.fieldEffects = snap.fieldEffects || []); }

  function findEffect(snap, name, side) {
    return fxList(snap).find(f =>
      toID(f.name) === toID(name) && (f.side || null) === (side || null));
  }
  function hasEffect(snap, name, side) { return !!findEffect(snap, name, side); }

  /* Adding an effect that is already active does NOT restart its timer.
     Using Tailwind while Tailwind is up fails in-game, and the same is true of
     the screens, Safeguard, Mist and the weather/terrain moves — the move is
     spent and the existing countdown carries on. Only layered hazards stack.
     Returns null when nothing changed, so callers can say so. */
  function addEffect(snap, name, turns, side, extra) {
    const hit = findEffect(snap, name, side);
    if (hit) {
      if (extra && extra.layers) {
        const before = hit.layers || 1;
        hit.layers = Math.min(before + 1, extra.maxLayers || 3);
        return hit.layers !== before ? hit : null;
      }
      return null;                       // already up: no refresh
    }
    const e = Object.assign({ name, turns, side: side || null, auto: true }, extra || {});
    fxList(snap).push(e);
    return e;
  }
  function removeEffect(snap, pred) {
    snap.fieldEffects = fxList(snap).filter(f => !pred(f));
  }
  /* Weather and terrain hold one slot each. A *different* one replaces what is
     there; the *same* one fails and leaves the running timer alone, exactly as
     re-using Tailwind does. */
  function setExclusive(snap, kind, name, turns) {
    const match = f => kind === 'weather' ? !!Calc.mapWeather(f.name) : !!Calc.mapTerrain(f.name);
    const cur = fxList(snap).find(match);
    if (cur && toID(cur.name) === toID(name)) return null;   // already this one
    removeEffect(snap, match);
    return addEffect(snap, name, turns, null, { kind });
  }

  function ms(snap, slot) {
    if (!snap.active[slot]) snap.active[slot] = { hp: '100%' };
    const m = snap.active[slot];
    if (!m.boosts) m.boosts = {};
    return m;
  }
  function itemOf(slot, snap) {
    const m = snap.active[slot] || {};
    if (m.itemUsed) return '';
    return m.item || (state.pokemon[slot] && state.pokemon[slot].item) || '';
  }
  function abilityOf(slot, snap) {
    const m = snap.active[slot] || {};
    return m.ability || (state.pokemon[slot] && state.pokemon[slot].ability) || '';
  }
  function boost(snap, slot, deltas, notes) {
    const m = ms(snap, slot);
    const done = [];
    for (const k in deltas) {
      const before = m.boosts[k] || 0;
      const after = clamp(before + deltas[k], -6, 6);
      if (after !== before) {
        done.push((deltas[k] > 0 ? '+' : '') + deltas[k] + ' ' +
          (k === 'acc' ? 'Acc' : k === 'eva' ? 'Eva' : calc.Stats.displayStat(k)));
      }
      m.boosts[k] = after;
    }
    if (done.length && notes) notes.push(slot + ' ' + done.join(', '));
    /* How many stats actually moved. A stat already pinned at -6 cannot be
       lowered again, and a drop that never happened is a drop Defiant has
       nothing to answer, so the retaliation below is gated on this. */
    return done.length;
  }

  /* One foe-inflicted stat drop, with every answer to it. `source` is the slot
     whose ability is doing this, `foe` the slot on the receiving end. */
  function applyFoeDrop(snap, source, foe, deltas, isIntimidate, notes) {
    const fab = toID(abilityOf(foe, snap));
    const held = toID(itemOf(foe, snap));

    if (isIntimidate && (state.gen === 0 || state.gen >= 8) && INTIMIDATE_IGNORE.has(fab)) {
      notes && notes.push(foe + ' ignored Intimidate (' + prettyAbility(fab) + ')');
      return;
    }
    if (DROP_BLOCK_ITEM.has(held)) {
      const it = Dex.item(held);
      notes && notes.push(foe + ' was shielded by its ' + ((it && it.name) || held));
      return;
    }
    /* Guard Dog before the drop is worked out: there is no drop to work out. */
    if (isIntimidate && INTIMIDATE_REVERSE[fab]) {
      notes && notes.push(foe + ' turned Intimidate around (' + prettyAbility(fab) + ')');
      boost(snap, foe, INTIMIDATE_REVERSE[fab], notes);
      return;
    }
    if (DROP_REFLECT.has(fab)) {
      notes && notes.push(foe + ' sent the drop back (' + prettyAbility(fab) + ')');
      boost(snap, source, deltas, notes);
      return;
    }

    /* What lands, stat by stat — a blocker may cover only one of them. */
    const blocked = Object.prototype.hasOwnProperty.call(DROP_BLOCK, fab)
      ? DROP_BLOCK[fab] : undefined;
    const landing = {};
    for (const k in deltas) {
      if (blocked === null || blocked === k) continue;
      landing[k] = DROP_INVERT.has(fab)  ? -deltas[k]
                 : DROP_AMPLIFY.has(fab) ? deltas[k] * 2
                 : deltas[k];
    }
    if (!Object.keys(landing).length) {
      notes && notes.push(foe + ' was unaffected (' + prettyAbility(fab) + ')');
      return;
    }
    const landed = boost(snap, foe, landing, notes);

    /* Now — and only now, and only if something was really lowered — whatever
       answers it. This ordering is the whole fix: Defiant's +2 is applied on
       top of a -1 that has already been written, so the mon ends on +1. */
    if (!landed || DROP_INVERT.has(fab)) return;
    if (DROP_RETALIATE[fab]) {
      notes && notes.push(foe + ' answered with ' + prettyAbility(fab));
      boost(snap, foe, DROP_RETALIATE[fab], notes);
    }
    if (isIntimidate && INTIMIDATE_REACT[fab]) boost(snap, foe, INTIMIDATE_REACT[fab], notes);
  }

  /* ---- switch-in -------------------------------------------------------- */
  function onSwitchIn(slot, snap, notes) {
    if (!enabled()) return;
    const ab = toID(abilityOf(slot, snap));
    if (!ab) return;
    const side = sideOf(slot);
    const foes = ((side === 'self' ? snap.field.opp : snap.field.self) || [])
      .filter(s => snap.active[s] && String(snap.active[s].hp).indexOf('0%') !== 0);

    const heldOnEntry = toID(itemOf(slot, snap));

    if (WEATHER_ABILITY[ab]) {
      const w = WEATHER_ABILITY[ab];
      const primal = /^(Desolate|Primordial|Delta)/.test(w);
      const rock = !primal && WEATHER_ROCK[w] === heldOnEntry ? WEATHER_ROCK[w] : null;
      const set = setExclusive(snap, 'weather', w, primal ? 99 : (rock ? 8 : 5));
      if (set) notes && notes.push(prettyAbility(ab) + ' set ' + w + (rock ? rockNoteFor(rock) : ''));
    }
    if (TERRAIN_ABILITY[ab]) {
      const t = TERRAIN_ABILITY[ab];
      const rock = heldOnEntry === TERRAIN_ROCK ? TERRAIN_ROCK : null;
      const set = setExclusive(snap, 'terrain', t, rock ? 8 : 5);
      if (set) notes && notes.push(prettyAbility(ab) + ' set ' + t + (rock ? rockNoteFor(rock) : ''));
    }
    if (SELF_BOOST_ABILITY[ab]) boost(snap, slot, SELF_BOOST_ABILITY[ab], notes);

    if (FOE_BOOST_ABILITY[ab]) {
      const deltas = FOE_BOOST_ABILITY[ab];
      foes.forEach(f => applyFoeDrop(snap, slot, f, deltas, ab === 'intimidate', notes));
    }

    if (ab === 'download' && foes.length) {
      let def = 0, spd = 0;
      foes.forEach(f => { const m = Calc.buildPokemon(f, snap); if (m) { def += m.stats.def; spd += m.stats.spd; } });
      boost(snap, slot, def <= spd ? { atk:1 } : { spa:1 }, notes);
    }

    if (PARADOX_ABILITY[ab]) {
      const want = PARADOX_ABILITY[ab];
      const has = toID(itemOf(slot, snap)) === 'boosterenergy';
      const up = fxList(snap).some(f => want === 'Sun' ? Calc.mapWeather(f.name) === 'Sun'
                                                       : Calc.mapTerrain(f.name) === 'Electric');
      if (up || has) { ms(snap, slot).paradox = true; notes && notes.push(prettyAbility(ab) + ' active on ' + slot); }
    }

    if (ab === 'hospitality') {
      ((side === 'self' ? snap.field.self : snap.field.opp) || [])
        .filter(s => s !== slot).forEach(a => healPct(snap, a, 25, notes));
    }
  }

  function prettyAbility(id) { const a = Dex.ability(id); return a ? a.name : id; }

  function healPct(snap, slot, pct, notes) {
    const m = ms(snap, slot);
    const before = hpPctOf(snap, slot);
    if (before <= 0) return;
    m.hp = hpPctString(Math.min(100, before + pct));
    notes && notes.push(slot + ' healed to ' + m.hp);
  }

  /* ---- move used --------------------------------------------------------- */
  function onMoveUsed(actor, moveName, targets, snap, notes) {
    if (!enabled()) return;
    const id = toID(moveName);
    const side = sideOf(actor);
    const foeSide = otherSide(side);

    if (PROTECT_MOVES.has(id)) { ms(snap, actor).protected = true; return; }

    const fm = FIELD_MOVES[id];
    if (fm) {
      let turns = fm.turns;
      const held = toID(itemOf(actor, snap));
      if (fm.clay && held === 'lightclay') turns = 8;
      if (fm.rock && held === fm.rock) turns = 8;
      const target = fm.side === 'user' ? side : fm.side === 'target' ? foeSide : null;

      if (fm.toggle) {
        const up = fxList(snap).find(f => toID(f.name) === toID(fm.name));
        if (up) { removeEffect(snap, f => toID(f.name) === toID(fm.name)); notes && notes.push(fm.name + ' ended'); }
        else { addEffect(snap, fm.name, turns, null); notes && notes.push(fm.name + ' set'); }
      } else if (fm.kind) {
        const set = setExclusive(snap, fm.kind, fm.name, turns);
        notes && notes.push(set ? (fm.name + ' set (' + turns + ')')
                                : (fm.name + ' was already up — no effect'));
      } else if (fm.hazard) {
        const added = addEffect(snap, fm.name, 99, target,
          fm.layers ? { layers:1, maxLayers:fm.layers, hazard:true } : { hazard:true });
        notes && notes.push(added ? (fm.name + ' on ' + target +
            (added.layers > 1 ? ' (layer ' + added.layers + ')' : ''))
          : (fm.name + ' is already at its limit — no effect'));
      } else {
        const added = addEffect(snap, fm.name, turns, target);
        notes && notes.push(added ? (fm.name + ' set (' + turns + ')')
                                  : (fm.name + ' was already up — no effect'));
      }
    }

    const cm = CLEAR_MOVES[id];
    if (cm) {
      if (cm.swap) { fxList(snap).forEach(f => { if (f.side) f.side = otherSide(f.side); });
                     notes && notes.push('Court Change swapped side effects'); }
      if (cm.ownHaz) removeEffect(snap, f => f.hazard && f.side === side);
      if (cm.foeHaz) removeEffect(snap, f => f.hazard && f.side === foeSide);
      if (cm.foeScreens) removeEffect(snap, f =>
        /^(reflect|lightscreen|auroraveil)$/.test(toID(f.name)) && f.side === foeSide);
      /* Terrain outlasting the move that should have removed it is not a
         cosmetic error: every later turn keeps the terrain's damage multiplier
         on the matching type. */
      if (cm.terrain && (!cm.terrainGen8 || state.gen === 0 || state.gen >= 8)) {
        const up = fxList(snap).find(f => !!Calc.mapTerrain(f.name));
        if (up) {
          removeEffect(snap, f => !!Calc.mapTerrain(f.name));
          notes && notes.push(moveName + ' cleared ' + up.name);
        } else if (id === 'steelroller') {
          notes && notes.push('Steel Roller failed — no terrain was up');
        }
      }
    }

    /* Seed Sower answers being hit, not a switch-in, so it lives here. New in
       the Regulation M-C ability pool. */
    if (isDamagingMove(moveName)) {
      (targets || []).forEach(t => {
        if (toID(abilityOf(t, snap)) !== 'seedsower') return;
        const rock = toID(itemOf(t, snap)) === TERRAIN_ROCK;
        const set = setExclusive(snap, 'terrain', 'Grassy Terrain', rock ? 8 : 5);
        if (set) notes && notes.push(t + "'s Seed Sower set Grassy Terrain" +
          (rock ? rockNoteFor(TERRAIN_ROCK) : ''));
      });
    }
  }

  /* The two Move classes differ (NOTES.md §8): the dex one carries `category`,
     so read it from there and fall back to the Showdown snapshot. */
  function isDamagingMove(name) {
    const cat = (Dex.move(name) || {}).category || (Dex.psMove(name) || {}).category;
    return !!cat && cat !== 'Status';
  }
  function rockNoteFor(rock) {
    const it = Dex.item(rock);
    return ' (8 turns, ' + ((it && it.name) || rock) + ')';
  }

  /* ---- items after damage ------------------------------------------------ */
  function checkItems(snap, slot, notes) {
    if (!enabled()) return;
    const m = ms(snap, slot);
    if (m.itemUsed) return;
    const pct = hpPctOf(snap, slot);
    if (pct <= 0) return;
    const rule = ITEM_HEAL[toID(itemOf(slot, snap))];
    if (!rule) return;
    if (pct / 100 <= rule.at) {
      const gain = rule.flat != null ? rule.flat : rule.frac * 100;
      m.hp = hpPctString(Math.min(100, pct + gain));
      m.itemUsed = true;
      const it = Dex.item(itemOf(slot, snap));
      notes && notes.push(slot + ' ate its ' + (it ? it.name : 'berry') + ' (' + hpPctString(pct) + ' → ' + m.hp + ')');
    }
  }
  function checkResistBerry(snap, slot, moveType, superEffective, notes) {
    if (!enabled() || !superEffective) return;
    const m = ms(snap, slot);
    if (m.itemUsed) return;
    const id = toID(itemOf(slot, snap));
    if (RESIST_BERRY[id] && RESIST_BERRY[id] === moveType) {
      m.itemUsed = true;
      const it = Dex.item(id);
      notes && notes.push(slot + ' spent its ' + (it ? it.name : id));
    }
  }

  /* Single-turn things never survive into the next turn. */
  function clearTransient(snap) {
    Object.keys(snap.active || {}).forEach(s => {
      delete snap.active[s].protected;
    });
    removeEffect(snap, f => /^(helpinghand|wideguard|quickguard|craftyshield|matblock)$/.test(toID(f.name)));
  }

  return { enabled, onSwitchIn, onMoveUsed, checkItems, checkResistBerry, hasEffect, findEffect,
           clearTransient, addEffect, removeEffect, setExclusive, boost,
           FIELD_MOVES, PROTECT_MOVES, RESIST_BERRY };
})();
