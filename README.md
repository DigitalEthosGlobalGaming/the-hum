# THE HUM

PS1-style psychological horror exploration game. Builds to a single self-contained HTML file.
See [PLAN.md](PLAN.md) for the full design.

```bash
npm install
npm run dev     # rebuild on change + serve http://localhost:8080
npm run build   # → dist/the-hum.html (fails if ≥ 10 MB)
```

- Content (rooms, objects, pools, config) lives in `content/` as JSON.
- Textures: Kenney "Retro Textures Liminal" (CC0), `assets/textures/`.
- F3 toggles the diagnostics panel.

## Content tools

```bash
npm run validate                         # check content/; exits 1 on errors
npm run pool-sim -- desk_top             # roll a pool 100k times: expected vs actual odds
npm run pool-sim -- all --n 20000 --depth 3 --zone lobby --seed 42
npm run room-preview -- m1_test_hall     # ASCII layout with objects (A–Z) and spots (1–9, a–z)
```

- `npm run build` runs the validator first. Errors fail the build. In `npm run dev` they are printed and the watcher keeps going.
- The validator checks rooms (layout, legend, materials, object/spot refs, bounds, solid and unreachable cells, slot size), objects (mesh, component types and fields, `combine.with`), and pools (weights, refs, cycles). Unknown script ids and sound presets are warnings until scripts (M4) and `content/sounds` exist.
- All tools load content through `tools/lib/loadContent.mjs`, the same loader the build uses, and pool-sim uses the game's own `rollPool` and seeded `Rng`.

## Deploy

Every push to `main` runs `npm run ci` (validate content → unit tests → WFC seed sweep → single-file build)
and publishes `dist/the-hum.html` as `index.html`:

- **GitHub Pages:** `.github/workflows/pages.yml`. One-time setup: *Settings → Pages → Source: GitHub Actions*.
  Each run also attaches `the-hum-html` as a downloadable artifact (handy for SharePoint uploads).
- **GitLab Pages:** `.gitlab-ci.yml` does the same if the repo is mirrored to GitLab.
