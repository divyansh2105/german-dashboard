export default async function handler(request, response) {
  // CORS Headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Disable Caching for Dynamic Sync Data
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Support both standard Vercel KV and direct Upstash integrations automatically
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return response.status(500).json({ 
      error: 'Database environment variables are missing on Vercel. Please ensure Upstash is connected to your project.' 
    });
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
      const res = await fetch(`${redisUrl}/get/${key}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      // Upstash REST API returns value inside the "result" property
      const list = data.result ? JSON.parse(data.result) : [];
      return response.status(200).json(list);
    }

    if (method === 'POST') {
      let list = request.body;
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch (e) {
          return response.status(400).json({ error: 'Body must be valid JSON.' });
        }
      }
      if (!Array.isArray(list)) {
        return response.status(400).json({ error: 'Body must be a JSON array.' });
      }
      
      const res = await fetch(`${redisUrl}/set/${key}`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(list)) // Stringify the list array to store in Redis
      });
      if (!res.ok) throw new Error(await res.text());
      return response.status(200).json({ success: true, count: list.length });
    }

    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error("Sync Route Error:", error);
    return response.status(500).json({ error: error.message || 'Internal database sync error.' });
  }
}
