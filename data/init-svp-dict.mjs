#!/usr/bin/env node
/**
 * Inicializa la base SQLite del diccionario de service programs (sql.js).
 * Uso: node data/init-svp-dict.mjs
 * Crea data/barbuss_svp.sqlite con tablas srvpgm y srvpgm_method.
 */
import initSqlJs from 'sql.js';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'barbuss_svp.sqlite');

const SQL = await initSqlJs({ locateFile: (file) => join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
const db = new SQL.Database();

db.run(`
  CREATE TABLE IF NOT EXISTS srvpgm (
    library TEXT NOT NULL,
    name TEXT NOT NULL,
    source_file TEXT DEFAULT 'QFUENTES',
    notes TEXT,
    updated_at TEXT,
    PRIMARY KEY (library, name)
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS srvpgm_method (
    library TEXT NOT NULL,
    srvpgm_name TEXT NOT NULL,
    method_name TEXT NOT NULL,
    description TEXT,
    PRIMARY KEY (library, srvpgm_name, method_name)
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_srvpgm_method_lib_name ON srvpgm_method(library, srvpgm_name)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_srvpgm_method_name ON srvpgm_method(method_name)`);

const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(dbPath, Buffer.from(db.export()));
db.close();

console.log('OK: Base creada en', dbPath);
