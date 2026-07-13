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
  const openMail = (subject, body) => {
    window.location.href = `mailto:support@harringtonit.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    contactForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;
      const data = new FormData(contactForm);
      const name = clean(data.get('name'));
      const business = clean(data.get('business'));
      const email = clean(data.get('email'));
      const phone = clean(data.get('phone'));
      const message = clean(data.get('message'));

      const body = [
        'NEW WEBSITE INQUIRY',
        '-------------------',
        `Name: ${name}`,
        `Business: ${business || 'Not provided'}`,
        `Email: ${email}`,
        `Phone: ${phone || 'Not provided'}`,
        '',
        'How can Harrington IT help?',
        message
      ].join('\n');

      openMail(`Website inquiry from ${business || name}`, body);
    });
  }

  const ticketForm = document.querySelector('[data-ticket-form]');
  const copyButton = document.querySelector('[data-copy-ticket]');
  const status = document.querySelector('[data-ticket-status]');

  const buildTicket = () => {
    const data = new FormData(ticketForm);
    const name = clean(data.get('name'));
    const company = clean(data.get('company'));
    const email = clean(data.get('email'));
    const phone = clean(data.get('phone'));
    const priority = clean(data.get('priority'));
    const category = clean(data.get('category'));
    const summary = clean(data.get('summary'));
    const description = clean(data.get('description'));
    const contactTime = clean(data.get('contact_time'));

    const subject = `[${priority.split(' — ')[0] || 'Support'}] ${company} - ${summary}`;
    const body = [
      'HARRINGTON IT SUPPORT REQUEST',
      '-----------------------------',
      `Name: ${name}`,
      `Business: ${company}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      `Priority: ${priority}`,
      `Category: ${category}`,
      `Best contact time: ${contactTime || 'Not provided'}`,
      '',
      'SUMMARY',
      summary,
      '',
      'DETAILS',
      description
    ].join('\n');

    return { subject, body };
  };

  if (ticketForm) {
    ticketForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!ticketForm.reportValidity()) {
        if (status) status.textContent = 'Please complete the required fields.';
        return;
      }
      const ticket = buildTicket();
      if (status) status.textContent = 'Opening your email application…';
      openMail(ticket.subject, ticket.body);
    });
  }

  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      if (!ticketForm.reportValidity()) {
        if (status) status.textContent = 'Please complete the required fields first.';
        return;
      }
      const ticket = buildTicket();
      try {
        await navigator.clipboard.writeText(`Subject: ${ticket.subject}\n\n${ticket.body}`);
        if (status) status.textContent = 'Ticket details copied.';
      } catch {
        if (status) status.textContent = 'Copying was blocked by the browser.';
      }
    });
  }
})();
