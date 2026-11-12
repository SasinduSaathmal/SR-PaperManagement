import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const admin='00000000-0000-0000-0000-000000000001',otherAdmin='00000000-0000-0000-0000-000000000002',marker='00000000-0000-0000-0000-000000000003',second='00000000-0000-0000-0000-000000000004';
export async function fixture(){
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create function auth.role() returns text language sql stable as $$select current_setting('test.jwt_role',true)$$;
   grant usage on schema auth to authenticated,service_role;
   create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}',invited_at timestamptz,created_at timestamptz default now());
   insert into auth.users(id,email,raw_user_meta_data) values('${admin}','admin@school.test','{"display_name":"Admin"}'),('${otherAdmin}','other@school.test','{"display_name":"Other admin"}'),('${marker}','marker@school.test','{"display_name":"Marker"}'),('${second}','second@school.test','{"display_name":"Second"}');
   set test.uid='${admin}';set test.jwt_role='authenticated';`);
  const files=['001_account_profiles.sql','002_shared_students.sql','003_student_management.sql','004_shared_test_marks.sql','005_import_remove_export.sql','006_online_import_reports.sql','007_zero_fill_empty_batches.sql','008_online_date_recovery.sql','009_trial_data_cleanup.sql','010_student_identity.sql','011_account_administration.sql','012_test_participants.sql','013_student_records_schools.sql'];
  for(const f of files){const sql=(await readFile(new URL(`../supabase/${f}`,import.meta.url),'utf8')).replaceAll('REPLACE_WITH_YOUR_LOGIN_EMAIL','admin@school.test');await db.exec(sql);}
  await db.query("update profiles set role='admin' where id=$1",[otherAdmin]);
  const rpc=async(sql,args=[])=>(await db.query(`select ${sql} as result`,args)).rows[0].result;
  const groups=(await db.query('select id,exam_year from exam_groups')).rows;
  const group=year=>groups.find(g=>g.exam_year===year).id;
  const uid=id=>db.exec(`set test.uid='${id}'`);
  const add=async(year,name,code='')=>(await rpc("app_add_student($1,$2,'School','Maths',$3,$4)",[group(year),name,code,crypto.randomUUID()])).id;
  const create=async(year,paper=1,participants=[admin,marker])=>(await rpc("app_create_marks_test($1,'Phase 1',$2,'2026-11-11','40',$3,$4)",[group(year),paper,participants,crypto.randomUUID()])).id;
  return {db,rpc,group,uid,add,create};
 }catch(e){await db.close();throw e;}
}
