"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const REAL_DATA_PATH = path.join(BASE_DIR, "data", "wijken_zeeland_2024.json");
const PBL_DATA_PATH = path.join(BASE_DIR, "data", "pbl_startanalyse_2025.json");

const MODEL_ASSUMPTIONS = {
  gas_price_eur_per_m3: 1.35,
  electricity_price_eur_per_kwh: 0.31,
  co2_kg_per_m3_gas: 1.79,
  subsidy_cap_eur: 6200,
  label_method:
    "PBL Startanalyse 2025 energielabelverdeling waar beschikbaar; anders grove schatting op basis van gemiddeld CBS-aardgasverbruik per wijk.",
  subsidy_method:
    "ISDE en Zeeuws Isolatieprogramma zijn als actuele regelingsbronnen opgenomen; exacte subsidiebedragen blijven afhankelijk van maatregel, meldcode, gemeente en inkomen.",
};

const PROJECT_SCOPE = {
  client_goal:
    "Inzicht krijgen in kansrijke startpunten voor aardgasvrij of aardgasvrij-ready dorpen en wijken in Zeeland.",
  preferred_scale:
    "Wijk- of dorpsniveau. Individuele woningen vallen voorlopig buiten scope, omdat openbare data vaak geaggregeerd is.",
  success_definition:
    "Een gebruiksvriendelijk dashboard dat kansrijke buurten toont en de technische en financiele motivatie uitlegbaar maakt.",
  client_context:
    "RES Zeeland werkt samen met de provincie, 13 gemeenten en het waterschap aan CO2-reductie richting 2030 en aardgasvrij richting 2050.",
  central_question:
    "Wat kost het om de Zeeuwse woningvoorraad aardgasvrij te maken en in welke wijken en buurten kan dit tegen de laagste maatschappelijke kosten?",
  resident_question: "Wat betekent de energietransitie voor mijn woning en mijn portemonnee?",
  res_2030_goals: [
    "3 TWh duurzame energie opwekken",
    "700 MW windenergie",
    "1.000 MW zonne-energie",
    "59.000 woningen isoleren",
    "50% minder aardgasverbruik ten opzichte van 1990",
  ],
  sdgs: [
    "SDG 7 - Betaalbare en duurzame energie",
    "SDG 9 - Industrie, Innovatie en Infrastructuur",
    "SDG 10 - Ongelijkheid verminderen",
    "SDG 11 - Duurzame steden en gemeenschappen",
    "SDG 13 - Klimaatactie",
  ],
};

const DATA_SOURCES = [
  {
    name: "CBS / PDOK Wijk- en Buurtkaart 2024",
    status: "In gebruik",
    type: "Openbare data",
    url: "https://api.pdok.nl/cbs/wijken-en-buurten-2024/ogc/v1?f=html&lang=nl",
    use: "Wijklocaties, woningvoorraad, gemiddeld gasverbruik en elektriciteitsverbruik.",
    risk: "Geeft gemiddelden per wijk; niet geschikt om losse woningen exact te beoordelen.",
  },
  {
    name: "CBS StatLine 85984NED",
    status: "In gebruik via CBS/PDOK",
    type: "Openbare data",
    url: "https://opendata.cbs.nl/statline/CBS/nl/dataset/85984NED",
    use: "Bronlaag achter wijk- en buurtkerncijfers, waaronder woningen en energiegebruik.",
    risk: "StatLine is minder handig voor kaartgeometrie; daarom gebruikt de app PDOK voor dezelfde wijkcodes.",
  },
  {
    name: "PBL Startanalyse aardgasvrije buurten 2025",
    status: "In gebruik",
    type: "Openbare data",
    url: "https://dataportaal.pbl.nl/Startanalyse_aardgasvrije_buurten",
    use: "Energielabelverdeling, gebouwvoorraad, CO2-startjaar, laagste nationale kosten en voorkeursstrategie per buurt, gegroepeerd naar wijk.",
    risk: "Nationale kosten zijn modelindicatoren, geen offerte of exacte investering per woning.",
  },
  {
    name: "BAG - Basisregistratie Adressen en Gebouwen",
    status: "Klaar om te koppelen",
    type: "Officiele gebouwregistratie",
    url: "https://api.pdok.nl/kadaster/bag/ogc/v2?f=html&lang=nl",
    use: "Gebouw-, verblijfsobject- en adresdata voor detailanalyse als er later op pandniveau gewerkt mag worden.",
    risk: "Voor wijkcijfers is een ruimtelijke koppeling nodig; de huidige opdracht blijft bewust wijk/dorpsniveau.",
  },
  {
    name: "Klimaatmonitor Zeeland",
    status: "Bron toegevoegd",
    type: "Openbare data/API",
    url: "https://klimaatmonitor.databank.nl/content/klimaatmonitor-api",
    use: "Aanvullende gemeentelijke energie- en klimaatindicatoren voor latere sprintverdieping.",
    risk: "Niet elk veld is op wijkniveau beschikbaar; veldkeuze moet nog samen met opdrachtgever worden vastgesteld.",
  },
  {
    name: "EP-online / RVO",
    status: "API-key nodig",
    type: "Officiele energielabeldata",
    url: "https://ep-online.nl/PublicData",
    use: "Echte energielabels in plaats van een geschat energieprofiel.",
    risk: "API-key of aanvullende toestemming nodig; PBL-labelverdeling wordt gebruikt als openbare tussenoplossing.",
  },
  {
    name: "RVO ISDE woningeigenaren",
    status: "Bron toegevoegd",
    type: "Subsidie-informatie",
    url: "https://www.rvo.nl/subsidies-financiering/isde/woningeigenaren",
    use: "Actuele landelijke subsidiebron voor isolatie, warmtepompen, zonneboilers en aansluitingen.",
    risk: "Exact bedrag hangt af van maatregel en apparaat/meldcode; dashboard rekent daarom indicatief.",
  },
  {
    name: "Zeeuws Isolatieprogramma",
    status: "Bron toegevoegd",
    type: "Lokale subsidie/ondersteuning",
    url: "https://www.zeeuwsisolatieprogramma.nl/",
    use: "Lokale ondersteuning voor isolatie in Zeeuwse gemeenten.",
    risk: "Regels verschillen per gemeente/doelgroep; exacte check hoort bij woningeigenaar of gemeente.",
  },
];

const HOME_SCAN_PROFILES = {
  rijwoning: {
    name: "Rijwoning",
    cost_factor: 0.92,
    measures: [
      "Isolatiecheck",
      "HR++ of triple glas",
      "Ventilatie verbeteren",
      "Hybride of all-electric warmtepomp",
    ],
  },
  hoekwoning: {
    name: "Hoekwoning / 2-onder-1-kap",
    cost_factor: 1.08,
    measures: [
      "Dak- en gevelisolatie",
      "Glas verbeteren",
      "Lage-temperatuurverwarming testen",
      "Warmtepompvariant onderzoeken",
    ],
  },
  vrijstaand: {
    name: "Vrijstaande woning",
    cost_factor: 1.26,
    measures: [
      "Uitgebreide schilisolatie",
      "Glas verbeteren",
      "Warmtepomp met voldoende vermogen",
      "Zonnepanelen en buffervat onderzoeken",
    ],
  },
  appartement: {
    name: "Appartement",
    cost_factor: 0.74,
    measures: [
      "Collectieve afspraken VvE/checken",
      "Glas en ventilatie",
      "Warmtenet of collectieve oplossing onderzoeken",
    ],
  },
};

const SCENARIOS = {
  "all-electric": {
    name: "All-electric",
    cost_factor: 1.0,
    gas_reduction: 0.96,
    electricity_extra: 1850,
    comfort_bonus: 7,
  },
  hybride: {
    name: "Hybride warmtepomp",
    cost_factor: 0.58,
    gas_reduction: 0.62,
    electricity_extra: 780,
    comfort_bonus: 4,
  },
  warmtenet: {
    name: "Warmtenet",
    cost_factor: 1.0,
    gas_reduction: 0.9,
    electricity_extra: 220,
    comfort_bonus: 5,
  },
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let pblByWijkcode;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clamp(value, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  if (Math.abs(fraction - 0.5) < 1e-10) {
    return (lower % 2 === 0 ? lower : lower + 1) / factor;
  }
  return Math.round(scaled) / factor;
}

function money(value) {
  return round(value, 2);
}

function numberParam(params, name, fallback) {
  const rawValue = params.get(name);
  if (rawValue === null || rawValue === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function loadPblByWijkcode() {
  if (pblByWijkcode) return pblByWijkcode;
  pblByWijkcode = new Map();
  if (!fs.existsSync(PBL_DATA_PATH)) return pblByWijkcode;

  const payload = readJson(PBL_DATA_PATH);
  for (const row of payload.rows || []) {
    if (row.wijkcode) pblByWijkcode.set(String(row.wijkcode).toUpperCase(), row);
  }
  return pblByWijkcode;
}

function mergePblData(row) {
  const pbl = loadPblByWijkcode().get(String(row.cbs_wijkcode || "").toUpperCase());
  if (!pbl) return { ...row };

  const merged = { ...row, ...pbl };
  if (pbl.pbl_dominant_label && pbl.pbl_dominant_label !== "Onbekend") {
    merged.label = pbl.pbl_dominant_label;
    merged.label_status = "PBL Startanalyse 2025";
    merged.label_source =
      "Openbare PBL Startanalyse 2025 energielabelverdeling, gegroepeerd naar wijkcode. Dit is geen losse EP-online woninglookup.";
  }

  const good = pbl.pbl_label_a_b_c_pct;
  const poor = pbl.pbl_label_e_f_g_pct;
  const old = pbl.pbl_bouwjaar_tot_1975_pct;
  if ([good, poor, old].every((value) => value !== null && value !== undefined)) {
    merged.isolatie = round(clamp(42 + good * 0.48 - poor * 0.34 - old * 0.12));
  }

  if (pbl.pbl_nat_meerkost_eur_weq_jaar !== null && pbl.pbl_nat_meerkost_eur_weq_jaar !== undefined) {
    merged.pbl_finance_score = round(
      clamp(100 - (pbl.pbl_nat_meerkost_eur_weq_jaar - 350) / 18, 8, 96)
    );
  }
  return merged;
}

function loadWijken() {
  if (!fs.existsSync(REAL_DATA_PATH)) return [];
  return (readJson(REAL_DATA_PATH).rows || []).map(mergePblData);
}

function classifyStrategy(row, netInvestment, yearlySaving, chanceScore) {
  if (row.isolatie < 55 && row.gas_m3 >= 1300) {
    return {
      name: "Eerst isoleren",
      priority: "Voorbereiden",
      description:
        "Deze wijk heeft relatief veel besparingspotentie, maar moet waarschijnlijk eerst naar aardgasvrij-ready worden gebracht.",
    };
  }
  if (chanceScore >= 70 && netInvestment <= 24000 && yearlySaving > 0) {
    return {
      name: "Snel starten",
      priority: "Hoog",
      description:
        "Technische en financiele voorwaarden komen gunstig samen. Dit is geschikt als eerste startpunt voor verder onderzoek.",
    };
  }
  if (row.draagvlak >= 66 && chanceScore >= 58) {
    return {
      name: "Lokaal afwegen",
      priority: "Midden",
      description:
        "De data is redelijk kansrijk, maar lokale politieke keuzes en draagvlak bepalen of dit echt een startwijk wordt.",
    };
  }
  if (yearlySaving <= 0 || netInvestment > 32000) {
    return {
      name: "Later oppakken",
      priority: "Laag",
      description:
        "De financiele uitgangspunten zijn minder gunstig. Eerst betere data of een andere aanpak onderzoeken.",
    };
  }
  return {
    name: "Verder onderzoeken",
    priority: "Midden",
    description:
      "Er zijn kansen zichtbaar, maar er is aanvullende data nodig voordat dit als startgebied gekozen kan worden.",
  };
}

function dataQuality(row) {
  const optionalFields = ["woz_waarde_x1000", "koopwoningen_pct", "zonnestroom_pct", "aardgasvrij_pct"];
  const missing = optionalFields.filter(
    (field) => row[field] === null || row[field] === undefined || row[field] === ""
  ).length;
  let score = 100 - missing * 12;
  if (row.label_status === "geschat") score -= 18;
  if (Object.hasOwn(row, "modelvelden")) score -= 8;
  return clamp(score, 35, 95);
}

function enrich(row, scenarioKey = "all-electric", horizon = 20) {
  const scenario = SCENARIOS[scenarioKey] || SCENARIOS["all-electric"];
  const baseCost = scenarioKey === "warmtenet" ? row.warmtenet : row.basis_kosten;
  const investment = baseCost * scenario.cost_factor;
  const subsidyRate = scenarioKey === "hybride" ? 0.14 : 0.18;
  const subsidy = Math.min(MODEL_ASSUMPTIONS.subsidy_cap_eur, investment * subsidyRate);
  const netInvestment = investment - subsidy;
  const yearlySaving =
    row.gas_m3 * scenario.gas_reduction * MODEL_ASSUMPTIONS.gas_price_eur_per_m3 -
    scenario.electricity_extra * MODEL_ASSUMPTIONS.electricity_price_eur_per_kwh;
  const horizonBenefit = yearlySaving * horizon;
  const payback = yearlySaving > 0 ? netInvestment / yearlySaving : null;
  const co2Kg = row.gas_m3 * scenario.gas_reduction * MODEL_ASSUMPTIONS.co2_kg_per_m3_gas;
  const affordability = clamp(100 - (netInvestment - 14000) / 240);
  const financeInput = row.pbl_finance_score ?? affordability;
  const financeComponent = financeInput * 0.36;
  const technicalComponent = row.isolatie * 0.23;
  const gridComponent = row.netcapaciteit * 0.21;
  const localComponent = row.draagvlak * 0.2;
  const chanceScore = clamp(
    financeComponent +
      technicalComponent +
      gridComponent +
      localComponent +
      scenario.comfort_bonus,
    1,
    100
  );
  const roundedScore = round(chanceScore);
  const strategy = classifyStrategy(row, netInvestment, yearlySaving, roundedScore);

  return {
    ...row,
    scenario: scenario.name,
    horizon,
    schaalniveau: "wijk/dorp",
    investering: money(investment),
    subsidie: money(subsidy),
    netto_investering: money(netInvestment),
    jaarlijkse_besparing: money(yearlySaving),
    voordeel_horizon: money(horizonBenefit),
    netto_resultaat: money(horizonBenefit - netInvestment),
    voordeel_10_jaar: money(yearlySaving * 10),
    voordeel_20_jaar: money(yearlySaving * 20),
    voordeel_30_jaar: money(yearlySaving * 30),
    maatschappelijke_investering: money(netInvestment * row.woningen),
    maatschappelijke_besparing_jaar: money(yearlySaving * row.woningen),
    terugverdientijd: payback === null ? null : round(payback, 1),
    co2_kg: round(co2Kg),
    co2_ton_wijk: round((co2Kg * row.woningen) / 1000),
    kansscore: roundedScore,
    strategie: strategy.name,
    strategie_prioriteit: strategy.priority,
    strategie_toelichting: strategy.description,
    datakwaliteit: round(dataQuality(row)),
    score_opbouw: {
      financieel: round(financeComponent, 1),
      isolatie: round(technicalComponent, 1),
      netcapaciteit: round(gridComponent, 1),
      draagvlak: round(localComponent, 1),
      scenario_bonus: scenario.comfort_bonus,
    },
    modelvelden: [
      "label",
      "basis_kosten",
      "warmtenet",
      "isolatie",
      "netcapaciteit",
      "draagvlak",
      "kansscore",
    ],
    echte_bronvelden: [
      "woningvoorraad",
      "gas_m3",
      "elek_kwh",
      "lat",
      "lng",
      "PBL energielabelverdeling",
      "PBL nationale meerkosten",
    ],
    volgende_datavraag:
      "Controleer met opdrachtgever of er betere lokale data is voor draagvlak, netcapaciteit en officiele energielabels.",
  };
}

function applyFilters(params) {
  const gemeente = params.get("gemeente") || "alle";
  const scenario = params.get("scenario") || "all-electric";
  const horizon = numberParam(params, "horizon", 20);
  const maxCost = numberParam(params, "max_cost", 999999);
  return loadWijken()
    .map((row) => enrich(row, scenario, horizon))
    .filter((row) => gemeente === "alle" || row.gemeente === gemeente)
    .filter((row) => row.netto_investering <= maxCost)
    .sort((a, b) => b.kansscore - a.kansscore);
}

function overview(rows) {
  if (!rows.length) {
    return {
      woningen: 0,
      gemiddelde_kosten: 0,
      gemiddelde_besparing: 0,
      totale_co2_ton: 0,
      top_wijk: "-",
      gemiddelde_score: 0,
      gemiddelde_datakwaliteit: 0,
    };
  }
  const woningen = rows.reduce((sum, row) => sum + row.woningen, 0);
  return {
    woningen,
    gemiddelde_kosten: round(
      rows.reduce((sum, row) => sum + row.netto_investering * row.woningen, 0) / woningen
    ),
    gemiddelde_besparing: round(
      rows.reduce((sum, row) => sum + row.jaarlijkse_besparing * row.woningen, 0) / woningen
    ),
    totale_co2_ton: round(
      rows.reduce((sum, row) => sum + row.co2_kg * row.woningen, 0) / 1000
    ),
    top_wijk: `${rows[0].wijk} (${rows[0].gemeente})`,
    gemiddelde_score: round(
      rows.reduce((sum, row) => sum + row.kansscore, 0) / rows.length
    ),
    gemiddelde_datakwaliteit: round(
      rows.reduce((sum, row) => sum + row.datakwaliteit, 0) / rows.length
    ),
  };
}

function labelCostFactor(label) {
  return { "A/B": 0.82, C: 0.96, D: 1.12, E: 1.26, "F/G": 1.42 }[label] || 1.05;
}

function scanHome(params) {
  const scenarioKey = params.get("scenario") || "all-electric";
  const scenario = SCENARIOS[scenarioKey] || SCENARIOS["all-electric"];
  const woningtype = params.get("woningtype") || "rijwoning";
  const profile = HOME_SCAN_PROFILES[woningtype] || HOME_SCAN_PROFILES.rijwoning;
  const label = params.get("label") || "C";
  const bouwjaar = numberParam(params, "bouwjaar", 1975);
  const gasM3 = numberParam(params, "gas_m3", 1200);
  const elekKwh = numberParam(params, "elek_kwh", 2900);
  const oppervlakte = numberParam(params, "oppervlakte", 115);
  const wijkId = params.get("wijk_id") || "";
  const ageFactor = bouwjaar < 1975 ? 1.18 : bouwjaar < 1992 ? 1.08 : bouwjaar < 2010 ? 0.98 : 0.82;
  const sizeFactor = clamp(oppervlakte / 115, 0.72, 1.55);

  let baseCost =
    18500 *
    profile.cost_factor *
    labelCostFactor(label) *
    ageFactor *
    (0.82 + sizeFactor * 0.18);
  if (scenarioKey === "hybride") baseCost *= 0.58;
  if (scenarioKey === "warmtenet") baseCost *= 0.86;

  const subsidyRate = scenarioKey === "hybride" ? 0.14 : 0.18;
  const subsidy = Math.min(MODEL_ASSUMPTIONS.subsidy_cap_eur, baseCost * subsidyRate);
  const loanHint = Math.max(0, baseCost - subsidy);
  const yearlySaving =
    gasM3 * scenario.gas_reduction * MODEL_ASSUMPTIONS.gas_price_eur_per_m3 -
    scenario.electricity_extra * MODEL_ASSUMPTIONS.electricity_price_eur_per_kwh;
  const payback = yearlySaving > 0 ? loanHint / yearlySaving : null;
  const wijk = loadWijken()
    .map((row) => enrich(row, scenarioKey, 20))
    .find((row) => row.id === wijkId);
  const comparison = wijk
    ? {
        wijk: `${wijk.wijk} (${wijk.gemeente})`,
        wijk_gas_m3: wijk.gas_m3,
        woning_gas_m3: gasM3,
        verschil_gas_m3: gasM3 - wijk.gas_m3,
        wijk_netto_investering: wijk.netto_investering,
        woning_netto_investering: money(loanHint),
        wijk_kansscore: wijk.kansscore,
        wijk_strategie: wijk.strategie,
      }
    : null;

  return {
    input: {
      woningtype: profile.name,
      bouwjaar,
      label,
      gas_m3: gasM3,
      elek_kwh: elekKwh,
      oppervlakte,
      scenario: scenario.name,
    },
    result: {
      bruto_investering: money(baseCost),
      geschatte_subsidie: money(subsidy),
      te_financieren: money(loanHint),
      jaarlijkse_besparing: money(yearlySaving),
      voordeel_10_jaar: money(yearlySaving * 10),
      voordeel_20_jaar: money(yearlySaving * 20),
      voordeel_30_jaar: money(yearlySaving * 30),
      terugverdientijd: payback === null ? null : round(payback, 1),
      co2_kg: round(
        gasM3 * scenario.gas_reduction * MODEL_ASSUMPTIONS.co2_kg_per_m3_gas
      ),
      maatregelen: profile.measures,
      financiering: [
        "Subsidies en leningen zijn in dit prototype indicatief.",
        "Controleer actuele regelingen via RVO, gemeente/provincie en het Nationaal Warmtefonds.",
      ],
    },
    comparison,
  };
}

function sendJson(response, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function csvCell(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(rows) {
  if (!rows.length) return "";
  const fields = Object.keys(rows[0]);
  const lines = [fields.map(csvCell).join(",")];
  for (const row of rows) lines.push(fields.map((field) => csvCell(row[field])).join(","));
  return lines.join("\r\n");
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  const publicPrefix = `${path.resolve(PUBLIC_DIR)}${path.sep}`;
  if (!filePath.startsWith(publicPrefix) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Niet gevonden");
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (request.method !== "GET") {
      sendJson(response, { error: "Alleen GET wordt ondersteund." }, 405);
      return;
    }

    if (url.pathname === "/api/wijken") {
      const sourceRows = loadWijken();
      const rows = applyFilters(url.searchParams);
      sendJson(response, {
        meta: {
          gemeenten: [...new Set(sourceRows.map((row) => row.gemeente))].sort((a, b) =>
            a.localeCompare(b, "nl")
          ),
          scenarios: SCENARIOS,
          source: fs.existsSync(REAL_DATA_PATH)
            ? "CBS/PDOK Wijk- en Buurtkaart 2024"
            : "Geen databestand gevonden",
          assumptions: MODEL_ASSUMPTIONS,
          project_scope: PROJECT_SCOPE,
          data_sources: DATA_SOURCES,
          verified_fields: [
            "woningvoorraad",
            "gemiddeld aardgasverbruik",
            "gemiddeld elektriciteitsverbruik",
            "wijklocatie",
          ],
          model_fields: [
            "energieprofiel/label",
            "kosten",
            "subsidie",
            "netcapaciteit",
            "draagvlak",
            "kansscore",
          ],
          disclaimer:
            "Woningvoorraad, gasverbruik, elektriciteit en wijklocaties komen uit CBS/PDOK 2024. Energieprofiel/label, kosten, draagvlak en netcapaciteit zijn modelinschattingen voor het schoolprototype, geen officiele EP-online labels. De opdracht is bewust gericht op wijk- of dorpsniveau, niet op individuele woningen.",
        },
        overview: overview(rows),
        rows,
      });
      return;
    }

    if (url.pathname === "/api/woningscan") {
      sendJson(response, scanHome(url.searchParams));
      return;
    }

    if (url.pathname === "/api/export.csv") {
      const csv = Buffer.from(`\ufeff${createCsv(applyFilters(url.searchParams))}`, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=aardgasvrij-startkansen.csv",
        "Content-Length": csv.length,
      });
      response.end(csv);
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Er ging iets mis in de server." }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard draait op http://${HOST}:${PORT}`);
});
