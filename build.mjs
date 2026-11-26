// Build THE HUM into one self-contained HTML file.
//   node build.mjs            → dist/the-hum.html
//   node build.mjs --watch    → rebuild on change
//   node build.mjs --serve    → also serve dist/ on http://localhost:8080
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'the-hum.html');
const MAX_BYTES = 10 * 1024 * 1024;
const args = new Set(process.argv.slice(2));

// Recursively list files under dir matching ext.
function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  }).sort(); // sorted → deterministic bundle order
}

// virtual:textures → { name: dataURI } for every PNG in assets/textures
// virtual:content  → { rooms: {id: json}, objects: {...}, ... } for every JSON under content/
const virtualPlugin = {
  name: 'virtual',
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => {
      if (a.path === 'virtual:textures') {
        const dir = path.join(ROOT, 'assets/textures');
        const files = walk(dir, '.png');
        const map = Object.fromEntries(files.map((f) => [
          path.basename(f, '.png'),
          'data:image/png;base64,' + fs.readFileSync(f).toString('base64'),
        ]));
        return { contents: 'export default ' + JSON.stringify(map), loader: 'js', watchFiles: files, watchDirs: [dir] };
      }
      if (a.path === 'virtual:content') {
        const dir = path.join(ROOT, 'content');
        const files = walk(dir, '.json');
        const out = {};
        for (const f of files) {
          const rel = path.relative(dir, f).split(path.sep);
          const kind = rel[0].replace(/\.json$/, '');
          let data;
          try { data = JSON.parse(fs.readFileSync(f, 'utf8')); }
          catch (e) { throw new Error(`Bad JSON in ${path.relative(ROOT, f)}: ${e.message}`); }
          if (rel.length === 1) { out[kind] = data; continue; } // e.g. content/config.json
          out[kind] ??= {};
          const id = data.id ?? path.basename(f, '.json');
          if (out[kind][id]) throw new Error(`Duplicate ${kind} id "${id}" in ${path.relative(ROOT, f)}`);
          out[kind][id] = data;
        }
        return { contents: 'export default ' + JSON.stringify(out), loader: 'js', watchFiles: files, watchDirs: [dir, ...new Set(files.map((f) => path.dirname(f)))] };
      }
    });
  },
};

const htmlPlugin = {
  name: 'html',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text
        .replace(/<\/script/gi, '<\\/script'); // keep the inline script tag intact
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>THE HUM</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #game { position: fixed; inset: 0; width: 100%; height: 100%; display: block;
          image-rendering: pixelated; cursor: crosshair; touch-action: none; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<script>${js}</script>
</body>
</html>
`;
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(OUT_FILE, html);
      const size = Buffer.byteLength(html);
      const mb = (size / 1024 / 1024).toFixed(2);
      if (size >= MAX_BYTES) {
        console.error(`✖ ${path.relative(ROOT, OUT_FILE)} is ${mb} MB, over the 10 MB limit`);
        if (!args.has('--watch')) process.exitCode = 1;
      } else {
        console.log(`✔ ${path.relative(ROOT, OUT_FILE)} ${mb} MB (${new Date().toLocaleTimeString()})`);
      }
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: !args.has('--watch'),
  target: 'es2020',
  write: false,
  outdir: OUT_DIR,
  legalComments: 'none',
  logLevel: 'warning',
  define: { __DEV__: String(args.has('--watch')) },
  plugins: [virtualPlugin, htmlPlugin],
});

if (args.has('--watch')) {
  await ctx.watch();
  console.log('watching for changes…');
  if (args.has('--serve')) {
    http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      fs.createReadStream(OUT_FILE).pipe(res);
    }).listen(8080, () => console.log('serving http://localhost:8080'));
  }
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
