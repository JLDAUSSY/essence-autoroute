// Essence sur Autoroute - Application Waze-like
// Trajet point A à point B, étapes, alternatives, stations en ordre chronologique avec PK, enseignes et prix

// ============================================================================
// Configuration des partenariats & affiliations (Ulys Télépéage & Amazon)
// ============================================================================
const AFFILIATE_CONFIG = {
  ulys: {
    enabled: true,
    url: "https://ulys.vinci-autoroutes.com/", // À mettre à jour dès validation Awin
    badge: "🚗 BON PLAN PÉAGE",
    title: "Badge Télépéage Ulys",
    desc: "Passez les barrières sans attente en France, Espagne et Italie. Sans engagement.",
    cta: "Profiter de l'offre ➔"
  },
  amazon: {
    enabled: true,
    tag: "watermetrics-21",
    items: [
      {
        icon: "📱",
        name: "Support Smartphone Grille / MagSafe",
        sub: "Maintien ultra-stable pour guidage GPS",
        url: "https://www.amazon.fr/s?k=support+telephone+voiture+grille+aeration&tag=watermetrics-21"
      },
      {
        icon: "⚡",
        name: "Chargeur Allume-Cigare USB-C Rapide",
        sub: "Recharge rapide 65W pendant votre trajet",
        url: "https://www.amazon.fr/s?k=chargeur+allume+cigare+rapide+usb+c&tag=watermetrics-21"
      }
    ]
  }
};

// Prix en direct Allemagne (Tankerkönig / MTS-K) via relais Cloudflare Worker.
// Laisser vide tant que le relais n'est pas déployé : les prix allemands restent indicatifs.
const DE_LIVE_PRICES = {
  proxyUrl: '' // ex. 'https://fuelpilot-de.<votre-compte>.workers.dev'
};

let map;
let allStations = [];
let routeLayers = [];
let stationMarkers = [];
let activeRouteData = null;
let alternativeRoutes = [];
let currentWaypoints = []; // [{ id, text, coords: [lon, lat] }]
let startPoint = null;
let endPoint = null;
let selectedFuel = 'e10'; // Default to SP95
let selectedBrand = 'all';
let currentSort = 'route'; // 'route', 'price', 'dist'
let maxDistanceKm = 0.45; // 450m tolerance for highway service areas

// Helper to safely get fuel price with SP95/E10 equivalence
function getFuelPrice(prixObj, fuel) {
  if (!prixObj) return null;
  if (fuel === 'e10') {
    return (prixObj.e10 && prixObj.e10 > 0) ? prixObj.e10 : ((prixObj.sp95 && prixObj.sp95 > 0) ? prixObj.sp95 : null);
  }
  if (fuel === 'sp95') {
    return (prixObj.sp95 && prixObj.sp95 > 0) ? prixObj.sp95 : ((prixObj.e10 && prixObj.e10 > 0) ? prixObj.e10 : null);
  }
  return prixObj[fuel] || null;
}

// Helper to format proper nouns / names with correct French & Spanish title casing
function formatProperName(text) {
  if (!text) return '';
  let t = String(text).trim();
  if (t.toLowerCase().startsWith('aide de')) t = 'Aire de' + t.substring(7);
  t = t.replace(/^aut(?:oroute)?\.?\s*([a-z0-9]+)\s*-\s*aire\s+de\s+(.*)/i, (m, g1, g2) => `${g1.toUpperCase()} - Aire de ${g2}`);
  t = t.replace(/^aut(?:oroute)?\s+([a-z])\s*(\d+)$/i, (m, g1, g2) => `Autoroute ${g1.toUpperCase()}${g2}`);
  t = t.replace(/^aut(?:oroute)?\s+([a-z])\s*(\d+)\s*[-:]?\s*(?:aire\s+)?(.*)/i, (m, g1, g2, g3) => `${g1.toUpperCase()}${g2} - Aire de ${g3}`);
  t = t.replace(/\bAire\s+de\s+([AEIOUYÀ-ÿ][a-zÀ-ÿ]+)/i, "Aire d'$1");

  const lowerWords = new Set([
    'de', 'du', 'des', 'en', 'sur', 'sous', 'et', 'au', 'aux', 'a', 'à', 'par', 'vers',
    'la', 'le', 'les', 'del', 'los', 'las', 'd', 'l', 'y',
    'di', 'della', 'delle', 'dei', 'degli', 'al', 'alla', 'alle', 'ai', 'agli',
    'sul', 'sulla', 'sulle', 'sui', 'sugli', 'da', 'in', 'con', 'per', 'tra', 'fra'
  ]);
  const acronyms = new Set([
    'rn', 'rd', 'cd', 'pk', 'km', 'bp', 'es', 'eni', 'q8', 'f6', 'cora', 'ip',
    'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13',
    'a14', 'a15', 'a16', 'a19', 'a20', 'a21', 'a22', 'a23', 'a24', 'a25', 'a26', 'a28',
    'a29', 'a30', 'a31', 'a32', 'a33', 'a34', 'a35', 'a36', 'a39', 'a40', 'a41', 'a42',
    'a43', 'a48', 'a50', 'a51', 'a52', 'a55', 'a56', 'a57', 'a61', 'a62', 'a63', 'a64',
    'a65', 'a71', 'a72', 'a75', 'a77', 'a81', 'a83', 'a84', 'a85', 'a86', 'a87', 'a89',
    'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8', 'm9', 'm11', 'm18', 'm20', 'm23', 'm25', 'm27',
    'm40', 'm42', 'm48', 'm50', 'm54', 'm56', 'm60', 'm61', 'm62', 'm65', 'm74', 'm90',
    't1', 't2', 't3', 't4', 'n104', 'rn104', 'rd104', 'cd419', 'uk'
  ]);
  const accents = {
    'Macon': 'Mâcon',
    'Chatellerault': 'Châtellerault',
    'Vallee': 'Vallée',
    'Eloi': 'Éloi',
    'Beziers': 'Béziers',
    'Broceliande': 'Brocéliande',
    'Aerodrome': 'Aérodrome',
    'Peripherique': 'Périphérique',
    'Exterieur': 'Extérieur',
    'Interieur': 'Intérieur',
    'Chambery': 'Chambéry',
    'Mediterranee': 'Méditerranée',
    'Cote': 'Côté',
    'Etoile': 'Étoile',
    'Foret': 'Forêt',
    'Leman': 'Léman',
    'Epernay': 'Épernay',
    'Nimes': 'Nîmes',
    'Pyrenees': 'Pyrénées',
    'Etienne': 'Étienne',
    'Cevennes': 'Cévennes'
  };

  const parts = t.split(/([ \t\-\/\',.:()]+)/);
  let isStart = true;
  const res = [];

  for (const tok of parts) {
    if (!tok) continue;
    if (/^[ \t\-\/\',.:()]+$/.test(tok)) {
      res.push(tok);
      if (/[\-\/\':(]/.test(tok)) isStart = true;
      continue;
    }
    const low = tok.toLowerCase();
    let formatted;
    if (/^(a|rn|rd|cd|n|d|ss|sr|sp|ra|t)\d+[a-z]?$/i.test(low) || acronyms.has(low)) {
      formatted = low.toUpperCase();
    } else if (lowerWords.has(low) && !isStart) {
      formatted = low;
    } else if (low === 'ste') {
      formatted = 'Sainte';
    } else if (low === 'st') {
      formatted = 'Saint';
    } else {
      formatted = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
      if (accents[formatted]) formatted = accents[formatted];
    }
    res.push(formatted);
    isStart = false;
  }

  let out = res.join('');
  out = out.replace(/\b([dDlL])\s*'\s*/g, "$1'");
  out = out.replace(/\b(Saint|Sainte)\s+([A-ZÀ-ÿ])/g, "$1-$2");
  out = out.replace(/d'\s+/gi, "d'").replace(/l'\s+/gi, "l'");
  if (out.startsWith("De ")) out = "De " + out.slice(3);
  return out;
}

// Global Mobile View Switcher
function setMobileView(view) {
  const btnMap = document.getElementById('btn-tab-map');
  const btnList = document.getElementById('btn-tab-list');
  const mapBar = document.getElementById('map-routes-bar');

  if (view === 'map') {
    document.body.classList.remove('mobile-view-list');
    document.body.classList.add('mobile-view-map');
    if (btnMap) btnMap.classList.add('active');
    if (btnList) btnList.classList.remove('active');
    if (mapBar && alternativeRoutes && alternativeRoutes.length > 1) {
      mapBar.style.display = 'flex';
      mapBar.style.position = 'fixed';
      mapBar.style.zIndex = '1950';
      ensureMobileNavBarVisible();
    }
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        // If no station popup is actively open, re-fit to show the entire route & stations
        if (!map._popup || !map._popup.isOpen()) {
          fitMapToRouteAndStations();
        }
      }
    }, 150);
  } else {
    document.body.classList.remove('mobile-view-map');
    document.body.classList.add('mobile-view-list');
    if (btnList) btnList.classList.add('active');
    if (btnMap) btnMap.classList.remove('active');
    if (mapBar) {
      mapBar.style.display = 'none';
    }
  }
}

// Official fuel denominations per country (Government open-data registries: FR, DE, ES, IT, GB)
const FUEL_LABELS_BY_COUNTRY = {
  FR: {
    e10: 'SP95-E10',
    gazole: 'Gazole (B7)',
    sp98: 'SP98 (E5)',
    sp95: 'SP95 (E5)',
    e85: 'Superéthanol E85',
    gplc: 'GPLc',
    all: 'Tous carburants'
  },
  DE: {
    e10: 'Super E10',
    gazole: 'Diesel (B7)',
    sp98: 'Super Plus (98)',
    sp95: 'Super E5 (95)',
    e85: 'Bioethanol E85',
    gplc: 'Autogas (LPG)',
    all: 'Alle Kraftstoffe'
  },
  BE: {
    e10: 'Super 95 (E10)',
    gazole: 'Diesel (B7)',
    sp98: 'Super 98 (E5)',
    sp95: 'Super 95 (E10)',
    e85: 'Bioéthanol E85',
    gplc: 'LPG',
    all: 'Tous carburants'
  },
  ES: {
    e10: 'Gasolina 95 E5',
    gazole: 'Gasóleo A (B7)',
    sp98: 'Gasolina 98 E5',
    sp95: 'Gasolina 95 E5',
    e85: 'Bioetanol E85',
    gplc: 'GLP (Autogás)',
    all: 'Todos los carburantes'
  },
  IT: {
    e10: 'Benzina (E5)',
    gazole: 'Gasolio (B7)',
    sp98: 'Benzina Speciale 98',
    sp95: 'Benzina (E5)',
    e85: 'Bioetanolo E85',
    gplc: 'GPL',
    metano: 'Metano (CNG)',
    all: 'Tutti i carburanti'
  },
  GB: {
    e10: 'Unleaded (E10)',
    gazole: 'Diesel (B7)',
    sp98: 'Super Unleaded (E5)',
    sp95: 'Unleaded (E10)',
    e85: 'Bioethanol E85',
    gplc: 'LPG Autogas',
    all: 'All fuels'
  }
};

function getFuelLabel(fuel, pays) {
  const countryCode = (pays && FUEL_LABELS_BY_COUNTRY[pays]) ? pays : 'FR';
  const dict = FUEL_LABELS_BY_COUNTRY[countryCode];
  return dict[fuel] || FUEL_LABELS_BY_COUNTRY.FR[fuel] || (fuel ? fuel.toUpperCase() : '');
}

// Return actual served fuel label for a station (distinguishes SP95-E10 vs SP95 (E5) in France & Germany)
function getServedFuelLabel(prices, requestedFuel, pays) {
  const c = pays || 'FR';
  if ((c === 'FR' || c === 'DE') && prices) {
    if (requestedFuel === 'e10' && (!prices.e10 || prices.e10 <= 0) && prices.sp95 > 0) {
      return getFuelLabel('sp95', c);
    }
    if (requestedFuel === 'sp95' && (!prices.sp95 || prices.sp95 <= 0) && prices.e10 > 0) {
      return getFuelLabel('e10', c);
    }
  }
  return getFuelLabel(requestedFuel, c);
}

// Distinct fuels to display when "All fuels" is selected in a given country (avoids duplicating e10/sp95 in ES, IT, GB)
function getDistinctCountryFuels(pays) {
  if (pays === 'GB' || pays === 'BE') return ['gazole', 'e10', 'sp98', 'gplc'];
  if (pays === 'DE') return ['gazole', 'e10', 'sp95', 'sp98', 'gplc'];
  if (pays === 'ES') return ['gazole', 'sp95', 'sp98', 'gplc', 'e85'];
  if (pays === 'IT') return ['gazole', 'sp95', 'sp98', 'gplc', 'metano'];
  return ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'];
}

// Initialize Application
const APP_VERSION = '6.6';
let userManuallySelectedLang = false;

// Clean up legacy localStorage keys so stale IP/test languages never override the physical country
try {
  localStorage.removeItem('fuelpilot_lang');
  localStorage.removeItem('fuelpilot_geo_lang');
} catch (e) {}

function mapCountryToLang(countryCode, lat, lon) {
  if (!countryCode) return null;
  const cc = String(countryCode).trim().toUpperCase();
  if (['FR', 'MC', 'BE', 'LU'].includes(cc)) return 'fr';
  if (['DE', 'AT', 'LI'].includes(cc)) return 'de';
  if (['IT', 'SM', 'VA'].includes(cc)) return 'it';
  if (['ES', 'AD'].includes(cc)) return 'es';
  if (['GB', 'UK', 'IE', 'GI'].includes(cc)) return 'en';
  if (cc === 'CH') {
    if (typeof lon === 'number' && lon < 7.15) return 'fr';
    if (typeof lat === 'number' && typeof lon === 'number' && lat < 46.25 && lon > 8.3) return 'it';
    return 'de';
  }
  return null;
}

function getTimezoneCountryLang() {
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
      if (tz.includes('paris') || tz.includes('brussels') || tz.includes('luxembourg') || tz.includes('monaco')) return 'fr';
      if (tz.includes('berlin') || tz.includes('busingen') || tz.includes('vienna') || tz.includes('vaduz') || tz.includes('zurich')) return 'de';
      if (tz.includes('rome') || tz.includes('san_marino') || tz.includes('vatican')) return 'it';
      if (tz.includes('madrid') || tz.includes('canary') || tz.includes('ceuta') || tz.includes('andorra')) return 'es';
      if (tz.includes('london') || tz.includes('belfast') || tz.includes('dublin') || tz.includes('jersey') || tz.includes('guernsey') || tz.includes('isle_of_man')) return 'en';
    }
  } catch (e) {}
  return null;
}

function getInitialDefaultLang() {
  try {
    const manualSession = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('fuelpilot_manual_lang');
    if (manualSession && ['fr', 'de', 'it', 'es', 'en'].includes(manualSession)) {
      userManuallySelectedLang = true;
      return manualSession;
    }
    const tzLang = getTimezoneCountryLang();
    if (tzLang) return tzLang;

    if (typeof navigator !== 'undefined') {
      const langs = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : (navigator.language ? [navigator.language] : []);
      for (const l of langs) {
        const short = String(l).slice(0, 2).toLowerCase();
        if (['fr', 'de', 'it', 'es', 'en'].includes(short)) return short;
      }
    }
  } catch (e) {}
  return 'fr';
}

let currentLang = getInitialDefaultLang();

const I18N_DICT = {
  fr: {
    pageTitle: "FuelPilot • Carburant Autoroute & Bornes PK",
    tagline: "Prix carburant & aires d'autoroute",
    privacy: "Confidentialité",
    live: "Prix en direct",
    refreshTitle: "Actualiser FuelPilot",
    sec1: "1. Choix de l'itinéraire",
    startPlaceholder: "Ville ou lieu de départ...",
    endPlaceholder: "Ville ou lieu d'arrivée...",
    stepPlaceholder: (n) => `Étape ${n} (ex: Beaune, Orléans...)`,
    removeStepTitle: "Supprimer l'étape",
    addStep: "+ Étape",
    calcBtn: "<span>🚀</span> Calculer l'itinéraire",
    calcInProgress: "Calcul en cours...",
    editBtn: "<span>✏️</span> Modifier",
    closeBtn: "<span>✖</span> Fermer",
    editBtnTitle: "Modifier le trajet",
    allBrands: "🏢 Toutes les enseignes",
    filterBrandTitle: "Filtrer par Enseigne",
    filterFuelTitle: "Filtrer par Carburant",
    sortTitle: "Ordre de tri",
    sec3: "3. Stations d'autoroute",
    sortRoute: "Tri : Ordre du trajet",
    sortPrice: "Tri : Moins cher d'abord",
    sortDist: "Tri : Distance",
    tabMap: "Carte",
    tabList: "Liste & Filtres",
    coverage: "Réseau couvert : 🇫🇷 France • 🇩🇪 Allemagne • 🇧🇪 Belgique • 🇮🇹 Italie • 🇪🇸 Espagne • 🇬🇧 Royaume-Uni",
    recentHdr: "🕒 10 dernières localités",
    bestPrice: "⭐ PRIX LE PLUS BAS",
    fromStart: (km) => `⏱️ À ${km} km du départ`,
    stationsCount: (n) => `${n} station${n > 1 ? 's' : ''} sur le trajet`,
    unavail: "⚠️ Non disponible",
    noPrice: "Non communiqués",
    priceLbl: "Prix",
    outOfStock: "⚠️ Rupture :",
    estimatedPrice: "ℹ️ Prix indicatif (non relevé en direct)",
    recommended: "🔵 Recommandé",
    optionN: (n) => `🟠 Option ${n}`,
    directRoute: "Itinéraire direct",
    countryCH: "Suisse",
    countryFR: "France",
    countryDE: "Allemagne",
    countryES: "Espagne",
    countryIT: "Italie",
    countryGB: "Royaume-Uni",
    countryIE: "Irlande",
    countryBE: "Belgique",
    areasCount: (n) => `${n} aires`,
    areasListed: (n) => `${n} aires répertoriées • Prix en direct`,
    kmMarker: (hw, pk) => `${hw || 'Autoroute'} • Borne km ${pk}`,
    popupDirDist: (dir, km) => `Sens : ${dir} • À ${km} km du départ`,
    sensDirect: "Sens direct",
    sensInverse: "Sens inverse",
    sensDouble: "Double sens",
    wazeTitle: "Y aller avec Waze",
    gmapsTitle: "Y aller avec Google Maps",
    mapRoad: "🗺️ Carte Routière",
    mapOsm: "🌍 OpenStreetMap",
    mapSat: "🛰️ Vue Satellite",
    emptyInitial: "Sélectionnez un départ et une arrivée pour afficher les stations d'autoroute et leurs bornes kilométriques.",
    emptyFilteredTitle: "Aucune station d'autoroute trouvée avec ces critères.",
    emptyFilteredSub: "Essayez de sélectionner « Toutes les enseignes » ou un autre carburant.",
    alertMissingPoints: "Veuillez renseigner un point de départ et un point d'arrivée.",
    alertNoRoute: "Aucun itinéraire routier trouvé.",
    alertServerError: "Impossible de joindre le serveur d'itinéraire. Veuillez réessayer.",
    ulysBadge: "🔥 BON PLAN PÉAGE • 0€ FRAIS DE GESTION",
    ulysTitle: "Badge Télépéage Ulys (Vinci)",
    ulysDesc: "Zéro attente aux barrières de péage en France, Espagne & Italie. Offre sans engagement.",
    ulysCta: "Profiter de l'offre ➔",
    amazonBadge: "🛒 ÉQUIPEMENT TRAJET RECOMMANDÉ",
    amazonView: "Voir ➔",
    amazonItems: [
      { icon: "📱", name: "Support Smartphone Grille / MagSafe", sub: "Maintien ultra-stable pour guidage GPS" },
      { icon: "⚡", name: "Chargeur Allume-Cigare USB-C Rapide", sub: "Recharge rapide 65W pendant votre trajet" }
    ],
    fuelInfoBtnTitle: "Correspondance des noms de carburants par pays",
    fuelInfoTitle: "⛽ Correspondance des carburants par pays",
    fuelInfoSubtitle: "Dénominations officielles aux pompes (Norme européenne EN 16942)",
    fuelColNorm: "Norme UE",
    fuelCatE10: "Sans Plomb 95 (E10)",
    fuelCatE5: "Sans Plomb 95 (E5)",
    fuelCatSp98: "Sans Plomb 98 (E5)",
    fuelCatDiesel: "Gazole / Diesel",
    fuelCatLpg: "GPL / Autogas",
    fuelCatE85: "Bioéthanol / Gaz",
    defaultCountry: "FR"
  },
  de: {
    pageTitle: "FuelPilot • Autobahn-Tankstellen & Kraftstoffpreise",
    tagline: "Kraftstoffpreise & Autobahnraststätten",
    privacy: "Datenschutz",
    live: "Live-Preise",
    refreshTitle: "FuelPilot aktualisieren",
    sec1: "1. Routenwahl",
    startPlaceholder: "Startort oder Adresse...",
    endPlaceholder: "Zielort oder Adresse...",
    stepPlaceholder: (n) => `Zwischenstopp ${n} (z. B. Köln, Nürnberg...)`,
    removeStepTitle: "Zwischenstopp entfernen",
    addStep: "+ Stopp",
    calcBtn: "<span>🚀</span> Route berechnen",
    calcInProgress: "Route wird berechnet...",
    editBtn: "<span>✏️</span> Ändern",
    closeBtn: "<span>✖</span> Schließen",
    editBtnTitle: "Route ändern",
    allBrands: "🏢 Alle Marken",
    filterBrandTitle: "Nach Marke filtern",
    filterFuelTitle: "Nach Kraftstoff filtern",
    sortTitle: "Sortierung",
    sec3: "3. Autobahntankstellen",
    sortRoute: "Sortierung: Routenverlauf",
    sortPrice: "Sortierung: Günstigste zuerst",
    sortDist: "Sortierung: Entfernung",
    tabMap: "Karte",
    tabList: "Liste & Filter",
    coverage: "Abgedecktes Netz: 🇫🇷 Frankreich • 🇩🇪 Deutschland • 🇧🇪 Belgien • 🇮🇹 Italien • 🇪🇸 Spanien • 🇬🇧 Vereinigtes Königreich",
    recentHdr: "🕒 Letzte 10 Orte",
    bestPrice: "⭐ NIEDRIGSTER PREIS",
    fromStart: (km) => `⏱️ ${km} km ab Start`,
    stationsCount: (n) => `${n} Tankstelle${n !== 1 ? 'n' : ''} auf der Route`,
    unavail: "⚠️ Nicht verfügbar",
    noPrice: "Keine Preisangabe",
    priceLbl: "Preis",
    outOfStock: "⚠️ Ausverkauft:",
    estimatedPrice: "ℹ️ Richtpreis (kein Live-Preis)",
    recommended: "🔵 Empfohlen",
    optionN: (n) => `🟠 Option ${n}`,
    directRoute: "Direkte Route",
    countryCH: "Schweiz",
    countryFR: "Frankreich",
    countryDE: "Deutschland",
    countryES: "Spanien",
    countryIT: "Italien",
    countryGB: "Vereinigtes Königreich",
    countryIE: "Irland",
    countryBE: "Belgien",
    areasCount: (n) => `${n} Raststätten`,
    areasListed: (n) => `${n} Autobahnraststätten • Live-Preise`,
    kmMarker: (hw, pk) => `${hw || 'Autobahn'} • km ${pk}`,
    popupDirDist: (dir, km) => `Richtung: ${dir} • ${km} km ab Start`,
    sensDirect: "Fahrtrichtung",
    sensInverse: "Gegenrichtung",
    sensDouble: "Beide Richtungen",
    wazeTitle: "Mit Waze navigieren",
    gmapsTitle: "Mit Google Maps navigieren",
    mapRoad: "🗺️ Straßenkarte",
    mapOsm: "🌍 OpenStreetMap",
    mapSat: "🛰️ Satellitenansicht",
    emptyInitial: "Wählen Sie einen Start- und Zielort, um Autobahntankstellen und deren Kilometrierung anzuzeigen.",
    emptyFilteredTitle: "Keine Autobahntankstelle mit diesen Kriterien gefunden.",
    emptyFilteredSub: "Versuchen Sie „Alle Marken“ oder einen anderen Kraftstoff auszuwählen.",
    alertMissingPoints: "Bitte geben Sie einen Startort und einen Zielort ein.",
    alertNoRoute: "Keine Straßenroute gefunden.",
    alertServerError: "Routenserver nicht erreichbar. Bitte versuchen Sie es erneut.",
    ulysBadge: "🔥 MAUT-ANGEBOT • 0 € GRUNDGEBÜHR",
    ulysTitle: "Ulys Mautbox (Vinci)",
    ulysDesc: "Ohne Wartezeit durch die Mautstellen in Frankreich, Spanien & Italien. Ohne Vertragsbindung.",
    ulysCta: "Angebot sichern ➔",
    amazonBadge: "🛒 EMPFOHLENES REISEZUBEHÖR",
    amazonView: "Ansehen ➔",
    amazonItems: [
      { icon: "📱", name: "Kfz-Handyhalterung Lüftung / MagSafe", sub: "Ultrastabiler Halt für die GPS-Navigation" },
      { icon: "⚡", name: "65W USB-C Schnellladegerät fürs Auto", sub: "Schnelles Aufladen während der Fahrt" }
    ],
    fuelInfoBtnTitle: "Kraftstoffbezeichnungen nach Ländern",
    fuelInfoTitle: "⛽ Kraftstoff-Übersicht nach Ländern",
    fuelInfoSubtitle: "Offizielle Bezeichnungen an der Zapfsäule (EU-Norm EN 16942)",
    fuelColNorm: "EU-Norm",
    fuelCatE10: "Super 95 (E10)",
    fuelCatE5: "Super 95 (E5)",
    fuelCatSp98: "Super Plus 98 (E5)",
    fuelCatDiesel: "Diesel",
    fuelCatLpg: "Autogas (LPG)",
    fuelCatE85: "Bioethanol / Erdgas",
    defaultCountry: "DE"
  },
  en: {
    pageTitle: "FuelPilot • Motorway Fuel Prices & Service Areas",
    tagline: "Motorway fuel prices & service areas",
    privacy: "Privacy",
    live: "Live prices",
    refreshTitle: "Refresh FuelPilot",
    sec1: "1. Route planner",
    startPlaceholder: "Departure city or place...",
    endPlaceholder: "Arrival city or place...",
    stepPlaceholder: (n) => `Stop ${n} (e.g. Oxford, Reading...)`,
    removeStepTitle: "Remove stop",
    addStep: "+ Stop",
    calcBtn: "<span>🚀</span> Calculate route",
    calcInProgress: "Calculating route...",
    editBtn: "<span>✏️</span> Edit",
    closeBtn: "<span>✖</span> Close",
    editBtnTitle: "Edit route",
    allBrands: "🏢 All brands",
    filterBrandTitle: "Filter by Brand",
    filterFuelTitle: "Filter by Fuel",
    sortTitle: "Sort order",
    sec3: "3. Motorway stations",
    sortRoute: "Sort: Route order",
    sortPrice: "Sort: Cheapest first",
    sortDist: "Sort: Distance",
    tabMap: "Map",
    tabList: "List & Filters",
    coverage: "Covered network: 🇫🇷 France • 🇩🇪 Germany • 🇧🇪 Belgium • 🇮🇹 Italy • 🇪🇸 Spain • 🇬🇧 UK",
    recentHdr: "🕒 10 recent locations",
    bestPrice: "⭐ LOWEST PRICE",
    fromStart: (km) => `⏱️ ${km} km from start`,
    stationsCount: (n) => `${n} station${n !== 1 ? 's' : ''} on route`,
    unavail: "⚠️ Unavailable",
    noPrice: "Not reported",
    priceLbl: "Price",
    outOfStock: "⚠️ Out of stock:",
    estimatedPrice: "ℹ️ Indicative price (not live)",
    recommended: "🔵 Recommended",
    optionN: (n) => `🟠 Option ${n}`,
    directRoute: "Direct route",
    countryCH: "Switzerland",
    countryFR: "France",
    countryDE: "Germany",
    countryES: "Spain",
    countryIT: "Italy",
    countryGB: "United Kingdom",
    countryIE: "Ireland",
    countryBE: "Belgium",
    areasCount: (n) => `${n} areas`,
    areasListed: (n) => `${n} service areas • Live prices`,
    kmMarker: (hw, pk) => `${hw || 'Motorway'} • Marker km ${pk}`,
    popupDirDist: (dir, km) => `Direction: ${dir} • ${km} km from start`,
    sensDirect: "Outbound",
    sensInverse: "Inbound",
    sensDouble: "Both directions",
    wazeTitle: "Navigate with Waze",
    gmapsTitle: "Navigate with Google Maps",
    mapRoad: "🗺️ Road Map",
    mapOsm: "🌍 OpenStreetMap",
    mapSat: "🛰️ Satellite View",
    emptyInitial: "Select a departure and arrival to display motorway service stations and their mileage markers.",
    emptyFilteredTitle: "No motorway station found matching these criteria.",
    emptyFilteredSub: "Try selecting \"All brands\" or another fuel type.",
    alertMissingPoints: "Please enter a departure point and an arrival point.",
    alertNoRoute: "No driving route found.",
    alertServerError: "Unable to reach the routing server. Please try again.",
    ulysBadge: "🔥 TOLL PASS DEAL • €0 MANAGEMENT FEE",
    ulysTitle: "Ulys Electronic Toll Tag (Vinci)",
    ulysDesc: "Zero wait at toll booths across France, Spain & Italy. No commitment.",
    ulysCta: "Get offer ➔",
    amazonBadge: "🛒 RECOMMENDED ROAD TRIP GEAR",
    amazonView: "View ➔",
    amazonItems: [
      { icon: "📱", name: "MagSafe / Air Vent Car Phone Mount", sub: "Ultra-stable hold for GPS navigation" },
      { icon: "⚡", name: "65W Fast USB-C Car Charger", sub: "Fast charging during your journey" }
    ],
    fuelInfoBtnTitle: "Fuel name correspondence across countries",
    fuelInfoTitle: "⛽ Fuel Names by Country",
    fuelInfoSubtitle: "Official pump labels across Europe (EN 16942 standard)",
    fuelColNorm: "EU Label",
    fuelCatE10: "Unleaded 95 (E10)",
    fuelCatE5: "Unleaded 95 (E5)",
    fuelCatSp98: "Super Unleaded 98",
    fuelCatDiesel: "Diesel",
    fuelCatLpg: "LPG Autogas",
    fuelCatE85: "Bioethanol / CNG",
    defaultCountry: "GB"
  },
  it: {
    pageTitle: "FuelPilot • Prezzi Carburante e Aree Autostradali",
    tagline: "Prezzi carburante e aree autostradali",
    privacy: "Privacy",
    live: "Prezzi live",
    refreshTitle: "Aggiorna FuelPilot",
    sec1: "1. Scelta dell'itinerario",
    startPlaceholder: "Città o luogo di partenza...",
    endPlaceholder: "Città o luogo di arrivo...",
    stepPlaceholder: (n) => `Tappa ${n} (es. Bologna, Firenze...)`,
    removeStepTitle: "Rimuovi tappa",
    addStep: "+ Tappa",
    calcBtn: "<span>🚀</span> Calcola itinerario",
    calcInProgress: "Calcolo in corso...",
    editBtn: "<span>✏️</span> Modifica",
    closeBtn: "<span>✖</span> Chiudi",
    editBtnTitle: "Modifica percorso",
    allBrands: "🏢 Tutti i marchi",
    filterBrandTitle: "Filtra per Marchio",
    filterFuelTitle: "Filtra per Carburante",
    sortTitle: "Ordine",
    sec3: "3. Stazioni autostradali",
    sortRoute: "Ordine: Percorso",
    sortPrice: "Ordine: Più economico",
    sortDist: "Ordine: Distanza",
    tabMap: "Mappa",
    tabList: "Lista e Filtri",
    coverage: "Rete coperta: 🇫🇷 Francia • 🇩🇪 Germania • 🇧🇪 Belgio • 🇮🇹 Italia • 🇪🇸 Spagna • 🇬🇧 Regno Unito",
    recentHdr: "🕒 Ultime 10 località",
    bestPrice: "⭐ PREZZO PIÙ BASSO",
    fromStart: (km) => `⏱️ A ${km} km dalla partenza`,
    stationsCount: (n) => `${n} stazion${n === 1 ? 'e' : 'i'} sul percorso`,
    unavail: "⚠️ Non disponibile",
    noPrice: "Non comunicati",
    priceLbl: "Prezzo",
    outOfStock: "⚠️ Esaurito:",
    estimatedPrice: "ℹ️ Prezzo indicativo (non in tempo reale)",
    recommended: "🔵 Consigliato",
    optionN: (n) => `🟠 Opzione ${n}`,
    directRoute: "Itinerario diretto",
    countryCH: "Svizzera",
    countryFR: "Francia",
    countryDE: "Germania",
    countryES: "Spagna",
    countryIT: "Italia",
    countryGB: "Regno Unito",
    countryIE: "Irlanda",
    countryBE: "Belgio",
    areasCount: (n) => `${n} aree`,
    areasListed: (n) => `${n} aree di servizio • Prezzi live`,
    kmMarker: (hw, pk) => `${hw || 'Autostrada'} • Km ${pk}`,
    popupDirDist: (dir, km) => `Direzione: ${dir} • A ${km} km dalla partenza`,
    sensDirect: "Senso diretto",
    sensInverse: "Senso opposto",
    sensDouble: "Doppio senso",
    wazeTitle: "Naviga con Waze",
    gmapsTitle: "Naviga con Google Maps",
    mapRoad: "🗺️ Mappa Stradale",
    mapOsm: "🌍 OpenStreetMap",
    mapSat: "🛰️ Vista Satellitare",
    emptyInitial: "Seleziona una partenza e un arrivo per visualizzare le stazioni autostradali e le progressive chilometriche.",
    emptyFilteredTitle: "Nessuna stazione autostradale trovata con questi criteri.",
    emptyFilteredSub: "Prova a selezionare \"Tutti i marchi\" o un altro carburante.",
    alertMissingPoints: "Inserisci un punto di partenza e un punto di arrivo.",
    alertNoRoute: "Nessun itinerario stradale trovato.",
    alertServerError: "Impossibile contattare il server di calcolo percorso. Riprova.",
    ulysBadge: "🔥 OFFERTA TELEPEDAGGIO • 0€ COSTI DI GESTIONE",
    ulysTitle: "Badge Telepedaggio Ulys (Vinci)",
    ulysDesc: "Zero attese ai caselli in Francia, Spagna e Italia. Senza vincoli.",
    ulysCta: "Scopri l'offerta ➔",
    amazonBadge: "🛒 ACCESSORI VIAGGIO CONSIGLIATI",
    amazonView: "Vedi ➔",
    amazonItems: [
      { icon: "📱", name: "Supporto Auto Smartphone / MagSafe", sub: "Tenuta ultra-stabile per navigazione GPS" },
      { icon: "⚡", name: "Caricabatterie Auto Rapido USB-C 65W", sub: "Ricarica rapida durante il viaggio" }
    ],
    fuelInfoBtnTitle: "Tabella di corrispondenza dei carburanti per paese",
    fuelInfoTitle: "⛽ Corrispondenza Carburanti per Paese",
    fuelInfoSubtitle: "Denominazioni ufficiali alla pompa (Norma europea EN 16942)",
    fuelColNorm: "Norma UE",
    fuelCatE10: "Benzina 95 (E10)",
    fuelCatE5: "Benzina 95 (E5)",
    fuelCatSp98: "Benzina 98/100 (E5)",
    fuelCatDiesel: "Gasolio / Diesel",
    fuelCatLpg: "GPL",
    fuelCatE85: "Bioetanolo / Metano",
    defaultCountry: "IT"
  },
  es: {
    pageTitle: "FuelPilot • Precios Carburante y Áreas de Autopista",
    tagline: "Precios de carburante y áreas de autopista",
    privacy: "Privacidad",
    live: "Precios en vivo",
    refreshTitle: "Actualizar FuelPilot",
    sec1: "1. Elección de ruta",
    startPlaceholder: "Ciudad o lugar de salida...",
    endPlaceholder: "Ciudad o lugar de llegada...",
    stepPlaceholder: (n) => `Etapa ${n} (ej. Zaragoza, Burgos...)`,
    removeStepTitle: "Eliminar etapa",
    addStep: "+ Etapa",
    calcBtn: "<span>🚀</span> Calcular ruta",
    calcInProgress: "Calculando ruta...",
    editBtn: "<span>✏️</span> Modificar",
    closeBtn: "<span>✖</span> Cerrar",
    editBtnTitle: "Modificar ruta",
    allBrands: "🏢 Todas las marcas",
    filterBrandTitle: "Filtrar por Marca",
    filterFuelTitle: "Filtrar por Carburante",
    sortTitle: "Orden",
    sec3: "3. Estaciones de autopista",
    sortRoute: "Orden: En ruta",
    sortPrice: "Orden: Más barato",
    sortDist: "Orden: Distancia",
    tabMap: "Mapa",
    tabList: "Lista y Filtros",
    coverage: "Red cubierta: 🇫🇷 Francia • 🇩🇪 Alemania • 🇧🇪 Bélgica • 🇮🇹 Italia • 🇪🇸 España • 🇬🇧 Reino Unido",
    recentHdr: "🕒 10 últimas localidades",
    bestPrice: "⭐ PRECIO MÁS BAJO",
    fromStart: (km) => `⏱️ A ${km} km de la salida`,
    stationsCount: (n) => `${n} estaci${n === 1 ? 'ón' : 'ones'} en ruta`,
    unavail: "⚠️ No disponible",
    noPrice: "No comunicados",
    priceLbl: "Precio",
    outOfStock: "⚠️ Agotado:",
    estimatedPrice: "ℹ️ Precio orientativo (no en tiempo real)",
    recommended: "🔵 Recomendado",
    optionN: (n) => `🟠 Opción ${n}`,
    directRoute: "Ruta directa",
    countryCH: "Suiza",
    countryFR: "Francia",
    countryDE: "Alemania",
    countryES: "España",
    countryIT: "Italia",
    countryGB: "Reino Unido",
    countryIE: "Irlanda",
    countryBE: "Bélgica",
    areasCount: (n) => `${n} áreas`,
    areasListed: (n) => `${n} áreas de servicio • Precios en vivo`,
    kmMarker: (hw, pk) => `${hw || 'Autopista'} • PK km ${pk}`,
    popupDirDist: (dir, km) => `Sentido: ${dir} • A ${km} km de la salida`,
    sensDirect: "Sentido directo",
    sensInverse: "Sentido inverso",
    sensDouble: "Doble sentido",
    wazeTitle: "Ir con Waze",
    gmapsTitle: "Ir con Google Maps",
    mapRoad: "🗺️ Mapa de Carreteras",
    mapOsm: "🌍 OpenStreetMap",
    mapSat: "🛰️ Vista Satélite",
    emptyInitial: "Seleccione un punto de salida y de llegada para mostrar las estaciones de autopista y sus puntos kilométricos.",
    emptyFilteredTitle: "No se encontraron estaciones de autopista con estos criterios.",
    emptyFilteredSub: "Pruebe a seleccionar \"Todas las marcas\" u otro carburante.",
    alertMissingPoints: "Por favor, introduzca un punto de salida y un punto de llegada.",
    alertNoRoute: "No se encontró ninguna ruta por carretera.",
    alertServerError: "No se pudo conectar con el servidor de rutas. Inténtelo de nuevo.",
    ulysBadge: "🔥 OFERTA TELEPEAJE • 0€ GASTOS DE GESTIÓN",
    ulysTitle: "Via-T Telepeaje Ulys (Vinci)",
    ulysDesc: "Cero esperas en los peajes de Francia, España e Italia. Sin compromiso.",
    ulysCta: "Ver oferta ➔",
    amazonBadge: "🛒 EQUIPAMIENTO DE VIAJE RECOMENDADO",
    amazonView: "Ver ➔",
    amazonItems: [
      { icon: "📱", name: "Soporte Móvil Coche Rejilla / MagSafe", sub: "Sujeción ultraestable para navegación GPS" },
      { icon: "⚡", name: "Cargador Coche Rápido USB-C 65W", sub: "Carga rápida durante su viaje" }
    ],
    fuelInfoBtnTitle: "Tabla de correspondencia de carburantes por país",
    fuelInfoTitle: "⛽ Correspondencia de Carburantes por País",
    fuelInfoSubtitle: "Denominaciones oficiales en surtidor (Norma europea EN 16942)",
    fuelColNorm: "Norma UE",
    fuelCatE10: "Gasolina 95 (E10)",
    fuelCatE5: "Gasolina 95 (E5)",
    fuelCatSp98: "Gasolina 98 (E5)",
    fuelCatDiesel: "Gasóleo / Diésel",
    fuelCatLpg: "GLP (Autogás)",
    fuelCatE85: "Bioetanol / GNC",
    defaultCountry: "ES"
  }
};

function t() {
  return I18N_DICT[currentLang] || I18N_DICT.fr;
}

function translateCountryName(rawName) {
  if (!rawName) return '';
  const tr = t();
  const n = rawName.trim().toLowerCase();
  if (n === 'france' || n === 'francia' || n === 'frankreich') return tr.countryFR;
  if (n === 'allemagne' || n === 'germany' || n === 'deutschland' || n === 'germania' || n === 'alemania') return tr.countryDE;
  if (n === 'espagne' || n === 'spain' || n === 'spagna' || n === 'españa' || n === 'spanien') return tr.countryES;
  if (n === 'italie' || n === 'italy' || n === 'italia' || n === 'italien') return tr.countryIT;
  if (n === 'royaume-uni' || n === 'united kingdom' || n === 'regno unito' || n === 'reino unido' || n === 'vereinigtes königreich') return tr.countryGB;
  if (n === 'suisse' || n === 'switzerland' || n === 'svizzera' || n === 'suiza' || n === 'schweiz') return tr.countryCH;
  if (n === 'irlande' || n === 'ireland' || n === 'irlanda' || n === 'irland') return tr.countryIE;
  if (n === 'belgique' || n === 'belgium' || n === 'belgio' || n === 'bélgica' || n === 'belgien') return tr.countryBE;
  return rawName;
}

function translateSens(sensStr, isNativeCase) {
  if (!sensStr) return t().sensDirect;
  const sLow = sensStr.trim().toLowerCase();
  if (sLow.includes('double')) return t().sensDouble;
  if (sLow === 'sens direct') return t().sensDirect;
  if (sLow === 'sens inverse') return t().sensInverse;
  if (currentLang === 'fr') return isNativeCase ? sensStr : formatProperName(sensStr);

  if (sLow === 'sens gauche (i)') {
    if (currentLang === 'de') return 'Linke Seite (L)';
    return currentLang === 'en' ? 'Left side (L)' : (currentLang === 'it' ? 'Lato sinistro (S)' : 'Margen izquierdo (I)');
  }
  if (sLow === 'sens droite (d)') {
    if (currentLang === 'de') return 'Rechte Seite (R)';
    return currentLang === 'en' ? 'Right side (R)' : (currentLang === 'it' ? 'Lato destro (D)' : 'Margen derecho (D)');
  }

  let out = isNativeCase ? sensStr : formatProperName(sensStr);
  if (currentLang === 'en') {
    out = out
      .replace(/^Côté\s+/i, 'Side ')
      .replace(/^Sens\s+/i, 'Dir. ')
      .replace(/\bOuest\b/gi, 'West')
      .replace(/\bEst\b/gi, 'East')
      .replace(/\bNord\b/gi, 'North')
      .replace(/\bSud\b/gi, 'South')
      .replace(/\bIntérieur\b/gi, 'Inner')
      .replace(/\bExtérieur\b/gi, 'Outer')
      .replace(/\bEspagne\b/gi, 'Spain')
      .replace(/\bItalie\b/gi, 'Italy')
      .replace(/\bAllemagne\b/gi, 'Germany')
      .replace(/\bSuisse\b/gi, 'Switzerland');
  } else if (currentLang === 'de') {
    out = out
      .replace(/^Côté\s+/i, 'Seite ')
      .replace(/^Sens\s+/i, 'Richtung ')
      .replace(/\bOuest\b/gi, 'West')
      .replace(/\bEst\b/gi, 'Ost')
      .replace(/\bNord\b/gi, 'Nord')
      .replace(/\bSud\b/gi, 'Süd')
      .replace(/\bIntérieur\b/gi, 'Innenring')
      .replace(/\bExtérieur\b/gi, 'Außenring')
      .replace(/\bEspagne\b/gi, 'Spanien')
      .replace(/\bItalie\b/gi, 'Italien')
      .replace(/\bFrance\b/gi, 'Frankreich')
      .replace(/\bAllemagne\b/gi, 'Deutschland')
      .replace(/\bSuisse\b/gi, 'Schweiz');
  } else if (currentLang === 'it') {
    out = out
      .replace(/^Côté\s+/i, 'Lato ')
      .replace(/^Sens\s+/i, 'Dir. ')
      .replace(/\bOuest\b/gi, 'Ovest')
      .replace(/\bEst\b/gi, 'Est')
      .replace(/\bNord\b/gi, 'Nord')
      .replace(/\bSud\b/gi, 'Sud')
      .replace(/\bIntérieur\b/gi, 'Interno')
      .replace(/\bExtérieur\b/gi, 'Esterno')
      .replace(/\bEspagne\b/gi, 'Spagna')
      .replace(/\bItalie\b/gi, 'Italia')
      .replace(/\bAllemagne\b/gi, 'Germania')
      .replace(/\bFrance\b/gi, 'Francia');
  } else if (currentLang === 'es') {
    out = out
      .replace(/^Côté\s+/i, 'Lado ')
      .replace(/^Sens\s+/i, 'Sentido ')
      .replace(/\bOuest\b/gi, 'Oeste')
      .replace(/\bEst\b/gi, 'Este')
      .replace(/\bNord\b/gi, 'Norte')
      .replace(/\bSud\b/gi, 'Sur')
      .replace(/\bIntérieur\b/gi, 'Interior')
      .replace(/\bExtérieur\b/gi, 'Exterior')
      .replace(/\bEspagne\b/gi, 'España')
      .replace(/\bItalie\b/gi, 'Italia')
      .replace(/\bAllemagne\b/gi, 'Alemania')
      .replace(/\bFrance\b/gi, 'Francia');
  }
  return out;
}

let countryBadgeMarkers = [];
let mapLayerControl = null;
let mapBaseLayers = null;

function renderCountryBadgesOnMap() {
  if (!map) return;
  countryBadgeMarkers.forEach(m => map.removeLayer(m));
  countryBadgeMarkers = [];
  const tr = t();
  const countryLabels = [
    { coords: [46.6, 2.5], flag: '🇫🇷', name: tr.countryFR, count: tr.areasCount(438) },
    { coords: [51.1, 10.4], flag: '🇩🇪', name: tr.countryDE, count: tr.areasCount(218) },
    { coords: [50.55, 4.7], flag: '🇧🇪', name: tr.countryBE, count: tr.areasCount(76) },
    { coords: [42.6, 12.8], flag: '🇮🇹', name: tr.countryIT, count: tr.areasCount(615) },
    { coords: [40.2, -3.6], flag: '🇪🇸', name: tr.countryES, count: tr.areasCount(833) },
    { coords: [52.8, -1.8], flag: '🇬🇧', name: tr.countryGB, count: tr.areasCount(158) }
  ];
  countryLabels.forEach(c => {
    const icon = L.divIcon({
      className: 'country-badge-marker',
      html: `<div class="country-badge-pill">${c.flag} ${c.name} <span class="country-count-tag">• ${c.count}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
    countryBadgeMarkers.push(L.marker(c.coords, { icon, interactive: false }).addTo(map));
  });
}

// Enforce the exact flag order in #lang-bar: France, Germany, Italy, Spain, United Kingdom
function ensureLangBarOrder() {
  const bar = document.getElementById('lang-bar');
  if (!bar) return;
  if (!bar.querySelector('[data-lang="de"]')) {
    const deBtn = document.createElement('button');
    deBtn.type = 'button';
    deBtn.className = 'lang-flag-btn';
    deBtn.dataset.lang = 'de';
    deBtn.title = 'Deutsch';
    deBtn.setAttribute('aria-label', 'Deutsch');
    deBtn.innerHTML = `<svg class="lang-flag-svg" viewBox="0 0 60 36" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="12" fill="#000000"/><rect y="12" width="60" height="12" fill="#DD0000"/><rect y="24" width="60" height="12" fill="#FFCE00"/></svg>`;
    bar.appendChild(deBtn);
  }
  const desiredOrder = ['fr', 'de', 'it', 'es', 'en'];
  desiredOrder.forEach(code => {
    const btn = bar.querySelector(`[data-lang="${code}"]`);
    if (btn) bar.appendChild(btn);
  });
}

function updateMapLayerControlLabels() {
  if (!map || !mapBaseLayers) return;
  if (mapLayerControl) {
    map.removeControl(mapLayerControl);
  }
  const tr = t();
  const baseMaps = {
    [tr.mapRoad]: mapBaseLayers.osmFr,
    [tr.mapOsm]: mapBaseLayers.osmStandard,
    [tr.mapSat]: mapBaseLayers.esriSat
  };
  mapLayerControl = L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
}

function setAppLanguage(lang, isManual = false) {
  if (!I18N_DICT[lang]) lang = 'fr';
  currentLang = lang;
  if (isManual) {
    userManuallySelectedLang = true;
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fuelpilot_manual_lang', lang);
    } catch (e) {}
  }

  document.documentElement.lang = lang;
  document.querySelectorAll('#lang-bar .lang-flag-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const tr = t();
  document.title = tr.pageTitle;

  const taglineEl = document.getElementById('i18n-tagline') || document.querySelector('.brand-tagline');
  if (taglineEl) taglineEl.textContent = tr.tagline;

  const privEl = document.getElementById('i18n-privacy');
  if (privEl) {
    privEl.textContent = tr.privacy;
    privEl.title = tr.privacy;
    privEl.href = `privacy.html?lang=${currentLang}`;
  }

  const liveEl = document.getElementById('i18n-live-text') || document.querySelector('.live-text');
  if (liveEl) liveEl.textContent = tr.live;

  const liveBadge = document.querySelector('.badge-live');
  if (liveBadge) liveBadge.title = tr.refreshTitle;

  const sec1El = document.querySelector('#itinerary-full-form .section-title span');
  if (sec1El) sec1El.textContent = tr.sec1;

  const startEl = document.getElementById('input-start');
  if (startEl) startEl.placeholder = tr.startPlaceholder;

  const endEl = document.getElementById('input-end');
  if (endEl) endEl.placeholder = tr.endPlaceholder;

  document.querySelectorAll('#waypoints-container .waypoint-item').forEach((row, idx) => {
    const inp = row.querySelector('input.address-input');
    if (inp) inp.placeholder = tr.stepPlaceholder(idx + 1);
    const delBtn = row.querySelector('.btn-remove-step');
    if (delBtn) delBtn.title = tr.removeStepTitle;
  });

  const addWpBtn = document.getElementById('btn-add-waypoint');
  if (addWpBtn) addWpBtn.textContent = tr.addStep;

  const calcBtn = document.getElementById('btn-calculate');
  if (calcBtn && !calcBtn.disabled) calcBtn.innerHTML = tr.calcBtn;

  const editBtn = document.getElementById('btn-toggle-route-edit');
  if (editBtn) {
    const isCollapsed = document.body.classList.contains('mobile-route-collapsed');
    editBtn.innerHTML = isCollapsed ? tr.editBtn : tr.closeBtn;
    editBtn.title = tr.editBtnTitle;
  }

  const brandSelect = document.getElementById('select-brand');
  if (brandSelect) {
    brandSelect.title = tr.filterBrandTitle;
    if (brandSelect.options.length > 0 && brandSelect.options[0].value === 'all') {
      const distinctBrandsCount = allStations && allStations.length > 0
        ? new Set(allStations.map(s => s.enseigne || 'Indépendant')).size
        : 0;
      const countSuffix = distinctBrandsCount > 0 ? ` (${distinctBrandsCount})` : '';
      brandSelect.options[0].textContent = `${tr.allBrands}${countSuffix}`;
    }
  }

  // Update Ulys Partner card texts
  const ulysCard = document.getElementById('partner-ulys-card');
  if (ulysCard) {
    const ub = ulysCard.querySelector('.ulys-badge-alert');
    const ut = ulysCard.querySelector('.partner-title');
    const ud = ulysCard.querySelector('.partner-desc');
    const uc = ulysCard.querySelector('#link-partner-ulys');
    if (ub) ub.textContent = tr.ulysBadge;
    if (ut) ut.textContent = tr.ulysTitle;
    if (ud) ud.textContent = tr.ulysDesc;
    if (uc) uc.textContent = tr.ulysCta;
  }

  // Update fuel dropdown default labels when no route is active
  const fuelSelectEl = document.getElementById('select-fuel');
  if (fuelSelectEl) {
    fuelSelectEl.title = tr.filterFuelTitle;
    if (!currentRouteStations || currentRouteStations.length === 0) {
      const dict = FUEL_LABELS_BY_COUNTRY[tr.defaultCountry] || FUEL_LABELS_BY_COUNTRY.FR;
      const hasSeparateSp95 = tr.defaultCountry === 'FR' || tr.defaultCountry === 'DE';
      Array.from(fuelSelectEl.options).forEach(opt => {
        if (opt.value === 'sp95') opt.style.display = hasSeparateSp95 ? '' : 'none';
        if (dict[opt.value]) opt.textContent = `⛽ ${dict[opt.value]}`;
      });
    }
  }

  const sortSelect = document.getElementById('select-sort');
  if (sortSelect) {
    sortSelect.title = tr.sortTitle;
    Array.from(sortSelect.options).forEach(opt => {
      if (opt.value === 'route') opt.textContent = tr.sortRoute;
      if (opt.value === 'price') opt.textContent = tr.sortPrice;
      if (opt.value === 'dist') opt.textContent = tr.sortDist;
    });
  }

  const sec3El = document.querySelector('.stations-header .section-title span');
  if (sec3El) sec3El.textContent = tr.sec3;

  const tabMapLbl = document.querySelector('#btn-tab-map .tab-label');
  if (tabMapLbl) tabMapLbl.textContent = tr.tabMap;

  const tabListLbl = document.querySelector('#btn-tab-list .tab-label');
  if (tabListLbl) tabListLbl.textContent = tr.tabList;

  const covEl = document.querySelector('.coverage-text');
  if (covEl) covEl.textContent = tr.coverage;

  renderCountryBadgesOnMap();
  updateMapLayerControlLabels();
  renderFuelInfoModal();

  if (alternativeRoutes && alternativeRoutes.length > 1) {
    renderRouteAlternatives();
  }
  if (activeRouteData || (currentRouteStations && currentRouteStations.length > 0)) {
    renderCurrentRouteStations();
  } else {
    const countLabel = document.getElementById('stations-count-label');
    if (countLabel) countLabel.textContent = tr.stationsCount(0);
    const listContainer = document.getElementById('stations-list');
    if (listContainer) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color: var(--text-muted);">
          <p style="font-size: 2rem; margin-bottom: 8px;">🛣️</p>
          <p>${tr.emptyInitial}</p>
        </div>
      `;
    }
  }
}

// Dynamically calibrate mobile bottom nav bar position using VisualViewport & Screen APIs
// Validated across 14 smartphone models (Samsung, Google Pixel, Xiaomi, Apple iPhone, OnePlus, Honor/Huawei, Motorola, Sony, Oppo)
function ensureMobileNavBarVisible() {
  const navBar = document.getElementById('mobile-nav-bar');
  if (!navBar) return;
  if (window.innerWidth > 1080) {
    navBar.style.display = 'none';
    return;
  }
  navBar.style.display = 'flex';
  const vv = window.visualViewport;
  const innerH = window.innerHeight || document.documentElement.clientHeight;
  const visibleH = vv ? vv.height : innerH;
  const offsetTop = vv ? vv.offsetTop : 0;

  // 1. Occlusion from browser bottom toolbar (Safari / Chrome / Samsung Internet / ColorOS)
  const occludedBottom = Math.max(0, Math.round(innerH - (visibleH + offsetTop)));

  // 2. Detect Android Edge-to-Edge unsubtracted system navigation bar (3-button 48px or gesture 24px):
  // When OS subtracts status (24px) + nav bar (48px), screen.height - innerHeight >= 68px.
  // When Edge-to-Edge is active, screen.height - innerHeight is only 0..24px, so the 48px nav bar overlays the bottom.
  const screenH = (window.screen && window.screen.height) ? window.screen.height : innerH;
  const chromeSubtracted = Math.max(0, screenH - innerH);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const unsubtractedSysBar = isIOS ? 0 : Math.max(0, 68 - chromeSubtracted);

  const safeBottomPx = 16 + occludedBottom + unsubtractedSysBar;
  navBar.style.setProperty('bottom', `calc(${safeBottomPx}px + env(safe-area-inset-bottom, 0px))`, 'important');

  const mapBar = document.getElementById('map-routes-bar');
  if (mapBar) {
    mapBar.style.setProperty('bottom', `calc(${safeBottomPx + 56}px + env(safe-area-inset-bottom, 0px))`, 'important');
  }
}

async function checkAndAutoUpdateApp() {
  try {
    const res = await fetch(`index.html?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/app\.js\?v=([0-9.]+)/);
    if (m && m[1] && m[1] !== APP_VERSION) {
      window.location.replace(`index.html?_v=${m[1]}_${Date.now()}`);
    }
  } catch (e) {}
}

async function detectCountryAndSetLanguage() {
  if (userManuallySelectedLang) return;

  const applyDetectedCountry = (countryCode, lat, lon) => {
    if (userManuallySelectedLang) return;
    const lang = mapCountryToLang(countryCode, lat, lon);
    if (lang && I18N_DICT[lang] && currentLang !== lang) {
      setAppLanguage(lang, false);
    }
  };

  // Only query IP geolocation if the device's cellular/OS timezone did not already identify a European country
  // (Prevents iCloud Private Relay / mobile VPN / carrier proxies in UK or US from overriding a phone physically in France)
  if (!getTimezoneCountryLang()) {
    (async () => {
      try {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch('https://get.geojs.io/v1/ip/country.json', { signal: ctrl.signal });
        clearTimeout(tId);
        if (res.ok) {
          const data = await res.json();
          if (data && data.country) {
            applyDetectedCountry(data.country);
          }
        }
      } catch (e) {}
    })();
  }

  // HTML5 GPS Geolocation: uses real physical coordinates (latitude/longitude) when granted
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (userManuallySelectedLang || !pos || !pos.coords) return;
          const { latitude, longitude } = pos.coords;
          try {
            const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}`);
            if (res.ok) {
              const data = await res.json();
              if (data && data.countryCode) {
                applyDetectedCountry(data.countryCode, latitude, longitude);
              }
            }
          } catch (e) {}
        },
        () => {},
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
      );
    } catch (e) {}
  }
}

function updateFuelScrollArrows() {
  const bodyEl = document.getElementById('fuel-info-body');
  const leftBtn = document.getElementById('fuel-scroll-left');
  const rightBtn = document.getElementById('fuel-scroll-right');
  if (!bodyEl || !leftBtn || !rightBtn) return;

  const maxScroll = bodyEl.scrollWidth - bodyEl.clientWidth;
  if (maxScroll <= 6) {
    leftBtn.style.visibility = 'hidden';
    rightBtn.style.visibility = 'hidden';
    return;
  }
  leftBtn.style.visibility = bodyEl.scrollLeft > 8 ? 'visible' : 'hidden';
  rightBtn.style.visibility = bodyEl.scrollLeft < maxScroll - 8 ? 'visible' : 'hidden';
}

function renderFuelInfoModal() {
  const tr = t();
  const infoBtn = document.getElementById('btn-fuel-info');
  if (infoBtn) {
    infoBtn.title = tr.fuelInfoBtnTitle;
    infoBtn.setAttribute('aria-label', tr.fuelInfoBtnTitle);
  }
  const titleEl = document.getElementById('fuel-info-title');
  if (titleEl) titleEl.textContent = tr.fuelInfoTitle;
  const subEl = document.getElementById('fuel-info-subtitle');
  if (subEl) subEl.textContent = tr.fuelInfoSubtitle;
  const closeBtn = document.getElementById('btn-close-fuel-info');
  if (closeBtn) closeBtn.setAttribute('aria-label', tr.closeBtn.replace(/<[^>]*>/g, '').trim());

  const bodyEl = document.getElementById('fuel-info-body');
  if (!bodyEl) return;

  bodyEl.innerHTML = `
    <table class="fuel-equiv-table">
      <thead>
        <tr>
          <th>${tr.fuelColNorm}</th>
          <th>🇫🇷 ${tr.countryFR}</th>
          <th>🇩🇪 ${tr.countryDE}</th>
          <th>🇧🇪 ${tr.countryBE}</th>
          <th>🇮🇹 ${tr.countryIT}</th>
          <th>🇪🇸 ${tr.countryES}</th>
          <th>🇬🇧 ${tr.countryGB}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="eu-pump-tag eu-tag-gasoline">E10</span> <b>${tr.fuelCatE10}</b></td>
          <td><b>SP95-E10</b></td>
          <td><b>Super E10</b></td>
          <td><b>Super 95 (E10)</b></td>
          <td>Benzina (E5/E10)</td>
          <td>Gasolina 95 E5/E10</td>
          <td><b>Unleaded (E10)</b></td>
        </tr>
        <tr>
          <td><span class="eu-pump-tag eu-tag-gasoline">E5</span> <b>${tr.fuelCatE5}</b></td>
          <td><b>SP95 (E5)</b></td>
          <td><b>Super E5 (95)</b></td>
          <td>Super 95 (E5)</td>
          <td><b>Benzina (E5)</b></td>
          <td><b>Gasolina 95 E5</b></td>
          <td>Unleaded 95</td>
        </tr>
        <tr>
          <td><span class="eu-pump-tag eu-tag-diesel">B7</span> <b>${tr.fuelCatDiesel}</b></td>
          <td><b>Gazole (B7)</b></td>
          <td><b>Diesel (B7)</b></td>
          <td><b>Diesel (B7)</b></td>
          <td><b>Gasolio (B7)</b></td>
          <td><b>Gasóleo A (B7)</b></td>
          <td><b>Diesel (B7)</b></td>
        </tr>
        <tr>
          <td><span class="eu-pump-tag eu-tag-gasoline">E5</span> <b>${tr.fuelCatSp98}</b></td>
          <td><b>SP98 (E5)</b></td>
          <td><b>Super Plus (98)</b></td>
          <td><b>Super 98 (E5)</b></td>
          <td><b>Benzina Speciale 98/100</b></td>
          <td><b>Gasolina 98 E5</b></td>
          <td><b>Super Unleaded (E5)</b></td>
        </tr>
        <tr>
          <td><span class="eu-pump-tag eu-tag-lpg">LPG</span> <b>${tr.fuelCatLpg}</b></td>
          <td><b>GPLc</b></td>
          <td><b>Autogas (LPG)</b></td>
          <td><b>LPG</b></td>
          <td><b>GPL</b></td>
          <td><b>GLP (Autogás)</b></td>
          <td><b>LPG Autogas</b></td>
        </tr>
        <tr>
          <td><span class="eu-pump-tag eu-tag-gasoline">E85</span> <b>${tr.fuelCatE85}</b></td>
          <td><b>Superéthanol E85</b></td>
          <td>Bioethanol E85</td>
          <td>Bioéthanol E85</td>
          <td><b>Metano (CNG)</b> / E85</td>
          <td><b>Bioetanol E85</b></td>
          <td>Bioethanol E85</td>
        </tr>
      </tbody>
    </table>
  `;
  setTimeout(updateFuelScrollArrows, 30);
}

document.addEventListener('DOMContentLoaded', async () => {
  checkAndAutoUpdateApp();
  ensureMobileNavBarVisible();
  window.addEventListener('resize', ensureMobileNavBarVisible);
  window.addEventListener('resize', updateFuelScrollArrows);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ensureMobileNavBarVisible);
    window.visualViewport.addEventListener('scroll', ensureMobileNavBarVisible);
  }
  const liveBadge = document.querySelector('.badge-live');
  if (liveBadge) {
    liveBadge.style.cursor = 'pointer';
    liveBadge.title = t().refreshTitle;
    liveBadge.addEventListener('click', () => {
      try { sessionStorage.removeItem('fuelpilot_manual_lang'); } catch (e) {}
      window.location.replace(`index.html?_v=${Date.now()}`);
    });
  }
  const fuelInfoBtn = document.getElementById('btn-fuel-info');
  const fuelInfoModal = document.getElementById('fuel-info-modal');
  const closeFuelInfoBtn = document.getElementById('btn-close-fuel-info');
  const fuelInfoBody = document.getElementById('fuel-info-body');
  const fuelScrollLeftBtn = document.getElementById('fuel-scroll-left');
  const fuelScrollRightBtn = document.getElementById('fuel-scroll-right');
  if (fuelInfoBody) {
    fuelInfoBody.addEventListener('scroll', updateFuelScrollArrows);
  }
  if (fuelScrollLeftBtn && fuelInfoBody) {
    fuelScrollLeftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fuelInfoBody.scrollBy({ left: -180, behavior: 'smooth' });
    });
  }
  if (fuelScrollRightBtn && fuelInfoBody) {
    fuelScrollRightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fuelInfoBody.scrollBy({ left: 180, behavior: 'smooth' });
    });
  }
  if (fuelInfoBtn && fuelInfoModal) {
    fuelInfoBtn.addEventListener('click', () => {
      renderFuelInfoModal();
      fuelInfoModal.style.display = 'flex';
      if (fuelInfoBody) fuelInfoBody.scrollLeft = 0;
      setTimeout(updateFuelScrollArrows, 40);
    });
  }
  if (closeFuelInfoBtn && fuelInfoModal) {
    closeFuelInfoBtn.addEventListener('click', () => {
      fuelInfoModal.style.display = 'none';
    });
  }
  if (fuelInfoModal) {
    fuelInfoModal.addEventListener('click', (e) => {
      if (e.target === fuelInfoModal) {
        fuelInfoModal.style.display = 'none';
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fuelInfoModal && fuelInfoModal.style.display !== 'none') {
      fuelInfoModal.style.display = 'none';
    }
  });
  ensureLangBarOrder();
  document.querySelectorAll('#lang-bar .lang-flag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setAppLanguage(btn.dataset.lang, true);
    });
  });
  setAppLanguage(currentLang, false);
  detectCountryAndSetLanguage();
  initMap();

  const startInput = document.getElementById('input-start');
  const endInput = document.getElementById('input-end');

  setupAutocomplete('input-start', 'dropdown-start', (coords, label) => {
    startPoint = { coords, label };
    if (startInput) startInput.classList.remove('input-attention-pulse');
  });
  setupAutocomplete('input-end', 'dropdown-end', (coords, label) => {
    endPoint = { coords, label };
    if (endInput) endInput.classList.remove('input-attention-pulse');
  });

  if (startInput) {
    startInput.addEventListener('input', () => {
      if (startInput.value.trim().length > 0) {
        startInput.classList.remove('input-attention-pulse');
      }
    });
  }
  if (endInput) {
    endInput.addEventListener('input', () => {
      if (endInput.value.trim().length > 0) {
        endInput.classList.remove('input-attention-pulse');
      }
    });
  }

  setupEventListeners();
  await loadStationsData();
  await loadCoveredCountries();
});

// Initialize Leaflet Map
function initMap() {
  // Center to encompass France, Spain, Italy & UK coverage
  const initialZoom = window.innerWidth <= 768 ? 4.5 : 5.0;
  map = L.map('map', {
    zoomControl: false
  }).setView([46.2, 3.0], initialZoom);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Basemap 1: OpenStreetMap France (optimisé pour les autoroutes et routes françaises, 100% gratuit, sans filigrane ni clé)
  const osmFr = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap France | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20
  });

  // Basemap 2: OpenStreetMap Standard international
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  });

  // Basemap 3: Vue Satellite ESRI
  const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18
  });

  // Add default layer
  osmFr.addTo(map);

  mapBaseLayers = { osmFr, osmStandard, esriSat };
  updateMapLayerControlLabels();
}

// Load stations from JSON
async function loadStationsData() {
  try {
    const res = await fetch(`stations_autoroute.json?v=${APP_VERSION}`);
    allStations = await res.json();
    if (DE_LIVE_PRICES.proxyUrl) {
      // Les aires allemandes réelles sont chargées à la demande depuis Tankerkönig
      allStations = allStations.filter(s => !(s.pays === 'DE' && String(s.id).startsWith('DE-BAB-')));
    }
    populateBrandFilter();
    const badge = document.getElementById('total-stations-badge');
    if (badge) badge.textContent = t().areasCount(allStations.length);
  } catch (err) {
    console.error('Erreur chargement stations:', err);
  }
}

let coveredCountriesLayer = null;

// Load covered countries boundary overlay (France, Germany, Italy, Spain & UK)
async function loadCoveredCountries() {
  try {
    const res = await fetch(`pays_couverts.json?v=${APP_VERSION}`);
    if (!res.ok) return;
    const geojsonData = await res.json();

    coveredCountriesLayer = L.geoJSON(geojsonData, {
      style: () => ({
        color: '#0284c7',        // Cyan-blue border
        weight: 2,               // Border width
        opacity: 0.85,
        fillColor: '#0ea5e9',    // Sky blue fill
        fillOpacity: 0.08,       // Subtle translucency
        dashArray: '6, 6'        // Dashed border for country limit
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindTooltip(
          () => `<div style="font-weight:800; font-size:0.88rem; color:#fff;">${p.flag} ${translateCountryName(p.name)}</div><div style="font-size:0.75rem; color:#38bdf8;">${t().areasListed(p.stationsCount)}</div>`,
          { sticky: true, className: 'country-coverage-tooltip' }
        );
        layer.on({
          mouseover: () => {
            layer.setStyle({
              fillOpacity: 0.18,
              weight: 3,
              color: '#38bdf8'
            });
          },
          mouseout: () => {
            if (coveredCountriesLayer) coveredCountriesLayer.resetStyle(layer);
          }
        });
      }
    }).addTo(map);

    coveredCountriesLayer.bringToBack();
    renderCountryBadgesOnMap();
  } catch (err) {
    console.warn('Erreur chargement pays couverts:', err);
  }
}

// Populate Brands Filter dropdown
// Dynamically adjusts: when route stations are computed, prioritizes brands of the traversed country/countries
function populateBrandFilter() {
  const brandSelect = document.getElementById('select-brand');
  if (!brandSelect) return;
  const currentVal = selectedBrand;

  // Determine station pool: if an itinerary has matched stations, use route stations
  // otherwise fallback to all network stations
  const pool = (currentRouteStations && currentRouteStations.length > 0)
    ? currentRouteStations
    : allStations;

  const counts = {};
  pool.forEach(s => {
    const b = s.enseigne || 'Indépendant';
    counts[b] = (counts[b] || 0) + 1;
  });

  const sortedBrands = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let html = `<option value="all">${t().allBrands} (${sortedBrands.length})</option>`;
  sortedBrands.forEach(b => {
    const isSel = (b === currentVal) ? ' selected' : '';
    html += `<option value="${b}"${isSel}>${b} (${counts[b]})</option>`;
  });
  brandSelect.innerHTML = html;

  if (currentVal !== 'all' && !counts[currentVal]) {
    selectedBrand = 'all';
    brandSelect.value = 'all';
  }
}

// Bilingual European Cities Index (instant support for English, French, Spanish & Italian names)
const BILINGUAL_CITIES_INDEX = [
  // United Kingdom & Ireland
  { names: ['London', 'Londres'], display: 'London (Londres)', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-0.1276, 51.5072] },
  { names: ['Folkestone'], display: 'Folkestone', country: 'Royaume-Uni', flag: '🇬🇧', coords: [1.1560, 51.0814] },
  { names: ['Dover', 'Douvres'], display: 'Dover (Douvres)', country: 'Royaume-Uni', flag: '🇬🇧', coords: [1.3134, 51.1279] },
  { names: ['Edinburgh', 'Edimbourg', 'Édimbourg'], display: 'Edinburgh (Édimbourg)', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-3.1883, 55.9533] },
  { names: ['Manchester'], display: 'Manchester', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-2.2426, 53.4808] },
  { names: ['Birmingham'], display: 'Birmingham', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.8904, 52.4862] },
  { names: ['Liverpool'], display: 'Liverpool', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-2.9916, 53.4084] },
  { names: ['Glasgow'], display: 'Glasgow', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-4.2518, 55.8642] },
  { names: ['Belfast'], display: 'Belfast', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-5.9301, 54.5973] },
  { names: ['Bristol'], display: 'Bristol', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-2.5879, 51.4545] },
  { names: ['Leeds'], display: 'Leeds', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.5491, 53.8008] },
  { names: ['Cardiff'], display: 'Cardiff', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-3.1791, 51.4816] },
  { names: ['Newcastle', 'Newcastle upon Tyne'], display: 'Newcastle upon Tyne', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.6178, 54.9783] },
  { names: ['Sheffield'], display: 'Sheffield', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.4701, 53.3811] },
  { names: ['Nottingham'], display: 'Nottingham', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.1581, 52.9548] },
  { names: ['Southampton'], display: 'Southampton', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.4044, 50.9097] },
  { names: ['Portsmouth'], display: 'Portsmouth', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.0880, 50.8198] },
  { names: ['Brighton'], display: 'Brighton', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-0.1372, 50.8225] },
  { names: ['Oxford'], display: 'Oxford', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.2577, 51.7520] },
  { names: ['Cambridge'], display: 'Cambridge', country: 'Royaume-Uni', flag: '🇬🇧', coords: [0.1218, 52.2053] },
  { names: ['Canterbury', 'Cantorbéry', 'Cantorbery'], display: 'Canterbury (Cantorbéry)', country: 'Royaume-Uni', flag: '🇬🇧', coords: [1.0789, 51.2802] },
  { names: ['Maidstone'], display: 'Maidstone', country: 'Royaume-Uni', flag: '🇬🇧', coords: [0.5217, 51.2704] },
  { names: ['Ashford'], display: 'Ashford', country: 'Royaume-Uni', flag: '🇬🇧', coords: [0.8738, 51.1465] },
  { names: ['Exeter'], display: 'Exeter', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-3.5339, 50.7184] },
  { names: ['Plymouth'], display: 'Plymouth', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-4.1427, 50.3755] },
  { names: ['York'], display: 'York', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.0873, 53.9599] },
  { names: ['Swansea'], display: 'Swansea', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-3.9436, 51.6214] },
  { names: ['Reading'], display: 'Reading', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-0.9781, 51.4543] },
  { names: ['Coventry'], display: 'Coventry', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.5197, 52.4068] },
  { names: ['Leicester'], display: 'Leicester', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-1.1398, 52.6369] },
  { names: ['Carlisle'], display: 'Carlisle', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-2.9329, 54.8925] },
  { names: ['Inverness'], display: 'Inverness', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-4.2247, 57.4778] },
  { names: ['Aberdeen'], display: 'Aberdeen', country: 'Royaume-Uni', flag: '🇬🇧', coords: [-2.0943, 57.1497] },
  { names: ['Dublin'], display: 'Dublin', country: 'Irlande', flag: '🇮🇪', coords: [-6.2603, 53.3498] },

  // Italy
  { names: ['Milano', 'Milan'], display: 'Milano (Milan)', country: 'Italie', flag: '🇮🇹', coords: [9.1900, 45.4642] },
  { names: ['Roma', 'Rome'], display: 'Roma (Rome)', country: 'Italie', flag: '🇮🇹', coords: [12.4964, 41.9028] },
  { names: ['Torino', 'Turin'], display: 'Torino (Turin)', country: 'Italie', flag: '🇮🇹', coords: [7.6869, 45.0703] },
  { names: ['Venezia', 'Venise', 'Venice'], display: 'Venezia (Venise)', country: 'Italie', flag: '🇮🇹', coords: [12.3155, 45.4408] },
  { names: ['Firenze', 'Florence'], display: 'Firenze (Florence)', country: 'Italie', flag: '🇮🇹', coords: [11.2558, 43.7696] },
  { names: ['Napoli', 'Naples'], display: 'Napoli (Naples)', country: 'Italie', flag: '🇮🇹', coords: [14.2681, 40.8518] },
  { names: ['Genova', 'Gênes', 'Genes', 'Genoa'], display: 'Genova (Gênes)', country: 'Italie', flag: '🇮🇹', coords: [8.9463, 44.4056] },
  { names: ['Bologna', 'Bologne'], display: 'Bologna (Bologne)', country: 'Italie', flag: '🇮🇹', coords: [11.3426, 44.4949] },
  { names: ['Verona', 'Vérone', 'Verone'], display: 'Verona (Vérone)', country: 'Italie', flag: '🇮🇹', coords: [10.9916, 45.4384] },
  { names: ['Bari'], display: 'Bari', country: 'Italie', flag: '🇮🇹', coords: [16.8719, 41.1171] },
  { names: ['Palermo', 'Palerme'], display: 'Palermo (Palerme)', country: 'Italie', flag: '🇮🇹', coords: [13.3615, 38.1157] },

  // Spain
  { names: ['Barcelona', 'Barcelone'], display: 'Barcelona (Barcelone)', country: 'Espagne', flag: '🇪🇸', coords: [2.1734, 41.3851] },
  { names: ['Madrid'], display: 'Madrid', country: 'Espagne', flag: '🇪🇸', coords: [-3.7038, 40.4168] },
  { names: ['Valencia', 'Valence'], display: 'Valencia (Valence)', country: 'Espagne', flag: '🇪🇸', coords: [-0.3763, 39.4699] },
  { names: ['Sevilla', 'Séville', 'Seville'], display: 'Sevilla (Séville)', country: 'Espagne', flag: '🇪🇸', coords: [-5.9845, 37.3891] },
  { names: ['Zaragoza', 'Saragosse', 'Saragossa'], display: 'Zaragoza (Saragosse)', country: 'Espagne', flag: '🇪🇸', coords: [-0.8891, 41.6488] },
  { names: ['Málaga', 'Malaga'], display: 'Málaga', country: 'Espagne', flag: '🇪🇸', coords: [-4.4214, 36.7213] },
  { names: ['Bilbao'], display: 'Bilbao', country: 'Espagne', flag: '🇪🇸', coords: [-2.9350, 43.2630] },
  { names: ['San Sebastián', 'Donostia', 'Saint-Sébastien', 'San Sebastian'], display: 'San Sebastián (Saint-Sébastien)', country: 'Espagne', flag: '🇪🇸', coords: [-1.9812, 43.3183] },
  { names: ['Girona', 'Gérone', 'Gerone'], display: 'Girona (Gérone)', country: 'Espagne', flag: '🇪🇸', coords: [2.8214, 41.9794] },
  { names: ['Alicante'], display: 'Alicante', country: 'Espagne', flag: '🇪🇸', coords: [-0.4810, 38.3452] },

  // France & Neighbors
  { names: ['Paris'], display: 'Paris', country: 'France', flag: '🇫🇷', coords: [2.3522, 48.8566] },
  { names: ['Lyon', 'Lyons'], display: 'Lyon', country: 'France', flag: '🇫🇷', coords: [4.8357, 45.7640] },
  { names: ['Marseille', 'Marseilles'], display: 'Marseille', country: 'France', flag: '🇫🇷', coords: [5.3698, 43.2965] },
  { names: ['Lille'], display: 'Lille', country: 'France', flag: '🇫🇷', coords: [3.0573, 50.6292] },
  { names: ['Calais'], display: 'Calais', country: 'France', flag: '🇫🇷', coords: [1.8587, 50.9513] },
  { names: ['Dunkerque', 'Dunkirk'], display: 'Dunkerque (Dunkirk)', country: 'France', flag: '🇫🇷', coords: [2.3768, 51.0344] },
  { names: ['Bordeaux'], display: 'Bordeaux', country: 'France', flag: '🇫🇷', coords: [-0.5792, 44.8378] },
  { names: ['Toulouse'], display: 'Toulouse', country: 'France', flag: '🇫🇷', coords: [1.4442, 43.6047] },
  { names: ['Nice'], display: 'Nice', country: 'France', flag: '🇫🇷', coords: [7.2620, 43.7102] },
  { names: ['Nantes'], display: 'Nantes', country: 'France', flag: '🇫🇷', coords: [-1.5536, 47.2184] },
  { names: ['Strasbourg'], display: 'Strasbourg', country: 'France', flag: '🇫🇷', coords: [7.7521, 48.5734] },
  { names: ['Bruxelles', 'Brussels', 'Brussel', 'Brüssel', 'Bruselas'], display: 'Bruxelles (Brussels)', country: 'Belgique', flag: '🇧🇪', coords: [4.3517, 50.8503] },
  { names: ['Anvers', 'Antwerpen', 'Antwerp', 'Anversa', 'Amberes'], display: 'Antwerpen (Anvers)', country: 'Belgique', flag: '🇧🇪', coords: [4.4025, 51.2194] },
  { names: ['Gand', 'Gent', 'Ghent', 'Gante'], display: 'Gent (Gand)', country: 'Belgique', flag: '🇧🇪', coords: [3.7174, 51.0543] },
  { names: ['Liège', 'Liege', 'Luik', 'Lüttich', 'Lieja'], display: 'Liège', country: 'Belgique', flag: '🇧🇪', coords: [5.5797, 50.6326] },
  { names: ['Charleroi'], display: 'Charleroi', country: 'Belgique', flag: '🇧🇪', coords: [4.4446, 50.4108] },
  { names: ['Namur', 'Namen'], display: 'Namur', country: 'Belgique', flag: '🇧🇪', coords: [4.8719, 50.4674] },
  { names: ['Mons', 'Bergen'], display: 'Mons', country: 'Belgique', flag: '🇧🇪', coords: [3.9523, 50.4542] },
  { names: ['Bruges', 'Brugge'], display: 'Brugge (Bruges)', country: 'Belgique', flag: '🇧🇪', coords: [3.2247, 51.2093] },
  { names: ['Louvain', 'Leuven', 'Löwen'], display: 'Leuven (Louvain)', country: 'Belgique', flag: '🇧🇪', coords: [4.7005, 50.8798] },
  { names: ['Tournai', 'Doornik'], display: 'Tournai', country: 'Belgique', flag: '🇧🇪', coords: [3.3878, 50.6058] },
  { names: ['Arlon', 'Aarlen'], display: 'Arlon', country: 'Belgique', flag: '🇧🇪', coords: [5.8167, 49.6833] },
  { names: ['Ostende', 'Oostende', 'Ostend'], display: 'Oostende (Ostende)', country: 'Belgique', flag: '🇧🇪', coords: [2.9195, 51.2254] },
  { names: ['Genève', 'Geneve', 'Geneva'], display: 'Genève (Geneva)', country: 'Suisse', flag: '🇨🇭', coords: [6.1432, 46.2044] },

  // Germany
  { names: ['Berlin'], display: 'Berlin', country: 'Allemagne', flag: '🇩🇪', coords: [13.4050, 52.5200] },
  { names: ['München', 'Munchen', 'Munich', 'Monaco di Baviera', 'Múnich'], display: 'München (Munich)', country: 'Allemagne', flag: '🇩🇪', coords: [11.5820, 48.1351] },
  { names: ['Frankfurt', 'Frankfurt am Main', 'Francfort', 'Francoforte'], display: 'Frankfurt am Main (Francfort)', country: 'Allemagne', flag: '🇩🇪', coords: [8.6821, 50.1109] },
  { names: ['Köln', 'Koln', 'Cologne', 'Colonia'], display: 'Köln (Cologne)', country: 'Allemagne', flag: '🇩🇪', coords: [6.9603, 50.9375] },
  { names: ['Hamburg', 'Hambourg', 'Amburgo', 'Hamburgo'], display: 'Hamburg (Hambourg)', country: 'Allemagne', flag: '🇩🇪', coords: [9.9937, 53.5511] },
  { names: ['Stuttgart', 'Stoccarda'], display: 'Stuttgart', country: 'Allemagne', flag: '🇩🇪', coords: [9.1829, 48.7758] },
  { names: ['Düsseldorf', 'Dusseldorf'], display: 'Düsseldorf', country: 'Allemagne', flag: '🇩🇪', coords: [6.7735, 51.2277] },
  { names: ['Dortmund'], display: 'Dortmund', country: 'Allemagne', flag: '🇩🇪', coords: [7.4653, 51.5136] },
  { names: ['Leipzig', 'Lipsia'], display: 'Leipzig', country: 'Allemagne', flag: '🇩🇪', coords: [12.3731, 51.3397] },
  { names: ['Dresden', 'Dresde', 'Dresda'], display: 'Dresden (Dresde)', country: 'Allemagne', flag: '🇩🇪', coords: [13.7373, 51.0504] },
  { names: ['Hannover', 'Hanovre', 'Hanover'], display: 'Hannover (Hanovre)', country: 'Allemagne', flag: '🇩🇪', coords: [9.7320, 52.3759] },
  { names: ['Nürnberg', 'Nurnberg', 'Nuremberg', 'Norimberga'], display: 'Nürnberg (Nuremberg)', country: 'Allemagne', flag: '🇩🇪', coords: [11.0767, 49.4521] },
  { names: ['Bremen', 'Brême', 'Breme', 'Brema'], display: 'Bremen (Brême)', country: 'Allemagne', flag: '🇩🇪', coords: [8.8017, 53.0793] },
  { names: ['Mannheim'], display: 'Mannheim', country: 'Allemagne', flag: '🇩🇪', coords: [8.4660, 49.4875] },
  { names: ['Karlsruhe'], display: 'Karlsruhe', country: 'Allemagne', flag: '🇩🇪', coords: [8.4037, 49.0069] },
  { names: ['Freiburg', 'Freiburg im Breisgau', 'Fribourg', 'Fribourg-en-Brisgau', 'Friburgo'], display: 'Freiburg im Breisgau (Fribourg)', country: 'Allemagne', flag: '🇩🇪', coords: [7.8421, 47.9990] },
  { names: ['Aachen', 'Aix-la-Chapelle', 'Aquisgrana'], display: 'Aachen (Aix-la-Chapelle)', country: 'Allemagne', flag: '🇩🇪', coords: [6.0839, 50.7753] },
  { names: ['Saarbrücken', 'Saarbrucken', 'Sarrebruck'], display: 'Saarbrücken (Sarrebruck)', country: 'Allemagne', flag: '🇩🇪', coords: [6.9969, 49.2402] },
  { names: ['Ulm'], display: 'Ulm', country: 'Allemagne', flag: '🇩🇪', coords: [9.9876, 48.4011] },
  { names: ['Augsburg', 'Augsbourg', 'Augusta'], display: 'Augsburg (Augsbourg)', country: 'Allemagne', flag: '🇩🇪', coords: [10.8978, 48.3705] }
];

async function searchLocationsBilingual(q) {
  const qNorm = q.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const results = [];

  const fetchWithTimeout = (url, opts = {}, ms = 2200) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal })
      .then(r => r.json())
      .finally(() => clearTimeout(timer));
  };

  // 1. Instant Bilingual Major Cities Match (English + French + Native names)
  // Only match when the user is typing a city name (not a full street address like "Joubert Street London")
  BILINGUAL_CITIES_INDEX.forEach(city => {
    const matched = city.names.some(n => {
      const nNorm = n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return nNorm.startsWith(qNorm) || qNorm === nNorm;
    });
    if (matched) {
      results.push({
        label: `${city.flag} ${city.display}, ${translateCountryName(city.country)}`,
        cleanName: city.display,
        coords: city.coords,
        priority: 100
      });
    }
  });

  // 2. Query European Photon (bounded to Western Europe), Nominatim OSM (fast street/postcode/POI search), & French BAN in parallel
  // Normalize common US/UK/FR POI synonyms (e.g., "Technical Center" -> "Technology Centre", "Center" -> "Centre")
  const qNormalizedVariant = q
    .replace(/\btechnical\s+cent(er|re)\b/gi, 'Technology Centre')
    .replace(/\btech\s+cent(er|re)\b/gi, 'Technology Centre')
    .replace(/\bcenter\b/gi, 'Centre');

  const euroBbox = '-11.0,35.0,19.5,61.0';
  const queriesToRun = [
    fetchWithTimeout(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`, {}, 1800),
    fetchWithTimeout(`https://photon.komoot.io/api/?q=${encodeURIComponent(qNormalizedVariant)}&bbox=${euroBbox}&limit=7`, {}, 2200),
    fetchWithTimeout(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&viewbox=-11.0,61.0,19.5,35.0&bounded=1&q=${encodeURIComponent(qNormalizedVariant)}`, { headers: { 'Accept-Language': `${currentLang},en` } }, 2200)
  ];
  const [banRes, photonDefaultRes, nominatimRes] = await Promise.allSettled(queriesToRun);

  const getCountryFlag = (cc, countryStr) => {
    const code = (cc || '').toUpperCase();
    const cLow = (countryStr || '').toLowerCase();
    if (code === 'GB' || code === 'UK' || cLow.includes('royaume-uni') || cLow.includes('united kingdom') || cLow.includes('great britain') || cLow.includes('england') || cLow.includes('scotland') || cLow.includes('wales')) return '🇬🇧';
    if (code === 'ES' || cLow.includes('esp') || cLow.includes('spain')) return '🇪🇸';
    if (code === 'IT' || cLow.includes('ital')) return '🇮🇹';
    if (code === 'FR' || cLow.includes('fran')) return '🇫🇷';
    if (code === 'IE' || cLow.includes('ireland') || cLow.includes('irlande')) return '🇮🇪';
    if (code === 'DE' || cLow.includes('allem') || cLow.includes('germ')) return '🇩🇪';
    if (code === 'BE' || cLow.includes('belg')) return '🇧🇪';
    if (code === 'CH' || cLow.includes('suis') || cLow.includes('switz')) return '🇨🇭';
    if (code === 'LU' || cLow.includes('lux')) return '🇱🇺';
    return '🌍';
  };

  const addResultIfUnique = (item) => {
    const itemNameNorm = (item.cleanName || '').toLowerCase();
    const isDup = results.some(r => {
      const sameCoords = Math.abs(r.coords[0] - item.coords[0]) < 0.003 && Math.abs(r.coords[1] - item.coords[1]) < 0.003;
      const sameCityCoords = Math.abs(r.coords[0] - item.coords[0]) < 0.04 && Math.abs(r.coords[1] - item.coords[1]) < 0.04 && (r.cleanName || '').toLowerCase() === itemNameNorm;
      return sameCoords || sameCityCoords;
    });
    if (!isDup) {
      results.push(item);
    }
  };

  const getPoiIcon = (cat, type) => {
    const c = (cat || '').toLowerCase();
    const t = (type || '').toLowerCase();
    if (c === 'aeroway' || t.includes('aerodrome') || t.includes('airport')) return '✈️ ';
    if (c === 'railway' || t === 'station' || t === 'halt') return '🚉 ';
    if (t === 'ferry_terminal') return '⛴️ ';
    if (t === 'theme_park' || t === 'zoo' || t === 'aquarium') return '🎢 ';
    if (t === 'stadium' || t === 'sports_centre' || c === 'leisure') return '🏟️ ';
    if (c === 'tourism' || c === 'historic' || t === 'monument' || t === 'castle' || t === 'museum' || t === 'attraction' || t === 'viewpoint' || t === 'tower' || t === 'amphitheatre' || t === 'palace' || t === 'place_of_worship') return '🏛️ ';
    return '';
  };

  const parsePhotonFeatures = (features) => {
    if (!features) return;
    features.forEach(f => {
      const p = f.properties || {};
      if (!p.name) return;
      const country = p.country || '';
      const flag = getCountryFlag(p.countrycode, country);
      const isCity = ['city', 'town', 'village', 'municipality', 'administrative'].includes(p.osm_value || p.type);
      const isStreetOrHouse = ['street', 'house', 'residential', 'secondary', 'primary', 'tertiary', 'living_street', 'pedestrian', 'postcode'].includes(p.osm_value || p.type);
      const poiIcon = (!isCity && !isStreetOrHouse) ? getPoiIcon(p.osm_key, p.osm_value || p.type) : '';
      const isLandmark = Boolean(poiIcon);
      const isCoveredCountry = ['🇬🇧', '🇫🇷', '🇪🇸', '🇮🇹', '🇮🇪', '🇧🇪', '🇨🇭'].includes(flag);

      // Build rich city/district/postcode context for street-level & landmark searches
      const rawCity = p.city || p.town || p.village || p.county || '';
      const shortCity = rawCity.replace(/^London Borough of\s+/i, 'London — ').replace(/^Royal Borough of\s+/i, 'London — ');
      const streetLabel = p.housenumber ? `${p.housenumber} ${p.name}` : p.name;

      let nameParts;
      let cleanName;
      if (isStreetOrHouse) {
        nameParts = [streetLabel, p.district, shortCity, p.postcode, country].filter(Boolean);
        cleanName = [streetLabel, shortCity || p.state, p.postcode].filter(Boolean).join(', ');
      } else if (isLandmark) {
        nameParts = [p.name, shortCity && shortCity !== p.name ? shortCity : p.district, country].filter(Boolean);
        cleanName = [p.name, shortCity && shortCity !== p.name ? shortCity : null].filter(Boolean).join(', ');
      } else {
        nameParts = [p.name, shortCity && shortCity !== p.name ? shortCity : null, p.state, country].filter(Boolean);
        cleanName = p.name;
      }

      // Deduplicate consecutive identical parts
      const uniqueParts = nameParts.filter((part, idx) => idx === 0 || part.toLowerCase() !== nameParts[idx - 1].toLowerCase());
      const label = `${flag} ${poiIcon}${uniqueParts.join(', ')}`;
      const coords = f.geometry.coordinates;

      // Boost priority when the result matches both street/landmark name and city in the query
      const fullTextNorm = uniqueParts.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const queryTokens = qNorm.split(/\s+/).filter(t => t.length >= 2);
      const allTokensMatched = queryTokens.length > 0 && queryTokens.every(tok => fullTextNorm.includes(tok) || (tok === 'londres' && fullTextNorm.includes('london')));

      const priority = (isCity ? 60 : (isLandmark ? 62 : (isStreetOrHouse ? 55 : 35))) + (isCoveredCountry ? 20 : 0) + (allTokensMatched ? 30 : 0);

      addResultIfUnique({
        label,
        cleanName,
        coords,
        priority
      });
    });
  };

  if (photonDefaultRes.status === 'fulfilled' && photonDefaultRes.value) {
    parsePhotonFeatures(photonDefaultRes.value.features);
  }

  // Parse Nominatim OpenStreetMap results (handles exact UK/ES/IT/FR streets, postcodes, house numbers & famous landmarks/POIs)
  if (nominatimRes.status === 'fulfilled' && Array.isArray(nominatimRes.value)) {
    nominatimRes.value.forEach(n => {
      const addr = n.address || {};
      const flag = getCountryFlag(addr.country_code, addr.country);
      const isCoveredCountry = ['🇬🇧', '🇫🇷', '🇪🇸', '🇮🇹', '🇮🇪', '🇧🇪', '🇨🇭'].includes(flag);
      const coords = [ parseFloat(n.lon), parseFloat(n.lat) ];
      if (isNaN(coords[0]) || isNaN(coords[1])) return;

      const poiIcon = getPoiIcon(n.category, n.type);
      const isLandmark = Boolean(poiIcon) || (n.name && ['tourism', 'aeroway', 'railway', 'historic', 'amenity', 'leisure', 'man_made', 'building'].includes(n.category));
      const road = addr.road || addr.pedestrian || addr.suburb || '';
      const house = addr.house_number ? `${addr.house_number} ` : '';
      const rawCity = addr.city || addr.town || addr.village || addr.municipality || addr.city_district || addr.county || '';
      const shortCity = rawCity.replace(/^London Borough of\s+/i, 'London — ').replace(/^Greater London$/i, 'London');
      const suburb = (addr.suburb || addr.city_district || '').replace(/^London Borough of\s+/i, '');
      const postcode = addr.postcode || '';

      // If it's a landmark/POI (e.g. "Tour Eiffel", "Heathrow Airport", "Sagrada Família"), use n.name as primary label instead of the adjacent street
      const primary = (isLandmark && n.name) ? n.name : ((house + road).trim() || n.name || shortCity || (n.display_name || '').split(',')[0]);
      const parts = [primary, suburb && suburb !== primary ? suburb : null, shortCity && shortCity !== primary ? shortCity : null, isLandmark ? null : postcode, addr.country].filter(Boolean);
      const uniqueParts = parts.filter((part, idx) => idx === 0 || part.toLowerCase() !== parts[idx - 1].toLowerCase());
      const label = `${flag} ${poiIcon}${uniqueParts.join(', ')}`;
      const cleanName = isLandmark
        ? [primary, shortCity && shortCity !== primary ? shortCity : null].filter(Boolean).join(', ')
        : [primary, shortCity && shortCity !== primary ? shortCity : null, postcode].filter(Boolean).join(', ');

      const fullTextNorm = uniqueParts.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const queryTokens = qNorm.split(/\s+/).filter(t => t.length >= 2);
      const allTokensMatched = queryTokens.length > 0 && queryTokens.every(tok => fullTextNorm.includes(tok) || (tok === 'londres' && fullTextNorm.includes('london')));

      const priority = (isLandmark ? 65 : 58) + (isCoveredCountry ? 20 : 0) + (allTokensMatched ? 30 : 0);
      addResultIfUnique({
        label,
        cleanName,
        coords,
        priority
      });
    });
  }

  if (banRes.status === 'fulfilled' && banRes.value && banRes.value.features) {
    banRes.value.features.forEach(f => {
      const p = f.properties || {};
      const coords = f.geometry.coordinates;
      const isMunicipality = p.type === 'municipality';
      const labelNorm = (p.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const queryTokens = qNorm.split(/\s+/).filter(t => t.length >= 2);
      const allTokensMatched = queryTokens.length > 0 && queryTokens.every(tok => labelNorm.includes(tok));
      const priority = (isMunicipality ? 85 : 35) + (allTokensMatched ? 25 : -20);

      addResultIfUnique({
        label: '🇫🇷 ' + p.label,
        cleanName: p.label,
        coords,
        priority
      });
    });
  }

  // 3. Fallback: if a multi-word query (e.g. "McLaren Technical Center") returned no result matching the primary distinctive word ("mclaren"),
  // query the primary distinctive word directly so approximate POI names still work like Google Maps / Waze
  const primaryTokens = qNorm.split(/\s+/).filter(t => t.length >= 3 && !['rue', 'street', 'road', 'avenue', 'boulevard', 'place', 'saint', 'sainte', 'the', 'les', 'des'].includes(t));
  const firstDistinctive = primaryTokens[0];
  const hasPrimaryMatch = firstDistinctive && results.some(r =>
    (r.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(firstDistinctive)
  );
  if (firstDistinctive && primaryTokens.length >= 2 && !hasPrimaryMatch) {
    try {
      const fallbackData = await fetchWithTimeout(`https://photon.komoot.io/api/?q=${encodeURIComponent(firstDistinctive)}&bbox=${euroBbox}&limit=5`, {}, 1800);
      if (fallbackData && fallbackData.features) {
        parsePhotonFeatures(fallbackData.features);
      }
    } catch (e) {}
  }

  // Boost results that contain the first distinctive word of the user's query
  if (firstDistinctive) {
    results.forEach(r => {
      const rNorm = (r.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (rNorm.includes(firstDistinctive)) {
        r.priority += 35;
      }
    });
  }

  results.sort((a, b) => b.priority - a.priority);
  return results;
}

// ============================================================================
// Memory of the 10 most recent departure / arrival localities (localStorage)
// ============================================================================
const RECENT_LOCATIONS_KEY = 'fuelpilot_recent_locations_v1';

function getRecentLocations() {
  try {
    const raw = localStorage.getItem(RECENT_LOCATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch (e) {
    return [];
  }
}

function saveRecentLocation(cleanName, coords, fullLabel) {
  if (!cleanName || !Array.isArray(coords) || coords.length < 2) return;
  try {
    const list = getRecentLocations();
    const normName = cleanName.trim().toLowerCase();
    const filtered = list.filter(item => {
      const sameName = (item.cleanName || '').trim().toLowerCase() === normName;
      const sameCoords = item.coords &&
        Math.abs(item.coords[0] - coords[0]) < 0.03 &&
        Math.abs(item.coords[1] - coords[1]) < 0.03;
      return !sameName && !sameCoords;
    });
    filtered.unshift({
      cleanName: cleanName.trim(),
      label: fullLabel || cleanName.trim(),
      coords: [Number(coords[0]), Number(coords[1])]
    });
    localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(filtered.slice(0, 10)));
  } catch (e) {}
}

// Address Autocomplete: Bilingual UK/FR/ES/IT Cities + Photon + French BAN + 10 Recent Localities
function setupAutocomplete(inputId, dropdownId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  let debounceTimer;

  function renderDropdownItems(items, isRecentHeader = false) {
    if (!items || items.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = '';
    if (isRecentHeader) {
      const hdr = document.createElement('div');
      hdr.className = 'autocomplete-recent-header';
      hdr.textContent = t().recentHdr;
      dropdown.appendChild(hdr);
    }
    const maxItems = 10;
    items.slice(0, maxItems).forEach(itemData => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = isRecentHeader ? `🕒 ${itemData.label || itemData.cleanName}` : itemData.label;
      item.addEventListener('click', () => {
        const formattedName = itemData.cleanName;
        input.value = formattedName;
        dropdown.style.display = 'none';
        saveRecentLocation(formattedName, itemData.coords, itemData.label);
        onSelect(itemData.coords, formattedName);
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  }

  function showRecentIfAvailable() {
    const recents = getRecentLocations();
    if (recents.length > 0) {
      renderDropdownItems(recents, true);
    }
  }

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) {
      showRecentIfAvailable();
    } else {
      showRecentIfAvailable();
    }
  });

  input.addEventListener('click', () => {
    if (dropdown.style.display === 'none' || !dropdown.style.display) {
      showRecentIfAvailable();
    }
  });

  let searchSeq = 0;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      showRecentIfAvailable();
      return;
    }

    const currentSeq = ++searchSeq;
    debounceTimer = setTimeout(async () => {
      try {
        const results = await searchLocationsBilingual(q);
        // Ignore stale responses if the user kept typing
        if (currentSeq !== searchSeq) return;

        // Prepend matching recent locations at the very top
        const qLow = q.toLowerCase();
        const matchingRecents = getRecentLocations()
          .filter(r => (r.cleanName || '').toLowerCase().includes(qLow) || (r.label || '').toLowerCase().includes(qLow))
          .map(r => ({
            label: `🕒 ${r.label || r.cleanName}`,
            cleanName: r.cleanName,
            coords: r.coords,
            priority: 200
          }));

        const combined = [...matchingRecents];
        results.forEach(res => {
          const isDup = combined.some(c =>
            Math.abs(c.coords[0] - res.coords[0]) < 0.003 && Math.abs(c.coords[1] - res.coords[1]) < 0.003 &&
            (c.cleanName || '').toLowerCase() === (res.cleanName || '').toLowerCase()
          );
          if (!isDup) combined.push(res);
        });

        if (combined.length > 0) {
          renderDropdownItems(combined, false);
        } else {
          dropdown.style.display = 'none';
        }
      } catch (e) {
        console.error(e);
      }
    }, 180);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// Event Listeners for Filters and Controls
function setupEventListeners() {
  // Mobile tab buttons (floating bar)
  const urlParams = new URLSearchParams(window.location.search);
  const initialView = urlParams.get('view') === 'map' ? 'map' : 'list';
  setMobileView(initialView);
  const btnMap = document.getElementById('btn-tab-map');
  const btnList = document.getElementById('btn-tab-list');
  if (btnMap) btnMap.addEventListener('click', () => setMobileView('map'));
  if (btnList) btnList.addEventListener('click', () => setMobileView('list'));

  // Itinerary Collapse / Edit Button
  const btnToggleRoute = document.getElementById('btn-toggle-route-edit');
  if (btnToggleRoute) {
    btnToggleRoute.addEventListener('click', () => {
      const isCollapsed = document.body.classList.contains('mobile-route-collapsed');
      if (isCollapsed) {
        document.body.classList.remove('mobile-route-collapsed');
        btnToggleRoute.innerHTML = t().closeBtn;
      } else {
        document.body.classList.add('mobile-route-collapsed');
        btnToggleRoute.innerHTML = t().editBtn;
      }
    });
  }

  // Fuel selector dropdown
  const fuelSelect = document.getElementById('select-fuel');
  if (fuelSelect) {
    fuelSelect.value = selectedFuel;
    fuelSelect.addEventListener('change', (e) => {
      selectedFuel = e.target.value;
      fuelSelect.classList.remove('input-attention-pulse');
      renderCurrentRouteStations();
    });
  }

  // Fuel pills fallback
  document.querySelectorAll('.fuel-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.fuel-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedFuel = pill.dataset.fuel;
      if (fuelSelect) {
        fuelSelect.value = selectedFuel;
        fuelSelect.classList.remove('input-attention-pulse');
      }
      renderCurrentRouteStations();
    });
  });

  // Brand dropdown
  document.getElementById('select-brand').addEventListener('change', (e) => {
    selectedBrand = e.target.value;
    renderCurrentRouteStations();
  });

  // Sort dropdown
  document.getElementById('select-sort').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderCurrentRouteStations();
  });

  // Calculate button
  document.getElementById('btn-calculate').addEventListener('click', () => {
    const fuelSel = document.getElementById('select-fuel');
    if (fuelSel) fuelSel.classList.remove('input-attention-pulse');
    calculateItinerary();
  });

  // Add waypoint button
  document.getElementById('btn-add-waypoint').addEventListener('click', () => {
    addWaypointInput();
  });

  // Preset chips
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.dataset.preset;
      if (p === 'paris-lyon') applyPreset('Paris', [2.3522, 48.8566], 'Lyon', [4.8357, 45.7640]);
      if (p === 'paris-bordeaux') applyPreset('Paris', [2.3522, 48.8566], 'Bordeaux', [-0.5792, 44.8378]);
      if (p === 'marseille-nice') applyPreset('Marseille', [5.3698, 43.2965], 'Nice', [7.2620, 43.7102]);
      if (p === 'lille-paris') applyPreset('Lille', [3.0573, 50.6292], 'Paris', [2.3522, 48.8566]);
      if (p === 'lyon-marseille') applyPreset('Lyon', [4.8357, 45.7640], 'Marseille', [5.3698, 43.2965]);
    });
  });
}

// Helper to set preset route
function applyPreset(startLabel, startCoords, endLabel, endCoords) {
  const formattedStart = formatProperName(startLabel);
  const formattedEnd = formatProperName(endLabel);
  const inStart = document.getElementById('input-depart') || document.getElementById('input-start');
  if (inStart) {
    inStart.value = formattedStart;
    inStart.classList.remove('input-attention-pulse');
  }
  startPoint = { coords: startCoords, label: formattedStart };

  const inEnd = document.getElementById('input-arrivee') || document.getElementById('input-end');
  if (inEnd) {
    inEnd.value = formattedEnd;
    inEnd.classList.remove('input-attention-pulse');
  }
  endPoint = { coords: endCoords, label: formattedEnd };

  const fuelSel = document.getElementById('select-fuel');
  if (fuelSel) fuelSel.classList.remove('input-attention-pulse');

  currentWaypoints = [];
  const wpContainer = document.getElementById('waypoints-container');
  if (wpContainer) wpContainer.innerHTML = '';

  calculateItinerary();
}

// Add a waypoint input dynamically
function addWaypointInput() {
  const container = document.getElementById('waypoints-container');
  const index = currentWaypoints.length;
  const wpId = `wp-${Date.now()}`;

  const row = document.createElement('div');
  row.className = 'waypoint-item';
  row.id = `row-${wpId}`;
  row.innerHTML = `
    <div class="input-group" style="flex:1; margin-bottom:0;">
      <span class="input-icon">📍</span>
      <input type="text" class="address-input" id="input-${wpId}" placeholder="${t().stepPlaceholder(index + 1)}" />
      <div class="autocomplete-dropdown" id="dropdown-${wpId}"></div>
    </div>
    <button class="btn-remove-step" title="${t().removeStepTitle}">✕</button>
  `;

  container.appendChild(row);

  const wpObj = { id: wpId, coords: null, label: '' };
  currentWaypoints.push(wpObj);

  setupAutocomplete(`input-${wpId}`, `dropdown-${wpId}`, (coords, label) => {
    wpObj.coords = coords;
    wpObj.label = label;
  });

  row.querySelector('.btn-remove-step').addEventListener('click', () => {
    row.remove();
    currentWaypoints = currentWaypoints.filter(w => w.id !== wpId);
  });
}

// Calculate Itinerary with OSRM (supports alternatives)
async function calculateItinerary() {
  const startInput = document.getElementById('input-start');
  const endInput = document.getElementById('input-end');

  // Auto-resolve typed text (e.g. "London", "Folkestone") if user didn't click the dropdown
  if (startInput && startInput.value.trim().length >= 2) {
    const typedStart = startInput.value.trim();
    if (!startPoint || startPoint.label.toLowerCase() !== typedStart.toLowerCase()) {
      const matches = await searchLocationsBilingual(typedStart);
      if (matches.length > 0) {
        startPoint = { coords: matches[0].coords, label: matches[0].cleanName };
        startInput.value = matches[0].cleanName;
      }
    }
  }
  if (endInput && endInput.value.trim().length >= 2) {
    const typedEnd = endInput.value.trim();
    if (!endPoint || endPoint.label.toLowerCase() !== typedEnd.toLowerCase()) {
      const matches = await searchLocationsBilingual(typedEnd);
      if (matches.length > 0) {
        endPoint = { coords: matches[0].coords, label: matches[0].cleanName };
        endInput.value = matches[0].cleanName;
      }
    }
  }

  if (!startPoint || !endPoint) {
    alert(t().alertMissingPoints);
    return;
  }

  // Save both departure and arrival in the 10 recent localities memory
  saveRecentLocation(startPoint.label, startPoint.coords, startPoint.label);
  saveRecentLocation(endPoint.label, endPoint.coords, endPoint.label);

  const btn = document.getElementById('btn-calculate');
  btn.innerHTML = `<span class="pulse-dot" style="background:#fff"></span> ${t().calcInProgress}`;
  btn.disabled = true;

  try {
    // Construct coordinate list: start ; [waypoints] ; end
    const points = [startPoint.coords];
    currentWaypoints.forEach(w => {
      if (w.coords) points.push(w.coords);
    });
    points.push(endPoint.coords);

    const coordsStr = points.map(p => `${p[0]},${p[1]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&alternatives=3&steps=true`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      alert(t().alertNoRoute);
      return;
    }

    alternativeRoutes = data.routes;
    selectRoute(0);
    renderRouteAlternatives();

    // Afficher le bon plan Télépéage Ulys
    const ulysCard = document.getElementById('partner-ulys-card');
    // Ulys n'est utile que sur les péages de France, Espagne et Italie
    const ulysCountries = [...new Set((currentRouteStations || []).map(s => s.pays || 'FR'))];
    const ulysRelevant = ulysCountries.some(c => ['FR', 'ES', 'IT'].includes(c));
    if (ulysCard) ulysCard.style.display = 'none';
    if (ulysCard && AFFILIATE_CONFIG.ulys.enabled && ulysRelevant) {
      ulysCard.style.display = 'block';
      const ulysLink = document.getElementById('link-partner-ulys');
      if (ulysLink) ulysLink.href = AFFILIATE_CONFIG.ulys.url;
    }

    // Afficher l'encart Amazon Équipement Route
    const amazonCard = document.getElementById('partner-amazon-card');
    if (amazonCard && AFFILIATE_CONFIG.amazon.enabled) {
      amazonCard.style.display = 'block';
    }

    // Update and auto-collapse itinerary summary on mobile
    const startLbl = document.getElementById('sum-start-label');
    const endLbl = document.getElementById('sum-end-label');
    const metaLbl = document.getElementById('sum-route-meta');
    if (startLbl && startPoint) startLbl.textContent = formatProperName(startPoint.label.split(',')[0].trim());
    if (endLbl && endPoint) endLbl.textContent = formatProperName(endPoint.label.split(',')[0].trim());
    if (metaLbl && data.routes[0]) {
      const dist = (data.routes[0].distance / 1000).toFixed(0);
      metaLbl.textContent = `• ${dist} km`;
    }
    if (window.innerWidth <= 1080) {
      document.body.classList.add('mobile-route-collapsed');
      const btnToggle = document.getElementById('btn-toggle-route-edit');
      if (btnToggle) btnToggle.innerHTML = t().editBtn;
      // Switch to map view to display full route overview and stations
      setMobileView('map');
    }
  } catch (err) {
    console.error("Erreur calcul d'itinéraire:", err);
    alert(t().alertServerError);
  } finally {
    btn.innerHTML = t().calcBtn;
    btn.disabled = false;
  }
}

// Extract human-readable summary of highways and regions from OSRM steps
function getSmartRouteSummary(route) {
  const highways = [];
  const seen = new Set();
  const legs = route.legs || [];

  legs.forEach(leg => {
    (leg.steps || []).forEach(step => {
      const ref = (step.ref || '').trim();
      const name = (step.name || '').trim();
      if (ref) {
        const cleanRef = ref.split(';')[0].replace(/\s+/g, '').toUpperCase();
        if (!seen.has(cleanRef) && /^(A\d+|M\d+|T\d+|AP\d+|SS\d+)/i.test(cleanRef)) {
          highways.push(cleanRef);
          seen.add(cleanRef);
        }
      } else if (name && !ref && /autoroute|autostrada|motorway|autopista/i.test(name) && !seen.has(name)) {
        const shortName = name.split('-')[0].trim();
        highways.push(shortName);
        seen.add(name);
      }
    });
  });

  const coords = route.geometry?.coordinates || [];
  const isSwiss = coords.some(c => c[0] >= 7.5 && c[0] <= 9.0 && c[1] >= 46.0 && c[1] <= 47.5);
  const isChamonix = coords.some(c => c[0] >= 6.0 && c[0] <= 7.2 && c[1] >= 45.8 && c[1] <= 46.2);

  const hwStr = highways.slice(0, 2).join(', ');
  const viaCountry = isSwiss ? t().countryCH : (isChamonix ? t().countryFR : '');
  const parts = [hwStr, viaCountry].filter(Boolean);
  return parts.length > 0 ? 'via ' + parts.join(' • ') : (route.legs?.[0]?.summary ? 'via ' + route.legs[0].summary : t().directRoute);
}

// Render Alternative Route Selectors (both in sidebar/list & floating on the map)
function renderRouteAlternatives() {
  const container = document.getElementById('routes-container');
  const mapBar = document.getElementById('map-routes-bar');

  if (alternativeRoutes.length <= 1) {
    if (container) container.style.display = 'none';
    if (mapBar) mapBar.style.display = 'none';
    return;
  }

  // 1. Sidebar Container (Mode Liste)
  if (container) {
    container.style.display = 'flex';
    container.innerHTML = '';
  }

  // 2. Floating Map Bar (Mode Carte)
  if (mapBar) {
    mapBar.style.display = 'flex';
    mapBar.innerHTML = '';
    if (window.innerWidth <= 1080) {
      mapBar.style.position = 'fixed';
      mapBar.style.zIndex = '1950';
      if (typeof ensureMobileNavBarVisible === 'function') {
        ensureMobileNavBarVisible();
      } else {
        mapBar.style.bottom = 'calc(84px + env(safe-area-inset-bottom, 0px))';
      }
    } else {
      mapBar.style.position = '';
      mapBar.style.bottom = '';
      mapBar.style.zIndex = '';
    }
  }

  const baseDuration = alternativeRoutes[0]?.duration || 0;

  alternativeRoutes.forEach((route, idx) => {
    const distKm = (route.distance / 1000).toFixed(0);
    const hours = Math.floor(route.duration / 3600);
    const mins = Math.round((route.duration % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${mins}min` : `${mins} min`;
    const summary = getSmartRouteSummary(route);

    const diffMins = Math.round((route.duration - baseDuration) / 60);
    const diffStr = idx > 0 && diffMins > 0 ? `+${diffMins} min` : (idx > 0 && diffMins < 0 ? `${diffMins} min` : '');
    const badgeLabel = idx === 0 ? t().recommended : t().optionN(idx + 1);

    // A. Card in Sidebar
    if (container) {
      const card = document.createElement('div');
      const cardColorClass = idx === 0 ? 'route-card-blue' : 'route-card-orange';
      card.className = `route-card ${cardColorClass} ${idx === 0 ? 'active' : ''}`;
      card.id = `route-card-${idx}`;
      card.innerHTML = `
        <div class="route-card-header">
          <div class="route-card-left">
            <span class="route-badge ${idx === 0 ? 'badge-blue' : 'badge-orange'}">${badgeLabel}</span>
            <span class="route-desc">${summary}</span>
          </div>
          <span class="route-stats">${timeStr} ${diffStr ? `<span class="time-diff">(${diffStr})</span>` : ''} • ${distKm} km</span>
        </div>
      `;
      card.addEventListener('click', () => selectRoute(idx));
      container.appendChild(card);
    }

    // B. Floating Button on Map
    if (mapBar) {
      const btn = document.createElement('div');
      const btnColorClass = idx === 0 ? 'map-route-btn-blue' : 'map-route-btn-orange';
      btn.className = `map-route-btn ${btnColorClass} ${idx === 0 ? 'active' : ''}`;
      btn.id = `map-route-btn-${idx}`;
      btn.innerHTML = `
        <div class="map-route-btn-header">
          <span class="map-route-badge ${idx === 0 ? 'badge-blue' : 'badge-orange'}">${badgeLabel}</span>
          <span class="map-route-time">${timeStr} ${diffStr ? `<span class="map-route-time-diff">${diffStr}</span>` : ''}</span>
        </div>
        <div class="map-route-meta">${distKm} km • ${summary}</div>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRoute(idx);
      });
      mapBar.appendChild(btn);
    }
  });
}

// Select an active route and compute stations along it
function selectRoute(routeIndex) {
  activeRouteData = alternativeRoutes[routeIndex];

  // Update active state in sidebar cards and map floating pills
  document.querySelectorAll('.route-card').forEach((c, idx) => {
    c.classList.toggle('active', idx === routeIndex);
  });
  document.querySelectorAll('.map-route-btn').forEach((b, idx) => {
    b.classList.toggle('active', idx === routeIndex);
  });

  // Redraw map with prominent contrast for active vs alternative routes
  drawRoutesOnMap(routeIndex);

  // Re-match stations along the selected route
  processStationsOnRoute(activeRouteData);

  // Update summary bar metadata
  const metaLbl = document.getElementById('sum-route-meta');
  if (metaLbl && activeRouteData) {
    const dist = (activeRouteData.distance / 1000).toFixed(0);
    metaLbl.textContent = `• ${dist} km`;
  }
}

// Draw the routes on Leaflet (active in vibrant cyan, alternatives in glowing neon orange with clickable badges)
function drawRoutesOnMap(activeIdx) {
  // Clear old route polylines and markers
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];

  // Draw alternative routes first (behind active route)
  alternativeRoutes.forEach((route, idx) => {
    if (idx === activeIdx) return;
    const latlngs = route.geometry.coordinates.map(c => [c[1], c[0]]);

    // 1. Glowing Sunset Orange Aura
    const altAura = L.polyline(latlngs, {
      color: '#ff6600',
      weight: 16,
      opacity: 0.35,
      lineJoin: 'round'
    }).addTo(map);

    // 2. High-contrast dark outline
    const altOutline = L.polyline(latlngs, {
      color: '#090d16',
      weight: 11,
      opacity: 0.95,
      lineJoin: 'round'
    }).addTo(map);

    // 3. Ultra-vibrant Neon Sunset Orange line (solid, thick, 100% visible)
    const altPolyline = L.polyline(latlngs, {
      color: '#ff6600',
      weight: 7,
      opacity: 1.0,
      lineJoin: 'round'
    }).addTo(map);

    const onAltClick = () => {
      selectRoute(idx);
    };

    altAura.on('click', onAltClick);
    altOutline.on('click', onAltClick);
    altPolyline.on('click', onAltClick);

    routeLayers.push(altAura);
    routeLayers.push(altOutline);
    routeLayers.push(altPolyline);
  });

  // Draw active route with high-contrast outline (like Waze)
  if (alternativeRoutes[activeIdx]) {
    const latlngs = alternativeRoutes[activeIdx].geometry.coordinates.map(c => [c[1], c[0]]);

    // Outline
    const outline = L.polyline(latlngs, {
      color: '#090d16',
      weight: 12,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(map);
    routeLayers.push(outline);

    // Main line (vibrant cyan)
    const mainLine = L.polyline(latlngs, {
      color: '#0284c7',
      weight: 7.5,
      opacity: 1.0,
      lineJoin: 'round'
    }).addTo(map);
    routeLayers.push(mainLine);

    fitMapToRouteAndStations();
  }
}

// Fit map to show the entire route, alternative routes, departure, arrival, and all stations along it
function fitMapToRouteAndStations() {
  if (!map) return;

  const bounds = L.latLngBounds();

  // Include all routes (active + alternatives) so the whole comparison is visible on screen
  if (alternativeRoutes && alternativeRoutes.length > 0) {
    alternativeRoutes.forEach(r => {
      (r.geometry?.coordinates || []).forEach(c => bounds.extend([c[1], c[0]]));
    });
  } else if (activeRouteData && activeRouteData.geometry && activeRouteData.geometry.coordinates) {
    activeRouteData.geometry.coordinates.forEach(c => bounds.extend([c[1], c[0]]));
  } else if (startPoint && startPoint.coords && endPoint && endPoint.coords) {
    bounds.extend([startPoint.coords[1], startPoint.coords[0]]);
    bounds.extend([endPoint.coords[1], endPoint.coords[0]]);
  }

  // Also include all station coordinates
  if (currentRouteStations && currentRouteStations.length > 0) {
    currentRouteStations.forEach(st => {
      if (st.lat && st.lon) bounds.extend([st.lat, st.lon]);
    });
  }

  if (bounds.isValid()) {
    const isMobile = window.innerWidth <= 1080;
    const paddingOptions = isMobile
      ? { paddingTopLeft: [45, 25], paddingBottomRight: [25, 135], maxZoom: 15, animate: false }
      : { padding: [50, 50], maxZoom: 15, animate: false };

    map.fitBounds(bounds, paddingOptions);
    if (coveredCountriesLayer) coveredCountriesLayer.bringToBack();
  }
}

// Haversine formula
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Project a point onto a line segment and return distance, progress t, and signed cross product
function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { dist: getDistanceKm(py, px, y1, x1), t: 0, cross: 0 };
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const dist = getDistanceKm(py, px, projY, projX);
  // Signed 2D cross product: dx*(py - y1) - dy*(px - x1)
  // cross < 0 -> Station is on the RIGHT side (driver's lane in France/Spain)
  // cross > 0 -> Station is on the LEFT side (opposing highway carriageway / sens inverse)
  const cross = dx * (py - y1) - dy * (px - x1);

  return { dist, t, cross };
}

// Find all highway stations along the route, ordered chronologically
let currentRouteStations = [];

function processStationsOnRoute(route) {
  const coords = route.geometry.coordinates; // [[lon, lat], ...]

  // Pre-calculate cumulative distance along the route polyline
  const cumDist = [0];
  let totalKm = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = getDistanceKm(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
    totalKm += d;
    cumDist.push(totalKm);
  }

  // Route bounding box for fast pre-filtering
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  coords.forEach(c => {
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  });
  const bboxPad = 0.03; // ~3 km margin

  const matched = [];

  allStations.forEach(s => {
    // Fast bbox check
    if (s.lon < minLon - bboxPad || s.lon > maxLon + bboxPad ||
        s.lat < minLat - bboxPad || s.lat > maxLat + bboxPad) {
      return;
    }

    // Find nearest point on route polyline
    let minDist = 99999;
    let bestKmOnRoute = 0;
    let bestCross = 0;
    let bestDx = 0;
    let bestDy = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i+1];
      const res = distPointToSegment(s.lon, s.lat, p1[0], p1[1], p2[0], p2[1]);
      if (res.dist < minDist) {
        minDist = res.dist;
        const segLen = cumDist[i+1] - cumDist[i];
        bestKmOnRoute = cumDist[i] + res.t * segLen;
        bestCross = res.cross;
        bestDx = p2[0] - p1[0];
        bestDy = p2[1] - p1[1];
      }
    }

    const stationToleranceKm = s.pays === 'GB' ? 0.95 : maxDistanceKm;
    if (minDist <= stationToleranceKm) {
      const sensLow = (s.sens || '').toLowerCase();
      const isDoubleSens = sensLow.includes('double');

      if (s.pays === 'GB') {
        // UK Motorway Service Areas (MSAs): check cardinal direction if directional twin site
        if (!isDoubleSens) {
          if (sensLow.includes('northbound') && bestDy < -0.0001) return;
          if (sensLow.includes('southbound') && bestDy > 0.0001) return;
          if (sensLow.includes('eastbound') && bestDx < -0.0001) return;
          if (sensLow.includes('westbound') && bestDx > 0.0001) return;
          if (sensLow.includes('clockwise') && !sensLow.includes('anti') && bestCross < 0) return;
          if (sensLow.includes('anti-clockwise') && bestCross > 0) return;
        }
      } else {
        // Directional check: in France/Spain/Italy, vehicles drive on the right.
        // Highway stations accessible in the direction of travel are on the RIGHT (bestCross < 0).
        const isRightSide = bestCross < 0;
        if (!isRightSide && !isDoubleSens) {
          // Exclude twin station on opposing carriageway
          return;
        }
      }

      // Station is along this highway route in the driver's direction of travel!
      // Compute highway Point Kilométrique (PK)
      let displayedPk = s.pk_text;
      if (!displayedPk) {
        // If station doesn't have an explicit text PK, use highway progression
        displayedPk = Math.round(bestKmOnRoute);
      }

      matched.push({
        ...s,
        distOnRoute: bestKmOnRoute,
        displayedPk: displayedPk,
        minDistToAxisM: Math.round(minDist * 1000)
      });
    }
  });

  currentRouteStations = matched;
  populateBrandFilter();
  renderCurrentRouteStations();
  fitMapToRouteAndStations();
  maybeLoadGermanLivePrices(route, coords, cumDist);
}

// Charge à la demande les stations allemandes et leurs prix réels le long du trajet
// (un appel par tranche de ~40 km en Allemagne, 12 appels maximum, mis en cache 5 min par le relais)
async function maybeLoadGermanLivePrices(route, coords, cumDist) {
  if (!DE_LIVE_PRICES.proxyUrl || !route || route._deLiveRequested) return;
  route._deLiveRequested = true;

  const inGermany = (lat, lon) => lat >= 47.2 && lat <= 55.1 && lon >= 5.8 && lon <= 15.1;
  const samples = [];
  let nextKm = 0;
  for (let i = 0; i < coords.length && samples.length < 12; i++) {
    const [lon, lat] = coords[i];
    if (cumDist[i] >= nextKm && inGermany(lat, lon)) {
      samples.push([lat, lon]);
      nextKm = cumDist[i] + 40;
    }
  }
  if (samples.length === 0) return;

  const base = DE_LIVE_PRICES.proxyUrl.replace(/\/$/, '');
  const responses = await Promise.allSettled(samples.map(([lat, lon]) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    return fetch(`${base}/list?lat=${lat.toFixed(3)}&lng=${lon.toFixed(3)}&rad=25`, { signal: ctrl.signal })
      .then(r => r.json())
      .finally(() => clearTimeout(timer));
  }));

  const knownIds = new Set(allStations.map(s => String(s.id)));
  let added = 0;
  responses.forEach(res => {
    if (res.status !== 'fulfilled' || !res.value || !Array.isArray(res.value.stations)) return;
    res.value.stations.forEach(tk => {
      const id = `TK-${tk.id}`;
      if (knownIds.has(id)) return;
      knownIds.add(id);
      const prix = {};
      if (typeof tk.e10 === 'number' && tk.e10 > 0) prix.e10 = tk.e10;
      if (typeof tk.e5 === 'number' && tk.e5 > 0) prix.sp95 = tk.e5;
      if (typeof tk.diesel === 'number' && tk.diesel > 0) prix.gazole = tk.diesel;
      allStations.push({
        id,
        pays: 'DE',
        live: true,
        enseigne: (tk.brand || tk.name || 'Tankstelle').trim(),
        nom: (tk.name || '').trim(),
        autoroute: '',
        sens: '',
        adresse: `${tk.street || ''} ${tk.houseNumber || ''}`.trim(),
        cp: tk.postCode ? String(tk.postCode) : '',
        ville: tk.place || '',
        lat: tk.lat,
        lon: tk.lng,
        pk_text: null,
        prix,
        ruptures: [],
        services: []
      });
      added++;
    });
  });

  if (added > 0 && activeRouteData === route) {
    processStationsOnRoute(route);
  }
}

// Render stations in sidebar and on map
function renderCurrentRouteStations() {
  // Clear map markers
  stationMarkers.forEach(m => map.removeLayer(m));
  stationMarkers = [];

  // Filter by brand
  let filtered = currentRouteStations;
  if (selectedBrand !== 'all') {
    filtered = filtered.filter(s => s.enseigne === selectedBrand);
  }

  // Find lowest price for selected fuel among candidate stations
  let lowestPrice = 999;
  if (selectedFuel !== 'all') {
    filtered.forEach(s => {
      const p = getFuelPrice(s.prix, selectedFuel);
      if (p && p < lowestPrice) lowestPrice = p;
    });
  }

  // Sort stations
  if (currentSort === 'route') {
    filtered.sort((a, b) => a.distOnRoute - b.distOnRoute);
  } else if (currentSort === 'price') {
    filtered.sort((a, b) => {
      const pa = getFuelPrice(a.prix, selectedFuel) || 999;
      const pb = getFuelPrice(b.prix, selectedFuel) || 999;
      return pa - pb;
    });
  } else if (currentSort === 'dist') {
    filtered.sort((a, b) => a.distOnRoute - b.distOnRoute);
  }

  // Update counter
  const countLabel = document.getElementById('stations-count-label');
  if (countLabel) {
    countLabel.textContent = t().stationsCount(filtered.length);
  }

  const mobileBadge = document.getElementById('mobile-badge-count');
  if (mobileBadge) {
    mobileBadge.textContent = filtered.length;
  }
  const hdrBadge = document.getElementById('hdr-badge-count');
  if (hdrBadge) {
    hdrBadge.textContent = filtered.length;
  }

  const listContainer = document.getElementById('stations-list');
  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-muted);">
        <p style="font-size: 2rem; margin-bottom: 8px;">⛽</p>
        <p>${t().emptyFilteredTitle}</p>
        <p style="font-size:0.8rem; margin-top:4px;">${t().emptyFilteredSub}</p>
      </div>
    `;
    return;
  }

  function createAmazonCard() {
    const amazonCard = document.createElement('div');
    amazonCard.className = 'partner-card partner-amazon';
    amazonCard.id = 'partner-amazon-card';
    const tr = t();
    const trItems = tr.amazonItems || AFFILIATE_CONFIG.amazon.items;
    amazonCard.innerHTML = `
      <div class="partner-badge amazon-badge">${tr.amazonBadge}</div>
      <div class="amazon-items-list">
        ${AFFILIATE_CONFIG.amazon.items.map((item, i) => {
          const loc = trItems[i] || item;
          return `
          <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="amazon-item-row" title="Amazon">
            <span class="amazon-item-icon">${item.icon}</span>
            <div class="amazon-item-details">
              <span class="amazon-item-name">${loc.name}</span>
              <span class="amazon-item-sub">${loc.sub}</span>
            </div>
            <span class="amazon-item-arrow">${tr.amazonView}</span>
          </a>
        `;
        }).join('')}
      </div>
    `;
    return amazonCard;
  }

  let amazonInserted = false;

  // Dynamically adapt Fuel Selector dropdown labels according to the route's country/countries
  const routeCountries = [...new Set(currentRouteStations.map(s => s.pays || 'FR'))];
  const fuelSelectEl = document.getElementById('select-fuel');
  if (fuelSelectEl && routeCountries.length > 0) {
    const singleCountry = routeCountries.length === 1 ? routeCountries[0] : null;
    const hasSeparateSp95 = routeCountries.includes('FR') || routeCountries.includes('DE');
    const langCountryDict = FUEL_LABELS_BY_COUNTRY[t().defaultCountry] || FUEL_LABELS_BY_COUNTRY.FR;
    Array.from(fuelSelectEl.options).forEach(opt => {
      const fKey = opt.value;
      // Hide separate SP95 (E5) option when route does not include France or Germany (since ES, IT, GB have a single Unleaded 95 category)
      if (fKey === 'sp95') {
        opt.style.display = hasSeparateSp95 ? '' : 'none';
      }
      if (fKey === 'all') {
        opt.textContent = `⛽ ${langCountryDict.all}`;
      } else if (singleCountry) {
        const dict = FUEL_LABELS_BY_COUNTRY[singleCountry] || FUEL_LABELS_BY_COUNTRY.FR;
        if (dict[fKey]) {
          opt.textContent = `⛽ ${dict[fKey]}`;
        }
      } else {
        // Cross-border route: combine unique official names across the traversed countries
        const names = [...new Set(routeCountries.map(c => (FUEL_LABELS_BY_COUNTRY[c] || FUEL_LABELS_BY_COUNTRY.FR)[fKey]).filter(Boolean))];
        if (names.length > 0) {
          opt.textContent = `⛽ ${names.join(' / ')}`;
        }
      }
    });
  }

  // Render cards and map markers
  filtered.forEach((st, idx) => {
    const isUK = st.pays === 'GB';
    const isNativeCase = st.pays === 'GB' || st.pays === 'DE';
    const fuelPrice = (selectedFuel !== 'all') ? getFuelPrice(st.prix, selectedFuel) : (st.prix ? Object.values(st.prix)[0] : null);
    const isCheapest = fuelPrice && fuelPrice === lowestPrice;
    const brandClass = getBrandClass(st.enseigne);
    const pinPriceDisplay = fuelPrice ? (isUK ? `£${fuelPrice.toFixed(3)}` : `${fuelPrice.toFixed(3)}€`) : 'N/A';

    // Create Map Marker Pin
    const pinHtml = `
      <div class="custom-station-pin ${isCheapest ? 'cheapest' : ''}" id="pin-${st.id}">
        <span class="brand-badge ${brandClass}" style="padding:1px 4px; font-size:0.65rem;">${st.enseigne.substring(0, 5)}</span>
        <span>${pinPriceDisplay}</span>
      </div>
    `;

    const customIcon = L.divIcon({
      html: pinHtml,
      className: 'station-div-icon',
      iconSize: [104, 26],
      iconAnchor: [52, 13]
    });

    const marker = L.marker([st.lat, st.lon], { icon: customIcon }).addTo(map);

    // Popup content
    const flag = st.pays === 'GB' ? '🇬🇧' : (st.pays === 'DE' ? '🇩🇪' : (st.pays === 'BE' ? '🇧🇪' : (st.pays === 'ES' ? '🇪🇸' : (st.pays === 'IT' ? '🇮🇹' : '🇫🇷'))));
    const nomFormatted = isNativeCase ? st.nom : formatProperName(st.nom);
    const villeFormatted = isNativeCase ? st.ville : formatProperName(st.ville);
    const sensFormatted = st.sens ? translateSens(st.sens, isNativeCase) : '';
    const cleanPk = String(st.displayedPk || '').replace(/^km\s*/i, '').trim();
    const pkBadgeLabel = isUK
      ? `${st.autoroute || 'Motorway'} • ${st.pk_text || ('J' + cleanPk)}`
      : t().kmMarker(st.autoroute, cleanPk);

    const wazeUrl = `https://waze.com/ul?ll=${st.lat},${st.lon}&navigate=yes`;
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lon}&travelmode=driving`;

    const wazeSvg = `<svg class="nav-btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 10.5c0-4.4-3.8-8-8.5-8S2.5 6.1 2.5 10.5c0 1.9.7 3.6 1.8 5-.5 1.2-1.4 2.1-2.3 2.5-.4.2-.5.7-.2 1 .3.3.9.5 1.8.5 1.3 0 2.6-.4 3.6-.9 1.2.5 2.5.8 3.8.8 4.7 0 8.5-3.6 8.5-8.9zm-11 0c-.8 0-1.5-.7-1.5-1.5S7.7 7.5 8.5 7.5 10 8.2 10 9s-.7 1.5-1.5 1.5zm6 0c-.8 0-1.5-.7-1.5-1.5S13.7 7.5 14.5 7.5 16 8.2 16 9s-.7 1.5-1.5 1.5zm-3 5.2c-1.9 0-3.5-1-4.2-2.5-.2-.4 0-.8.4-1 .4-.2.8 0 1 .4.5 1 1.6 1.6 2.8 1.6s2.3-.6 2.8-1.6c.2-.4.6-.6 1-.4.4.2.6.6.4 1-.7 1.5-2.3 2.5-4.2 2.5z"/></svg>`;
    const gmapsSvg = `<svg class="nav-btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

    const popupContent = `
      <div class="station-popup">
        <div class="popup-title"><span class="flag-icon">${flag}</span> ${st.enseigne} - ${nomFormatted}</div>
        <div class="popup-pk">📍 ${pkBadgeLabel}</div>
        <div style="font-size:0.8rem; color:#cbd5e1; margin-bottom:6px;">${isNativeCase ? st.adresse : formatProperName(st.adresse)} (${villeFormatted})</div>
        <div style="font-size:0.75rem; color:#38bdf8; margin-bottom:8px;">${t().popupDirDist(sensFormatted || t().sensDirect, st.distOnRoute.toFixed(0))}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:0.8rem; margin-bottom:10px;">
          ${renderPopupPrices(st.prix, selectedFuel, st.pays)}
        </div>
        <div class="station-nav-actions popup-nav-actions">
          <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="btn-gps-nav btn-waze" title="${t().wazeTitle}">
            ${wazeSvg} <span>Waze</span>
          </a>
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-gps-nav btn-gmaps" title="${t().gmapsTitle}">
            ${gmapsSvg} <span>Maps</span>
          </a>
        </div>
      </div>
    `;
    marker.bindPopup(popupContent);
    stationMarkers.push(marker);

    // Create Sidebar Card
    const card = document.createElement('div');
    card.className = `station-card ${isCheapest ? 'highlighted' : ''}`;
    card.id = `card-${st.id}`;

    card.innerHTML = `
      ${isCheapest ? `<div class="best-price-ribbon">${t().bestPrice}</div>` : ''}
      <div class="card-top">
        <div style="display:flex; align-items:center;">
          <span class="station-rank">#${idx + 1}</span>
          <span class="flag-icon">${flag}</span>
          <span class="brand-badge ${brandClass}">${st.enseigne}</span>
        </div>
        <div class="card-top-right">
          <div class="station-logo-badge" title="${st.enseigne}">
            ${getBrandLogoSvg(st.enseigne)}
          </div>
          <span class="pk-marker-badge">
            🛣️ ${pkBadgeLabel}
          </span>
        </div>
      </div>

      <div class="station-name-row">
        <div class="station-name">${nomFormatted}</div>
        <div class="station-nav-actions">
          <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="btn-gps-nav btn-waze" onclick="event.stopPropagation();" title="${t().wazeTitle}">
            ${wazeSvg} <span>Waze</span>
          </a>
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-gps-nav btn-gmaps" onclick="event.stopPropagation();" title="${t().gmapsTitle}">
            ${gmapsSvg} <span>Maps</span>
          </a>
        </div>
      </div>
      <div class="station-details">
        <span class="distance-countdown">${t().fromStart(st.distOnRoute.toFixed(1))}</span>
        ${sensFormatted ? `<span class="sens-tag">${sensFormatted}</span>` : ''}
        <span>• ${villeFormatted}</span>
      </div>

      <div class="prices-container">
        ${renderCardPrices(st.prix, selectedFuel, isCheapest, st.pays)}
      </div>
      ${(st.pays === 'BE' || (st.pays === 'DE' && !st.live)) ? `<div style="font-size:0.68rem; color:#94a3b8; margin-top:3px;">${t().estimatedPrice}</div>` : ''}
      ${(st.pays === 'DE' && st.live) ? `<div style="font-size:0.66rem; color:#94a3b8; margin-top:3px;">MTS-K · <a href="https://www.tankerkoenig.de" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="color:#7dd3fc;">Tankerkönig</a> (CC BY 4.0)</div>` : ''}

      ${(() => {
        if (selectedFuel !== 'all' || !st.ruptures || st.ruptures.length === 0) return '';
        const realRuptures = st.ruptures.filter(r => !(r.toUpperCase() === 'SP95' && st.prix && st.prix.e10 > 0));
        return realRuptures.length > 0 ? `<div><span class="rupture-badge">${t().outOfStock} ${realRuptures.join(', ')}</span></div>` : '';
      })()}
    `;

    // Click card to zoom map to station
    card.addEventListener('click', () => {
      document.querySelectorAll('.station-card').forEach(c => c.classList.remove('highlighted'));
      card.classList.add('highlighted');
      
      // On mobile, switch back to map view automatically
      if (window.innerWidth <= 900) {
        setMobileView('map');
      }

      map.setView([st.lat, st.lon], 14, { animate: true });
      marker.openPopup();
    });

    listContainer.appendChild(card);

    // Insérer l'encart Amazon juste après la 2e station pour qu'il soit immédiatement visible sans faire défiler tout l'écran
    if (idx === 1 && AFFILIATE_CONFIG.amazon.enabled) {
      listContainer.appendChild(createAmazonCard());
      amazonInserted = true;
    }
  });

  // Si l'itinéraire a moins de 2 stations, l'insérer à la fin
  if (!amazonInserted && AFFILIATE_CONFIG.amazon.enabled && filtered.length > 0) {
    listContainer.appendChild(createAmazonCard());
  }
}

// Render fuel prices inside card
function renderCardPrices(prices, featuredFuel, isCheapest, pays) {
  const isUK = pays === 'GB';
  const formatPrice = (val) => isUK ? `£${val.toFixed(3)}` : `${val.toFixed(3)} €`;

  if (!prices || Object.keys(prices).length === 0) {
    return `
      <div class="prices-single-row">
        <span class="single-fuel-label"><span class="fuel-icon">⛽</span><span class="fuel-name">${t().priceLbl}</span></span>
        <span class="price-val-unavail">${t().noPrice}</span>
      </div>
    `;
  }

  // When a specific fuel is filtered (default behavior: e10/sp95, gazole, sp98, etc.)
  if (featuredFuel && featuredFuel !== 'all') {
    const p = getFuelPrice(prices, featuredFuel);
    const fuelName = getServedFuelLabel(prices, featuredFuel, pays);

    if (p && p > 0) {
      return `
        <div class="prices-single-row ${isCheapest ? 'cheapest' : 'featured'}">
          <div class="single-fuel-label">
            <span class="fuel-icon">⛽</span>
            <span class="fuel-name">${fuelName}</span>
          </div>
          <div class="single-fuel-price">
            <span class="price-val-large ${isCheapest ? 'cheapest' : ''}">${formatPrice(p)}</span>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="prices-single-row unavailable">
          <div class="single-fuel-label">
            <span class="fuel-icon">⛽</span>
            <span class="fuel-name">${fuelName}</span>
          </div>
          <div class="single-fuel-price">
            <span class="price-val-unavail">${t().unavail}</span>
          </div>
        </div>
      `;
    }
  }

  // If "Tous les carburants" (all) is selected, render official country-specific multi-fuel grid
  const fuels = getDistinctCountryFuels(pays);
  let html = '<div class="prices-grid">';
  fuels.forEach(f => {
    if (prices[f]) {
      html += `
        <div class="price-item">
          <span class="price-name">${getFuelLabel(f, pays)}</span>
          <span class="price-val">${formatPrice(prices[f])}</span>
        </div>
      `;
    }
  });
  html += '</div>';
  return html;
}

// Render prices in marker popup
function renderPopupPrices(prices, featuredFuel, pays) {
  const isUK = pays === 'GB';
  const formatPrice = (val) => isUK ? `£${val.toFixed(3)}` : `${val.toFixed(3)} €`;

  if (!prices) return `<span>${t().noPrice}</span>`;
  if (featuredFuel && featuredFuel !== 'all') {
    const p = getFuelPrice(prices, featuredFuel);
    const fuelName = getServedFuelLabel(prices, featuredFuel, pays);
    if (p && p > 0) {
      return `
        <div style="grid-column: span 2; background: rgba(16, 185, 129, 0.15); border: 1.5px solid #10b981; padding: 6px 12px; border-radius: 8px; display:flex; justify-content:space-between; align-items:center;">
          <span style="color: #a7f3d0; font-size: 0.85rem; font-weight: 700;">⛽ ${fuelName}</span>
          <b style="color: #ffffff; font-size: 1.15rem; font-family: monospace;">${formatPrice(p)}</b>
        </div>
      `;
    } else {
      return `
        <div style="grid-column: span 2; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; padding: 6px 10px; border-radius: 6px; text-align:center; color:#fca5a5; font-size:0.8rem;">
          ⛽ ${fuelName} : ${t().unavail}
        </div>
      `;
    }
  }
  const fuels = getDistinctCountryFuels(pays).filter(f => prices[f]);
  return fuels.map(f => `
    <div style="background:rgba(255,255,255,0.06); padding:3px 6px; border-radius:4px;">
      <span style="color:#94a3b8; font-size:0.7rem;">${getFuelLabel(f, pays)}:</span>
      <b style="color:#fff;">${formatPrice(prices[f])}</b>
    </div>
  `).join('');
}

// Helper for brand badge CSS class
function getBrandClass(brand) {
  const b = (brand || '').toLowerCase();
  if (b.includes('aral')) return 'badge-aral';
  if (b.includes('total')) return 'badge-total';
  if (b.includes('shell')) return 'badge-shell';
  if (b.includes('avia')) return 'badge-avia';
  if (b.includes('esso')) return 'badge-esso';
  if (b.includes('eni')) return 'badge-eni';
  if (b.includes('leclerc')) return 'badge-leclerc';
  if (b.includes('bp')) return 'badge-bp';
  if (b.includes('fulli')) return 'badge-fulli';
  if (b.includes('repsol')) return 'badge-repsol';
  if (b.includes('cepsa')) return 'badge-cepsa';
  if (b.includes('galp')) return 'badge-galp';
  if (b.includes('petronor')) return 'badge-petronor';
  if (b.includes('ip') || b.includes('api')) return 'badge-ip';
  if (b.includes('q8')) return 'badge-q8';
  if (b.includes('tamoil')) return 'badge-tamoil';
  if (b.includes('sarni')) return 'badge-sarni';
  if (b.includes('texaco')) return 'badge-esso';
  return 'badge-default';
}

// Return official brand logo SVG badge
function getBrandLogoSvg(brand) {
  const b = (brand || '').toLowerCase().trim();

  // Aral (German blue diamond)
  if (b.includes('aral')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffffff"/>
      <polygon points="50,6 94,50 50,94 6,50" fill="#00549f" stroke="#00386b" stroke-width="2"/>
      <polygon points="50,12 88,50 50,88 12,50" fill="none" stroke="#ffffff" stroke-width="2.5"/>
      <text x="50" y="57" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="21" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">ARAL</text>
    </svg>`;
  }

  // TotalEnergies
  if (b.includes('total')) {
    return `<svg viewBox="40 -85 480 480" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect x="40" y="-85" width="480" height="480" rx="90" fill="#ffffff"/>
      <defs>
        <linearGradient id="teGrad1" x1="130.8" y1="29.7" x2="245" y2="153.7" gradientUnits="userSpaceOnUse"><stop style="stop-color:#0186f5" offset="0"/><stop style="stop-color:#35c2b0" offset="0.3"/><stop style="stop-color:#aad825" offset="0.67"/><stop style="stop-color:#fed700" offset="1"/></linearGradient>
        <linearGradient id="teGrad2" x1="133.8" y1="10.3" x2="260" y2="12.7" gradientUnits="userSpaceOnUse"><stop style="stop-color:#0186f5" offset="0"/><stop style="stop-color:#3156fd" offset="1"/></linearGradient>
        <linearGradient id="teGrad3" x1="266.8" y1="57.7" x2="278.5" y2="34.8" gradientUnits="userSpaceOnUse"><stop style="stop-color:#8434d5" offset="0"/><stop style="stop-color:#3156fd" offset="1"/></linearGradient>
        <linearGradient id="teGrad4" x1="253.9" y1="70.5" x2="157.1" y2="75.1" gradientUnits="userSpaceOnUse"><stop style="stop-color:#8434d5" offset="0"/><stop style="stop-color:#fe0201" offset="1"/></linearGradient>
        <linearGradient id="teGrad5" x1="37" y1="162.2" x2="38" y2="84.3" gradientUnits="userSpaceOnUse"><stop style="stop-color:#ff7f00" offset="0"/><stop style="stop-color:#fe0201" offset="1"/></linearGradient>
      </defs>
      <g transform="translate(179.4, 96.4)">
        <path style="fill:url(#teGrad1);stroke:none;" d="M 124.96,-5.78 C 111.3,5.1 98.2,19.5 90.6,35.28 74.98,67.68 83.64,97.47 90.34,116.8 c 9.12,26.32 27.58,39.61 49.6,49.31 31.38,13.84 70.83,14.77 106.64,5.52 12.63,-3.26 32.23,-10.04 36.51,-16.36 4.63,-6.85 5.36,-20.1 -4.59,-25.91 -9.71,-5.67 -10.65,-1.34 -39.56,5.08 -20.12,4.47 -42.09,5.24 -68.47,-6.15 -26.65,-11.58 -37.91,-22.61 -41.76,-37.68 -11.03,-43.22 12.81,-59.25 17.46,-62.18 Z" />
        <path style="fill:url(#teGrad5);stroke:none;" d="M 157.84,45.11 C 145.42,43.46 108.98,39.6 70.85,32.83 11.84,22.37 -57.53,7.85 -79.67,6.3 c -42.62,-2.98 -49.73,52.39 -15.7,61.86 19.27,5.36 72.3,-0.27 85.18,25.18 3.93,7.75 14.32,36.98 26.08,73.17 4.61,14.19 42.12,11.96 35.15,-18.27 -4.09,-17.27 -13.16,-63.9 -13.16,-63.9 0,0 107.59,11.41 116.35,12.17 z" />
        <path style="fill:url(#teGrad2);stroke:none;" d="m 214.5,16.63 c 13.66,0.36 37.44,3.87 48.14,11.03 l 59.71,11.77 c 0.57,-33.14 -17.61,-50.97 -37.97,-61.25 -15.46,-7.8 -37.15,-14.16 -69.69,-12.77 -31.12,1.33 -63.84,8.15 -89.94,28.94 l 31.19,38.68 c 14.72,-9.27 33.21,-17.07 58.56,-16.4 z" />
        <path style="fill:url(#teGrad3);stroke:none;" d="m 261.69,27.06 c 0,0 3.15,2.01 4.51,3.26 6.5,5.94 8.66,13.04 -11.07,16.3 l 15.6,48.25 c 35.5,-9.51 51.17,-30.46 51.61,-56.04 z" />
        <path style="fill:url(#teGrad4);stroke:none;" d="m 255.72,46.54 c -17.49,2.89 -51.4,4.76 -98.14,-1.43 l -3.52,51.4 c 75.92,6.57 102.61,2.09 117.26,-1.84 z" />
      </g>
    </svg>`;
  }

  // Shell
  if (b.includes('shell')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffde00"/>
      <path d="M22 75 L32 82 L68 82 L78 75 L86 52 L82 32 L68 20 L50 16 L32 20 L18 32 L14 52 Z" fill="#dd1d21"/>
      <path d="M26 72 L34 78 L66 78 L74 72 L81 51 L77 34 L65 24 L50 20 L35 24 L23 34 L19 51 Z" fill="#ffde00"/>
      <path d="M50 20 L50 78 M36 24 L43 78 M64 24 L57 78 M24 34 L35 78 M76 34 L65 78" stroke="#dd1d21" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`;
  }

  // BP
  if (b.includes('bp')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffffff"/>
      <circle cx="50" cy="46" r="32" fill="#008837"/>
      <circle cx="50" cy="46" r="24" fill="#8bc53f"/>
      <circle cx="50" cy="46" r="16" fill="#fff200"/>
      <circle cx="50" cy="46" r="8" fill="#ffffff"/>
      <text x="50" y="89" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="17" fill="#008837" text-anchor="middle" letter-spacing="-0.5">bp</text>
    </svg>`;
  }

  // Esso
  if (b.includes('esso')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#003399"/>
      <ellipse cx="50" cy="50" rx="44" ry="26" fill="#ffffff" stroke="#003399" stroke-width="3"/>
      <text x="50" y="58" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="26" fill="#ed1c24" text-anchor="middle" letter-spacing="-1">Esso</text>
    </svg>`;
  }

  // Repsol
  if (b.includes('repsol')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#0a1d37"/>
      <path d="M16 42 A34 34 0 0 1 84 42 Z" fill="#e31b23"/>
      <rect x="12" y="44" width="76" height="18" rx="2" fill="#ffffff"/>
      <text x="50" y="58" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="13" fill="#0a1d37" text-anchor="middle" letter-spacing="1">REPSOL</text>
      <path d="M16 64 A34 34 0 0 0 84 64 Z" fill="#ff7900"/>
    </svg>`;
  }

  // Avia
  if (b.includes('avia')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffffff"/>
      <circle cx="50" cy="50" r="44" fill="#d9251d"/>
      <text x="50" y="58" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="22" fill="#ffffff" text-anchor="middle" font-style="italic">AVIA</text>
      <rect x="24" y="65" width="52" height="4" rx="2" fill="#ffffff"/>
    </svg>`;
  }

  // Cepsa
  if (b.includes('cepsa')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#c4122d"/>
      <text x="50" y="56" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="19" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">CEPSA</text>
      <circle cx="28" cy="68" r="3.5" fill="#ffffff"/>
      <circle cx="50" cy="68" r="3.5" fill="#ffffff"/>
      <circle cx="72" cy="68" r="3.5" fill="#ffffff"/>
    </svg>`;
  }

  // Moeve (New Cepsa identity)
  if (b.includes('moeve')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#e11d48"/>
      <text x="50" y="58" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="20" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5">moeve</text>
    </svg>`;
  }

  // Eni / Agip
  if (b.includes('eni') || b.includes('agip')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffde00"/>
      <path d="M40 30 C40 24 46 22 50 22 C54 22 60 26 56 32 L70 38 L66 46 L55 42 L55 60 L49 60 L49 46 L45 52 L37 44 L44 38 Z" fill="#000000"/>
      <path d="M57 26 Q65 22 63 30 Q59 28 57 26" fill="#e31b23"/>
      <circle cx="43" cy="66" r="3" fill="#000"/>
      <circle cx="51" cy="66" r="3" fill="#000"/>
      <circle cx="59" cy="66" r="3" fill="#000"/>
      <text x="50" y="85" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="16" fill="#000000" text-anchor="middle">eni</text>
    </svg>`;
  }

  // E.Leclerc
  if (b.includes('leclerc')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#005696"/>
      <circle cx="64" cy="34" r="10" fill="#f38b00"/>
      <path d="M38 24 L48 24 L48 66 L68 66 L68 76 L38 76 Z" fill="#ffffff"/>
    </svg>`;
  }

  // Galp
  if (b.includes('galp')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ff5900"/>
      <path d="M30 40 Q45 20 65 35 Q75 45 60 65 Q45 75 35 60 Z" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
      <text x="50" y="84" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="17" fill="#ffffff" text-anchor="middle">galp</text>
    </svg>`;
  }

  // Fulli
  if (b.includes('fulli')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#008080"/>
      <circle cx="50" cy="50" r="38" fill="#00a3a6"/>
      <text x="50" y="58" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="22" fill="#ffff00" text-anchor="middle">fulli</text>
    </svg>`;
  }

  // Dyneff
  if (b.includes('dyneff')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#002b66"/>
      <path d="M30 30 L50 48 L70 30" fill="none" stroke="#e31b23" stroke-width="8" stroke-linecap="round"/>
      <text x="50" y="75" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="16" fill="#ffffff" text-anchor="middle">dyneff</text>
    </svg>`;
  }

  // Petronor
  if (b.includes('petronor')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#004b93"/>
      <path d="M32 30 L50 45 L68 30" fill="none" stroke="#e31b23" stroke-width="7" stroke-linecap="round"/>
      <text x="50" y="73" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="14" fill="#ffffff" text-anchor="middle">petronor</text>
    </svg>`;
  }

  // IP (Gruppo API / Italiana Petroli)
  if (b.includes('ip') || b.includes('api')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#002b80"/>
      <circle cx="36" cy="30" r="7" fill="#ff6a00"/>
      <rect x="29" y="42" width="14" height="34" rx="4" fill="#ffffff"/>
      <rect x="52" y="42" width="14" height="42" rx="4" fill="#ffffff"/>
      <path d="M56 42 Q78 42 78 57 Q78 72 56 72 Z" fill="#ffffff"/>
      <path d="M64 51 Q70 51 70 57 Q70 63 64 63 Z" fill="#002b80"/>
    </svg>`;
  }

  // Q8 (Kuwait Petroleum)
  if (b.includes('q8')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#ffffff"/>
      <path d="M30 44 C32 24 45 15 52 14 C50 24 46 37 30 44 Z" fill="#003882"/>
      <path d="M52 14 C58 23 62 34 60 44 C50 44 48 29 52 14 Z" fill="#ffcc00"/>
      <path d="M59 27 C64 33 68 39 68 44 C62 44 60 37 59 27 Z" fill="#dc2626"/>
      <text x="50" y="80" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="34" fill="#003882" letter-spacing="-1">Q8</text>
    </svg>`;
  }

  // Tamoil
  if (b.includes('tamoil')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#dc2626"/>
      <circle cx="50" cy="40" r="22" fill="#ffffff"/>
      <circle cx="50" cy="40" r="18" fill="#003399"/>
      <path d="M40 40 L60 40 L50 25 Z" fill="#ffffff"/>
      <text x="50" y="80" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="16" fill="#ffffff" letter-spacing="1">TAMOIL</text>
    </svg>`;
  }

  // Sarni Oil
  if (b.includes('sarni')) {
    return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#059669"/>
      <text x="50" y="48" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="1">SARNI</text>
      <text x="50" y="72" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-size="14" fill="#facc15" letter-spacing="2">OIL</text>
    </svg>`;
  }

  // Default fallback
  const initial = (brand || 'S').substring(0, 3).toUpperCase();
  return `<svg viewBox="0 0 100 100" class="brand-svg" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="18" fill="#1e293b" stroke="#334155" stroke-width="3"/>
    <text x="50" y="46" font-size="24" text-anchor="middle">⛽</text>
    <text x="50" y="76" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="14" fill="#38bdf8" text-anchor="middle">${initial}</text>
  </svg>`;
}

// Global window bindings for navigation and testing
window.applyPreset = applyPreset;
window.calculateItinerary = calculateItinerary;
window.setMobileView = setMobileView;
window.fitMapToRouteAndStations = fitMapToRouteAndStations;
window.getCurrentRouteStations = () => currentRouteStations;
