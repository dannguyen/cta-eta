const TRAIN_API_URL = 'https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const ALLOWED_QUERY_PARAMS = ['mapid', 'max', 'rt'];

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
  const trainApiKey = String(env.TRAIN_API_KEY ?? '').trim();
  if (!trainApiKey) {
    return jsonError('Missing TRAIN_API_KEY secret.', 500);
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(TRAIN_API_URL);
  copyAllowedSearchParams(incomingUrl.searchParams, upstreamUrl.searchParams);
  upstreamUrl.searchParams.set('outputType', 'JSON');
  upstreamUrl.searchParams.set('key', trainApiKey);

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json'
      }
    });
    return withCorsHeaders(upstreamResponse);
  } catch {
    return jsonError('Failed to fetch CTA train arrivals.', 502);
  }
}
