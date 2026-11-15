# Best Vet Clinic and Pet Shop — complete website

This project includes a public clinic website, an appointment request form, a SQLite-backed API, and a private admin dashboard.

## Important before publishing
- The website is a starter project, not a live deployment.
- The clinic should review all text, services, address, and phone number before launch.
- The form creates a **request**, not a confirmed appointment. Clinic staff must contact the customer.
- Add a privacy notice explaining what appointment information is collected, who can access it, and how long it is kept.
- Use a strong unique admin password and keep the dashboard URL private.
- Do not put secrets in public source files or commit `.env`.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
```

Create a bcrypt password hash locally (replace `YOUR_STRONG_PASSWORD`):
```bash
node -e "require('bcryptjs').hash('YOUR_STRONG_PASSWORD', 12).then(console.log)"
```

Set environment variables:
- `SESSION_SECRET`: a long random secret
- `ADMIN_PASSWORD_HASH`: the bcrypt hash printed above
- `DATA_DIR`: optional; defaults to `./data`

Then run:
```bash
npm start
```
Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the private dashboard.

## Deploy with Render
1. Create a GitHub repository and upload the contents of this folder (not the ZIP file itself).
2. In Render, choose **New + → Blueprint** and connect that repository. Render reads `render.yaml`.
3. Render will ask for `ADMIN_PASSWORD_HASH`. Generate it on your own computer using the command above and paste the hash into Render's environment field. Never share the original password.
4. Deploy. The included persistent disk stores the SQLite appointment database and admin sessions.
5. Test `/health`, submit a test appointment, sign in at `/admin`, and delete the test request if needed.
6. Keep the Render service and disk active. Persistent disks and always-on hosting may require a paid plan; check current pricing before deploying.

## Endpoints
- `POST /api/appointments` — create a request
- `POST /api/admin/login` — admin login
- `GET /api/admin/appointments` — list requests (admin only)
- `PATCH /api/admin/appointments/:id` — update status (admin only)
- `POST /api/admin/logout` — sign out
- `GET /health` — health check

## Included pages
- `/` — public website
- `/admin` — private appointment dashboard
