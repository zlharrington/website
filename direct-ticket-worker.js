import baseWorker from './worker.js';

const HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

const BUILD = '2026-07-14-hardened-public-ticket-v1';
const MAX_BODY_BYTES = 20_000;
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const DEFAULT_WEBSITE_REQUESTER_UID = '025624f1-7fb9-4781-9c60-38abad4c9e14';
const DEFAULT_TICKET_FORM_ID = 1;
const DEFAULT_WEB_TICKET_CLIENT_ID = 2;

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify({ ...data, build: BUILD }), {
  status,
  headers: { ...HEADERS, ...extraHeaders },
});
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const singleLine = (value, max = 200) => clean(value, max).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  return !!origin && ['https://harringtonit.com', 'https://www.harringtonit.com'].includes(origin);
}

async function isRateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowId = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = new Request(`https://rate-limit.internal/ticket/${windowId}/${encodeURIComponent(ip)}`);
  const cache = caches.default;
  const cached = await cache.match(key);
  const count = cached ? Number(await cached.text()) || 0 : 0;
  if (count >= RATE_LIMIT_MAX) return true;
  await cache.put(key, new Response(String(count + 1), {
    headers: { 'cache-control': `max-age=${RATE_LIMIT_WINDOW_SECONDS}` },
  }));
  return false;
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return { error: json({ ok: false, error: 'Unsupported content type.' }, 415) };
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return { error: json({ ok: false, error: 'Request is too large.' }, 413) };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { error: json({ ok: false, error: 'Request is too large.' }, 413) };
  }
  try {
    return { payload: JSON.parse(raw) };
  } catch {
    return { error: json({ ok: false, error: 'Invalid request.' }, 400) };
  }
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
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.NINJA_REFRESH_TOKEN,
      }).toString(),
    });
    const raw = await response.text();
    const result = parseTokenResponse(raw, response.headers.get('content-type') || '');
    if (!response.ok || !result.access_token) {
      return { error: singleLine(result.error_description || result.error || `Refresh failed with status ${response.status}.`, 300), status: 502 };
    }
    return { accessToken: result.access_token, baseUrl };
  } catch {
    return { error: 'Could not reach NinjaOne authentication.', status: 502 };
  }
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
    'SUMMARY',
    data.summary,
    '',
    'DETAILS',
    data.description,
  ].join('\n');
}

async function addTicketComment(auth, ticketId, details) {
  try {
    const form = new FormData();
    form.append(
      'comment',
      new Blob([JSON.stringify({ body: details, public: false })], { type: 'application/json' }),
      'comment.json',
    );

    const response = await fetch(`${auth.baseUrl}/v2/ticketing/ticket/${encodeURIComponent(ticketId)}/comment`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: 'application/json',
      },
      body: form,
    });
    return { added: response.ok, status: response.status };
  } catch {
    return { added: false, status: 0 };
  }
}

async function createWebsiteTicket(request, env) {
  if (!allowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  if (await isRateLimited(request)) {
    return json({ ok: false, error: 'Too many submissions. Please wait a few minutes and try again.' }, 429, {
      'retry-after': String(RATE_LIMIT_WINDOW_SECONDS),
    });
  }

  const { payload, error } = await readJson(request);
  if (error) return error;
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

  const clientId = Number(env.WEB_TICKET_CLIENT_ID || DEFAULT_WEB_TICKET_CLIENT_ID);
  const ticketFormId = Number(env.NINJA_TICKET_FORM_ID || DEFAULT_TICKET_FORM_ID);
  const requesterUid = singleLine(env.NINJA_WEBSITE_REQUESTER_UID || DEFAULT_WEBSITE_REQUESTER_UID, 100);
  const priorityLabel = data.priority.split(' — ')[0] || 'Normal';
  const ninjaPayload = {
    clientId,
    subject: `${priorityLabel} - ${data.company} - ${data.summary}`.slice(0, 255),
    status: 'OPEN',
    type: 'PROBLEM',
    priority: 'MEDIUM',
    severity: 'MODERATE',
    ticketFormId,
    requesterUid,
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
    return json({ ok: false, error: 'Your ticket could not be created. Please try again or call Harrington IT.' }, 502);
  }

  const ticketNumber = result.id ?? result.ticketId ?? result.ticket?.id ?? null;
  const comment = ticketNumber
    ? await addTicketComment(auth, ticketNumber, buildTicketDetails(data))
    : { added: false, status: 0 };

  return json({
    ok: true,
    ticketNumber,
    direct: true,
    recipient: 'Web Ticket',
    detailsAdded: comment.added,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/send-email' && request.method === 'POST') {
      const clone = request.clone();
      const parsed = await readJson(clone);
      if (parsed.payload?.type === 'ticket') return createWebsiteTicket(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};
