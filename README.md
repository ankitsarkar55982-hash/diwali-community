# Diwali Community Website

Static site (HTML, CSS, vanilla JS, no build step) plus a Supabase backend. Deploys on Vercel as-is.

```
index.html  config.js  backend.js         front end: intro, fireworks, greeting cards, gallery, upload, support, admin
supabase/migrations/                      20261101000000_init.sql, 20261101000100_tickets.sql, 20261103000000_analytics.sql
supabase/functions/                       upload-photo, gallery, report-photo, ticket-submit, ticket-status, track, admin (+ _shared)
supabase/config.toml  .env.example
tests/                                    unit.ts, e2e.py, responsive.py (+ common.py mock backend)
```

## Setup
1. Create a project at supabase.com. In **Authentication → Providers → Email**, turn **off** "Allow new users to sign up".
2. Install the Supabase CLI, then from this folder:
   ```
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   `db push` applies the three timestamped migrations in order. (Alternative: paste each file into the SQL editor in that order.)
3. Secrets: `cp .env.example .env`, set `IP_SALT` (32+ random characters) and `ALLOWED_ORIGIN`, then:
   ```
   supabase secrets set --env-file .env
   ```
4. Deploy the Edge Functions:
   ```
   supabase functions deploy
   ```
   With no name this deploys every function in `supabase/functions` (`_shared` is a library, not a function). To deploy one: `supabase functions deploy upload-photo`. `config.toml` sets `verify_jwt = false` for each function because they validate input and admin tokens themselves; if your CLI version ignores that file, add `--no-verify-jwt`.
5. Edit `config.js`: Project URL and the publishable/anon key (Project Settings → API). **Never** put the service-role key there.
6. **First admin:** Authentication → Users → Add user (email + password), then in the SQL editor:
   `insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com';`
7. Open `/#admin`, sign in, moderate.

## Environment variables and CORS
| Variable | Where | Required | Notes |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | automatic | Injected by Supabase. Never set manually, never in the browser. |
| `IP_SALT` | Edge Functions secret | **yes** | 16+ characters. Functions that rate-limit fail closed (HTTP 500) without it. |
| `ALLOWED_ORIGIN` | Edge Functions secret | recommended | Comma-separated exact origins, e.g. `https://diwali.example.com,https://my-app.vercel.app`. A browser request from any other origin gets HTTP 403. Unset means `*` (development only). |
| Project URL + anon key | `config.js` (public by design) | **yes** | Safe to expose; access is enforced by RLS and the functions. |

Vercel needs no environment variables. If you use preview deployments, add their origins to `ALLOWED_ORIGIN`.

## Deploy to Vercel
Push this folder to GitHub, import it in Vercel (Framework "Other", no build command, output directory = root), deploy, then put the final URL in `ALLOWED_ORIGIN` and re-run `supabase secrets set`.

## How it works
- **Photos:** `upload-photo` checks consent, honeypot, size and magic bytes, decodes and re-encodes as JPEG (drops EXIF/GPS), rejects duplicates, and stores to the private `photos-quarantine` bucket as `pending`. Only approved photos are served, through short-lived signed URLs from `gallery`. Paths are never sent to the browser.
- **Image formats:** the website accepts JPG, PNG and WebP, converts every image to JPEG in the browser (this also applies EXIF rotation and drops metadata), and the server accepts only JPEG/PNG data and re-encodes again. Photos (5 MB) and ticket screenshots (3 MB) use the same pipeline.
- **Database:** RLS on every table, no public write policies; writes happen in Edge Functions. Anonymous users can read only `id, status, created_at` of approved photos.
- **Admin:** Supabase Auth; the `admin` function verifies the JWT and `admin_users` on every call.
- **Tickets:** IDs like `DIWALI-2026-0001` from an atomic yearly counter. A random tracking code is shown once; only its hash is stored. Status lookup needs ID and code and returns only status, category, title and dates.
- **Rate limits (per salted IP hash):** 5 uploads/h, 10 reports/h, 3 tickets/h, 20 ticket lookups/h, 120 analytics events/h.

## Analytics (aggregate only)
Five totals in `site_counters`: **visits** (once per browser tab session), **greeting cards created** (a PNG download or a message copy), **shares** (WhatsApp, native share, gallery share, copy-link), **photo submissions** and **ticket submissions** (counted by the server). The browser sends only `{"event": "..."}`. No cookie, ID, IP, user agent or content is stored with an event. Nothing is counted if the browser sends Do Not Track or Global Privacy Control. Admins see the five totals on the dashboard.

## Privacy
Greeting names and messages are drawn in the browser and never sent anywhere; no ticket or analytics code reads them. The upload form shows a privacy notice and requires an explicit consent checkbox (also enforced by the server). The policy page is `/#privacy`.

## Music
The site generates its own instrumental tones by default (not a recording). For a real licensed track, put it at `audio/diwali.mp3` and set `AUDIO_SRC='/audio/diwali.mp3'` near the top of the main script in `index.html`. Use only music you are licensed to use.

## Tests
- `node --experimental-strip-types --no-warnings tests/unit.ts` (Node 22+): validation, CORS, image sniffing, env vars, migration names, config consistency.
- `pip install playwright pillow && playwright install chromium`, then `python3 tests/e2e.py` (functional) and `python3 tests/responsive.py` (viewports 360 to 1920 and phone flows). They run the real front end against a **mock** backend, not Supabase.
- Live checklist after deploying: submit a photo and a ticket; track the ticket; sign in at `#admin` as a non-admin and confirm refusal; call `admin` without a token and confirm 401; approve a photo and see it in the gallery; open the site from a non-allowed origin and confirm 403; confirm the counters rise.
