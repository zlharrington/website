import directWorker from './direct-ticket-worker.js';

const HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const clean = (value, max = 3000) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);

function allowedOrigin(request) {
  const allowedHosts = ['harringtonit.com', 'www.harringtonit.com'];
  const origin = request.headers.get('origin');
  if (origin) {
    try { return allowedHosts.includes(new URL(origin).hostname); } catch { return false; }
  }
  try { return allowedHosts.includes(new URL(request.url).hostname); } catch { return false; }
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
  try {
    const response = await fetch(`${baseUrl}/ws/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${env.NINJA_CLIENT_ID}:${env.NINJA_CLIENT_SECRET}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.NINJA_REFRESH_TOKEN }).toString(),
    });
    const raw = await response.text();
    const result = parseTokenResponse(raw, response.headers.get('content-type') || '');
    if (!response.ok || !result.access_token) {
      return { error: result.error_description || result.error || `Refresh failed with status ${response.status}.`, status: 502 };
    }
    return { accessToken: result.access_token, baseUrl };
  } catch {
    return { error: 'Could not reach NinjaOne authentication.', status: 502 };
  }
}

async function inspectAttributes(request, env) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  const response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket/1004`, {
    method: 'GET', headers: { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' },
  });
  const raw = await response.text();
  let ticket = {};
  try { ticket = JSON.parse(raw); } catch { return json({ ok: false, status: response.status, error: 'NinjaOne returned invalid JSON.' }, 502); }
  return json({
    ok: response.ok, readOnly: true, ticketNumber: 1004,
    ticketFormId: ticket.ticketFormId ?? null,
    attributeValues: ticket.attributeValues ?? null,
    attributeValueType: Array.isArray(ticket.attributeValues) ? 'array' : typeof ticket.attributeValues,
    build: '2026-07-14-ninja-ticket-attribute-inspection-v4',
  }, response.ok ? 200 : 502);
}

async function inspectConversations(request, env) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  const paths = [
    '/v2/ticketing/ticket/1004/comments', '/v2/ticketing/ticket/1004/comment',
    '/v2/ticketing/ticket/1004/conversations', '/v2/ticketing/ticket/1004/conversation',
    '/v2/ticketing/ticket/1004/messages', '/v2/ticketing/ticket/1004/activity',
  ];
  const results = [];
  for (const path of paths) {
    try {
      const response = await fetch(`${auth.baseUrl}${path}`, {
        method: 'GET', headers: { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' },
      });
      const raw = await response.text();
      results.push({ path, status: response.status, contentType: clean(response.headers.get('content-type') || '', 120), bodyPreview: clean(raw, 3000) });
    } catch { results.push({ path, status: 0, bodyPreview: 'Request failed.' }); }
  }
  return json({ ok: true, readOnly: true, ticketNumber: 1004, results, build: '2026-07-14-ninja-ticket-conversation-discovery-v2' });
}

async function validateCommentPayload(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket/1004/comment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const raw = await response.text();
    return json({
      ok: true,
      validationOnly: true,
      commentCreated: response.ok,
      status: response.status,
      bodyPreview: clean(raw, 3000),
      build: '2026-07-14-ninja-comment-empty-payload-probe-v1',
    });
  } catch {
    return json({ ok: false, error: 'Comment validation request failed.' }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ninja-ticket-1004-attributes') return inspectAttributes(request, env);
    if (url.pathname === '/api/ninja-ticket-1004-conversations') return inspectConversations(request, env);
    if (url.pathname === '/api/ninja-comment-payload-validation') return validateCommentPayload(request, env);
    return directWorker.fetch(request, env, ctx);
  },
};