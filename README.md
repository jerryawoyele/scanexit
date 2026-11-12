# ScanExit: Standard level (online payment + human exit check)

Customers scan products with their phone browser (no app), pay with Paystack, and get a single-use receipt QR.
At the exit they scan that pass at the smart exit belt and unload their items onto it: the belt's AI camera checks every item against the paid receipt. A staff member only fixes mismatches and helps bag.

## Stores
Every store has its own subdomain, products, orders, PINs and receipts:
`https://shoprite-lekki.<ROOT_DOMAIN>`. A receipt QR is signed with its store, so it is refused at any other store,
and one store's staff PIN does not open another store's checker or admin.

You (the platform owner) create stores on `https://<ROOT_DOMAIN>/owner` with `OWNER_PIN`: name, link name,
staff PIN and admin PIN (6 to 12 digits, stored hashed). That page also shows each store's **entrance QR** to print.

## Pages
| URL | Who | What |
|---|---|---|
| `<ROOT_DOMAIN>/owner` | You (OWNER_PIN) | Create stores, change their PINs, download each store's entrance QR |
| `<store>.<ROOT_DOMAIN>/` | Customer | Phone number (gets a verification word), scan barcodes, change quantities, pay |
| `<store>.<ROOT_DOMAIN>/receipt` | Customer | Payment status, receipt QR (auto-refreshes, expires after 15 min), verification word, item list |
| `<store>.<ROOT_DOMAIN>/belt` | Screen at the smart exit belt (unlocked once with the staff PIN) | Customer scans their pass (or phone + word), unloads items onto the belt; the AI camera reports each item and the screen tallies it against the receipt. Green: bag and go. Red: the attendant re-runs or finishes with collect/refund amounts |
| `<store>.<ROOT_DOMAIN>/checker` | Exit staff (store's staff PIN) | **Backup when the belt is down:** scan the pass, or find the order by phone number + word; check, adjust, approve by hand |
| `<store>.<ROOT_DOMAIN>/admin` | Manager (store's admin PIN) | CSV product import, today's orders and pilot numbers for that store |

**Verification word:** when a customer gives their phone number they get a random word (e.g. MANGO), shown on their cart
and receipt. Staff can only find an order by phone if they also have the word, so knowing someone's number is not enough
to claim their basket. A wrong word looks exactly like "no order found".

## Run locally
```bash
npm install
cp .env.example .env     # edit OWNER_PIN and RECEIPT_SECRET; set SIMULATE_PAYMENTS="true" to test without Paystack
npm run seed             # "demo" store + 5 sample products (run while the server is stopped)
npm run build && npm start   # or: npm run dev
```
Then open `http://demo.localhost:3000` (customer), `http://demo.localhost:3000/checker` (staff PIN `123456`),
`http://demo.localhost:3000/admin` (admin PIN `654321`) and `http://localhost:3000/owner` (your `OWNER_PIN`).
Chrome and Edge open `*.localhost` addresses without any setup.
With `DATABASE_URL` empty, an embedded Postgres is stored in `./.data` (local testing only: one process at a time).
With `SIMULATE_PAYMENTS="true"` and no `PAYSTACK_SECRET_KEY`, "Pay now" simulates a successful payment (local testing only).
With neither set, checkout is refused ("pay at a payment point"), so a server deployed without its Paystack key never gives goods away.
A Paystack key always turns simulation off.

**Phone cameras only work over HTTPS.** To test on a real phone, deploy (below) or use a tunnel such as
Cloudflare Tunnel with a wildcard hostname, and set `ROOT_DOMAIN` to that domain.

## Go live
1. **Database:** create a Postgres database (Supabase, Neon or Render) and set `DATABASE_URL`. Tables are created automatically on first request.
2. **Hosting:** deploy to Vercel, Render or Railway. Set every variable from `.env.example` (leave `SIMULATE_PAYMENTS` unset or "false"). Use long random values for `RECEIPT_SECRET` and `OWNER_PIN`.
3. **Domain:** set `ROOT_DOMAIN` (e.g. `scanexit.com`), and add both the main domain and the wildcard `*.scanexit.com` to the host (Vercel and Render support wildcard domains).
4. **Stores:** open `https://<ROOT_DOMAIN>/owner`, create each store, and print its entrance QR.
5. **Paystack:** one account for all stores (yours). Set `PAYSTACK_SECRET_KEY` (start with `sk_test_...`), and in
   Paystack Dashboard → Settings → API Keys & Webhooks set the webhook URL to `https://<your-app>/api/paystack/webhook`.
6. **Products:** export each store's products from their POS as CSV with columns
   `barcode,name,price,image_url` (price in naira) and import on that store's `/admin`. Re-import daily, or build the sync agent.

## Security rules built in
- Prices always come from the server's product table and are frozen at checkout; the phone only sends barcodes.
- An order is marked paid only when Paystack confirms it (signed webhook, then re-verified with Paystack's API), the reference matches the cart's current payment attempt, and the amount matches exactly.
- The receipt QR is HMAC-signed, expires after 15 minutes (the receipt page refreshes it), and becomes invalid as soon as the exit check is completed.
- The cart is locked after payment. Editing during a pending payment cancels that attempt.
- Every product, cart, receipt and exit check belongs to one store; all lookups are limited to the store of the address in use.
- Store PINs are stored as salted scrypt hashes; the owner page only works on the main domain.
- Checker shows a full-check warning for first-time customers, baskets over 25 items, or orders with no phone number, and highlights the 3 most expensive items to look at closely.

## Not in this version (next steps)
- SMS one-time code to prove the customer owns the phone number (e.g. Termii); the verification word stops others from claiming an order, but the number itself is still self-entered.
- A separate Paystack account (or Paystack subaccount split) per store; today all payments go to the one `PAYSTACK_SECRET_KEY` account.
- Limiting wrong PIN attempts.
- Taking payment for added items inside the app (the checker shows the amount to collect at the desk by POS/transfer/cash).
- Automatic refunds through Paystack (the checker shows the refund amount).
- Real-time POS sync and sending sales back to the POS.
- Paystack requires an email: a placeholder is generated in `src/app/api/checkout/route.ts`; collect a real one if the store wants Paystack email receipts.

## Code map
- `src/lib/db.ts`: Postgres connection + table creation
- `src/lib/store.ts`: which store a request is for (from its subdomain)
- `src/lib/auth.ts`: owner PIN, hashed store PINs
- `src/lib/words.ts`: verification words
- `src/lib/cart.ts`: cart loading, price freezing, mark-paid rule
- `src/lib/receipt.ts`: signed receipt QR tokens
- `src/lib/paystack.ts`: initialize, verify, webhook signature
- `src/app/api/*`: API routes; `src/app/{page,receipt,checker,admin,owner}`: screens

## The smart exit belt (camera connection)
The belt's AI computer (camera + vision model) reports each item it sees:

```
POST https://<store address>/api/belt/item
x-station-key: <the store's belt key, shown on /admin>
{ "barcode": "6154000000017", "source": "camera", "confidence": 0.97 }
```
Without `runId` the item goes to the store's active check. The belt screen (`/belt`) shows the live tally; `POST /api/belt/done { runId }`
(the Done button, or the belt after a quiet period) gives green or red. With `SIMULATE_PAYMENTS="true"` (the demo) the belt screen
shows a simulated camera so the whole flow works without hardware.
