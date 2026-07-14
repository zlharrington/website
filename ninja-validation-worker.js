import oauthWorker from './oauth-worker.js';

const BUILD = '2026-07-14-ninja-ticket-open-status-probe-v1';

function getNinjaBaseUrl(regionValue) {
  const hosts = {
    us: 'https://app.ninjarmm.com',
    us2: 'https://us2.ninjarmm.com',
    ca: 'https://ca.ninjarmm.com',
    eu: 'https://eu.ninjarmm.com',
    uk: 'https://uk.ninjarmm.com',
    au: 'https://au.ninjarmm.com',
  };
  return hosts[String(regionValue ?? '').trim().toLowerCase()] || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify({ ...data, build: BUILD }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function safeLine(value, max = 3000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);
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

  let result = {};
  try { result = await response.json(); } catch { result = {}; }
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

  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);

  const probePayload = {
    subject: 'Harrington IT validation probe',
    status: 'OPEN',
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
    return json({ ok: false, error: 'Could not reach the NinjaOne ticket endpoint.' }, 502);
  }

  const raw = await response.text();
  return json({
    ok: true,
    validationOnly: true,
    ticketCreated: response.ok,
    payloadVersion: 'subject-open-status-v1',
    status: response.status,
    bodyPreview: safeLine(raw),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ninja-user-ticket-validation') {
      return validateTicket(request, env);
    }
    return oauthWorker.fetch(request, env, ctx);
  },
};
