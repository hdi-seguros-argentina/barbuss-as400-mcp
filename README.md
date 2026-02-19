# Barbuss – AS400 MCP y diccionario de service programs

Herramientas para trabajar con **IBM i (AS400)** desde Cursor/IA: servidor MCP (SSH + DB2), diccionario SQLite de service programs (SVP) y scripts para sincronizar métodos y descripciones desde el fuente.

---

## Requisitos

- **Node.js** 18+ (LTS recomendado)
- **npm** (incluido con Node)
- Acceso SSH al AS400 (usuario y contraseña o clave SSH)
- **Cursor** (o otro cliente MCP) para usar las herramientas desde el asistente

No se requiere instalar SQLite por separado: el proyecto usa **sql.js** (SQLite en WebAssembly) vía npm, sin binarios nativos.

---

## Instalación (paso a paso)

Cualquier persona o agente que clone el repo debe poder instalar todo sin credenciales en el código.

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/hdi-seguros-argentina/barbuss-as400-mcp.git
cd <nombre-del-repo>
npm install
```

Esto instala:

- **sql.js** – SQLite en memoria/archivo (sin compilación nativa)
- **@modelcontextprotocol/sdk** – servidor MCP
- **ssh2** – conexión SSH al AS400
- **zod** – validación de parámetros
- **xlsx** – (si se usa en otros scripts)

### 2. Crear la base SQLite del diccionario de SVP

```bash
npm run init-dict
```

Crea `data/barbuss_svp.sqlite` con las tablas `srvpgm` y `srvpgm_method`. Si no existe, el MCP también la crea al usar `svp_dict_sync` o `svp_dict_query`.

### 3. Configurar el MCP en Cursor (sin usuario ni contraseña en el repo)

**No** versiones usuario ni contraseña. Cada desarrollador configura su conexión en local.

1. Copiar el ejemplo de configuración:

   ```bash
   cp .cursor/mcp.json.example .cursor/mcp.json
   ```

2. Editar **`.cursor/mcp.json`** (este archivo no se sube a Git):

   - Reemplazar `TU_HOST_AS400` por el host del AS400 (ej. `softdesa` o IP).
   - Reemplazar `TU_USUARIO` por tu usuario de IBM i.
   - Añadir **autenticación** (una de las dos):
     - **Contraseña:** en `args` agregar `"--password=TU_CONTRASEÑA"`.
     - **Clave SSH:** en `args` agregar `"--key=RUTA_A_TU_CLAVE_PRIVADA"` (ej. `C:\\Users\\TuUsuario\\.ssh\\id_rsa` en Windows).

   Ejemplo con contraseña (solo en tu máquina, no subir):

   ```json
   {
     "mcpServers": {
       "as400": {
         "command": "node",
         "args": [
           "mcp-as400-server.mjs",
           "--host=softdesa",
           "--user=mi_usuario",
           "--port=22",
           "--timeout=60000",
           "--password=mi_contraseña"
         ]
       }
     }
   }
   ```

3. Reiniciar Cursor para que cargue el MCP.

---

## Uso del MCP (herramientas)

Con el servidor configurado, en Cursor podés pedir al asistente que use estas herramientas:

| Herramienta | Descripción |
|-------------|-------------|
| **exec** | Ejecutar un comando en el AS400 por SSH. |
| **query** | Ejecutar SQL en DB2 for i. |
| **describe_table** | Listar columnas de una tabla (schema + tabla). |
| **list_tables** | Listar tablas/archivos en una biblioteca. |
| **find_table** | Buscar tabla por nombre en todas las bibliotecas. |
| **table_dependents** | Dependientes de un archivo físico (DSPDBR): archivos lógicos (views/joins) y programas que usan esa tabla. Requiere `output_library` con escritura. |
| **program_references** | Objetos que usa un programa (DSPPGMREF): archivos (input/output/update), otros programas. Requiere `output_library` con escritura. |
| **list_file_members** | Listar miembros de un archivo físico (ej. QFUENTES). |
| **list_srvpgm_exports** | Listar procedimientos exportados de un service program. |
| **read_source_member** | Leer el contenido de un miembro de fuente (CPYTOSTMF + cat). |
| **svp_dict_sync** | Traer exports de un SVP desde AS400 y guardarlos en el SQLite. |
| **svp_dict_fill_from_source** | Leer el fuente del SVP en AS400, extraer descripciones (formato `MethodName : Descripción` o comentarios encima de EXPORT) y actualizar el SQLite. ~10–30 s por SVP. |
| **svp_dict_query** | Consultar el diccionario SQLite (sin conexión AS400). |

---

## Diccionario de service programs (SQLite)

- **Ubicación:** `data/barbuss_svp.sqlite`
- **Tablas:** `srvpgm` (library, name, source_file, notes, updated_at), `srvpgm_method` (library, srvpgm_name, method_name, description).

### Flujo típico

1. **Poblar métodos desde AS400:** usar en Cursor la herramienta **svp_dict_sync**(library, srvpgm_name), por ejemplo `AXA.PGMR` y `SPVSPO`.
2. **Descripciones desde el fuente:** **svp_dict_fill_from_source**(library, srvpgm_name) lee el miembro en AS400 y extrae descripciones de: (a) líneas con formato `MethodName : Descripción literal` (ej. en SEU), (b) comentarios encima de `DCL-PROC ... EXPORT` o `P name B EXPORT`. Tarda ~10–30 s por SVP; el skill indica al asistente que ofrezca esta opción y avise el tiempo si el usuario acepta.
3. **Descripciones inferidas por nombre:** si no hay comentarios en el fuente, podés ejecutar localmente `npm run fill-descriptions -- AXA.PGMR SPVSPO` (opción `--force` para reemplazar todas).

### Scripts por línea de comandos (sin Cursor)

```bash
# Listar SRVPGM en el diccionario
node scripts/svp-dict-query.mjs

# Listar métodos de un SVP
node scripts/svp-dict-query.mjs AXA.PGMR SPVSPO

# Buscar métodos por texto
node scripts/svp-dict-query.mjs GET

# Rellenar descripciones inferidas (CHK→Verifica, GET→Obtiene, etc.)
node scripts/svp-dict-fill-descriptions.mjs AXA.PGMR SPVSPO
node scripts/svp-dict-fill-descriptions.mjs AXA.PGMR SPVSPO --force

# Rellenar descripciones desde un archivo de fuente (stdin)
node scripts/svp-dict-fill-from-source.mjs AXA.PGMR SPVSPO < SPVSPO.src
```

---

## Búsqueda de tabla, lógicos y programas que la usan

Para saber **qué lógicos** (views/joins) tiene una tabla y **qué programas** la usan (input, lectura, etc.):

1. **Ubicar la tabla:** **find_table**(nombre) → devuelve biblioteca y nombre.
2. **Dependientes (lógicos + programas):** **table_dependents**(library, file, output_library). Ejecuta DSPDBR en el AS400 y devuelve archivos lógicos y programas que dependen de ese archivo físico. Necesitás una **output_library** con permiso de escritura (ej. tu biblioteca personal); el comando crea ahí un archivo temporal (TMPDBR).
3. **“Toda la lógica” de un programa:** si querés ver qué archivos y objetos usa cada programa que toca la tabla, usá **program_references**(library, program, output_library) por cada programa. Ejecuta DSPPGMREF y devuelve archivos (con modo input/output/update) y otros programas referenciados. También usa un archivo temporal (TMPPGR) en `output_library`.

El skill del proyecto indica al asistente que, cuando pidan buscar una tabla o sus lógicos/programas, ofrezca este flujo y, si aceptan, ejecute find_table → table_dependents y opcionalmente program_references para cada programa.

---

## Estructura del proyecto

```
├── .cursor/
│   ├── mcp.json.example   # Ejemplo de configuración MCP (sin credenciales)
│   └── skills/
│       └── as400-ibmi/     # Skill y referencia Barbuss (AXA.PGMR, QFUENTES, etc.)
├── data/
│   ├── barbuss_svp.sqlite  # Creado con npm run init-dict (no versionado)
│   ├── init-svp-dict.mjs   # Script que crea la base
│   └── svp-dict-db.mjs     # Lógica SQLite + parser de comentarios en fuente
├── scripts/
│   ├── svp-dict-query.mjs
│   ├── svp-dict-fill-descriptions.mjs
│   └── svp-dict-fill-from-source.mjs
├── mcp-as400-server.mjs    # Servidor MCP (exec, query, table_dependents, program_references, list_*, svp_dict_*, etc.)
├── package.json
├── .gitignore
└── README.md
```

---

## Seguridad

- **No** incluir en el repositorio: usuario, contraseña, claves SSH ni archivo `.cursor/mcp.json` con datos reales.
- `.gitignore` excluye: `node_modules/`, `data/*.sqlite`, `.env`, `.cursor/mcp.json`.
- Cada desarrollador copia `.cursor/mcp.json.example` a `.cursor/mcp.json` y completa host, usuario y contraseña o clave en local.

---

## Licencia

ISC (o la que indique el proyecto Barbuss).
