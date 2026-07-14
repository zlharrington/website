import baseWorker from './ticket-probe-worker.js';

const HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

const BUILD = '2026-07-14-ninja-direct-ticket-v1';
const WEBSITE_REQUESTER_UID = '025624f1-7fb9-4781-9c60-38abad4c9e14';
const TICKET_FORM_ID = 1;

const json = (data, status = 200) => new Response(JSON.stringify({ ...data, build: BUILD }), { status, headers: HEADERS });
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const singleLine = (value, max = 200) => clean(value, max).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
    return { error: singleLine(result.error_description || result.error || `Refresh failed with status ${response.status}.`, 300), status: 502 };
  }
  return { accessToken: result.access_token, baseUrl };
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return null;
  try { return await request.json(); } catch { return null; }
}

function buildTicketDetails(data) {
  return [
    'HARRINGTON IT SUPPORT REQUEST',
    '',
    `Name: ${data.name}`,
    `Business: ${data.company}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || 'Not provided'}`,
    `Requested priority: ${data.priority}`,
    `Category: ${data.category}`,
    `Affected device: ${data.affectedDevice || 'Not provided'}`,
    `Best contact time: ${data.contactTime || 'Not provided'}`,
    '',
    'DETAILS',
    data.description,
  ].join('\n');
}

async function createWebsiteTicket(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);

  const payload = await readJson(request);
  if (!payload) return json({ ok: false, error: 'Invalid request.' }, 400);
  if (singleLine(payload.website, 200)) return json({ ok: true });

  const data = {
    name: singleLine(payload.name, 120),
    company: singleLine(payload.company, 160),
    email: singleLine(payload.email, 254).toLowerCase(),
    phone: singleLine(payload.phone, 60),
    priority: singleLine(payload.priority, 100),
    category: singleLine(payload.category, 100),
    affectedDevice: singleLine(payload.affected_device, 160),
    summary: singleLine(payload.summary, 120),
    description: clean(payload.description, 5000),
    contactTime: singleLine(payload.contact_time, 160),
  };

  if (!data.name || !data.company || !isEmail(data.email) || !data.priority || !data.category || !data.summary || !data.description) {
    return json({ ok: false, error: 'Please complete all required ticket fields.' }, 400);
  }

  const auth = await getUserAccessToken(env);
  if (auth.error) return json({ ok: false, error: 'Ticket service is temporarily unavailable.' }, auth.status);

  const priorityLabel = data.priority.split(' — ')[0] || 'Normal';
  const ninjaPayload = {
    subject: `${priorityLabel} - ${data.company} - ${data.summary}`.slice(0, 255),
    status: 'OPEN',
    type: 'PROBLEM',
    priority: 'MEDIUM',
    severity: 'MODERATE',
    ticketFormId: TICKET_FORM_ID,
    requesterUid: WEBSITE_REQUESTER_UID,
    description: buildTicketDetails(data),
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
      body: JSON.stringify(ninjaPayload),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach NinjaOne. Please try again or call Harrington IT.' }, 502);
  }

  const raw = await response.text();
  let result = {};
  try { result = JSON.parse(raw); } catch { result = {}; }

  if (!response.ok) {
    console.error('NinjaOne ticket creation failed', response.status, raw.slice(0, 2000));
    return json({
      ok: false,
      error: 'Your ticket could not be created. Please try again or call Harrington IT.',
      providerStatus: response.status,
      providerReason: singleLine(result.reason || result.resultCode || result.errorMessage || '', 500),
    }, 502);
  }

  const ticketNumber = result.id ?? result.ticketId ?? result.ticket?.id ?? null;
  return json({ ok: true, ticketNumber, direct: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/send-email' && request.method === 'POST') {
      const clone = request.clone();
      const payload = await readJson(clone);
      if (payload?.type === 'ticket') return createWebsiteTicket(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  },
};
