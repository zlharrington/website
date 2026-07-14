import baseWorker from './ticket-probe-worker.js';

const HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });

function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  return !!origin && ['https://harringtonit.com', 'https://www.harringtonit.com'].includes(origin);
}

function getNinjaBaseUrl(regionValue) {
  const region = String(regionValue ?? '').trim().toLowerCase();
  return {
    us: 'https://app.ninjarmm.com',
    us2: 'https://us2.ninjarmm.com',
    ca: 'https://ca.ninjarmm.com',
    eu: 'https://eu.ninjarmm.com',
    uk: 'https://uk.ninjarmm.com',
    au: 'https://au.ninjarmm.com',
  }[region] || null;
}

function parseTokenResponse(raw, contentType) {
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  try { return Object.fromEntries(new URLSearchParams(raw).entries()); } catch { return {}; }
}

async function getUserAccessToken(env) {
  if (!env.NINJA_CLIENT_ID || !env.NINJA_CLIENT_SECRET || !env.NINJA_REFRESH_TOKEN || !env.NINJA_REGION) {
    return { error: 'NinjaOne user credentials are incomplete.', status: 503 };
  }
  const baseUrl = getNinjaBaseUrl(env.NINJA_REGION);
  if (!baseUrl) return { error: 'NinjaOne region is invalid.', status: 400 };

  let response;
  try {
    response = await fetch(`${baseUrl}/ws/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${env.NINJA_CLIENT_ID}:${env.NINJA_CLIENT_SECRET}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.NINJA_REFRESH_TOKEN,
      }).toString(),
    });
  } catch {
    return { error: 'Could not reach NinjaOne authentication.', status: 502 };
  }

  const raw = await response.text();
  const result = parseTokenResponse(raw, response.headers.get('content-type') || '');
  if (!response.ok || !result.access_token) {
    return { error: result.error_description || result.error || `Refresh failed with status ${response.status}.`, status: 502 };
  }
  return { accessToken: result.access_token, baseUrl };
}

function collectRelevantFields(value, path = '', output = {}) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRelevantFields(item, `${path}[${index}]`, output));
    return output;
  }
  if (typeof value !== 'object') return output;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    const lower = key.toLowerCase();
    if (['form', 'template', 'board', 'source', 'type', 'status', 'priority', 'severity', 'client', 'organization', 'requester'].some(term => lower.includes(term))) {
      output[childPath] = child;
    }
    if (child && typeof child === 'object') collectRelevantFields(child, childPath, output);
  }
  return output;
}

async function inspectTicket1004(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);

  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);

  let response;
  try {
    response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket/1004`, {
      method: 'GET',
      headers: { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' },
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the NinjaOne ticket endpoint.' }, 502);
  }

  const raw = await response.text();
  let ticket = {};
  try { ticket = JSON.parse(raw); } catch {
    return json({ ok: false, status: response.status, error: 'NinjaOne did not return valid JSON.' }, 502);
  }

  return json({
    ok: response.ok,
    readOnly: true,
    status: response.status,
    ticketNumber: 1004,
    topLevelKeys: Object.keys(ticket),
    relevantFields: collectRelevantFields(ticket),
    build: '2026-07-14-ninja-ticket-1004-structured-fields-v1',
  }, response.ok ? 200 : 502);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ninja-ticket-1004-fields') return inspectTicket1004(request, env);
    return baseWorker.fetch(request, env, ctx);
  },
};
