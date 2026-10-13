// Build stamp for the glasses HUD.
//
//   node scripts/stamp.mjs        (npm run stamp; npm run deploy runs it first)
//
// The glasses keep GlassTube's page alive for days, so a deploy only reaches
// them if the running page can tell it is out of date. This script gives every
// deploy an identity both halves agree on:
//
// - Each local file index.html loads with ?v= (app.js, player.js, styles.css,
//   prefs.js, sound.js, icons) gets ?v=<8-hex sha256 of that file>, so a new
//   file is never served from a stale cache and an unchanged one stays cached.
// - GLASSTUBE_BUILD is an 8-hex sha256 over those per-file hashes, embed.html,
//   and index.html with the build value and every ?v= value blanked. It is
//   written into index.html (window.GLASSTUBE_BUILD) and api/_build.js
//   (export const BUILD), which /api/pair returns on every poll. A HUD whose
//   build differs reloads itself at the next safe moment (app.js).
//
// api/_build.js starts with an underscore, so Vercel does not count it as a
// serverless function. Running this twice changes nothing the second time.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const BUILD_JS = join(ROOT, 'api', '_build.js');
// Files that must be stamped. Anything else index.html loads with ?v= is
// stamped too when it exists locally (icons, the manifest).
const REQUIRED = ['app.js', 'player.js', 'styles.css', 'prefs.js', 'sound.js'];
// <script src="/x?v=..."> and <link href="/x?v=...">, local paths only.
const REF = /(<(?:script|link)\b[^>]*?\b(?:src|href)=["'])(\/?[A-Za-z0-9._/-]+)\?v=([^"'&#]*)/g;
const BUILD_LINE = /(window\.GLASSTUBE_BUILD\s*=\s*['"])([^'"]*)(['"])/;

const hex8 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 8);

let html = readFileSync(INDEX, 'utf8');
if (!BUILD_LINE.test(html)) {
  console.error('stamp: index.html has no window.GLASSTUBE_BUILD line');
  process.exit(1);
}

const hashes = {};
html = html.replace(REF, (all, head, path, _old) => {
  const rel = path.replace(/^\//, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) return all;
  if (!hashes[rel]) hashes[rel] = hex8(readFileSync(file));
  return head + path + '?v=' + hashes[rel];
});
const missing = REQUIRED.filter(f => !hashes[f]);
if (missing.length) {
  console.error('stamp: index.html does not load ' + missing.join(', ') + ' with ?v=');
  process.exit(1);
}

// What the page is, independent of its own stamp: blank the build and every
// ?v= value so the result does not depend on the previous run.
const blanked = html
  .replace(BUILD_LINE, (all, a, _b, c) => a + c)
  .replace(REF, (all, head, path) => head + path + '?v=');
const h = createHash('sha256');
for (const rel of Object.keys(hashes).sort()) h.update(rel + '=' + hashes[rel] + '\n');
const embed = join(ROOT, 'embed.html');
h.update('embed.html=' + (existsSync(embed) ? hex8(readFileSync(embed)) : 'none') + '\n');
h.update('index.html\n');
h.update(blanked);
const BUILD = h.digest('hex').slice(0, 8);

html = html.replace(BUILD_LINE, (all, a, _b, c) => a + BUILD + c);
const before = readFileSync(INDEX, 'utf8');
if (html !== before) writeFileSync(INDEX, html);

const buildJs = '// Written by scripts/stamp.mjs. Do not edit by hand.\n' +
  '// /api/pair returns it as d.build; a HUD running another build reloads itself.\n' +
  "export const BUILD = '" + BUILD + "';\n";
const oldJs = existsSync(BUILD_JS) ? readFileSync(BUILD_JS, 'utf8') : '';
if (oldJs !== buildJs) writeFileSync(BUILD_JS, buildJs);

console.log('stamp: build ' + BUILD + (html !== before || oldJs !== buildJs ? ' (updated)' : ' (unchanged)'));
for (const rel of Object.keys(hashes).sort()) console.log('  ' + rel + ' ' + hashes[rel]);
