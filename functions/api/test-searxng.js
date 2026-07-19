// Debug endpoint: /api/test-searxng
// Tests connectivity from Cloudflare Workers to self-hosted SearXNG

export async function onRequest(context) {
  const { env } = context;
  const searxngUrl = (env.SEARXNG_URL || 'http://159.75.77.238:8888').replace(/\/+$/, '');
  const testUrl = searxngUrl + '/search?q=test&format=json&categories=general&language=en&pageno=1';

  const debug = {
    searxngUrl: searxngUrl,
    testUrl: testUrl,
    steps: []
  };

  try {
    debug.steps.push('Fetching SearXNG...');
    const resp = await fetch(testUrl, {
      headers: { 'Accept': 'application/json' }
    });
    debug.steps.push(`Response status: ${resp.status} ${resp.statusText}`);
    debug.steps.push(`Response headers: ${JSON.stringify(Object.fromEntries(resp.headers.entries()))}`);

    if (!resp.ok) {
      const text = await resp.text();
      debug.steps.push(`Response body (first 500 chars): ${text.slice(0, 500)}`);
      return new Response(JSON.stringify(debug, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const j = await resp.json();
    debug.resultsCount = (j.results || []).length;
    debug.firstResult = j.results && j.results[0] ? {
      title: j.results[0].title,
      url: j.results[0].url,
      engine: j.results[0].engine
    } : null;
    debug.steps.push(`Success! Got ${debug.resultsCount} results`);

    return new Response(JSON.stringify(debug, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (e) {
    debug.steps.push(`ERROR: ${String(e)}`);
    debug.steps.push(`Error type: ${e.constructor.name}`);
    if (e.cause) debug.steps.push(`Cause: ${String(e.cause)}`);
    return new Response(JSON.stringify(debug, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
