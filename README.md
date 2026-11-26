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
