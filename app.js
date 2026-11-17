// Telehealth Tech Solutions patient portal.
// All user-supplied text is inserted with textContent / text nodes, never innerHTML.
(function () {
  "use strict";

  const root = document.getElementById("app");
  const nav = document.getElementById("top-nav");
  const state = { user: null, clinicTz: "" };

  // ------------------------------------------------------------ helpers

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error(data.error || "Request failed.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function show(...nodes) {
    root.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  function setMsg(el, text, kind) {
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  function fmt(iso) {
    return new Date(iso).toLocaleString([], {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function todayLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function renderNav() {
    if (!state.user) { nav.replaceChildren(); return; }
    nav.replaceChildren(
      h("span", {}, state.user.full_name + (state.user.role === "provider" ? " (provider)" : "")),
      h("button", { class: "btn link small", onclick: signOut }, "Sign out")
    );
  }

  async function signOut() {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (e) { /* ignore */ }
    state.user = null;
    renderNav();
    renderAuth("login");
  }

  // ------------------------------------------------------------ auth

  function renderAuth(mode) {
    const msg = h("p", { class: "msg", role: "status" });
    const isRegister = mode === "register";

    const name = h("input", { id: "f-name", type: "text", autocomplete: "name", maxlength: "100", required: true });
    const email = h("input", { id: "f-email", type: "email", autocomplete: "email", maxlength: "254", required: true });
    const pass = h("input", {
      id: "f-pass", type: "password", required: true, minlength: isRegister ? "10" : null,
      autocomplete: isRegister ? "new-password" : "current-password",
    });
    const clinician = h("input", { id: "f-clin", type: "checkbox" });
    const invite = h("input", { id: "f-invite", type: "password", autocomplete: "off" });
    const specialty = h("input", { id: "f-spec", type: "text", maxlength: "100", placeholder: "e.g. Family medicine" });
    const providerBox = h("div", { hidden: true },
      h("label", { for: "f-invite" }, "Provider invite code"), invite,
      h("label", { for: "f-spec" }, "Specialty"), specialty
    );
    clinician.addEventListener("change", () => { providerBox.hidden = !clinician.checked; });

    const submit = h("button", { class: "btn", type: "submit" }, isRegister ? "Create account" : "Sign in");

    const form = h("form", { novalidate: false },
      isRegister && h("label", { for: "f-name" }, "Full name"), isRegister && name,
      h("label", { for: "f-email" }, "Email"), email,
      h("label", { for: "f-pass" }, isRegister ? "Password (10+ characters)" : "Password"), pass,
      isRegister && h("label", { class: "check", for: "f-clin" }, clinician, "I am a clinician with an invite code"),
      isRegister && providerBox,
      h("div", { style: "margin-top:16px" }, submit),
      msg
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      setMsg(msg, "");
      try {
        const body = { email: email.value, password: pass.value };
        let path = "/api/auth/login";
        if (isRegister) {
          path = "/api/auth/register";
          body.full_name = name.value;
          if (clinician.checked) {
            body.role = "provider";
            body.invite_code = invite.value;
            body.specialty = specialty.value;
          }
        }
        const data = await api(path, { method: "POST", body });
        state.user = data.user;
        await enterApp();
      } catch (err) {
        setMsg(msg, err.message, "error");
        submit.disabled = false;
      }
    });

    const tab = (label, target) =>
      h("button", {
        class: "tab", type: "button", role: "tab",
        "aria-selected": String(mode === target),
        onclick: () => renderAuth(target),
      }, label);

    show(h("div", { class: "card auth" },
      h("h2", {}, "Patient portal"),
      h("div", { class: "tabs", role: "tablist" }, tab("Sign in", "login"), tab("Create account", "register")),
      form
    ));
  }

  // ------------------------------------------------------------ dashboards

  async function enterApp() {
    renderNav();
    await renderDashboard();
  }

  async function renderDashboard() {
    const blocks = [];
    if (state.user.role === "patient") blocks.push(await bookingCard());
    const apptCard = h("div", { class: "card" }, h("p", { class: "muted" }, "Loading appointments…"));
    blocks.push(apptCard);
    show(h("h1", {}, state.user.role === "provider" ? "Your schedule" : "Welcome, " + state.user.full_name.split(" ")[0]), ...blocks);
    await refreshAppointments(apptCard);
  }

  async function refreshAppointments(card) {
    const isProvider = state.user.role === "provider";
    let appointments;
    try {
      appointments = (await api("/api/appointments")).appointments;
    } catch (err) {
      card.replaceChildren(h("p", { class: "msg error" }, err.message));
      return;
    }

    const upcoming = appointments.filter((a) => a.status === "scheduled")
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const history = appointments.filter((a) => a.status !== "scheduled");
    const msg = h("p", { class: "msg", role: "status" });

    const row = (a) => {
      const actions = h("div", { class: "actions" });
      if (a.status === "scheduled") {
        actions.append(h("button", { class: "btn small", onclick: () => joinVideo(a.id, msg) }, "Join video"));
        if (isProvider) {
          actions.append(h("button", { class: "btn secondary small", onclick: () => act(a.id, "complete") }, "Mark complete"));
        }
        actions.append(h("button", { class: "btn danger small", onclick: () => confirmCancel(a.id) }, "Cancel"));
      }
      return h("div", { class: "appt" },
        h("div", {},
          h("div", { class: "when" }, fmt(a.starts_at) + " – " + fmtTime(a.ends_at),
            a.status !== "scheduled" && h("span", { class: "badge " + a.status }, a.status)),
          h("div", { class: "who" }, (isProvider ? "Patient: " : "With: ") + a.other_name),
          a.reason && h("div", { class: "why" }, "Reason: " + a.reason)
        ),
        actions
      );
    };

    async function act(id, what) {
      setMsg(msg, "");
      try {
        await api(`/api/appointments/${id}/${what}`, { method: "POST", body: {} });
        await refreshAppointments(card);
      } catch (err) { setMsg(msg, err.message, "error"); }
    }

    function confirmCancel(id) {
      if (window.confirm("Cancel this appointment?")) act(id, "cancel");
    }

    card.replaceChildren(
      h("h2", {}, "Upcoming visits"),
      upcoming.length ? upcoming.map(row) : h("p", { class: "muted" }, "No upcoming visits."),
      msg,
      history.length ? [h("h3", {}, "History"), history.map(row)] : null
    );
  }

  // ------------------------------------------------------------ booking (patients)

  async function bookingCard() {
    const msg = h("p", { class: "msg", role: "status" });
    let providers = [];
    try {
      const data = await api("/api/providers");
      providers = data.providers;
      state.clinicTz = data.clinic_tz;
    } catch (err) {
      return h("div", { class: "card" }, h("p", { class: "msg error" }, err.message));
    }

    if (!providers.length) {
      return h("div", { class: "card" },
        h("h2", {}, "Book a video visit"),
        h("p", { class: "muted" }, "No providers are available yet. Check back soon.")
      );
    }

    let selectedSlot = null;
    const providerSel = h("select", { id: "b-provider" },
      providers.map((p) => h("option", { value: p.id }, p.full_name + (p.specialty ? " – " + p.specialty : ""))));
    const dateInput = h("input", { id: "b-date", type: "date", min: todayLocal(), value: todayLocal() });
    const reason = h("textarea", { id: "b-reason", rows: "3", maxlength: "500", placeholder: "Brief reason for visit (no real health details in this demo)" });
    const slotBox = h("div", { class: "slots", role: "group", "aria-label": "Available times" });
    const bookBtn = h("button", { class: "btn", type: "button", disabled: true }, "Book visit");

    async function loadSlots() {
      selectedSlot = null;
      bookBtn.disabled = true;
      setMsg(msg, "");
      if (!dateInput.value) { slotBox.replaceChildren(); return; }
      slotBox.replaceChildren(h("span", { class: "muted" }, "Loading times…"));
      try {
        const data = await api(`/api/providers/${encodeURIComponent(providerSel.value)}/slots?date=${encodeURIComponent(dateInput.value)}`);
        if (!data.slots.length) {
          slotBox.replaceChildren(h("span", { class: "muted" }, "No openings on this day. Try another date."));
          return;
        }
        slotBox.replaceChildren(...data.slots.map((iso) => {
          const b = h("button", { class: "slot", type: "button", "aria-pressed": "false" }, fmtTime(iso));
          b.addEventListener("click", () => {
            selectedSlot = iso;
            slotBox.querySelectorAll(".slot").forEach((x) => x.setAttribute("aria-pressed", "false"));
            b.setAttribute("aria-pressed", "true");
            bookBtn.disabled = false;
          });
          return b;
        }));
      } catch (err) {
        slotBox.replaceChildren();
        setMsg(msg, err.message, "error");
      }
    }

    providerSel.addEventListener("change", loadSlots);
    dateInput.addEventListener("change", loadSlots);

    bookBtn.addEventListener("click", async () => {
      if (!selectedSlot) return;
      bookBtn.disabled = true;
      setMsg(msg, "");
      try {
        await api("/api/appointments", {
          method: "POST",
          body: { provider_id: providerSel.value, starts_at: selectedSlot, reason: reason.value },
        });
        reason.value = "";
        setMsg(msg, "Visit booked. It now appears under Upcoming visits.", "ok");
        await loadSlots();
        setMsg(msg, "Visit booked. It now appears under Upcoming visits.", "ok");
        const apptCard = root.querySelector(".card:last-of-type");
        if (apptCard) await refreshAppointments(apptCard);
      } catch (err) {
        setMsg(msg, err.message, "error");
        await loadSlots();
        setMsg(msg, err.message, "error");
      }
    });

    const card = h("div", { class: "card" },
      h("h2", {}, "Book a video visit"),
      h("div", { class: "row" },
        h("div", {}, h("label", { for: "b-provider" }, "Provider"), providerSel),
        h("div", {}, h("label", { for: "b-date" }, "Date"), dateInput)
      ),
      h("h3", {}, "Available times"),
      h("p", { class: "muted", style: "margin:0;font-size:13px" },
        "Shown in your local time. Clinic hours are Mon–Fri, 9:00–5:00 (" + state.clinicTz.replace(/_/g, " ") + ")."),
      slotBox,
      h("label", { for: "b-reason" }, "Reason for visit"), reason,
      h("div", { style: "margin-top:16px" }, bookBtn),
      msg
    );
    // Populate slots after the card is built.
    setTimeout(loadSlots, 0);
    return card;
  }

  // ------------------------------------------------------------ video

  async function joinVideo(appointmentId, msgEl) {
    setMsg(msgEl, "Starting video…");
    try {
      const data = await api(`/api/appointments/${appointmentId}/join`, { method: "POST", body: {} });
      let u;
      try { u = new URL(data.url); } catch (e) { throw new Error("Invalid video link."); }
      if (u.protocol !== "https:" || !u.hostname.endsWith(".daily.co")) throw new Error("Invalid video link.");
      renderVideo(u.toString());
    } catch (err) {
      setMsg(msgEl, err.message, "error");
    }
  }

  function renderVideo(url) {
    const frame = h("iframe", {
      src: url,
      title: "Video visit",
      allow: "camera; microphone; fullscreen; display-capture; autoplay",
    });
    show(
      h("div", { class: "video-bar" },
        h("h1", { style: "margin:0;font-size:22px" }, "Video visit"),
        h("button", { class: "btn secondary", onclick: () => renderDashboard() }, "Leave visit")
      ),
      h("div", { class: "video-wrap" }, frame),
      h("p", { class: "muted", style: "font-size:13px" },
        "Allow camera and microphone access when your browser asks. Use headphones to reduce echo.")
    );
  }

  // ------------------------------------------------------------ boot

  async function boot() {
    try {
      const data = await api("/api/me");
      state.user = data.user;
      await enterApp();
    } catch (err) {
      if (err.status === 401) renderAuth("login");
      else show(h("p", { class: "msg error center" }, "Could not load the portal. " + err.message));
    }
  }

  boot();
})();
