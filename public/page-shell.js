"use strict";

const currentPage = document.body.dataset.page || "overview";
const pages = [
  { id: "overview", label: "Overzicht", href: "/index.html" },
  { id: "map", label: "Kansenkaart", href: "/kansenkaart.html" },
  { id: "scan", label: "Woningscan", href: "/woningscan.html" },
  { id: "data", label: "Data & methode", href: "/data-methode.html" },
];

document.querySelector("#appHeader").innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">Provincie Zeeland RES</p>
      <h1>Aardgasvrij startkansen dashboard</h1>
    </div>
    <div id="dataStatus" class="status-pill" aria-label="Status van de databron">Data laden</div>
  </header>
`;

document.querySelector("#appSidebar").innerHTML = `
  <nav class="page-nav" aria-label="Dashboard pagina's">
    ${pages
      .map(
        (page) => `
          <a
            class="nav-button${page.id === currentPage ? " active" : ""}"
            href="${page.href}"
            ${page.id === currentPage ? 'aria-current="page"' : ""}
          >${page.label}</a>
        `
      )
      .join("")}
  </nav>
  <section class="filters" aria-label="Filters">
    <div class="panel-title">
      <span class="icon" aria-hidden="true">⌁</span>
      <h2>Filters</h2>
    </div>

    <label for="gemeente">Gemeente</label>
    <select id="gemeente">
      <option value="alle">Alle gemeenten</option>
    </select>

    <label for="scenario">Warmtetransitiepad</label>
    <select id="scenario">
      <option value="all-electric">All-electric</option>
      <option value="hybride">Hybride warmtepomp</option>
      <option value="warmtenet">Warmtenet</option>
    </select>

    <label>Financiële horizon</label>
    <div class="segmented" role="group" aria-label="Financiële horizon">
      <button class="segment" type="button" data-horizon="10">10 jaar</button>
      <button class="segment" type="button" data-horizon="20">20 jaar</button>
      <button class="segment" type="button" data-horizon="30">30 jaar</button>
    </div>

    <label for="maxCost">Maximale netto investering per woning</label>
    <input id="maxCost" type="range" min="10000" max="36000" value="36000" step="1000" />
    <output id="maxCostValue" for="maxCost">€36.000</output>

    <button id="resetFilters" class="secondary-button" type="button">Reset filters</button>
    <a id="exportCsv" class="primary-button" href="/api/export.csv">Exporteer CSV</a>
  </section>
`;

