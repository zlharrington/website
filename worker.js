const MAX_BODY_BYTES = 20_000;
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const PRODUCTION_ORIGINS = new Set([
  'https://harringtonit.com',
  'https://www.harringtonit.com',
]);

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; upgrade-insecure-requests",
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
};

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    ...extraHeaders,
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const singleLine = (value, max = 200) => clean(value, max).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
const escapeHtml = (value) => clean(value, 5000)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.delete('server');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAllowedOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || PRODUCTION_ORIGINS.has(origin);
}

async function isRateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowId = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = new Request(`https://rate-limit.internal/${windowId}/${encodeURIComponent(ip)}`);
  const cache = caches.default;
  const cached = await cache.match(key);
  const count = cached ? Number(await cached.text()) || 0 : 0;
  if (count >= RATE_LIMIT_MAX) return true;
  await cache.put(key, new Response(String(count + 1), {
    headers: { 'cache-control': `max-age=${RATE_LIMIT_WINDOW_SECONDS}` },
  }));
  return false;
}

async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
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

async function sendEmail(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405, { allow: 'POST' });
  if (!isAllowedOrigin(request)) return json({ ok: false, error: 'Request origin is not allowed.' }, 403);
  if (await isRateLimited(request)) {
    return json({ ok: false, error: 'Too many submissions. Please wait a few minutes and try again.' }, 429, {
      'retry-after': String(RATE_LIMIT_WINDOW_SECONDS),
    });
  }
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email service is not configured.' }, 503);

  const { payload, error } = await readJsonBody(request);
  if (error) return error;
  if (clean(payload.website, 200)) return json({ ok: true });

  const type = singleLine(payload.type, 20);
  const name = singleLine(payload.name, 120);
  const email = singleLine(payload.email, 254).toLowerCase();
  const phone = singleLine(payload.phone, 60);
  if (!name || !isEmail(email)) return json({ ok: false, error: 'Please provide a valid name and email address.' }, 400);

  let to;
  let subject;
  let html;
  let text;

  if (type === 'contact') {
    const business = singleLine(payload.business, 160);
    const message = clean(payload.message, 4000);
    if (!message) return json({ ok: false, error: 'Please enter a message.' }, 400);
    to = 'support@harringtonit.com';
    subject = `Website inquiry from ${business || name}`;
    html = `<h2>New website inquiry</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Business:</strong> ${escapeHtml(business || 'Not provided')}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
      <hr><p><strong>How can Harrington IT help?</strong></p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
    text = `NEW WEBSITE INQUIRY\n\nName: ${name}\nBusiness: ${business || 'Not provided'}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\n\n${message}`;
  } else if (type === 'ticket') {
    const company = singleLine(payload.company, 160);
    const priority = singleLine(payload.priority, 80);
    const category = singleLine(payload.category, 100);
    const summary = singleLine(payload.summary, 120);
    const description = clean(payload.description, 5000);
    const contactTime = singleLine(payload.contact_time, 160);
    if (!company || !priority || !category || !summary || !description) {
      return json({ ok: false, error: 'Please complete all required ticket fields.' }, 400);
    }
    const priorityLabel = singleLine(priority.split(' — ')[0] || 'Support', 30);
    to = 'support@harringtonit.rmmservices.net';
    subject = `${priorityLabel} - ${company} - ${summary}`;
    html = `<h2>Harrington IT support request</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Business:</strong> ${escapeHtml(company)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
      <p><strong>Priority:</strong> ${escapeHtml(priority)}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      <p><strong>Best contact time:</strong> ${escapeHtml(contactTime || 'Not provided')}</p>
      <hr><p><strong>Summary:</strong> ${escapeHtml(summary)}</p>
      <p><strong>Details:</strong></p><p style="white-space:pre-wrap">${escapeHtml(description)}</p>`;
    text = `HARRINGTON IT SUPPORT REQUEST\n\nName: ${name}\nBusiness: ${company}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\nPriority: ${priority}\nCategory: ${category}\nBest contact time: ${contactTime || 'Not provided'}\n\nSUMMARY\n${summary}\n\nDETAILS\n${description}`;
  } else {
    return json({ ok: false, error: 'Unknown form type.' }, 400);
  }

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Harrington IT Website <website@harringtonit.com>',
      to: [to],
      reply_to: email,
      subject,
      html,
      text,
    }),
  });

  if (!resendResponse.ok) {
    console.error('Resend request failed with status:', resendResponse.status);
    return json({ ok: false, error: 'Your message could not be sent. Please try again or call us.' }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = url.pathname === '/api/send-email'
      ? await sendEmail(request, env)
      : await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },
};