const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "appointments.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 pet_type TEXT NOT NULL,
 service TEXT NOT NULL,
 preferred_date TEXT,
 preferred_time TEXT,
 notes TEXT,
 status TEXT NOT NULL DEFAULT 'New',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "replace-this-before-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
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

app.post("/api/appointments", submitLimiter, (req, res) => {
  const owner = clean(req.body.owner_name, 100);
  const phone = clean(req.body.phone, 40);
  const pet = clean(req.body.pet_type, 60);
  const service = clean(req.body.service, 100);
  if (!owner || !phone || !pet || !service) {
    return res.status(400).json({ error: "Please complete all required fields." });
  }
  const result = db.prepare(`
    INSERT INTO appointments (owner_name, phone, pet_type, service, preferred_date, preferred_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(owner, phone, pet, service, clean(req.body.preferred_date, 20), clean(req.body.preferred_time, 30), clean(req.body.notes, 1000));
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: "Your appointment request has been received. The clinic will contact you to confirm it." });
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const password = String(req.body.password || "");
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash || hash === "replace-with-bcrypt-hash") {
    return res.status(503).json({ error: "Admin login is not configured yet. Set ADMIN_PASSWORD_HASH in the hosting environment." });
  }
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(401).json({ error: "Incorrect password." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start a secure session." });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/appointments", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM appointments ORDER BY datetime(created_at) DESC, id DESC").all();
  res.json(rows);
});
app.patch("/api/admin/appointments/:id", requireAdmin, (req, res) => {
  const allowed = ["New", "Contacted", "Confirmed", "Completed", "Cancelled"];
  const status = clean(req.body.status, 20);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const result = db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Appointment not found." });
  res.json({ ok: true });
});
app.get("/api/admin/session", (req, res) => res.json({ authenticated: !!(req.session && req.session.isAdmin) }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => console.log(`Best Vet Clinic website running on port ${PORT}`));
