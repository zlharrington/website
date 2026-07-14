const json = (data, status = 200) => new Response(JSON.stringify(data), {
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

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot: bots commonly fill hidden fields.
  if (clean(payload.website, 200)) {
    return json({ ok: true });
  }

  const type = clean(payload.type, 20);
  const name = clean(payload.name, 120);
  const email = clean(payload.email, 254);
  const phone = clean(payload.phone, 60);

  if (!name || !isEmail(email)) {
    return json({ ok: false, error: 'Please provide a valid name and email address.' }, 400);
  }

  let to;
  let subject;
  let html;
  let text;

  if (type === 'contact') {
    const business = clean(payload.business, 160);
    const message = clean(payload.message, 4000);
    if (!message) return json({ ok: false, error: 'Please enter a message.' }, 400);

    to = 'support@harringtonit.com';
    subject = `Website inquiry from ${business || name}`;
    html = `
      <h2>New website inquiry</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Business:</strong> ${escapeHtml(business || 'Not provided')}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
      <hr>
      <p><strong>How can Harrington IT help?</strong></p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
    text = `NEW WEBSITE INQUIRY\n\nName: ${name}\nBusiness: ${business || 'Not provided'}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\n\n${message}`;
  } else if (type === 'ticket') {
    const company = clean(payload.company, 160);
    const priority = clean(payload.priority, 80);
    const category = clean(payload.category, 100);
    const summary = clean(payload.summary, 120);
    const description = clean(payload.description, 5000);
    const contactTime = clean(payload.contact_time, 160);

    if (!company || !priority || !category || !summary || !description) {
      return json({ ok: false, error: 'Please complete all required ticket fields.' }, 400);
    }

    const reference = `HIT-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    const priorityLabel = priority.split(' — ')[0] || 'Support';
    to = 'support@harringtonit.rmmservices.net';
    subject = `[${reference}] ${priorityLabel} - ${company} - ${summary}`;
    html = `
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
    text = `HARRINGTON IT SUPPORT REQUEST\nReference: ${reference}\n\nName: ${name}\nBusiness: ${company}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\nPriority: ${priority}\nCategory: ${category}\nBest contact time: ${contactTime || 'Not provided'}\n\nSUMMARY\n${summary}\n\nDETAILS\n${description}`;
  } else {
    return json({ ok: false, error: 'Unknown form type.' }, 400);
  }

  const response = await fetch('https://api.resend.com/emails', {
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

  if (!response.ok) {
    console.error('Resend error:', await response.text());
    return json({ ok: false, error: 'Your message could not be sent. Please try again or call us.' }, 502);
  }

  return json({ ok: true });
}

export function onRequest() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
