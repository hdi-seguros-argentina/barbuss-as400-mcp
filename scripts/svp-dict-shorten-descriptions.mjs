#!/usr/bin/env node
/**
 * Acorta descripciones que son bloques largos (ej. SVPCOA con "-------- // método(): ...").
 * Solo actualiza las que tienen más de 200 chars y empiezan con guiones.
 * Uso: node scripts/svp-dict-shorten-descriptions.mjs [library] [srvpgm_name]
 */
import { openDb, getDbPath, saveDb, shortenBlockDescription } from '../data/svp-dict-db.mjs';
import { existsSync } from 'fs';

const dbPath = getDbPath();
if (!existsSync(dbPath)) {
  console.error('No existe', dbPath);
  process.exit(1);
}

const db = await openDb();
const [lib, srvpgm] = process.argv.slice(2);

let sql = "SELECT library, srvpgm_name, method_name, description FROM srvpgm_method WHERE description LIKE '-%' OR description LIKE '//%'";
const params = [];
if (lib && srvpgm) {
  sql += ' AND library = ? AND srvpgm_name = ?';
  params.push(lib, srvpgm);
}
const stmt = db.prepare(sql);
stmt.bind(params);
const rows = [];
while (stmt.step()) rows.push(stmt.getAsObject());
stmt.free();

const updateStmt = db.prepare('UPDATE srvpgm_method SET description = ? WHERE library = ? AND srvpgm_name = ? AND method_name = ?');
let count = 0;
for (const row of rows) {
  const short = shortenBlockDescription(row.description);
  if (short && short !== row.description) {
    updateStmt.run([short, row.library, row.srvpgm_name, row.method_name]);
    count++;
  }
}
updateStmt.free();
saveDb(db);
db.close();

console.log(`OK: ${count} descripciones acortadas.`);
