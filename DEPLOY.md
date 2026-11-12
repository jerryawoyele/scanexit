# Putting ScanExit online (Vercel)

Three addresses, two Vercel projects now, one later:

| Address | What | Vercel project | Folder |
|---|---|---|---|
| scanexit.com (+ www) | One-page site for store owners | `scanexit-site` | `site/` |
| demo.scanexit.com | Live demo app (Demo Store, simulated payments) | `scanexit-demo` | this folder (the app) |
| app.scanexit.com | Real app for stores (later) | `scanexit-app` | this folder, separate database + settings |

The demo and the real app are **separate projects with separate databases**: the demo runs on simulated
payments, the real app must never.

## 0. Accounts (you)

1. Create a free account at vercel.com (sign up with GitHub or email).
2. Install the CLI and log in:
   ```bash
   npm i -g vercel
   vercel login
   ```

## 1. The website: scanexit.com

```bash
cd site
vercel deploy --prod
```
First run: answer "Set up and deploy" → yes, project name `scanexit-site`, framework "Other", no build command.
Before deploying, set your WhatsApp number at the bottom of `site/index.html` (`WHATSAPP_NUMBER`), or leave it
empty to use email only.

Then in Vercel → `scanexit-site` → Settings → Domains → add `scanexit.com` and `www.scanexit.com`.
Vercel shows the DNS records to add at your registrar (usually an **A record** `@ → 76.76.21.21` and a
**CNAME** `www → cname.vercel-dns.com`). Copy exactly what Vercel shows.

## 2. The demo app: demo.scanexit.com

1. Create the project from the app folder (this folder):
   ```bash
   vercel link        # project name: scanexit-demo, framework: Next.js
   ```
2. Database: Vercel → `scanexit-demo` → Storage → add **Neon (Postgres)** from the Marketplace (free plan).
   It adds `DATABASE_URL` to the project automatically.
3. Settings → Environment Variables (Production):

   | Name | Value |
   |---|---|
   | `ROOT_DOMAIN` | `demo.scanexit.com` |
   | `DEFAULT_STORE` | `demo` |
   | `SIMULATE_PAYMENTS` | `true` |
   | `RECEIPT_SECRET` | a long random string (40+ characters) |
   | `OWNER_PIN` | a long PIN only you know (8+ characters) |

4. Load the Demo Store and its products into the new database (copy `DATABASE_URL` from Vercel → Storage):
   ```bash
   DATABASE_URL="postgres://..." npm run seed
   ```
   Demo PINs: staff `123456`, admin `654321` (fine for a public demo; change them on `/owner` if you prefer).
5. Deploy: `vercel deploy --prod`
6. Settings → Domains → add `demo.scanexit.com`, then add the **CNAME** `demo → cname.vercel-dns.com`
   (or what Vercel shows) at your registrar.

Check on your phone: `https://demo.scanexit.com` (shopper), `/checker` (staff), `/admin`, `/owner`.
The camera works because Vercel gives HTTPS automatically.

## 3. Later: app.scanexit.com (real stores)

Same app, a **new** project (`scanexit-app`) with its **own** Neon database, and:
- `SIMULATE_PAYMENTS` unset, `PAYSTACK_SECRET_KEY` set (test key first), webhook URL in Paystack:
  `https://app.scanexit.com/api/paystack/webhook`
- `DEFAULT_STORE` empty; each store gets its own address. That needs a wildcard domain, which on Vercel
  means moving scanexit.com's nameservers to Vercel. Decide this before the first real store.
- New `RECEIPT_SECRET` and `OWNER_PIN` (never reuse the demo's).
