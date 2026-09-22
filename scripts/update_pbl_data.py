from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
import csv
import io
import json
import sys
import zipfile


BASE_DIR = Path(__file__).resolve().parents[1]
OUT_PATH = BASE_DIR / "data" / "pbl_startanalyse_2025.json"
PBL_BASE_URL = "https://dataportaal.pbl.nl/data/Startanalyse_aardgasvrije_buurten/2025/Gemeentes"

ZEELAND_GEMEENTEN = [
    "Borsele",
    "Goes",
    "Hulst",
    "Kapelle",
    "Middelburg",
    "Noord-Beveland",
    "Reimerswaal",
    "Schouwen-Duiveland",
    "Sluis",
    "Terneuzen",
    "Tholen",
    "Veere",
    "Vlissingen",
]

STRATEGY_LABELS = {
    "s1a": "Individuele lucht-water warmtepomp",
    "s1b": "Individuele bodemwarmtepomp",
    "s2a": "Warmtenet met restwarmte",
    "s2b": "Warmtenet met geothermie binnen contour",
    "s2c": "Warmtenet met geothermie overal",
    "s2d": "Warmtenet met restwarmte en label D",
    "s2e": "Warmtenet met geothermie binnen contour en label D",
    "s2f": "Warmtenet met geothermie overal en label D",
    "s3a": "Laagtemperatuur warmtenet 30/30",
    "s3b": "WKO-net 15/15",
    "s3c": "WKO-net 15/70",
    "s3d": "WKO-net 15/50",
    "s3e": "TEO-net 15/15",
    "s3f": "Laagtemperatuur warmtenet 30/70",
    "s3g": "WKO-net 15/15 en label D",
    "s3h": "WKO-net 15/70",
    "s4a": "Hybride warmtepomp met duurzaam gas en label B",
    "s4b": "Hybride warmtepomp met duurzaam gas en label D",
}


def as_float(value, fallback=0.0):
    if value in (None, "", "-", "."):
        return fallback
    try:
        return float(str(value).replace(".", "").replace(",", "."))
    except ValueError:
        return fallback


def first_value(row, prefix, fallback=""):
    for key, value in row.items():
        if key.startswith(prefix):
            return value
    return fallback


def weighted_add(bucket, total_key, value_key, value, weight):
    if weight <= 0:
        return
    bucket[total_key] += weight
    bucket[value_key] += value * weight


def pct(part, total):
    return round((part / total) * 100, 1) if total else 0


def dominant_label(label_counts):
    grouped = {
        "A/B": label_counts["Label_A_en_beter"] + label_counts["Label_B"],
        "C": label_counts["Label_C"],
        "D": label_counts["Label_D"],
        "E": label_counts["Label_E"],
        "F/G": label_counts["Label_F"] + label_counts["Label_G"],
    }
    return max(grouped, key=grouped.get) if any(grouped.values()) else "Onbekend"


def read_csv_from_zip(zip_file, suffix):
    name = next((item for item in zip_file.namelist() if item.endswith(suffix)), None)
    if not name:
        return []
    text = zip_file.read(name).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def fetch_zip(gemeente):
    url = f"{PBL_BASE_URL}/{quote(gemeente)}.zip"
    with urlopen(url, timeout=45) as response:
        data = response.read()
    return url, zipfile.ZipFile(io.BytesIO(data))


def merge_bebouwing(aggregate, rows):
    label_keys = [
        "Label_A_en_beter",
        "Label_B",
        "Label_C",
        "Label_D",
        "Label_E",
        "Label_F",
        "Label_G",
        "Geen_label",
    ]
    year_keys = [
        "Voor_1930",
        "1930_1945",
        "1946_1965",
        "1966_1975",
        "1976_1992",
        "1993_1996",
        "1997_2000",
        "2001_2006",
        "2007_2011",
        "2012_2014",
        "2015_2020",
    ]
    type_keys = [
        "Vrijstaande_woning",
        "2_onder_1_kap",
        "Rijwoning_hoek",
        "Rijwoning_tussen",
        "Meersgezinswoning_laag_midden",
        "Meersgezinswoning_hoog",
    ]

    for row in rows:
        wijkcode = row.get("I03_wijkcode")
        if not wijkcode:
            continue
        bucket = aggregate[wijkcode]
        bucket["wijkcode"] = wijkcode
        bucket["wijknaam"] = row.get("I04_wijknaam", bucket.get("wijknaam", ""))
        bucket["gemeentecode"] = row.get("I05_gemeentecode", bucket.get("gemeentecode", ""))
        bucket["gemeente"] = row.get("I06_gemeentenaam", bucket.get("gemeente", ""))
        bucket["woningen"] += as_float(first_value(row, "I09_aantal_woningen"))
        bucket["utiliteit"] += as_float(first_value(row, "I10_aantal_utiliteit"))
        bucket["woningequivalenten"] += as_float(first_value(row, "I11_woningequivalenten"))
        bucket["co2_startjaar_ton"] += as_float(first_value(row, "I12_CO2_startjaar"))

        for key in label_keys:
            bucket["label_counts"][key] += as_float(row.get(key))
        for key in year_keys:
            bucket["bouwjaar_counts"][key] += as_float(row.get(key))
        for key in type_keys:
            bucket["woningtype_counts"][key] += as_float(row.get(key))


def merge_strategie(aggregate, rows):
    for row in rows:
        wijkcode = row.get("I03_wijkcode")
        if not wijkcode:
            continue
        bucket = aggregate[wijkcode]
        woningen = as_float(first_value(row, "I09_aantal_woningen"), 1)
        weq = as_float(first_value(row, "I11_woningequivalenten"), woningen)
        indicator = row.get("Code_Indicator")

        if indicator == "V01_Strategievariant":
            code = row.get("Laagste_Nationale_Kosten", "")
            if code:
                bucket["strategie_counter"].update({code: max(1, round(woningen))})
            continue

        if indicator == "H16_Nat_meerkost":
            bucket["nat_meerkost_eur_jaar"] += as_float(row.get("Laagste_Nationale_Kosten"))
            continue

        if indicator == "H17_Nat_meerkost_CO2":
            weighted_add(
                bucket,
                "nat_meerkost_co2_weight",
                "nat_meerkost_co2_weighted",
                as_float(row.get("Laagste_Nationale_Kosten")),
                max(weq, 1),
            )
            continue

        if indicator == "H18_Nat_meerkost_WEQ":
            weighted_add(
                bucket,
                "nat_meerkost_weq_weight",
                "nat_meerkost_weq_weighted",
                as_float(row.get("Laagste_Nationale_Kosten")),
                max(weq, 1),
            )


def empty_bucket():
    return {
        "woningen": 0.0,
        "utiliteit": 0.0,
        "woningequivalenten": 0.0,
        "co2_startjaar_ton": 0.0,
        "label_counts": defaultdict(float),
        "bouwjaar_counts": defaultdict(float),
        "woningtype_counts": defaultdict(float),
        "strategie_counter": Counter(),
        "nat_meerkost_eur_jaar": 0.0,
        "nat_meerkost_co2_weight": 0.0,
        "nat_meerkost_co2_weighted": 0.0,
        "nat_meerkost_weq_weight": 0.0,
        "nat_meerkost_weq_weighted": 0.0,
    }


def finalize_row(bucket):
    labels = dict(bucket["label_counts"])
    years = dict(bucket["bouwjaar_counts"])
    types = dict(bucket["woningtype_counts"])
    label_total = sum(labels.values())
    bouw_total = sum(years.values())
    type_total = sum(types.values())
    best_strategy, best_strategy_weight = ("", 0)
    if bucket["strategie_counter"]:
        best_strategy, best_strategy_weight = bucket["strategie_counter"].most_common(1)[0]

    old_until_1975 = (
        years.get("Voor_1930", 0)
        + years.get("1930_1945", 0)
        + years.get("1946_1965", 0)
        + years.get("1966_1975", 0)
    )
    good_labels = labels.get("Label_A_en_beter", 0) + labels.get("Label_B", 0) + labels.get("Label_C", 0)
    poor_labels = labels.get("Label_E", 0) + labels.get("Label_F", 0) + labels.get("Label_G", 0)
    apartments = types.get("Meersgezinswoning_laag_midden", 0) + types.get("Meersgezinswoning_hoog", 0)
    row_homes = bucket["woningen"] or label_total or type_total

    return {
        "wijkcode": bucket["wijkcode"],
        "wijknaam": bucket.get("wijknaam", ""),
        "gemeentecode": bucket.get("gemeentecode", ""),
        "gemeente": bucket.get("gemeente", ""),
        "pbl_woningen": round(bucket["woningen"]),
        "pbl_utiliteit_aansluitingen": round(bucket["utiliteit"]),
        "pbl_woningequivalenten": round(bucket["woningequivalenten"]),
        "pbl_co2_startjaar_ton_jaar": round(bucket["co2_startjaar_ton"]),
        "pbl_dominant_label": dominant_label(labels),
        "pbl_label_counts": {key: round(value) for key, value in labels.items()},
        "pbl_label_a_b_c_pct": pct(good_labels, label_total),
        "pbl_label_e_f_g_pct": pct(poor_labels, label_total),
        "pbl_geen_label_pct": pct(labels.get("Geen_label", 0), label_total),
        "pbl_bouwjaar_tot_1975_pct": pct(old_until_1975, bouw_total),
        "pbl_appartement_pct": pct(apartments, type_total),
        "pbl_vrijstaand_pct": pct(types.get("Vrijstaande_woning", 0), type_total),
        "pbl_laagste_strategie_code": best_strategy,
        "pbl_laagste_strategie": STRATEGY_LABELS.get(best_strategy, best_strategy or "Onbekend"),
        "pbl_laagste_strategie_dekking_pct": pct(best_strategy_weight, row_homes),
        "pbl_nat_meerkost_eur_jaar": round(bucket["nat_meerkost_eur_jaar"]),
        "pbl_nat_meerkost_eur_ton_co2": round(
            bucket["nat_meerkost_co2_weighted"] / bucket["nat_meerkost_co2_weight"]
        )
        if bucket["nat_meerkost_co2_weight"]
        else None,
        "pbl_nat_meerkost_eur_weq_jaar": round(
            bucket["nat_meerkost_weq_weighted"] / bucket["nat_meerkost_weq_weight"]
        )
        if bucket["nat_meerkost_weq_weight"]
        else None,
    }


def main():
    aggregate = defaultdict(empty_bucket)
    imported = []
    failed = []

    for gemeente in ZEELAND_GEMEENTEN:
        try:
            url, zip_file = fetch_zip(gemeente)
            merge_bebouwing(aggregate, read_csv_from_zip(zip_file, "_totaalbebouwing.csv"))
            merge_strategie(aggregate, read_csv_from_zip(zip_file, "_strategie.csv"))
            imported.append({"gemeente": gemeente, "url": url})
            print(f"OK {gemeente}")
        except Exception as exc:
            failed.append({"gemeente": gemeente, "error": str(exc)})
            print(f"FOUT {gemeente}: {exc}", file=sys.stderr)

    rows = [finalize_row(bucket) for bucket in aggregate.values()]
    rows.sort(key=lambda row: (row["gemeente"], row["wijkcode"]))
    payload = {
        "source": "PBL Startanalyse aardgasvrije buurten 2025",
        "source_url": "https://dataportaal.pbl.nl/Startanalyse_aardgasvrije_buurten",
        "generated_by": "scripts/update_pbl_data.py",
        "imported": imported,
        "failed": failed,
        "notes": [
            "PBL levert buurtdata; dit script groepeert naar CBS-wijkcode zodat het aansluit op de dashboardkaart.",
            "Nationale meerkosten zijn PBL-indicatoren per jaar, per ton CO2 of per woningequivalent; dit is geen directe offerte voor een woning.",
            "Energielabelvelden komen uit de PBL Startanalyse en zijn bruikbaar als openbare labelverdeling wanneer EP-Online nog niet met API-key is gekoppeld.",
        ],
        "rows": rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Opgeslagen: {OUT_PATH}")
    print(f"Aantal wijken met PBL-data: {len(rows)}")
    if failed:
        print(f"Niet gelukt: {len(failed)} gemeente(n)", file=sys.stderr)


if __name__ == "__main__":
    main()
