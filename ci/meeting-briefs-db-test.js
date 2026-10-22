#!/usr/bin/env node
/*
 * FORWARD OS: moving and removing Meeting Prep briefs, in the DATABASE. Run on every pull request.
 *
 * The app may only read and add rows in meeting_briefs. Moving a brief to the right card,
 * or taking it off a card, goes through two Postgres functions (sql/2026-10-22_meeting_briefs_move.sql).
 * This starts a throwaway database, builds a stand-in for the production tables (buyers,
 * properties), loads the live meeting_briefs SQL (sql/2026-09-30_meeting_briefs.sql) and then
 * the new file, and acts as the app's own database role (anon), one transaction per step.
 *
 * SAFETY: never touches production. The database is created and deleted here.
 *
 * Usage: node ci/meeting-briefs-db-test.js <repo dir>
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

const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;   // Postgres refuses to run as root
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-mb-'));
const data = path.join(base, 'data'), sock = base;
const PORT = String(40000 + Math.floor(Math.random() * 20000));
if (ROOT) { spawnSync('chown', ['-R', 'postgres', base]); fs.chmodSync(base, 0o755); }
function asPg(cmd, args, opts) {
  return ROOT ? spawnSync('runuser', ['-u', 'postgres', '--', 'env', 'PGOPTIONS=' + (process.env.PGOPTIONS || ''), cmd].concat(args), opts || { encoding: 'utf8' })
              : spawnSync(cmd, args, opts || { encoding: 'utf8' });
}
const SUPER = ROOT ? 'postgres' : os.userInfo().username;
const PSQL = ['-h', sock, '-p', PORT, '-U', SUPER, '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=0'];
// Nothing may hang: a statement that waits on a lock for 8 seconds is a failed check, not a stuck job.
process.env.PGOPTIONS = '-c lock_timeout=8000 -c statement_timeout=30000';
// Each statement is its own transaction (psql reading a script autocommits), as with PostgREST.
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
function done() { stop(); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }


(async () => {
  let r = asPg(path.join(BIN, 'initdb'), ['-D', data, '-U', SUPER, '-A', 'trust', '-E', 'UTF8', '--no-sync']);
  if (r.status !== 0) { console.log('FAIL initdb: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }
  r = asPg(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '60', '-o', '-c listen_addresses= -k ' + sock + ' -p ' + PORT + ' -c fsync=off', '-l', path.join(base, 'log'), 'start']);
  if (r.status !== 0) { console.log('FAIL could not start Postgres: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }

  // Cards: a buyer with buyer_name, a buyer with only first and last name, two sellers.
  const B1 = '57145b0e-4873-4cac-b29d-96bb4b408c3f', B2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        S1 = '9e5a68fb-bb63-44b5-866c-bef99900cb3c', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let s = sql([
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    "grant usage on schema public to anon, authenticated, service_role;",
    "create extension if not exists pgcrypto;",
    "create table public.buyers (id uuid primary key default gen_random_uuid(), buyer_name text, first_name text, last_name text, agent_name text, archived boolean default false, created_at timestamptz default now());",
    "create table public.properties (id uuid primary key default gen_random_uuid(), address text, seller_name text, agent_name text, market text, created_at timestamptz default now());",
    "alter table public.buyers enable row level security; alter table public.properties enable row level security;",
    "create policy \"anon all buyers\" on public.buyers for all to anon, authenticated using (true) with check (true);",
    "create policy \"anon all properties\" on public.properties for all to anon, authenticated using (true) with check (true);",
    "grant all on public.buyers, public.properties to anon, authenticated, service_role;",
    "insert into public.buyers (id, buyer_name) values ('" + B1 + "', 'Julia Long');",
    "insert into public.buyers (id, buyer_name, first_name, last_name) values ('" + B2 + "', null, 'Pat', 'Rivera');",
    "insert into public.properties (id, address, seller_name) values ('" + S1 + "', '219 N Pitt St, Alexandria VA 22314', 'Julie and Greg Chapman'), ('" + S2 + "', '400 Delta Rd, Bethesda, MD 20814', null);"
  ].join('\n'));
  ok(!/ERROR/.test(s.err), 'stand-in production tables build', s.err);
  s = sql(fs.readFileSync(path.join(dir, 'sql', '2026-09-30_meeting_briefs.sql'), 'utf8'));
  ok(!/ERROR/.test(s.err), 'the live meeting_briefs SQL loads', s.err);

  // Two briefs, as on production on Oct 22, 2026, added the way the app adds them.
  s = anon("insert into public.meeting_briefs (id, person_type, person_id, person_name, subject_name, agent_name, brief) values " +
    "('57fc8ddc-e5e0-467d-8a3e-7a66066d9024', 'buyer', '" + B1 + "', 'Julia Long', 'julie chapman', 'Marc Cashin', '{\"disc\":{\"type\":\"I\"}}'), " +
    "('5a46122c-6cd2-4996-ab38-29aec3d88078', 'seller', '" + S1 + "', 'Julie and Greg Chapman', 'Greg Chapman', 'Marc Cashin', '{\"disc\":{\"type\":\"D\"}}');");
  ok(!/ERROR/.test(s.err), 'the app adds two briefs as anon (before the change)', s.err);
  const JULIE = '57fc8ddc-e5e0-467d-8a3e-7a66066d9024', GREG = '5a46122c-6cd2-4996-ab38-29aec3d88078';

  const snap = () => sql([
    "select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,''), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='meeting_briefs' and column_name not in ('removed_at','removed_by');",
    "select string_agg(policyname || '/' || cmd || '/' || roles::text || '/' || coalesce(qual,'') || '/' || coalesce(with_check,''), ' | ' order by policyname) from pg_policies where schemaname='public' and tablename in ('meeting_briefs','buyers','properties');",
    "select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='meeting_briefs' and grantee in ('anon','authenticated');",
    "select string_agg(id::text || person_type || person_id || coalesce(person_name,'') || coalesce(subject_name,'') || brief::text, ',' order by id) from public.meeting_briefs;"
  ].join('\n')).out;
  const before = snap();

  const MIG = fs.readFileSync(path.join(dir, 'sql', '2026-10-22_meeting_briefs_move.sql'), 'utf8');
  s = sql(MIG);
  ok(!/ERROR/.test(s.err), 'the new SQL file runs with no error', s.err);
  s = sql(MIG);
  ok(!/ERROR/.test(s.err), 'running it a second time is harmless', s.err);

  console.log('\nAdditive only');
  ok(snap() === before, 'meeting_briefs columns, every policy, the app grants and the two briefs are exactly as before', { before, after: snap() });
  s = sql("select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='meeting_briefs' and column_name in ('removed_at','removed_by');");
  ok(s.out === 'removed_at:timestamp with time zone:YES,removed_by:text:YES', 'two new nullable columns: removed_at, removed_by', s.out);
  s = sql("select count(*) from public.meeting_briefs where removed_at is null and removed_by is null;");
  ok(s.out === '2', 'existing briefs are not removed', s.out);

  console.log('\nThe app still cannot change a brief directly');
  s = anon("update public.meeting_briefs set person_id = '" + S1 + "' where id = '" + JULIE + "';");
  ok(/permission denied/.test(s.err), 'a direct UPDATE is refused', s);
  s = anon("delete from public.meeting_briefs where id = '" + JULIE + "';");
  ok(/permission denied/.test(s.err), 'a direct DELETE is refused', s);
  s = anon("insert into public.meeting_brief_changes (brief_id, action, changed_by) values ('" + JULIE + "', 'moved', 'x');");
  ok(/permission denied/.test(s.err), 'the change log cannot be written directly', s);
  s = anon("select public.meeting_brief_card_name('buyer', '" + B1 + "');");
  ok(/permission denied/.test(s.err), 'the name helper is not open to the app', s);
  s = anon("insert into public.meeting_briefs (person_type, person_id, person_name, brief) values ('buyer', '" + B2 + "', 'Pat Rivera', '{}') returning person_name;");
  ok(!/ERROR/.test(s.err) && /Pat Rivera/.test(s.out), 'the app can still add a brief', s);
  s = anon("select count(*) from public.meeting_briefs;");
  ok(s.out === '3', 'the app can still read briefs', s.out);

  const row = (id) => sql("select person_type || '|' || person_id || '|' || coalesce(person_name,'') || '|' || coalesce(removed_at::text,'') || '|' || coalesce(removed_by,'') from public.meeting_briefs where id = '" + id + "';").out;
  const changes = () => sql("select count(*) from public.meeting_brief_changes;").out;

  console.log('\nRefusals change nothing');
  const julie0 = row(JULIE);
  const refusals = [
    ["move_meeting_brief('" + JULIE + "', 'seller', '" + S1 + "', '   ')", /say who is moving/, 'a blank name'],
    ["move_meeting_brief('" + JULIE + "', 'lender', '" + S1 + "', 'Marc Cashin')", /buyer or a seller card/, 'a card type that is not buyer or seller'],
    ["move_meeting_brief('" + JULIE + "', 'seller', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Marc Cashin')", /seller card was not found/, 'a seller card that does not exist'],
    ["move_meeting_brief('" + JULIE + "', 'buyer', 'not-a-card', 'Marc Cashin')", /buyer card was not found/, 'a buyer card that does not exist'],
    ["move_meeting_brief('" + JULIE + "', 'buyer', '" + B1 + "', 'Marc Cashin')", /already on this card/, 'the card it is already on'],
    ["move_meeting_brief('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'seller', '" + S1 + "', 'Marc Cashin')", /brief was not found/, 'a brief that does not exist'],
    ["remove_meeting_brief('" + JULIE + "', '')", /say who is removing/, 'a removal with no name'],
    ["remove_meeting_brief('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Marc Cashin')", /brief was not found/, 'removing a brief that does not exist']
  ];
  for (const [call, rx, what] of refusals) {
    s = anon('select (public.' + call + ').id;');
    ok(rx.test(s.err), 'refused: ' + what, s);
  }
  ok(row(JULIE) === julie0 && changes() === '0', 'after every refusal the brief is unchanged and the log is empty', { row: row(JULIE), changes: changes() });

  console.log('\nMoving Julie Chapman\'s brief from buyer Julia Long to the Chapman seller card');
  s = anon("select person_type || '|' || person_id || '|' || person_name || '|' || subject_name || '|' || (brief->'disc'->>'type') from public.move_meeting_brief('" + JULIE + "', 'seller', ' " + S1 + " ', '  Marc Cashin ');");
  ok(!/ERROR/.test(s.err) && s.out === 'seller|' + S1 + '|Julie and Greg Chapman|julie chapman|I', 'the brief is now on the seller card, named from the database, with its subject and brief untouched', s);
  s = sql("select action || '|' || from_type || '|' || from_id || '|' || from_name || '|' || to_type || '|' || to_id || '|' || to_name || '|' || changed_by || '|' || (changed_at > now() - interval '1 minute') from public.meeting_brief_changes;");
  ok(s.out === 'moved|buyer|' + B1 + '|Julia Long|seller|' + S1 + '|Julie and Greg Chapman|Marc Cashin|true', 'one change row: from Julia Long, to the Chapman card, by Marc Cashin, now', s.out);
  s = anon("select count(*) from public.meeting_briefs where person_type='seller' and person_id='" + S1 + "' and removed_at is null;");
  ok(s.out === '2', 'the Chapman card now holds two briefs (Greg and Julie)', s.out);
  s = anon("select count(*) from public.meeting_brief_changes;");
  ok(s.out === '1', 'the app can read the change log', s.out);

  console.log('\nThe card name follows the app\'s rule');
  s = anon("select person_name from public.move_meeting_brief('" + JULIE + "', 'buyer', '" + B2 + "', 'Marc Cashin');");
  ok(s.out === 'Pat Rivera', 'a buyer with no buyer_name goes by first and last name', s);
  s = anon("select person_name from public.move_meeting_brief('" + JULIE + "', 'seller', '" + S2 + "', 'Marc Cashin');");
  ok(s.out === '400 Delta Rd, Bethesda, MD 20814', 'a seller with no seller_name goes by the address', s);
  s = anon("select person_name from public.move_meeting_brief('" + JULIE + "', 'seller', '" + S1 + "', 'Marc Cashin');");
  ok(s.out === 'Julie and Greg Chapman' && changes() === '4', 'moved back to the Chapman card; four moves logged', { out: s.out, changes: changes() });

  console.log('\nRemoving a brief keeps it');
  s = anon("select coalesce(removed_by,'') || '|' || (removed_at is not null) || '|' || person_name from public.remove_meeting_brief('" + GREG + "', ' Marc Cashin ');");
  ok(s.out === 'Marc Cashin|true|Julie and Greg Chapman', 'remove stamps who and when and leaves the card as it was', s);
  s = anon("select count(*) from public.meeting_briefs where id = '" + GREG + "';");
  ok(s.out === '1', 'the removed brief is still in the table', s.out);
  s = anon("select count(*) from public.meeting_briefs where person_type='seller' and person_id='" + S1 + "' and removed_at is null;");
  ok(s.out === '1', 'the card\'s list (removed_at is null) no longer shows it', s.out);
  s = sql("select action || '|' || from_name || '|' || coalesce(to_type,'none') || '|' || changed_by from public.meeting_brief_changes where brief_id = '" + GREG + "';");
  ok(s.out === 'removed|Julie and Greg Chapman|none|Marc Cashin', 'the removal is logged', s.out);
  s = anon("select (public.remove_meeting_brief('" + GREG + "', 'Marc Cashin')).id;");
  ok(/already removed/.test(s.err), 'removing it again is refused', s);
  s = anon("select (public.move_meeting_brief('" + GREG + "', 'buyer', '" + B1 + "', 'Marc Cashin')).id;");
  ok(/removed from its card/.test(s.err), 'a removed brief cannot be moved', s);

  console.log('\nThe app role can run the two functions and nothing else new');
  s = sql("select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute'), ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('move_meeting_brief','remove_meeting_brief','meeting_brief_card_name');");
  ok(s.out === 'meeting_brief_card_name:false,move_meeting_brief:true,remove_meeting_brief:true', 'execute: move and remove yes, the name helper no', s.out);

  done();
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); stop(); process.exit(1); });
