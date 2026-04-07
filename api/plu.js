// api/plu.js — EstimationTerrain.fr
// Backend serverless Vercel (CommonJS)
// APIs : apicarto.ign.fr (GPU + cadastre) · DVF etalab · BAN
// Source PLUi : Vallée Sud Grand Paris, approuvé 10/12/2025

// ─── Table zones PLU (extraite du PLUi Vallée Sud + valeurs nationales) ───────
const ZONES_PLU = {
  // Zones U1 pavillonnaires Vallée Sud Grand Paris
  "U1a":  { label:"Zone pavillonnaire U1a",           ces:0.35, hauteur:7,  niveaux:2 },
  "U1b":  { label:"Zone pavillonnaire dense U1b",      ces:0.40, hauteur:7,  niveaux:2 },
  "U1c":  { label:"Zone pavillonnaire U1c",            ces:0.35, hauteur:8,  niveaux:3 },
  "U1d":  { label:"Zone pavillonnaire protégée U1d",   ces:0.20, hauteur:7,  niveaux:2 },
  "U1e":  { label:"Zone densifiable U1e",              ces:0.40, hauteur:10, niveaux:3 },
  "U1f":  { label:"Zone U1f (bande constructib.)",     ces:0.35, hauteur:7,  niveaux:2 },
  "U1g":  { label:"Zone grands terrains U1g",          ces:0.35, hauteur:8,  niveaux:2 },
  "U1P":  { label:"Zone patrimoniale U1P",             ces:0.35, hauteur:8,  niveaux:2 },
  "U1Pb": { label:"Zone patrimoniale U1Pb",            ces:0.30, hauteur:7,  niveaux:2 },
  // Zones mixtes / collectifs
  "U2":   { label:"Zone de centralité U2",             ces:0.80, hauteur:12, niveaux:4 },
  "U3":   { label:"Zone mixte U3",                     ces:0.70, hauteur:15, niveaux:5 },
  "U4":   { label:"Zone grandes résidences U4",        ces:0.40, hauteur:15, niveaux:6 },
  "U5":   { label:"Zone économique U5",                ces:0.60, hauteur:10, niveaux:3 },
  // Zones nationales génériques (hors Vallée Sud)
  "UA":   { label:"Zone UA (centre urbain dense)",     ces:0.70, hauteur:15, niveaux:5 },
  "UAa":  { label:"Zone UAa",                          ces:0.80, hauteur:18, niveaux:6 },
  "UAb":  { label:"Zone UAb",                          ces:0.60, hauteur:12, niveaux:4 },
  "UB":   { label:"Zone UB (tissu mixte)",             ces:0.50, hauteur:12, niveaux:4 },
  "UBa":  { label:"Zone UBa",                          ces:0.55, hauteur:12, niveaux:4 },
  "UBb":  { label:"Zone UBb",                          ces:0.45, hauteur:9,  niveaux:3 },
  "UC":   { label:"Zone UC (pavillonnaire collectif)", ces:0.40, hauteur:9,  niveaux:3 },
  "UCa":  { label:"Zone UCa",                          ces:0.40, hauteur:9,  niveaux:3 },
  "UD":   { label:"Zone UD (pavillonnaire)",           ces:0.35, hauteur:7,  niveaux:2 },
  "UDa":  { label:"Zone UDa",                          ces:0.30, hauteur:7,  niveaux:2 },
  "UE":   { label:"Zone UE (équipements)",             ces:0.40, hauteur:9,  niveaux:3 },
  "UH":   { label:"Zone UH (habitat dense)",           ces:0.50, hauteur:12, niveaux:4 },
  "UI":   { label:"Zone UI (activités)",               ces:0.60, hauteur:10, niveaux:3 },
  "UX":   { label:"Zone UX (mixte/commerce)",          ces:0.60, hauteur:12, niveaux:4 },
  "UZ":   { label:"Zone UZ",                           ces:0.40, hauteur:9,  niveaux:3 },
  // Zones à urbaniser
  "AU":   { label:"Zone AU (à urbaniser)",             ces:0.40, hauteur:9,  niveaux:3 },
  "AUa":  { label:"Zone AUa",                          ces:0.45, hauteur:9,  niveaux:3 },
  "AUb":  { label:"Zone AUb",                          ces:0.35, hauteur:7,  niveaux:2 },
  "1AU":  { label:"Zone 1AU",                          ces:0.40, hauteur:9,  niveaux:3 },
  "2AU":  { label:"Zone 2AU (urbanisation future)",    ces:0.30, hauteur:7,  niveaux:2 },
  // Zones non constructibles
  "A":    { label:"Zone agricole",                     ces:0,    hauteur:0,  niveaux:0 },
  "N":    { label:"Zone naturelle",                    ces:0,    hauteur:0,  niveaux:0 },
  "Na":   { label:"Zone Na",                           ces:0,    hauteur:0,  niveaux:0 },
  "Nb":   { label:"Zone Nb",                           ces:0,    hauteur:0,  niveaux:0 },
  "Np":   { label:"Zone naturelle protégée",           ces:0,    hauteur:0,  niveaux:0 },
  // Fallback
  "_fallback": { label:"Zone non identifiée",         ces:0.35, hauteur:9,  niveaux:3 }
};

// ─── Résolution code GPU → clé ZONES_PLU ─────────────────────────────────────
function resolveZone(code) {
  if (!code) return "_fallback";
  const c = code.trim();
  // Match exact
  if (ZONES_PLU[c]) return c;
  // Sans caractères spéciaux (ex: "U1a*" → "U1a")
  const clean = c.replace(/[^A-Za-z0-9]/g, "");
  if (ZONES_PLU[clean]) return clean;
  // Préfixe 3 chars (ex: "UCa" → "UC")
  if (ZONES_PLU[clean.substring(0, 3)]) return clean.substring(0, 3);
  // Préfixe 2 chars
  if (ZONES_PLU[clean.substring(0, 2)]) return clean.substring(0, 2);
  // Majuscule 2 chars
  const up2 = clean.substring(0, 2).toUpperCase();
  if (ZONES_PLU[up2]) return up2;
  return "_fallback";
}

// ─── Calcul bilan promoteur ───────────────────────────────────────────────────
// 1. CES × surface_terrain = surface_au_sol
// 2. surface_au_sol × (hauteur_acrotere / 2.80) = SHAB brute
// 3. SHAB_brute × 0.85 = SHAB nette vendable
// 4. SHAB_nette × prix_marche = CA promoteur
// 5. CA × 0.22 = Charge foncière
// 6. low = CF × 0.85 / high = low × 1.35
function calculBilan(surfaceTerrain, zoneKey, prixMarche) {
  const zone = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];

  if (zone.ces === 0) {
    return {
      constructible: false,
      zone_label: zone.label,
      zone_key: zoneKey,
      raison: "Zone non constructible pour le logement"
    };
  }

  const H_ETAGE = 2.80; // hauteur libre standard par niveau

  const surface_au_sol  = Math.round(surfaceTerrain * zone.ces);
  const nb_niveaux      = Math.floor(zone.hauteur / H_ETAGE);
  const shab_brute      = Math.round(surface_au_sol * nb_niveaux);
  const shab_nette      = Math.round(shab_brute * 0.85);
  const ca              = Math.round(shab_nette * prixMarche);
  const cf              = Math.round(ca * 0.22);
  const val_low         = Math.round(cf * 0.85 / 1000) * 1000;
  const val_high        = Math.round(val_low * 1.35 / 1000) * 1000;

  return {
    constructible: true,
    zone_label: zone.label,
    zone_key: zoneKey,
    parametres: {
      ces: zone.ces,
      hauteur_acrotere: zone.hauteur,
      nb_niveaux_calcules: nb_niveaux,
      h_etage: H_ETAGE,
      coeff_parties_communes: 0.85,
      taux_charge_fonciere: 0.22
    },
    calcul: {
      surface_terrain: Math.round(surfaceTerrain),
      surface_au_sol,
      shab_brute,
      shab_nette,
      prix_marche_m2: Math.round(prixMarche),
      ca_promoteur: ca,
      charge_fonciere: cf
    },
    valeur_terrain: {
      low: val_low,
      high: val_high,
      low_m2: surfaceTerrain > 0 ? Math.round(val_low / surfaceTerrain) : 0,
      high_m2: surfaceTerrain > 0 ? Math.round(val_high / surfaceTerrain) : 0
    }
  };
}

// ─── Fetch helper avec timeout ────────────────────────────────────────────────
async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

// ─── API GPU apicarto.ign.fr ──────────────────────────────────────────────────
// Doc : https://apicarto.ign.fr/api/doc/gpu
// Endpoint zone-urba : renvoie les zonages PLU/POS/CC intersectant un point
async function getZonePLU(lat, lon) {
  const geom = encodeURIComponent(JSON.stringify({
    type: "Point",
    coordinates: [lon, lat]
  }));
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;

  const props = data.features[0].properties;
  // Le champ libelle contient le code zone (ex: "UA", "UB", "N"...)
  // libelong = libellé long, typezone = type générique
  return {
    code: props.libelle || props.typezone || null,
    libelle_long: props.libelong || null,
    partition: props.partition || null, // identifiant du PLU source
    gpu_source: true
  };
}

// ─── API DVF etalab ───────────────────────────────────────────────────────────
// Utilise l'API DVF officielle d'etalab (geoportail-urbanisme / data.gouv)
// Fallback département si DVF+ insuffisant
async function getPrixMarche(lat, lon, codeCommune) {
  // ── Source 1 : API Pappers Immobilier (prix m² officiel par commune) ───────
  // Pappers agrège les DVF DGFiP par commune — même source que Meilleurs Agents
  // Token public visible dans toutes les pages Pappers Immobilier
  if (codeCommune) {
    const url = `https://api-immobilier.pappers.fr/v1/commune/${codeCommune}`;
    const data = await fetchJson(url, {
      headers: { "Authorization": "Bearer 423daecc878d51b79f0df6bce6c20341eb5db2fcb39f1d2a" }
    });
    if (data && data.prix_m2 && data.prix_m2 > 800) {
      // prix_m2 = prix médian toutes transactions (maisons + appartements)
      // +15% pour prix neuf RE2020
      const prixNeuf = Math.round(data.prix_m2 * 1.15);
      return {
        prix: prixNeuf,
        prix_ancien: data.prix_m2,
        coeff_neuf: 1.15,
        nb_transactions: data.nombre_transactions_5_ans || null,
        source: `Pappers (DVF DGFiP commune ${codeCommune}) × 1.15 neuf`,
        type: "logements"
      };
    }
  }

  // ── Source 2 : API DVF+ Cerema (fallback) ────────────────────────────────
  if (codeCommune) {
    const url = `https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${codeCommune}&ordering=-date_mutation&limit=200`;
    const data = await fetchJson(url);
    if (data && (data.results || data.features)) {
      const items = data.results || data.features || [];
      const result = filtrerEtCalculer(items, `DVF+ Cerema commune ${codeCommune}`);
      if (result) return result;
    }
  }

  return null;
}

// Filtre strict logements + calcul prix neuf (utilisé uniquement par le fallback Cerema)
function filtrerEtCalculer(items, source) {
  if (!items || !items.length) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);

  const logements = items.filter(r => {
    const type = r.libtypbien || r.type_local || "";
    const surf = parseFloat(r.sbati || r.surface_reelle_bati || 0);
    const val  = parseFloat(r.valeurfonc || r.valeur_fonciere || 0);
    const date = new Date(r.date_mutation || r.datemut || "2000-01-01");
    const isLogement = /maison|appartement/i.test(type) ||
                       type === "Maison" || type === "Appartement";
    return isLogement && surf > 30 && val > 20000 && val < 8000000 && date > cutoff;
  });

  if (logements.length < 3) return null;

  const prixM2 = logements
    .map(r => parseFloat(r.valeurfonc || r.valeur_fonciere || 0) / parseFloat(r.sbati || r.surface_reelle_bati || 1))
    .filter(p => p >= 1200 && p <= 20000);

  if (prixM2.length < 3) return null;

  const sorted = prixM2.slice().sort((a, b) => a - b);
  const trim   = Math.max(1, Math.floor(sorted.length * 0.10));
  const trimmed = sorted.slice(trim, sorted.length - trim);
  const moyenne = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
  const prixNeuf = Math.round(moyenne * 1.15);

  return {
    prix: prixNeuf,
    prix_ancien: moyenne,
    coeff_neuf: 1.15,
    nb_transactions: prixM2.length,
    source: `DVF+ Cerema ${prixM2.length} transactions (${source}) × 1.15 neuf`,
    type: "logements"
  };
}

// ─── Fallback prix par département (médiane DVF 2023-2024) ───────────────────
const PRIX_DEPT = {
  "75":3300,"92":5800,"93":3800,"94":4800,          // Paris + PC
  "77":2800,"78":3400,"91":2700,"95":2900,           // GC IDF
  "06":4200,"13":2900,"69":3600,"31":2900,"33":3400, // grandes métropoles
  "34":2800,"38":2800,"44":3100,"59":2400,"67":3000, // autres métropoles
  "76":2400,"57":2100,"63":2000,"35":3000,"29":2300, // villes moyennes
  "04":2300,"05":2200,"48":1600,"15":1400,"23":1100, // rural/montagne (DVF 2024)
  "83":3400,"84":2700,"30":2300,"66":2200,"11":1900, // Sud-Méditerranée
  "971":2600,"972":2600,"973":1900,"974":2300,        // DOM
};

function getPrixFallback(dep) {
  if (!dep) return 2200;
  return PRIX_DEPT[dep] || PRIX_DEPT[dep.substring(0, 2)] || 2200;
}

// ─── API Cadastre apicarto ────────────────────────────────────────────────────
async function getSurface(lat, lon) {
  const geom = encodeURIComponent(JSON.stringify({
    type: "Point",
    coordinates: [lon, lat]
  }));
  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;
  const props = data.features[0].properties;
  return {
    surface: props.contenance ? Math.round(props.contenance) : null,
    section: props.section,
    numero: props.numero,
    commune: props.nom_com || props.commune || props.nomcom,
    // Apicarto retourne dep_abs (ex:"04") + com_abs (ex:"152")
    // ou code_dep + code_com selon la version
    code_commune: props.code_dep && props.com_abs
      ? (props.code_dep + props.com_abs).padStart(5, '0')
      : props.code_com || props.codecomm || props.code_commune || null
  };
}

// ─── API BAN — géocodage adresse ──────────────────────────────────────────────
async function geocodeAdresse(adresse) {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;
  const p = data.features[0].properties;
  const [lon, lat] = data.features[0].geometry.coordinates;
  return {
    lat, lon,
    label: p.label,
    postcode: p.postcode,
    city: p.city,
    dep: (p.postcode || "").substring(0, 2)
  };
}

// ─── Handler principal ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  let { lat, lon, surface, adresse, insee } = req.query;

  // Géocodage si coords manquantes
  if ((!lat || !lon) && adresse) {
    const geo = await geocodeAdresse(adresse);
    if (!geo) return res.status(400).json({ error: "Adresse non trouvée" });
    lat = geo.lat; lon = geo.lon;
  }

  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);
  if (isNaN(latF) || isNaN(lonF)) {
    return res.status(400).json({ error: "Coordonnées invalides" });
  }

  try {
    // ── Appels parallèles ──
    const [zoneResult, cadastreResult] = await Promise.all([
      getZonePLU(latF, lonF),
      getSurface(latF, lonF)
    ]);
    // DVF après cadastre pour avoir le code commune
    // Priorité: 1) insee BAN (passé par le frontend), 2) code cadastre, 3) null
    const codeCommune = insee || (cadastreResult && cadastreResult.code_commune) || null;
    const dvfResult = await getPrixMarche(latF, lonF, codeCommune);

    // ── Surface terrain ──
    let surfaceTerrain = parseFloat(surface) || 0;
    if (!surfaceTerrain && cadastreResult && cadastreResult.surface) {
      surfaceTerrain = cadastreResult.surface;
    }
    if (!surfaceTerrain) surfaceTerrain = 500; // fallback ultime

    // ── Zone PLU ──
    const codeZone = zoneResult ? zoneResult.code : null;
    const zoneKey = resolveZone(codeZone);
    const zoneInfo = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];

    // ── Prix marché ──
    const dep = cadastreResult && cadastreResult.code_commune
      ? cadastreResult.code_commune.substring(0, 2)
      : "00";

    let prixMarche, dvfDetail;
    if (dvfResult && dvfResult.prix > 0) {
      prixMarche = dvfResult.prix;
      dvfDetail = dvfResult;
    } else {
      prixMarche = getPrixFallback(dep);
      dvfDetail = { prix: prixMarche, source: `Fallback département ${dep}`, nb_transactions: 0, rayon_m: null };
    }

    // ── Bilan promoteur ──
    const bilan = calculBilan(surfaceTerrain, zoneKey, prixMarche);

    // ── Réponse ──
    return res.status(200).json({
      ok: true,
      coords: { lat: latF, lon: lonF },
      surface_terrain: Math.round(surfaceTerrain),
      cadastre: cadastreResult,
      zone_plu: {
        code: codeZone || "non identifiée",
        libelle: zoneInfo.label,
        libelle_long: zoneResult ? zoneResult.libelle_long : null,
        key: zoneKey,
        source: zoneResult ? "GPU IGN apicarto" : "fallback"
      },
      prix_marche_m2: prixMarche,
      dvf: dvfDetail,
      bilan,
      // Détail complet pour email admin
      _admin: {
        etapes: [
          `1. Zone PLU : ${codeZone || "non identifiée"} → ${zoneInfo.label}`,
          `   Source : ${zoneResult ? "GPU IGN apicarto.ign.fr" : "Fallback (GPU indisponible)"}`,
          `2. CES (emprise au sol max) : ${(zoneInfo.ces * 100).toFixed(0)}%`,
          `3. Surface terrain : ${Math.round(surfaceTerrain)} m²`,
          `4. Surface au sol = ${Math.round(surfaceTerrain)} × ${zoneInfo.ces} = ${Math.round(surfaceTerrain * zoneInfo.ces)} m²`,
          `5. Hauteur acrotère PLU : ${zoneInfo.hauteur} m → ${Math.floor(zoneInfo.hauteur / 2.80)} niveaux (h/2.80m)`,
          `6. SHAB brute = ${Math.round(surfaceTerrain * zoneInfo.ces)} × ${Math.floor(zoneInfo.hauteur / 2.80)} = ${bilan.calcul ? bilan.calcul.shab_brute : 0} m²`,
          `7. SHAB nette (×0.85, déduction parties communes) = ${bilan.calcul ? bilan.calcul.shab_nette : 0} m²`,
          `8. Prix neuf : ${prixMarche} €/m² (moyenne DVF ${dvfDetail.prix_ancien || prixMarche} €/m² × 1.15 neuf) — ${dvfDetail.source}`,
          `9. CA promoteur = ${bilan.calcul ? bilan.calcul.shab_nette : 0} × ${prixMarche} = ${bilan.calcul ? bilan.calcul.ca_promoteur.toLocaleString("fr-FR") : 0} €`,
          `10. Charge foncière (22%) = ${bilan.calcul ? bilan.calcul.charge_fonciere.toLocaleString("fr-FR") : 0} €`,
          `11. Low = CF × 0.85 = ${bilan.valeur_terrain ? bilan.valeur_terrain.low.toLocaleString("fr-FR") : 0} €`,
          `12. High = low × 1.35 = ${bilan.valeur_terrain ? bilan.valeur_terrain.high.toLocaleString("fr-FR") : 0} €`
        ]
      }
    });

  } catch (err) {
    console.error("[plu.js] Erreur:", err);
    return res.status(500).json({ error: "Erreur serveur", detail: err.message });
  }
};
