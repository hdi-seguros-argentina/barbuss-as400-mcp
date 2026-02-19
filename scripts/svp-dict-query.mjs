#!/usr/bin/env node
/**
 * Consulta el diccionario SQLite de SVP (sql.js).
 * Uso:
 *   node scripts/svp-dict-query.mjs                    # lista todos los SRVPGM
 *   node scripts/svp-dict-query.mjs AXA.PGMR SPVSPO    # métodos de un SRVPGM
 *   node scripts/svp-dict-query.mjs GET                 # métodos que contengan GET
 */
import initSqlJs from 'sql.js';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'barbuss_svp.sqlite');

if (!existsSync(dbPath)) {
  console.error('No existe', dbPath, '- ejecutá: node data/init-svp-dict.mjs');
  process.exit(1);
}
const SQL = await initSqlJs({ locateFile: (file) => join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
const buf = readFileSync(dbPath);
const db = new SQL.Database(buf);

const [lib, srvpgm, pattern] = process.argv.slice(2);

if (!lib && !srvpgm && !pattern) {
  const r = db.exec('SELECT library, name, updated_at FROM srvpgm ORDER BY library, name');
  const rows = r.length ? r[0].values.map((row) => ({ library: row[0], name: row[1], updated_at: row[2] })) : [];
  console.log('SRVPGM en el diccionario:');
  console.table(rows);
  db.close();
  process.exit(0);
}

if (lib && srvpgm) {
  const stmt = db.prepare(
    'SELECT method_name, description FROM srvpgm_method WHERE library = ? AND srvpgm_name = ? ORDER BY method_name'
  );
  stmt.bind([lib, srvpgm]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  console.log(`Métodos de ${lib}/${srvpgm}:`);
  console.table(rows);
  db.close();
  process.exit(0);
}

if (pattern) {
  const like = `%${pattern}%`;
  const stmt = db.prepare(
    `SELECT library, srvpgm_name, method_name, description FROM srvpgm_method 
     WHERE method_name LIKE ? OR description LIKE ? ORDER BY library, srvpgm_name, method_name`
  );
  stmt.bind([like, like]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  console.log(`Métodos que contienen "${pattern}":`);
  console.table(rows);
  db.close();
  process.exit(0);
}

db.close();
