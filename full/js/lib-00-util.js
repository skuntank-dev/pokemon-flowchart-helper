/* =====================================================================
   lib-00-util.js — small helpers the added libraries need.

   These load BEFORE the original application script, which is left intact.
   Nothing here overrides anything the lite tool already defines.

   No persistence anywhere in this app: refreshing the page starts clean.
   Use Import / Export to keep work.
   ===================================================================== */

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const BOOST_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];

/* Showdown's canonical id form. */
function toID(s) {
  const a = ('' + (s == null ? '' : s)).toLowerCase();
  return a === 'flabébé' ? 'flabebe' : a.replace(/[^a-z0-9]+/g, '');
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sideOf(s) { return SLOTS_SELF.includes(s) ? 'self' : 'opp'; }
function otherSide(sd) { return sd === 'self' ? 'opp' : 'self'; }

/* Showdown effect names arrive prefixed or bare depending on generation:
   "move: Stealth Rock" in modern logs, "Spikes" in older ones. */
function stripEffectPrefix(s) {
  return String(s || '').replace(/^(move|ability|item|pokemon):\s*/i, '').trim();
}

function debounce(fn, ms) {
  let t = null;
  return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

/* "252 Atk / 4 Def / 252 Spe" -> {atk:252, def:4, spe:252}.
   Champions spreads use the same syntax at a different scale (0-32 per stat,
   66 total) and are passed through untouched — generation 0's stat formula
   consumes those numbers directly, with no rescaling of any kind. */
const STAT_ALIASES = {
  hp:'hp', atk:'atk', at:'atk', attack:'atk',
  def:'def', df:'def', defense:'def', defence:'def',
  spa:'spa', sa:'spa', spatk:'spa', specialattack:'spa', spc:'spa', special:'spa',
  spd:'spd', sd:'spd', spdef:'spd', specialdefense:'spd', specialdefence:'spd',
  spe:'spe', sp:'spe', speed:'spe',
};
function parseStatSpread(text) {
  if (!text) return null;
  const out = {};
  let found = false;
  String(text).split('/').forEach(part => {
    const m = part.trim().match(/^(\d+)\s*(.+)$/);
    if (!m) return;
    const key = STAT_ALIASES[toID(m[2])];
    if (!key) return;
    out[key] = parseInt(m[1], 10);
    found = true;
  });
  return found ? out : null;
}
function formatStatSpread(obj, skipZero) {
  if (!obj) return '';
  return STAT_KEYS
    .filter(k => obj[k] != null && (!skipZero || obj[k] !== 0))
    .map(k => obj[k] + ' ' + calc.Stats.displayStat(k))
    .join(' / ');
}

/* An IVs line only lists what differs from 31. */
function fillIvs(partial) {
  if (!partial) return null;
  const out = {};
  for (const k of STAT_KEYS) out[k] = partial[k] == null ? 31 : partial[k];
  return out;
}

/* Percent strings are the app's native HP representation ('100%', '55%',
   '0%'), so damage work converts through them rather than replacing them. */
function hpPctOf(snap, slot) {
  const raw = (snap.active[slot] && snap.active[slot].hp) || '100%';
  const m = String(raw).match(/([\d.]+)/);
  return m ? clamp(parseFloat(m[1]), 0, 100) : 100;
}
function hpPctString(p) {
  const v = clamp(p, 0, 100);
  return (Number.isInteger(v) ? v : Math.round(v * 10) / 10) + '%';
}

function joinNames(list) {
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list.join(' and ');
  return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
}

/* Non-blocking notice. Nothing is written to disk or storage. */
function toast(msg, kind) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4500);
}
