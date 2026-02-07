const BUS_API_URL = 'https://www.ctabustracker.com/bustime/api/v3/getpredictions';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const ALLOWED_QUERY_PARAMS = ['stpid', 'top', 'rt', 'rtdir'];

function withCorsHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function copyAllowedSearchParams(from, to) {
  for (const param of ALLOWED_QUERY_PARAMS) {
    const values = from.getAll(param);
    for (const value of values) {
      if (value) {
        to.append(param, value);
      }
    }
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
  const busApiKey = String(env.BUS_API_KEY ?? '').trim();
  if (!busApiKey) {
    return jsonError('Missing BUS_API_KEY secret.', 500);
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(BUS_API_URL);
  copyAllowedSearchParams(incomingUrl.searchParams, upstreamUrl.searchParams);
  upstreamUrl.searchParams.set('format', 'json');
  upstreamUrl.searchParams.set('key', busApiKey);

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json'
      }
    });
    return withCorsHeaders(upstreamResponse);
  } catch {
    return jsonError('Failed to fetch CTA bus predictions.', 502);
  }
}
