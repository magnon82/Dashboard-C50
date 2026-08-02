# Menús Eventos — fuentes PDF

Copias y extracciones de texto usadas para alinear el cotizador (`supabase/seed_event_menus.json`).

| Archivo | Fuente Drive | Rol en cotizador |
|---|---|---|
| `menu-3-tiempos-2025.pdf` / `.txt` | `Eventos\Menús\Menús eventos vigentes\Menú 3 tiempos 2025.pdf` | Menú 3 tiempos (`menu_3_tiempos_2025`). Solo 7 fuertes del PDF (sin extras de carta C50 / OS). API soft-merge fuerza `choice_groups` del seed. |
| `barra-libre-eventos-2025.pdf` / `.txt` | `…\Barra libre eventos 2025.pdf` | Barra libre (`barra_libre_2025`, `requires_food`) |
| `menu-desayunos-2025.pdf` / `.txt` | `…\Menú desayunos 2025.pdf` | Desayunos + pack ≥50 |
| `menu-c50-esp.pdf` / `c50-esp.txt` | `Menú C50\Menú C50 Esp.pdf` | Bebidas add-on únicamente |
| `bebidas-c50-items.json` | Generado | Ítems del catálogo bebidas |

Regenerar bebidas:

```bash
python scripts/build_eventos_bebidas_c50.py
python scripts/merge_eventos_menus_seed.py
python scripts/gen_eventos_bebidas_sql.py
```

En Supabase: ejecutar `eventos_module.sql` (bloque menús) y luego `eventos_menus_bebidas_c50.sql`.
Si solo hay que corregir fuertes/extras del 3 tiempos: `eventos_menus_3_tiempos_vigente.sql`.

Popularidad histórica (OS PDF → cotizador «Más pedidas»):

```bash
python scripts/build_eventos_bebidas_popularidad.py
```

Salida: `supabase/seed_event_bebidas_popularidad.json`. API: `GET /api/eventos/bebidas-popularidad`.
