const GSHEET = 'https://script.google.com/macros/s/AKfycbwV6VwnASLRAPqiDRdtGN4Y5AndwI5UBr1k4kMP4yebvaUWNBTLENNiNThs3TmSG7lh/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let data = req.body;
    if (!data) return res.status(400).json({ error: 'Empty body' });
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    console.log('Sending to GSheet:', body);
    const r = await fetch(GSHEET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const text = await r.text();
    console.log('GSheet response:', text);
    res.status(200).json({ ok: true, response: text });
  } catch (e) {
    console.error('Sheet error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
