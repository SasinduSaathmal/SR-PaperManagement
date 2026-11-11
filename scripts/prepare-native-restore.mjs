// Reads a local archive and prepares SQL files. Never connects to a database.
import {spawnSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const appTables=[
  'profiles','exam_groups','schools','students','enrolments','student_change_history',
  'marks_tests','test_participants','test_scores','test_mark_history','marks_write_requests',
  'online_import_batches','online_import_rows','saved_reports','saved_report_tests',
  'online_file_import_receipts','trial_cleanup_runs','cleared_student_requests',
  'student_id_aliases','account_change_history','account_invitations'
];
const identifier=name=>{
  if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw Error(`Unsupported identifier: ${name}`);
  return `"${name}"`;
};
const literal=value=>`'${String(value).replaceAll("'","''")}'`;

export function planArchive(toc) {
  if(!/^;\s*Dumped from database version: 17\./m.test(toc))throw Error('This procedure requires a PostgreSQL 17 source archive.');
  const entries=toc.split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith(';')).map(line=>{
    const match=line.match(/^\d+;\s+\d+\s+\d+\s+(.+?)\s+(public|app_private|auth|-)\s+(.+)\s+(\S+)\s*$/);
    if(!match)throw Error(`Unrecognised archive entry; stop for review: ${line}`);
    return {line,kind:match[1],schema:match[2],name:match[3],owner:match[4]};
  });
  const app=entries.filter(e=>e.kind!=='DEFAULT ACL' && (
    ['public','app_private'].includes(e.schema) ||
    (e.kind==='SCHEMA' && e.schema==='-' && e.name==='app_private') ||
    (['ACL','COMMENT'].includes(e.kind) && e.schema==='-' && e.name==='SCHEMA app_private')
  ));
  const auth=entries.filter(e=>e.schema==='auth' &&
    ((e.kind==='TABLE DATA' && e.name!=='schema_migrations') || e.kind==='SEQUENCE SET'));
  const required=[...appTables.map(t=>`public.${t}`),'auth.users','auth.identities'];
  const data=[...app,...auth].filter(e=>e.kind==='TABLE DATA').map(e=>`${e.schema}.${e.name}`);
  for(const table of required)if(!data.includes(table))throw Error(`Required table data missing: ${table}`);
  if(!app.some(e=>e.kind==='FUNCTION'&&e.schema==='app_private'))throw Error('Private application functions are missing.');
  for(const table of data){const [schema,name]=table.split('.');identifier(schema);identifier(name);}
  return {app,auth,data};
}

export function emptyDestinationSQL(authTables,expectedMajor=17) {
  if(!Number.isInteger(expectedMajor)||expectedMajor<10||expectedMajor>99)throw Error('Invalid PostgreSQL major version.');
  const names=authTables.map(table=>{identifier(table);return literal(table);}).join(',');
  return `-- Must run first, inside the error-stopping restore transaction.
do $$
declare item text; populated boolean;
begin
  if current_setting('server_version_num')::integer / 10000 <> ${expectedMajor} then
    raise exception 'Destination must use PostgreSQL ${expectedMajor}';
  end if;
  if to_regnamespace('app_private') is not null or exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','f','m')
  ) then raise exception 'STOP: destination contains application objects. Use a NEW empty test project.'; end if;
  foreach item in array array[${names}]::text[] loop
    if to_regclass(format('%I.%I','auth',item)) is null then
      raise exception 'Destination Auth schema is missing table %. Stop and review platform compatibility.',item;
    end if;
    execute format('select exists(select 1 from %I.%I limit 1)','auth',item) into populated;
    if populated then raise exception 'STOP: destination Auth table % already contains data. Use a NEW empty test project.',item; end if;
  end loop;
end $$;
-- Explicit archive grants will restore access to each app object. Clear both
-- global and public-schema defaults so destination grants cannot add access
-- absent from the source dump, including execute on server-only invite RPCs.
alter default privileges revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
`;
}

export async function copyRowCounts(filename) {
  const counts={};let current=null;
  const lines=createInterface({input:createReadStream(filename),crlfDelay:Infinity});
  for await(const line of lines) {
    if(current) {
      if(line==='\\.')current=null;
      else {counts[current]++;if(!Number.isSafeInteger(counts[current]))throw Error('Row count exceeds supported range.');}
      continue;
    }
    if(!line.startsWith('COPY '))continue;
    const m=line.match(/^COPY "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"? \(.+\) FROM stdin;$/i);
    if(!m)throw Error('Unrecognised COPY header; stop for review.');
    current=`${m[1]}.${m[2]}`;
    if(Object.hasOwn(counts,current))throw Error(`Duplicate COPY section: ${current}`);
    counts[current]=0;
  }
  if(current)throw Error(`Incomplete COPY data: ${current}`);
  return counts;
}

export function countCheckSQL(counts) {
  const values=Object.entries(counts).map(([table,count])=>{
    const [schema,name]=table.split('.');identifier(schema);identifier(name);
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid expected row count.');
    return `(${literal(schema)},${literal(name)},${count}::bigint)`;
  });
  if(!values.length)throw Error('No archive row counts.');
  return `do $$
declare item record; actual bigint;
begin
  for item in select * from (values ${values.join(',\n')}) expected(schema_name,table_name,row_count) loop
    execute format('select count(*) from %I.%I',item.schema_name,item.table_name) into actual;
    if actual<>item.row_count then
      raise exception 'Restored row count differs: %.% expected %, found %',item.schema_name,item.table_name,item.row_count,actual;
    end if;
  end loop;
end $$;\n`;
}

export function readinessWithoutTransaction(sql) {
  return sql.replace(/^begin transaction read only;\s*$/m,'').replace(/^commit;\s*$/m,'');
}

export async function prepareNativeRestore(archive,pgBin) {
  archive=path.resolve(archive);
  const program=pgBin?path.join(pgBin,process.platform==='win32'?'pg_restore.exe':'pg_restore'):'pg_restore';
  const run=(args)=>{
    const result=spawnSync(program,args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
    if(result.error)throw result.error;
    if(result.status!==0)throw Error(`pg_restore failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  const toc=run(['--list',archive]);const plan=planArchive(toc);
  const output=await mkdtemp(path.join(path.dirname(archive),'restore-prepared-'));
  const outputFile=name=>path.join(output,name);
  await writeFile(outputFile('app.list'),plan.app.map(e=>e.line).join('\n')+'\n');
  await writeFile(outputFile('auth-data.list'),plan.auth.map(e=>e.line).join('\n')+'\n');
  for(const [file,section,auth] of [
    ['app-pre.sql','pre-data',false],['auth-data.sql','data',true],
    ['app-data.sql','data',false],['app-post.sql','post-data',false]
  ]) {
    run(['--no-owner','--no-tablespaces','--no-comments','--no-publications','--no-subscriptions',
      `--section=${section}`,`--use-list=${outputFile(auth?'auth-data.list':'app.list')}`,
      `--file=${outputFile(file)}`,archive]);
  }
  const counts={...await copyRowCounts(outputFile('auth-data.sql')),...await copyRowCounts(outputFile('app-data.sql'))};
  if(plan.data.some(table=>!Object.hasOwn(counts,table))||Object.keys(counts).length!==plan.data.length)throw Error('Extracted data does not match the archive table list.');
  const root=fileURLToPath(new URL('../',import.meta.url));
  await writeFile(outputFile('guard.sql'),emptyDestinationSQL(plan.auth.filter(e=>e.kind==='TABLE DATA').map(e=>e.name)));
  await writeFile(outputFile('check-counts.sql'),countCheckSQL(counts));
  await copyFile(path.join(root,'supabase/restore/auth_profile_trigger.sql'),outputFile('auth-profile-trigger.sql'));
  await writeFile(outputFile('readiness.sql'),readinessWithoutTransaction(await readFile(path.join(root,'supabase/checks/restore_readiness.sql'),'utf8')));
  await copyFile(path.join(root,'supabase/checks/backup_inventory.sql'),outputFile('backup_inventory.sql'));
  await writeFile(outputFile('restore.sql'),`-- Execute with psql -X --single-transaction --set ON_ERROR_STOP=1 --file this-file.
\\set ON_ERROR_STOP on
\\ir guard.sql
\\ir app-pre.sql
set session_replication_role=replica;
\\ir auth-data.sql
\\ir app-data.sql
set session_replication_role=origin;
\\ir app-post.sql
\\ir auth-profile-trigger.sql
\\ir check-counts.sql
\\ir readiness.sql
select 'PASS: restored archive row counts and application readiness checks' as result;
`);
  const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
  await writeFile(outputFile('archive-manifest.json'),JSON.stringify({format:1,archive:path.basename(archive),sha256:hash.digest('hex'),tables:counts},null,2)+'\n');
  return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const json=process.argv.includes('--json');
    const [archive,pgBin,...extra]=process.argv.slice(2).filter(arg=>arg!=='--json');
    if(!archive||extra.length)throw Error('Usage: node scripts/prepare-native-restore.mjs archive.dump [PostgreSQL-bin-directory]');
    const output=await prepareNativeRestore(archive,pgBin||(process.platform==='win32'?'C:\\Program Files\\PostgreSQL\\17\\bin':undefined));
    if(json)console.log(JSON.stringify({directory:output,restoreSQL:path.join(output,'restore.sql')}));
    else console.log(`Prepared: ${output}\nNo database connection was made. This folder includes private Auth/student SQL; keep it with your private backup.\nRestore only to a NEW empty test project, using psql --single-transaction --set ON_ERROR_STOP=1 --file "${path.join(output,'restore.sql')}".`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
