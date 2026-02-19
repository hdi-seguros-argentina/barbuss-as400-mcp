#!/usr/bin/env node
/**
 * Borra todos los datos del diccionario SVP (srvpgm y srvpgm_method).
 * Uso: node scripts/svp-dict-clear.mjs
 */
import { openDb, saveDb } from '../data/svp-dict-db.mjs';

const db = await openDb();
db.run('DELETE FROM srvpgm_method');
db.run('DELETE FROM srvpgm');
saveDb(db);
db.close();
console.log('OK: diccionario SVP vaciado (srvpgm y srvpgm_method).');
