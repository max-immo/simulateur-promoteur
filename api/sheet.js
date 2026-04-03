const GSHEET = 'https://script.google.com/macros/s/AKfycbwV6VwnASLRAPqiDRdtGN4Y5AndwI5UBr1k4kMP4yebvaUWNBTLENNiNThs3TmSG7lh/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const r = await fetch(GSHEET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const text = await r.text();
    res.status(200).json({ ok: true, response: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
