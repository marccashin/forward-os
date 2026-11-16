#!/usr/bin/env node
/*
 * FORWARD OS: Preferred Vendors team notes, in the DATABASE (sql/2026-11-16_vendor_notes.sql).
 * Run on every pull request. Starts a throwaway Postgres, runs the repo's own SQL twice and acts
 * as the app's database role (anon): a note is added once (a retry is ignored), the database
 * stamps its time, the app cannot change or delete one, and remove_vendor_note() lets only the
 * agent who wrote it, Marc or Operations remove it, keeping the row.
 *
 * SAFETY: never touches production. The database is created and deleted here.
 *
 * Usage: node ci/vendor-notes-db-test.js <repo dir>
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

  const SQLF = fs.readFileSync(path.join(dir, 'sql', '2026-11-16_vendor_notes.sql'), 'utf8');
  s = sql(SQLF); ok(!/ERROR/.test(s.err), 'the SQL file runs with no error', s.err);
  s = sql(SQLF); ok(!/ERROR/.test(s.err), 'running it a second time is harmless', s.err);

  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  console.log('\nThe app adds and reads');
  s = anon("insert into public.vendor_notes (id, vendor, trade, region, good, body, agent_name) values ('" + A + "', 'Adam Grate', 'Home Inspector', 'Washington, DC', true, 'Report in 24 hours.', 'Niki Lang');");
  ok(!/ERROR/.test(s.err), 'a note is added', s.err);
  s = anon("insert into public.vendor_notes (id, vendor, good, body, agent_name) values ('" + A + "', 'Other', false, 'x', 'Niki Lang') on conflict (id) do nothing;");
  ok(!/ERROR/.test(s.err), 'sending the same id again (a retry) is ignored, not an error', s.err);
  s = anon("select count(*) || '|' || max(vendor) from public.vendor_notes;");
  ok(s.out === '1|Adam Grate', 'one row, the first one kept', s.out);
  s = anon("insert into public.vendor_notes (id, vendor, good, body, agent_name, created_at) values ('" + B + "', 'Walt Myer', false, 'Never called back.', 'Cesar Rivera', now() - interval '30 days') returning created_at > now() - interval '1 minute';");
  ok(!/ERROR/.test(s.err) && s.out === 't', 'created_at is the database\'s, never a date the app sent', s);
  for (const [cols, vals, why] of [["vendor, good, body, agent_name", "'X', true, '   ', 'Niki Lang'", 'an empty note'], ["vendor, good, body, agent_name", "'', true, 'x', 'Niki Lang'", 'no vendor'], ["vendor, body, agent_name", "'X', 'x', 'Niki Lang'", 'no went well / did not'], ["vendor, good, body", "'X', true, 'x'", 'no agent']]) {
    s = anon("insert into public.vendor_notes (id, " + cols + ") values (gen_random_uuid(), " + vals + ");");
    ok(/ERROR/.test(s.err), 'refused: ' + why, s.err);
  }
  s = anon("insert into public.vendor_notes (id, vendor, good, body, agent_name, removed_at) values (gen_random_uuid(), 'X', true, 'x', 'Niki Lang', now());");
  ok(/row-level security/.test(s.err), 'a note cannot be added already removed', s.err);

  console.log('\nThe app cannot change or delete a note');
  for (const col of ["body = 'changed'", "good = false", "agent_name = 'x'", "removed_at = now()", "created_at = now()"]) {
    s = anon("update public.vendor_notes set " + col + " where id = '" + A + "';");
    ok(/permission denied/.test(s.err), 'refused: update ' + col.split(' ')[0], s.err);
  }
  s = anon("delete from public.vendor_notes where id = '" + A + "';");
  ok(/permission denied/.test(s.err), 'a DELETE is refused', s.err);

  console.log('\nRemoving a note: the writer, Marc or Operations');
  s = anon("select public.remove_vendor_note('" + A + "', 'Cesar Rivera');");
  ok(/only the agent who wrote a note/.test(s.err), 'another agent cannot remove it', s.err);
  s = anon("select public.remove_vendor_note('" + A + "', '');");
  ok(/say who/.test(s.err), 'a removal must say who', s.err);
  s = anon("select (public.remove_vendor_note('" + A + "', 'Niki Lang')).removed_by;");
  ok(!/ERROR/.test(s.err) && s.out === 'Niki Lang', 'the agent who wrote it can remove it', s);
  s = anon("select public.remove_vendor_note('" + A + "', 'Niki Lang');");
  ok(/already removed/.test(s.err), 'a removed note cannot be removed again', s.err);
  s = anon("select (public.remove_vendor_note('" + B + "', 'Operations')).removed_by;");
  ok(!/ERROR/.test(s.err) && s.out === 'Operations', 'Operations can remove anyone\'s note', s);
  s = anon("select public.remove_vendor_note('33333333-3333-4333-8333-333333333333', 'Marc Cashin');");
  ok(/not found/.test(s.err), 'an unknown note is refused', s.err);
  s = anon("select count(*) from public.vendor_notes where removed_at is null;");
  ok(s.out === '0', 'the list query shows no removed note', s.out);
  s = sql("select count(*) from public.vendor_notes;");
  ok(s.out === '2', 'both rows are still in the table', s.out);
  s = anon("insert into public.vendor_notes (id, vendor, good, body, agent_name) values (gen_random_uuid(), 'Adam Grate', true, 'x', 'Charlotte Lee') returning id;");
  const C = s.out;
  s = anon("select (public.remove_vendor_note('" + C + "', 'Marc Cashin')).removed_by;");
  ok(s.out === 'Marc Cashin', 'Marc can remove anyone\'s note', s);

  stop();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); stop(); process.exit(1); });
