/* =====================================================================
   40-import-replay.js — turn a Showdown replay into a flowchart.

   Coverage was derived empirically rather than guessed: a 51-replay corpus
   spanning 17 formats (Champions, VGC 2016-2026, OU gens 1-9, doubles OU,
   random battle, national dex) and both game types yielded 73 distinct
   protocol tokens. Everything below is keyed off that survey.

   Two shapes matter and are easy to miss:
     * effect names arrive prefixed OR bare depending on generation --
       "move: Stealth Rock" in modern logs, "Spikes" in older ones.
     * "p1a: Kingambit" is the NICKNAME, not the species; the species lives
       in the details field of the switch that introduced it.

   Imported turns keep the replay's own |-damage| values. Observed HP is
   ground truth and beats anything we could calculate; branches the user
   creates off those turns are what the calculator is for.
   ===================================================================== */

const ReplayImport = (function () {

  function parseUrl(url) {
    const s = String(url || '').trim();
    if (!s) return null;
    // Accept a bare id, or any replay URL (with or without the password suffix).
    const m = s.match(/replay\.pokemonshowdown\.com\/(?:[a-z]+\/)?([^/?#\s]+)/i);
    const id = m ? m[1] : s.replace(/^https?:\/\/[^/]+\//, '');
    return id.replace(/\.(json|log)$/, '') || null;
  }

  async function fetchReplay(url) {
    const id = parseUrl(url);
    if (!id) throw new Error('Could not read a replay id from that link.');
    const res = await fetch('https://replay.pokemonshowdown.com/' + id + '.json');
    if (!res.ok) throw new Error('Replay server returned ' + res.status + ' for ' + id);
    return res.json();
  }

  /* ---- packed team format from |showteam| ----------------------------
     nick|species|item|ability|moves|nature|evs|gender|ivs|shiny|level|misc  */
  function parsePackedTeam(packed) {
    return String(packed || '').split(']').filter(Boolean).map(chunk => {
      const f = chunk.split('|');
      const p = makeBlankPokemon();
      const nick = (f[0] || '').trim();
      p.name = Dex.canonSpecies((f[1] || '').trim() || nick);
      p.nickname = nick && toID(nick) !== toID(p.name) ? nick : '';
      p.item    = f[2] ? (Dex.item(f[2]) ? Dex.item(f[2]).name : f[2]) : '';
      p.ability = f[3] ? (Dex.ability(f[3]) ? Dex.ability(f[3]).name : f[3]) : '';
      p.moves   = (f[4] || '').split(',').filter(Boolean).map(m => Dex.canonMove(m)).slice(0, 4);
      while (p.moves.length < 4) p.moves.push('');
      p.nature  = f[5] || '';
      if (f[6]) {
        const v = f[6].split(',').map(x => x === '' ? 0 : parseInt(x, 10));
        p.evs = formatStatSpread(
          { hp:v[0]||0, atk:v[1]||0, def:v[2]||0, spa:v[3]||0, spd:v[4]||0, spe:v[5]||0 }, true);
      }
      p.gender = f[7] || '';
      if (f[8]) {
        const v = f[8].split(',').map(x => x === '' ? 31 : parseInt(x, 10));
        p.ivs = formatStatSpread(
          { hp:v[0], atk:v[1], def:v[2], spa:v[3], spd:v[4], spe:v[5] }, false);
      }
      p.shiny = f[9] ? 'Yes' : '';
      p.level = f[10] ? parseInt(f[10], 10) : null;
      const misc = (f[11] || '').split(',');
      if (misc[5]) p.tera = misc[5];
      return p;
    });
  }

  /* ---- main parse ------------------------------------------------------ */

  function parseLog(data) {
    const log = String(data.log || '');
    const out = {
      formatId: data.formatid || '',
      format: data.format || '',
      players: data.players || [],
      gameType: 'singles',
      genNum: null,
      teams: { p1: [], p2: [] },
      preview: { p1: [], p2: [] },
      turns: [],                   // [{turn, entries:[]}]
      leads: { p1: [], p2: [] },
      winner: null,
      warnings: [],
    };

    // p1a/p2b -> our slot letters, resolved once the teams are known.
    const slotOf = { p1: {}, p2: {} };     // nickname -> slot
    const order  = { p1: [], p2: [] };     // assignment order
    const posMon = {};                     // "p1a" -> slot currently there

    function assignSlot(player, nickname, speciesName) {
      const map = slotOf[player];
      if (map[nickname]) return map[nickname];
      const pool = player === 'p1' ? SLOTS_SELF : SLOTS_OPP;
      // Prefer the slot whose imported set matches this species.
      const team = out.teams[player];
      let idx = team.findIndex((t, i) => t && toID(t.name) === toID(speciesName || '') &&
                                          !order[player].includes(pool[i]));
      if (idx < 0) idx = order[player].length;
      if (idx >= pool.length) { out.warnings.push('More than 6 Pokemon for ' + player); return null; }
      const slot = pool[idx];
      map[nickname] = slot;
      order[player].push(slot);
      // Gen 1-4 singles and random battles have neither |showteam| nor |poke|,
      // so the only place a species is ever named is the switch that brings it
      // in. Seed a set from that rather than leaving the slot blank.
      if (speciesName && !team[idx]) {
        const p = makeBlankPokemon();
        p.name = Dex.canonSpecies(speciesName);
        p.inferred = true;
        team[idx] = p;
      }
      return slot;
    }

    /* "p1a: Kingambit" -> {player:'p1', pos:'a', nickname:'Kingambit'} */
    function parseIdent(s) {
      const m = String(s || '').match(/^(p[12])([a-c]?):\s*(.*)$/);
      if (!m) return null;
      return { player: m[1], pos: m[2] || 'a', nickname: m[3].trim() };
    }
    function slotFor(ident, speciesHint) {
      if (!ident) return null;
      const s = assignSlot(ident.player, ident.nickname, speciesHint);
      if (s) posMon[ident.player + ident.pos] = s;
      return s;
    }
    /* [spread] p2a,p2b -> slots that are currently in those positions */
    function slotsAtPositions(list) {
      return String(list || '').split(',').map(x => x.trim()).filter(Boolean)
        .map(pos => posMon[pos]).filter(Boolean);
    }
    function speciesFromDetails(d) {
      return String(d || '').split(',')[0].trim();
    }
    /* "Charizard, L50, F" / "Ditto" / "Zoroark, M, shiny" */
    function detailsExtras(d) {
      const out = {};
      String(d || '').split(',').slice(1).forEach(part => {
        const t = part.trim();
        if (/^L\d+$/i.test(t)) out.level = parseInt(t.slice(1), 10);
        else if (t === 'M' || t === 'F') out.gender = t;
        else if (/^shiny$/i.test(t)) out.shiny = 'Yes';
      });
      return out;
    }

    /* Phase matters. Everything before the first |turn| is setup: the leads
       switching in, their entry abilities firing. If push() were allowed to
       create a turn bucket there it would swallow the second lead, which is
       exactly what a doubles corpus catches and a single hand-checked replay
       does not. Setup entries are buffered and prepended to turn 1. */
    let cur = null;                        // current turn bucket
    let pending = [];                      // pre-battle buffer
    function push(e) { (cur ? cur.entries : pending).push(e); }

    let lastMove = null;                   // for attaching damage to its move
    let inBattle = false;                  // true once the first |turn| lands

    /* Fill in whatever the details field knows that the set did not. */
    function applyDetails(slot, details) {
      const player = isSelfSlot(slot) ? 'p1' : 'p2';
      const pool = player === 'p1' ? SLOTS_SELF : SLOTS_OPP;
      const p = out.teams[player][pool.indexOf(slot)];
      if (!p) return;
      const x = detailsExtras(details);
      if (x.level && !p.level) p.level = x.level;
      if (x.gender && !p.gender) p.gender = x.gender;
      if (x.shiny && !p.shiny) p.shiny = x.shiny;
    }

    for (const rawLine of log.split('\n')) {
      if (!rawLine.startsWith('|')) continue;
      const f = rawLine.split('|');
      const cmd = f[1];

      switch (cmd) {
        case 'gametype': out.gameType = f[2] || 'singles'; break;
        case 'gen':      out.genNum = parseInt(f[2], 10); break;
        case 'tier':     break;

        case 'showteam': {
          const player = f[2];
          // The packed team is itself pipe-delimited, so splitting the whole
          // line shreds it -- everything after the first field must be rejoined.
          if (player === 'p1' || player === 'p2') {
            const packed = f.slice(3).join('|');
            const parsed = parsePackedTeam(packed);
            if (parsed.length) out.teams[player] = parsed;
          }
          break;
        }

        case 'poke': {
          // Closed sheets: only species / level / gender are known, but that
          // is still a team -- seed the slots so the flowchart shows six
          // Pokemon per side instead of only whatever came out.
          const player = f[2];
          if (player !== 'p1' && player !== 'p2') break;
          const sp = speciesFromDetails(f[3]);
          out.preview[player].push(sp);
          const team = out.teams[player];
          const idx = out.preview[player].length - 1;
          if (!team[idx]) {
            const p = makeBlankPokemon();
            p.name = Dex.canonSpecies(sp);
            p.inferred = true;
            const x = detailsExtras(f[3]);
            if (x.level) p.level = x.level;
            if (x.gender) p.gender = x.gender;
            if (x.shiny) p.shiny = x.shiny;
            team[idx] = p;
          }
          break;
        }

        case 'start': break;

        case 'turn': {
          const n = parseInt(f[2], 10);
          cur = { turn: n, entries: pending.splice(0) };
          inBattle = true;
          out.turns.push(cur);
          break;
        }

        case 'switch':
        case 'drag':
        case 'replace': {
          const ident = parseIdent(f[2]);
          if (!ident) break;
          const sp = speciesFromDetails(f[3]);
          const prev = posMon[ident.player + ident.pos];
          const slot = slotFor(ident, sp);
          if (!slot) break;
          applyDetails(slot, f[3]);
          if (!inBattle) {
            const arr = ident.player === 'p1' ? out.leads.p1 : out.leads.p2;
            if (!arr.includes(slot)) arr.push(slot);
          } else {
            push({ type:'switch', actor: prev || slot, target: slot, replay:true });
            if (f[4]) push({ type:'health', actor: slot, value: f[4], replay:true, silent:true });
          }
          break;
        }

        case 'move': {
          const a = parseIdent(f[2]);
          const actor = a ? (posMon[a.player + a.pos] || slotFor(a)) : null;
          if (!actor) break;
          const moveName = Dex.canonMove(f[3]);
          let targets = [];
          const spread = rawLine.match(/\[spread\]\s*([^|]+)/);
          if (spread) targets = slotsAtPositions(spread[1]);
          else if (f[4] && f[4] !== 'null' && !f[4].startsWith('[')) {
            const t = parseIdent(f[4]);
            const ts = t ? posMon[t.player + t.pos] : null;
            if (ts) targets = [ts];
          }
          lastMove = { type:'move', actor, move: moveName, targets,
                       observed:{}, dmg:{}, replay:true };
          push(lastMove);
          break;
        }

        case '-damage':
        case '-sethp': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (!slot) break;
          // Attach to the move that caused it when there is one, so the branch
          // UI can offer "what if this roll had been different".
          if (lastMove && lastMove.targets.includes(slot)) lastMove.observed[slot] = f[3];
          else push({ type:'health', actor: slot, value: f[3], replay:true });
          const st = String(f[3]).match(/\b(brn|psn|tox|par|slp|frz)\b/);
          if (st) push({ type:'status', actor: slot, status: st[1], replay:true });
          break;
        }

        case '-heal': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'heal', actor: slot, value: f[3], replay:true });
          break;
        }

        case 'faint': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'faint', actor: slot, replay:true });
          break;
        }

        case '-boost':
        case '-unboost': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (!slot) break;
          const n = parseInt(f[4], 10) || 0;
          push({ type:'boost', actor: slot,
                 boosts: { [f[3]]: cmd === '-boost' ? n : -n }, replay:true });
          break;
        }

        case '-setboost': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'setboost', actor: slot,
                           boosts:{ [f[3]]: parseInt(f[4], 10) || 0 }, replay:true });
          break;
        }

        case '-clearboost':
        case '-clearallboost':
        case '-clearnegativeboost': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          push({ type:'clearboost', actor: cmd === '-clearallboost' ? null : slot,
                 negativeOnly: cmd === '-clearnegativeboost', replay:true });
          break;
        }

        case '-status': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'status', actor: slot, status: f[3], replay:true });
          break;
        }

        case '-curestatus':
        case '-cureteam': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'curestatus', actor: slot, replay:true });
          break;
        }

        case '-weather': {
          if (toID(f[2]) === 'none') { push({ type:'field', name:'__clearweather', remove:true, kind:'weather', replay:true }); break; }
          if (rawLine.includes('[upkeep]')) break;      // not a fresh set
          push({ type:'field', kind:'weather', name: stripEffectPrefix(f[2]), turns:5, auto:true, replay:true });
          break;
        }

        case '-fieldstart': {
          const name = stripEffectPrefix(f[2]);
          const kind = Calc.mapTerrain(name) ? 'terrain' : null;
          push({ type:'field', name, kind, turns:5, auto:true, replay:true });
          break;
        }
        case '-fieldend': {
          push({ type:'field', name: stripEffectPrefix(f[2]), remove:true, replay:true });
          break;
        }

        case '-sidestart': {
          const who = String(f[2] || '').slice(0, 2);
          const side = who === 'p1' ? 'self' : 'opp';
          push({ type:'field', name: stripEffectPrefix(f[3]), side, turns:5, auto:true, replay:true });
          break;
        }
        case '-sideend': {
          const who = String(f[2] || '').slice(0, 2);
          push({ type:'field', name: stripEffectPrefix(f[3]),
                 side: who === 'p1' ? 'self' : 'opp', remove:true, replay:true });
          break;
        }

        case '-mega':
        case '-primal':
        case '-burst': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'mechanic', actor: slot, mech:'Mega', replay:true });
          break;
        }
        case '-terastallize': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'mechanic', actor: slot, mech:'Terast', tera: f[3], replay:true });
          break;
        }
        case '-zpower': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'mechanic', actor: slot, mech:'ZMove', replay:true });
          break;
        }
        case 'detailschange':
        case '-formechange': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'mechanic', actor: slot,
                           mech: cmd === 'detailschange' ? 'Mega' : 'Forme',
                           forme: speciesFromDetails(f[3]), replay:true });
          break;
        }

        case '-item': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'item', actor: slot, action:'set', item: f[3], replay:true });
          break;
        }
        case '-enditem': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'item', actor: slot, action:'end', replay:true });
          break;
        }

        case '-ability': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'ability', actor: slot, ability: f[3], replay:true });
          break;
        }

        case '-start':
        case '-singleturn': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'volatile', actor: slot, name: stripEffectPrefix(f[3]), replay:true });
          break;
        }
        case '-end': {
          const ident = parseIdent(f[2]);
          const slot = ident ? posMon[ident.player + ident.pos] : null;
          if (slot) push({ type:'volatile', actor: slot, name: stripEffectPrefix(f[3]), remove:true, replay:true });
          break;
        }

        case 'win':    out.winner = f[2]; break;
        case 'tie':    out.winner = null; break;

        // Deliberately ignored: chat, timers, HTML, animation and hint lines.
        case 'j': case 'l': case 'c': case 'n': case 'raw': case 'html':
        case 'uhtml': case 'inactive': case 'inactiveoff': case 't:':
        case 'upkeep': case 'rule': case 'teamsize': case 'clearpoke':
        case 'teampreview': case 'player': case 'rated': case '-anim':
        case '-hint': case '-message': case '-hitcount': case '-crit':
        case '-supereffective': case '-resisted': case '-immune': case '-miss':
        case '-fail': case '-notarget': case '-activate': case '-prepare':
        case '-mustrecharge': case '-fieldactivate': case 'cant': case '':
          break;
        default: break;
      }

      // -crit / -supereffective decorate the move that is being resolved.
      if (cmd === '-crit' && lastMove) {
        const ident = parseIdent(f[2]);
        const slot = ident ? posMon[ident.player + ident.pos] : null;
        if (slot) (lastMove.dmg[slot] = lastMove.dmg[slot] || {}).crit = true;
      }
      if (cmd === 'move') { /* lastMove already set */ }
      else if (cmd === 'turn' || cmd === 'switch') lastMove = null;
    }

    out.turns = out.turns.filter(t => t.entries.length);
    return out;
  }

  return { parseUrl, fetchReplay, parsePackedTeam, parseLog };
})();
