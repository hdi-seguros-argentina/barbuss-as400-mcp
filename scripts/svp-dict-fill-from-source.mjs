#!/usr/bin/env node
/**
 * Rellena descripciones en el diccionario SVP desde el fuente RPG.
 * Lee el fuente por stdin (comentarios encima de DCL-PROC ... EXPORT o P name B EXPORT).
 *
 * Uso:
 *   node scripts/svp-dict-fill-from-source.mjs <LIBRERÍA> <SRVPGM> [< archivo_fuente.txt]
 *   (sin archivo: lee stdin; podés pegar el fuente o usar pipe)
 *
 * Ejemplo tras leer el miembro en AS400 (p.ej. con MCP read_source_member):
 *   node scripts/svp-dict-fill-from-source.mjs AXA.PGMR SPVSPO < SPVSPO.src
 */
import { openDb, updateDescriptionsFromSource } from '../data/svp-dict-db.mjs';
import { createInterface } from 'readline';

const [library, srvpgmName] = process.argv.slice(2);
if (!library || !srvpgmName) {
  console.error('Uso: node scripts/svp-dict-fill-from-source.mjs <LIBRERÍA> <SRVPGM> [< fuente.txt]');
  process.exit(1);
}

async function readStdin() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

const sourceText = await readStdin();
if (!sourceText.trim()) {
  console.error('No se recibió fuente por stdin.');
  process.exit(1);
}

const db = await openDb();
const count = updateDescriptionsFromSource(db, library, srvpgmName, sourceText);
db.close();
console.log(`OK: ${count} descripciones actualizadas desde el fuente para ${library}/${srvpgmName}.`);
