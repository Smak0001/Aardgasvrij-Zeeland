from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import csv
import io
import json
import mimetypes


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
REAL_DATA_PATH = DATA_DIR / "wijken_zeeland_2024.json"
PBL_DATA_PATH = DATA_DIR / "pbl_startanalyse_2025.json"
PBL_CACHE = None

MODEL_ASSUMPTIONS = {
    "gas_price_eur_per_m3": 1.35,
    "electricity_price_eur_per_kwh": 0.31,
    "co2_kg_per_m3_gas": 1.79,
    "subsidy_cap_eur": 6200,
    "label_method": "PBL Startanalyse 2025 energielabelverdeling waar beschikbaar; anders grove schatting op basis van gemiddeld CBS-aardgasverbruik per wijk.",
    "subsidy_method": "ISDE en Zeeuws Isolatieprogramma zijn als actuele regelingsbronnen opgenomen; exacte subsidiebedragen blijven afhankelijk van maatregel, meldcode, gemeente en inkomen.",
}

PROJECT_SCOPE = {
    "client_goal": "Inzicht krijgen in kansrijke startpunten voor aardgasvrij of aardgasvrij-ready dorpen en wijken in Zeeland.",
    "preferred_scale": "Wijk- of dorpsniveau. Individuele woningen vallen voorlopig buiten scope, omdat openbare data vaak geaggregeerd is.",
    "success_definition": "Een gebruiksvriendelijk dashboard dat kansrijke buurten toont en de technische en financiële motivatie uitlegbaar maakt.",
    "client_context": "RES Zeeland werkt samen met de provincie, 13 gemeenten en het waterschap aan CO2-reductie richting 2030 en aardgasvrij richting 2050.",
    "central_question": "Wat kost het om de Zeeuwse woningvoorraad aardgasvrij te maken en in welke wijken en buurten kan dit tegen de laagste maatschappelijke kosten?",
    "resident_question": "Wat betekent de energietransitie voor mijn woning en mijn portemonnee?",
    "res_2030_goals": [
        "3 TWh duurzame energie opwekken",
        "700 MW windenergie",
        "1.000 MW zonne-energie",
        "59.000 woningen isoleren",
        "50% minder aardgasverbruik ten opzichte van 1990",
    ],
    "sdgs": [
        "SDG 7 - Betaalbare en duurzame energie",
        "SDG 9 - Industrie, Innovatie en Infrastructuur",
        "SDG 10 - Ongelijkheid verminderen",
        "SDG 11 - Duurzame steden en gemeenschappen",
        "SDG 13 - Klimaatactie",
    ],
}

DATA_SOURCES = [
    {
        "name": "CBS / PDOK Wijk- en Buurtkaart 2024",
        "status": "In gebruik",
        "type": "Openbare data",
        "url": "https://api.pdok.nl/cbs/wijken-en-buurten-2024/ogc/v1?f=html&lang=nl",
        "use": "Wijklocaties, woningvoorraad, gemiddeld gasverbruik en elektriciteitsverbruik.",
        "risk": "Geeft gemiddelden per wijk; niet geschikt om losse woningen exact te beoordelen.",
    },
    {
        "name": "CBS StatLine 85984NED",
        "status": "In gebruik via CBS/PDOK",
        "type": "Openbare data",
        "url": "https://opendata.cbs.nl/statline/CBS/nl/dataset/85984NED",
        "use": "Bronlaag achter wijk- en buurtkerncijfers, waaronder woningen en energiegebruik.",
        "risk": "StatLine is minder handig voor kaartgeometrie; daarom gebruikt de app PDOK voor dezelfde wijkcodes.",
    },
    {
        "name": "PBL Startanalyse aardgasvrije buurten 2025",
        "status": "In gebruik",
        "type": "Openbare data",
        "url": "https://dataportaal.pbl.nl/Startanalyse_aardgasvrije_buurten",
        "use": "Energielabelverdeling, gebouwvoorraad, CO2-startjaar, laagste nationale kosten en voorkeursstrategie per buurt, gegroepeerd naar wijk.",
        "risk": "Nationale kosten zijn modelindicatoren, geen offerte of exacte investering per woning.",
    },
    {
        "name": "BAG - Basisregistratie Adressen en Gebouwen",
        "status": "Klaar om te koppelen",
        "type": "Officiële gebouwregistratie",
        "url": "https://api.pdok.nl/kadaster/bag/ogc/v2?f=html&lang=nl",
        "use": "Gebouw-, verblijfsobject- en adresdata voor detailanalyse als er later op pandniveau gewerkt mag worden.",
        "risk": "Voor wijkcijfers is een ruimtelijke koppeling nodig; de huidige opdracht blijft bewust wijk/dorpsniveau.",
    },
    {
        "name": "Klimaatmonitor Zeeland",
        "status": "Bron toegevoegd",
        "type": "Openbare data/API",
        "url": "https://klimaatmonitor.databank.nl/content/klimaatmonitor-api",
        "use": "Aanvullende gemeentelijke energie- en klimaatindicatoren voor latere sprintverdieping.",
        "risk": "Niet elk veld is op wijkniveau beschikbaar; veldkeuze moet nog samen met opdrachtgever worden vastgesteld.",
    },
    {
        "name": "EP-online / RVO",
        "status": "API-key nodig",
        "type": "Officiële energielabeldata",
        "url": "https://ep-online.nl/PublicData",
        "use": "Echte energielabels in plaats van een geschat energieprofiel.",
        "risk": "API-key of aanvullende toestemming nodig; PBL-labelverdeling wordt gebruikt als openbare tussenoplossing.",
    },
    {
        "name": "RVO ISDE woningeigenaren",
        "status": "Bron toegevoegd",
        "type": "Subsidie-informatie",
        "url": "https://www.rvo.nl/subsidies-financiering/isde/woningeigenaren",
        "use": "Actuele landelijke subsidiebron voor isolatie, warmtepompen, zonneboilers en aansluitingen.",
        "risk": "Exact bedrag hangt af van maatregel en apparaat/meldcode; dashboard rekent daarom indicatief.",
    },
    {
        "name": "Zeeuws Isolatieprogramma",
        "status": "Bron toegevoegd",
        "type": "Lokale subsidie/ondersteuning",
        "url": "https://www.zeeuwsisolatieprogramma.nl/",
        "use": "Lokale ondersteuning voor isolatie in Zeeuwse gemeenten.",
        "risk": "Regels verschillen per gemeente/doelgroep; exacte check hoort bij woningeigenaar of gemeente.",
    },
]

HOME_SCAN_PROFILES = {
    "rijwoning": {
        "name": "Rijwoning",
        "cost_factor": 0.92,
        "gas_factor": 0.92,
        "measures": ["Isolatiecheck", "HR++ of triple glas", "Ventilatie verbeteren", "Hybride of all-electric warmtepomp"],
    },
    "hoekwoning": {
        "name": "Hoekwoning / 2-onder-1-kap",
        "cost_factor": 1.08,
        "gas_factor": 1.08,
        "measures": ["Dak- en gevelisolatie", "Glas verbeteren", "Lage-temperatuurverwarming testen", "Warmtepompvariant onderzoeken"],
    },
    "vrijstaand": {
        "name": "Vrijstaande woning",
        "cost_factor": 1.26,
        "gas_factor": 1.22,
        "measures": ["Uitgebreide schilisolatie", "Glas verbeteren", "Warmtepomp met voldoende vermogen", "Zonnepanelen en buffervat onderzoeken"],
    },
    "appartement": {
        "name": "Appartement",
        "cost_factor": 0.74,
        "gas_factor": 0.78,
        "measures": ["Collectieve afspraken VvE/checken", "Glas en ventilatie", "Warmtenet of collectieve oplossing onderzoeken"],
    },
}



WIJKEN = [
    {
        "id": "middelburg-dauwendaele",
        "gemeente": "Middelburg",
        "wijk": "Dauwendaele",
        "woningen": 3180,
        "bouwjaar": 1978,
        "label": "C",
        "gas_m3": 1190,
        "elek_kwh": 2850,
        "isolatie": 66,
        "netcapaciteit": 58,
        "draagvlak": 64,
        "lat": 51.49,
        "lng": 3.62,
        "basis_kosten": 23800,
        "warmtenet": 19800,
    },
    {
        "id": "middelburg-binnenstad",
        "gemeente": "Middelburg",
        "wijk": "Binnenstad",
        "woningen": 2360,
        "bouwjaar": 1938,
        "label": "D",
        "gas_m3": 1420,
        "elek_kwh": 2600,
        "isolatie": 47,
        "netcapaciteit": 51,
        "draagvlak": 61,
        "lat": 51.50,
        "lng": 3.61,
        "basis_kosten": 32500,
        "warmtenet": 26300,
    },
    {
        "id": "vlissingen-paauwenburg",
        "gemeente": "Vlissingen",
        "wijk": "Paauwenburg",
        "woningen": 2910,
        "bouwjaar": 1971,
        "label": "C",
        "gas_m3": 1260,
        "elek_kwh": 2940,
        "isolatie": 61,
        "netcapaciteit": 55,
        "draagvlak": 59,
        "lat": 51.46,
        "lng": 3.56,
        "basis_kosten": 25100,
        "warmtenet": 21000,
    },
    {
        "id": "vlissingen-binnenstad",
        "gemeente": "Vlissingen",
        "wijk": "Binnenstad",
        "woningen": 2540,
        "bouwjaar": 1949,
        "label": "D",
        "gas_m3": 1390,
        "elek_kwh": 2680,
        "isolatie": 50,
        "netcapaciteit": 48,
        "draagvlak": 57,
        "lat": 51.44,
        "lng": 3.57,
        "basis_kosten": 30600,
        "warmtenet": 24500,
    },
    {
        "id": "goes-goes-oost",
        "gemeente": "Goes",
        "wijk": "Goes-Oost",
        "woningen": 2760,
        "bouwjaar": 1984,
        "label": "B",
        "gas_m3": 1060,
        "elek_kwh": 3020,
        "isolatie": 73,
        "netcapaciteit": 66,
        "draagvlak": 67,
        "lat": 51.50,
        "lng": 3.91,
        "basis_kosten": 20600,
        "warmtenet": 19000,
    },
    {
        "id": "goes-goes-zuid",
        "gemeente": "Goes",
        "wijk": "Goes-Zuid",
        "woningen": 2430,
        "bouwjaar": 1974,
        "label": "C",
        "gas_m3": 1225,
        "elek_kwh": 2890,
        "isolatie": 63,
        "netcapaciteit": 61,
        "draagvlak": 60,
        "lat": 51.49,
        "lng": 3.90,
        "basis_kosten": 23600,
        "warmtenet": 20500,
    },
    {
        "id": "terneuzen-zuid",
        "gemeente": "Terneuzen",
        "wijk": "Terneuzen-Zuid",
        "woningen": 2890,
        "bouwjaar": 1976,
        "label": "C",
        "gas_m3": 1280,
        "elek_kwh": 3050,
        "isolatie": 59,
        "netcapaciteit": 57,
        "draagvlak": 55,
        "lat": 51.31,
        "lng": 3.84,
        "basis_kosten": 25200,
        "warmtenet": 21300,
    },
    {
        "id": "terneuzen-oude-vaart",
        "gemeente": "Terneuzen",
        "wijk": "Oude Vaart",
        "woningen": 1920,
        "bouwjaar": 1991,
        "label": "B",
        "gas_m3": 980,
        "elek_kwh": 3150,
        "isolatie": 78,
        "netcapaciteit": 62,
        "draagvlak": 63,
        "lat": 51.33,
        "lng": 3.85,
        "basis_kosten": 18800,
        "warmtenet": 17600,
    },
    {
        "id": "schouwen-westerschouwen",
        "gemeente": "Schouwen-Duiveland",
        "wijk": "Westerschouwen",
        "woningen": 1510,
        "bouwjaar": 1963,
        "label": "D",
        "gas_m3": 1510,
        "elek_kwh": 2750,
        "isolatie": 44,
        "netcapaciteit": 45,
        "draagvlak": 54,
        "lat": 51.69,
        "lng": 3.73,
        "basis_kosten": 34200,
        "warmtenet": 31900,
    },
    {
        "id": "schouwen-zierikzee",
        "gemeente": "Schouwen-Duiveland",
        "wijk": "Zierikzee",
        "woningen": 3220,
        "bouwjaar": 1958,
        "label": "D",
        "gas_m3": 1475,
        "elek_kwh": 2710,
        "isolatie": 49,
        "netcapaciteit": 52,
        "draagvlak": 62,
        "lat": 51.65,
        "lng": 3.92,
        "basis_kosten": 31800,
        "warmtenet": 27100,
    },
    {
        "id": "hulst-binnenstad",
        "gemeente": "Hulst",
        "wijk": "Binnenstad Hulst",
        "woningen": 1710,
        "bouwjaar": 1947,
        "label": "D",
        "gas_m3": 1440,
        "elek_kwh": 2620,
        "isolatie": 46,
        "netcapaciteit": 49,
        "draagvlak": 58,
        "lat": 51.28,
        "lng": 4.05,
        "basis_kosten": 31900,
        "warmtenet": 27900,
    },
    {
        "id": "hulst-sint-jansteen",
        "gemeente": "Hulst",
        "wijk": "Sint Jansteen",
        "woningen": 1380,
        "bouwjaar": 1987,
        "label": "B",
        "gas_m3": 1030,
        "elek_kwh": 3010,
        "isolatie": 76,
        "netcapaciteit": 60,
        "draagvlak": 65,
        "lat": 51.26,
        "lng": 4.04,
        "basis_kosten": 19600,
        "warmtenet": 18400,
    },
    {
        "id": "veere-koudekerke",
        "gemeente": "Veere",
        "wijk": "Koudekerke",
        "woningen": 1260,
        "bouwjaar": 1970,
        "label": "C",
        "gas_m3": 1295,
        "elek_kwh": 2860,
        "isolatie": 58,
        "netcapaciteit": 56,
        "draagvlak": 60,
        "lat": 51.48,
        "lng": 3.55,
        "basis_kosten": 25900,
        "warmtenet": 22300,
    },
    {
        "id": "veere-domburg",
        "gemeente": "Veere",
        "wijk": "Domburg",
        "woningen": 970,
        "bouwjaar": 1953,
        "label": "D",
        "gas_m3": 1525,
        "elek_kwh": 2810,
        "isolatie": 43,
        "netcapaciteit": 46,
        "draagvlak": 56,
        "lat": 51.56,
        "lng": 3.50,
        "basis_kosten": 35100,
        "warmtenet": 33200,
    },
    {
        "id": "tholen-stad",
        "gemeente": "Tholen",
        "wijk": "Tholen",
        "woningen": 2140,
        "bouwjaar": 1982,
        "label": "C",
        "gas_m3": 1180,
        "elek_kwh": 2925,
        "isolatie": 68,
        "netcapaciteit": 64,
        "draagvlak": 61,
        "lat": 51.53,
        "lng": 4.22,
        "basis_kosten": 22400,
        "warmtenet": 21200,
    },
    {
        "id": "boresele-heinkenszand",
        "gemeente": "Borsele",
        "wijk": "Heinkenszand",
        "woningen": 1850,
        "bouwjaar": 1993,
        "label": "B",
        "gas_m3": 960,
        "elek_kwh": 3120,
        "isolatie": 80,
        "netcapaciteit": 69,
        "draagvlak": 66,
        "lat": 51.47,
        "lng": 3.82,
        "basis_kosten": 18100,
        "warmtenet": 17400,
    },
]


def load_wijken():
    if REAL_DATA_PATH.exists():
        with REAL_DATA_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return [merge_pbl_data(row) for row in payload.get("rows", WIJKEN)]
    return WIJKEN


def load_pbl_by_wijkcode():
    global PBL_CACHE
    if PBL_CACHE is not None:
        return PBL_CACHE
    if not PBL_DATA_PATH.exists():
        PBL_CACHE = {}
        return {}
    with PBL_DATA_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    PBL_CACHE = {
        row["wijkcode"].upper(): row
        for row in payload.get("rows", [])
        if row.get("wijkcode")
    }
    return PBL_CACHE


def merge_pbl_data(row):
    pbl_row = load_pbl_by_wijkcode().get(str(row.get("cbs_wijkcode", "")).upper())
    if not pbl_row:
        return row

    merged = {**row, **pbl_row}
    label = pbl_row.get("pbl_dominant_label")
    if label and label != "Onbekend":
        merged["label"] = label
        merged["label_status"] = "PBL Startanalyse 2025"
        merged["label_source"] = (
            "Openbare PBL Startanalyse 2025 energielabelverdeling, "
            "gegroepeerd naar wijkcode. Dit is geen losse EP-online woninglookup."
        )

    pbl_good = pbl_row.get("pbl_label_a_b_c_pct")
    pbl_poor = pbl_row.get("pbl_label_e_f_g_pct")
    pbl_old = pbl_row.get("pbl_bouwjaar_tot_1975_pct")
    if pbl_good is not None and pbl_poor is not None and pbl_old is not None:
        merged["isolatie"] = round(clamp(42 + pbl_good * 0.48 - pbl_poor * 0.34 - pbl_old * 0.12))

    pbl_cost = pbl_row.get("pbl_nat_meerkost_eur_weq_jaar")
    if pbl_cost is not None:
        merged["pbl_finance_score"] = round(clamp(100 - ((pbl_cost - 350) / 18), 8, 96))

    return merged


SCENARIOS = {
    "all-electric": {
        "name": "All-electric",
        "cost_factor": 1.0,
        "gas_reduction": 0.96,
        "electricity_extra": 1850,
        "comfort_bonus": 7,
    },
    "hybride": {
        "name": "Hybride warmtepomp",
        "cost_factor": 0.58,
        "gas_reduction": 0.62,
        "electricity_extra": 780,
        "comfort_bonus": 4,
    },
    "warmtenet": {
        "name": "Warmtenet",
        "cost_factor": 1.0,
        "gas_reduction": 0.9,
        "electricity_extra": 220,
        "comfort_bonus": 5,
    },
}


def money(value):
    return round(value, 2)


def clamp(value, low=0, high=100):
    return max(low, min(high, value))


def classify_strategy(row, net_investment, yearly_saving, chance_score):
    if row["isolatie"] < 55 and row["gas_m3"] >= 1300:
        return {
            "name": "Eerst isoleren",
            "priority": "Voorbereiden",
            "description": "Deze wijk heeft relatief veel besparingspotentie, maar moet waarschijnlijk eerst naar aardgasvrij-ready worden gebracht.",
        }
    if chance_score >= 70 and net_investment <= 24000 and yearly_saving > 0:
        return {
            "name": "Snel starten",
            "priority": "Hoog",
            "description": "Technische en financiële voorwaarden komen gunstig samen. Dit is geschikt als eerste startpunt voor verder onderzoek.",
        }
    if row["draagvlak"] >= 66 and chance_score >= 58:
        return {
            "name": "Lokaal afwegen",
            "priority": "Midden",
            "description": "De data is redelijk kansrijk, maar lokale politieke keuzes en draagvlak bepalen of dit echt een startwijk wordt.",
        }
    if yearly_saving <= 0 or net_investment > 32000:
        return {
            "name": "Later oppakken",
            "priority": "Laag",
            "description": "De financiële uitgangspunten zijn minder gunstig. Eerst betere data of een andere aanpak onderzoeken.",
        }
    return {
        "name": "Verder onderzoeken",
        "priority": "Midden",
        "description": "Er zijn kansen zichtbaar, maar er is aanvullende data nodig voordat dit als startgebied gekozen kan worden.",
    }


def data_quality(row):
    missing_optional = sum(
        1
        for field in ("woz_waarde_x1000", "koopwoningen_pct", "zonnestroom_pct", "aardgasvrij_pct")
        if row.get(field) in (None, "")
    )
    score = 100 - missing_optional * 12
    if row.get("label_status") == "geschat":
        score -= 18
    if "modelvelden" in row:
        score -= 8
    return clamp(score, 35, 95)


def enriched(row, scenario_key="all-electric", horizon=20):
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["all-electric"])
    base_cost = row["warmtenet"] if scenario_key == "warmtenet" else row["basis_kosten"]
    investment = base_cost * scenario["cost_factor"]
    subsidy = min(MODEL_ASSUMPTIONS["subsidy_cap_eur"], investment * (0.18 if scenario_key != "hybride" else 0.14))
    net_investment = investment - subsidy
    gas_price = MODEL_ASSUMPTIONS["gas_price_eur_per_m3"]
    electricity_price = MODEL_ASSUMPTIONS["electricity_price_eur_per_kwh"]
    yearly_saving = (row["gas_m3"] * scenario["gas_reduction"] * gas_price) - (
        scenario["electricity_extra"] * electricity_price
    )
    horizon_benefit = yearly_saving * horizon
    net_result = horizon_benefit - net_investment
    payback = net_investment / yearly_saving if yearly_saving > 0 else None
    co2_kg = row["gas_m3"] * scenario["gas_reduction"] * MODEL_ASSUMPTIONS["co2_kg_per_m3_gas"]
    affordability = clamp(100 - ((net_investment - 14000) / 240))
    finance_input = row.get("pbl_finance_score", affordability)
    finance_component = finance_input * 0.36
    technical_component = row["isolatie"] * 0.23
    grid_component = row["netcapaciteit"] * 0.21
    local_component = row["draagvlak"] * 0.20
    chance_score = clamp(
        finance_component
        + technical_component
        + grid_component
        + local_component
        + scenario["comfort_bonus"],
        1,
        100,
    )
    rounded_score = round(chance_score)
    strategy = classify_strategy(row, net_investment, yearly_saving, rounded_score)
    quality = data_quality(row)
    return {
        **row,
        "scenario": scenario["name"],
        "horizon": horizon,
        "schaalniveau": "wijk/dorp",
        "investering": money(investment),
        "subsidie": money(subsidy),
        "netto_investering": money(net_investment),
        "jaarlijkse_besparing": money(yearly_saving),
        "voordeel_horizon": money(horizon_benefit),
        "netto_resultaat": money(net_result),
        "voordeel_10_jaar": money(yearly_saving * 10),
        "voordeel_20_jaar": money(yearly_saving * 20),
        "voordeel_30_jaar": money(yearly_saving * 30),
        "maatschappelijke_investering": money(net_investment * row["woningen"]),
        "maatschappelijke_besparing_jaar": money(yearly_saving * row["woningen"]),
        "terugverdientijd": round(payback, 1) if payback is not None else None,
        "co2_kg": round(co2_kg),
        "co2_ton_wijk": round((co2_kg * row["woningen"]) / 1000),
        "kansscore": rounded_score,
        "strategie": strategy["name"],
        "strategie_prioriteit": strategy["priority"],
        "strategie_toelichting": strategy["description"],
        "datakwaliteit": round(quality),
        "score_opbouw": {
            "financieel": round(finance_component, 1),
            "isolatie": round(technical_component, 1),
            "netcapaciteit": round(grid_component, 1),
            "draagvlak": round(local_component, 1),
            "scenario_bonus": scenario["comfort_bonus"],
        },
        "modelvelden": ["label", "basis_kosten", "warmtenet", "isolatie", "netcapaciteit", "draagvlak", "kansscore"],
        "echte_bronvelden": ["woningvoorraad", "gas_m3", "elek_kwh", "lat", "lng", "PBL energielabelverdeling", "PBL nationale meerkosten"],
        "volgende_datavraag": "Controleer met opdrachtgever of er betere lokale data is voor draagvlak, netcapaciteit en officiële energielabels.",
    }


def apply_filters(params):
    gemeente = params.get("gemeente", ["alle"])[0]
    scenario = params.get("scenario", ["all-electric"])[0]
    horizon = int(params.get("horizon", ["20"])[0])
    max_cost = int(params.get("max_cost", ["999999"])[0])
    source_rows = load_wijken()
    rows = [enriched(row, scenario, horizon) for row in source_rows]
    if gemeente != "alle":
        rows = [row for row in rows if row["gemeente"] == gemeente]
    rows = [row for row in rows if row["netto_investering"] <= max_cost]
    return sorted(rows, key=lambda item: item["kansscore"], reverse=True)


def overview(rows):
    if not rows:
        return {
            "woningen": 0,
            "gemiddelde_kosten": 0,
            "gemiddelde_besparing": 0,
            "totale_co2_ton": 0,
            "top_wijk": "-",
            "gemiddelde_score": 0,
            "gemiddelde_datakwaliteit": 0,
        }
    woningen = sum(row["woningen"] for row in rows)
    return {
        "woningen": woningen,
        "gemiddelde_kosten": round(
            sum(row["netto_investering"] * row["woningen"] for row in rows) / woningen
        ),
        "gemiddelde_besparing": round(
            sum(row["jaarlijkse_besparing"] * row["woningen"] for row in rows) / woningen
        ),
        "totale_co2_ton": round(sum(row["co2_kg"] * row["woningen"] for row in rows) / 1000),
        "top_wijk": f"{rows[0]['wijk']} ({rows[0]['gemeente']})",
        "gemiddelde_score": round(sum(row["kansscore"] for row in rows) / len(rows)),
        "gemiddelde_datakwaliteit": round(sum(row["datakwaliteit"] for row in rows) / len(rows)),
    }


def int_param(params, name, fallback):
    try:
        return int(params.get(name, [fallback])[0])
    except (TypeError, ValueError):
        return fallback


def float_param(params, name, fallback):
    try:
        return float(params.get(name, [fallback])[0])
    except (TypeError, ValueError):
        return fallback


def label_cost_factor(label):
    return {
        "A/B": 0.82,
        "C": 0.96,
        "D": 1.12,
        "E": 1.26,
        "F/G": 1.42,
    }.get(label, 1.05)


def scan_home(params):
    scenario_key = params.get("scenario", ["all-electric"])[0]
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["all-electric"])
    woningtype = params.get("woningtype", ["rijwoning"])[0]
    profile = HOME_SCAN_PROFILES.get(woningtype, HOME_SCAN_PROFILES["rijwoning"])
    label = params.get("label", ["C"])[0]
    bouwjaar = int_param(params, "bouwjaar", 1975)
    gas_m3 = int_param(params, "gas_m3", 1200)
    elek_kwh = int_param(params, "elek_kwh", 2900)
    oppervlakte = int_param(params, "oppervlakte", 115)
    wijk_id = params.get("wijk_id", [""])[0]

    age_factor = 1.18 if bouwjaar < 1975 else 1.08 if bouwjaar < 1992 else 0.98 if bouwjaar < 2010 else 0.82
    size_factor = clamp(oppervlakte / 115, 0.72, 1.55)
    base_cost = 18500 * profile["cost_factor"] * label_cost_factor(label) * age_factor * (0.82 + size_factor * 0.18)
    if scenario_key == "hybride":
        base_cost *= 0.58
    if scenario_key == "warmtenet":
        base_cost *= 0.86

    subsidy = min(MODEL_ASSUMPTIONS["subsidy_cap_eur"], base_cost * (0.18 if scenario_key != "hybride" else 0.14))
    loan_hint = max(0, base_cost - subsidy)
    yearly_saving = (gas_m3 * scenario["gas_reduction"] * MODEL_ASSUMPTIONS["gas_price_eur_per_m3"]) - (
        scenario["electricity_extra"] * MODEL_ASSUMPTIONS["electricity_price_eur_per_kwh"]
    )
    payback = loan_hint / yearly_saving if yearly_saving > 0 else None

    rows = [enriched(row, scenario_key, 20) for row in load_wijken()]
    wijk = next((row for row in rows if row["id"] == wijk_id), None)
    comparison = None
    if wijk:
        comparison = {
            "wijk": f"{wijk['wijk']} ({wijk['gemeente']})",
            "wijk_gas_m3": wijk["gas_m3"],
            "woning_gas_m3": gas_m3,
            "verschil_gas_m3": gas_m3 - wijk["gas_m3"],
            "wijk_netto_investering": wijk["netto_investering"],
            "woning_netto_investering": money(loan_hint),
            "wijk_kansscore": wijk["kansscore"],
            "wijk_strategie": wijk["strategie"],
        }

    return {
        "input": {
            "woningtype": profile["name"],
            "bouwjaar": bouwjaar,
            "label": label,
            "gas_m3": gas_m3,
            "elek_kwh": elek_kwh,
            "oppervlakte": oppervlakte,
            "scenario": scenario["name"],
        },
        "result": {
            "bruto_investering": money(base_cost),
            "geschatte_subsidie": money(subsidy),
            "te_financieren": money(loan_hint),
            "jaarlijkse_besparing": money(yearly_saving),
            "voordeel_10_jaar": money(yearly_saving * 10),
            "voordeel_20_jaar": money(yearly_saving * 20),
            "voordeel_30_jaar": money(yearly_saving * 30),
            "terugverdientijd": round(payback, 1) if payback is not None else None,
            "co2_kg": round(gas_m3 * scenario["gas_reduction"] * MODEL_ASSUMPTIONS["co2_kg_per_m3_gas"]),
            "maatregelen": profile["measures"],
            "financiering": [
                "Subsidies en leningen zijn in dit prototype indicatief.",
                "Controleer actuele regelingen via RVO, gemeente/provincie en het Nationaal Warmtefonds.",
            ],
        },
        "comparison": comparison,
    }


def json_response(handler, payload, status=200):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/api/wijken":
            source_rows = load_wijken()
            rows = apply_filters(params)
            json_response(
                self,
                {
                    "meta": {
                        "gemeenten": sorted({row["gemeente"] for row in source_rows}),
                        "scenarios": SCENARIOS,
                        "source": "CBS/PDOK Wijk- en Buurtkaart 2024" if REAL_DATA_PATH.exists() else "Demo-data",
                        "assumptions": MODEL_ASSUMPTIONS,
                        "project_scope": PROJECT_SCOPE,
                        "data_sources": DATA_SOURCES,
                        "verified_fields": ["woningvoorraad", "gemiddeld aardgasverbruik", "gemiddeld elektriciteitsverbruik", "wijklocatie"],
                        "model_fields": ["energieprofiel/label", "kosten", "subsidie", "netcapaciteit", "draagvlak", "kansscore"],
                        "disclaimer": "Woningvoorraad, gasverbruik, elektriciteit en wijklocaties komen uit CBS/PDOK 2024. Energieprofiel/label, kosten, draagvlak en netcapaciteit zijn modelinschattingen voor het schoolprototype, geen officiële EP-online labels. De opdracht is bewust gericht op wijk- of dorpsniveau, niet op individuele woningen.",
                    },
                    "overview": overview(rows),
                    "rows": rows,
                },
            )
            return

        if parsed.path == "/api/woningscan":
            json_response(self, scan_home(params))
            return

        if parsed.path == "/api/export.csv":
            rows = apply_filters(params)
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()) if rows else [])
            if rows:
                writer.writeheader()
                writer.writerows(rows)
            data = stream.getvalue().encode("utf-8-sig")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", "attachment; filename=aardgasvrij-startkansen.csv")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        self.serve_static(parsed.path)

    def serve_static(self, request_path):
        path = "/index.html" if request_path in ("", "/") else request_path
        safe_path = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if not str(safe_path).startswith(str(PUBLIC_DIR.resolve())) or not safe_path.exists():
            self.send_error(404)
            return

        content_type, _ = mimetypes.guess_type(str(safe_path))
        data = safe_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), DashboardHandler)
    print("Dashboard draait op http://127.0.0.1:8000")
    server.serve_forever()
