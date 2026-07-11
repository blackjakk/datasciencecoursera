# Font licenses — data/fonts/

All faces in this directory are licensed under the SIL Open Font License 1.1
(OFL, https://openfontlicense.org) except Inter, which is also OFL. The OFL
permits free use, embedding (base64 in `design/ml.css`), bundling, and
redistribution; the fonts themselves may not be sold standalone.

| Files | Family | Copyright / source |
| --- | --- | --- |
| `IBMPlexMono-Regular.ttf`, `IBMPlexMono-Bold.ttf`, `IBMPlexMono-*-latin.woff2` | IBM Plex Mono 400/700 | © IBM Corp. — https://github.com/IBM/plex (OFL 1.1) |
| `Cinzel-Bold.ttf`, `Cinzel-700-latin.woff2` | Cinzel 700 | © Natanael Gama — https://github.com/NDISCOVER/Cinzel (OFL 1.1) |
| `Archivo-SemiBold.ttf`, `Archivo-ExtraBold.ttf`, `Archivo-600-800-latin.woff2` | Archivo 600/800 | © Omnibus-Type — https://github.com/Omnibus-Type/Archivo (OFL 1.1) |
| `Inter-Regular.ttf` | Inter 400 | © Rasmus Andersson — https://github.com/rsms/inter (OFL 1.1) |
| `BebasNeue-Regular.ttf` | Bebas Neue 400 (retired from the display stack July 2026; kept for archival renders) | © Ryoichi Tsunekawa — https://github.com/dharmatype/Bebas-Neue (OFL 1.1) |

Provenance: `.ttf` files and latin-subset `.woff2` files were fetched from the
Google Fonts css2 API (July 2026); `Archivo-600-800-latin.woff2` is the
variable-weight file Google serves for wght 600–800 and is declared with a
`font-weight: 600 800` range in `ml.css`.

Pipeline notes:
- The `.woff2` latin subsets are embedded as base64 `@font-face` rules in the
  generated `design/ml.css`. Their base64 payloads live in
  `design/tokens.json` under `fonts.faces` (so the DRIFT check can regenerate
  byte-identically); refresh them from these files with
  `python3 design/build_design.py --sync-fonts`.
- The `.ttf` files are registered with matplotlib by
  `design.tokens.mpl_style()` for chart rendering.
