#!/usr/bin/env node
/*
 * FORWARD OS: Offer Strategy reports kept on the buyer, in the DATABASE. Run on every pull request.
 *
 * Marc, Nov 9, 2026: every strategy run for a client must stay in the OS. Each one is a row in
 * offer_strategies (sql/2026-11-09_offer_strategies.sql). The app may read rows, add rows, update
 * a row's `work` and set `removed_at`. It may not delete a row, change its buyer, inputs or dates,
 * or bring a removed row back. This starts a throwaway database, runs the repo's own SQL twice and
 * acts as the app's database role (anon), one statement per transaction, as PostgREST does.
 *
 * SAFETY: never touches production. The database is created and deleted here.
 *
 * Usage: node ci/offer-strategies-db-test.js <repo dir>
 * Needs: PostgreSQL server binaries (initdb, pg_ctl, psql). No npm packages.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const dir = path.resolve(process.argv[2] || '.');

function findBin() {
  const roots = ['/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/opt'];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const v of fs.readdirSync(r)) {
      const b = path.join(r, v, 'bin');
      if (fs.existsSync(path.join(b, 'initdb')) && fs.existsSync(path.join(b, 'psql'))) found.push(b);
    }
  }
  found.sort((a, b) => parseInt(b.split('/').slice(-2)[0], 10) - parseInt(a.split('/').slice(-2)[0], 10));
  if (found[0]) return found[0];
  const w = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return path.dirname(w.stdout.trim());
  return null;
}
const BIN = findBin();
if (!BIN) { console.log('FAIL PostgreSQL server binaries (initdb, psql) were not found on this machine.'); process.exit(1); }

const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-os-'));
const data = path.join(base, 'data'), sock = base;
const PORT = String(40000 + Math.floor(Math.random() * 20000));
if (ROOT) { spawnSync('chown', ['-R', 'postgres', base]); fs.chmodSync(base, 0o755); }
function asPg(cmd, args, opts) {
  return ROOT ? spawnSync('runuser', ['-u', 'postgres', '--', 'env', 'PGOPTIONS=' + (process.env.PGOPTIONS || ''), cmd].concat(args), opts || { encoding: 'utf8' })
              : spawnSync(cmd, args, opts || { encoding: 'utf8' });
}
const SUPER = ROOT ? 'postgres' : os.userInfo().username;
const PSQL = ['-h', sock, '-p', PORT, '-U', SUPER, '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=0'];
process.env.PGOPTIONS = '-c lock_timeout=8000 -c statement_timeout=30000';
function sql(text, role) {
  const pre = role ? 'set role ' + role + ';\n' : '';
  const r = asPg(path.join(BIN, 'psql'), PSQL.concat(['-f', '-']), { encoding: 'utf8', input: pre + text + '\n' });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const anon = (t) => sql(t, 'anon');
function stop() {
  try { asPg(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } catch (e) {}
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) {}
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }

(async () => {
  let r = asPg(path.join(BIN, 'initdb'), ['-D', data, '-U', SUPER, '-A', 'trust', '-E', 'UTF8', '--no-sync']);
  if (r.status !== 0) { console.log('FAIL initdb: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }
  r = asPg(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '60', '-o', '-c listen_addresses= -k ' + sock + ' -p ' + PORT + ' -c fsync=off', '-l', path.join(base, 'log'), 'start']);
  if (r.status !== 0) { console.log('FAIL could not start Postgres: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }

  let s = sql([
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    "grant usage on schema public to anon, authenticated, service_role;",
    "create extension if not exists pgcrypto;"
  ].join('\n'));
  ok(!/ERROR/.test(s.err), 'roles as on Supabase', s.err);

  const SQLF = fs.readFileSync(path.join(dir, 'sql', '2026-11-09_offer_strategies.sql'), 'utf8');
  s = sql(SQLF); ok(!/ERROR/.test(s.err), 'the SQL file runs with no error', s.err);
  s = sql(SQLF); ok(!/ERROR/.test(s.err), 'running it a second time is harmless', s.err);

  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const BUYER = '57145b0e-4873-4cac-b29d-96bb4b408c3f';
  console.log('\nThe app adds and reads');
  s = anon("insert into public.offer_strategies (id, buyer_id, buyer_name, agent_name, address, inputs, work) values ('" + A + "', '" + BUYER + "', 'Julia Long', 'Marc Cashin', '3 Old Sound Rd', '{\"listPrice\":\"$625,000\"}', '{\"result\":{\"marketValue\":\"$615,000\"}}');");
  ok(!/ERROR/.test(s.err), 'a new strategy is added', s.err);
  s = anon("insert into public.offer_strategies (id, buyer_id, inputs, work) values ('" + A + "', '" + BUYER + "', '{}', '{}') on conflict (id) do nothing;");
  ok(!/ERROR/.test(s.err), 'sending the same id again (a retry) is ignored, not an error', s.err);
  s = anon("select count(*) || '|' || max(work->'result'->>'marketValue') from public.offer_strategies;");
  ok(s.out === '1|$615,000', 'one row, the first one kept', s.out);
  s = anon("insert into public.offer_strategies (id, buyer_id, copied_from, inputs, work) values ('" + B + "', '" + BUYER + "', '" + A + "', '{}', '{}');");
  ok(!/ERROR/.test(s.err), 'a copy made from a reopened strategy is added with copied_from', s.err);
  s = anon("insert into public.offer_strategies (buyer_id, inputs, work, removed_at) values ('" + BUYER + "', '{}', '{}', now());");
  ok(/row-level security/.test(s.err), 'a row cannot be added already removed', s.err);
  s = anon("insert into public.offer_strategies (buyer_id, work) values ('" + BUYER + "', '{}');");
  ok(/null value/.test(s.err), 'inputs are required', s.err);

  console.log('\nThe app updates the work only');
  const t0 = sql("select updated_at from public.offer_strategies where id = '" + A + "';").out;
  s = anon("update public.offer_strategies set work = '{\"result\":{\"marketValue\":\"$620,000\"}}' where id = '" + A + "' returning work->'result'->>'marketValue';");
  ok(!/ERROR/.test(s.err) && s.out === '$620,000', 'work can be updated and the row comes back', s);
  const t1 = sql("select updated_at from public.offer_strategies where id = '" + A + "';").out;
  ok(t1 && t1 !== t0, 'updated_at is set by the database on update', { t0, t1 });
  for (const col of ["inputs = '{}'", "buyer_id = 'x'", "address = 'x'", "created_at = now()", "updated_at = now() - interval '1 day'", "copied_from = null", "agent_name = 'x'"]) {
    s = anon("update public.offer_strategies set " + col + " where id = '" + A + "';");
    ok(/permission denied/.test(s.err), 'refused: update ' + col.split(' ')[0], s.err);
  }
  s = anon("delete from public.offer_strategies where id = '" + A + "';");
  ok(/permission denied/.test(s.err), 'a DELETE is refused', s.err);

  console.log('\nRemove from the list keeps the row, and it stays removed');
  s = anon("update public.offer_strategies set removed_at = now() where id = '" + B + "' returning id;");
  ok(!/ERROR/.test(s.err) && s.out === B, 'removed_at can be set', s);
  s = anon("update public.offer_strategies set removed_at = null where id = '" + B + "' returning id;");
  ok(!/ERROR/.test(s.err) && s.out === '', 'a removed row cannot be brought back (nothing matches)', s);
  s = anon("update public.offer_strategies set work = '{}' where id = '" + B + "' returning id;");
  ok(s.out === '', 'a removed row cannot be changed (nothing matches)', s);
  s = sql("update public.offer_strategies set work = '{}' where id = '" + B + "';");
  ok(/removed and cannot be changed/.test(s.err), 'not even past the app policy: the trigger refuses', s.err);
  s = anon("select count(*) from public.offer_strategies where buyer_id = '" + BUYER + "' and removed_at is null;");
  ok(s.out === '1', 'the list query shows only the one not removed', s.out);
  s = sql("select count(*) from public.offer_strategies;");
  ok(s.out === '2', 'both rows are still in the table', s.out);

  stop();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); stop(); process.exit(1); });
