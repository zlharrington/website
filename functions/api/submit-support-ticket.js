const BUILD_VERSION = '2026-07-13-dedicated-ticket-route-v1';
const RECIPIENT = 'support@harringtonit.rmmservices.net';

const json = (data, status = 200) => new Response(JSON.stringify({ ...data, build: BUILD_VERSION }), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const escapeHtml = (value) => clean(value, 5000)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  if (clean(payload.website, 200)) return json({ ok: true, recipient: RECIPIENT });

  const name = clean(payload.name, 120);
  const company = clean(payload.company, 160);
  const email = clean(payload.email, 254);
  const phone = clean(payload.phone, 60);
  const priority = clean(payload.priority, 80);
  const category = clean(payload.category, 100);
  const summary = clean(payload.summary, 120);
  const description = clean(payload.description, 5000);
  const contactTime = clean(payload.contact_time, 160);

  if (!name || !company || !isEmail(email) || !priority || !category || !summary || !description) {
    return json({ ok: false, error: 'Please complete all required ticket fields.' }, 400);
  }

  const reference = `HIT-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const priorityLabel = priority.split(' — ')[0] || 'Support';
  const subject = `[${reference}] ${priorityLabel} - ${company} - ${summary}`;
  const html = `
    <h2>Harrington IT support request</h2>
    <p><strong>Reference:</strong> ${reference}</p>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Business:</strong> ${escapeHtml(company)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
    <p><strong>Priority:</strong> ${escapeHtml(priority)}</p>
    <p><strong>Category:</strong> ${escapeHtml(category)}</p>
    <p><strong>Best contact time:</strong> ${escapeHtml(contactTime || 'Not provided')}</p>
    <hr>
    <p><strong>Summary:</strong> ${escapeHtml(summary)}</p>
    <p><strong>Details:</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(description)}</p>`;
  const text = `HARRINGTON IT SUPPORT REQUEST\nReference: ${reference}\n\nName: ${name}\nBusiness: ${company}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\nPriority: ${priority}\nCategory: ${category}\nBest contact time: ${contactTime || 'Not provided'}\n\nSUMMARY\n${summary}\n\nDETAILS\n${description}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Harrington IT Website <website@harringtonit.com>',
      to: [RECIPIENT],
      reply_to: email,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    let message = '';
    try {
      const error = await response.json();
      message = clean(error?.message || error?.error?.message, 300);
    } catch {
      message = clean(await response.text(), 300);
    }
    return json({ ok: false, error: message ? `Email service error: ${message}` : 'Your message could not be sent.' }, 502);
  }

  return json({ ok: true, recipient: RECIPIENT, reference });
}

export function onRequest() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
