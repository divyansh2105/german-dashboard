export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Support Upstash Redis via Cloudflare Pages environment variables
  const redisUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return new Response(
      JSON.stringify({ 
        error: 'Database environment variables are missing on Cloudflare Pages. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your Pages project settings.' 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const type = url.searchParams.get('type');

  if (!code || code.trim().length < 3) {
    return new Response(
      JSON.stringify({ error: 'Sync code must be at least 3 characters long.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const syncType = (type || 'mylist').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const key = `${syncType}:${cleanCode}`;

  try {
    if (request.method === 'GET') {
      const res = await fetch(`${redisUrl}/get/${key}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      let list = [];
      if (data.result) {
        try {
          list = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          if (typeof list === 'string') {
            list = JSON.parse(list); // Handle double-stringified cases
          }
        } catch (e) {
          console.error("JSON parse error of Upstash result:", e);
        }
      }

      if (!Array.isArray(list)) {
        list = [];
      }
      return new Response(JSON.stringify(list), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (request.method === 'POST') {
      let list = null;
      try {
        list = await request.json();
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Body must be valid JSON.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch (e) {
          return new Response(
            JSON.stringify({ error: 'Body must be valid JSON array.' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }
      }

      if (!Array.isArray(list)) {
        return new Response(
          JSON.stringify({ error: 'Body must be a JSON array.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
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

      return new Response(
        JSON.stringify({ success: true, count: list.length }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error("Sync Route Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal database sync error.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}
