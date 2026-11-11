import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function compareInventories(before, after) {
  for (const inventory of [before,after]) {
    if (inventory?.format!==1 || !inventory.tables || !Object.keys(inventory.tables).length
        || !/^[a-f0-9]{32}$/.test(inventory.application_schema_digest || '')) {
      throw Error('Choose inventory JSON files produced by supabase/checks/backup_inventory.sql.');
    }
    for (const [name,table] of Object.entries(inventory.tables)) {
      if (!Number.isSafeInteger(table?.rows) || table.rows<0 || !/^[a-f0-9]{32}$/.test(table.digest || '')) {
        throw Error(`Invalid inventory entry: ${name}`);
      }
    }
  }
  const changes=[];
  for (const name of [...new Set([...Object.keys(before.tables),...Object.keys(after.tables)])].sort()) {
    const old=before.tables[name],current=after.tables[name];
    if (!old || !current) changes.push(`${name}: table missing from ${old?'second':'first'} inventory`);
    else if (old.rows!==current.rows || old.digest!==current.digest) {
      changes.push(`${name}: data differs (${old.rows} → ${current.rows} rows)`);
    }
  }
  if (before.application_schema_digest!==after.application_schema_digest) {
    changes.push('Application schema, policies, triggers or permissions differ');
  }
  return changes;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const paths=process.argv.slice(2);
    if(paths.length!==2) throw Error('Usage: node scripts/compare-backups.mjs before.json after.json');
    const inventories=await Promise.all(paths.map(async path=>JSON.parse(await readFile(path,'utf8'))));
    const changes=compareInventories(...inventories);
    if(changes.length) { console.error(changes.join('\n')); process.exitCode=1; }
    else console.log(`MATCH: ${Object.keys(inventories[0].tables).length} tables and application schema. Run restore_readiness.sql and the browser checks before switching production.`);
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
