// api/sheet.js — EstimationTerrain.fr
// Proxy Vercel → Google Apps Script (workaround CORS)
// CommonJS, Node.js serverless
//
// ── Architecture ──────────────────────────────────────────────────────────
// Le frontend POST ce endpoint /api/sheet
// Ce handler fait lui-même la requête vers l'Apps Script (pas de CORS car
// c'est du server-side). L'Apps Script append la ligne dans le Google Sheet.
//
// ── Déploiement Apps Script (à faire une fois) ───────────────────────────
// 1. Ouvrir https://script.google.com
// 2. Nouveau projet → coller le code ci-dessous dans doPost()
// 3. Déployer → Nouvelle déploiement → Application Web
//    - Exécuter en tant que : Moi
//    - Accès : Tout le monde (même anonymes)
// 4. Copier l'URL de déploiement dans APPS_SCRIPT_URL ci-dessous
//
// ── Code Apps Script à déployer ──────────────────────────────────────────
// function doPost(e) {
//   var data = JSON.parse(e.postData.contents);
//   var ss = SpreadsheetApp.openById("1syIfFxhrRKNg20R8rAqY6Me2cKNmv54-FQZumPHVmPE");
//   var sheet = ss.getSheets()[0];
//   var row = [
//     new Date(),
//     data.nom || "", data.tel || "", data.email || "",
//     data.adresse || "", data.surface || "", data.zone_plu || "",
//     data.val_low || "", data.val_high || "",
//     data.prix_marche || "", data.shab_nette || ""
//   ];
//   sheet.appendRow(row);
//   return ContentService
//     .createTextOutput(JSON.stringify({ok:true}))
//     .setMimeType(ContentService.MimeType.JSON);
// }
// ─────────────────────────────────────────────────────────────────────────

// ⚠️  REMPLACER par l'URL de votre déploiement Apps Script
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

// Timeout fetch (ms)
const FETCH_TIMEOUT = 8000;

module.exports = async function handler(req, res) {
  // CORS — autoriser estimationterrain.fr et Vercel preview
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validation payload minimal
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Corps JSON attendu" });
  }

  // Champs requis minimum
  if (!body.adresse && !body.email) {
    return res.status(400).json({ error: "Données insuffisantes" });
  }

  // Honeypot anti-bot (champ 'website' doit être vide)
  if (body.website) {
    // Bot détecté — répondre 200 pour ne pas alerter
    return res.status(200).json({ ok: true, bot: true });
  }

  // Si pas d'URL Apps Script configurée → log console uniquement (dev mode)
  if (!APPS_SCRIPT_URL) {
    console.log("[sheet.js] APPS_SCRIPT_URL non configuré — lead reçu:", JSON.stringify({
      adresse: body.adresse,
      nom: body.nom,
      email: body.email,
      surface: body.surface
    }));
    return res.status(200).json({ ok: true, mode: "dev_no_sheet" });
  }

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      redirect: "follow", // Apps Script fait une redirection 302
      body: JSON.stringify({
        nom: body.nom || "",
        tel: body.tel || "",
        email: body.email || "",
        adresse: body.adresse || "",
        surface: body.surface || "",
        zone_plu: body.zone_plu || "",
        val_low: body.val_low || "",
        val_high: body.val_high || "",
        prix_marche: body.prix_marche || "",
        shab_nette: body.shab_nette || "",
        source: body.source || "simulateur",
        ts: new Date().toISOString()
      })
    });

    clearTimeout(tid);

    // Apps Script répond souvent en texte même si on demande JSON
    const text = await response.text();
    let parsed = { ok: false };
    try { parsed = JSON.parse(text); } catch { parsed = { ok: true, raw: text }; }

    if (!response.ok) {
      console.error("[sheet.js] Apps Script error:", response.status, text);
      return res.status(200).json({ ok: false, error: "Apps Script a retourné une erreur" });
    }

    return res.status(200).json({ ok: true, result: parsed });

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[sheet.js] Timeout Apps Script");
      return res.status(200).json({ ok: false, error: "Timeout Apps Script" });
    }
    console.error("[sheet.js] Erreur:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
