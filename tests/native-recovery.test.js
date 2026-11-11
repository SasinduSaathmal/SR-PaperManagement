import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {appTables,planArchive,emptyDestinationSQL,copyRowCounts,countCheckSQL,readinessWithoutTransaction} from '../scripts/prepare-native-restore.mjs';
import {fixture} from './adminFixture.js';

function archiveTOC(){
  let id=1;
  const entry=(kind,schema,name,owner='postgres')=>`${id++}; 0 0 ${kind} ${schema} ${name} ${owner}`;
  return ['; Dumped from database version: 17.11',
    entry('SCHEMA','-','public','pg_database_owner'),entry('SCHEMA','-','auth','supabase_auth_admin'),
    entry('SCHEMA','-','app_private'),entry('ACL','-','SCHEMA app_private'),entry('ACL','-','SCHEMA public'),
    entry('DEFAULT ACL','public','DEFAULT PRIVILEGES FOR TABLES','supabase_admin'),
    entry('FUNCTION','app_private','create_marker_profile()'),entry('FUNCTION','public','app_get_report(p_id uuid)'),
    entry('ACL','public','TABLE profiles'),entry('ROW SECURITY','public','profiles'),entry('POLICY','public','profiles profiles_read'),
    ...appTables.map(t=>entry('TABLE DATA','public',t)),
    entry('TABLE','auth','users','supabase_auth_admin'),entry('TABLE DATA','auth','users','supabase_auth_admin'),
    entry('TABLE DATA','auth','identities','supabase_auth_admin'),entry('TABLE DATA','auth','schema_migrations','supabase_auth_admin'),
    entry('SEQUENCE SET','auth','refresh_tokens_id_seq','supabase_auth_admin')
  ].join('\n');
}

test('native restore selection keeps app permissions and Auth data while excluding managed definitions and defaults',()=>{
  const plan=planArchive(archiveTOC());
  assert.equal(plan.data.length,23);
  assert.ok(plan.app.some(e=>e.kind==='SCHEMA'&&e.name==='app_private'));
  assert.ok(plan.app.some(e=>e.kind==='ACL'&&e.name==='SCHEMA app_private'));
  assert.ok(plan.app.some(e=>e.kind==='ACL'&&e.name==='TABLE profiles'));
  assert.ok(plan.app.some(e=>e.kind==='ROW SECURITY'));
  assert.ok(plan.app.some(e=>e.kind==='POLICY'));
  assert.ok(!plan.app.some(e=>e.kind==='DEFAULT ACL'||e.schema==='auth'||e.name==='SCHEMA public'||e.name==='public'));
  assert.ok(plan.auth.some(e=>e.kind==='SEQUENCE SET'));
  assert.ok(!plan.auth.some(e=>e.kind==='TABLE'||e.name==='schema_migrations'));
  assert.throws(()=>planArchive(archiveTOC().replace('17.11','18.1')),/PostgreSQL 17 source/);
  assert.throws(()=>planArchive(archiveTOC().replace(/.*TABLE DATA auth identities.*\n?/,'')),/Required table data missing/);
  assert.throws(()=>planArchive(archiveTOC()+'\nnot a TOC entry'),/Unrecognised archive entry/);
});

test('native COPY verification counts escaped records and empty tables, rejects truncated exports',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'paper-copy-'));
  try{
    const file=path.join(dir,'data.sql');
    await writeFile(file,'COPY public.students (id, name) FROM stdin;\r\n1\tA\\nB\r\n2\t\\\\.\r\n\\.\r\nCOPY "auth"."identities" (id) FROM stdin;\r\n\\.\r\n');
    assert.deepEqual(await copyRowCounts(file),{'public.students':2,'auth.identities':0});
    await writeFile(file,'COPY public.students (id) FROM stdin;\n1\n');
    await assert.rejects(()=>copyRowCounts(file),/Incomplete COPY/);
    await writeFile(file,'COPY public.students (id) FROM stdin;\n\\.\nCOPY public.students (id) FROM stdin;\n\\.\n');
    await assert.rejects(()=>copyRowCounts(file),/Duplicate COPY/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('native restore refuses a populated destination, validates exact row counts and rolls back a failed restore',async()=>{
  const source=await fixture();
  const fresh=new PGlite();
  try{
    // PGlite may embed a newer major; the real preparer always requests 17.
    const major=Number((await fresh.query("select current_setting('server_version_num') as version")).rows[0].version)/10000|0;
    await assert.rejects(()=>source.db.exec(emptyDestinationSQL(['users'],major)),/destination contains application objects/);
    await fresh.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.schema_migrations(version text);insert into auth.schema_migrations values('managed');`);
    await fresh.exec(`alter default privileges in schema public grant all on tables to anon,authenticated;
      alter default privileges grant all on functions to anon;
      alter default privileges in schema public grant all on functions to anon,authenticated;`);
    await fresh.exec(emptyDestinationSQL(['users'],major)); // Managed migration rows are intentionally retained.
    await fresh.exec(`create table public.permissions_probe(id int);
      create function public.permissions_probe() returns int language sql as 'select 1'`);
    assert.deepEqual((await fresh.query(`select has_table_privilege('anon','public.permissions_probe','SELECT') as anonymous_read,
      has_table_privilege('authenticated','public.permissions_probe','UPDATE') as browser_write,
      has_function_privilege('anon','public.permissions_probe()','EXECUTE') as anonymous_execute,
      has_function_privilege('authenticated','public.permissions_probe()','EXECUTE') as browser_execute`)).rows[0],
      {anonymous_read:false,browser_write:false,anonymous_execute:false,browser_execute:false});
    await fresh.exec('drop table public.permissions_probe;drop function public.permissions_probe()');
    await assert.rejects(()=>fresh.exec(emptyDestinationSQL(['users'],major+1)),/Destination must use PostgreSQL/);
    await assert.rejects(()=>fresh.exec(emptyDestinationSQL(['users','identities'],major)),/missing table identities/);
    await fresh.exec("insert into auth.users values('00000000-0000-0000-0000-000000000001')");
    await assert.rejects(()=>fresh.exec(emptyDestinationSQL(['users'],major)),/already contains data/);
    await fresh.exec(countCheckSQL({'auth.users':1}));
    await fresh.exec('begin;create table public.trial(id int)');
    await assert.rejects(()=>fresh.exec(countCheckSQL({'auth.users':99})),/expected 99, found 1/);
    await fresh.exec('rollback');
    assert.equal((await fresh.query("select to_regclass('public.trial') as relation")).rows[0].relation,null);
    const readiness=readinessWithoutTransaction(await readFile(new URL('../supabase/checks/restore_readiness.sql',import.meta.url),'utf8'));
    assert.ok(!/^begin transaction|^commit;/m.test(readiness));
    // The same checks compose inside an outer transaction without committing it.
    await source.db.exec('begin');await source.db.exec(readiness);
    await source.db.exec('create table public.rollback_probe(id int);rollback');
    assert.equal((await source.db.query("select to_regclass('public.rollback_probe') as relation")).rows[0].relation,null);
  }finally{await fresh.close();await source.db.close();}
});
