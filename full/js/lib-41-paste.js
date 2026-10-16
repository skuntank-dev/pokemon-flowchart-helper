/* =====================================================================
   41-import-paste.js — Showdown export text and pokepast.es.

   pokepast.es serves Access-Control-Allow-Origin: * on both /json and /raw,
   so this works from any origin including a file:// page. /json is preferred
   because it also carries `notes`, which is where the format lives:
   both user-supplied pastes say "Format: gen9championsvgc2026regmb" there,
   and that is what selects the Champions generation.
   ===================================================================== */

const PasteImport = (function () {

  function isPokepasteUrl(s) { return /pokepast\.es\//i.test(String(s || '')); }

  function normalisePokepasteUrl(url) {
    const s = String(url || '').trim().replace(/\/(json|raw)\/?$/, '').replace(/\/$/, '');
    const m = s.match(/pokepast\.es\/([A-Za-z0-9]+)/);
    return m ? 'https://pokepast.es/' + m[1] : null;
  }

  async function fetchPokepaste(url) {
    const base = normalisePokepasteUrl(url);
    if (!base) throw new Error('That does not look like a pokepast.es link.');
    const res = await fetch(base + '/json');
    if (!res.ok) throw new Error('pokepast.es returned ' + res.status);
    const data = await res.json();          // {author, notes, paste, title}
    return {
      title: data.title || '',
      author: data.author || '',
      notes: data.notes || '',
      sets: parseTeam(data.paste || ''),
      raw: data.paste || '',
    };
  }

  /* ---- Showdown export text ------------------------------------------
     Nickname (Species) (F) @ Item
     Ability: X
     Level: 50
     Shiny: Yes
     Tera Type: Fire
     EVs: 252 HP / 4 Def / 252 Spe
     Adamant Nature
     IVs: 0 Atk
     - Move
     Blank lines separate Pokemon; pokepaste uses CRLF.                  */

  function parseSet(block) {
    const lines = String(block).split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '');
    const p = makeBlankPokemon();
    if (!lines.length) return null;

    let head = lines[0].trim().replace(/^[A-F1-6]:\s*/, '');

    // Item comes last, after the final @
    const at = head.lastIndexOf('@');
    if (at >= 0) { p.item = head.slice(at + 1).trim(); head = head.slice(0, at).trim(); }

    // Gender marker
    const gm = head.match(/\(([MFmf])\)\s*$/);
    if (gm) { p.gender = gm[1].toUpperCase(); head = head.slice(0, gm.index).trim(); }

    // "Nickname (Species)" -- the parenthesised half is the real species
    const sp = head.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (sp) { p.nickname = sp[1].trim(); p.name = sp[2].trim(); }
    else    { p.name = head.trim(); }
    p.name = Dex.canonSpecies(p.name);

    let moveIdx = 0;
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (/^-\s*/.test(ln) || /^~\s*/.test(ln)) {
        if (moveIdx < 4) p.moves[moveIdx++] = Dex.canonMove(ln.replace(/^[-~]\s*/, '').trim());
        continue;
      }
      const kv = ln.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (kv) {
        const k = toID(kv[1]), v = kv[2].trim();
        if (k === 'ability')       p.ability = v;
        else if (k === 'level')    p.level = parseInt(v, 10) || null;
        else if (k === 'shiny')    p.shiny = v;
        else if (k === 'teratype') p.tera = v;
        // Kept as text: this is the same field the team panel edits.
        else if (k === 'evs')      p.evs = v;
        else if (k === 'ivs')      p.ivs = v;
        else if (k === 'happiness'|| k === 'ohappiness') { /* ignored */ }
        continue;
      }
      const nat = ln.match(/^(\w+)\s+Nature\b/i);
      if (nat) { p.nature = nat[1]; continue; }
    }
    return p.name ? p : null;
  }

  function parseTeam(text) {
    return String(text)
      .split(/\r?\n\s*\r?\n/)
      .map(b => b.trim())
      .filter(Boolean)
      .map(parseSet)
      .filter(Boolean);
  }

  /* ---- export back out ------------------------------------------------ */
  function exportSet(p) {
    if (!p || !p.name) return '';
    const out = [];
    let head = p.nickname ? p.nickname + ' (' + p.name + ')' : p.name;
    if (p.gender) head += ' (' + p.gender + ')';
    if (p.item) head += ' @ ' + p.item;
    out.push(head);
    if (p.ability) out.push('Ability: ' + p.ability);
    if (p.level) out.push('Level: ' + p.level);
    if (p.shiny) out.push('Shiny: ' + p.shiny);
    if (p.tera) out.push('Tera Type: ' + p.tera);
    if (p.evs) out.push('EVs: ' + p.evs);
    if (p.nature) out.push(p.nature + ' Nature');
    if (p.ivs) out.push('IVs: ' + p.ivs);
    p.moves.forEach(m => { if (m) out.push('- ' + m); });
    return out.join('\n');
  }

  function exportTeam(slots) {
    return slots.map(s => exportSet(state.pokemon[s])).filter(Boolean).join('\n\n');
  }

  return {
    isPokepasteUrl, normalisePokepasteUrl, fetchPokepaste,
    parseSet, parseTeam, exportSet, exportTeam,
  };
})();
