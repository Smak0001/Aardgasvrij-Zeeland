# Aardgasvrij Zeeland Dashboard

Eerste MVP voor het schoolproject rond startkansen voor aardgasvrije Zeeuwse wijken.

## Starten

```powershell
git clone https://github.com/Smak0001/Aardgasvrij-Zeeland.git
cd Aardgasvrij-Zeeland
git switch javascript-version
node server.js
```

Je kunt op een normale Node.js-installatie ook `npm start` gebruiken. Er zijn geen externe packages nodig.

Open daarna:

```text
http://127.0.0.1:8000
```

## Wat zit erin?

- JavaScript/Node.js HTTP-server zonder externe packages.
- HTML/CSS/JavaScript dashboard met aparte pagina's voor overzicht, kansenkaart, woningscan en data/methode.
- Filters voor gemeente, transitiepad, financiële horizon en maximale investering.
- KPI's voor woningen, kosten, besparing en CO2-reductie.
- Echte interactieve kaart met OpenStreetMap-tegels en eigen JavaScript-kaartbesturing.
- Top-startkansen en wijkvergelijking.
- Opdrachtfocus uit de client meeting: dorps-/wijkniveau, geen individuele woningen.
- Dataverkenning met status per bron: CBS/PDOK, Klimaatmonitor, PBL, EP-online/RVO en lokale data via provincie/gemeenten/netbeheerder.
- Woningscan voor inwoners met woningtype, energieprofiel, bouwjaar, oppervlakte, gasverbruik en elektriciteitsverbruik.
- Inwoner-uitkomst met investeringskosten, indicatieve subsidie, te financieren bedrag, CO2-reductie, maatregelen en financieel voordeel over 10, 20 en 30 jaar.
- Startstrategie per wijk, zoals `Snel starten`, `Eerst isoleren`, `Lokaal afwegen` of `Verder onderzoeken`.
- Score-opbouw per wijk, zodat zichtbaar is welke delen de kansscore bepalen.
- Maatschappelijke investering per wijk, zodat het dashboard aansluit op de vraag waar aardgasvrij maken tegen de laagste maatschappelijke kosten kan.
- CSV-export via `/api/export.csv`.
- Echte CBS/PDOK wijkdata voor Zeeland in `data/wijken_zeeland_2024.json`.
- Importscript om de dataset opnieuw op te halen: `scripts/update_real_data.py`.

## Belangrijk

Woningvoorraad, gemiddeld aardgasverbruik, gemiddeld elektriciteitsverbruik en locaties komen uit CBS/PDOK Wijk- en Buurtkaart 2024.

Kosten, energieprofiel/label, draagvlak en netcapaciteit zijn nog rekenmodel-inschattingen voor het schoolprototype. De app noemt het daarom bewust `energieprofiel` en markeert dit als schatting. Voor echte officiële energielabels is EP-online/RVO logisch, maar die API vereist een API-key.

Op basis van de client meeting is de scope bewust gezet op wijk- of dorpsniveau. Individuele woningen zijn voorlopig niet geschikt, omdat veel openbare data op geaggregeerd niveau beschikbaar is en volgens de opdrachtgever te weinig zegt over één specifiek huis.

Financiële aannames in het model:

- Gasprijs: EUR 1,35 per m3.
- Elektriciteitsprijs: EUR 0,31 per kWh.
- CO2-factor aardgas: 1,79 kg CO2 per m3 gas.
- Subsidieplafond in het prototype: EUR 6.200 per woning.

De kaarttegels komen online van OpenStreetMap. Je hebt dus internet nodig om de echte kaartachtergrond te zien.

## Aansluiting op de originele opdracht

De originele opdracht vraagt om inzicht in kosten en kansen van het aardgasvrij maken van de Zeeuwse woningvoorraad. Het dashboard verwerkt daarom twee perspectieven:

- Gemeente/provincie/netbeheerder: kaart met startkansen per wijk of dorp, transitiepad, maatschappelijke investering, CO2-effect en score-opbouw.
- Inwoner/woningeigenaar: woningscan met indicatieve kosten, maatregelen, subsidie/financiering, jaarlijkse besparing en voordeel over 10, 20 en 30 jaar.

Pagina-indeling:

- `Overzicht`: centrale opdrachtvraag, KPI's, client-meeting focus, RES-doelen en SDG's.
- `Kansenkaart`: interactieve OpenStreetMap-kaart, top-startkansen, wijkadvies en vergelijkingstabel.
- `Woningscan`: inwonerformulier met financiële uitkomst en vergelijking met geselecteerde wijk.
- `Data & methode`: databronnen, verschil tussen echte data en modelinschattingen, scoremethode en open datavragen.

Nog open voor latere sprints: echte EP-online energielabels, actuele subsidie- en leningregels, betere lokale data over draagvlak, bouw-/installatiecapaciteit en netcongestie.

## Echte data opnieuw ophalen

De applicatie zelf draait volledig op JavaScript. De bestaande importscripts voor het opnieuw ophalen en verwerken van brondata zijn voorlopig nog Python-hulpscripts:

```powershell
python scripts\update_real_data.py
```
