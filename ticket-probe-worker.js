import oauthWorker from './oauth-worker.js';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: SECURITY_HEADERS,
});

const safeLine = (value, max = 2000) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);

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

  const response = await fetch(`${baseUrl}/ws/oauth/token`, {
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

  const raw = await response.text();
  const result = parseTokenResponse(raw, response.headers.get('content-type') || '');
  if (!response.ok || !result.access_token) {
    return { error: safeLine(result.error_description || result.error || `Refresh failed with status ${response.status}.`, 300), status: 502 };
  }
  return { accessToken: result.access_token, baseUrl };
}

async function validateTicket(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  if (!origin || !['https://harringtonit.com', 'https://www.harringtonit.com'].includes(origin)) {
    return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  }

  let auth;
  try {
    auth = await getUserAccessToken(env);
  } catch {
    return json({ ok: false, error: 'Could not reach NinjaOne authentication.' }, 502);
  }
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);

  let response;
  try {
    response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ subject: 'Website integration validation - do not create' }),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the NinjaOne ticket endpoint.' }, 502);
  }

  const raw = await response.text();
  return json({
    ok: true,
    validationOnly: true,
    ticketCreated: response.ok,
    status: response.status,
    bodyPreview: safeLine(raw),
    build: '2026-07-14-ninja-ticket-subject-probe-v1',
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ninja-user-ticket-validation') return validateTicket(request, env);
    return oauthWorker.fetch(request, env, ctx);
  },
};
