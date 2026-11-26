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

---

## Run 2 — release pair (#11 + #25)

> **Local simulation — not production evidence.**
> It ran on 26 Nov 2026 in a sandbox, using a throwaway `postgis/postgis:15-3.4` container, local `vite preview` servers and headless Chromium (Playwright 1.65).
> - No remote database, hosted site or deploy was touched. Nothing was pushed or committed.
> - Every browser request to a non-localhost host was aborted by a context-level route guard.
> - Cloudinary uploads were **simulated**: `api.cloudinary.com` requests were fulfilled by the harness, and failed on purpose for J8.
> - The Vision Worker and the Nominatim geocoder were **local stubs**.
> - "iPhone 14" means the viewport and UA emulated in Chromium. It is not WebKit.

### Setup (local)

| Part | Value |
|---|---|
| Backend | `backend-api` branch `uiadedo/sleepy-bardeen-hxi0z4` at **`75b9411`** (PR #11). It was built in a detached scratch worktree (`npm ci && npm run build`) and run with `node dist/main.js` and `TYPEORM_SYNC=false`. The branch later moved to `c98e19d`, which changes only docs, so `src/` and `package*.json` are identical to what was tested. |
| Backend env | `JWT_SECRET` = 64 random hex chars, `JWT_EXPIRES_IN=15m`. No email provider and no `AUTH_RATE_LIMITS`. `VISION_WORKER_URL=https://localhost:8443/classify` (stub with a self-signed cert, trusted via `NODE_EXTRA_CA_CERTS`). `VISION_WORKER_SECRET` = 64 random hex chars. `OSM_SEARCH_URL` / `OSM_REVERSE_URL` = local geocoder stub, which always answers E1 6AN. |
| Schema | 1. Booted `origin/main` `5bc53a8` once with `TYPEORM_SYNC=true` on an empty DB (ledger 001–026).<br>2. Seeded six users through main's `/auth/register`, plus an alice–bob room through main's `POST /messages/rooms`.<br>3. Inserted a **pre-migration direct message** (bob → alice, dated 2 days ago) by SQL.<br>4. Ran HEAD's `npm run migration:run -- --apply --expect AddGoogleAuthToUser1700000000027,…,BackfillMessageReadReceipts1700000000036`: all 10 applied, ledger at 36.<br>5. **The 0036 backfill created exactly one receipt (alice, legacy message).** |
| Seed after migration | 12 found items (6 in E1 6AN, 6 in N1 9GU). carol was given the `partner` role, a shop and 6 dropped-off items, all by SQL. Per-device accounts were registered through HEAD and activated by SQL. |
| RC frontend | `web-frontend` **`3c3900b`** (local HEAD of `uiadedo/frontend-release-candidate`, PR #25; the origin ref did not resolve locally), in a scratch worktree.<br>`npm ci && npm run build` with `VITE_API_BASE_URL=VITE_WS_URL=http://localhost:3000` and a fake Cloudinary cloud/preset. All other `VITE_*` were unset. Served on `:4175`. |
| RC Smart-Spot build (J7 only) | Same commit and env plus **`VITE_ENABLE_SMART_SPOT=true`**, `vite build --outDir dist-smart`, served on `:4176`. **The default dist has Smart Spot off, so J7 needs this separate build.** |
| Deployed frontend | `83d30d6` worktree, same env, `:4173`. |
| Browser | Chromium headless with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, `deviceScaleFactor: 1` and service workers blocked. Geolocation was granted only for the Spot journeys (51.5205, -0.0712). Desktop is 1366×900; Pixel 7 and iPhone 14 are Playwright device descriptors. |

### Built flag defaults in the RC dist (`3c3900b`, production `npm run build`)

| Flag | Compiled value | Evidence |
|---|---|---|
| Smart Spot (`VITE_ENABLE_SMART_SPOT`) | **off** | `dist/assets/index-*.js`: `enableSmartSpot: yb`, `yb=Up(void 0,!1)`. At runtime, J8 on the default build made 0 `/found-items/vision` calls after a photo was added. |
| Photo cutout (`VITE_ENABLE_PHOTO_CUTOUT`) | **off** | `enablePhotoCutout: vb`, `vb=Up(void 0,!1)` |
| Message attachments (`VITE_MESSAGE_ATTACHMENTS_ENABLED`) | **not enabled** | The `=== 'true'` branch was folded away. `MessagingPage-*.js` contains only the disabled button with the title "Image attachments are unavailable". At runtime the button was `disabled` on all three devices (J5). |

Only `scripts/build-staging.mjs` sets `VITE_*` values. It is the staging build, not `npm run build`.

### Results — RC frontend `3c3900b` on backend `75b9411`

| # | Journey | Verdict | Evidence (desktop / Pixel 7 / iPhone 14 unless stated) |
|---|---|---|---|
| J1 | Signup → verify link → sign in | **PASS** (3/3) | `register` 201 created a `pending` user. The self-signed `type:'verify'` link gave `POST /auth/verify` 200, the page showed "Email verified … Sign in to continue" and the DB moved to `active`. The CTA led to `/login`, where login returned 200 and landed on `/dashboard`. No error text, API errors or console errors. |
| J2 | Persistence, sign-out, logout-all | **PASS** (sign-in, reload, sign-out); **PASS, API-driven** (logout-all) | "Keep me logged in", then reload, stayed on `/dashboard` with the profile menu visible. Log out sent `POST /auth/logout` 200, the session row was revoked, and `/dashboard` then redirected to `/login`. **#25 has no logout-all control.** With two signed-in browser contexts, `POST /auth/logout-all` 200 (using context A's stored token) revoked every session (for example 3/3). Both contexts were then sent to `/login` after `/auth/me` 401 and `/auth/refresh` 401. |
| J3 | Found Items, no location / with postcode | **PASS** (3/3) | With no postcode: `GET /found-items?includeRecentClosed=true&sortBy=newest&page=1&limit=9` returned **200** with 9 cards. With the user postcode E1 6AN: `…&maxDistance=5&postcode=E1+6AN&sortBy=nearest…` returned **200** with 9 cards, resolved through the geocoder stub. |
| J4 | Spot report with reason selection | **PASS** (3/3) | The `<select>` offers `already_gone, unsafe, misleading, duplicate, other` (`not_there` only with an active claim). Send stays disabled until a reason is chosen. `{"reason":"unsafe","details":"Broken glass on the seat"}` returned 201 and was stored as `unsafe / Broken glass on the seat`. `already_gone` returned 201 with `<null>` details. `misleading + details` returned 201 and was stored exactly. |
| J5 | Messaging: send, badge, open, reload, counts | **PASS** (3/3), with a phone-layout observation (O1) | Before any send, alice's `unreadCount` was **0**: the pre-migration message is not unread, and its backfilled receipt exists. bob's message was stored as `direct`. alice's badge read **1** and the API agreed (1). Opening the room sent `POST /messages/rooms/:id/read` 200. After reload, API `unreadCount` was 0 and `/dashboard` showed no badge. Both the legacy and the new message rendered. **Phones:** the newest message is below the fold when the room opens, so the read call covered only the visible older rows and the count stayed 1 until the user scrolled. After a wheel scroll it went to 0 (O1). |
| J6 | Password reset | **PASS** (3/3) | 1. `forget-password` 201 led to OTP entry.<br>2. **Double-clicking "Request a new code" sent exactly one request.**<br>3. A wrong code returned **401**. The UI went back to OTP entry with the digits and passwords cleared.<br>4. The valid code (bcrypt hash set by SQL) returned **201**, redirected to `/login` and cleared the hash.<br>5. Reusing the code returned 401, both from the API and from the UI.<br>6. The old password returned 401 and the new password returned 200. |
| J7 | Vision via a local Worker stub, non-admin (`customer` role) | **PASS** | **Spot** (Pixel 7, iPhone 14; desktop shows the "posting now uses the mobile camera" notice by design): `setInputFiles(chair.jpg)`. The browser sent `image + context=spot` and got **200**. The stub received exactly one request with `image` (JPEG `ffd8ff`) + `prompt="Analyze this item spotted on a UK street for TruCycle."`, and the page showed the "Wooden Chair" hint.<br>**Listing** (all 3, List New Item dialog): the browser sent `image + context=listing` and got **200**. The stub received **`image` only, with no `prompt` part**, and the hint was shown. |
| J8 | List-item camera/upload; Spot upload retry | **PASS** | **List dialog** (3/3): "Take photo" opened a live fake camera stream (640×480). "Take Photo" captured, giving 1 thumbnail. A gallery `setInputFiles` gave 2 thumbnails, with 0 "Failed" and 0 still uploading.<br>**Spot retry** (Pixel 7, iPhone 14): with Cloudinary aborted (`internetdisconnected`), the page showed "Photo upload failed" and **Retry upload**. After restoring the route and clicking Retry, the second upload succeeded and the page moved to "Confirm details". There, "Postcode not resolved" is a sandbox artifact: `useSpotPostcode.ts:61` calls `api.postcodes.io` from the browser, which the guard blocked. |
| J9 | Confetti once per new badge on My Impact | **PASS** (3/3) | A canvas-insertion counter recorded:<br>• first visit with 1 new badge: **1**<br>• reload: 0<br>• reload again: 0<br>• second badge awarded, then reload: **1**<br>• reload: 0<br>`user_badge.is_notified` stayed `false` throughout, so the suppression comes from the frontend's `tc.celebratedBadges`. |
| J10 | 390px layout (iPhone 14) | **PASS** | `scrollWidth == clientWidth == 390`, with no unclipped wide elements, on all three pages:<br>• **`/listings` pagination:** Previous/Next and the page button are visible.<br>• **`/messages` with a room open.**<br>• **Partner tables:** `/partner` (6 rows, table 695px inside a 342px `overflow-x:auto` wrapper) and `/partner/items` (6 rows, table 1000px inside a 340px wrapper). These tables scroll inside their card, not the page.<br>The Found Items "Load more spots" button did not appear: after the J4 reports, 9 or fewer items were available. |
| J11 | Cookie banner vs Log in (iPhone 14) | **PASS (RC)** | **RC:** Log in spans y 408–456 and the banner starts at y 470, so they do not overlap. `elementFromPoint` at the button centre is the button. **Deployed `83d30d6`:** the banner (y 378–664) **covers** Log in (y 384–432). `elementFromPoint` hits the banner heading, and scrolling does not help. This is the known deployed behaviour; #25 fixes it. |
| J12 | Keyboard sign-in (desktop) | **PASS** | Tab order: email → password → Show password → Keep me logged in → Forgot password? → **Log in** → Need a new verification email? → Sign up → cookie policy → Reject optional → Accept optional, then it wraps. Every stop matched `:focus-visible` with a visible ring or shadow. Typing plus Enter gave login 200 → `/dashboard`. |

### Results — deployed `83d30d6` on the same backend (shim check)

| # | Verdict | Evidence |
|---|---|---|
| J1 | **EXPECTED-FAIL (R3)** | `POST /auth/verify` 200 and the DB moved to `active`, but the page shows "Verification failed". Manual sign-in afterwards returned 200. |
| J3 | **PASS (R4 shim)** | `GET /found-items?status=available&maxDistance=5&sortBy=nearest&page=1&limit=9` with no location returned **200**, with 9 cards. |
| J4 | **PASS (R5 shim, D1 fixed)** | `{"reason":"Blocking the pavement"}` returned 201 and was stored as `other / Blocking the pavement`. `{"reason":"Blocking the pavement","details":"Next to the bus stop"}` returned 201 and was stored as `other / Blocking the pavement — Next to the bus stop`. **Run 1's D1 no longer reproduces.** |

### Console and network notes

- No uncaught page errors in any journey.
- API 4xx responses appeared only where they were expected: J2 after logout-all (401s), and J6 for the wrong and reused codes.
- The Spot pages log `net::ERR_BLOCKED_BY_CLIENT`. This is the harness blocking `api.postcodes.io`, and it is a sandbox artifact.

### New findings

No new blocking defects.

| ID | Severity | Where | What |
|---|---|---|---|
| O1 | Low (UX) | `web-frontend` `src/features/messaging/ui/MessagingPage.tsx:401` and `:511` | **The phone conversation panel overflows its card, and the newest message is off-screen when the room opens.**<br>• **Cause:** on narrow screens, the grid (`h-[calc(100vh-10rem)] min-h-[700px]`) stacks the room list above the conversation. The message list keeps `min-h-[520px]`, so it renders past its white card (`e2e-shots/run2/j5-conversation-after-scroll-rc-iph.png`).<br>• **Effect:** read receipts are viewport-based (IntersectionObserver), so the unread badge clears only after the user scrolls to the message. It did clear correctly once scrolled.<br>• **Fix:** scroll the conversation panel into view when a room is selected on mobile, and drop `min-h-[520px]` below `md`. |
| O2 | Low (UX) | `PasswordResetPage` toasts on phones | On Pixel 7, the "Code completed" and "Reset failed" toasts sit over the OTP inputs (`j6-reset-401-back-to-code-rc-pix.png`). The user must dismiss them or wait before re-entering the code. Function is unaffected. |

### Evidence

Screenshots are in `doc/release/e2e-shots/run2/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `j1-verify-rc-iph.png` | RC: "Email verified" with the Sign in to continue CTA |
| `j1-verify-prod-desk.png` | Deployed: R3 "Verification failed" |
| `j4-report-rc-desk.png` | RC: report sent with a reason selected |
| `j5-conversation-after-scroll-rc-iph.png` | O1: messages overflowing the card on a phone |
| `j6-reset-401-back-to-code-rc-pix.png` | 401 returns to OTP entry (O2 toasts visible) |
| `j7-spot-hint-smart-pix.png` | Spot Vision hint from the stub (Smart-Spot build) |
| `j8-spot-upload-failed-rc-iph.png` | Spot upload failure with Retry upload |
| `j10-partner-items-rc-iph.png` | Partner table at 390px, scrolling inside its card |
| `j11-login-cookie-rc-iph.png` | RC: the banner clears Log in |
| `j11-login-cookie-prod-iph.png` | Deployed: the banner covers Log in |

The raw JSON results, the harness (`h/*.js`) and the stubs are in the session scratchpad (`…/scratchpad/e2e2/`). They are not kept in the repo.
