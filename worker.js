// Cloudflare Worker - CORS Proxy for bitjita.com
// Deploy: Cloudflare Dashboard > Workers > Create > Quick Edit > Paste this code

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Get the path after /proxy/
    const path = url.pathname.replace('/proxy/', '');
    const targetUrl = `https://bitjita.com/${path}${url.search}`;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'BitcraftInventoryViewer/1.0',
        },
      });

      const data = await response.text();

      return new Response(data, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
}
