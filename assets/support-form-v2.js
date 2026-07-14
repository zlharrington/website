(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(open));
    });
  }

  document.querySelectorAll('[data-year]').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  const clean = value => (value || '').trim();

  const sendForm = async (payload) => {
    const response = await fetch('/api/submit-support-ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = {};
    }

    if (!response.ok || !result.ok) {
      const detail = result.error || raw.slice(0, 240) || 'No response body';
      throw new Error(`Support endpoint failed (${response.status}): ${detail}`);
    }

    return result;
  };

  const setBusy = (button, busy, busyText) => {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  };

  const ticketForm = document.querySelector('[data-ticket-form]');
  const copyButton = document.querySelector('[data-copy-ticket]');
  const ticketStatus = document.querySelector('[data-ticket-status]');

  const buildTicket = () => {
    const data = new FormData(ticketForm);
    const ticket = {
      name: clean(data.get('name')),
      company: clean(data.get('company')),
      email: clean(data.get('email')),
      phone: clean(data.get('phone')),
      priority: clean(data.get('priority')),
      category: clean(data.get('category')),
      summary: clean(data.get('summary')),
      description: clean(data.get('description')),
      contact_time: clean(data.get('contact_time')),
      website: clean(data.get('website')),
    };

    const subject = `[${ticket.priority.split(' — ')[0] || 'Support'}] ${ticket.company} - ${ticket.summary}`;
    const body = [
      'HARRINGTON IT SUPPORT REQUEST',
      '-----------------------------',
      `Name: ${ticket.name}`,
      `Business: ${ticket.company}`,
      `Email: ${ticket.email}`,
      `Phone: ${ticket.phone || 'Not provided'}`,
      `Priority: ${ticket.priority}`,
      `Category: ${ticket.category}`,
      `Best contact time: ${ticket.contact_time || 'Not provided'}`,
      '',
      'SUMMARY',
      ticket.summary,
      '',
      'DETAILS',
      ticket.description,
    ].join('\n');

    return { ticket, subject, body };
  };

  if (ticketForm) {
    const button = ticketForm.querySelector('button[type="submit"]');

    ticketForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ticketForm.reportValidity()) {
        if (ticketStatus) ticketStatus.textContent = 'Please complete the required fields.';
        return;
      }

      const { ticket } = buildTicket();
      setBusy(button, true, 'Submitting…');
      if (ticketStatus) ticketStatus.textContent = 'Submitting your support request…';

      try {
        const result = await sendForm(ticket);
        ticketForm.reset();
        if (ticketStatus) {
          ticketStatus.textContent = `Your support request has been submitted. Routed to ${result.recipient || 'unknown recipient'} via ${result.build || 'unknown build'}.`;
        }
      } catch (error) {
        if (ticketStatus) ticketStatus.textContent = error.message;
      } finally {
        setBusy(button, false);
      }
    });
  }

  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      if (!ticketForm.reportValidity()) {
        if (ticketStatus) ticketStatus.textContent = 'Please complete the required fields first.';
        return;
      }
      const { subject, body } = buildTicket();
      try {
        await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
        if (ticketStatus) ticketStatus.textContent = 'Ticket details copied.';
      } catch {
        if (ticketStatus) ticketStatus.textContent = 'Copying was blocked by the browser.';
      }
    });
  }
})();