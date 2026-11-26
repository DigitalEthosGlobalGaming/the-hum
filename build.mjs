// Build THE HUM into one self-contained HTML file.
//   node build.mjs            → validate content, then dist/the-hum.html
//   node build.mjs --watch    → rebuild on change
//   node build.mjs --serve    → also serve dist/ on http://localhost:8080
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { loadContent, textureFiles, CONTENT_DIR, TEXTURE_DIR } from './tools/lib/loadContent.mjs';
import { validateAll, printResult } from './tools/validate.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, 'dist');
const MAX_BYTES = 10 * 1024 * 1024;
const args = new Set(process.argv.slice(2));
// Dev (watch) builds go to their own file so a release build never clobbers what the dev server shows.
const OUT_FILE = path.join(OUT_DIR, args.has('--watch') ? 'the-hum.dev.html' : 'the-hum.html');
const WATCH = args.has('--watch');

// virtual:textures → { name: dataURI } for every PNG in assets/textures
// virtual:content  → { rooms: {id: json}, objects: {...}, ... } for every JSON under content/
// Both come from tools/lib/loadContent.mjs, the same loader the content tools use.
const virtualPlugin = {
  name: 'virtual',
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => {
      if (a.path === 'virtual:textures') {
        const files = textureFiles();
        const map = Object.fromEntries(files.map((f) => [
          path.basename(f, '.png'),
          'data:image/png;base64,' + fs.readFileSync(f).toString('base64'),
        ]));
        return { contents: 'export default ' + JSON.stringify(map), loader: 'js', watchFiles: files, watchDirs: [TEXTURE_DIR] };
      }
      if (a.path === 'virtual:content') {
        const { content, files } = loadContent();
        return { contents: 'export default ' + JSON.stringify(content), loader: 'js', watchFiles: files, watchDirs: [CONTENT_DIR, ...new Set(files.map((f) => path.dirname(f)))] };
      }
    });
  },
};

// Validate content before each (re)build. Errors fail a normal build; in --watch they are
// printed and the bundle is still produced so the dev loop keeps running.
const validatePlugin = {
  name: 'validate',
  setup(build) {
    build.onStart(() => {
      const ok = printResult(validateAll());
      if (!ok && !WATCH) return { errors: [{ text: 'content validation failed (see above; run npm run validate)' }] };
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
  plugins: [validatePlugin, virtualPlugin, htmlPlugin],
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
  try { await ctx.rebuild(); }
  catch { process.exitCode = 1; } // esbuild has already printed the errors
  await ctx.dispose();
}
