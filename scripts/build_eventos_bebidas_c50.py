"""Generate bebidas items from Menú C50 Esp.pdf extraction (drinks only)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_ITEMS = ROOT / "docs" / "eventos-menus" / "bebidas-c50-items.json"


def main() -> None:
    items: list[dict] = []
    ord_n = 10

    def add(
        sku: str,
        name: str,
        price: float,
        *,
        desc: str | None = None,
        verified: bool = True,
        sort: int | None = None,
    ) -> None:
        nonlocal ord_n
        s = sort if sort is not None else ord_n
        ord_n = s + 1
        items.append(
            {
                "id": f"local-{sku}",
                "sku": sku,
                "name": name,
                "description": desc,
                "unit": "unidad",
                "unit_price": price,
                "min_pax": None,
                "is_vegetarian": True,
                "active": True,
                "sort_order": s,
                "price_source": "pdf_menu_c50_esp",
                "price_verified": verified,
            }
        )

    # Café / té
    add("BEB-AMER", "Café americano", 45, desc="Menú C50 Esp · café")
    add("BEB-ESP", "Espresso", 45)
    add("BEB-ESP-DES", "Espresso descafeinado", 45)
    add("BEB-ESP-DOB", "Espresso doble", 60)
    add("BEB-CAP", "Capuchino", 55)
    add("BEB-LAT", "Latte", 55)
    add("BEB-TE", "Té", 40)
    add("BEB-CARAJ", "Carajillo", 150)

    # Coctelería
    add("BEB-PINA", "Piña colada", 115)
    add("BEB-MAR", "Margarita", 135, desc="Limón, mango, tamarindo o fresa")
    add("BEB-MEZ", "Mezcalita", 135, desc="Limón, mango, tamarindo o fresa")
    add("BEB-MOJ", "Mojito clásico", 120)
    add("BEB-MOJ-FR", "Mojito de frutos rojos", 140)
    add("BEB-MART", "Martini seco", 150)
    add("BEB-BLOOD", "Bloody Mary", 115)
    add("BEB-CLER-C", "Clericot (copa)", 140)
    add("BEB-CLER-J", "Clericot (jarra)", 365)
    add("BEB-SANG", "Sangría", 130)
    add("BEB-SANG-P", "Sangría preparada", 155)
    add("BEB-NEG", "Negroni", 180)
    add("BEB-APER", "Aperol Spritz", 210)

    # Nuestras creaciones
    add("BEB-BABY", "Baby Carranza", 120, desc="Mezcal, mango y chamoy")
    add(
        "BEB-CANT",
        "Cantarito Carranza",
        125,
        desc="Mezcal, toronja, naranja, limón y sal de gusano",
    )
    add(
        "BEB-GAV",
        "Gavilán / Paloma",
        170,
        desc="Centenario plata, Ancho Reyes, toronja, limón, chile pasilla, sal de gusano",
    )
    add(
        "BEB-MEDIA",
        "Media noche",
        150,
        desc="Vodka, curaçao, limón, arándano y mora azul",
    )
    add(
        "BEB-FRESCO",
        "Fresco de Carranza",
        210,
        desc="Ginebra, Licor 43, coco, quina, pepino, limón, hierbabuena",
    )
    add("BEB-TORO", "Toro", 115, desc="Bacardí blanco, limón, cerveza clara")
    add(
        "BEB-50SPR",
        "50 Spritz",
        180,
        desc="Aperol, espumoso, toronja, agua mineral",
    )
    add(
        "BEB-DIAB",
        "Diablo verde",
        180,
        desc="Mezcal, piña, limón, chile serrano, agua mineral",
    )

    # Cervezas
    for sku, name, p in [
        ("BEB-CERV-BOH-C", "Bohemia cristal", 65),
        ("BEB-CERV-BOH-O", "Bohemia oscura", 65),
        ("BEB-CERV-TEC-L", "Tecate Light", 65),
        ("BEB-CERV-XX-L", "XX Lager", 65),
        ("BEB-CERV-XX-A", "XX Ámbar", 65),
        ("BEB-CERV-AMS", "Amstel", 80),
        ("BEB-CERV-HEI", "Heineken", 80),
        ("BEB-CERV-TEC0", "Tecate 0.0", 65),
    ]:
        add(sku, name, p, desc="355 ml")
    add("BEB-TAR-MIC", "Tarro michelado", 25)
    add("BEB-TAR-CHE", "Tarro chelado", 20)
    add("BEB-TAR-CLA", "Tarro con clamato", 25)
    # Alias frecuente en OS (mismo precio nacional $65)
    add(
        "BEB-CERV",
        "Cerveza nacional",
        65,
        desc="355 ml · Bohemia / Tecate / XX (Menú C50 Esp)",
    )

    # Artesanales
    for sku, name, p, d in [
        ("BEB-ART-HP", "Hércules Hombre Pájaro", 140, "Querétaro · Ray Lager / lata 473 ml"),
        ("BEB-ART-SL", "Hércules Súper Lupe", 155, "Querétaro · IPA / lata 473 ml"),
        ("BEB-ART-IZ", "La Bru Iztaccíhuatl", 95, "Michoacán · Lager / botella 355 ml"),
        ("BEB-ART-VZ", "La Bru Vizcaíno", 100, "Michoacán · IPA / botella 355 ml"),
        ("BEB-ART-MA", "La Bru Maíz Azul", 95, "Michoacán · Cream Ale / botella 355 ml"),
        (
            "BEB-ART-LN",
            "Rámuri Lágrimas Negras",
            120,
            "Tijuana · Imperial Cacao Stout / botella 355 ml",
        ),
        ("BEB-ART-TI", "Colima Ticús", 100, "Colima · Porter / botella 355 ml"),
    ]:
        add(sku, name, p, desc=d)

    # Sin alcohol
    for sku, name, p, d in [
        ("BEB-JUG-PI", "Jugo de piña", 45, "355 ml"),
        ("BEB-JUG-NA", "Jugo de naranja", 45, "355 ml"),
        ("BEB-JUG-AR", "Jugo de arándano", 45, "355 ml"),
        ("BEB-LIM", "Limonada", 45, "355 ml"),
        ("BEB-NAR", "Naranjada", 45, "355 ml"),
        ("BEB-PINADA", "Piñada", 65, "355 ml"),
        ("BEB-CONGA", "Conga", 60, "355 ml"),
        ("BEB-AGUA-MIN", "Agua mineral", 50, "355 ml"),
        ("BEB-AGUA-QUI", "Agua quina", 50, "355 ml"),
        ("BEB-COCA", "Coca-Cola", 50, "355 ml"),
        ("BEB-COCA-L", "Coca-Cola Light", 50, "355 ml"),
        ("BEB-COCA-Z", "Coca-Cola Zero", 50, "355 ml"),
        ("BEB-CLA", "Clamato natural", 60, "350 ml"),
        ("BEB-AGUA-EMB", "Agua embotellada", 40, "600 ml"),
        ("BEB-PERR", "Agua mineral Perrier", 90, "330 ml"),
        ("BEB-BOOST", "Boost", 70, "237 ml"),
        ("BEB-AGUA-DIA", "Agua del día", 50, "400 ml"),
        ("BEB-JARRA-AG", "Jarra de agua", 130, "1.70 L"),
        ("BEB-GING", "Ginger Ale", 50, "355 ml"),
        ("BEB-MUND", "Mundet", 50, "355 ml"),
        ("BEB-SPR", "Sprite", 50, "355 ml"),
        ("BEB-SPR-Z", "Sprite Zero", 50, "355 ml"),
        ("BEB-FRES", "Fresca", 50, "355 ml"),
    ]:
        add(sku, name, p, desc=d)

    # Espumosos
    add(
        "BEB-PROS-C",
        "Prosecco (copeo)",
        165,
        desc="Italia · Veneto · Pinelli · 150 ml",
    )
    add(
        "BEB-PROS-B",
        "Prosecco (botella)",
        650,
        desc="Italia · Veneto · Pinelli · 750 ml",
    )

    # Vinos — orden de precios según layout PDF (págs. 3); si mapeo dudoso → verified=false
    wines = [
        ("VIN-PUE", "Puerto Nuevo", 110, 365, "México · Valle de Guadalupe · Cabernet/Malbec", True),
        ("VIN-LAB-N", "Laberinto Nebbiolo", 170, 700, "México · SLP · Nebbiolo", True),
        ("VIN-XTI", "Xtinto", 180, 610, "México · Valle de Guadalupe · Cab/Merlot/Tempranillo", True),
        ("VIN-RED", "La Redonda", None, 525, "México · Querétaro · Malbec", True),
        ("VIN-CM3V", "Casa Madero 3V", None, 850, "México · Parras · Cab/Merlot/Tempranillo", True),
        ("VIN-MAG-MM", "Magoni Merlot Malbec", None, 850, "México · Valle de Guadalupe", True),
        ("VIN-COTO", "El Coto", 150, 590, "España · Rioja · Tempranillo", True),
        ("VIN-SUR", "Surco 2.7", 180, 790, "México · Valle de San Vicente · Cabernet", True),
        ("VIN-SYR", "Reserva Syrah", 195, 865, "México · SLP · Syrah", True),
        ("VIN-SEX", "Sexy Fish", None, 560, "Argentina · Mendoza · Cabernet Franc", True),
        ("VIN-LAB-G", "Laberinto Gewürztraminer", 170, 680, "México · Valle de Guadalupe · blanco", True),
        ("VIN-MAG-R", "Magoni Rosé", 150, 620, "México · Valle de Guadalupe · rosado", True),
        ("VIN-CM-R", "Casa Madero V Rosado", None, 600, "México · Parras · Cabernet · rosado", True),
        ("VIN-MAG-SB", "Magoni Sauvignon Blanc", None, 590, "México · Valle de Guadalupe · blanco", True),
    ]
    for sku, name, copeo, bot, note, ver in wines:
        if copeo is not None:
            add(
                f"{sku}-C",
                f"{name} (copeo)",
                copeo,
                desc=f"{note} · 150 ml",
                verified=ver,
            )
        if bot is not None:
            add(
                f"{sku}-B",
                f"{name} (botella)",
                bot,
                desc=f"{note} · 750 ml",
                verified=ver,
            )

    spirits = [
        ("TEQ-CUE", "Cuervo especial", "tequila", 110, 1050),
        ("TEQ-CEN-P", "Centenario plata", "tequila", 120, 1300),
        ("TEQ-CEN-R", "Centenario reposado", "tequila", 120, 1300),
        ("TEQ-TRA", "Tradicional", "tequila", 130, 1450),
        ("TEQ-DJ-B", "Don Julio blanco", "tequila", 180, 2350),
        ("TEQ-DJ-R", "Don Julio reposado", "tequila", 180, 2500),
        ("TEQ-DJ-70", "Don Julio 70", "tequila", 230, 3750),
        ("TEQ-DOB", "Maestro Dobel Diamante", "tequila", 180, 2800),
        ("BRA-TER", "Terry", "brandy", 120, 1400),
        ("BRA-TOR", "Torres 10", "brandy", 120, 1400),
        ("COG-MAR", "Martell VS", "cognac", 200, 2400),
        ("RON-BAC", "Bacardí blanco", "ron", 100, 1050),
        ("RON-MAT-P", "Matusalem Platino", "ron", 110, 1200),
        ("RON-CAP", "Capitán Morgan", "ron", 95, 1000),
        ("RON-ZAC", "Zacapa 23", "ron", 250, 3500),
        ("RON-HAV", "Havana 7", "ron", 140, 1600),
        ("RON-MAT-G", "Matusalem Gran Reserva", "ron", 150, 1750),
        ("VOD-SMI", "Smirnoff", "vodka", 100, 1000),
        ("VOD-STO", "Stolichnaya", "vodka", 120, 1300),
        ("VOD-ABS", "Absolut Azul", "vodka", 110, 1200),
        ("VOD-GRE", "Grey Goose", "vodka", 180, 2500),
        ("GIN-TAN", "Tanqueray", "ginebra", 170, 1950),
        ("GIN-BOM", "Bombay Sapphire", "ginebra", 180, 1950),
        ("GIN-HEN", "Hendrick's", "ginebra", 250, 3150),
        ("GIN-DIE", "Diega Manzanilla", "ginebra", 120, 1500),
        ("WHI-JW-R", "JW Etiqueta Roja", "whisky", 130, 1400),
        ("WHI-JW-N", "JW Etiqueta Negra", "whisky", 210, 3050),
        ("WHI-BUC", "Buchanan's 12", "whisky", 210, 2800),
        ("WHI-CHI", "Chivas Regal 12", "whisky", 190, 2500),
        ("WHI-JD", "Jack Daniel's", "whisky", 150, 1800),
        ("MEZ-BRU", "Bruxo #1", "mezcal", 150, 2200),
        ("MEZ-DAN", "Danzantes reposado", "mezcal", 280, 3950),
        ("MEZ-400", "400 Conejos espadín joven", "mezcal", 130, 2100),
        ("MEZ-OJO", "Ojo de Tigre espadín/tobalá", "mezcal", 130, 2450),
        ("MEZ-GAD-J", "GAD espadín joven", "mezcal", 110, 2200),
        ("MEZ-GAD-R", "GAD reposado", "mezcal", 160, 2500),
        ("MEZ-GAD-T", "GAD tobalá", "mezcal", 220, 3850),
    ]
    for sku, name, cat, copeo, bot in spirits:
        add(f"{sku}-C", f"{name} (copeo)", copeo, desc=f"{cat} · 45 ml")
        add(f"{sku}-B", f"{name} (botella)", bot, desc=f"{cat}")

    for sku, name, p in [
        ("LIC-KAH", "Kahlúa", 100),
        ("LIC-FRA", "Frangelico", 120),
        ("LIC-VAC", "Vaccari Nero", 120),
        ("LIC-BAI", "Bailey's", 125),
        ("LIC-JAG", "Jägermeister", 130),
        ("LIC-CHI-D", "Chinchón dulce", 110),
        ("LIC-CHI-S", "Chinchón seco", 110),
        ("LIC-AMA", "Amaretto Disaronno", 150),
        ("LIC-43", "Licor 43", 160),
        ("LIC-CAM", "Campari", 120),
        ("LIC-FER", "Fernet Branca", 190),
    ]:
        add(sku, name, p, desc="Licor · 60 ml")

    add(
        "BEB-CARTA",
        "Bebida otra (consumo)",
        0,
        desc="Línea genérica · captura cantidad y precio · detalle en notas",
        verified=False,
    )

    OUT_ITEMS.parent.mkdir(parents=True, exist_ok=True)
    OUT_ITEMS.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} items to {OUT_ITEMS}")


if __name__ == "__main__":
    main()
