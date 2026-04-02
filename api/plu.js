const PRIX_FALLBACK = {
  '95051': { maison: 3400, appartement: 3200 },
  default: { maison: 3000, appartement: 2800 }
};

const SRU_COMMUNES = ['95051','92','93','94'];

function getPrixFallback(insee) {
  return PRIX_FALLBACK[insee] || PRIX_FALLBACK['default'];
}

function checkLLS(insee, zone) {
  const dept = insee.substring(0,2);
  const isSRU = ['92','93','94','75','95','78','91','77'].includes(dept);
  const zoneUA = zone && (zone.startsWith('UA') || zone === 'UA');
  return { obligatoire: isSRU, taux: zoneUA ? 0.45 : 0.25 };
}

function interpretSUP(features) {
  if (!features || !features.length) return [];
  return features.map(f => {
    const p = f.properties || {};
    return {
      code: p.typesup || p.libelle || 'SUP',
      libelle: p.libelong || p.libelle || 'Servitude détectée',
      impact: p.typesup === 'I1' || p.typesup === 'I3' ? 'FORT - Canalisation gaz : reculs imposés, emprise réduite' :
              p.typesup === 'EL7' ? 'MOYEN - Alignement voirie' :
              p.typesup === 'PT2' ? 'MOYEN - Réseau électrique' : 'À vérifier'
    };
  });
}

async function getPrixDVF(insee, lat, lon) {
  try {
    const url = `http://api.cquest.org/dvf?code_commune=${insee}&nature_mutation=Vente`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const mutations = data.features || data.results || [];

    const maisons = mutations.filter(m => {
      const p = m.properties || m;
      return p.type_local === 'Maison' && p.surface_reelle_bati > 20 && p.valeur_fonciere > 0;
    }).map(m => {
      const p = m.properties || m;
      return parseFloat(p.valeur_fonciere) / parseFloat(p.surface_reelle_bati);
    }).filter(v => v > 500 && v < 20000);

    const apparts = mutations.filter(m => {
      const p = m.properties || m;
      return p.type_local === 'Appartement' && p.surface_reelle_bati > 15 && p.valeur_fonciere > 0;
    }).map(m => {
      const p = m.properties || m;
      return parseFloat(p.valeur_fonciere) / parseFloat(p.surface_reelle_bati);
    }).filter(v => v > 500 && v < 20000);

    const median = arr => {
      if (!arr.length) return null;
      const s = [...arr].sort((a,b) => a-b);
      const m = Math.floor(s.length/2);
      return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
    };

    const fb = getPrixFallback(insee);
    return {
      maison: Math.round(median(maisons) || fb.maison),
      appartement: Math.round(median(apparts) || fb.appartement),
      nb_maisons: maisons.length,
      nb_apparts: apparts.length,
      source: maisons.length + apparts.length > 0 ? 'DVF réel' : 'Estimation fallback'
    };
  } catch(e) {
    return { ...getPrixFallback(insee), nb_maisons: 0, nb_apparts: 0, source: 'Estimation fallback' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { adresse, dept, section, parcelle } = req.query;
  if (!adresse && !parcelle) return res.status(400).json({ error: 'adresse ou parcelle manquante' });

  try {
    let lat, lon, insee, label;

    if (adresse) {
      const geoRes = await fetch(
        'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1'
      );
      const geoData = await geoRes.json();
      if (!geoData.features?.length) return res.status(404).json({ error: 'Adresse introuvable' });
      [lon, lat] = geoData.features[0].geometry.coordinates;
      insee = geoData.features[0].properties.citycode;
      label = geoData.features[0].properties.label;
    }

    if (dept && section && parcelle) {
      label = label || `Parcelle ${dept}-${section}-${parcelle}`;
    }

    const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
    const encoded = encodeURIComponent(geom);

    const [pluRes, supRes, dvfData] = await Promise.allSettled([
      fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encoded}`),
      fetch(`https://apicarto.ign.fr/api/gpu/info-surf?geom=${encoded}`),
      getPrixDVF(insee, lat, lon)
    ]);

    const pluData = pluRes.status === 'fulfilled' ? await pluRes.value.json() : null;
    const supData = supRes.status === 'fulfilled' ? await supRes.value.json() : null;
    const dvf = dvfRes?.value || dvfData.value || (dvfData.status === 'fulfilled' ? dvfData.value : getPrixFallback(insee));

    const zone = pluData?.features?.[0]?.properties || null;
    const sups = interpretSUP(supData?.features);
    const lls = zone ? checkLLS(insee, zone.libelle) : { obligatoire: false, taux: 0.25 };

    const flagsAdmin = [];
    if (sups.some(s => s.impact.startsWith('FORT'))) flagsAdmin.push('ALERTE SUP GAZ - Emprise constructible réduite');
    if (lls.obligatoire) flagsAdmin.push(`QUOTA LLS ${Math.round(lls.taux*100)}% obligatoire - Impact CA promoteur`);
    if (zone?.libelle?.startsWith('A') || zone?.libelle?.startsWith('N')) flagsAdmin.push('ZONE NON CONSTRUCTIBLE - Rejeter le lead');
    if (zone?.libelle?.startsWith('AU')) flagsAdmin.push('ZONE AU - Constructibilité conditionnelle, vérifier OAP');

    res.status(200).json({
      label,
      lat, lon, insee,
      zone,
      sups,
      dvf,
      lls,
      flagsAdmin,
      scoreAdmin: flagsAdmin.length === 0 ? 'VERT' : flagsAdmin.some(f => f.includes('NON CONSTRUCTIBLE')) ? 'ROUGE' : 'ORANGE'
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
