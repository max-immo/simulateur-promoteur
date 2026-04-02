const PRIX_FALLBACK = {
  '95051': { maison: 3400, appartement: 3200 },
  'default': { maison: 3000, appartement: 2800 }
};

function getPrixFallback(insee) {
  return PRIX_FALLBACK[insee] || PRIX_FALLBACK['default'];
}

function checkLLS(insee, zoneLibelle) {
  const dept = (insee || '').substring(0, 2);
  const isSRU = ['92','93','94','75','95','78','91','77'].includes(dept);
  const zoneUA = zoneLibelle && zoneLibelle.toUpperCase().startsWith('UA');
  return { obligatoire: isSRU, taux: zoneUA ? 0.45 : 0.25 };
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
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
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
      source: maisons.length + apparts.length > 0 ? 'DVF réel' : 'Estimation fallback'
    };
  } catch (e) {
    return { ...getPrixFallback(insee), nb_maisons: 0, nb_apparts: 0, source: 'Estimation fallback' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { adresse } = req.query;
  if (!adresse) return res.status(400).json({ error: 'adresse manquante' });

  try {
    const geoRes = await fetch(
      'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1'
    );
    const geoData = await geoRes.json();
    if (!geoData.features?.length) return res.status(404).json({ error: 'Adresse introuvable' });

    const [lon, lat] = geoData.features[0].geometry.coordinates;
    const insee = geoData.features[0].properties.citycode;
    const label = geoData.features[0].properties.label;
    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));

    const [pluRes, supRes, dvf] = await Promise.all([
      fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`).then(r => r.json()).catch(() => null),
      fetch(`https://apicarto.ign.fr/api/gpu/info-surf?geom=${geom}`).then(r => r.json()).catch(() => null),
      getPrixDVF(insee)
    ]);

    const zone = pluRes?.features?.[0]?.properties || null;
    const sups = interpretSUP(supRes?.features);
    const lls = checkLLS(insee, zone?.libelle);

    const flagsAdmin = [];
    if (sups.some(s => s.impact.startsWith('FORT'))) flagsAdmin.push('ALERTE SUP GAZ - Emprise constructible réduite');
    if (lls.obligatoire) flagsAdmin.push(`QUOTA LLS ${Math.round(lls.taux * 100)}% - Impact CA promoteur`);
    if (zone?.libelle?.toUpperCase().startsWith('A') || zone?.libelle?.toUpperCase().startsWith('N')) flagsAdmin.push('ZONE NON CONSTRUCTIBLE - Rejeter le lead');
    if (zone?.libelle?.toUpperCase().startsWith('AU')) flagsAdmin.push('ZONE AU - Verifier OAP');

    const score = flagsAdmin.some(f => f.includes('NON CONSTRUCTIBLE')) ? 'ROUGE'
      : flagsAdmin.length > 0 ? 'ORANGE' : 'VERT';

    res.status(200).json({ label, lat, lon, insee, zone, sups, dvf, lls, flagsAdmin, scoreAdmin: score });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
