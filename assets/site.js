(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');

  if (menuButton && nav) {
    const closeMenu = () => {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    };

    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(open));
    });

    nav.addEventListener('click', event => {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        closeMenu();
        menuButton.focus();
      }
    });

    document.addEventListener('click', event => {
      if (nav.classList.contains('open') && !nav.contains(event.target) && !menuButton.contains(event.target)) {
        closeMenu();
      }
    });
  }

  document.querySelectorAll('[data-year]').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const serviceByPath = {
    'managed-it-services.html': 'Managed IT',
    'cybersecurity.html': 'Cybersecurity',
    'microsoft-365.html': 'Microsoft 365',
    'networking.html': 'Networking & Infrastructure',
    'backup-disaster-recovery.html': 'Backup & Recovery',
    'it-consulting.html': 'IT Consulting & Projects',
    'website-support.html': 'Website Support',
  };

  // Mark the active page in the navigation for sighted and assistive-technology users.
  document.querySelectorAll('.main-nav a, .footer-links a').forEach(link => {
    const href = (link.getAttribute('href') || '').split('#')[0];
    if (href && href === currentPath) link.setAttribute('aria-current', 'page');
  });

  // Add a compact, site-wide mobile conversion bar without duplicating markup on every page.
  if (!document.querySelector('.mobile-action-bar')) {
    const actionBar = document.createElement('nav');
    actionBar.className = 'mobile-action-bar';
    actionBar.setAttribute('aria-label', 'Quick actions');
    const service = serviceByPath[currentPath];
    const consultationHref = currentPath === 'index.html'
      ? '#contact'
      : `index.html${service ? `?service=${encodeURIComponent(service)}` : ''}#contact`;
    actionBar.innerHTML = `
      <a class="mobile-action-call" href="tel:+15093937287" aria-label="Call Harrington IT at 509-393-7287">Call</a>
      <a class="mobile-action-consult" href="${consultationHref}">Request Consultation</a>
    `;
    document.body.appendChild(actionBar);
  }

  const clean = value => (value || '').trim();

  const sendForm = async (payload) => {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result = {};
    try {
      result = await response.json();
    } catch {
      result = {};
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Your message could not be sent. Please try again.');
    }

    return result;
  };

  const setBusy = (button, busy, busyText) => {
    if (!button) return;
    button.setAttribute('aria-busy', String(busy));
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  };

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    const button = contactForm.querySelector('button[type="submit"]');
    const status = contactForm.querySelector('[data-form-status]');
    const serviceSelect = contactForm.querySelector('[name="service"]');

    if (serviceSelect) {
      const params = new URLSearchParams(window.location.search);
      let service = clean(params.get('service'));

      if (!service && document.referrer) {
        try {
          const referrerUrl = new URL(document.referrer);
          if (referrerUrl.origin === window.location.origin) {
            const referrerPath = referrerUrl.pathname.split('/').pop();
            service = serviceByPath[referrerPath] || '';
          }
        } catch {
          service = '';
        }
      }

      if (service && Array.from(serviceSelect.options).some(option => option.value === service)) {
        serviceSelect.value = service;
      }
    }

    contactForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;

      const data = new FormData(contactForm);
      const service = clean(data.get('service')) || 'General IT / Not sure';
      const message = clean(data.get('message'));
      setBusy(button, true, 'Sending…');
      if (status) status.textContent = 'Sending your message…';

      try {
        await sendForm({
          type: 'contact',
          name: clean(data.get('name')),
          business: clean(data.get('business')),
          email: clean(data.get('email')),
          phone: clean(data.get('phone')),
          message: `Service interest: ${service}\n\n${message}`,
          website: clean(data.get('website')),
        });
        contactForm.reset();
        if (status) status.textContent = 'Thank you. Your message has been sent.';
      } catch (error) {
        if (status) status.textContent = error.message;
      } finally {
        setBusy(button, false);
      }
    });
  }

  const ticketForm = document.querySelector('[data-ticket-form]');
  const copyButton = document.querySelector('[data-copy-ticket]');
  const ticketStatus = document.querySelector('[data-ticket-status]');

  const buildTicket = () => {
    const data = new FormData(ticketForm);
    const ticket = {
      type: 'ticket',
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
          const routeDetails = result.recipient && result.build
            ? ` Routed to ${result.recipient} via ${result.build}.`
            : '';
          ticketStatus.textContent = `Your support request has been submitted.${routeDetails}`;
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
