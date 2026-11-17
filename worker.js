// Telehealth Tech Solutions - API Worker
// Static files are served from ./public; this Worker only handles /api/*.
//
// DEMO ONLY: do not store real patient information until the HIPAA checklist in
// README.md is complete (BAAs, HIPAA-eligible hosting/database/video, policies).

const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers caps PBKDF2 at 100,000 iterations
const SLOT_MINUTES = 30;
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 17;
const MAX_BODY_BYTES = 10_000;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("Unhandled error:", err && err.message ? err.message : String(err));
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- routing

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (!path.startsWith("/api/")) return json({ error: "Not found." }, 404);

  // CSRF defence in depth (cookies are also SameSite=Lax): reject cross-origin writes.
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch { /* invalid */ }
      if (originHost !== url.host) throw new HttpError(403, "Cross-origin request blocked.");
    }
  }

  if (path === "/api/health" && method === "GET") return json({ ok: true });

  if (path === "/api/auth/register" && method === "POST") return register(request, env);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);

  // Everything below requires a signed-in user.
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.");

  if (path === "/api/me" && method === "GET") return json({ user: publicUser(user) });
  if (path === "/api/providers" && method === "GET") return listProviders(env);

  let m = path.match(/^\/api\/providers\/([\w-]+)\/slots$/);
  if (m && method === "GET") return providerSlots(url, env, m[1]);

  if (path === "/api/appointments" && method === "GET") return listAppointments(env, user);
  if (path === "/api/appointments" && method === "POST") return bookAppointment(request, env, user);

  m = path.match(/^\/api\/appointments\/([\w-]+)\/(cancel|complete|join)$/);
  if (m && method === "POST") {
    if (m[2] === "cancel") return cancelAppointment(request, env, user, m[1]);
    if (m[2] === "complete") return completeAppointment(request, env, user, m[1]);
    return joinAppointment(request, env, user, m[1]);
  }

  throw new HttpError(404, "Not found.");
}

// ---------------------------------------------------------------- auth

async function register(request, env) {
  const ip = clientIp(request);
  await rateLimit(env, `reg|${ip}`, 10, 3600);

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const fullName = cleanText(body.full_name, 100);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) throw new HttpError(400, "Enter a valid email address.");
  if (!fullName) throw new HttpError(400, "Enter your full name.");
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, "Password must be 10 to 200 characters.");
  }

  let role = "patient";
  let specialty = null;
  if (body.role === "provider") {
    const expected = env.PROVIDER_INVITE_CODE || "";
    const supplied = typeof body.invite_code === "string" ? body.invite_code : "";
    if (!expected || !timingSafeEqual(supplied, expected)) {
      throw new HttpError(403, "Invalid provider invite code.");
    }
    role = "provider";
    specialty = cleanText(body.specialty, 100) || "General practice";
  }

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, role, full_name, specialty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, email, hash, salt, role, fullName, specialty, nowIso()).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      throw new HttpError(409, "An account with that email already exists.");
    }
    throw err;
  }

  await audit(env, id, "register", role, ip);
  const cookie = await createSession(request, env, id);
  return json({ user: { id, email, role, full_name: fullName, specialty } }, 201, { "Set-Cookie": cookie });
}

async function login(request, env) {
  const ip = clientIp(request);
  const body = await readJson(request);
  const email = normalizeEmail(body.email) || "";
  const password = typeof body.password === "string" ? body.password : "";
  const key = `login|${email}|${ip}`;

  await rateLimit(env, key, 5, 900, false);

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  // Hash even when the user does not exist so response time doesn't reveal valid emails.
  const ok = row
    ? await verifyPassword(password, row.password_hash, row.password_salt)
    : (await hashPassword(password || "x"), false);

  if (!ok) {
    await env.DB.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(key, nowSec()).run();
    await audit(env, row ? row.id : null, "login_failed", null, ip);
    throw new HttpError(401, "Incorrect email or password.");
  }

  await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
  await audit(env, row.id, "login", null, ip);
  const cookie = await createSession(request, env, row.id);
  return json({ user: publicUser(row) }, 200, { "Set-Cookie": cookie });
}

async function logout(request, env) {
  const token = getCookie(request, "session");
  if (token) {
    const id = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request) });
}

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?"
  ).bind(id, nowIso()).first();
  return row || null;
}

async function createSession(request, env, userId) {
  const token = randomToken();
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, userId, expires.toISOString(), nowIso()).run();
  // Opportunistic cleanup of expired sessions and old login attempts.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()).run();
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(nowSec() - 86400).run();
  return cookieString(request, token, SESSION_DAYS * 86400);
}

function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, full_name: u.full_name, specialty: u.specialty };
}

async function rateLimit(env, key, max, windowSec, record = true) {
  const since = nowSec() - windowSec;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND created_at > ?"
  ).bind(key, since).first();
  if (row.n >= max) throw new HttpError(429, "Too many attempts. Please try again later.");
  if (record) {
    await env.DB.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").bind(key, nowSec()).run();
  }
}

// ---------------------------------------------------------------- providers & slots

async function listProviders(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, full_name, specialty FROM users WHERE role = 'provider' ORDER BY full_name"
  ).all();
  return json({ providers: results, clinic_tz: env.CLINIC_TZ || "America/Los_Angeles" });
}

async function providerSlots(url, env, providerId) {
  const date = url.searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Provide date as YYYY-MM-DD.");
  const provider = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'provider'").bind(providerId).first();
  if (!provider) throw new HttpError(404, "Provider not found.");
  const slots = await openSlots(env, providerId, date);
  return json({ date, slots });
}

function clinicTz(env) {
  return env.CLINIC_TZ || "America/Los_Angeles";
}

function allSlotsForDate(env, dateStr) {
  const tz = clinicTz(env);
  const [y, mo, d] = dateStr.split("-").map(Number);
  // Weekday of the calendar date (timezone-independent).
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return [];
  const slots = [];
  for (let mins = DAY_START_HOUR * 60; mins < DAY_END_HOUR * 60; mins += SLOT_MINUTES) {
    const start = zonedToUtc(y, mo, d, Math.floor(mins / 60), mins % 60, tz);
    slots.push(start.toISOString());
  }
  return slots;
}

async function openSlots(env, providerId, dateStr) {
  const all = allSlotsForDate(env, dateStr);
  if (!all.length) return [];
  const first = all[0];
  const last = all[all.length - 1];
  const { results } = await env.DB.prepare(
    "SELECT starts_at FROM appointments WHERE provider_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?"
  ).bind(providerId, first, last).all();
  const taken = new Set(results.map((r) => r.starts_at));
  const lead = isDemo(env) ? 0 : 60 * 60_000;
  const earliest = Date.now() + lead;
  return all.filter((s) => !taken.has(s) && new Date(s).getTime() > earliest);
}

// ---------------------------------------------------------------- appointments

async function listAppointments(env, user) {
  const isProvider = user.role === "provider";
  const sql = isProvider
    ? `SELECT a.id, a.starts_at, a.ends_at, a.reason, a.status, u.full_name AS other_name
         FROM appointments a JOIN users u ON u.id = a.patient_id
        WHERE a.provider_id = ? ORDER BY a.starts_at DESC LIMIT 200`
    : `SELECT a.id, a.starts_at, a.ends_at, a.reason, a.status, u.full_name AS other_name
         FROM appointments a JOIN users u ON u.id = a.provider_id
        WHERE a.patient_id = ? ORDER BY a.starts_at DESC LIMIT 200`;
  const { results } = await env.DB.prepare(sql).bind(user.id).all();
  return json({ appointments: results });
}

async function bookAppointment(request, env, user) {
  if (user.role !== "patient") throw new HttpError(403, "Only patients can book appointments.");
  const body = await readJson(request);
  const providerId = typeof body.provider_id === "string" ? body.provider_id : "";
  const reason = cleanText(body.reason, 500);

  const startDate = new Date(body.starts_at);
  if (!body.starts_at || Number.isNaN(startDate.getTime())) throw new HttpError(400, "Choose a valid time slot.");
  const startsAt = startDate.toISOString();

  const provider = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'provider'").bind(providerId).first();
  if (!provider) throw new HttpError(404, "Provider not found.");

  // The requested time must be one of the provider's currently open slots.
  const localDate = localDateString(startDate, clinicTz(env));
  const open = await openSlots(env, providerId, localDate);
  if (!open.includes(startsAt)) throw new HttpError(409, "That time is no longer available.");

  const id = crypto.randomUUID();
  const endsAt = new Date(startDate.getTime() + SLOT_MINUTES * 60_000).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO appointments (id, patient_id, provider_id, starts_at, ends_at, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)"
    ).bind(id, user.id, providerId, startsAt, endsAt, reason, nowIso()).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "That time was just taken. Pick another.");
    throw err;
  }
  await audit(env, user.id, "appointment_book", id, clientIp(request));
  return json({ appointment: { id, starts_at: startsAt, ends_at: endsAt, status: "scheduled" } }, 201);
}

async function loadOwnAppointment(env, user, id) {
  const appt = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first();
  // Same response for "missing" and "not yours" so IDs can't be probed.
  if (!appt || (appt.patient_id !== user.id && appt.provider_id !== user.id)) {
    throw new HttpError(404, "Appointment not found.");
  }
  return appt;
}

async function cancelAppointment(request, env, user, id) {
  const appt = await loadOwnAppointment(env, user, id);
  if (appt.status !== "scheduled") throw new HttpError(409, "Only scheduled appointments can be cancelled.");
  await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").bind(id).run();
  await audit(env, user.id, "appointment_cancel", id, clientIp(request));
  return json({ ok: true });
}

async function completeAppointment(request, env, user, id) {
  const appt = await loadOwnAppointment(env, user, id);
  if (user.role !== "provider") throw new HttpError(403, "Only the provider can complete a visit.");
  if (appt.status !== "scheduled") throw new HttpError(409, "Only scheduled appointments can be completed.");
  await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").bind(id).run();
  await audit(env, user.id, "appointment_complete", id, clientIp(request));
  return json({ ok: true });
}

// ---------------------------------------------------------------- video (Daily.co)

async function joinAppointment(request, env, user, id) {
  const appt = await loadOwnAppointment(env, user, id);
  if (appt.status !== "scheduled") throw new HttpError(409, "This visit is not active.");

  if (!isDemo(env)) {
    const now = Date.now();
    const opens = new Date(appt.starts_at).getTime() - 15 * 60_000;
    const closes = new Date(appt.ends_at).getTime() + 30 * 60_000;
    if (now < opens) throw new HttpError(403, "The video room opens 15 minutes before your appointment.");
    if (now > closes) throw new HttpError(403, "The video room for this appointment has closed.");
  }

  const domain = env.DAILY_DOMAIN || "";
  if (!env.DAILY_API_KEY || !/^[a-z0-9-]+$/i.test(domain)) {
    throw new HttpError(503, "Video is not configured yet. Add the DAILY_API_KEY and DAILY_DOMAIN secrets.");
  }

  const expiry = Math.floor(new Date(appt.ends_at).getTime() / 1000) + 2 * 3600;
  let room = appt.room_name;
  if (!room) {
    const candidate = "appt-" + randomHex(12);
    const created = await daily(env, "/rooms", {
      name: candidate,
      privacy: "private",
      properties: { exp: expiry, eject_at_room_exp: true, max_participants: 4, enable_chat: true, enable_knocking: false },
    });
    if (!created.ok) throw new HttpError(502, "Could not start the video room. Try again.");
    // First writer wins; if both parties join at once, re-read the stored room name.
    await env.DB.prepare("UPDATE appointments SET room_name = ? WHERE id = ? AND room_name IS NULL").bind(candidate, id).run();
    const fresh = await env.DB.prepare("SELECT room_name FROM appointments WHERE id = ?").bind(id).first();
    room = fresh.room_name;
  }

  const tokenRes = await daily(env, "/meeting-tokens", {
    properties: {
      room_name: room,
      user_name: user.full_name,
      is_owner: user.role === "provider",
      exp: expiry,
    },
  });
  if (!tokenRes.ok) throw new HttpError(502, "Could not create a video session. Try again.");
  const { token } = await tokenRes.json();

  await audit(env, user.id, "video_join", id, clientIp(request));
  return json({ url: `https://${domain}.daily.co/${room}?t=${encodeURIComponent(token)}` });
}

function daily(env, path, payload) {
  return fetch("https://api.daily.co/v1" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DAILY_API_KEY}` },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------- crypto & cookies

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256
  );
  return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt) };
}

async function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = await hashPassword(password, storedSalt);
  return timingSafeEqual(hash, storedHash);
}

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return randomHex(32);
}

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookieString(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearCookie(request) {
  return cookieString(request, "", 0);
}

// ---------------------------------------------------------------- time helpers

function nowIso() {
  return new Date().toISOString();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isDemo(env) {
  return String(env.DEMO_MODE).toLowerCase() === "true";
}

// Offset (minutes) of `tz` from UTC at the given instant.
function tzOffsetMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Convert a wall-clock time in `tz` to a UTC Date (handles DST).
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  utc = guess - tzOffsetMinutes(new Date(utc), tz) * 60000;
  return new Date(utc);
}

function localDateString(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------------------------------------------------------------- misc helpers

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.");
  try {
    const data = JSON.parse(text || "{}");
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("bad");
    return data;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function audit(env, userId, action, target, ip) {
  try {
    await env.DB.prepare(
      "INSERT INTO audit_log (user_id, action, target, ip, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(userId, action, target, ip, nowIso()).run();
  } catch (err) {
    console.error("audit failed:", err && err.message);
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
