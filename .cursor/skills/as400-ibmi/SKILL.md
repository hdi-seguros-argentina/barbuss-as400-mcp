---
name: as400-ibmi
description: Clarifies IBM i (AS400) source vs object location, SQL schema naming with dots, Barbuss Risk Argentina layout (AXA.FILE, AXA.PGMR, QGCTAALL, QFUENTES, QPATCHS, QUOMDATA), service programs (WSR=GET, WSP=POST, SVP/SPV), compilation (CRTMOD, CRTSRVPGM, HDIILE/HDIBDIR, QCOPYBOOK), and AS400 MCP tools. Use when working with IBM i, Db2 for i, physical files, libraries, members, DDS, service programs, or when SQL fails with -950.
---

# IBM i / AS400 – Fuente vs objeto y SQL

## Barbuss Risk Argentina – Estructura de fuentes

| Qué | Archivo | Biblioteca | Contenido |
|-----|---------|------------|-----------|
| **Tablas (DDS)** | **QGCTAALL** | **AXA.FILE** | Fuentes de todas las tablas (definiciones DDS). |
| **Programas / CLs / service programs** | **QFUENTES** | **AXA.PGMR** | Fuentes de todos los programas (incl. servicios). |
| **Patchs** | **QPATCHS** | **AXA.PGMR** | Fuentes de los patchs que corren una vez en una instalación. |

**Objetos de servicios (compilados):** biblioteca **QUOMDATA**. Los fuentes siguen en AXA.PGMR/QFUENTES.

**Listas de programas y SVP (Barbuss):** la **fuente de verdad** es **AXA.PGMR/QFUENTES**. Las herramientas MCP aceptan **cualquier biblioteca y archivo** que envíes: podés listar tu **biblioteca personal**, otro archivo (QCLSRC, QRPGLESRC, QGCTAALL en AXA.FILE, etc.) o cualquier combinación. Solo pasá library, file y (para list_file_members) una output_library donde tengas escritura. **CLs:** fuentes en QFUENTES (AXA.PGMR) o QCLSRC según el entorno.

**Nomenclatura de programas de servicio (revisar: algunos están mal nomenclados):**
- **WSR** = programa de servicio **GET** (lectura).
- **WSP** = programa de servicio **POST**.
- **SVP** / **SPV** = service program (compilado como módulos con CRTSRVPGM); dentro tienen muchos métodos. **Diccionario en SQLite:** `data/barbuss_svp.sqlite`. Consultar con **svp_dict_query**; poblar/actualizar con **svp_dict_sync**(library, srvpgm_name) desde el AS400.

**Compilación de service programs:** crear módulo (CRTMOD) → **CRTSRVPGM**. Directorio de enlace: **HDIBDIR** en biblioteca **HDIILE**. Copybooks: archivo **QCOPYBOOK** en biblioteca **HDIILE**.

- Para ver **en qué biblioteca está el objeto** (tabla con datos), usar `find_table` o `list_tables` del MCP.
- Para ver **columnas de una tabla**, usar `describe_table`.
- Para **listar miembros** de cualquier archivo (programas/SVP, DDS, CL, etc.): **list_file_members**(library, file, output_library). Podés enviar la biblioteca que quieras (AXA.PGMR, AXA.FILE, tu biblio personal) y el archivo (QFUENTES, QGCTAALL, QCLSRC, etc.).
- Para **métodos de un SVP**: usar **svp_dict_query** (lee el SQLite local; sin conexión AS400) o **list_srvpgm_exports** (consulta el AS400). Para llenar/actualizar el diccionario: **svp_dict_sync**(library, srvpgm_name).

## Fuente vs objeto

En IBM i suele distinguirse:

- **Fuente (source)**: el miembro donde está el DDS o el código (por ejemplo en la biblioteca **AXA.FILE**, archivo **QGCTAALL**, miembro **PAHSEW**). Es donde “está armado” el archivo a nivel definición.
- **Objeto (object)**: el archivo físico con datos, que puede estar en **otra biblioteca** (por ejemplo **AXAREAL**). Es lo que SQL ve como tabla.

Cuando el usuario dice que “el origen está en QGCTAALL/AXA.FILE”, puede referirse al **fuente** (definición), no a la tabla con datos. El objeto con datos puede estar en AXAREAL u otra biblioteca. Confirmar siempre: “¿hablamos del objeto (tabla con datos) o del fuente (DDS/miembro)?”.

## Esquemas con punto en el nombre (SQL -950)

Si la **biblioteca** se llama con punto (ej. **AXA.FILE**), en SQL el esquema es `"AXA.FILE"`. Db2 a veces interpreta mal y devuelve:

- **SQLSTATE 42705 / -950**: “La base de datos relacional AXA no está en el directorio de bases de datos relacionales”.

**Opciones:**

1. **Consultar el objeto donde realmente está**  
   Si el archivo físico (con datos) está en otra biblioteca sin punto (ej. **AXAREAL**), usar esa en SQL: `AXAREAL.TABLA`.

2. **Crear un alias** en una biblioteca sin punto que apunte al archivo (y si aplica, al miembro):
   ```sql
   CREATE ALIAS MI_BIBLIO.PAHSEW FOR "AXA.FILE".QGCTAALL(PAHSEW);
   ```
   Luego usar `MI_BIBLIO.PAHSEW` en los SELECT.

3. **Catálogo**  
   En `QSYS2.SYSTABLES` / `QSYS2.SYSCOLUMNS` el esquema puede aparecer como `AXA.FILE`; eso no garantiza que `FROM "AXA.FILE".TABLA` funcione en runtime. Si falla, usar (1) o (2).

## MCP AS400 (exec, query, describe_table, list_tables, find_table, list_file_members, list_srvpgm_exports, svp_dict_query, svp_dict_sync)

- **exec**: ejecuta un comando en el shell del AS400 por SSH (CL, QSH, etc.).
- **query**: ejecuta **una** sentencia SQL con `qsh -c "db2 \"...\""`. No usar punto y coma final.
- **describe_table**: recibe `schema` y `table`; devuelve columnas (nombre, posición, tipo, longitud) desde QSYS2.SYSCOLUMNS.
- **list_tables**: recibe `schema` (biblioteca); devuelve lista de tablas/archivos en esa biblioteca desde QSYS2.SYSTABLES.
- **find_table**: recibe `pattern` (nombre o parte); busca en QSYS2.SYSTABLES en todas las bibliotecas y devuelve TABLE_SCHEMA y TABLE_NAME.
- **list_file_members**: recibe `library`, `file`, `output_library`. Lista los miembros de **cualquier** archivo físico. Podés enviar cualquier biblioteca (personal, AXA.PGMR, AXA.FILE, …) y cualquier archivo (QFUENTES, QGCTAALL, QCLSRC, …). output_library = una biblio con permiso de escritura (puede ser tu biblio personal).
- **list_srvpgm_exports**: recibe `schema` y `srvpgm_name`. Lista los procedimientos exportados de un SRVPGM desde el AS400.
- **svp_dict_query**: consulta el **diccionario local** (SQLite en `data/barbuss_svp.sqlite`). Parámetros opcionales: `library`, `srvpgm_name`, `method_pattern`. Sin conexión AS400. Ideal para buscar métodos cuando el diccionario ya está poblado.
- **svp_dict_sync**: trae los exports de un SRVPGM desde el AS400 y los guarda en el SQLite. Parámetros: `library`, `srvpgm_name`. Ejecutar para poblar o actualizar el diccionario.

Al escribir SQL para el MCP:

- Usar preferentemente esquemas/objetos que funcionen sin punto en el nombre del esquema, o aliases creados como arriba.
- Para listar tablas de una biblioteca: `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'NOMBRE_BIBLIO'`.
- Para columnas: `SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, LENGTH FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = '...' AND TABLE_NAME = '...' ORDER BY ORDINAL_POSITION`.

## Resumen

| Situación | Acción |
|-----------|--------|
| “La tabla está en QGCTAALL/AXA.FILE” | Aclarar si es **fuente** (DDS) o **objeto** (datos). El objeto puede estar en otra biblio (ej. AXAREAL). |
| SQL -950 con esquema tipo "AXA.FILE" | Usar la biblioteca donde está el objeto (sin punto) o crear un alias en una biblio sin punto. |
| Necesito el layout de una tabla | Usar herramienta **describe_table(schema, table)** o `QSYS2.SYSCOLUMNS`. |
| Buscar tabla por nombre (ej. PAHSEW) | Usar **find_table(nombre)** para ver en qué biblioteca está el objeto. |
| Listar tablas de una biblioteca | Usar **list_tables(schema)**. |
| Métodos de un SVP / qué SVP usar | **svp_dict_query** (SQLite local) o **list_srvpgm_exports** (AS400). Poblar diccionario: **svp_dict_sync**(library, srvpgm_name). Base: `data/barbuss_svp.sqlite`. |
| Listar miembros de un archivo (cualquier biblio/archivo) | **list_file_members**(library, file, output_library). Podés enviar biblio personal, AXA.PGMR/QFUENTES, AXA.FILE/QGCTAALL, QCLSRC, etc. |
