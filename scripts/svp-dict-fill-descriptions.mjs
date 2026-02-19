#!/usr/bin/env node
/**
 * Rellena la columna description en srvpgm_method infiriendo desde el nombre del método.
 * Uso: node scripts/svp-dict-fill-descriptions.mjs [library] [srvpgm_name]
 * Si no se pasan argumentos, actualiza todos los SRVPGM en la base.
 */
import { openDb, updateDescriptionsFromNames, querySrvpgmList, getDbPath } from '../data/svp-dict-db.mjs';
import { existsSync } from 'fs';

const dbPath = getDbPath();
if (!existsSync(dbPath)) {
  console.error('No existe', dbPath);
  process.exit(1);
}

const db = await openDb();
const args = process.argv.slice(2);
const force = args.includes('--force');
const [lib, srvpgm] = args.filter((a) => a !== '--force');

if (lib && srvpgm) {
  const count = updateDescriptionsFromNames(db, lib, srvpgm, force);
  console.log(`OK: ${count} descripciones actualizadas para ${lib}/${srvpgm}`);
} else {
  const list = querySrvpgmList(db);
  let total = 0;
  for (const row of list) {
    const count = updateDescriptionsFromNames(db, row.library, row.name, force);
    if (count > 0) {
      console.log(`${row.library}/${row.name}: ${count} descripciones`);
      total += count;
    }
  }
  console.log(`OK: ${total} descripciones en total`);
}
db.close();
