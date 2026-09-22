from pathlib import Path
import json
import sys
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parents[1]
OUT_PATH = BASE_DIR / "data" / "wijken_zeeland_2024.json"
PDOK_URL = (
    "https://api.pdok.nl/cbs/wijken-en-buurten-2024/ogc/v1/collections/"
    "wijken/items?f=json&bbox=3.25,51.18,4.35,51.82&limit=1000"
)

ZEELAND_GEMEENTEN = {
    "Borsele",
    "Goes",
    "Hulst",
    "Kapelle",
    "Middelburg",
    "Middelburg (Z.)",
    "Noord-Beveland",
    "Reimerswaal",
    "Schouwen-Duiveland",
    "Sluis",
    "Terneuzen",
    "Tholen",
    "Veere",
    "Vlissingen",
}


def clean(value, fallback=0):
    if value is None:
        return fallback
    if isinstance(value, (int, float)) and value <= -99990:
        return fallback
    return value


def first_number(props, names, fallback=0):
    for name in names:
        value = clean(props.get(name), None)
        if value is not None:
            return value
    return fallback


def centroid(geometry):
    coords = []

    def walk(part):
        if not isinstance(part, list):
            return
        if len(part) >= 2 and all(isinstance(item, (int, float)) for item in part[:2]):
            coords.append(part[:2])
            return
        for child in part:
            walk(child)

    walk(geometry.get("coordinates", []))
    if not coords:
        return 51.5, 3.8
    lng = sum(item[0] for item in coords) / len(coords)
    lat = sum(item[1] for item in coords) / len(coords)
    return lat, lng


def label_from_gas(gas):
    if gas <= 850:
        return "A/B"
    if gas <= 1100:
        return "C"
    if gas <= 1350:
        return "D"
    if gas <= 1650:
        return "E"
    return "F/G"


def estimate_costs(props, gas, electricity):
    old_homes = clean(props.get("perc_bouwjaar_meer_dan_10_jaar_geleden"), 75)
    detached = clean(props.get("perc_eengezinswoning_vrijstaand"), 15)
    apartment = clean(props.get("percentage_meergezinswoning"), 20)
    solar = clean(props.get("percentage_woningen_met_zonnestroom"), 15)

    base = 14500 + gas * 7.6 + old_homes * 55 + detached * 90 - apartment * 45 - solar * 35
    base = max(12500, min(46000, base))
    warmtenet = base * (0.78 + detached / 450)
    return round(base), round(max(10500, min(43000, warmtenet)))


def estimate_scores(props, gas):
    old_homes = clean(props.get("perc_bouwjaar_meer_dan_10_jaar_geleden"), 75)
    solar = clean(props.get("percentage_woningen_met_zonnestroom"), 15)
    gas_free = clean(props.get("percentage_aardgasvrije_woningen"), 0)
    density = clean(props.get("stedelijkheid_adressen_per_km2"), 600)
    koop = clean(props.get("percentage_koopwoningen"), 55)

    isolation = max(20, min(90, 92 - old_homes * 0.35 - max(gas - 900, 0) * 0.018 + solar * 0.18))
    netcapacity = max(30, min(85, 74 - density * 0.012 + gas_free * 0.2))
    draagvlak = max(35, min(82, 45 + koop * 0.28 + solar * 0.25))
    return round(isolation), round(netcapacity), round(draagvlak)


def fetch_json(url):
    with urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    payload = fetch_json(PDOK_URL)
    rows = []

    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        gemeente = props.get("gemeentenaam")
        if gemeente not in ZEELAND_GEMEENTEN:
            continue
        display_gemeente = "Middelburg" if gemeente == "Middelburg (Z.)" else gemeente

        woningen = int(clean(props.get("woningvoorraad"), 0) or 0)
        if woningen < 100:
            continue

        gas = int(first_number(props, ["gemiddeld_gasverbruik_totaal", "gemiddeld_aardgasverbruik"], 1200))
        elek = int(first_number(props, ["gemiddeld_elektriciteitsverbruik_totaal", "gemiddelde_elektriciteitslevering"], 2800))
        lat, lng = centroid(feature.get("geometry", {}))
        basis_kosten, warmtenet = estimate_costs(props, gas, elek)
        isolatie, netcapaciteit, draagvlak = estimate_scores(props, gas)

        rows.append(
            {
                "id": props.get("wijkcode", "").lower() or f"{gemeente}-{props.get('wijknaam')}".lower(),
                "gemeente": display_gemeente,
                "wijk": props.get("wijknaam", "Onbekende wijk"),
                "woningen": woningen,
                "bouwjaar": 2024 - round(clean(props.get("perc_bouwjaar_meer_dan_10_jaar_geleden"), 75) / 100 * 45),
                "label": label_from_gas(gas),
                "label_status": "geschat",
                "label_source": "Schatting op basis van gemiddeld CBS-aardgasverbruik per wijk; geen officieel EP-online/RVO energielabel.",
                "gas_m3": gas,
                "elek_kwh": elek,
                "isolatie": isolatie,
                "netcapaciteit": netcapaciteit,
                "draagvlak": draagvlak,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "basis_kosten": basis_kosten,
                "warmtenet": warmtenet,
                "bron": "CBS/PDOK Wijk- en Buurtkaart 2024",
                "cbs_wijkcode": props.get("wijkcode"),
                "cbs_gemeentecode": props.get("gemeentecode"),
                "woz_waarde_x1000": clean(props.get("gemiddelde_woningwaarde"), None),
                "koopwoningen_pct": clean(props.get("percentage_koopwoningen"), None),
                "huurwoningen_pct": clean(props.get("percentage_huurwoningen"), None),
                "zonnestroom_pct": clean(props.get("percentage_woningen_met_zonnestroom"), None),
                "aardgasvrij_pct": clean(props.get("percentage_aardgasvrije_woningen"), None),
            }
        )

    rows.sort(key=lambda row: (row["gemeente"], row["wijk"]))
    output = {
        "source": "CBS/PDOK Wijk- en Buurtkaart 2024",
        "source_url": PDOK_URL,
        "generated_by": "scripts/update_real_data.py",
        "notes": [
            "CBS/PDOK levert echte wijkgrenzen en kerncijfers zoals woningvoorraad, gemiddeld gasverbruik en elektriciteitsverbruik.",
            "Energielabel, kosten, netcapaciteit en draagvlak zijn modelinschattingen voor het schoolprototype.",
            "Het veld label is hernoemd in de interface naar energieprofiel, omdat dit geen officieel energielabel is.",
            "EP-online energielabeldata vereist een API-key van RVO en is daarom niet automatisch opgehaald.",
        ],
        "rows": rows,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Opgeslagen: {OUT_PATH}")
    print(f"Aantal Zeeuwse wijken: {len(rows)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Fout bij ophalen echte data: {exc}", file=sys.stderr)
        raise
