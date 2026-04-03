const PRIX_FALLBACK = {
  '75': { maison: 10500, appartement: 10500 },
  '92': { maison: 6500, appartement: 6500 },
  '93': { maison: 4800, appartement: 4500 },
  '94': { maison: 5500, appartement: 5200 },
  '77': { maison: 3400, appartement: 3200 },
  '78': { maison: 3800, appartement: 3600 },
  '91': { maison: 3200, appartement: 3000 },
  '95': { maison: 3400, appartement: 3200 },
  '95051': { maison: 3400, appartement: 3200 },
  'default': { maison: 3000, appartement: 2800 }
};

function getPrixFallback(insee) {
  if (PRIX_FALLBACK[insee]) return PRIX_FALLBACK[insee];
  const dept = (insee || '').substring(0, 2);
  return PRIX_FALLBACK[dept] || PRIX_FALLBACK['default'];
}

function checkLLS(insee) {
  const dept = (insee || '').substring(0, 2);
  const isSRU = ['75','92','93','94','95','78','91','77'].includes(dept);
  return { obligatoire: isSRU, taux: 0.25 };
}

function interpretSUP(features) {
  if (!features || !features.length) return [];
  return features.slice(0, 5).map(f => {
    const p = f.properties || {};
    const code = p.typesup || p.libelle || 'SUP';
    const impact =
      code === 'I1' ? 'FORT - Canalisation gaz : reculs imposés' :
      code === 'I3' ? 'FORT - Transport hydrocarbures : emprise réduite' :
      code === 'EL7' ? 'MOYEN - Alignement voirie' :
      code === 'PT2' ? 'MOYEN - Réseau électrique' : 'A vérifier';
    return { code, libelle: p.libelong || p.libelle || 'Servitude détectée', impact };
  });
}

async function getPrixDVF(insee) {
  try {
    const url = `http://api.cquest.org/dvf?code_commune=${insee}&nature_mutation=Vente`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const mutations = data.features || data.results || [];

    const median = arr => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    const prixM2 = (type) => mutations
      .filter(m => {
        const p = m.properties || m;
        return p.type_local === type
          && parseFloat(p.surface_reelle_bati) > 15
          && parseFloat(p.valeur_fonciere) > 0;
      })
      .map(m => {
        const p = m.properties || m;
        return parseFloat(p.valeur_fonciere) / parseFloat(p.surface_reelle_bati);
      })
      .filter(v => v > 500 && v < 25000);

    const maisons = prixM2('Maison');
    const apparts = prixM2('Appartement');
    const fb = getPrixFallback(insee);

    return {
      maison: Math.round(median(maisons) || fb.maison),
      appartement: Math.round(median(apparts) || fb.appartement),
      nb_maisons: maisons.length,
      nb_apparts: apparts.length,
      source: maisons.length + apparts.length > 0 ? 'DVF réel' : 'Estimation'
    };
  } catch (e) {
    const fb = getPrixFallback(insee);
    return { ...fb, nb_maisons: 0, nb_apparts: 0, source: 'Estimation' };
  }
}

async function getSurfaceCadastre(lon, lat) {
  try {
    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
    const res = await fetch(
      `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    if (!data.features || !data.features.length) return null;

    const props = data.features[0].properties;
    const geomParc = data.features[0].geometry;

    // contenance en m² (champ 'contenance' en centiares = m²)
    const contenance = props.contenance || null;
    const section = props.section || null;
    const numero = props.numero || null;
    const commune = props.commune || null;
    const prefixe = props.prefixe || '000';
    const ref = `${commune}${prefixe}${section}${numero}`;

    return {
      surface: contenance ? Math.round(contenance) : null,
      section,
      numero,
      commune,
      ref_cadastrale: ref,
      geometrie: geomParc
    };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { adresse, lat: latParam, lon: lonParam } = req.query;
  if (!adresse && (!latParam || !lonParam)) {
    return res.status(400).json({ error: 'adresse ou coordonnées manquantes' });
  }

  try {
    let lat, lon, insee, label;

    if (latParam && lonParam) {
      lat = parseFloat(latParam);
      lon = parseFloat(lonParam);
      // géocodage inverse pour avoir l'insee
      const revRes = await fetch(
        `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`
      );
      const revData = await revRes.json();
      if (revData.features?.length) {
        insee = revData.features[0].properties.citycode;
        label = revData.features[0].properties.label;
      }
    } else {
      const geoRes = await fetch(
        'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1'
      );
      const geoData = await geoRes.json();
      if (!geoData.features?.length) return res.status(404).json({ error: 'Adresse introuvable' });
      [lon, lat] = geoData.features[0].geometry.coordinates;
      insee = geoData.features[0].properties.citycode;
      label = geoData.features[0].properties.label;
    }

    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));

    const [pluData, supData, dvf, cadastre] = await Promise.all([
      fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`).then(r => r.json()).catch(() => null),
      fetch(`https://apicarto.ign.fr/api/gpu/info-surf?geom=${geom}`).then(r => r.json()).catch(() => null),
      getPrixDVF(insee),
      getSurfaceCadastre(lon, lat)
    ]);

    const zone = pluData?.features?.[0]?.properties || null;
    const sups = interpretSUP(supData?.features);
    const lls = checkLLS(insee);

    const flagsAdmin = [];
    if (sups.some(s => s.impact.startsWith('FORT'))) flagsAdmin.push('ALERTE SUP - Emprise constructible réduite');
    if (lls.obligatoire) flagsAdmin.push(`QUOTA LLS ${Math.round(lls.taux * 100)}% - Impact CA`);
    if (zone?.libelle?.toUpperCase().startsWith('N') || zone?.libelle?.toUpperCase() === 'A') flagsAdmin.push('ZONE NON CONSTRUCTIBLE');
    if (zone?.libelle?.toUpperCase().startsWith('AU')) flagsAdmin.push('ZONE AU - Vérifier OAP');

    const score = flagsAdmin.some(f => f.includes('NON CONSTRUCTIBLE')) ? 'ROUGE'
      : flagsAdmin.length > 0 ? 'ORANGE' : 'VERT';

    res.status(200).json({
      label, lat, lon, insee,
      zone,
      sups,
      dvf,
      lls,
      cadastre,
      flagsAdmin,
      scoreAdmin: score
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
