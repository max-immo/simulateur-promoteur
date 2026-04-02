export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { adresse } = req.query;
  if (!adresse) return res.status(400).json({ error: 'adresse manquante' });

  try {
    // 1. Géocodage
    const geoRes = await fetch(
      'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1'
    );
    const geoData = await geoRes.json();
    if (!geoData.features?.length) return res.status(404).json({ error: 'Adresse introuvable' });

    const [lon, lat] = geoData.features[0].geometry.coordinates;
    const insee = geoData.features[0].properties.citycode;
    const label = geoData.features[0].properties.label;

    // 2. Zone PLU
    const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
    const pluRes = await fetch(
      'https://apicarto.ign.fr/api/gpu/zone-urba?geom=' + encodeURIComponent(geom)
    );
    const pluData = await pluRes.json();

    const zone = pluData.features?.[0]?.properties || null;

    res.status(200).json({ lat, lon, insee, label, zone });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
