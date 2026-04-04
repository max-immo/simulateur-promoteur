// api/plu.js — EstimationTerrain.fr
// Backend serverless Vercel (CommonJS)
// Calcul bilan promoteur basé sur le PLUi Vallée Sud Grand Paris
// Approuvé 10/12/2025 — Modification simplifiée n°1

const ZONES_PLU = {
  // ── Zones U1 (pavillonnaires) ──────────────────────────────────────────────
  "U1a":  { label:"Zone pavillonnaire U1a",         ces:0.35, hauteur_acrotere:7,  niveaux_max:2 },
  "U1b":  { label:"Zone pavillonnaire dense U1b",    ces:0.40, hauteur_acrotere:7,  niveaux_max:2 },
  "U1c":  { label:"Zone pavillonnaire U1c",          ces:0.35, hauteur_acrotere:8,  niveaux_max:3 },
  "U1d":  { label:"Zone pavillonnaire protégée U1d", ces:0.20, hauteur_acrotere:7,  niveaux_max:2 },
  "U1e":  { label:"Zone densifiable U1e",            ces:0.40, hauteur_acrotere:10, niveaux_max:3 },
  "U1f":  { label:"Zone U1f (bande constructib.)",   ces:0.35, hauteur_acrotere:7,  niveaux_max:2 },
  "U1g":  { label:"Zone grands terrains U1g",        ces:0.35, hauteur_acrotere:8,  niveaux_max:2 },
  "U1P":  { label:"Zone patrimoniale U1P",           ces:0.35, hauteur_acrotere:8,  niveaux_max:2 },
  "U1Pb": { label:"Zone U1Pb (Châtillon patrimonial)",ces:0.30,hauteur_acrotere:7,  niveaux_max:2 },

  // ── Zones U2/U3/U4 (collectif) ────────────────────────────────────────────
  "U2":   { label:"Zone de centralité U2",           ces:0.80, hauteur_acrotere:12, niveaux_max:4 },
  "U3":   { label:"Zone mixte U3",                   ces:0.70, hauteur_acrotere:15, niveaux_max:5 },
  "U4":   { label:"Zone grandes résidences U4",      ces:0.40, hauteur_acrotere:15, niveaux_max:6 },

  // ── Autres ───────────────────────────────────────────────────────────────
  "U5":   { label:"Zone économique U5",              ces:0.60, hauteur_acrotere:10, niveaux_max:3 },
  "NC":   { label:"Zone non constructible",          ces:0,    hauteur_acrotere:0,  niveaux_max:0 },
  "_fallback": { label:"Zone IDF (défaut)",          ces:0.35, hauteur_acrotere:9,  niveaux_max:3 }
};

// Correspondance code GPU → clé dans ZONES_PLU
const MAPPING_GPU = {
  "U1":"U1a","U1A":"U1a","U1a":"U1a",
  "U1B":"U1b","U1b":"U1b",
  "U1C":"U1c","U1c":"U1c",
  "U1D":"U1d","U1d":"U1d",
  "U1E":"U1e","U1e":"U1e",
  "U1F":"U1f","U1f":"U1f",
  "U1G":"U1g","U1g":"U1g",
  "U1P":"U1P","U1p":"U1P","U1PA":"U1P","U1Pa":"U1P",
  "U1PB":"U1Pb","U1Pb":"U1Pb",
  "U1PC":"U1P","U1Pc":"U1P","U1PD":"U1P","U1Pd":"U1P","U1PE":"U1P","U1Pe":"U1P",
  "U2":"U2","U2a":"U2","U2b":"U2","U2c":"U2","U2d":"U2",
  "U3":"U3","U3a":"U3","U3b":"U3","U3c":"U3","U3d":"U3","U3e":"U3","U3f":"U3","U3g":"U3",
  "U4":"U4","U4a":"U4","U4b":"U4","U4c":"U4","U4d":"U4","U4e":"U4",
  "U5":"U5","U6":"U5","N":"NC","A":"NC","NP":"NC"
};

// Prix marché DVF de fallback par département (€/m² SHAB médian)
const PRIX_FALLBACK = {
  "75": 10500, "77": 3200, "78": 4200, "91": 3400,
  "92": 7800,  "93": 4500, "94": 6200, "95": 3300
};

// ── Helpers ───────────────────────────────────────────────────────────────

function resolveZone(codeGpu) {
  if (!codeGpu) return "_fallback";
  // Cherche match exact, puis sans suffixe lettre, puis fallback
  const clean = codeGpu.trim();
  if (MAPPING_GPU[clean]) return MAPPING_GPU[clean];
  // Essai sans indice (ex: "U1a*" → "U1a")
  const base = clean.replace(/[^A-Za-z0-9]/g, "");
  if (MAPPING_GPU[base]) return MAPPING_GPU[base];
  // Essai prefix 2 char
  const prefix = clean.substring(0, 2).toUpperCase();
  if (MAPPING_GPU[prefix]) return MAPPING_GPU[prefix];
  return "_fallback";
}

/**
 * Calcul bilan promoteur — logique correcte
 *
 * 1. CES × surface_terrain = surface_au_sol (emprise max constructible)
 * 2. surface_au_sol × (hauteur_acrotere / 2.80) = SHAB brute (nb niveaux × surface plancher)
 * 3. SHAB_brute × 0.85 = SHAB nette vendable (déduction parties communes, paliers, etc.)
 * 4. SHAB_nette × prix_marché = CA promoteur
 * 5. CA × 0.22 = Charge foncière (valeur terrain charge foncière)
 * 6. low  = CF × 0.85 (valeur basse terrain net vendeur)
 *    high = low × 1.35 (écart max 35%)
 */
function calculBilan(surfaceTerrain, zoneKey, prixMarche) {
  const zone = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];

  if (zone.ces === 0) {
    return {
      constructible: false,
      raison: "Zone non constructible pour le logement",
      zone_label: zone.label
    };
  }

  const hauteurEtage = 2.80; // hauteur libre par niveau (m) — standard promoteur

  // Étape 1 — Surface au sol
  const surface_au_sol = surfaceTerrain * zone.ces;

  // Étape 2 — SHAB brute (nombre de niveaux × surface au sol)
  const nb_niveaux = Math.floor(zone.hauteur_acrotere / hauteurEtage);
  const shab_brute = surface_au_sol * nb_niveaux;

  // Étape 3 — SHAB nette vendable (85% de la brute)
  const shab_nette = shab_brute * 0.85;

  // Étape 4 — CA promoteur
  const ca = shab_nette * prixMarche;

  // Étape 5 — Charge foncière (22% du CA = ratio standard IDF)
  const cf = ca * 0.22;

  // Étape 6 — Fourchette valeur terrain
  const val_low  = Math.round(cf * 0.85);
  const val_high = Math.round(val_low * 1.35);

  return {
    constructible: true,
    zone_label: zone.label,
    zone_key: zoneKey,
    parametres: {
      ces: zone.ces,
      hauteur_acrotere: zone.hauteur_acrotere,
      nb_niveaux_calcules: nb_niveaux,
      surface_terrain: Math.round(surfaceTerrain),
      prix_marche: Math.round(prixMarche)
    },
    calcul: {
      surface_au_sol: Math.round(surface_au_sol),
      shab_brute: Math.round(shab_brute),
      shab_nette: Math.round(shab_nette),
      ca_promoteur: Math.round(ca),
      charge_fonciere: Math.round(cf)
    },
    valeur_terrain: {
      low: val_low,
      high: val_high,
      low_m2: Math.round(val_low / surfaceTerrain),
      high_m2: Math.round(val_high / surfaceTerrain)
    }
  };
}

// ── Appels API externes ────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

async function getZonePLU(lat, lon) {
  // API GPU IGN — serveur WFS géoportail
  const url = `https://wxs.ign.fr/essentiels/geoportail/wfs?SERVICE=WFS&VERSION=2.0.0`
    + `&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:zone_de_vegetation`; // placeholder
  // Vraie URL GPU
  const gpuUrl = `https://wxs.ign.fr/essentiels/geoportail/wfs?`
    + `SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
    + `&TYPENAMES=GPU:zone_urba`
    + `&outputFormat=application/json`
    + `&CQL_FILTER=INTERSECTS(the_geom,POINT(${lon}%20${lat}))`;

  const data = await fetchJson(gpuUrl);
  if (!data || !data.features || data.features.length === 0) return null;

  const feat = data.features[0];
  const props = feat.properties || {};
  // Le champ libelle ou typezone selon version API
  return props.libelle || props.typezone || props.zone_urba || null;
}

async function getPrixDVF(lat, lon, dep) {
  // API dvf cquest
  const url = `https://api.cquest.org/dvf?lat=${lat}&lon=${lon}&dist=800&nature_mutation=Vente`;
  const data = await fetchJson(url);

  if (!data || !data.resultats || data.resultats.length === 0) {
    return PRIX_FALLBACK[dep] || 5000;
  }

  // Filtrer sur appartements, < 3 ans
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 3);

  const apparts = data.resultats.filter(r =>
    r.type_local === "Appartement" &&
    r.surface_reelle_bati > 20 &&
    r.valeur_fonciere > 0 &&
    new Date(r.date_mutation) > cutoff
  );

  if (apparts.length === 0) return PRIX_FALLBACK[dep] || 5000;

  const prix = apparts.map(r => r.valeur_fonciere / r.surface_reelle_bati)
    .filter(p => p > 1000 && p < 25000)
    .sort((a, b) => a - b);

  if (prix.length === 0) return PRIX_FALLBACK[dep] || 5000;

  // Médiane
  const mid = Math.floor(prix.length / 2);
  return prix.length % 2 === 0
    ? Math.round((prix[mid - 1] + prix[mid]) / 2)
    : prix[mid];
}

async function getSurface(lat, lon) {
  // Apicarto IGN — surface cadastrale
  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lon}&lat=${lat}`;
  const data = await fetchJson(url);
  if (!data || !data.features || data.features.length === 0) return null;
  const props = data.features[0].properties;
  return props.contenance || null; // m²
}

async function getAdresse(lat, lon) {
  const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`;
  const data = await fetchJson(url);
  if (!data || !data.features || data.features.length === 0) return null;
  const props = data.features[0].properties;
  return {
    label: props.label,
    postcode: props.postcode,
    dep: (props.postcode || "75").substring(0, 2),
    city: props.city
  };
}

// ── Handler principal ──────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { lat, lon, surface } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Paramètres lat et lon requis" });
  }

  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);

  if (isNaN(latF) || isNaN(lonF)) {
    return res.status(400).json({ error: "Coordonnées invalides" });
  }

  try {
    // Appels parallèles
    const [adresse, zonePLURaw, surfaceParcelle] = await Promise.all([
      getAdresse(latF, lonF),
      getZonePLU(latF, lonF),
      surface ? Promise.resolve(parseFloat(surface)) : getSurface(latF, lonF)
    ]);

    const dep = adresse ? adresse.dep : "92";
    const surfaceTerrain = isNaN(surfaceParcelle) ? 500 : surfaceParcelle;

    // Prix marché DVF
    const prixMarche = await getPrixDVF(latF, lonF, dep);

    // Résolution zone PLU
    const zoneKey = resolveZone(zonePLURaw);
    const zoneInfo = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];

    // Calcul bilan
    const bilan = calculBilan(surfaceTerrain, zoneKey, prixMarche);

    // Réponse
    return res.status(200).json({
      ok: true,
      adresse: adresse ? adresse.label : `${latF}, ${lonF}`,
      departement: dep,
      surface_terrain: Math.round(surfaceTerrain),
      zone_plu: {
        code: zonePLURaw || "non identifiée",
        libelle: zoneInfo.label,
        key: zoneKey
      },
      prix_marche_m2: prixMarche,
      bilan
    });

  } catch (err) {
    console.error("[plu.js] Erreur:", err);
    return res.status(500).json({
      error: "Erreur interne du serveur",
      detail: err.message
    });
  }
};
