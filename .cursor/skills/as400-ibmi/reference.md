# Referencia – IBM i y MCP AS400

## Barbuss Risk Argentina – Resumen

- **DDS (tablas):** archivo **QGCTAALL** en biblioteca **AXA.FILE** → fuentes de todas las tablas.
- **Programas / CLs / service programs:** archivo **QFUENTES** en biblioteca **AXA.PGMR** → fuentes de todos los programas.
- **Patchs:** archivo **QPATCHS** en biblioteca **AXA.PGMR** → fuentes de patchs que corren una vez en la instalación.
- **Objetos de servicios (compilados):** biblioteca **QUOMDATA**. Fuentes siguen en AXA.PGMR/QFUENTES.

## Compilación de service programs (SVP)

1. Crear módulo (CRTMOD).
2. **CRTSRVPGM** (Create Service Program).
3. **Directorio de enlace:** **HDIBDIR** en biblioteca **HDIILE** (Binding directory . . . *NONE o nombre; Biblioteca . . . HDIILE).
4. **Copybooks:** archivo **QCOPYBOOK** en biblioteca **HDIILE**.

Algunos objetos pueden estar mal nomenclados; conviene chequear WSR (GET) vs WSP (POST) y SVP/SPV.

## Herramientas MCP implementadas

- **describe_table(schema, table)**: columnas desde QSYS2.SYSCOLUMNS.
- **list_tables(schema, limit?)**: tablas en una biblioteca desde QSYS2.SYSTABLES.
- **find_table(pattern, limit?)**: búsqueda por nombre de tabla en todas las bibliotecas.
- **table_dependents(library, file, output_library)**: dependientes de un archivo físico (DSPDBR): lógicos y programas que usan esa tabla. output_library con escritura.
- **program_references(library, program, output_library)**: objetos que usa un programa (DSPPGMREF): archivos (input/output/update), otros programas, etc. output_library con escritura.
- **list_file_members(library, file, output_library)**: lista miembros de **cualquier** archivo físico. library y file son libres: personal, AXA.PGMR/QFUENTES, AXA.FILE/QGCTAALL, QCLSRC, etc. output_library = cualquier biblio con escritura (ej. INF1LUIS o biblio personal). Campo del outfile: MBMEMBER (si falla, SELECT * para ver la estructura).
- **list_srvpgm_exports(schema, srvpgm_name)**: procedimientos exportados de un SRVPGM desde AS400.
- **svp_dict_query(library?, srvpgm_name?, method_pattern?)**: consulta el diccionario SQLite local (`data/barbuss_svp.sqlite`). Sin AS400.
- **svp_dict_sync(library, srvpgm_name)**: trae exports del AS400 y guarda en el SQLite. Poblar/actualizar diccionario.
- **Base del diccionario:** `data/barbuss_svp.sqlite`. Crear con `node data/init-svp-dict.mjs`. Requiere `npm install` (sql.js, sin compilación nativa).

## Mejoras posibles al MCP

Para seguir mejorando el servidor MCP (`mcp-as400-server.mjs`):

1. ~~**describe_table** y **find_table**~~ — Ya implementados.

2. ~~**list_file_members**~~ — Implementado. Usar para AXA.PGMR/QFUENTES (programas/SVP) o AXA.FILE/QGCTAALL (DDS).

3. **Manejo de esquemas con punto**  
   Si en el futuro el MCP pudiera ejecutar en un contexto donde "AXA.FILE" sea válido, documentar en el skill que esa opción existe; si no, seguir recomendando alias o usar la biblioteca donde está el objeto.

## Nomenclatura típica

- **Biblioteca** = schema en SQL = “library”.
- **Archivo físico** = tabla (o alias a un miembro).
- **Miembro** = en archivos multi-miembro, cada “tabla lógica”; en SQL a veces hace falta un alias al miembro.
- **Fuente** = source member (DDS, RPG, etc.); no es la tabla que consultás con SQL.
