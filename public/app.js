const state = {
  gemeente: "alle",
  scenario: "all-electric",
  horizon: 20,
  maxCost: 36000,
  selectedId: null,
  scan: {
    woningtype: "rijwoning",
    label: "C",
    bouwjaar: 1975,
    oppervlakte: 115,
    gas_m3: 1200,
    elek_kwh: 2900,
  },
};

const mapState = {
  initialized: false,
  markerById: new Map(),
  rows: [],
  zoom: 9,
  centerLat: 51.49,
  centerLng: 3.82,
  isDragging: false,
  startPointer: null,
  startCenter: null,
  tilesLayer: null,
  markersLayer: null,
};

const el = {
  gemeente: document.querySelector("#gemeente"),
  scenario: document.querySelector("#scenario"),
  maxCost: document.querySelector("#maxCost"),
  maxCostValue: document.querySelector("#maxCostValue"),
  exportCsv: document.querySelector("#exportCsv"),
  dataStatus: document.querySelector("#dataStatus"),
  resetFilters: document.querySelector("#resetFilters"),
  navButtons: document.querySelectorAll(".nav-button"),
  pagePanels: document.querySelectorAll("[data-page-panel]"),
  segments: document.querySelectorAll(".segment"),
  kpiHomes: document.querySelector("#kpiHomes"),
  kpiCost: document.querySelector("#kpiCost"),
  kpiSaving: document.querySelector("#kpiSaving"),
  kpiCo2: document.querySelector("#kpiCo2"),
  kpiDataQuality: document.querySelector("#kpiDataQuality"),
  centralQuestion: document.querySelector("#centralQuestion"),
  scopeText: document.querySelector("#scopeText"),
  scopeLevel: document.querySelector("#scopeLevel"),
  residentQuestion: document.querySelector("#residentQuestion"),
  resGoals: document.querySelector("#resGoals"),
  sdgList: document.querySelector("#sdgList"),
  dataSources: document.querySelector("#dataSources"),
  assumptionList: document.querySelector("#assumptionList"),
  topWijk: document.querySelector("#topWijk"),
  avgScore: document.querySelector("#avgScore"),
  map: document.querySelector("#map"),
  barChart: document.querySelector("#barChart"),
  table: document.querySelector("#wijkTable"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  detailScore: document.querySelector("#detailScore"),
  detailInvestment: document.querySelector("#detailInvestment"),
  detailSaving: document.querySelector("#detailSaving"),
  detailPayback: document.querySelector("#detailPayback"),
  detailStrategy: document.querySelector("#detailStrategy"),
  detailDataQuality: document.querySelector("#detailDataQuality"),
  detailSocialCost: document.querySelector("#detailSocialCost"),
  detailMeasures: document.querySelector("#detailMeasures"),
  detailWhy: document.querySelector("#detailWhy"),
  detailScoreBreakdown: document.querySelector("#detailScoreBreakdown"),
  scanType: document.querySelector("#scanType"),
  scanLabel: document.querySelector("#scanLabel"),
  scanYear: document.querySelector("#scanYear"),
  scanSurface: document.querySelector("#scanSurface"),
  scanGas: document.querySelector("#scanGas"),
  scanElectricity: document.querySelector("#scanElectricity"),
  scanGross: document.querySelector("#scanGross"),
  scanNet: document.querySelector("#scanNet"),
  scanSaving: document.querySelector("#scanSaving"),
  scanCo2: document.querySelector("#scanCo2"),
  scanTimeline: document.querySelector("#scanTimeline"),
  scanComparison: document.querySelector("#scanComparison"),
  scanMeasures: document.querySelector("#scanMeasures"),
};

const euro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("nl-NL");
let filterTimer = null;
let scanTimer = null;

function params() {
  return new URLSearchParams({
    gemeente: state.gemeente,
    scenario: state.scenario,
    horizon: state.horizon,
    max_cost: state.maxCost,
  });
}

function scanParams() {
  return new URLSearchParams({
    scenario: state.scenario,
    wijk_id: state.selectedId || "",
    woningtype: state.scan.woningtype,
    label: state.scan.label,
    bouwjaar: state.scan.bouwjaar,
    oppervlakte: state.scan.oppervlakte,
    gas_m3: state.scan.gas_m3,
    elek_kwh: state.scan.elek_kwh,
  });
}

function scoreColor(score) {
  if (score >= 70) return "#197b50";
  if (score >= 58) return "#bf7b12";
  return "#b8452f";
}

function formatPayback(value) {
  return value === null || value === undefined ? "n.v.t." : `${value} jaar`;
}

async function loadData() {
  const response = await fetch(`/api/wijken?${params()}`);
  if (!response.ok) throw new Error("Data kon niet worden geladen");
  const data = await response.json();
  renderGemeenten(data.meta.gemeenten);
  renderDashboard(data);
  el.exportCsv.href = `/api/export.csv?${params()}`;
}

async function loadHomeScan() {
  const response = await fetch(`/api/woningscan?${scanParams()}`);
  if (!response.ok) throw new Error("Woningscan kon niet worden geladen");
  const data = await response.json();
  renderHomeScan(data);
}

function scheduleLoad() {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(loadData, 120);
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    loadHomeScan().catch(() => {
      el.scanComparison.textContent = "De woningscan kon niet worden geladen.";
    });
  }, 160);
}

function renderGemeenten(gemeenten) {
  if (el.gemeente.options.length > 1) return;
  gemeenten.forEach((gemeente) => {
    const option = document.createElement("option");
    option.value = gemeente;
    option.textContent = gemeente;
    el.gemeente.appendChild(option);
  });
}

function renderDashboard(data) {
  const { overview, rows } = data;
  el.dataStatus.textContent = data.meta.source;
  if (!rows.some((row) => row.id === state.selectedId)) {
    state.selectedId = rows[0]?.id ?? null;
  }
  el.kpiHomes.textContent = number.format(overview.woningen);
  el.kpiCost.textContent = euro.format(overview.gemiddelde_kosten);
  el.kpiSaving.textContent = euro.format(overview.gemiddelde_besparing);
  el.kpiCo2.textContent = `${number.format(overview.totale_co2_ton)} ton`;
  el.kpiDataQuality.textContent = `${overview.gemiddelde_datakwaliteit ?? 0}%`;
  el.topWijk.textContent = `Beste startkans: ${overview.top_wijk}`;
  el.avgScore.textContent = `Score ${overview.gemiddelde_score}`;
  renderScope(data.meta);
  renderMap(rows);
  renderBars(rows.slice(0, 7));
  renderTable(rows);
  renderDetail(rows.find((row) => row.id === state.selectedId));
  loadHomeScan().catch(() => {
    el.scanComparison.textContent = "De woningscan kon niet worden geladen.";
  });
}

function renderScope(meta) {
  const scope = meta.project_scope || {};
  el.centralQuestion.textContent = scope.central_question || "Wat kost aardgasvrij maken en waar kan Zeeland het beste starten?";
  el.scopeText.textContent = `${scope.client_goal || ""} ${scope.success_definition || ""}`;
  el.scopeLevel.textContent = scope.preferred_scale || "wijk/dorp";
  el.residentQuestion.textContent = scope.resident_question || el.residentQuestion.textContent;
  el.resGoals.innerHTML = (scope.res_2030_goals || [])
    .map((goal) => `<li>${goal}</li>`)
    .join("");
  el.sdgList.innerHTML = (scope.sdgs || [])
    .map((sdg) => `<li>${sdg}</li>`)
    .join("");
  el.dataSources.innerHTML = "";
  (meta.data_sources || []).forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    card.innerHTML = `
      <span class="source-status">${source.status}</span>
      <strong>${source.name}</strong>
      <p>${source.use}</p>
      <small>${source.type} · ${source.risk}</small>
    `;
    el.dataSources.appendChild(card);
  });
  el.assumptionList.innerHTML = Object.entries(meta.assumptions || {})
    .map(([key, value]) => `<div><dt>${formatAssumptionKey(key)}</dt><dd>${value}</dd></div>`)
    .join("");
}

function formatAssumptionKey(key) {
  return {
    gas_price_eur_per_m3: "Gasprijs per m³",
    electricity_price_eur_per_kwh: "Elektriciteitsprijs per kWh",
    co2_kg_per_m3_gas: "CO₂-factor aardgas",
    subsidy_cap_eur: "Subsidieplafond prototype",
    label_method: "Energieprofiel methode",
  }[key] || key;
}

function renderMap(rows) {
  ensureMap();

  mapState.rows = rows;
  mapState.markerById.clear();
  fitRows(rows);
  drawMap();
}

function ensureMap() {
  if (mapState.initialized) {
    return;
  }

  el.map.innerHTML = `
    <div class="tile-layer" aria-hidden="true"></div>
    <div class="marker-layer"></div>
    <div class="map-controls" aria-label="Kaart bediening">
      <button type="button" data-map-zoom="in" aria-label="Inzoomen">+</button>
      <button type="button" data-map-zoom="out" aria-label="Uitzoomen">-</button>
    </div>
    <div class="map-hint">Sleep om te bewegen · scroll om te zoomen</div>
    <div class="map-attribution">
      &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
    </div>
  `;

  mapState.tilesLayer = el.map.querySelector(".tile-layer");
  mapState.markersLayer = el.map.querySelector(".marker-layer");
  mapState.initialized = true;

  el.map.addEventListener("pointerdown", startPan);
  el.map.addEventListener("pointermove", movePan);
  el.map.addEventListener("pointerup", endPan);
  el.map.addEventListener("pointercancel", endPan);
  el.map.addEventListener("wheel", zoomWithWheel, { passive: false });
  el.map.addEventListener("dblclick", () => setZoom(mapState.zoom + 1));
  el.map.querySelector('[data-map-zoom="in"]').addEventListener("click", () => setZoom(mapState.zoom + 1));
  el.map.querySelector('[data-map-zoom="out"]').addEventListener("click", () => setZoom(mapState.zoom - 1));
  window.addEventListener("resize", drawMap);
}

function fitRows(rows) {
  if (!rows.length) return;
  const minLat = Math.min(...rows.map((row) => row.lat));
  const maxLat = Math.max(...rows.map((row) => row.lat));
  const minLng = Math.min(...rows.map((row) => row.lng));
  const maxLng = Math.max(...rows.map((row) => row.lng));
  mapState.centerLat = (minLat + maxLat) / 2;
  mapState.centerLng = (minLng + maxLng) / 2;
  mapState.zoom = rows.length <= 2 ? 11 : 9;
}

function drawMap() {
  if (!mapState.initialized) return;
  if (el.map.clientWidth === 0 || el.map.clientHeight === 0) return;
  drawTiles();
  drawMarkers();
}

function drawTiles() {
  const width = el.map.clientWidth;
  const height = el.map.clientHeight;
  const zoom = mapState.zoom;
  const center = project(mapState.centerLat, mapState.centerLng, zoom);
  const topLeft = { x: center.x - width / 2, y: center.y - height / 2 };
  const tileSize = 256;
  const scale = 2 ** zoom;
  const startX = Math.floor(topLeft.x / tileSize);
  const endX = Math.floor((topLeft.x + width) / tileSize);
  const startY = Math.floor(topLeft.y / tileSize);
  const endY = Math.floor((topLeft.y + height) / tileSize);
  const tiles = document.createDocumentFragment();

  mapState.tilesLayer.innerHTML = "";
  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= scale) continue;
      const wrappedX = ((x % scale) + scale) % scale;
      const img = document.createElement("img");
      img.className = "map-tile";
      img.alt = "";
      img.draggable = false;
      img.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
      img.style.left = `${Math.round(x * tileSize - topLeft.x)}px`;
      img.style.top = `${Math.round(y * tileSize - topLeft.y)}px`;
      img.addEventListener("error", () => img.classList.add("tile-error"));
      tiles.appendChild(img);
    }
  }

  mapState.tilesLayer.appendChild(tiles);
}

function drawMarkers() {
  mapState.markersLayer.innerHTML = "";
  if (!mapState.rows.length) {
    mapState.markersLayer.innerHTML = '<div class="map-empty">Geen wijken binnen deze selectie.</div>';
    return;
  }

  const center = project(mapState.centerLat, mapState.centerLng, mapState.zoom);
  const width = el.map.clientWidth;
  const height = el.map.clientHeight;
  const markers = document.createDocumentFragment();

  mapState.rows.forEach((row, index) => {
    const point = project(row.lat, row.lng, mapState.zoom);
    const x = point.x - center.x + width / 2;
    const y = point.y - center.y + height / 2;
    const marker = document.createElement("button");
    marker.type = "button";
    const showLabel = index < 26 || row.id === state.selectedId;
    marker.className = `map-marker${row.id === state.selectedId ? " selected" : ""}${showLabel ? "" : " compact"}`;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.style.setProperty("--score-color", scoreColor(row.kansscore));
    marker.innerHTML = `
      <span class="map-score">${row.kansscore}</span>
      <span class="map-label">${row.wijk}<small>${row.gemeente}</small></span>
    `;
    marker.title = `${row.wijk}, ${row.gemeente}`;
    marker.setAttribute("aria-label", `${row.wijk}, ${row.gemeente}, kansscore ${row.kansscore}`);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      selectRow(row.id);
    });
    mapState.markerById.set(row.id, marker);
    markers.appendChild(marker);
  });

  mapState.markersLayer.appendChild(markers);
}

function startPan(event) {
  if (event.target.closest("button")) return;
  mapState.isDragging = true;
  mapState.startPointer = { x: event.clientX, y: event.clientY };
  mapState.startCenter = project(mapState.centerLat, mapState.centerLng, mapState.zoom);
  el.map.setPointerCapture(event.pointerId);
  el.map.classList.add("dragging");
}

function movePan(event) {
  if (!mapState.isDragging) return;
  const dx = event.clientX - mapState.startPointer.x;
  const dy = event.clientY - mapState.startPointer.y;
  const center = unproject(
    mapState.startCenter.x - dx,
    mapState.startCenter.y - dy,
    mapState.zoom
  );
  mapState.centerLat = center.lat;
  mapState.centerLng = center.lng;
  drawMap();
}

function endPan(event) {
  if (!mapState.isDragging) return;
  mapState.isDragging = false;
  el.map.releasePointerCapture?.(event.pointerId);
  el.map.classList.remove("dragging");
}

function zoomWithWheel(event) {
  event.preventDefault();
  setZoom(mapState.zoom + (event.deltaY < 0 ? 1 : -1));
}

function setZoom(nextZoom) {
  mapState.zoom = Math.max(8, Math.min(14, nextZoom));
  drawMap();
}

function focusSelectedMarker() {
  const row = mapState.rows.find((item) => item.id === state.selectedId);
  if (!row) return;
  mapState.centerLat = row.lat;
  mapState.centerLng = row.lng;
  mapState.zoom = Math.max(mapState.zoom, 11);
  drawMap();
}

function project(lat, lng, zoom) {
  const sin = Math.sin((Math.max(Math.min(lat, 85), -85) * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function renderBars(rows) {
  el.barChart.innerHTML = "";
  if (!rows.length) {
    el.barChart.innerHTML = `<div class="empty">Geen resultaten voor de grafiek.</div>`;
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "bar-row";
    item.innerHTML = `
      <span class="bar-label" title="${row.wijk}">${row.wijk}</span>
      <span class="bar-track"><span class="bar-fill" style="width: ${row.kansscore}%; background: ${scoreColor(row.kansscore)}"></span></span>
      <span class="bar-value">${row.kansscore}</span>
    `;
    el.barChart.appendChild(item);
  });
}

function renderTable(rows) {
  el.table.innerHTML = "";
  if (!rows.length) {
    el.table.innerHTML = `<tr><td colspan="9" class="empty">Geen wijken gevonden.</td></tr>`;
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = row.id === state.selectedId ? "selected-row" : "";
    tr.innerHTML = `
      <td><strong>${row.wijk}</strong></td>
      <td>${row.gemeente}</td>
      <td>${row.label} <span class="muted-cell">${row.label_status || "schatting"}</span></td>
      <td><span class="strategy-pill">${row.strategie}</span></td>
      <td>${euro.format(row.netto_investering)}</td>
      <td>${euro.format(row.maatschappelijke_investering)}</td>
      <td>${euro.format(row.jaarlijkse_besparing)}</td>
      <td>${formatPayback(row.terugverdientijd)}</td>
      <td class="score-cell">${row.kansscore}</td>
    `;
    tr.addEventListener("click", () => selectRow(row.id));
    el.table.appendChild(tr);
  });
}

function renderHomeScan(data) {
  const result = data.result || {};
  const comparison = data.comparison;
  el.scanGross.textContent = euro.format(result.bruto_investering || 0);
  el.scanNet.textContent = euro.format(result.te_financieren || 0);
  el.scanSaving.textContent = euro.format(result.jaarlijkse_besparing || 0);
  el.scanCo2.textContent = `${number.format(result.co2_kg || 0)} kg`;

  const values = [
    ["10 jaar", result.voordeel_10_jaar || 0],
    ["20 jaar", result.voordeel_20_jaar || 0],
    ["30 jaar", result.voordeel_30_jaar || 0],
  ];
  const maxValue = Math.max(...values.map(([, value]) => Math.abs(value)), 1);
  el.scanTimeline.innerHTML = values
    .map(([label, value]) => {
      const width = Math.max(6, Math.round((Math.abs(value) / maxValue) * 100));
      return `
        <div class="scan-timeline-row">
          <span>${label}</span>
          <i style="width:${width}%; background:${value >= 0 ? "var(--green)" : "var(--red)"}"></i>
          <strong>${euro.format(value)}</strong>
        </div>
      `;
    })
    .join("");

  if (comparison) {
    const gasText =
      comparison.verschil_gas_m3 > 0
        ? `${number.format(comparison.verschil_gas_m3)} m³ hoger`
        : `${number.format(Math.abs(comparison.verschil_gas_m3))} m³ lager`;
    el.scanComparison.textContent =
      `Vergeleken met ${comparison.wijk} gebruikt deze woning ongeveer ${gasText} dan het wijkgemiddelde. ` +
      `De wijkstrategie is ${comparison.wijk_strategie} met kansscore ${comparison.wijk_kansscore}.`;
  } else {
    el.scanComparison.textContent = "Selecteer een wijk op de kaart of in de tabel om te vergelijken.";
  }

  const finance = result.financiering || [];
  el.scanMeasures.innerHTML = [...(result.maatregelen || []), ...finance]
    .map((item) => `<li>${item}</li>`)
    .join("");
}

function renderDetail(row) {
  if (!row) {
    el.detailTitle.textContent = "Wijkadvies";
    el.detailSubtitle.textContent = "Geen wijk geselecteerd.";
    el.detailScore.textContent = "Score 0";
    el.detailInvestment.textContent = euro.format(0);
    el.detailSaving.textContent = euro.format(0);
    el.detailPayback.textContent = "0 jaar";
    el.detailStrategy.textContent = "-";
    el.detailDataQuality.textContent = "0%";
    el.detailSocialCost.textContent = euro.format(0);
    el.detailMeasures.innerHTML = "";
    el.detailWhy.textContent = "Pas de filters aan om wijken te bekijken.";
    el.detailScoreBreakdown.innerHTML = "";
    return;
  }

  el.detailTitle.textContent = `${row.wijk} - ${row.gemeente}`;
  el.detailSubtitle.textContent = `${row.scenario} · ${row.woningen.toLocaleString("nl-NL")} woningen · energieprofiel ${row.label} (${row.label_status || "schatting"})`;
  el.detailScore.textContent = `Score ${row.kansscore}`;
  el.detailInvestment.textContent = euro.format(row.netto_investering);
  el.detailSaving.textContent = euro.format(row.jaarlijkse_besparing);
  el.detailPayback.textContent = formatPayback(row.terugverdientijd);
  el.detailStrategy.textContent = row.strategie;
  el.detailDataQuality.textContent = `${row.datakwaliteit}%`;
  el.detailSocialCost.textContent = euro.format(row.maatschappelijke_investering);
  el.detailMeasures.innerHTML = measuresFor(row)
    .map((measure) => `<li>${measure}</li>`)
    .join("");
  el.detailWhy.textContent = whyText(row);
  el.detailScoreBreakdown.innerHTML = scoreBreakdown(row);
}

function measuresFor(row) {
  const base = [];
  if (["D", "E", "F/G"].includes(row.label)) {
    base.push("Eerst isoleren: dak, vloer, gevel en glas naar minimaal label B/C.");
  } else {
    base.push("Controleer isolatie en kierdichting; woningvoorraad is al redelijk geschikt.");
  }
  if (state.scenario === "all-electric") {
    base.push("Onderzoek lage-temperatuurverwarming en individuele warmtepompen.");
  }
  if (state.scenario === "hybride") {
    base.push("Start met hybride warmtepompen als tussenstap om gas snel te verminderen.");
  }
  if (state.scenario === "warmtenet") {
    base.push("Check warmtedichtheid en mogelijke bronnen voor een collectief warmtenet.");
  }
  base.push("Leg aannames vast over subsidie, energieprijzen en netcapaciteit.");
  base.push("Gebruik dit gebied als gesprekspunt met gemeente/provincie: klopt de lokale situatie bij de data?");
  if (row.label_status === "geschat") {
    base.push("Vervang het energieprofiel later door echte EP-online/RVO energielabeldata.");
  }
  return base;
}

function whyText(row) {
  const parts = [
    `De wijk scoort ${row.kansscore}/100 doordat de netto investering rond ${euro.format(row.netto_investering)} ligt.`,
    `De berekende jaarlijkse besparing is ongeveer ${euro.format(row.jaarlijkse_besparing)} per woning bij de huidige modelprijzen.`,
  ];
  if (row.label_status === "geschat") parts.push("Het energieprofiel is geen officieel energielabel, maar een inschatting op basis van gemiddeld gasverbruik.");
  if (row.pbl_laagste_strategie) parts.push(`Volgens de PBL Startanalyse is de laagste-kostenstrategie: ${row.pbl_laagste_strategie}.`);
  if (row.pbl_nat_meerkost_eur_weq_jaar !== null && row.pbl_nat_meerkost_eur_weq_jaar !== undefined) {
    parts.push(`PBL nationale meerkosten: ongeveer ${euro.format(row.pbl_nat_meerkost_eur_weq_jaar)} per woningequivalent per jaar.`);
  }
  if (row.netcapaciteit >= 60) parts.push("De netcapaciteit is relatief gunstig voor elektrificatie.");
  if (row.draagvlak >= 62) parts.push("Het draagvlak in de demo-inschatting is bovengemiddeld.");
  if (row.isolatie < 55) parts.push("De lage isolatiescore maakt een gefaseerde aanpak logischer.");
  if (row.strategie_toelichting) parts.push(row.strategie_toelichting);
  return parts.join(" ");
}

function scoreBreakdown(row) {
  const labels = {
    financieel: "Financieel",
    isolatie: "Isolatie",
    netcapaciteit: "Netcapaciteit",
    draagvlak: "Draagvlak",
    scenario_bonus: "Scenario bonus",
  };
  return Object.entries(row.score_opbouw || {})
    .map(([key, value]) => `<div><dt>${labels[key] || key}</dt><dd>${value}</dd></div>`)
    .join("");
}

function selectRow(id) {
  state.selectedId = id;
  const selected = mapState.rows.find((row) => row.id === id);
  drawMarkers();
  renderTable(mapState.rows);
  renderDetail(selected);
  focusSelectedMarker();
  loadHomeScan().catch(() => {
    el.scanComparison.textContent = "De woningscan kon niet worden geladen.";
  });
}

function syncControls() {
  el.gemeente.value = state.gemeente;
  el.scenario.value = state.scenario;
  el.maxCost.value = state.maxCost;
  el.maxCostValue.textContent = euro.format(state.maxCost);
  el.segments.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.horizon) === state.horizon);
  });
}

function syncScanControls() {
  el.scanType.value = state.scan.woningtype;
  el.scanLabel.value = state.scan.label;
  el.scanYear.value = state.scan.bouwjaar;
  el.scanSurface.value = state.scan.oppervlakte;
  el.scanGas.value = state.scan.gas_m3;
  el.scanElectricity.value = state.scan.elek_kwh;
}

function showPage(pageName) {
  const availablePages = [...el.pagePanels].map((panel) => panel.dataset.pagePanel);
  const nextPage = availablePages.includes(pageName) ? pageName : "overview";
  el.pagePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.pagePanel === nextPage);
  });
  el.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.page === nextPage);
  });
  document.body.dataset.page = nextPage;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (nextPage === "map") {
    window.setTimeout(drawMap, 50);
  }
}

function bindControls() {
  el.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const pageName = button.dataset.page;
      history.replaceState(null, "", `#${pageName}`);
      showPage(pageName);
    });
  });

  el.gemeente.addEventListener("change", () => {
    state.gemeente = el.gemeente.value;
    loadData();
  });

  el.scenario.addEventListener("change", () => {
    state.scenario = el.scenario.value;
    loadData();
    scheduleScan();
  });

  el.maxCost.addEventListener("input", () => {
    state.maxCost = Number(el.maxCost.value);
    el.maxCostValue.textContent = euro.format(state.maxCost);
    scheduleLoad();
  });

  el.segments.forEach((button) => {
    button.addEventListener("click", () => {
      state.horizon = Number(button.dataset.horizon);
      syncControls();
      loadData();
    });
  });

  el.resetFilters.addEventListener("click", () => {
    state.gemeente = "alle";
    state.scenario = "all-electric";
    state.horizon = 20;
    state.maxCost = 36000;
    syncControls();
    syncScanControls();
    loadData();
  });

  const scanBindings = [
    [el.scanType, "woningtype", "value"],
    [el.scanLabel, "label", "value"],
    [el.scanYear, "bouwjaar", "number"],
    [el.scanSurface, "oppervlakte", "number"],
    [el.scanGas, "gas_m3", "number"],
    [el.scanElectricity, "elek_kwh", "number"],
  ];

  scanBindings.forEach(([input, key, type]) => {
    input.addEventListener("input", () => {
      state.scan[key] = type === "number" ? Number(input.value) : input.value;
      scheduleScan();
    });
    input.addEventListener("change", () => {
      state.scan[key] = type === "number" ? Number(input.value) : input.value;
      scheduleScan();
    });
  });
}

window.addEventListener("hashchange", () => {
  showPage(location.hash.replace("#", "") || "overview");
});

bindControls();
syncControls();
syncScanControls();
showPage(location.hash.replace("#", "") || "overview");
loadData().catch((error) => {
  el.table.innerHTML = `<tr><td colspan="9" class="empty">${error.message}</td></tr>`;
});
