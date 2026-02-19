/**
 * Acceso a la base SQLite del diccionario SVP (sql.js, sin deps nativas).
 * Ruta: data/barbuss_svp.sqlite (relativa al cwd del proceso).
 */
import initSqlJs from 'sql.js';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let SQL = null;
async function getSQL() {
  if (SQL) return SQL;
  SQL = await initSqlJs({ locateFile: (file) => join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
  return SQL;
}

export function getDbPath() {
  return join(process.cwd(), 'data', 'barbuss_svp.sqlite');
}

function rowsToObjects(columns, values) {
  return (values || []).map((row) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

export async function openDb() {
  const path = getDbPath();
  const sql = await getSQL();
  let db;
  if (existsSync(path)) {
    const buf = readFileSync(path);
    db = new sql.Database(buf);
  } else {
    db = new sql.Database();
    ensureSchema(db);
    saveDb(db);
  }
  ensureSchema(db);
  return db;
}

export function saveDb(db) {
  const path = getDbPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = db.export();
  writeFileSync(path, Buffer.from(data));
}

function ensureSchema(db) {
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
}

export function querySrvpgmList(db) {
  const r = db.exec('SELECT library, name, updated_at FROM srvpgm ORDER BY library, name');
  return r.length ? rowsToObjects(r[0].columns, r[0].values) : [];
}

export function queryMethods(db, library, srvpgmName) {
  const stmt = db.prepare(
    'SELECT method_name, description FROM srvpgm_method WHERE library = ? AND srvpgm_name = ? ORDER BY method_name'
  );
  stmt.bind([library, srvpgmName]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function queryMethodsByPattern(db, pattern) {
  const like = `%${pattern}%`;
  const stmt = db.prepare(
    `SELECT library, srvpgm_name, method_name, description FROM srvpgm_method 
     WHERE method_name LIKE ? OR description LIKE ? ORDER BY library, srvpgm_name, method_name`
  );
  stmt.bind([like, like]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function syncFromExportText(db, library, srvpgmName, exportText) {
  const escaped = srvpgmName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b(${escaped}_[A-Z0-9]+)\\b`, 'g');
  const methods = new Set();
  for (const line of exportText.split(/\r?\n/)) {
    let m;
    while ((m = regex.exec(line)) !== null) methods.add(m[1]);
  }
  db.run("INSERT OR REPLACE INTO srvpgm (library, name, updated_at) VALUES (?, ?, datetime('now'))", [
    library,
    srvpgmName,
  ]);
  db.run('DELETE FROM srvpgm_method WHERE library = ? AND srvpgm_name = ?', [library, srvpgmName]);
  for (const methodName of [...methods].sort()) {
    db.run(
      'INSERT INTO srvpgm_method (library, srvpgm_name, method_name, description) VALUES (?, ?, ?, ?)',
      [library, srvpgmName, methodName, null]
    );
  }
  saveDb(db);
  return methods.size;
}

/**
 * Infiere una descripción breve en español a partir del nombre del método (ej. SPVSPO_GETCABECERA -> "Obtiene cabecera").
 */
function inferDescriptionFromMethodName(methodName) {
  const name = methodName.replace(/^[A-Z0-9]+_/, ''); // quitar prefijo SPVSPO_
  if (!name) return null;
  const map = {
    CHK: 'Verifica',
    GET: 'Obtiene',
    SET: 'Establece',
    UPD: 'Actualiza',
    UPDC: 'Actualiza',
    DLT: 'Elimina',
    IS: 'Indica si',
    INZ: 'Inicialización',
    END: 'Fin',
    ERROR: 'Error',
    ANULA: 'Anula',
    CUOTAS: 'Cuotas',
    PENDPROC: 'Pendiente proceso',
    ULTSEC: 'Última secuencia',
  };
  let prefix = name.slice(0, 3);
  if (prefix === 'UPD' && name.length > 3) prefix = 'UPD';
  let verb = map[name.slice(0, 3)];
  if (!verb && name.startsWith('UPD')) verb = 'Actualiza';
  if (!verb && name.startsWith('ANULA')) verb = 'Anula';
  if (!verb && name.startsWith('IS')) verb = 'Indica si';
  if (!verb && name.startsWith('ULTSEC')) verb = 'Última secuencia';
  if (!verb && name.startsWith('PEND')) verb = 'Pendiente';
  if (!verb && name.startsWith('TIENE')) verb = 'Indica si tiene';
  const rest = name.replace(/^(CHK|GET|SET|UPD|DLT|IS|INZ|ANULA|ANULAARREPENPROCESO|ULTSEC|PEND|TIENE)/i, '').toLowerCase();
  if (verb && rest) return `${verb} ${rest}`;
  if (verb) return verb;
  return name.toLowerCase() || null;
}

/**
 * Rellena la columna description para todos los métodos de un SRVPGM que tengan description NULL,
 * infiriendo desde el nombre del método.
 */
export function updateDescriptionsFromNames(db, library, srvpgmName, forceAll = false) {
  const cond = forceAll ? '' : ' AND (description IS NULL OR description = "")';
  const stmt = db.prepare(
    `SELECT method_name FROM srvpgm_method WHERE library = ? AND srvpgm_name = ? ${cond}`.trim()
  );
  stmt.bind([library, srvpgmName]);
  const toUpdate = [];
  while (stmt.step()) toUpdate.push(stmt.getAsObject().method_name);
  stmt.free();
  const updateStmt = db.prepare('UPDATE srvpgm_method SET description = ? WHERE library = ? AND srvpgm_name = ? AND method_name = ?');
  let count = 0;
  for (const methodName of toUpdate) {
    const desc = inferDescriptionFromMethodName(methodName);
    if (desc) {
      updateStmt.run([desc, library, srvpgmName, methodName]);
      count++;
    }
  }
  updateStmt.free();
  saveDb(db);
  return count;
}

/** Acorta descripción tipo bloque "-------- // método(): texto // ..." a una línea (máx 280 chars). */
export function shortenBlockDescription(desc) {
  if (!desc) return desc;
  const needsShorten = desc.trimStart().startsWith('-') || desc.trimStart().startsWith('//');
  if (!needsShorten && desc.length <= 280) return desc;
  const noDashes = desc.replace(/^-+\s*/, '').replace(/^\/\/\s*/, '').trim();
  const m = noDashes.match(/\):\s*([^\/]+?)(?:\s*\/\/|$)/);
  if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 280);
  const parts = noDashes.split(/\s*\/\/\s*/).map((p) => p.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const one = (parts[0] || noDashes).slice(0, 280);
  return one.length >= 278 ? one.slice(0, 277) + '...' : one;
}

/**
 * Parsea fuente RPG y extrae descripciones.
 * Prioridad 1: Líneas con formato "MethodName : Descripción literal" (ej. en SEU, * SVPSIN_chgEstadosReclamo : Cambia Estados del Reclamo).
 * Prioridad 2: Comentarios encima de DCL-PROC ... EXPORT o P name B EXPORT.
 */
export function parseSourceDescriptions(sourceText, methodNames) {
  const lines = (sourceText || '').split(/\r?\n/);
  const result = new Map();
  const methodSet = new Set(methodNames);

  function commentContent(line) {
    const t = line.trim();
    if (!t) return '';
    if (t.startsWith('//')) return t.slice(2).trim();
    if (t.startsWith('**')) return t.slice(2).trim();
    if (line.length >= 7 && line[6] === '*') return line.slice(7).trim();
    return '';
  }

  function isComment(line) {
    const t = line.trim();
    if (!t) return false;
    if (t.startsWith('//') || t.startsWith('**')) return true;
    if (line.length >= 7 && line[6] === '*') return true; // fixed format col 7
    return false;
  }

  // Detecta si el texto de un comentario es cabecera de otro método (MethodName(): o MethodName :)
  function isMethodHeaderComment(content) {
    if (!content || !content.trim()) return false;
    for (const m of methodNames) {
      const re = new RegExp(`^\\s*${escapeRe(m)}\\s*\\(\\)?\\s*:`, 'i');
      if (re.test(content)) return true;
    }
    return false;
  }

  function trimCommentLine(s) {
    return s.replace(/\s*\*+\s*$/, '').trim();
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Pasada 1: "MethodName : Descripción" o "methodName(): Descripción"; en AS400 la descripción sigue en líneas debajo
  for (let i = 0; i < lines.length; i++) {
    const content = commentContent(lines[i]);
    if (!content) continue;
    for (const m of methodNames) {
      if (result.has(m)) continue;
      const re = new RegExp(`^\\s*${escapeRe(m)}\\s*\\(\\)?\\s*:\\s*(.+)$`, 'i');
      const match = content.match(re);
      if (!match) continue;
      let desc = trimCommentLine(match[1]);
      // Continuación en AS400: siguientes líneas de comentario que no son cabecera de otro método
      let j = i + 1;
      while (j < lines.length && isComment(lines[j])) {
        const nextContent = commentContent(lines[j]);
        const nextTrimmed = nextContent ? trimCommentLine(nextContent) : '';
        if (!nextTrimmed) { j++; continue; }
        if (isMethodHeaderComment(nextTrimmed)) break;
        desc = (desc + ' ' + nextTrimmed).trim();
        j++;
      }
      result.set(m, desc);
      break;
    }
  }

  function extractProcNameFromLine(line) {
    const t = line.trim();
    // Free: DCL-PROC nombre EXPORT; o nombre(...) EXPORT
    let m = t.match(/DCL-PROC\s+(\w+)\s+/i) || t.match(/\b(\w+)\s+.*EXPORT/i);
    if (m) return m[1].toUpperCase();
    // Fixed: P nombre B EXPORT
    m = t.match(/^\s*P\s+(\w+)\s+.*EXPORT/i);
    if (m) return m[1].toUpperCase();
    return null;
  }

  function matchToExportName(procName) {
    if (methodSet.has(procName)) return procName;
    for (const full of methodNames) {
      if (full === procName) return full;
      if (full.endsWith('_' + procName)) return full;
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const procName = extractProcNameFromLine(lines[i]);
    if (!procName) continue;
    const exportName = matchToExportName(procName);
    if (!exportName) continue;
    const comments = [];
    let j = i - 1;
    while (j >= 0 && (isComment(lines[j]) || lines[j].trim() === '')) {
      if (lines[j].trim() !== '') {
        const c = lines[j].trim().replace(/^\/\/\s*/, '').replace(/^\*\*\s*/, '').replace(/^\*\s*/, '').trim();
        if (c && !/^[-*\s\/]+$/.test(c)) comments.unshift(c);
      }
      j--;
    }
    let desc = comments.join(' ').replace(/\s+/g, ' ').trim();
    if (desc) {
      desc = shortenBlockDescription(desc); // exported above
      if (desc && !result.has(exportName)) result.set(exportName, desc);
    }
  }

  return result;
}

/**
 * Actualiza la columna description desde el fuente RPG: lee comentarios
 * encima de cada procedimiento exportado y los guarda en srvpgm_method.
 * sourceText = contenido del miembro (ej. de read_source_member).
 * source_file = archivo de fuente (ej. QFUENTES); el miembro se asume igual a srvpgmName.
 */
export function updateDescriptionsFromSource(db, library, srvpgmName, sourceText) {
  const stmt = db.prepare('SELECT method_name FROM srvpgm_method WHERE library = ? AND srvpgm_name = ?');
  stmt.bind([library, srvpgmName]);
  const methodNames = [];
  while (stmt.step()) methodNames.push(stmt.getAsObject().method_name);
  stmt.free();
  if (methodNames.length === 0) return 0;
  const descriptions = parseSourceDescriptions(sourceText, methodNames);
  const updateStmt = db.prepare('UPDATE srvpgm_method SET description = ? WHERE library = ? AND srvpgm_name = ? AND method_name = ?');
  let count = 0;
  for (const [methodName, desc] of descriptions) {
    updateStmt.run([desc, library, srvpgmName, methodName]);
    count++;
  }
  updateStmt.free();
  saveDb(db);
  return count;
}
