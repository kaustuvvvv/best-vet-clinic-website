const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Add your Neon connection string in the hosting environment.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be set to a private random value of at least 32 characters.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Please sign in again." });
}
function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

app.post("/api/appointments", submitLimiter, async (req, res) => {
  const owner = clean(req.body.owner_name, 100);
  const phone = clean(req.body.phone, 40);
  const pet = clean(req.body.pet_type, 60);
  const service = clean(req.body.service, 100);
  if (!owner || !phone || !pet || !service) {
    return res.status(400).json({ error: "Please complete all required fields." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO appointments (owner_name, phone, pet_type, service, preferred_date, preferred_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [owner, phone, pet, service, clean(req.body.preferred_date, 20) || null,
       clean(req.body.preferred_time, 30) || null, clean(req.body.notes, 1000) || null]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id, message: "Your appointment request has been received. The clinic will contact you to confirm it." });
  } catch (err) {
    console.error("Appointment save failed:", err.message);
    res.status(500).json({ error: "We could not save your request. Please try again later or contact the clinic." });
  }
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const password = String(req.body.password || "");
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return res.status(503).json({ error: "Admin login is not configured yet." });
  try {
    const valid = await bcrypt.compare(password, hash);
    if (!valid) return res.status(401).json({ error: "Incorrect password." });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Could not start a secure session." });
      req.session.isAdmin = true;
      res.json({ ok: true });
    });
  } catch (err) {
    console.error("Admin login failed:", err.message);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/appointments", requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM appointments ORDER BY created_at DESC, id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Appointment list failed:", err.message);
    res.status(500).json({ error: "Could not load appointments." });
  }
});
app.patch("/api/admin/appointments/:id", requireAdmin, async (req, res) => {
  const allowed = ["New", "Contacted", "Confirmed", "Completed", "Cancelled"];
  const status = clean(req.body.status, 20);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });
  try {
    const result = await pool.query("UPDATE appointments SET status = $1 WHERE id = $2", [status, Number(req.params.id)]);
    if (!result.rowCount) return res.status(404).json({ error: "Appointment not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Appointment update failed:", err.message);
    res.status(500).json({ error: "Could not update appointment." });
  }
});
app.get("/api/admin/session", (req, res) => res.json({ authenticated: !!(req.session && req.session.isAdmin) }));
app.get("/health", (_req, res) => res.json({ ok: true }));

async function start() {
  await pool.query(`CREATE TABLE IF NOT EXISTS appointments (
    id BIGSERIAL PRIMARY KEY,
    owner_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    pet_type TEXT NOT NULL,
    service TEXT NOT NULL,
    preferred_date TEXT,
    preferred_time TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  app.listen(PORT, "0.0.0.0", () => console.log(`Best Vet Clinic website running on port ${PORT}`));
}
start().catch(err => {
  console.error("Could not connect to the database:", err.message);
  process.exit(1);
});
