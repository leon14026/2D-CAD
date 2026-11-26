# Attribution

Every third-party file, dependency or asset that ships to users is listed here with its author,
source and licence.

## Policy

- Shipped code and assets must be under a permissive licence: MIT, ISC, BSD-2-Clause,
  BSD-3-Clause, Apache-2.0, 0BSD, Zlib, CC0-1.0, Unlicense, BlueOak-1.0.0, OFL-1.1 (fonts), or
  MPL-2.0 for libraries used unmodified (Pyodide, from Phase 8).
- No GPL, AGPL, LGPL, SSPL or non-commercial licences, in shipped code or in build tools.
- No Autodesk iconography, screenshots, fonts (including SHX), hatch-pattern files, linetype
  files, templates or presets. No ArtCraft or CADCraft names, logos or artwork.
- ArchiLite's icons, hatch patterns, linetypes, title blocks and sample drawings are original
  work, drawn or defined in code.
- `scripts/license-gate.mjs` enforces the licence rules in CI.

## Shipped third-party material

| Item | Author | Source | Licence | Notes |
|---|---|---|---|---|
| B612 typeface (regular and bold, Latin subset, WOFF2) | The B612 Project Authors | [polarsys/b612](https://github.com/polarsys/b612), packaged as `@fontsource/b612` 5.3.0 | SIL Open Font License 1.1 | The interface typeface, designed for aircraft cockpit displays. Licence text shipped at `/licenses/B612-OFL-1.1.txt`. Unmodified; not sold on its own. |

No other third-party code, icons or images ship. ArchiLite's icons are original line drawings
defined in `src/ui/dom.ts`.

## Licence texts

| File | Origin |
|---|---|
| `LICENSE-APACHE` | Standard text of the Apache License, Version 2.0 (Apache Software Foundation), without the appendix. |
| `LICENSE-MIT` | Standard text of the MIT License. |
| `public/licenses/B612-OFL-1.1.txt` | The B612 copyright notice and the SIL Open Font License 1.1, copied unchanged from `@fontsource/b612`. |
