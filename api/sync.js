import { kv } from '@vercel/kv';

export default async function handler(request, response) {
  // CORS Headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const { method } = request;
  const { code } = request.query;

  if (!code || code.trim().length < 3) {
    return response.status(400).json({ error: 'Sync code must be at least 3 characters long.' });
  }

  const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `mylist:${cleanCode}`;

  try {
    if (method === 'GET') {
      const data = await kv.get(key);
      return response.status(200).json(data || []);
    }

    if (method === 'POST') {
      const list = request.body;
      if (!Array.isArray(list)) {
        return response.status(400).json({ error: 'Body must be a JSON array.' });
      }
      await kv.set(key, list);
      return response.status(200).json({ success: true, count: list.length });
    }

    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error("Vercel KV Sync Error:", error);
    return response.status(500).json({ error: 'Internal database sync error. Make sure Vercel KV is linked to the project.' });
  }
}
