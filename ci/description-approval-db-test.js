#!/usr/bin/env node
/*
 * FORWARD OS: "Approve for marketing" in the DATABASE. Run on every pull request.
 *
 * The rule that an approval is cleared when the saved listing description changes
 * lives in Postgres, not in the app, so it is tested in a real Postgres. This starts
 * a throwaway database in a temp folder, builds a stand-in for the production tables
 * (properties, property_notes with its foreign key and open anon policy), loads the
 * repo's own SQL files in the order Marc ran them, and then acts as the app's own
 * database role (anon), one transaction per step, the way PostgREST does.
 *
 * SAFETY: never touches production. The database is created and deleted here.
 *
 * Usage: node ci/description-approval-db-test.js <repo dir>
 * Needs: PostgreSQL server binaries (initdb, pg_ctl, psql). No npm packages.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, spawn } = require('child_process');
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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-lda-'));
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

// An open psql session, for the two-connections case.
function session(role) {
  const args = (ROOT ? ['-u', 'postgres', '--', 'env', 'PGOPTIONS=' + process.env.PGOPTIONS, path.join(BIN, 'psql')] : []).concat(PSQL);
  const p = spawn(ROOT ? 'runuser' : path.join(BIN, 'psql'), args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  p.stdout.on('data', d => { buf += d; }); p.stderr.on('data', d => { buf += d; });
  let n = 0;
  const send = (text) => new Promise((res, rej) => {
    const mark = '__MARK_' + (++n) + '__';
    const t0 = Date.now();
    p.stdin.write(text + '\n\\echo ' + mark + '\n');
    (function wait() {
      const i = buf.indexOf(mark);
      if (i >= 0) { const o = buf.slice(0, i).trim(); buf = buf.slice(i + mark.length); return res(o); }
      if (Date.now() - t0 > 15000) return rej(new Error('session timed out; so far: ' + buf));
      setTimeout(wait, 25);
    })();
  });
  const ready = send('set role ' + role + ';');
  return { send: async (t) => { await ready; return send(t); }, close: () => { try { p.stdin.end('\\q\n'); } catch (e) {} } };
}

(async () => {
  let r = asPg(path.join(BIN, 'initdb'), ['-D', data, '-U', SUPER, '-A', 'trust', '-E', 'UTF8', '--no-sync']);
  if (r.status !== 0) { console.log('FAIL initdb: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }
  r = asPg(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '60', '-o', '-c listen_addresses= -k ' + sock + ' -p ' + PORT + ' -c fsync=off', '-l', path.join(base, 'log'), 'start']);
  if (r.status !== 0) { console.log('FAIL could not start Postgres: ' + (r.stderr || r.stdout)); stop(); process.exit(1); }

  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222',
        C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';

  // ── A stand-in for production, as it is before this change ──────────────────
  let s = sql([
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    "grant usage on schema public to anon, authenticated, service_role;",
    "create table public.properties (id uuid primary key default gen_random_uuid(), address text, agent_name text, agent_email text, market text, status text, seller_name text, archived boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());",
    "create table public.property_notes (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade, subfolder text, content text, updated_by text, updated_at timestamptz default now());",
    "alter table public.properties enable row level security; alter table public.property_notes enable row level security;",
    "create policy \"anon all properties\" on public.properties for all to anon, authenticated using (true) with check (true);",
    "create policy \"anon all notes\" on public.property_notes for all to anon, authenticated using (true) with check (true);",
    "grant all on public.properties, public.property_notes to anon, authenticated, service_role;",
    "insert into public.properties (id, address, agent_name) values ('" + A + "','100 Alpha Ct, Alexandria VA 22306','Ashling McGowan'),('" + B + "','200 Bravo Ave. Baltimore, MD','Marc Cashin'),('" + C + "','300 Charlie St NW, Washington, DC','Niki Lang'),('" + D + "','400 Delta Rd, Bethesda, MD','Charlotte Lee');"
  ].join('\n'));
  ok(!s.err, 'stand-in production tables build', s.err);
  for (const f of ['2026-10-03_save_property_note.sql', '2026-10-05_property_note_history.sql']) {
    s = sql(fs.readFileSync(path.join(dir, 'sql', f), 'utf8'));
    ok(!/ERROR/.test(s.err), 'earlier repo SQL loads: ' + f, s.err);
  }
  const snap = () => sql([
    "select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='property_notes';",
    "select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')->' || pg_get_function_result(p.oid) || '#' || md5(p.prosrc), ' | ' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_property_note','save_property_note_by','property_note_keep_history');",
    "select string_agg(tablename || '/' || policyname || '/' || cmd || '/' || roles::text, ' | ' order by tablename, policyname) from pg_policies where schemaname='public' and tablename <> 'listing_description_approvals';",
    "select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='public.property_notes'::regclass and not tgisinternal and tgname <> 'property_notes_recheck_description_approval';"
  ].join('\n')).out;
  const before = snap();

  // ── The new SQL, as one file ────────────────────────────────────────────────
  const MIG = fs.readFileSync(path.join(dir, 'sql', '2026-10-09_listing_description_approvals.sql'), 'utf8');
  s = sql(MIG);
  ok(!/ERROR/.test(s.err), 'the new SQL file runs with no error', s.err);

  console.log('\nAdditive only');
  ok(snap() === before, 'property_notes columns, save_property_note, save_property_note_by, the history function, every existing policy and trigger are exactly as before', { before, after: snap() });

  console.log('\nThe table is the contract');
  s = sql("select column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default,'') from information_schema.columns where table_schema='public' and table_name='listing_description_approvals' order by ordinal_position;");
  ok(s.out === ['property_id|uuid|NO|', 'content|text|NO|', 'approved_by|text|NO|', 'approved_at|timestamp with time zone|NO|now()'].join('\n'), 'four columns: property_id, content text not null, approved_by text not null, approved_at timestamptz not null default now()', s.out);
  s = sql("select (select format_type(atttypid, atttypmod) from pg_attribute where attrelid='public.listing_description_approvals'::regclass and attname='property_id') = (select format_type(atttypid, atttypmod) from pg_attribute where attrelid='public.properties'::regclass and attname='id');");
  ok(s.out === 't', 'property_id has the same type as properties.id', s.out);
  s = sql("select contype::text || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid='public.listing_description_approvals'::regclass order by contype;");
  ok(/^f:FOREIGN KEY \(property_id\) REFERENCES properties\(id\) ON DELETE CASCADE\np:PRIMARY KEY \(property_id\)$/.test(s.out), 'property_id is the primary key and references properties(id) on delete cascade', s);
  s = sql("select relrowsecurity from pg_class where oid='public.listing_description_approvals'::regclass; select string_agg(cmd || ':' || roles::text, ';') from pg_policies where tablename='listing_description_approvals';");
  ok(s.out === 't\nSELECT:{anon,authenticated}', 'row level security is on, with one policy: select for anon and authenticated', s.out);

  const row = (p, role) => sql("select coalesce((select approved_by || '|' || content from public.listing_description_approvals where property_id='" + p + "'), 'NONE');", role || 'anon').out;
  const save = (p, text, by) => anon("select (public.save_property_note_by('" + p + "','listing_remarks',$t$" + text + "$t$,'" + (by || 'Niki Lang') + "')).content;");
  const approve = (p, text, by, role) => sql("select (public.approve_listing_description('" + p + "',$t$" + text + "$t$,'" + by + "')).approved_by;", role || 'anon');

  console.log('\nWho can write');
  for (const role of ['anon', 'authenticated']) {
    s = sql("insert into public.listing_description_approvals (property_id, content, approved_by) values ('" + A + "','x','y');", role);
    ok(/permission denied/.test(s.err), role + ' cannot insert a row directly', s);
    s = sql("update public.listing_description_approvals set content='x';", role);
    ok(/permission denied/.test(s.err), role + ' cannot update a row directly', s);
    s = sql("delete from public.listing_description_approvals;", role);
    ok(/permission denied/.test(s.err), role + ' cannot delete a row directly', s);
    s = sql("select count(*) from public.listing_description_approvals;", role);
    ok(s.out === '0' && !s.err, role + ' can read the table', s);
    s = sql("select public.listing_description_approval_recheck('" + A + "');", role);
    ok(/permission denied/.test(s.err), role + ' cannot call the internal recheck function', s);
  }

  console.log('\nApproving');
  s = approve(A, 'TEXT ONE', 'Ashling McGowan');
  ok(/no saved description/.test(s.err) && row(A) === 'NONE', 'a listing with no saved description cannot be approved', s);
  save(A, 'TEXT ONE');
  s = approve(A, 'SOMETHING ELSE', 'Ashling McGowan');
  ok(/no longer the text you were reading/.test(s.err) && row(A) === 'NONE', 'approving text that is not the saved text is refused and writes nothing', s);
  s = approve(A, 'TEXT ONE', '   ');
  ok(/name is missing/.test(s.err) && row(A) === 'NONE', 'approving with no name is refused', s);
  s = approve(A, '  ', 'Ashling McGowan');
  ok(/no description text/.test(s.err) && row(A) === 'NONE', 'approving blank text is refused', s);
  s = approve(A, 'TEXT ONE', 'Ashling McGowan');
  ok(s.out === 'Ashling McGowan' && !s.err && row(A) === 'Ashling McGowan|TEXT ONE', 'approving the saved text writes one row with the name and the frozen text', s);
  s = sql("select (now() - approved_at) between interval '0' and interval '1 minute' from public.listing_description_approvals where property_id='" + A + "';");
  ok(s.out === 't', 'approved_at is the moment of approval', s.out);
  const at1 = sql("select approved_at from public.listing_description_approvals where property_id='" + A + "';").out;

  console.log('\nSaving identical text keeps the approval');
  s = save(A, 'TEXT ONE', 'Cesar Rivera');
  ok(s.out === 'TEXT ONE' && row(A) === 'Ashling McGowan|TEXT ONE', 'an identical save through save_property_note_by keeps it', { s, row: row(A) });
  s = anon("select (public.save_property_note('" + A + "','listing_remarks','TEXT ONE')).content;");
  ok(s.out === 'TEXT ONE' && row(A) === 'Ashling McGowan|TEXT ONE', 'an identical save through the older save_property_note keeps it', { s, row: row(A) });
  ok(sql("select approved_at from public.listing_description_approvals where property_id='" + A + "';").out === at1, 'and the approval date did not move', at1);
  anon("update public.property_notes set updated_at = now() where property_id='" + A + "' and subfolder='listing_remarks';");
  ok(row(A) === 'Ashling McGowan|TEXT ONE', 'a direct update that leaves the text alone keeps it');

  console.log('\nSaving different text clears the approval');
  anon("select public.save_property_note_by('" + A + "','cma','CMA V3','Niki Lang');");
  anon("insert into public.property_notes (property_id, subfolder, content) values ('" + A + "','voice_note','another voice note');");
  anon("select public.save_property_note_by('" + A + "','listing_remarks_chat','{\"messages\":[]}','Niki Lang');");
  ok(row(A) === 'Ashling McGowan|TEXT ONE', 'saving a CMA note, a voice note or the writer conversation does not touch it');
  save(B, 'B TEXT'); approve(B, 'B TEXT', 'Marc Cashin');
  save(A, 'TEXT TWO');
  ok(row(A) === 'NONE', 'a save with different text deletes the approval row');
  ok(row(B) === 'Marc Cashin|B TEXT', 'and another listing\'s approval is untouched');
  approve(A, 'TEXT TWO', 'Ashling McGowan'); save(A, 'TEXT TWO ');
  ok(row(A) === 'NONE', 'one added space is different text');
  approve(A, 'TEXT TWO ', 'Ashling McGowan');
  anon("select public.save_property_note('" + A + "','listing_remarks','TEXT THREE');");
  ok(row(A) === 'NONE', 'the older save_property_note is covered');
  approve(A, 'TEXT THREE', 'Ashling McGowan');
  anon("update public.property_notes set content='TEXT FOUR' where property_id='" + A + "' and subfolder='listing_remarks';");
  ok(row(A) === 'NONE', 'a direct update of the note is covered');
  approve(A, 'TEXT FOUR', 'Ashling McGowan');
  anon("insert into public.property_notes (property_id, subfolder, content, updated_at) values ('" + A + "','listing_remarks','TEXT FIVE', now() + interval '1 second');");
  ok(row(A) === 'NONE', 'a plain insert of a newer copy (a page still on old code) is covered');
  save(A, 'TEXT SIX'); approve(A, 'TEXT SIX', 'Ashling McGowan');
  anon("delete from public.property_notes where property_id='" + A + "' and subfolder='listing_remarks';");
  ok(row(A) === 'NONE', 'deleting the description is covered');
  save(A, 'TEXT SEVEN'); approve(A, 'TEXT SEVEN', 'Ashling McGowan');
  anon("update public.property_notes set subfolder='cma_old' where property_id='" + A + "' and subfolder='listing_remarks';");
  ok(row(A) === 'NONE', 'moving the note to another type is covered');
  save(A, 'TEXT EIGHT'); approve(A, 'TEXT EIGHT', 'Ashling McGowan');
  anon("begin;\nselect public.save_property_note_by('" + A + "','listing_remarks','TEXT NINE','Niki Lang');\nrollback;");
  ok(row(A) === 'Ashling McGowan|TEXT EIGHT', 'a save that is rolled back leaves the approval in place');
  anon("begin;\nselect public.save_property_note_by('" + A + "','listing_remarks','TEXT NINE','Niki Lang');\nselect public.save_property_note_by('" + A + "','listing_remarks','TEXT EIGHT','Niki Lang');\ncommit;");
  ok(row(A) === 'Ashling McGowan|TEXT EIGHT', 'changed and changed back inside one transaction: the saved text is the approved text, so it stands');

  console.log('\nRe-approval replaces the row');
  save(A, 'TEXT TEN'); approve(A, 'TEXT TEN', 'Ashling McGowan');
  s = approve(A, 'TEXT TEN', 'Marc Cashin');
  ok(s.out === 'Marc Cashin' && row(A) === 'Marc Cashin|TEXT TEN' && sql("select count(*) from public.listing_description_approvals where property_id='" + A + "';").out === '1', 'a second approval replaces the first: one row, new name', { s, row: row(A) });
  s = approve(A, 'TEXT TEN', 'Operations', 'authenticated');
  ok(s.out === 'Operations', 'the function also runs for a signed-in (authenticated) role', s);

  console.log('\nA listing that already has duplicate copies of its description');
  sql("insert into public.property_notes (property_id, subfolder, content, updated_at) values ('" + C + "','listing_remarks','C OLD COPY', now() - interval '3 days'), ('" + C + "','listing_remarks','C CURRENT', now() - interval '1 day');");
  s = approve(C, 'C OLD COPY', 'Niki Lang');
  ok(/no longer the text you were reading/.test(s.err), 'the older copy cannot be approved', s);
  s = approve(C, 'C CURRENT', 'Niki Lang');
  ok(row(C) === 'Niki Lang|C CURRENT', 'the newest copy, the one the OS shows, can be approved', s);
  save(C, 'C CURRENT');
  ok(row(C) === 'Niki Lang|C CURRENT' && sql("select count(*) from public.property_notes where property_id='" + C + "' and subfolder='listing_remarks';").out === '1', 'an identical save collapses the copies to one and keeps the approval');

  console.log('\nTwo connections at once');
  save(D, 'D ONE');
  const s1 = session('anon');
  await s1.send("begin;\ninsert into public.property_notes (property_id, subfolder, content, updated_at) values ('" + D + "','listing_remarks','D TWO', now() + interval '1 second');");
  s = approve(D, 'D ONE', 'Charlotte Lee');      // the other save has not committed, so D ONE is still the saved text
  ok(s.out === 'Charlotte Lee' && row(D) === 'Charlotte Lee|D ONE', 'an approval given while another save is still open is written', s);
  await s1.send('commit;'); s1.close();
  ok(row(D) === 'NONE', 'and is cleared the moment that other save commits different text');
  save(D, 'D THREE');
  const s2 = session('anon');
  await s2.send("begin;\nselect public.save_property_note_by('" + D + "','listing_remarks','D FOUR','Niki Lang');");
  const waiting = new Promise(res => { const p = spawn(ROOT ? 'runuser' : path.join(BIN, 'psql'), (ROOT ? ['-u', 'postgres', '--', 'env', 'PGOPTIONS=' + process.env.PGOPTIONS, path.join(BIN, 'psql')] : []).concat(PSQL, ['-c', "set role anon; select (public.approve_listing_description('" + D + "','D THREE','Charlotte Lee')).approved_by;"])); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => res(o)); });
  await new Promise(r => setTimeout(r, 600));
  await s2.send('commit;'); s2.close();
  const w = await waiting;
  ok(/no longer the text you were reading/.test(w) && row(D) === 'NONE', 'an approval that arrives during a save waits for it, then is refused because the text changed', w);

  // The other order: the approval is still being written when a plain insert of different text commits.
  save(D, 'D FIVE');
  const s3 = session('anon');
  await s3.send("begin;\nselect (public.approve_listing_description('" + D + "','D FIVE','Charlotte Lee')).approved_by;");
  const ins = new Promise(res => { const p = spawn(ROOT ? 'runuser' : path.join(BIN, 'psql'), (ROOT ? ['-u', 'postgres', '--', 'env', 'PGOPTIONS=' + process.env.PGOPTIONS, path.join(BIN, 'psql')] : []).concat(PSQL, ['-c', "set role anon; insert into public.property_notes (property_id, subfolder, content, updated_at) values ('" + D + "','listing_remarks','D SIX', now() + interval '1 second');"])); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => res(o)); });
  await new Promise(r => setTimeout(r, 600));
  await s3.send('commit;'); s3.close();
  const insOut = await ins;
  ok(!/ERROR/.test(insOut) && row(D) === 'NONE', 'a save of different text that lands while an approval is being written waits for it, then clears it', { insOut, row: row(D) });

  console.log('\nHousekeeping');
  const hist0 = sql("select count(*) from public.property_note_history where property_id='" + B + "' and subfolder='listing_remarks';").out;
  save(B, 'B TEXT V2', 'Marc Cashin');
  const hist1 = sql("select count(*) || '|' || (select saved_by from public.property_note_history where property_id='" + B + "' and subfolder='listing_remarks' order by id desc limit 1) from public.property_note_history where property_id='" + B + "' and subfolder='listing_remarks';").out;
  ok(hist1 === (Number(hist0) + 1) + '|Marc Cashin', 'version history still records each save, with the agent\'s name', { hist0, hist1 });
  save(B, 'B TEXT V3'); approve(B, 'B TEXT V3', 'Marc Cashin');
  s = anon("delete from public.properties where id='" + B + "';");
  ok(!s.err && sql("select count(*) from public.listing_description_approvals where property_id='" + B + "';").out === '0', 'deleting a listing removes its approval and raises no error', s);
  const keep = row(C);
  s = sql(MIG);
  ok(!/ERROR/.test(s.err) && row(C) === keep && keep !== 'NONE', 'running the SQL file a second time gives no error and keeps existing approvals', { err: s.err, keep, now: row(C) });
  ok(snap() === before, 'and everything that existed before is still exactly as it was');
  s = sql("select count(*) from pg_trigger where tgrelid='public.property_notes'::regclass and tgname='property_notes_recheck_description_approval';");
  ok(s.out === '1', 'exactly one copy of the trigger exists after the second run', s.out);

  // The three parts, each pasted on its own, comments removed (the way it is handed to Marc).
  sql("drop table public.listing_description_approvals cascade; drop function public.approve_listing_description(uuid, text, text); drop trigger property_notes_recheck_description_approval on public.property_notes; drop function public.property_notes_recheck_description_approval(); drop function public.listing_description_approval_recheck(uuid);");
  const parts = MIG.split(/^-- ===== PART \d of 3[^\n]*\n(?:--[^\n]*\n)*/m).slice(1).map(p => p.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').trim());
  ok(parts.length === 3, 'the file splits into three parts', parts.length);
  let partErr = '';
  parts.forEach(p => { const q = sql(p); if (/ERROR/.test(q.err)) partErr += q.err; });
  save(C, 'C AGAIN'); approve(C, 'C AGAIN', 'Niki Lang'); const a1 = row(C); save(C, 'C CHANGED');
  ok(!partErr && a1 === 'Niki Lang|C AGAIN' && row(C) === 'NONE', 'pasted as three comment-free parts, in order, it builds the same working thing', { partErr, a1, now: row(C) });
  done();
})().catch(e => { console.log('FAIL the test itself stopped: ' + (e && e.stack || e)); fail++; done(); });
