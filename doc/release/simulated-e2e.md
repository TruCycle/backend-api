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

## Run 3 — fix verification (3ad8631)

> **Local simulation — not production evidence.**
> It ran on 26 Nov 2026 in the same kind of sandbox as Run 2: a throwaway `postgis/postgis:15-3.4` container, local `vite preview` servers and headless Chromium (Playwright 1.65) with the Run 2 network guard (only localhost allowed).
> - No remote database, hosted site or deploy was touched. Nothing was pushed or committed.
> - "iPhone 14" and "Pixel 7" are Playwright viewport and UA emulation in Chromium, not WebKit or real devices. In Chromium, `env(safe-area-inset-bottom)` is 0.

### Setup (local)

| Part | Value |
|---|---|
| Backend | `backend-api` HEAD **`aa4f996`** (PR #11) in a detached scratch worktree, run with `node dist/main.js` and `TYPEORM_SYNC=false`. `src/` and `package*.json` are identical to Run 2's `75b9411`. |
| Schema | `origin/main` `5bc53a8` booted once with `TYPEORM_SYNC=true` on an empty DB (ledger 26). Then HEAD's `npm run migration:run -- --apply --expect …027,…,…036`: all 10 applied, ledger 36. |
| Seed | Users registered through HEAD's `/auth/register` and activated by SQL.<br>• **dana** (donor): 25 listings inserted by SQL. The 7 **oldest** are in impact statuses: 5 `complete` + 2 `recycled`, with 4 `exchange` and 3 `donate`. CO2e is 1.2, 2.5, 3.7, 0.4, 10.1, 5.2 and **NULL**; the NULL was later set to 7.3, giving a sum of **30.4**. The other 18 listings carry CO2e values too, and they must not be counted. The listings API (`limit=20`) gives `total` 25 and 20 rows, and page 1 holds only 2 of the 7 impact items.<br>• **cole** (collector): 2 completed claims.<br>• **alice ↔ bob**: a room created with `POST /messages/rooms` and 30 messages sent through `POST …/messages/text`. The last two are from bob. alice's receipts for bob's older messages were inserted by SQL. Before each run, the receipts for messages 29–30 were deleted, so `unreadCount` = **2**. |
| Frontend under test | `web-frontend` **`3ad8631`** (scratch worktree of `uiadedo/frontend-release-candidate`), `npm ci && npm run build` with the Run 2 env, served on `:4175`. |
| Pre-fix baseline | **`3c3900b`** built the same way and served on `:4176`. It was used for the "unchanged" comparisons. |
| Viewports | iPhone 14 390×664; Pixel 7 412×839, plus Pixel 7 UA at **390×839**; 768×1024; 1024×768; 1440×900. |

### Results — `3ad8631`

| # | Check | Verdict | Evidence |
|---|---|---|---|
| F1a | Donor tiles, 25 listings, one NULL CO2e | **PASS** (1440, iPhone 14) | `/items/me/impact` returned `{total_co2_saved_kg:null, items_exchanged:4, items_donated:3}`. The tiles read **"25 Items listed", "7 Completed", "Unavailable Est. CO2e (completed)"**, and no "this page" text appears anywhere on the page. |
| F1b | Donor tiles after the NULL was fixed | **PASS** (1440, iPhone 14) | The API returned `total_co2_saved_kg` **30.4**, which equals the DB sum over `complete`/`recycled` (30.4). The tiles read **25 / 7 / "30.4kg"**. The pre-fix `3c3900b` on the same data showed "20 Items listed (this page) / 1 Completed (this page) / 1.2kg". |
| F1c | `/items/me/impact` routed to 500 | **PASS** (1440, iPhone 14) | Two 500 responses were seen. The tiles read **"25 / Unavailable / Unavailable"**, with no uncaught page errors. Console output was not captured for this session. |
| F1d | Collector-mode tiles | **PASS, unchanged** | On both `3ad8631` and `3c3900b`, cole's tiles read "2 Completed collections / Unavailable Completed exchanges / Unavailable Est. CO2e (completed)". There were **0** `/items/me/impact` requests in collector mode. |
| F2a | Messaging, iPhone 14 (390×664) | **FAIL** | **Containment is fixed:**<br>• The list (y 554–797) and the composer sit inside the card (477–868).<br>• The list scrolls internally (scrollHeight 3232 vs clientHeight 243, scrollTop 2989, so it is pinned to the bottom).<br>• Setting `list.scrollTop=0` leaves the page position unchanged.<br>• `scrollWidth == clientWidth == 390`.<br>**But the newest message (y 687–781) and the composer (811–855) are below the fold.** The visible area of the app-shell `<main>` scroller is y 80–595 (above the bottom Spot/List/Rescue nav), and `elementFromPoint` at the newest message returns nothing. **After opening, `unreadCount` went 2 → 1, not 0.** Two read calls were made, both returning 200, but the count still dropped only to 1. Which message was acknowledged was not recorded. Pre-fix `3c3900b`: the list overflowed the card (list bottom 1055 > card bottom 868), and unread stayed 2. |
| F2b | Messaging, Pixel 7 at 390×839 and 412×839 | **PASS** (one observation) | The newest message (687–781) is inside the viewport and inside the list. At 390×839, `elementFromPoint` at its centre hits the message bubble; this was not measured at 412. Its bottom ~11 px sit under the bottom nav, which starts at y 770: a hit-test 4 px above the bubble's bottom returned the nav at both widths. Read calls returned 200 and **`unreadCount` went 2 → 0** with no manual scroll. There is no horizontal overflow (390 and 412). The list is contained in the card and scrolls internally.<br>**Observation:** the composer (811–855) sits under the bottom nav, which starts at y 770, so the user must scroll `<main>` before typing. |
| F2c | Messaging, desktop 1440×900 | **PASS, unchanged** | The geometry is identical to `3c3900b`: card 192–791, list 269–720, newest 618–692, composer 734–778. Unread went 2 → 0 and the read call returned 200.<br>**Note:** at 1024×768 the new `grid-rows` also applies below `xl`. The conversation card grew from 270 to 307 px and stays contained, and unread went 2 → 0. |
| F3a | Wrong-code toast, phones | **PASS** (iPhone 14, Pixel 7 at 390) | After `reset-password` 401, the toast region is bottom-anchored (`bottom:16px`).<br>• On iPhone 14 the toasts sit at y 395–649. The OTP inputs (210–258) and Continue (310–358) are **not overlapped**, and `elementFromPoint` hits the button and all 6 inputs. Two toasts were showing; the top of the stack (y 395) cleared Continue by 37 px. The stack caps at 3 toasts (`maxVisibleToasts = 3`), and three 124 px toasts would start near y 264. **This is computed, not observed:** a third toast would cover Continue on a 664 px screen.<br>• On Pixel 7 at 390 the toasts sit at y 420–824, again with no overlap.<br>• Pre-fix `3c3900b` on iPhone 14: the toasts (95–349) covered the inputs and Continue, and the button hit-test failed. |
| F3b | Toast placement at ≥768 px | **PASS, unchanged** | At 768 and 1440 the region is `top:96px; right:16px` on both `3ad8631` and `3c3900b`, with identical toast boxes.<br>**Pre-existing, not new:** at both widths the top-right stack overlaps the right part of the OTP row and Continue (for example, at 1440 the toasts span x 1072–1424 and Continue spans x 816–1332). |
| F3c | Toast vs cookie banner, banner left open | **FAIL (new regression)** | On iPhone 14, the "Reset failed" toast (525–649) covers **both** "Reject optional" and "Accept optional" (587–631), and `elementFromPoint` at either button centre does not hit the button.<br>The same happens on Pixel 7 at 390: the toasts span 420–824 and the buttons 762–806.<br>The banner is `z-[90]` and the toasts are `z-[1300]`. The banner buttons only become usable again once the toasts are dismissed or expire. |

There were no uncaught page errors in any run.
- **Recorded console errors:** only the browser's "Failed to load resource … 401" line for the deliberate `reset-password` 401 in each toast run. Console output was not captured for the impact-500, collector and baseline dashboard sessions.
- **Recorded API errors:** only that 401 and the injected `/items/me/impact` 500s.

### New defects

| ID | Severity | Where | What |
|---|---|---|---|
| R3-1 | Medium (UX, read receipts) | `web-frontend` `src/features/messaging/ui/MessagingPage.tsx:401` | **On iPhone 14, the newest message and the composer are still off-screen when a room opens.**<br>• **Cause:** the grid keeps `min-h-[700px]` and `h-[calc(100vh-10rem)]` below `md`, and it starts at y 184 inside the app-shell `<main>` scroller. On iPhone 14, `<main>` shows only 515 px above the bottom nav, so the conversation card ends about 270 px below the fold.<br>• **Effect:** the viewport-based read receipt leaves `unreadCount` at 1. This is the Run 2 O1 effect, now only on shorter phones.<br>• **Fix options:** drop `min-h-[700px]` below `md` and size the grid to the visible `<main>` height (account for the header and the bottom nav, and use `dvh`), or scroll the conversation card into view when a room is selected on mobile.<br>• **Pixel 7:** the same grid height puts the composer under the bottom nav there too (F2b). |
| R3-2 | Low (UX) | `web-frontend` `src/shared/ui/toast/ToastProvider.tsx:123` with `src/shared/ui/site/TrackingConsentBanner.tsx:11` | **Bottom-anchored phone toasts (`z-[1300]`) cover the cookie banner's "Reject optional" / "Accept optional" buttons (`z-[90]`)** while the toasts are shown. Possible fixes: offset the toast stack above the banner when the banner is open, or place phone toasts above the bottom nav and banner. |

Run 2's O2 (toasts over the OTP inputs on phones) is **fixed**. Run 2's O1 is **fixed on Pixel-height screens** (839 px) and **not fixed on iPhone 14** (664 px); see R3-1.

### Evidence

Screenshots are in `doc/release/e2e-shots/run3/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `d-donor-tiles-fixed-d1440.png` | Donor tiles 25 / 7 / 30.4kg, with no "(this page)" text |
| `d-donor-tiles-impact500-iph.png` | `/items/me/impact` 500: the tiles show "Unavailable" and the page does not crash |
| `m-conversation-open-rc-iph.png` | R3-1: room open on iPhone 14, with the newest message and composer below the bottom nav |
| `m-conversation-open-rc-d1440.png` | Desktop 1440 messaging, the same as pre-fix |
| `t-reset-401-toast-rc-iph.png` | Wrong-code toasts at the bottom, clear of the OTP inputs and Continue |
| `t-reset-401-toast-cookie-rc-iph.png` | R3-2: toasts covering the cookie banner buttons |

The raw JSON (`results/r3-*.json`), the harness (`h/r3.js`, `h/seed.js`, `h/seed-msgs.js`, `h/diag.js`) and the logs are in the session scratchpad (`…/scratchpad/e2e3/`). They are not kept in the repo.

## Run 4 — re-verification (7b175ca)

> **Local simulation — not production evidence.**
> It ran on 26 Nov 2026 with the Run 3 method: a fresh throwaway `postgis/postgis:15-3.4` container, local `vite preview` servers and headless Chromium with the Run 2 network guard (only localhost allowed). The installed Playwright is **1.63.0**: the "1.65" given in Run 3 is the same install and was a typo.
> - No remote database, hosted site or deploy was touched. Nothing was pushed or committed.
> - Phones are Playwright viewport and UA emulation in Chromium, not WebKit or real devices. In Chromium, `env(safe-area-inset-bottom)` is 0.
> - Scope: only Run 3's two failures (R3-1, R3-2), plus regression checks around them.

### Setup (local)

| Part | Value |
|---|---|
| Backend | `backend-api` HEAD **`bd1a8d5`** (PR #11) in a detached scratch worktree, run with `node dist/main.js` and `TYPEORM_SYNC=false`. `src/` and `package*.json` are identical to Run 3's `aa4f996`. |
| Schema | The same as Run 3: `origin/main` `5bc53a8` booted once with `TYPEORM_SYNC=true` on an empty DB (ledger 26), then HEAD's `migration:run -- --apply --expect …027,…,…036`. All 10 applied, ledger 36. |
| Seed | alice, bob, carl and dave registered through HEAD and activated by SQL. alice has three rooms (with bob, carl and dave), each with **30 messages** sent through `POST …/messages/text`. Messages 29–30 in each room are from the other user. Before each session, alice's receipts were reset by SQL so that `unreadCount` = **2** in every room. dave's room is the most recent, so the page auto-selects it on load (`useMessages.ts:226`). bob and carl are then opened from the list. |
| Frontend under test | `web-frontend` **`7b175ca`** (scratch worktree of `uiadedo/frontend-release-candidate`), `npm ci && npm run build` with the Run 2 env, served on `:4175`. |
| Baseline | **`3ad8631`** (Run 3's build), built the same way and served on `:4176`. |
| Viewports | iPhone 14 390×664; iPhone SE (3rd gen) 375×667; Pixel 7 412×839; 768×1024; 1024×768; 1440×900. |

**How "visible" was measured:**
- The visible band is the app-shell `<main>` scroller clipped to the viewport: y 80–595 on iPhone 14, 80–598 on iPhone SE, 80–770 on Pixel 7, 72–839 at 1440 and 72–707 at 1024.
- On phones this band excludes the bottom Spot/List/Rescue nav.
- Each target was also hit-tested with `elementFromPoint` (at the centre of the newest message, 4 px above its bottom, and at the centre of the composer).

### Results — `7b175ca`

| # | Check | Verdict | Evidence |
|---|---|---|---|
| M1 | Messaging, iPhone 14 390×664 (R3-1) | **PASS** | `<main>` was scrolled back to the top and bob was opened from the list. `<main>` then scrolled 0 → 289 with no manual scroll.<br>• Newest message **398–492**, composer **522–566**, both inside the band (80–595). All three hit-tests hit the target.<br>• The list is pinned to the bottom (scrollTop 2989 of 3232) and `scrollWidth` is 390.<br>• **unread 2 → 0**, two read calls, both 200.<br>Baseline `3ad8631`: newest at 687–781 and composer at 811–855, both off-screen, and unread 2 → 1 (the Run 3 result reproduced). |
| M2 | Messaging, iPhone SE 375×667 | **PASS** | Newest **381–495**, composer **525–569**, band 80–598. The hit-tests pass and **unread 2 → 0** (read 200 ×2). There is no horizontal overflow. |
| M3 | Messaging, Pixel 7 412×839 | **PASS** (the Run 3 F2b observation is fixed) | `<main>` scrolled 0 → 114. Newest **573–667**, composer **697–741**, both above the bottom nav at 770, and the hit-tests pass. **unread 2 → 0** (read 200 ×2). |
| M4 | Switching rooms (bob → carl), all phones | **PASS** | `<main>` was scrolled back to 0 so the list could be reached, then carl was tapped. The card scrolled back into view with the same geometry as M1–M3, and carl's **unread went 2 → 0** (read 200). |
| M5 | Desktop 1440×900 | **PASS, unchanged** | The geometry matches `3ad8631` exactly: card 192–791, newest 618–692, composer 734–778. `<main>` and the document scrollTop stay 0. Unread 2 → 0 for bob and for carl (read 200). The effect is gated at `max-width: 1279.98px`, so it does not run here. |
| M6 | 1024×768: are positions unchanged vs `3ad8631`? | **FAIL (low; changed by design, R4-2)** | The new effect does run at 1024, because the panels are stacked below `xl`.<br>• **On load, with no user action,** `<main>` scrolls **0 → 29 px**. The card moves from 413–720 to 384–691 and the composer from 663–707 to 634–678.<br>• The **"Messaging" heading is clipped** (h1 not fully visible; it is visible on `3ad8631`).<br>On `3ad8631` the bottom 13 px of the card sat below `<main>`'s visible edge (707). It is now fully visible.<br>Unread 2 → 0 for both rooms. There is no horizontal overflow and the document itself never scrolls (`scrollingElement.scrollTop` stays 0). |
| T1 | Toast vs cookie banner: banner buttons (R3-2) | **PASS** | With the banner open, `--tc-consent-offset` is **194px** (iPhone 14, iPhone SE and Pixel 7) and the region is at `bottom: 210px`.<br>• iPhone 14: the stack ends at y 455 and the banner starts at 470.<br>• With 1, 2 and 3 toasts on all three phones, "Reject optional" and "Accept optional" are not overlapped and both hit-tests hit the button.<br>Baseline `3ad8631`: both buttons are covered and the hit-tests fail (R3-2 reproduced). |
| T2 | Clicking a banner button with toasts showing | **PASS** | The button was clicked with 3 toasts showing in each case:<br>• "Reject optional" on iPhone 14 and Pixel 7, and "Accept optional" on iPhone SE (and with 1 toast on iPhone 14).<br>• Each time the banner unmounted, `tc-tracking-consent` was stored (`rejected` / `accepted`), and the inline `--tc-consent-offset` was **removed**.<br>• The region returned to `bottom: 16px`; on iPhone 14 the toasts moved to 265–649.<br>• A wrong-code toast raised after dismissal sat at 525–649 (bottom-anchored). |
| T3 | Toasts vs OTP and Continue, **banner dismissed**, iPhone 14 / SE | **PASS for 1–2 toasts**; **3 covers Continue** | iPhone 14 with 2 toasts ("Code completed" + "Reset failed"): 395–649. The OTP row (210–258) and Continue (310–358) are clear, and all hit-tests pass. SE gives the same result (398–652).<br>**3-toast case, observed (it was only computed in Run 3):** 265–649 overlaps Continue, so the Continue hit-test fails. The OTP inputs stay clear. `3ad8631` behaves identically, so this is not new. |
| T4 | Toasts vs OTP and Continue, **banner open**, iPhone 14 / SE | **FAIL (new, R4-1)** | Because the stack is lifted by 194 px, **one** "Reset failed" toast (iPhone 14: 331–455; SE: 334–458) overlaps Continue (310–358).<br>• On iPhone 14 the Continue hit-test fails. In the mouse-driven run, Playwright's click on Continue waited 30 s and timed out. This was likely because the harness pointer was over the toast, and hovering pauses auto-dismiss (`ToastProvider.tsx:132`). Not measured.<br>• **Two toasts** (201–455) also cover **all 6 OTP inputs** (every hit-test fails). Two toasts is the normal case after a wrong code, because re-typing the code raises "Code completed" (`PasswordResetPage.tsx:125/183`).<br>• **Three toasts** sit at 71–455.<br>• **The happy path is affected too.** On iPhone 14 with the banner open, filling the code on the first attempt raises "Code completed" at 331–455, over Continue, and the Continue hit-test fails. With the banner dismissed, the same toast sits at 525–649 and Continue is clear.<br>• Pixel 7 with the banner open: 1–2 toasts are clear (376–630); 3 toasts (246–630) cover Continue, the same as T3.<br>• On `3ad8631` with the banner open, 1–2 toasts sat at 395–649: clear of the OTP row and of Continue, but covering the banner buttons. 3 toasts (265–649) covered Continue. |
| T5 | Desktop ≥768 placement | **PASS, unchanged** | At 768 and 1440 the region is `top: 96px; right: 16px` and the toast boxes are identical on `7b175ca` and `3ad8631`: 1440 x 1072–1424, y 95–219 / 225–349; 768 x 400–752.<br>With the banner open at 1440, the variable is set (130px) but has no effect (`md:bottom-auto`), and the banner buttons pass the hit-test.<br>The top-right stack's overlap with the OTP row and Continue is pre-existing, the same as Run 3 F3b. |

There were no uncaught page errors in any session.
- **Recorded console errors:** only the browser's "Failed to load resource … 401" line for each deliberate `reset-password` 401.
- **Recorded API errors:** only those 401s.

### New defects and observations

| ID | Severity | Where | What |
|---|---|---|---|
| R4-1 | Medium (UX, regression from the R3-2 fix) | `web-frontend` `src/shared/ui/toast/ToastProvider.tsx:123`, with `src/shared/ui/site/TrackingConsentBanner.tsx:17` | **On phones of about 664–667 px height with the cookie banner open, the lifted toast stack covers the reset form.**<br>• The stack is lifted by the banner height (194 px), so it now starts at y ≈ 455.<br>• A single toast covers Continue, and the usual two toasts after a wrong code also cover the OTP inputs. Until the toasts expire (3.4 s, or longer while hovered or focused), the user cannot tap Continue or the code boxes.<br>• This applies even on a first, correct attempt, because filling the code raises "Code completed" over Continue.<br>• Before this fix, the same toasts covered the banner buttons instead (R3-2).<br>• **Fix options:**<br>&nbsp;&nbsp;– Cap the region's `max-height` to the space above the banner, for example `max-h-[calc(100dvh-7rem-var(--tc-consent-offset,0px))]`, and show fewer toasts.<br>&nbsp;&nbsp;– Or move phone toasts to the top while the banner is open.<br>&nbsp;&nbsp;– Or stop raising the "Code completed" info toast on the reset page. |
| R4-O1 | Low (observation) | `web-frontend` `src/features/messaging/ui/MessagingPage.tsx:209-210`, with `src/features/messaging/hooks/useMessages.ts:226` | **On phones, the page auto-scrolls past the room list on load.**<br>• `/messages` auto-selects `rooms[0]`, so the new scroll-into-view effect runs on load as well as on tap.<br>• On iPhone 14, `<main>` lands scrolled to 289 px. The "Messaging" heading is off-screen and the room list card sits at y −89 to 172, so only about one room row shows in the band.<br>• Choosing another conversation needs a manual scroll up (M4). |
| R4-2 | Low (layout change at a desktop width) | `web-frontend` `src/features/messaging/ui/MessagingPage.tsx:209` | **The `max-width: 1279.98px` gate includes 1024-wide desktops and tablets, so the scroll effect also runs there.**<br>• At 1024×768, `<main>` scrolls by 29 px **on load** and the "Messaging" heading is clipped (M6).<br>• The fix intends this for the stacked layout, but positions are not unchanged versus `3ad8631`.<br>• **Options:**<br>&nbsp;&nbsp;– Gate the effect on phone widths only (e.g. `max-width: 767.98px`).<br>&nbsp;&nbsp;– Or skip it when the card is already mostly visible.<br>&nbsp;&nbsp;– Or run it only on a user tap, not on auto-select. |

**Status of Run 3 defects:**
- **R3-1 is fixed** on iPhone 14, iPhone SE and Pixel 7: the newest message and the composer are visible and unread clears to 0.
- **R3-2 is fixed** (the banner buttons are clear and clickable, and the variable is removed when the banner closes), but the fix introduces **R4-1**.

### Evidence

Screenshots are in `doc/release/e2e-shots/run4/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `m-open-iph14.png` | M1: bob's room opened from the list on iPhone 14, with msg 30 and the composer above the bottom nav. The room list is mostly scrolled away (R4-O1). |
| `t-cookie-1toast-iph14.png` | R4-1: banner open, one "Reset failed" toast over Continue, banner buttons clear |
| `t-cookie-3toasts-iph14.png` | T1 / R4-1: three toasts above the banner, covering the OTP row and Continue |
| `t-after-reject-iph14.png` | T2: after "Reject optional", the banner is gone and the toasts are back at the bottom |

The raw JSON (`results/r4-msg.json`, `r4-toast.json`, `r4-toastk.json`, `r4-shot1.json`, `r4-otp1.json`), the harness (`h/r4.js`, `h/seed.js`, `h/diag-land.js`, `h/lib.js`) and the logs are in the session scratchpad (`…/scratchpad/e2e4/`). They are not kept in the repo.
