(function () {
  // Mobile menu
  var toggle = document.querySelector('.menu-toggle');
  var links = document.getElementById('nav-links');
  toggle.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Property filter
  var chips = document.querySelectorAll('.chip');
  var listings = document.querySelectorAll('.listing');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      var f = chip.getAttribute('data-filter');
      listings.forEach(function (l) {
        l.hidden = !(f === 'all' || l.getAttribute('data-type') === f);
      });
    });
  });

  // Footer year
  document.getElementById('year').textContent = new Date().getFullYear();

  // Contact form
  // Default: opens the visitor's email app with the message pre-filled.
  // To collect submissions directly instead, set FORM_ENDPOINT to a form
  // service URL (e.g. Formspree: https://formspree.io/f/yourid).
  var FORM_ENDPOINT = '';
  var TO_EMAIL = 'info@blueprintinvestmentsolutions.com';

  var form = document.getElementById('contact-form');
  var note = document.getElementById('form-note');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = new FormData(form);
    var name = (d.get('name') || '').toString().trim();
    var email = (d.get('email') || '').toString().trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
      note.textContent = 'Please enter your name and a valid email address.';
      return;
    }

    if (FORM_ENDPOINT) {
      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: d
      }).then(function (r) {
        if (r.ok) { form.reset(); note.textContent = 'Thank you! We will be in touch within one business day.'; }
        else { note.textContent = 'Something went wrong. Please email us directly.'; }
      }).catch(function () { note.textContent = 'Network error. Please email us directly.'; });
      return;
    }

    var body = 'Name: ' + name +
      '\nEmail: ' + email +
      '\nPhone: ' + (d.get('phone') || '') +
      '\nInterested in: ' + d.get('interest') +
      '\n\n' + (d.get('message') || '');
    window.location.href = 'mailto:' + TO_EMAIL +
      '?subject=' + encodeURIComponent('Consultation request from ' + name) +
      '&body=' + encodeURIComponent(body);
    note.textContent = 'Opening your email app to send the message...';
  });
})();
