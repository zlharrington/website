import baseWorker from './worker.js';

const REDIRECT_URI = 'https://harringtonit.com/api/ninja-oauth-callback';
const OAUTH_SCOPE = 'monitoring management offline_access';
const STATE_MAX_AGE_SECONDS = 600;

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-robots-tag': 'noindex, nofollow',
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeLine = (value, max = 1200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);

function getNinjaBaseUrl(regionValue) {
  const region = String(regionValue ?? '').trim().toLowerCase();
  const regionHosts = {
    us: 'https://app.ninjarmm.com',
    us2: 'https://us2.ninjarmm.com',
    ca: 'https://ca.ninjarmm.com',
    eu: 'https://eu.ninjarmm.com',
    uk: 'https://uk.ninjarmm.com',
    au: 'https://au.ninjarmm.com',
  };
  return regionHosts[region] || null;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

async function signState(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function validateState(state, secret) {
  if (!state || !secret) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [timestamp, nonce, suppliedSignature] = parts;
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  if (age < 0 || age > STATE_MAX_AGE_SECONDS) return false;
  const expected = await signState(`${timestamp}.${nonce}`, secret);
  return expected === state && suppliedSignature.length > 20;
}

function htmlResponse(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:60px auto;padding:0 24px;line-height:1.5;color:#172033}code,pre{background:#f3f5f8;border-radius:8px;padding:4px 7px}pre{padding:16px;overflow-wrap:anywhere;white-space:pre-wrap}.ok{color:#176b3a}.error{color:#a12b2b}</style></head><body>${body}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

async function startOAuth(env) {
  if (!env.NINJA_CLIENT_ID || !env.NINJA_CLIENT_SECRET || !env.NINJA_REGION) {
    return htmlResponse('NinjaOne OAuth error', '<h1 class="error">NinjaOne credentials are incomplete.</h1>', 503);
  }
  const baseUrl = getNinjaBaseUrl(env.NINJA_REGION);
  if (!baseUrl) return htmlResponse('NinjaOne OAuth error', '<h1 class="error">NinjaOne region is invalid.</h1>', 400);

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const state = await signState(`${timestamp}.${nonce}`, env.NINJA_CLIENT_SECRET);
  const authorizeUrl = new URL(`${baseUrl}/ws/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', env.NINJA_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', OAUTH_SCOPE);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('prompt', 'consent');
  return Response.redirect(authorizeUrl.toString(), 302);
}

function parseTokenResponse(raw, contentType) {
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  try {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  } catch {
    return {};
  }
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (providerError) {
    return htmlResponse('NinjaOne authorization declined', `<h1 class="error">Authorization was not completed.</h1><p>${escapeHtml(providerError)}</p>`, 400);
  }
  if (!code || !(await validateState(state, env.NINJA_CLIENT_SECRET))) {
    return htmlResponse('NinjaOne OAuth error', '<h1 class="error">The OAuth callback could not be validated.</h1><p>Start the authorization process again.</p>', 400);
  }

  const baseUrl = getNinjaBaseUrl(env.NINJA_REGION);
  if (!baseUrl) return htmlResponse('NinjaOne OAuth error', '<h1 class="error">NinjaOne region is invalid.</h1>', 400);

  const credentials = btoa(`${env.NINJA_CLIENT_ID}:${env.NINJA_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  let tokenResponse;
  try {
    tokenResponse = await fetch(`${baseUrl}/ws/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch {
    return htmlResponse('NinjaOne OAuth error', '<h1 class="error">Could not reach NinjaOne.</h1>', 502);
  }

  const raw = await tokenResponse.text();
  const contentType = tokenResponse.headers.get('content-type') || '';
  const result = parseTokenResponse(raw, contentType);

  if (!tokenResponse.ok || !result.refresh_token) {
    const detail = result.error_description || result.error || (result.access_token
      ? 'NinjaOne returned an access token but no refresh token. Confirm Refresh Token is enabled for the OAuth app, then authorize again.'
      : `Token exchange failed with status ${tokenResponse.status}.`);
    return htmlResponse('NinjaOne OAuth error', `<h1 class="error">Token exchange failed.</h1><p>${escapeHtml(detail)}</p>`, 502);
  }

  return htmlResponse('NinjaOne authorization complete', `<h1 class="ok">NinjaOne authorization succeeded.</h1>
<p>Create or update this Cloudflare Worker secret:</p>
<p><code>NINJA_REFRESH_TOKEN</code></p>
<p>Use this exact value:</p>
<pre>${escapeHtml(result.refresh_token)}</pre>
<p><strong>Keep this page private.</strong> After saving the secret, close this tab. The token is not stored by this page.</p>`);
}

async function getUserAccessToken(env) {
  if (!env.NINJA_CLIENT_ID || !env.NINJA_CLIENT_SECRET || !env.NINJA_REFRESH_TOKEN || !env.NINJA_REGION) {
    return { error: 'NinjaOne user credentials are incomplete.', status: 503 };
  }
  const baseUrl = getNinjaBaseUrl(env.NINJA_REGION);
  if (!baseUrl) return { error: 'NinjaOne region is invalid.', status: 400 };

  const credentials = btoa(`${env.NINJA_CLIENT_ID}:${env.NINJA_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: env.NINJA_REFRESH_TOKEN,
  });

  let response;
  try {
    response = await fetch(`${baseUrl}/ws/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch {
    return { error: 'Could not reach NinjaOne.', status: 502 };
  }

  const raw = await response.text();
  const result = parseTokenResponse(raw, response.headers.get('content-type') || '');
  if (!response.ok || !result.access_token) {
    return {
      error: safeLine(result.error_description || result.error || `Refresh failed with status ${response.status}.`, 300),
      status: 502,
    };
  }

  return { accessToken: result.access_token, baseUrl };
}

async function validateTicketWithUserToken(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }
  const origin = request.headers.get('origin');
  if (!origin || !['https://harringtonit.com', 'https://www.harringtonit.com'].includes(origin)) {
    return jsonResponse({ ok: false, error: 'Request origin is not allowed.' }, 403);
  }

  const auth = await getUserAccessToken(env);
  if (auth.error) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const probePayload = {
    subject: 'Harrington IT validation probe',
    status: '__VALIDATION_ONLY__',
  };

  let response;
  try {
    response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(probePayload),
    });
  } catch {
    return jsonResponse({ ok: false, error: 'Could not reach the NinjaOne ticket endpoint.' }, 502);
  }

  const raw = await response.text();
  return jsonResponse({
    ok: true,
    validationOnly: true,
    ticketCreated: response.ok,
    payloadVersion: 'subject-invalid-status-v1',
    status: response.status,
    bodyPreview: safeLine(raw, 3000),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ninja-oauth-start') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET', ...SECURITY_HEADERS } });
      return startOAuth(env);
    }
    if (url.pathname === '/api/ninja-oauth-callback') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET', ...SECURITY_HEADERS } });
      return handleCallback(request, env);
    }
    if (url.pathname === '/api/ninja-user-ticket-validation') {
      return validateTicketWithUserToken(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};