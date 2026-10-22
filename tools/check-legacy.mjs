// Verifies that every script inside dist/Apex-TV.wgt can be parsed by Chromium 63
// (Samsung Tizen 5.0; Tizen 5.5 ships Chromium 69). Run after `npm run build:tv`.
// Chromium 63 = ES2017 + object rest/spread, async iteration, RegExp lookbehind and the s flag,
// but NOT optional catch binding, ?., ??, class fields, BigInt literals, RegExp named groups or \p{...}.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { unpackZip } from './build-tv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wgt = process.argv[2] || path.join(root, 'dist/Apex-TV.wgt');
const files = unpackZip(await fs.readFile(wgt));
const problems = [];

for (const [name, bytes] of files) {
  if (!name.endsWith('.js')) continue;
  const source = bytes.toString('utf8');
  let ast;
  try { ast = acorn.parse(source, { ecmaVersion: 2018, sourceType: 'script' }); }
  catch (error) {
    const around = source.slice(Math.max(0, error.pos - 60), error.pos + 40).replace(/\s+/g, ' ');
    problems.push(`${name}: syntax newer than Chromium 63 — ${error.message} … ${around}`);
    continue;
  }
  walk.full(ast, node => {
    const pattern = node.regex ? node.regex.pattern
      : node.type === 'NewExpression' && node.callee.name === 'RegExp' && node.arguments[0] && typeof node.arguments[0].value === 'string' ? node.arguments[0].value : null;
    if (pattern && (/\(\?<[^=!]/.test(pattern) || /\\[pP]\{/.test(pattern)))
      problems.push(`${name}: RegExp feature unavailable before Chromium 64 at offset ${node.start}: /${pattern.slice(0, 60)}/`);
  });
}

const config = files.get('config.xml').toString('utf8');
const required = config.match(/required_version="([\d.]+)"/);
if (!required || Number(required[1]) > 5.5) problems.push('config.xml: required_version must be 5.5 or lower for 2019/2020 TVs (found ' + (required && required[1]) + ')');
const index = files.get('index.html').toString('utf8');
if (index.indexOf('legacy-polyfills.js') < 0 || index.indexOf('legacy-polyfills.js') > index.indexOf('boot.js')) problems.push('index.html: legacy-polyfills.js must load before boot.js');

if (problems.length) { console.error('Tizen 5.x compatibility check FAILED:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`Tizen 5.x compatibility check passed: ${[...files.keys()].filter(n => n.endsWith('.js')).length} scripts parse as Chromium 63 JavaScript; required_version=${required[1]}.`);
