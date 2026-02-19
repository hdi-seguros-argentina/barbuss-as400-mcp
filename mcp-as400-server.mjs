#!/usr/bin/env node
/**
 * MCP server for AS400: exec (shell) + query (SQL via DB2).
 * Usage: node mcp-as400-server.mjs --host=HOST --user=USER [--password=PASS | --key=path/to/key] [--port=22] [--timeout=60000]
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Client } from 'ssh2';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgv() {
  const args = process.argv.slice(2);
  const config = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) config[arg.slice(2)] = null;
      else config[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return config;
}

const argv = parseArgv();
const HOST = argv.host;
const PORT = argv.port ? parseInt(argv.port, 10) : 22;
const USER = argv.user;
const PASSWORD = argv.password;
const KEY = argv.key;
const TIMEOUT_MS = argv.timeout ? parseInt(argv.timeout, 10) : 60000;

function runSshCommand(sshConfig, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const t = setTimeout(() => {
      conn.end();
      reject(new McpError(ErrorCode.InternalError, `Command timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(t);
          conn.end();
          reject(new McpError(ErrorCode.InternalError, `Exec error: ${err.message}`));
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          clearTimeout(t);
          conn.end();
          if (code !== 0 && stderr) {
            reject(new McpError(ErrorCode.InternalError, `Exit ${code}:\n${stderr}`));
          } else {
            resolve({ content: [{ type: 'text', text: stdout || '\n' }] });
          }
        });
      });
    });
    conn.on('error', (err) => {
      clearTimeout(t);
      reject(new McpError(ErrorCode.InternalError, `SSH error: ${err.message}`));
    });
    conn.connect(sshConfig);
  });
}

async function getConfig() {
  if (!HOST || !USER) throw new McpError(ErrorCode.InvalidParams, 'Missing --host or --user');
  const cfg = { host: HOST, port: PORT, username: USER };
  if (PASSWORD) cfg.password = PASSWORD;
  else if (KEY) cfg.privateKey = await readFile(KEY, 'utf8');
  return cfg;
}

const server = new McpServer({
  name: 'AS400 MCP Server',
  version: '1.0.0',
  capabilities: { tools: {} },
});

// Tool: exec — run shell command
server.tool(
  'exec',
  'Execute a shell command on the AS400 (SSH).',
  {
    command: z.string().describe('Shell command to run on the remote server'),
  },
  async ({ command }) => {
    const cmd = (command || '').trim();
    if (!cmd) throw new McpError(ErrorCode.InvalidParams, 'Command cannot be empty');
    const sshConfig = await getConfig();
    return runSshCommand(sshConfig, cmd);
  }
);

function runQuery(sshConfig, sql) {
  const statement = (sql || '').trim();
  if (!statement) throw new McpError(ErrorCode.InvalidParams, 'SQL cannot be empty');
  const escaped = statement.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const command = `qsh -c "db2 \\"${escaped}\\""`;
  return runSshCommand(sshConfig, command);
}

// Tool: query — run SQL on DB2 (IBM i)
server.tool(
  'query',
  'Run a SQL query on the AS400 (DB2 for i). Returns result set as text.',
  {
    sql: z.string().describe('SQL statement to execute (e.g. SELECT * FROM schema.table)'),
  },
  async ({ sql }) => {
    const sshConfig = await getConfig();
    return runQuery(sshConfig, sql);
  }
);

// Tool: describe_table — columnas de una tabla desde QSYS2.SYSCOLUMNS
server.tool(
  'describe_table',
  'Return column list (name, position, type, length) for a table. Uses QSYS2.SYSCOLUMNS. Accepts any library and table: personal, AXAREAL, PEDS_0002, etc.',
  {
    schema: z.string().describe('Library/schema (any: AXAREAL, PEDS_0002, personal library, etc.)'),
    table: z.string().describe('Table/physical file name (e.g. PAHSEW, SET485)'),
  },
  async ({ schema, table }) => {
    const sql = `SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}' ORDER BY ORDINAL_POSITION`;
    const sshConfig = await getConfig();
    return runQuery(sshConfig, sql);
  }
);

// Tool: list_tables — tablas/archivos en una biblioteca desde QSYS2.SYSTABLES
server.tool(
  'list_tables',
  'List tables (physical files) in a library/schema. Uses QSYS2.SYSTABLES. Accepts any library: personal, AXAREAL, AXA.FILE, QUOMDATA, etc. Optional limit.',
  {
    schema: z.string().describe('Library/schema (any: personal, AXAREAL, PEDS_0002, AXA.FILE, etc.)'),
    limit: z.number().optional().describe('Max rows to return (default 500)'),
  },
  async ({ schema, limit = 500 }) => {
    const safeSchema = schema.replace(/'/g, "''");
    const sql = `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = '${safeSchema}' ORDER BY TABLE_NAME FETCH FIRST ${Math.max(1, Math.min(limit, 5000))} ROWS ONLY`;
    const sshConfig = await getConfig();
    return runQuery(sshConfig, sql);
  }
);

// Tool: find_table — buscar tabla por nombre en todas las bibliotecas
server.tool(
  'find_table',
  'Search for a table by name (or pattern) across all libraries. Returns TABLE_SCHEMA and TABLE_NAME. Uses QSYS2.SYSTABLES. Useful to find which library has the object when you only know the table name (e.g. PAHSEW).',
  {
    pattern: z.string().describe('Table name or partial name (e.g. PAHSEW, %AXA%)'),
    limit: z.number().optional().describe('Max rows to return (default 100)'),
  },
  async ({ pattern, limit = 100 }) => {
    const like = pattern.includes('%') ? pattern : `%${pattern}%`;
    const safeLike = like.replace(/'/g, "''");
    const sql = `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_NAME LIKE '${safeLike}' ORDER BY TABLE_SCHEMA, TABLE_NAME FETCH FIRST ${Math.max(1, Math.min(limit, 1000))} ROWS ONLY`;
    const sshConfig = await getConfig();
    return runQuery(sshConfig, sql);
  }
);

// Tool: list_file_members — listar miembros de un archivo físico (cualquier biblioteca/archivo)
server.tool(
  'list_file_members',
  'List members of any physical file. Uses DSPFD TYPE(*MBRLIST) to OUTFILE then SELECT. You choose library and file: e.g. AXA.PGMR/QFUENTES (programs), AXA.FILE/QGCTAALL (DDS), or your personal library and any source file (QFUENTES, QCLSRC, QRPGLESRC, etc.). output_library = any library where you have write authority (e.g. INF1LUIS or your personal lib).',
  {
    library: z.string().describe('Library containing the file (any: AXA.PGMR, AXA.FILE, personal, etc.)'),
    file: z.string().describe('Physical file name (e.g. QFUENTES, QGCTAALL, QCLSRC, QRPGLESRC)'),
    output_library: z.string().describe('Library for DSPFD OUTFILE; must have write authority (e.g. INF1LUIS or your personal library)'),
  },
  async ({ library, file, output_library }) => {
    const sshConfig = await getConfig();
    const clCmd = `DSPFD FILE(${library}/${file}) TYPE(*MBRLIST) OUTPUT(*OUTFILE) OUTFILE(${output_library}/MBRLIST)`;
    const qshCmd = `qsh -c 'system \"${clCmd.replace(/"/g, '\\"')}\"'`;
    await runSshCommand(sshConfig, qshCmd);
    const sql = `SELECT MBMEMBER FROM ${output_library}.MBRLIST ORDER BY MBMEMBER`;
    return runQuery(sshConfig, sql);
  }
);

// Tool: table_dependents — dependientes de un archivo (lógicos, programas que lo usan). DSPDBR + SELECT.
server.tool(
  'table_dependents',
  'List dependents of a physical file: logical files (views/joins over it) and programs that use it. Uses DSPDBR OUTPUT(*OUTFILE) then query. output_library must have write authority (e.g. personal library). Returns file/library/type for each dependent.',
  {
    library: z.string().describe('Library of the physical file (e.g. AXAREAL, AXA.FILE)'),
    file: z.string().describe('Physical file / table name'),
    output_library: z.string().describe('Library for DSPDBR OUTFILE (must have write, e.g. personal library)'),
  },
  async ({ library, file, output_library }) => {
    const sshConfig = await getConfig();
    const clCmd = `DSPDBR FILE(${library}/${file}) OUTPUT(*OUTFILE) OUTFILE(${output_library}/TMPDBR)`;
    const clEscaped = clCmd.replace(/'/g, "'\\''");
    const qshCmd = `qsh -c 'system "${clEscaped}"'`;
    await runSshCommand(sshConfig, qshCmd);
    const safeOut = output_library.replace(/'/g, "''");
    const sql = `SELECT * FROM ${safeOut}.TMPDBR`;
    return runQuery(sshConfig, sql);
  }
);

// Tool: program_references — archivos y objetos que usa un programa. DSPPGMREF + SELECT.
server.tool(
  'program_references',
  'List objects (files, programs, etc.) referenced by a program. Uses DSPPGMREF OUTPUT(*OUTFILE) then query. output_library must have write. Use to see input/output/update usage of files by a program.',
  {
    library: z.string().describe('Library of the program'),
    program: z.string().describe('Program name'),
    output_library: z.string().describe('Library for OUTFILE (must have write)'),
  },
  async ({ library, program, output_library }) => {
    const sshConfig = await getConfig();
    const clCmd = `DSPPGMREF PGM(${library}/${program}) OUTPUT(*OUTFILE) OUTFILE(${output_library}/TMPPGR)`;
    const clEscaped = clCmd.replace(/'/g, "'\\''");
    const qshCmd = `qsh -c 'system "${clEscaped}"'`;
    await runSshCommand(sshConfig, qshCmd);
    const safeOut = output_library.replace(/'/g, "''");
    const sql = `SELECT * FROM ${safeOut}.TMPPGR`;
    return runQuery(sshConfig, sql);
  }
);

// Tool: list_srvpgm_exports — listar procedimientos exportados de un SRVPGM
server.tool(
  'list_srvpgm_exports',
  'List exported procedures of a service program. Uses QSYS2.PROGRAM_EXPORT_IMPORT_INFO (IBM i 7.3+). Accepts any library where the SRVPGM lives: QUOMDATA, personal library, etc.',
  {
    schema: z.string().describe('Library containing the SRVPGM (any: QUOMDATA, personal, etc.)'),
    srvpgm_name: z.string().describe('Service program name (e.g. SVPASE)'),
  },
  async ({ schema, srvpgm_name }) => {
    const safeSchema = schema.replace(/'/g, "''");
    const safeName = srvpgm_name.replace(/'/g, "''");
    // CHAR() evita error de conversión CCSID 1200/65535 en columnas de texto
    const sql = `SELECT PROGRAM_LIBRARY, PROGRAM_NAME, OBJECT_TYPE, TRIM(CHAR(SYMBOL_NAME)) AS SYMBOL_NAME, TRIM(CHAR(SYMBOL_USAGE)) AS SYMBOL_USAGE FROM QSYS2.PROGRAM_EXPORT_IMPORT_INFO WHERE PROGRAM_LIBRARY = '${safeSchema}' AND PROGRAM_NAME = '${safeName}' ORDER BY SYMBOL_NAME`;
    const sshConfig = await getConfig();
    return runQuery(sshConfig, sql);
  }
);

// --- Diccionario SQLite local (data/barbuss_svp.sqlite) ---
async function getSvpDict() {
  const mod = await import(pathToFileURL(join(__dirname, 'data', 'svp-dict-db.mjs')).href);
  return mod;
}

// Tool: svp_dict_query — consultar el diccionario local de SVP (SQLite)
server.tool(
  'svp_dict_query',
  'Query the local SVP dictionary (SQLite at data/barbuss_svp.sqlite). List all SRVPGMs, or methods of one SRVPGM, or search by method name pattern. No AS400 connection needed.',
  {
    library: z.string().optional().describe('Filter by library (e.g. AXA.PGMR)'),
    srvpgm_name: z.string().optional().describe('Filter by service program name (e.g. SPVSPO)'),
    method_pattern: z.string().optional().describe('Search methods containing this text'),
  },
  async ({ library, srvpgm_name, method_pattern }) => {
    try {
      const { openDb, querySrvpgmList, queryMethods, queryMethodsByPattern } = await getSvpDict();
      const db = await openDb();
    try {
      if (method_pattern) {
        const rows = queryMethodsByPattern(db, method_pattern);
        const text = rows.length ? rows.map(r => `${r.library}\t${r.srvpgm_name}\t${r.method_name}\t${r.description || ''}`).join('\n') : '(ninguno)';
        return { content: [{ type: 'text', text: `Métodos que contienen "${method_pattern}":\n${text}\nTotal: ${rows.length}` }] };
      }
      if (library && srvpgm_name) {
        const rows = queryMethods(db, library, srvpgm_name);
        const text = rows.length ? rows.map(r => `${r.method_name}\t${r.description || ''}`).join('\n') : '(ninguno)';
        return { content: [{ type: 'text', text: `Métodos de ${library}/${srvpgm_name}:\n${text}\nTotal: ${rows.length}` }] };
      }
      const rows = querySrvpgmList(db);
      const text = rows.length ? rows.map(r => `${r.library}\t${r.name}\t${r.updated_at}`).join('\n') : '(vacío; ejecutá svp_dict_sync primero)';
      return { content: [{ type: 'text', text: `SRVPGM en el diccionario:\n${text}\nTotal: ${rows.length}` }] };
    } finally {
      db.close();
    }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('sql.js') || msg.includes('Cannot find module')) {
        return { content: [{ type: 'text', text: 'Diccionario SQLite: ejecutá "npm install" (incluye sql.js). Luego opcional: node data/init-svp-dict.mjs' }] };
      }
      throw err;
    }
  }
);

// Tool: read_source_member — leer contenido de un miembro de fuente (CPYTOSTMF + cat)
server.tool(
  'read_source_member',
  'Read the contents of a source member from the AS400. Uses CPYTOSTMF to copy the member to IFS then cat. Use for AXA.PGMR/QFUENTES/SPVSPO etc. to parse procedure comments. Temp file: /tmp/srcread_<member>.txt (requires write to /tmp).',
  {
    library: z.string().describe('Library (e.g. AXA.PGMR)'),
    file: z.string().describe('Source physical file (e.g. QFUENTES)'),
    member: z.string().describe('Member name (e.g. SPVSPO)'),
  },
  async ({ library, file, member }) => {
    const sshConfig = await getConfig();
    const safe = (s) => s.replace(/[/\\'"]/g, '_');
    const stmf = `/tmp/srcread_${safe(member)}.txt`;
    const fromMbr = `/QSYS.LIB/${library}.LIB/${file}.FILE/${member}.MBR`;
    const cl = `CPYTOSTMF FROMMBR('${fromMbr}') TOSTMF('${stmf}') STMFOPT(*REPLACE)`;
    // Escapar comillas simples para que la shell no cierre la cadena de qsh -c '...'
    const clEscaped = cl.replace(/'/g, "'\\''");
    const qsh = `qsh -c 'system "${clEscaped}" && cat "${stmf}"'`;
    return runSshCommand(sshConfig, qsh);
  }
);

// Tool: svp_dict_fill_from_source — leer miembro de fuente en AS400, extraer descripciones de comentarios y actualizar SQLite
server.tool(
  'svp_dict_fill_from_source',
  'Read the source member for a service program from the AS400, parse procedure comments (lines above DCL-PROC ... EXPORT or P name B EXPORT), and update the local SQLite dictionary descriptions. Source file default QFUENTES, member = srvpgm name. Run svp_dict_sync first so methods exist.',
  {
    library: z.string().describe('Library of the SRVPGM and source file (e.g. AXA.PGMR)'),
    srvpgm_name: z.string().describe('Service program name (e.g. SPVSPO); source member is assumed to have this name'),
    source_file: z.string().optional().describe('Source physical file (default QFUENTES)'),
  },
  async ({ library, srvpgm_name, source_file = 'QFUENTES' }) => {
    try {
      const sshConfig = await getConfig();
      const safe = (s) => s.replace(/[/\\'"]/g, '_');
      const stmf = `/tmp/srcread_${safe(srvpgm_name)}.txt`;
      const fromMbr = `/QSYS.LIB/${library}.LIB/${source_file}.FILE/${srvpgm_name}.MBR`;
      const cl = `CPYTOSTMF FROMMBR('${fromMbr}') TOSTMF('${stmf}') STMFOPT(*REPLACE)`;
      const clEscaped = cl.replace(/'/g, "'\\''");
      const qsh = `qsh -c 'system "${clEscaped}" && cat "${stmf}"'`;
      const result = await runSshCommand(sshConfig, qsh);
      const sourceText = result.content?.[0]?.text || '';
      const { openDb, updateDescriptionsFromSource } = await getSvpDict();
      const db = await openDb();
      try {
        const count = updateDescriptionsFromSource(db, library, srvpgm_name, sourceText);
        return { content: [{ type: 'text', text: `OK: ${count} descripciones actualizadas desde el fuente (${library}/${source_file}/${srvpgm_name}). Los métodos sin comentario en el fuente no se modifican.` }] };
      } finally {
        db.close();
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('sql.js') || msg.includes('Cannot find module')) {
        return { content: [{ type: 'text', text: 'Diccionario SQLite: ejecutá "npm install" y node data/init-svp-dict.mjs' }] };
      }
      throw err;
    }
  }
);

// Tool: svp_dict_fill_from_source_all — rellenar descripciones desde el fuente para TODOS los SVP del diccionario
server.tool(
  'svp_dict_fill_from_source_all',
  'For every service program in the local SQLite dictionary (srvpgm table), read its source member from the AS400, parse procedure comments, and update method descriptions. Slow: ~10–30 s per SVP. Use when you want real descriptions for all methods at once.',
  {},
  async () => {
    try {
      const { openDb, querySrvpgmList, updateDescriptionsFromSource } = await getSvpDict();
      const db = await openDb();
      const list = querySrvpgmList(db);
      if (!list.length) {
        db.close();
        return { content: [{ type: 'text', text: 'No hay programas de servicio en el diccionario. Ejecutá svp_dict_sync para cada SVP primero.' }] };
      }
      const sshConfig = await getConfig();
      const safe = (s) => s.replace(/[/\\'"]/g, '_');
      const sourceFile = 'QFUENTES';
      const results = [];
      for (const row of list) {
        const { library, name: srvpgm_name } = row;
        try {
          const stmf = `/tmp/srcread_${safe(srvpgm_name)}.txt`;
          const fromMbr = `/QSYS.LIB/${library}.LIB/${sourceFile}.FILE/${srvpgm_name}.MBR`;
          const cl = `CPYTOSTMF FROMMBR('${fromMbr}') TOSTMF('${stmf}') STMFOPT(*REPLACE)`;
          const clEscaped = cl.replace(/'/g, "'\\''");
          const qsh = `qsh -c 'system "${clEscaped}" && cat "${stmf}"'`;
          const result = await runSshCommand(sshConfig, qsh);
          const sourceText = result.content?.[0]?.text || '';
          const count = updateDescriptionsFromSource(db, library, srvpgm_name, sourceText);
          results.push({ library, srvpgm_name, count });
        } catch (err) {
          results.push({ library, srvpgm_name, error: err.message || String(err) });
        }
      }
      db.close();
      const lines = results.map((r) => ('error' in r ? `${r.library}/${r.srvpgm_name}: ERROR ${r.error}` : `${r.library}/${r.srvpgm_name}: ${r.count} descripciones actualizadas`));
      return { content: [{ type: 'text', text: `svp_dict_fill_from_source_all terminado.\n${lines.join('\n')}` }] };
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('sql.js') || msg.includes('Cannot find module')) {
        return { content: [{ type: 'text', text: 'Diccionario SQLite: ejecutá "npm install" y node data/init-svp-dict.mjs' }] };
      }
      throw err;
    }
  }
);

// Tool: svp_dict_sync — traer exports de un SRVPGM desde AS400 y guardarlos en el diccionario SQLite
server.tool(
  'svp_dict_sync',
  'Fetch exported procedures of a service program from AS400 (same as list_srvpgm_exports) and save them into the local SQLite dictionary (data/barbuss_svp.sqlite). Run this to populate or update the dictionary.',
  {
    library: z.string().describe('Library containing the SRVPGM (e.g. AXA.PGMR, QUOMDATA)'),
    srvpgm_name: z.string().describe('Service program name (e.g. SPVSPO)'),
  },
  async ({ library, srvpgm_name }) => {
    try {
      const safeSchema = library.replace(/'/g, "''");
      const safeName = srvpgm_name.replace(/'/g, "''");
      const sql = `SELECT TRIM(CHAR(SYMBOL_NAME)) AS SYMBOL_NAME FROM QSYS2.PROGRAM_EXPORT_IMPORT_INFO WHERE PROGRAM_LIBRARY = '${safeSchema}' AND PROGRAM_NAME = '${safeName}' ORDER BY SYMBOL_NAME`;
      const sshConfig = await getConfig();
      const result = await runQuery(sshConfig, sql);
      const text = result.content?.[0]?.text || '';
      const { openDb, syncFromExportText } = await getSvpDict();
      const db = await openDb();
      try {
        const count = syncFromExportText(db, library, srvpgm_name, text);
        return { content: [{ type: 'text', text: `OK: ${count} métodos de ${library}/${srvpgm_name} guardados en el diccionario (data/barbuss_svp.sqlite).` }] };
      } finally {
        db.close();
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('sql.js') || msg.includes('Cannot find module')) {
        return { content: [{ type: 'text', text: 'Diccionario SQLite: ejecutá "npm install" (incluye sql.js). Luego opcional: node data/init-svp-dict.mjs' }] };
      }
      throw err;
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('AS400 MCP Server running (tools: exec, query, describe_table, list_tables, find_table, table_dependents, program_references, list_file_members, list_srvpgm_exports, read_source_member, svp_dict_fill_from_source, svp_dict_fill_from_source_all, svp_dict_query, svp_dict_sync)');
