import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,marker} from './adminFixture.js';
import {compareInventories} from '../scripts/compare-backups.mjs';

const sql=path=>readFile(new URL(`../supabase/${path}`,import.meta.url),'utf8');
export async function inventory(db) {
  const results=await db.exec(await sql('checks/backup_inventory.sql'));
  return JSON.parse(results.find(result=>result.rows?.[0]?.inventory).rows[0].inventory);
}

test('recovery checks detect lost records, leaked permissions and the omitted Auth trigger',async()=>{
  const {db,add,create,rpc}=await fixture();
  try {
    const readiness=await sql('checks/restore_readiness.sql');
    // The production Auth schema supplies this table; other fixtures only need auth.users.
    await db.exec('create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text)');
    await db.query("insert into auth.identities values($1,$2,'email')",[crypto.randomUUID(),marker]);
    const student=await add(2028,'Recovery student','1'),t=await create(2028);
    await rpc("app_save_test_score($1,$2,'12.25',0,$3)",[t,student,crypto.randomUUID()]);
    await db.exec(readiness);
    const original=await inventory(db);
    assert.equal(Object.keys(original.tables).length,24);
    assert.equal(original.tables['public.test_scores'].rows,1);
    assert.deepEqual(compareInventories(original,await inventory(db)),[]);
    await db.exec('delete from test_mark_history');
    assert.ok(compareInventories(original,await inventory(db)).some(message=>message.startsWith('public.test_mark_history:')));
    await db.exec('grant update on profiles to authenticated');
    await assert.rejects(()=>db.exec(readiness),/direct write access/);
    await db.exec('rollback;revoke update on profiles from authenticated;drop trigger physics_create_marker_profile on auth.users');
    await assert.rejects(()=>db.exec(readiness),/Missing or disabled trigger/);
    await db.exec('rollback');
    await db.exec(await sql('restore/auth_profile_trigger.sql'));
    await db.exec(readiness);
    assert.equal((await inventory(db)).application_schema_digest,original.application_schema_digest);
    const outsider=crypto.randomUUID();
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'uninvited@school.test','{\"role\":\"admin\"}')",[outsider]);
    const profile=(await db.query('select role,is_active from profiles where id=$1',[outsider])).rows[0];
    assert.deepEqual(profile,{role:'marker',is_active:false});
    const changed=structuredClone(original);changed.tables['public.test_scores'].digest='0'.repeat(32);
    assert.ok(compareInventories(original,changed).some(message=>message.startsWith('public.test_scores:')));
    delete changed.tables['public.account_invitations'];
    assert.ok(compareInventories(original,changed).some(message=>message.includes('table missing')));
    assert.throws(()=>compareInventories({},original),/inventory JSON/);
  } finally {await db.close();}
});
