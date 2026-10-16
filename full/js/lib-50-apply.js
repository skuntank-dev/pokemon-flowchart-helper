/* =====================================================================
   lib-50-apply.js — turn parsed imports into the app's own state.

   A replay is converted into ORDINARY log tokens, the same ones the tool has
   always used ("A Fake Out 6", "6 health 79%", "1 switch 3", "1 Mega").
   Nothing about the node model, the export format, flipSides() or the log UI
   has to change to accommodate it, and an imported chart is editable exactly
   like a hand-built one.

   A few additive verbs carry what the original grammar had no way to express
   (boost / status / field / item). They are new words in the same shape, so
   old files still load and new exports round-trip.

   Replay HP is written as explicit `health` tokens: it is what the game
   actually dealt, so it is recorded rather than recalculated. The calculator
   is for the branches the user invents afterwards.
   ===================================================================== */

const Apply = (function () {

  /* Built on first use: the slot constants come from the application script,
     which loads after this file. */
  let FLIP = null;
  function flipTable() {
    if (!FLIP) {
      FLIP = {};
      SLOTS_SELF.forEach((s, i) => { FLIP[s] = SLOTS_OPP[i]; FLIP[SLOTS_OPP[i]] = s; });
    }
    return FLIP;
  }
  const flipSlot = s => flipTable()[s] || s;

  /* ---- one parsed entry -> zero or more raw tokens --------------------- */
  function entryTokens(e) {
    const out = [];
    switch (e.type) {
      case 'move': {
        const t = (e.targets || []).join('');
        out.push(e.actor + ' ' + e.move + (t ? ' ' + t : ''));
        // The replay's own damage, recorded as plain health tokens.
        for (const slot in (e.observed || {})) {
          out.push(slot + ' health ' + hpFromShowdown(e.observed[slot]));
        }
        break;
      }
      case 'switch':  out.push(e.actor + ' switch ' + e.target); break;
      case 'health':
      case 'heal':    out.push(e.actor + ' health ' + hpFromShowdown(e.value)); break;
      case 'faint':   out.push(e.actor + ' health 0%'); break;
      case 'mechanic': {
        if (e.mech === 'Forme') break;                 // cosmetic only
        out.push(e.actor + ' ' + e.mech);
        break;
      }
      case 'boost': {
        const parts = Object.keys(e.boosts || {})
          .map(k => k + (e.boosts[k] > 0 ? '+' : '') + e.boosts[k]);
        if (parts.length) out.push(e.actor + ' boost ' + parts.join(','));
        break;
      }
      case 'setboost': {
        const parts = Object.keys(e.boosts || {}).map(k => k + '=' + e.boosts[k]);
        if (parts.length) out.push(e.actor + ' boost ' + parts.join(','));
        break;
      }
      case 'clearboost': out.push((e.actor || '*') + ' boost reset'); break;
      case 'status':     out.push(e.actor + ' status ' + e.status); break;
      case 'curestatus': out.push(e.actor + ' status none'); break;
      case 'item':       if (e.action === 'end') out.push(e.actor + ' item -'); break;
      case 'field': {
        const nm = String(e.name).replace(/\s+/g, '_');
        // Turns are written "t5", not "5": flipSides() treats a trailing run of
        // [A-F1-6] as a target list, and a bare number matches that.
        if (e.remove) out.push('field -' + nm + (e.side ? '/' + e.side : ''));
        else out.push('field ' + nm + (e.side ? '/' + e.side : '') + ' t' + (e.turns == null ? 5 : e.turns));
        break;
      }
      default: break;
    }
    return out;
  }

  /* "79/100", "0 fnt", "55" -> a percentage string. */
  function hpFromShowdown(v) {
    const s = String(v == null ? '' : v).trim();
    if (/fnt/i.test(s)) return '0%';
    let m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
    if (m) return hpPctString((parseFloat(m[1]) / parseFloat(m[2])) * 100);
    m = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (m) return hpPctString(parseFloat(m[1]));
    return s || '100%';
  }

  function flipToken(tok) {
    const parts = tok.split(/\s+/);
    if (parts[0] === 'field') return tok.replace(/\/(self|opp)/,
      (_, s) => '/' + (s === 'self' ? 'opp' : 'self'));
    if (parts[0] === '*') return tok;
    if (flipTable()[parts[0]]) parts[0] = flipSlot(parts[0]);
    if (parts[1] === 'switch' && parts[2]) parts[2] = flipSlot(parts[2]);
    const last = parts[parts.length - 1];
    if (parts[1] !== 'switch' && parts[1] !== 'health' && parts[1] !== 'boost' &&
        parts[1] !== 'status' && parts[1] !== 'item' && /^[A-F1-6]+$/.test(last)) {
      parts[parts.length - 1] = last.split('').map(flipSlot).join('');
    }
    return parts.join(' ');
  }

  /* ---- team helpers ----------------------------------------------------- */
  function setTeamSide(sets, side) {
    const slots = side === 'opp' ? SLOTS_OPP : SLOTS_SELF;
    slots.forEach((s, i) => { state.pokemon[s] = sets[i] ? sets[i] : makeBlankPokemon(); });
  }

  function maybeSetGen(g) {
    if (!g) return;
    if (g.weak && !state.genWeak) return;
    state.gen = g.gen; state.genWhy = g.why; state.genWeak = !!g.weak;
    Dex.setGen(g.gen);
  }

  /* ---- replay ----------------------------------------------------------- */
  function replay(parsed, opts) {
    opts = opts || {};
    const flip = !!opts.flip;

    state.genWeak = true;
    maybeSetGen(GenDetect.resolve({ formatId: parsed.formatId }));
    state.fieldSize = parsed.gameType === 'singles' ? 1 : 2;

    const mine  = flip ? parsed.teams.p2 : parsed.teams.p1;
    const yours = flip ? parsed.teams.p1 : parsed.teams.p2;
    setTeamSide(mine.slice(0, 6), 'self');
    setTeamSide(yours.slice(0, 6), 'opp');

    // Fresh chart.
    state.nodes = [];
    state.currentNodeId = null;
    const leadSelf = (flip ? parsed.leads.p2 : parsed.leads.p1).map(s => flip ? flipSlot(s) : s);
    const leadOpp  = (flip ? parsed.leads.p1 : parsed.leads.p2).map(s => flip ? flipSlot(s) : s);
    const selfOrder = bringOrder(SLOTS_SELF, leadSelf);
    const oppOrder  = bringOrder(SLOTS_OPP,  leadOpp);

    const root = {
      id: uid(), turn: 0, variation: '1', branchTurn: 0, parentId: null, notes: '',
      snapshot: { turn0: { selfOrder, oppOrder }, active:{}, field:{opp:[],self:[]},
                  back:{opp:[],self:[]}, log: [] },
    };
    state.nodes.push(root);
    state.turn0Selection = { selfOrder: selfOrder.slice(), oppOrder: oppOrder.slice() };

    let parent = root;
    parsed.turns.forEach(t => {
      const raws = [];
      t.entries.forEach(e => entryTokens(e).forEach(tok => raws.push(flip ? flipToken(tok) : tok)));
      // A replay reports the damaging hit and then the faint, which would read
      // as the same Pokemon dropping to 0% twice. Keep the first.
      for (let i = raws.length - 1; i > 0; i--) {
        if (/^(\S+) health 0%$/.test(raws[i]) && raws[i] === raws[i - 1]) raws.splice(i, 1);
      }
      const node = {
        id: uid(), turn: t.turn, variation: '1', branchTurn: 0,
        parentId: parent.id, notes: '',
        snapshot: { active:{}, field:{opp:[],self:[]}, back:{opp:[],self:[]},
                    log: raws.map(r => ({ type:'move', raw:r, text:'' })), fieldEffects: [] },
      };
      state.nodes.push(node);
      parent = node;
    });

    if (parsed.winner && (parsed.players || []).length === 2) {
      const me = flip ? parsed.players[1] : parsed.players[0];
      const last = state.nodes[state.nodes.length - 1];
      if (last && last.turn > 0) last.snapshot.winLose = (parsed.winner === me) ? 'win' : 'lose';
    }

    rebuildAllNodes();
    state.currentNodeId = (state.nodes[1] || root).id;
    return { turns: parsed.turns.length };
  }

  function bringOrder(allSlots, leads) {
    const out = leads.filter(s => allSlots.includes(s));
    allSlots.forEach(s => {
      if (!out.includes(s) && state.pokemon[s] && state.pokemon[s].name) out.push(s);
    });
    return out;
  }

  /* ---- pokepaste -------------------------------------------------------- */
  function pasteToSide(parsed, side) {
    const sets = parsed.sets || parsed;
    setTeamSide(sets.slice(0, 6), side);
    maybeSetGen(GenDetect.resolve({ notes: parsed.notes, sets }));
    rebuildAllNodes();
    renderAll();
  }

  /* Merge by species so slot order need not agree with the replay's. */
  function mergeSets(sets) {
    let hits = 0; const missed = [];
    sets.forEach(set => {
      const slot = [...SLOTS_SELF, ...SLOTS_OPP].find(s => {
        const p = state.pokemon[s];
        if (!p || !p.name) return false;
        const a = toID(p.name), b = toID(set.name);
        return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
      });
      if (!slot) { missed.push(set.name); return; }
      const p = state.pokemon[slot];
      if (set.evs) p.evs = set.evs;   // free text, as the panel stores it
      if (set.ivs) p.ivs = set.ivs;
      if (set.nature) p.nature = set.nature;
      if (set.item) p.item = set.item;
      if (set.ability) p.ability = set.ability;
      if (set.tera) p.tera = set.tera;
      if (set.level) p.level = set.level;
      (set.moves || []).forEach((mv, i) => { if (mv && !p.moves[i]) p.moves[i] = mv; });
      hits++;
    });
    return { hits, missed };
  }

  return { replay, pasteToSide, setTeamSide, mergeSets, maybeSetGen,
           entryTokens, hpFromShowdown, flipSlot };
})();
