#!/usr/bin/env node
/*
 * FORWARD OS: static checks for index.html, run on every pull request.
 *
 * WHY THIS EXISTS
 * index.html is one ~1.9MB file holding the whole app. Five times a change
 * used a name in the template that setup() did not return, and production
 * rendered a blank page (latest: PR #132). Once a span replacement deleted a
 * whole feature (PR #140). Each time the checks that would have caught it
 * existed only in a session's scratch folder, and depended on that session
 * remembering to run them. This file is those checks, in the repo, run by
 * GitHub on every PR whether or not anyone remembers.
 *
 * WHAT IT CHECKS (head = the PR's file, base = main's file)
 *  1. Every inline <script> parses.
 *  2. The #app template compiles with no compile errors that main does not
 *     already have. Parity is the signal, not zero: main has known errors.
 *  3. Every name the template uses is returned from setup(), except names
 *     main is already missing. A new missing name is a blank page.
 *  4. Every name setup() returns is declared (defcheck), same parity rule.
 *  5. The file did not shrink by more than 2% against main, which is how a
 *     deleted feature shows up. Override with a PR label / env ALLOW_SHRINK=1.
 *  6. CHANGELOG evaluates, ids are unique, and the newest id is last
 *     (checkForUpdates() reads CHANGELOG[CHANGELOG.length - 1].id).
 *  The same parse check (1) runs on cma-tool.html and fos-update.js.
 *
 * Usage: node ci/static-checks.js <head-dir> <base-dir>
 * Needs: @vue/compiler-dom, acorn, acorn-walk (resolved through NODE_PATH).
 * Exit code 1 on any failure. Never writes to the repo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { compile } = require('@vue/compiler-dom');
const acorn = require('acorn');
const walk = require('acorn-walk');

const [headDir, baseDir] = process.argv.slice(2);
if (!headDir || !baseDir) {
  console.error('usage: node ci/static-checks.js <head-dir> <base-dir>');
  process.exit(2);
}

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

function read(dir, file) {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// ── helpers ────────────────────────────────────────────────────────────────
function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript|module)[^"']+["']/.test(attrs)) continue;
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

function parseErrors(html, label) {
  const errs = [];
  inlineScripts(html).forEach((s, i) => {
    try { new Function(s.code); }
    catch (e) { errs.push(`${label}: inline <script> #${i + 1} (starts at line ${s.line}) does not parse: ${e.message}`); }
  });
  return errs;
}

function appTemplate(html) {
  const open = html.indexOf('<div id="app">');
  if (open < 0) return null;
  const nextScript = html.indexOf('<script', open);
  const end = html.lastIndexOf('</div>', nextScript < 0 ? html.length : nextScript);
  if (end < 0) return null;
  return html.slice(open + '<div id="app">'.length, end);
}

function compileInfo(html) {
  const tpl = appTemplate(html);
  if (tpl == null) return null;
  const errors = [];
  let code = '';
  try {
    code = compile(tpl, {
      mode: 'module', prefixIdentifiers: true, hoistStatic: false,
      onError: (e) => errors.push(e.message), onWarn: () => {},
    }).code;
  } catch (e) { errors.push('compiler crashed: ' + e.message); }
  const used = new Set();
  const re = /_ctx\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code))) used.add(m[1]);
  return { errors, used };
}

// Names declared directly in a function body or at the top of a script.
function declaredIn(bodyNodes, into) {
  const addPattern = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') into.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => addPattern(q.value || q.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(addPattern);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  for (const n of bodyNodes) {
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => addPattern(d.id));
    else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') into.add(n.id.name);
  }
}

function setupInfo(html) {
  const scripts = inlineScripts(html).filter((s) => /createApp\s*\(/.test(s.code));
  if (scripts.length !== 1) return { error: `expected exactly one inline script calling createApp(, found ${scripts.length}` };
  let ast;
  try { ast = acorn.parse(scripts[0].code, { ecmaVersion: 'latest', sourceType: 'script' }); }
  catch (e) { return { error: 'main script does not parse: ' + e.message }; }

  const topLevel = new Set();
  declaredIn(ast.body, topLevel);

  let setupFn = null;
  walk.simple(ast, {
    CallExpression(n) {
      const c = n.callee;
      const isCreate = (c.type === 'Identifier' && c.name === 'createApp') ||
        (c.type === 'MemberExpression' && c.property && c.property.name === 'createApp');
      if (!isCreate || !n.arguments[0] || n.arguments[0].type !== 'ObjectExpression') return;
      for (const p of n.arguments[0].properties) {
        if (p.key && p.key.name === 'setup') setupFn = p.value;
      }
    },
  });
  if (!setupFn) return { error: 'could not find setup() inside createApp({...})' };

  const declared = new Set(topLevel);
  setupFn.params.forEach((p) => p.type === 'Identifier' && declared.add(p.name));
  declaredIn(setupFn.body.body, declared);

  const ret = [...setupFn.body.body].reverse().find((n) => n.type === 'ReturnStatement');
  if (!ret || !ret.argument || ret.argument.type !== 'ObjectExpression') {
    return { error: 'setup() does not end in `return { ... }`' };
  }
  const returned = new Set();
  const undeclared = new Set();
  for (const p of ret.argument.properties) {
    if (p.type === 'SpreadElement') continue;
    const key = p.key.name || p.key.value;
    returned.add(key);
    // `name` or `name: other`: the value identifier must exist.
    if (p.value && p.value.type === 'Identifier' && !declared.has(p.value.name)) undeclared.add(p.value.name);
  }
  return { returned, undeclared, declaredCount: declared.size };
}

// Names the compiled template reads from _ctx that Vue itself provides.
const VUE_PROVIDED = new Set(['$event', '$el', '$refs', '$emit', '$nextTick', '$slots', '$attrs', '$props', '$data', '$options', '$parent', '$root', '$forceUpdate', '$watch']);

function changelogInfo(html) {
  const start = html.indexOf('const CHANGELOG = [');
  if (start < 0) return { error: 'const CHANGELOG = [ not found' };
  const end = html.indexOf('\n];', start);
  if (end < 0) return { error: 'end of CHANGELOG array not found' };
  let arr;
  try { arr = new Function('return ' + html.slice(start + 'const CHANGELOG = '.length, end + 2))(); }
  catch (e) { return { error: 'CHANGELOG does not evaluate: ' + e.message }; }
  if (!Array.isArray(arr) || !arr.length) return { error: 'CHANGELOG is empty' };
  return { ids: arr.map((e) => e.id), text: JSON.stringify(arr) };
}

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// ── run ────────────────────────────────────────────────────────────────────
const head = read(headDir, 'index.html');
const base = read(baseDir, 'index.html');
if (!head) { console.error('index.html missing in ' + headDir); process.exit(2); }
if (!base) { console.error('index.html missing in ' + baseDir); process.exit(2); }

// 1. scripts parse
parseErrors(head, 'index.html').forEach(fail);
for (const f of ['cma-tool.html', 'campaign-print.html']) {
  const h = read(headDir, f);
  if (h) parseErrors(h, f).forEach(fail);
}
const upd = read(headDir, 'fos-update.js');
if (upd) { try { new Function(upd); } catch (e) { fail('fos-update.js does not parse: ' + e.message); } }

// 2 + 3. template compiles; names used are returned
const hc = compileInfo(head), bc = compileInfo(base);
const hs = setupInfo(head), bs = setupInfo(base);
if (!hc) fail('index.html: <div id="app"> not found');
if (hs.error) fail('index.html: ' + hs.error);

if (hc && bc) {
  const baseErrs = new Map();
  bc.errors.forEach((e) => baseErrs.set(e, (baseErrs.get(e) || 0) + 1));
  const fresh = [];
  hc.errors.forEach((e) => {
    const n = baseErrs.get(e) || 0;
    if (n > 0) baseErrs.set(e, n - 1); else fresh.push(e);
  });
  note(`template compile errors: main ${bc.errors.length}, this PR ${hc.errors.length}`);
  fresh.forEach((e) => fail('NEW template compile error (not on main): ' + e));
}

if (hc && !hs.error) {
  const missing = new Set(diff(hc.used, hs.returned).filter((n) => !VUE_PROVIDED.has(n)));
  let known = new Set();
  if (bc && !bs.error) known = new Set(diff(bc.used, bs.returned).filter((n) => !VUE_PROVIDED.has(n)));
  const fresh = diff(missing, known);
  note(`template uses ${hc.used.size} names; setup() returns ${hs.returned.size}; not returned: main ${known.size}, this PR ${missing.size}`);
  if (fresh.length) {
    fail('BLANK PAGE RISK. The template uses names that setup() does not return: ' + fresh.join(', ') +
      '. Add them to the return object at the end of setup().');
  }

  // 4. defcheck
  let knownUndecl = new Set();
  if (!bs.error) knownUndecl = bs.undeclared;
  const freshUndecl = diff(hs.undeclared, knownUndecl);
  note(`returned but not declared: main ${knownUndecl.size}, this PR ${hs.undeclared.size}`);
  if (freshUndecl.length) {
    fail('BLANK PAGE RISK. setup() returns names that are not declared anywhere: ' + freshUndecl.join(', ') +
      '. A function or ref was deleted or renamed while still listed in the return object.');
  }
}

// 5. shrink
const ratio = head.length / base.length;
note(`index.html size: main ${base.length.toLocaleString()} chars, this PR ${head.length.toLocaleString()} (${((ratio - 1) * 100).toFixed(2)}%)`);
if (ratio < 0.98 && process.env.ALLOW_SHRINK !== '1') {
  fail(`index.html is ${((1 - ratio) * 100).toFixed(1)}% smaller than main. A span replacement once deleted a whole feature this way. ` +
    'If the removal is intended, add the label "allow-shrink" to the PR.');
}

// 6. changelog
const hl = changelogInfo(head), bl = changelogInfo(base);
if (hl.error) fail('CHANGELOG: ' + hl.error);
else {
  const dup = hl.ids.filter((id, i) => hl.ids.indexOf(id) !== i);
  if (dup.length) fail('CHANGELOG has duplicate ids: ' + [...new Set(dup)].join(', '));
  const last = hl.ids[hl.ids.length - 1];
  const newest = [...hl.ids].sort()[hl.ids.length - 1];
  if (last !== newest) fail(`CHANGELOG: the newest id (${newest}) is not the LAST entry (${last}). checkForUpdates() reads the last entry, so agents would not see it.`);
  if (/—/.test(hl.text) && !(bl.text && /—/.test(bl.text))) fail('CHANGELOG contains an em dash. Project rule: none in anything agents read.');
  if (!bl.error) {
    const gone = bl.ids.filter((id) => !hl.ids.includes(id));
    if (gone.length) fail('CHANGELOG entries on main are missing from this PR: ' + gone.join(', '));
    note(`CHANGELOG: main ends ${bl.ids[bl.ids.length - 1]}, this PR ends ${last}` +
      (head !== base && hl.text === bl.text ? '  (unchanged: fine for a non-user-facing PR, required for a user-facing one)' : ''));
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log('FORWARD OS static checks');
notes.forEach((n) => console.log('  · ' + n));
if (failures.length) {
  console.log('\nFAILED (' + failures.length + ')');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\nPASSED');
