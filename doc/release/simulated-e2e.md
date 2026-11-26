# Simulated end-to-end browser tests: deployed frontend vs staging frontend on the release-candidate backend

> **This was a local simulation. It is not production evidence.**
> It ran on 26 Nov 2026 in a sandbox, using a throwaway `postgis/postgis:15-3.4` container, local Vite preview servers and headless Chromium (Playwright).
> - No remote database, hosted site or deploy was touched. Nothing was pushed or committed.
> - External hosts were blocked: Nominatim geocoding, OSM tiles, Unsplash and analytics. Any result that depends on them is marked as a sandbox artifact.
> - "iPhone 14" means the viewport and UA emulated in Chromium. It is not WebKit.

## Setup (local)

| Part | Value |
|---|---|
| Backend | `backend-api` HEAD `76c7d36`, `node dist/main.js`, `TYPEORM_SYNC=false`, `JWT_SECRET` = 64 random hex chars, `JWT_EXPIRES_IN=15m` (60s for J7 only), no email provider keys, `CORS_ORIGINS=http://localhost:4173,http://localhost:4174`, `FRONTEND_BASE_URL=http://localhost:4174` |
| Schema | 1. Booted `origin/main` `5bc53a8` once with `TYPEORM_SYNC=true` on an empty DB (ledger 001–026).<br>2. Seeded alice and bob through main's `/auth/register`, plus a room via main's `POST /messages/rooms`.<br>3. Inserted a **pre-migration direct message** (bob → alice, dated 2 days ago) by SQL.<br>4. HEAD `npm run migration:run -- --apply --expect <027…036>`: all 10 applied. |
| Deployed frontend | `web-frontend` worktree at **`83d30d6`**, `npm ci && npm run build`, `vite preview --port 4173` |
| Staging frontend | `/home/user/trucycle/fe-staging` at **`c93693e`** (branch `trial-staging`), `vite preview --port 4174` |
| Frontend env | `VITE_API_BASE_URL=VITE_WS_URL=http://localhost:3000`; Vision, Google sign-in, analytics and PostHog all blank |
| Browser | Chromium headless, `deviceScaleFactor: 1`, service workers blocked, geolocation **not** granted, no traces |

**Staging ref note:** `83d30d6` is **not** an ancestor of `c93693e`. They fork at `c7d7e2b`, so staging lacks deployed PRs #19, #20, #22 and #23 (auth-mail recovery, camera framing, Vision structured response, optional cutout). Examples:
- Staging's reset page lacks deployed's 401 → back-to-OTP handling.
- Staging's signup has no postcode field.

Confirm which staging commit will actually be promoted.

**Verdicts:**
- **PASS / FAIL** describe product behaviour.
- **EXPECTED-FAIL** means a known release risk reproduced as documented.
- **BLOCKED** means a sandbox or harness limit.

## Results

| # | Journey | Deployed `83d30d6` | Staging `c93693e` |
|---|---|---|---|
| J1 | Signup → verify link (self-signed `type:'verify'` HS256 JWT, 24h) | **EXPECTED-FAIL (R3)**. `POST /auth/verify` returned 200 `{verified:true}` and the DB moved from `pending` to `active`, but the page shows "Verification failed". Manual sign-in afterwards returned 200. | **PASS**. Verify returned 200. The page shows "Email verified … Sign in to continue". The DB is `active`. Sign-in returned 200. |
| J2 | Sign in → reload → sign out | **PASS (UI)**. Login 200, the session persists across reload, and Log out returns to `/login`. **No `/auth/logout` call**, so the server session stays un-revoked (0/4 rows revoked). This is the known pre-promotion behaviour. | **PASS**. Login 200, the session persists across reload, `POST /auth/logout` 200, and the `auth_session` row is revoked. `/dashboard` then redirects to `/login`. |
| J3 | Found Items list, no location granted (R4) | **PASS (shim works)**. Request `GET /found-items?status=available&maxDistance=5&sortBy=nearest&page=1&limit=9` with no postcode or lat returned **200**, and all 3 seeded items render. | **PASS**. `GET /found-items?includeRecentClosed=true&sortBy=newest…` returned 200 and all 3 items render. |
| J4 | Report a spot (R5) | **PASS for reason-only**. `{"reason":"Blocking the pavement"}` returned 201 and the row is stored as `other / "Blocking the pavement"`. **FAIL for reason plus details**: `{"reason":"Blocking the pavement","details":"Next to the bus stop"}` returned 201, but the row is stored as `other / "Next to the bus stop"`. **The free-text reason is lost** (new defect D1). | **PASS**. `{"reason":"unsafe"}` returned 201 and the row is stored as `unsafe`. The details textarea was not filled because the harness had no selector for it. |
| J5a | Legacy pre-migration message stays read (R7 backfill) | **PASS**. Before any new message, alice's `unreadCount` was 0. The receipt row for the legacy message exists and there are 0 self-receipts. | **PASS**. Same DB: 0 unread for the legacy message. |
| J5b | New message → recipient badge → open → reload | **EXPECTED-FAIL (R7 residual)**. bob sent over the socket, stored as `category='direct'`. alice's badge showed 1. Opening the conversation made **no read call**, and after reload the server `unreadCount` is still 1, so the **/dashboard badge still shows 1**. The badge is hidden only while on `/messages`. | **PASS**. The socket send was stored as `direct`. The badge showed 2 (1 left over from the earlier deployed run, plus 1 new). Opening the conversation sent `POST /messages/rooms/:id/read` 200, and after reload `unreadCount` is 0 with no badge on `/dashboard`. |
| J6 | Reset request → OTP (a known bcrypt hash set in the DB) → new password; replay | **PASS**. `forget-password` 201 (email unavailable). The UI reset returned 201 and redirected to `/login`. The hash is cleared. The **same OTP replayed via the API returned 401** "Invalid or expired OTP". The old password returns 401 and the new password logs in (200). | **PASS**. Identical results. |
| J7 | Access-token expiry (`JWT_EXPIRES_IN=60s`) | **PASS with R6 observed**. `POST /auth/refresh` 200 keeps the user signed in. The server closed the sockets at about 60s, and only the socket newly opened by navigating to `/messages` was live afterwards. | **PASS**. Refresh 200. The sockets were closed at about 60s and both were open again afterwards, so the client reconnects. |
| J8 | Mobile smoke (Pixel 7, iPhone 14\*): `/`, `/login`, `/dashboard`, `/found-items`, `/found-items/post`, `/map` | **PASS**. No horizontal overflow on any page (`scrollWidth == clientWidth`: 412 and 390). On iPhone 14 the cookie banner covers the Log in button until "Not now" is pressed. | **PASS**. No overflow on any page or device. |
| J8x | Camera / file-input flows (Spot an item) | **NOT TESTABLE**. One `input[type=file]` and one camera button are present; there is no camera or real upload in the sandbox. | **NOT TESTABLE**. Same. |
| KB | Keyboard-only sign-in | n/a | **PASS**. Tab order: email → password → show password → keep logged in → Forgot password → **Log in** → verification link → Sign up → cookie policy → cookie buttons. Every stop matched `:focus-visible` and had a visible ring. Enter in the password field submitted: login 200 → `/dashboard`. |

\* iPhone 14 viewport/UA in Chromium, not WebKit.

### Console and network errors seen

- **Deployed, every signed-in page:** `GET /items?status=active&postcode=IG11+7FR…` returned **503**. The default dashboard postcode is geocoded through Nominatim, which the sandbox blocks (`ItemGeocodingService: Geocoding lookup failed`). This is a sandbox artifact, but note that HEAD answers a geocoder outage with 503.
- **Deployed:** a PostHog "no apiKey" console warning, because the key is blank locally.
- **Staging:** no console errors.
- **Both:** a few `net::ERR_ABORTED` on `/messages/rooms/active` during navigation. These are requests cancelled on route change and are harmless.
- **Both:** blocked third-party hosts (Unsplash images, OSM tiles). These are sandbox artifacts.
- No uncaught page errors on either frontend in any journey.

## New defects found

| ID | Severity | Where | What |
|---|---|---|---|
| D1 | Medium | `src/modules/found-items/dto/report-found-item.dto.ts:18-21` (`normalizeReportDetails`) | The R5 shim keeps the free-text reason only when `details` is empty. If a deployed-frontend user fills both fields ("Reason for reporting" and "Extra details"), the reason becomes `other` and the reason text is **discarded**. Fix: when the reason is unknown free text and details are present, store both, for example `"<reason> — <details>"` capped at 1000 characters. |

**Observations (not defects, for the release notes):**
- HEAD masks every chat participant name as "Community member" (`messages.service.ts:33`). In a 1:1 chat, both sides look identical in the room list on both frontends.
- On the deployed frontend, sign-out is client-only (it never calls `/auth/logout`), so server sessions remain valid until the refresh TTL (90d). This is already listed as a staging change in `frontend-promotion-list.md`.

## Evidence

Screenshots are in `doc/release/e2e-shots/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `j1-verify-deployed.png` | R3 error page |
| `j1-verify-staging.png` | Staging success page |
| `j3-found-items-deployed.png` | R4: the list renders |
| `j4-report-deployed.png` | Report sent |
| `j5-dashboard-after-read-deployed.png` | Badge still 1 after the conversation was opened |
| `j8-staging-pixel7-found-items.png` | Mobile layout |
| `kb-staging-login-focus.png` | Keyboard focus on the sign-in form |

The raw JSON results and the harness are in the session scratchpad. They are not kept in the repo.
