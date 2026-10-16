# Pokémon Flowchart Helper

https://flowchart.skuntank.dev/ | https://pokemonflowcharttool.pages.dev/

Plan and review Pokémon battles as a **branching flowchart**.

Export is designed to be human-readable and the actual notation I used on pen and paper
for almost a decade before building this.

The repo holds two versions of the app:

| | **Lite** | **Full** |
|---|---|---|
| Folder | [`lite/`](lite/) | [`full/`](full/) |
| Branching flowchart, variations, Win/Lose marking | ✅ | ✅ |
| Nash Finder (highlights winning and 50/50 paths) | ✅ | ✅ |
| Team panel, battle view, action log, field effects | ✅ | ✅ |
| Import / Export (text and shareable URL) | ✅ | ✅ |
| Pokémon Showdown replay import | — | ✅ |
| pokepast.es / Showdown team import | — | ✅ |
| Automatic damage (Smogon's calculator, 16-roll picker) | — | ✅ |
| Automatic abilities, weather, terrain, screens, hazards, berries | — | ✅ |
| Pokémon Champions support | — | ✅ |
| Themes | light / dark | 7 themes |

Both are plain static sites: no install, no npm, no build step, no account, no
backend.

---

## Quick start

### Full

Open `full/index.html` in your browser. That's it. It runs straight from disk.

Imports (replays, pokepastes) need an internet connection. Everything else
works offline.

### Lite

Lite loads its Pokémon and move lists with `fetch()`, which browsers block on
`file://`, so run your browsers with the allow file access from files flag:

```sh
browser.exe --allow-file-access-from-files
```

### Hosting

Either folder can be uploaded as-is to any static host (GitHub Pages,
Cloudflare Pages, Netlify, etc.).

---

## Credits

- Damage calculation: [smogon/damage-calc](https://github.com/smogon/damage-calc), MIT
  licence (included at `full/vendor/calc/LICENSE`).
- Pokémon, move, item and ability data and sprites:
  [Pokémon Showdown](https://pokemonshowdown.com/).
- Replays: replay.pokemonshowdown.com. Team pastes: [pokepast.es](https://pokepast.es/).

This is a fan-made tool and is not affiliated with or endorsed by Nintendo,
Game Freak, Creatures Inc. or The Pokémon Company. Pokémon and all related names
are trademarks of their respective owners.
