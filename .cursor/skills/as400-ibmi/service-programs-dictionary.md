# Diccionario de service programs (Barbuss) – SQLite

El diccionario de SVP y sus métodos está en **SQLite**: `data/barbuss_svp.sqlite` (en la raíz del proyecto RPG).

## Uso

- **Consultar (sin AS400):** herramienta MCP **svp_dict_query**. Parámetros opcionales: `library`, `srvpgm_name`, `method_pattern`. Lista SRVPGM, métodos de uno, o búsqueda por texto.
- **Poblar / actualizar:** herramienta MCP **svp_dict_sync**(library, srvpgm_name). Consulta el AS400 y guarda los métodos en el SQLite.
- **Descripciones desde el fuente:** MCP **svp_dict_fill_from_source**(library, srvpgm_name, source_file?). Lee el miembro de fuente en AS400, busca comentarios encima de cada procedimiento (DCL-PROC ... EXPORT o P name B EXPORT) y actualiza la columna description. Los que no tengan comentario en el fuente no se modifican. Alternativa local: `node scripts/svp-dict-fill-from-source.mjs AXA.PGMR SPVSPO < fuente.txt` (fuente por stdin).
- **Descripciones inferidas por nombre:** `node scripts/svp-dict-fill-descriptions.mjs AXA.PGMR SPVSPO [--force]` (CHK→Verifica, GET→Obtiene, etc.; solo si no hay descripción real en el fuente).
- **Leer miembro de fuente en AS400:** MCP **read_source_member**(library, file, member). Devuelve el contenido del miembro (p. ej. para pegar en archivo y usar con svp-dict-fill-from-source).
- **Línea de comandos:** `node scripts/svp-dict-query.mjs` (lista SRVPGM), `node scripts/svp-dict-query.mjs AXA.PGMR SPVSPO` (métodos), `node scripts/svp-dict-query.mjs GET` (buscar por nombre).

## Primera vez

1. `npm install` (incluye sql.js; no requiere SQLite instalado aparte).
2. `node data/init-svp-dict.mjs` (crea la base; opcional, el MCP también la crea al usar svp_dict_sync/query).
3. Ejecutá **svp_dict_sync**(AXA.PGMR, SPVSPO) (u otro SRVPGM) para cargar métodos desde el AS400.

## Estructura (SQLite)

- **srvpgm:** library, name, source_file, notes, updated_at.
- **srvpgm_method:** library, srvpgm_name, method_name, description.

Las descripciones pueden venir de: (1) comentarios en el fuente (svp_dict_fill_from_source o script con stdin); (2) inferencia por nombre (svp-dict-fill-descriptions.mjs); (3) edición manual en el SQLite. También podés editarlas a mano en el SQLite o con una herramienta de “editar descripción”. Nomenclatura: WSR = GET, WSP = POST; anotar excepciones en `notes` del srvpgm o en description del método.
