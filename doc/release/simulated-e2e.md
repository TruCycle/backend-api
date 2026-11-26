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

## Run 5 — verification (3fd8ac6)

> **Local simulation — not production evidence.**
> It ran on 26 Nov 2026 with the Run 4 method and harness (copied to a new scratch folder): a fresh throwaway `postgis/postgis:15-3.4` container, local `vite preview` servers and headless Chromium (Playwright 1.63.0) with the Run 2 network guard (only localhost allowed).
> - No remote database, hosted site or deploy was touched. Nothing was pushed or committed. The `web-frontend` clone was not edited; every build came from a detached scratch worktree.
> - Phones are Playwright viewport and UA emulation in Chromium, not WebKit or real devices. `env(safe-area-inset-top)` is 0 in Chromium. `index.html` has no `viewport-fit=cover`, so it is also 0 in mobile Safari outside a home-screen app.
> - Scope: the two changes in `3fd8ac6` (phone toasts pinned to the top with only the newest visible; the messaging scroll runs only on a room tap below 768 px), plus J1 and J6 on iPhone 14.

### Setup (local)

| Part | Value |
|---|---|
| Backend | `backend-api` HEAD **`1ed7912`** (PR #11; docs-only over Run 4's `bd1a8d5`) in a detached scratch worktree, `node dist/main.js`, `TYPEORM_SYNC=false`. |
| Schema | The same as Run 4: `origin/main` `5bc53a8` booted once with `TYPEORM_SYNC=true` (ledger 26), then HEAD's `migration:run -- --apply --expect …027,…,…036`. All 10 applied, ledger 36. |
| Seed | The same as Run 4: alice with three rooms (bob, carl, dave), 30 messages each, and unread reset to **2** per room by SQL before each session. dave's room is the most recent, so it is auto-selected on load. In the UI, each room is labelled "Community member", so rooms were picked by their last-message preview. |
| Frontend under test | `web-frontend` **`3fd8ac6`**, `npm ci && npm run build` with the Run 2 env, on `:4175`. |
| Baselines | **`7b175ca`** on `:4176` (toasts at 768, 1024 and 1440; messaging at 768 and 1440) and **`3ad8631`** on `:4177` (messaging at 1024). Both were built the same way. |
| Viewports | iPhone 14 390×664; iPhone SE (3rd gen) 375×667; Pixel 7 412×839; 768×1024; 1024×768; 1440×900. |

**Method changes from Run 4:**
- Toasts hidden by `display:none` are counted separately from visible ones (`getClientRects`). Overlaps and hit-tests use only the visible toast.
- A grid of `elementsFromPoint` samples lists every interactive element under the visible toast.
- A MutationObserver records when each toast is added and removed, to give the auto-dismiss duration.
- Phone actions use `page.tap` with a 3–4 s timeout, so a covered control fails fast instead of waiting for the toast to expire.
- On messaging, the first tap is made from the landing position with no manual scroll.

### Results — `3fd8ac6`

| # | Check | Verdict | Evidence |
|---|---|---|---|
| T1 | Reset page: wrong code ×1/×2/×3 and "Code completed", cookie banner **open** and **dismissed**, on iPhone 14, iPhone SE and Pixel 7 | **PASS** | Every case below held on all three phones, with the banner open and with it dismissed.<br>• **Placement:** the region is at `top: 8px; right: 16px`. The visible toast is at **y 7–131** (151 for the two-line "Reset code requested").<br>• **One toast, the newest:** with 1, 2 or 3 toasts in the DOM, exactly one is visible and it is the last child. It reads "Code completed" after the code is filled and "Reset failed" after each 401.<br>• **Inputs clear:** the OTP row (iPhone 14 and SE 210–258; Pixel 7 186–234) and Continue (310–358; Pixel 7 286–334) do not overlap the toast, and all hit-tests pass. Gap to the OTP row: 79 px on iPhone 14/SE, 55 px on Pixel 7. On the password step, the submit button (386–435) is clear too.<br>• **Taps:** every tap on Continue and submit went through in about 60 ms.<br>• **Banner buttons:** "Reject optional" and "Accept optional" (iPhone 14 587–631) are never overlapped, and both hit-tests pass. Tapping them with a toast showing closed the banner and stored `rejected` / `accepted`.<br>• **Cleanup and errors:** `--tc-consent-offset` is never set (`null` in every measurement, including with the banner open), there is no horizontal overflow, and the only API errors were the three deliberate 401s.<br>• **Screen readers:** the visible toast has `role="alert"` for errors and `role="status"` for info and success, with `aria-atomic="true"`.<br>• **Dismiss:** it removes the visible toast (see R5-O1). |
| T2 | Top toast over the app-shell header (after sign-in, `/dashboard`), on iPhone 14, iPhone SE and Pixel 7 | **PASS, with a cost (R5-O2)** | **What it covers:**<br>• "Login successful" sits at **y 7–131**, and the header is 8–80. The grid sample puts **"Open sidebar menu", "Notifications" and "Open profile menu"** under it. The menu and profile hit-tests fail; the Notifications link was not hit-tested directly.<br>• On Pixel 7 the toast spans x 44–396, so it partly covers the menu button (x 24–68), and that hit-test fails too.<br>• A tap on the menu while the toast is showing timed out after 1.5 s.<br>**How long:** it auto-dismisses after **3.40 s** (3396–3399 ms measured; `defaultDurationMs`). Per the code (not measured), hovering or focusing it pauses the timer.<br>**Menu after dismissal:** after it expired, and also after a tap on Dismiss, a tap on the menu opened `#mobile-sidebar` with `aria-expanded="true"`. |
| T3 | Desktop and 768 toast positions vs `7b175ca` | **PASS, identical** | On both builds the region is `top: 96px; right: 16px` and the toast boxes match exactly.<br>• **x ranges:** 768 x 400–752; 1024 x 656–1008; 1440 x 1072–1424.<br>• **y ranges:** 95–219, 225–349 and 355–479. All stacked toasts are visible (the "newest only" rule applies below 768 only).<br>• **Cookie banner open at 1440:** no change in toast position, and the banner buttons pass their hit-tests.<br>• **Pre-existing, unchanged:** the top-right stack still overlaps the OTP row at 768, 1024 and 1440, and Continue at 2–3 toasts (Run 3 F3b). |
| M1 | Messaging, phones: load, tap a room, switch rooms | **PASS** | **On load:** `<main>` and the document stay at scrollTop **0** for the whole 2.5 s sample (max 0) on iPhone 14, SE and Pixel 7. The "Messaging" h1 (104–140) and the room-list card are in view. The auto-selected dave row is hit-testable.<br>**Tap from the landing position (dave):**<br>• iPhone 14: `<main>` 0 → **289**. Newest message **398–492**, composer **522–566**, band 80–595; all hit-tests pass.<br>• SE: 0 → 286; newest 381–495, composer 525–569.<br>• Pixel 7: 0 → 114; newest 573–667, composer 697–741.<br>• **Unread → 0** in every case.<br>**Switching (bob, then carl):** `<main>` was scrolled back to 0, and each tap repeated the same geometry. **Unread 2 → 0** for each room (read calls 200). There is no horizontal overflow.<br>**Baseline `7b175ca`:** an unsaved one-off probe on iPhone 14 showed scrollTop **289** on load (R4-O1 reproduced); it is not in the saved JSON. |
| M2 | 1024 and 1440 (plus 768): no scroll; layout vs baselines | **PASS, identical** | `<main>` and document scrollTop stay **0** on load (max 0) and after every tap.<br>• **1024 vs `3ad8631`:** card **413–720**, newest **547–621**, composer **663–707**, h1 visible, on both builds.<br>• **1440 vs `7b175ca`:** card **192–791**, newest **618–692**, composer **734–778**, on both builds (the same as Run 4).<br>• **768 vs `7b175ca`:** card 491–915, composer 858–902, on both builds.<br>• Unread 2 → 0 for all three rooms at every width, and all hit-tests pass. **R4-2 is fixed.** |
| J1 | Sign-up, verify, sign-in on iPhone 14 | **PASS** | `register` returned 201 and the user was `pending`. The verify link (`POST`) returned 200 and the user became `active`. Sign-in returned 200 and landed on `/dashboard`.<br>The toasts showed one at a time at the top: "Account created" (7–171) and "Login successful". There were no API or page errors. |
| J6 | Reset happy path on iPhone 14 | **PASS** | `forget-password` returned 201. "Code completed" was at 7–131 with the OTP row and Continue clear and hit-testable; the earlier "Reset code requested" toast stayed hidden in the DOM. Taps on Continue and submit went through.<br>`reset-password` returned 201 and the page redirected to `/login`. The old password then gave 401 and the new one 200. There were no errors. |

There were no uncaught page errors in any session. The only recorded API and console errors were the deliberate `reset-password` 401s.

### New defects and observations

| ID | Severity | Where | What |
|---|---|---|---|
| R5-O1 | Low (UX) | `web-frontend` `src/shared/ui/toast/ToastProvider.tsx:123` (`max-md:[&>article:not(:last-child)]:hidden`), with the 3-toast cap at `:27`/`:78` | **On phones, Dismiss reveals an older toast.** Older toasts are only hidden, so they are still alive.<br>• After a wrong code, tapping Dismiss on "Reset failed" brought back the hidden **"Code completed — OTP filled. Press Continue to verify"** at the same spot (7–131). After a failed attempt, this message is stale.<br>• It stayed until its own timer ran out, about **2.7 s** later. This happened on all three phones.<br>• One tap therefore does not clear the top of the screen.<br>• **Options:** on phones, cap the stack at one toast (drop older ones instead of hiding them), or have Dismiss clear the hidden ones too. |
| R5-O2 | Low (by-design trade-off) | `ToastProvider.tsx:123` (`top-[calc(0.5rem+…)]`) | **On app-shell pages, the top toast covers the whole phone header for 3.4 s.** The menu, notifications and profile buttons cannot be tapped until it expires or is dismissed. Per the code (not measured), hovering or focusing it extends the time.<br>• On the reset page the translucent toast overlaps the "Reset Your Password" heading, which hurts legibility (screenshot), but no controls.<br>• It works after dismissal.<br>• **Options, if wanted:** offset phone toasts below the 80 px header on app-shell routes, or shorten success toasts. |
| R5-O3 | Low (observation, pre-existing) | `src/features/messaging/ui/MessagingPage.tsx:284` | **The auto-selected room can be partly marked as read while off-screen.** On load the page no longer scrolls, so on iPhone 14 and SE dave's unread count goes **2 → 1**, not 0.<br>• Likely cause: message 29 is mostly behind the bottom nav, and any intersection (`intersectionRatio > 0`) counts as read.<br>• Message 30 stays unread until the user taps the room (then 0).<br>• `3ad8631` behaved the same (Run 3). |

**Status of Run 4 items:**
- **R4-1 is fixed:** phone toasts no longer sit over the OTP row, Continue or the banner buttons, with the banner open or dismissed.
- **R4-O1 is fixed:** there is no scroll on load on phones.
- **R4-2 is fixed:** 1024 is identical to `3ad8631`.
- **Unchanged:** the room-list scroller is 97 px tall on phones, so only about 1.4 rows are visible at once.

### Evidence

Screenshots are in `doc/release/e2e-shots/run5/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `t-cookie-1toast-top-iph14.png` | T1: banner open, "Reset failed" pinned at the top; OTP row, Continue and the banner buttons are clear. The toast overlaps the page heading (R5-O2). |
| `t-login-toast-header-iph14.png` | T2 / R5-O2: "Login successful" covering the app-shell header (menu, notifications, profile) |
| `m-landing-iph14.png` | M1: `/messages` on load, no scroll; heading and room list visible |
| `m-open-bob-iph14.png` | M1: after tapping a room, the newest message and composer are above the bottom nav |

The raw JSON (`results/r5-toast.json`, `r5-desk.json`, `r5-t2.json`, `r5-msg.json`, `r5-j.json`) and the harness (`h/r5.js`, plus `h/lib.js` and `h/seed.js` copied from Run 4) are in the session scratchpad (`…/scratchpad/e2e5/`). They are not kept in the repo.

## Run 6 — pre-merge alignment gate (19b88ca + 10896fe)

> **Local simulation — not production evidence.**
> This is the owner's alignment gate (`closeout-plan.md`, "Standing rule from the owner: alignment before any merge"), run on 26 Nov 2026 in a sandbox.
> - It used a fresh throwaway `postgis/postgis:15-3.4` container, local `vite preview` servers and headless Chromium (Playwright 1.63.0) with the Run 2 network guard (only localhost allowed; Cloudinary simulated; Vision Worker and geocoder stubbed).
> - No remote database, hosted site or deploy was touched. Nothing was pushed, committed or merged. Neither clone was edited; every build came from a detached scratch worktree.
> - Phones are Playwright viewport and UA emulation in Chromium, not WebKit or real devices.

**Verdict: GATE FAIL.** The only blocker is contract mismatch **C1** (`POST /qr/scan` is rejected by the backend's validation pipe). It is **pre-existing**: origin/main `5bc53a8` and the deployed frontend `83d30d6` behave the same way, so it is not a regression from this pair. Everything else passed:
- Every other contract check.
- All 12 Run 2 journeys, plus the Run 3–5 checks, on all five viewports.
- The old-client checks.
- The local CI reproduction on both heads.
- The merge-conflict check.

**C3** (the individual leaderboard returns 500) is also pre-existing and user-visible: the Community Board "Individual" tab (`CommunityBoardPage.tsx:85`) cannot load. It is a backend defect, not a shape mismatch, but the owner should waive or fix it together with C1. If either head changes, steps 2–4 must run again.

### Pinned pair

| Side | SHA | Notes |
|---|---|---|
| Backend | `19b88ca` (PR #11) | `git diff 75b9411 19b88ca -- src package.json package-lock.json` is empty. While the run was in progress, the branch moved to `4466281` with three doc-only commits (`60ef36b`, `fed66b2`, `4466281`). `git diff --stat 19b88ca 4466281 -- . ':!doc'` prints nothing, and `merge-tree` against `origin/main` is still clean, so the pin holds under the runbook rule. |
| Frontend | `10896fe` (PR #25) | Default build on `:4175`. A `VITE_ENABLE_SMART_SPOT=true` build (`dist-smart`) on `:4176` was used for J7 only. |
| Deployed frontend (old client) | `83d30d6` | Served on `:4173`. |

### Setup (local)

| Part | Value |
|---|---|
| Schema | Fresh DB. `origin/main` `5bc53a8` booted once with `TYPEORM_SYNC=true` (ledger 26). alice and bob were registered through main, with a room through main's `POST /messages/rooms`, and one **pre-migration message** (bob → alice, 2 days old) inserted by SQL. Then HEAD's `npm run migration:run -- --apply --expect …027,…,…036`: all 10 applied, ledger 36. **The 0036 backfill created exactly 1 receipt.** |
| Backend | `node dist/main.js`, `TYPEORM_SYNC=false`, `JWT_EXPIRES_IN=15m`. No email provider and no rate-limit flags. Vision Worker and Nominatim were local stubs. |
| Seed | Through the API where possible: per-device `j2-*`, `rs-*`, `vis-*` and `cf-*` users; 20 found items by `poster` (12 in E1 6AN, 8 in N1 9GU); carol (partner, shop created at registration) with 6 dropped-off items; dana with 25 listings (the Run 3 seed: 7 impact items, one NULL CO2e); cole (2 completed claims); malice with three 30-message rooms (the Run 4/5 seed). **dana's total is 31, not 25**, because the 6 partner-shop items were seeded with dana as the donor. |
| Viewports | Desktop 1440×900, desktop 1024×768, Pixel 7 412×839, iPhone 14 390×664, iPhone SE (3rd gen) 375×667 |

### Step 1 — contract check at the pinned SHAs

**Method:**
- **Static.** Every `apiRequest`, `apiRequestBlob` and `fetch` in `web-frontend/src` (74 call sites across 15 files), plus the socket namespaces and events, matched against the controllers, the DTOs (`src/main.ts:29-34`: `whitelist` + `forbidNonWhitelisted` + implicit conversion) and the response shapes. A sweep of every `@Body()`/`@Query()` DTO found only one class with no validators: `ScanDto`.
- **Live.** `h/probe.js` sent 83 requests built exactly as the frontend builds them (including multipart and Socket.IO), and asserted the fields that the frontend reads or validates. **79/83 passed.** Of the 4 failures:
  - 3 are C1–C3 below.
  - 1 is a business rule (`PATCH /found-items/:id/status` on a closed item → 400). A second call on an open item gave 200 `picked_up`.

**Mismatches:**

| ID | Area | Frontend (`web-frontend` @ `10896fe`) | Backend (`backend-api` @ `19b88ca`) | Effect | Status |
|---|---|---|---|---|---|
| **C1** | QR scan | `src/features/items/api/itemsApi.ts:307` sends `{qrPayload, direction, shopId?}` + `Idempotency-Key`. It is called from `src/features/collected/hooks/useCollectedItems.ts:79` (`CollectedItemsPage.tsx:83`, the QR collection path). `src/features/partner/api/partnerApi.ts:381` is the same call, with no caller. | `src/modules/qr/qr.controller.ts:11-16`: `ScanDto` has no class-validator decorators, so the global pipe rejects every property. | **400** `property qrPayload should not exist, property direction should not exist`. A collector's QR-confirmed collection fails with "Collection could not be confirmed"; `collectItem` is never reached. Manual confirmation (no QR) is unaffected. | **Blocking per the gate. Pre-existing:** the same on `origin/main` (same file, last changed in `0d4ea09`) and on deployed `83d30d6`. |
| C2 | Wallet balance | `src/features/items/api/itemsApi.ts:284-297` reads `balance ?? points ?? available`. | `src/modules/rewards/rewards.controller.ts:20-31` returns `availableAmount`. | The balance would always read 0. **`fetchWalletBalance` has no caller**, so nothing is visible today. | Latent; pre-existing (main returns the same shape). |
| C3 | Individual leaderboard | `src/features/gamification/api/gamificationApi.ts:425` via `hooks/useIndividualLeaderboard.ts:21`. The request shape is correct (`limit`, `offset`). | `src/modules/gamification/gamification.service.ts:325-333` returns **500** (`TypeError`) for every user and every query tried. The likely cause is `orderBy` on raw column names (`progress.total_points`, `progress.created_at`) together with `leftJoinAndSelect` + `skip`/`take`. | The Community Board "Individual" tab (`src/features/gamification/ui/CommunityBoardPage.tsx:85` → `components/IndividualLeaderboard.tsx:15`) cannot load. | A backend defect, not a shape mismatch. **Pre-existing:** `origin/main` booted on the same DB on `:3001` also returns 500, and main's query has the same `leftJoinAndSelect` + `orderBy('progress.total_points')` + `skip`/`take` lines. The server log shows only the error class, so the root cause is inferred. |

Note: with attachments off, `POST …/messages/image` returns 503, but the body message is the generic "An unexpected error occurred" instead of the guard's text. There is no user impact, because the frontend button is disabled.

**Called-out items (all aligned):**

| Item | Result |
|---|---|
| Vision `context` | `image + context=spot` → 200, and the stub received `prompt="Analyze this item spotted on a UK street…"`. `context=listing` → 200, and the stub received `image` only. A non-admin `prompt` → 403, so `InternalVisionPage` is admin-only. Multer limits (`fields:1`) fit the one `context` field. |
| Verify with no tokens | `POST /auth/verify {token}` → `{verified:true}` with no `tokens` key. The frontend (`authApi.ts:163-176`) checks only `verified === true`. |
| Login, refresh, logout, sessions | Login returns `tokens.{accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry}`. Refresh returns `user` + `tokens`; the refresh token is session-bound and comes back unchanged, and the frontend keeps the old one when it is absent (`authApi.ts:297`). `logout {refresh_token}` and `logout {access_token}` (both frontend branches) → 200, and that session's refresh → 401. `logout-all` → 200, all refresh tokens dead. #25 has no session list or logout-all control. |
| Found-item search params | `includeRecentClosed, category, status, maxDistance, postcode, sortBy, page, limit` are all whitelisted (`search-found-items.dto.ts`). The page sends only these. |
| Report reasons | The UI offers `already_gone, unsafe, misleading, duplicate, other` (`not_there` only with an active claim), and each is stored exactly. Old-client free text → `other`, with the text kept in details (R5 shim and D1 fix). |
| Read receipts | `POST /messages/rooms/:id/read {messageIds}` → `{readMessageIds ⊆ ids, unreadCount}`. Rooms carry `unreadCount`. The socket emits `messages:read`. |
| Message attachments | Off on both sides: the button is disabled ("Image attachments are unavailable"), and the upload and GET return 503. Upload field names (`clientMessageId`, `image`) match `SendImageMessageDto`. |
| Socket auth and events | `/messages` and `/notifications` accept `auth.token` → `auth:ready`. A bogus token → no `auth:ready`, server disconnect. `message:new` (no `room:join` needed), `room:activity`, `room:cleared`, `room:deleted`, `presence:update`, `messages:read`, `notification:new`, `notification:read:changed` and `rescue:new` / `rescue:flytip` all match the listeners. |
| Notifications envelope | The list is an array of `{id, title, body, data, read, readAt, createdAt}`. `unread-count` → `{count}`. `read` and `read-all` → `{updated}`. `limit=50` is within `Max(100)`. |
| Impact and listing totals | `/items/me/impact` → `total_co2_saved_kg` (number or null), `items_exchanged`, `items_donated`. `/items/me/listed` → `pagination.{page, limit, total, total_pages}`, with `total` 31 against 20 rows on page 1. |
| Gamification | `progress`, `streaks`, `badges?filter`, `points/history`, `community-board?window`, `impact/found-items` and `badges/:id/seen` (204) all match. The leaderboard fails (C3). |
| Claims and QR | `POST /claims {item_id}`, `PATCH /claims/:id/approve`, `POST /items/:id/collect {}` → `status: complete`, `GET /qr/item/:id/view`, `dropoff-in {shop_id, action}` and `claim-out {shop_id}` all match. The exception is `/qr/scan` (C1). |
| Other | Register, Google (shape only), forget/reset/resend, profile PATCH (snake_case via `@Expose`), `/items` create (snake_case), `/shops` create and patch, `/shops/nearby`, `/shops/me/items` and `upgrade-to-partner` (flat shop body; no tokens returned, which the frontend handles) all match. |

### Step 2 — simulated E2E on the pinned pair

Devices: D14 = 1440, D10 = 1024, P7 = Pixel 7, i14 = iPhone 14, SE = iPhone SE. "N/A" means the check does not apply on that device by design.

| # | Journey | D14 | D10 | P7 | i14 | SE | Evidence |
|---|---|---|---|---|---|---|---|
| J1 | Signup → verify → sign in | PASS | PASS | PASS | PASS | PASS | Register 201 → `pending`. Verify POST 200 → `active`. "Sign in to continue" leads to `/login`; login 200 → `/dashboard`. |
| J2 | Persist, sign out, logout-all | PASS | PASS | PASS | PASS | PASS | Reload keeps the session. Logout 200 revokes the row (1/1; D14 1/2 because of an earlier API login). Logout-all 200 revokes every row (3/3; D14 4/4), and both contexts go to `/login` after `/auth/me` 401 and `/auth/refresh` 401. |
| J3 | Found items: no location, postcode | PASS | PASS | PASS | PASS | PASS | Both queries returned 200 with 9 cards, and `scrollWidth` equals the viewport. |
| J4 | Spot report with reason | PASS | PASS | PASS | PASS | PASS | Send stays disabled until a reason is chosen. Stored: `unsafe / Broken glass…`, `duplicate / <null>`, `already_gone / <null>`, `misleading / Not a chair`, `other / Blocking a doorway`. |
| J5 | Messaging: badge, read, reload | PASS | PASS | PASS | PASS | PASS | The legacy receipt exists, so unread was 0 before the run. Badge 1, the read call returned 200, and the count went to 0 with **no scroll** on every device. Legacy and new messages both render. |
| J6 | Password reset | PASS | PASS | PASS | PASS | PASS | A double-click sends 1 request. Wrong code → 401, back to the code step and cleared. Valid code → 201 → `/login`, and the hash is cleared. Reuse → 401 (API and UI). Old password 401, new password 200. |
| J7 | Vision Spot / listing (Smart build) | N/A / PASS | N/A / PASS | PASS | PASS | PASS | Desktop shows the "uses the mobile camera" notice. Spot sends `context=spot` and the stub got the Spot prompt; the listing call sends `context=listing` and the stub got image only. Hint shown, all 200. |
| J8 | List camera + upload; Spot retry | PASS / N/A | PASS / N/A | PASS | PASS | PASS | Live camera 640×480 → 1, then 2 thumbnails, 0 failed. 0 Vision calls with the flag off. Spot: "Photo upload failed" → Retry → "Confirm details". |
| J9 | Confetti once per new badge | PASS | PASS | PASS | PASS | PASS | Canvas inserts 1, 0, 0, then 1 (second badge), then 0. |
| J10 | Phone layout (listings, messages, partner tables) | N/A | N/A | PASS | PASS | PASS | No horizontal overflow. Previous/Next and "Load more spots" (8 → 14) are visible. Partner tables of 695 and 1000 px scroll inside `overflow-x:auto` wrappers. |
| J11 | Cookie banner vs Log in | PASS | PASS | PASS | PASS | PASS | Log in is clear of the banner, and the hit-test lands on the button (i14: 408–456 vs a banner from 470; SE: banner from 473). |
| J12 | Keyboard sign-in | PASS | PASS | N/A | N/A | N/A | Tab order is the same as Run 2, and every stop shows `:focus-visible` with a ring. Enter → 200 → `/dashboard`. |
| R3 | Donor tiles (null CO2e → 30.4 → impact 500 → collector) | PASS | PASS | PASS | PASS | PASS | Tiles read 31 / 7 / "Unavailable", then 31 / 7 / **30.4kg** (equal to the DB sum). With an injected 500: 31 / Unavailable / Unavailable, with no page errors. Collector: 2 completed collections and 0 impact calls. No "this page" text. |
| R4/5 | Phone messaging: land, tap, switch | PASS | PASS | PASS | PASS | PASS | No scroll on load. On a tap, `<main>` scrolls 0→289 (i14), 0→286 (SE) and 0→114 (P7), and 0 on D10 and D14. The newest message and the composer are in the visible band and pass all hit-tests. Unread 2 → 0 per room. The geometry is identical to Run 5. |
| R5 | Phone toasts (banner open and dismissed) + **dismiss clears hidden stack** | PASS | PASS | PASS | PASS | PASS | Phones: one visible toast at y 7–131. The OTP row, Continue and the banner buttons are clear and all hit-tests pass. **Dismiss: 3 toasts in the DOM (1 visible) → 0 at +150 ms** on P7, i14 and SE, with the banner open and dismissed. Run 5's R5-O1 is fixed. The login toast expires at 3.40 s or is dismissed at about 0.38 s, after which the menu opens. Desktops: `top:96px; right:16px`, the same boxes as Run 5. |

Old client `83d30d6` against this backend:

| # | Verdict | Evidence |
|---|---|---|
| J1 (D14, i14) | **EXPECTED-FAIL (R3), criteria met** | Verify 200 and the DB moved to `active`. The page shows "Verification failed"; R3 is deliberate and is not reverted. A manual sign-in returned 200 → `/dashboard`. |
| J3 (D14, i14) | **PASS (R4 shim)** | `status=available&maxDistance=5&sortBy=nearest&page=1&limit=9` with no location → 200, 9 cards. |
| J4 (D14, i14) | **PASS (R5 shim)** | `{"reason":"Blocking the pavement"}` was stored as `other / Blocking the pavement`. With details added, it was stored as `other / Blocking the pavement — Next to the bus stop`. |
| J11 (i14) | Known, unchanged | The banner covers Log in on the deployed client; #25 fixes this. |

There were no uncaught page errors in any session. The only API errors were the deliberate ones: J2's 401s after logout and logout-all, J6's 401s, the T1 wrong codes, and the injected impact 500s. The Spot pages log `ERR_BLOCKED_BY_CLIENT` for `api.postcodes.io`, which is a sandbox artifact.

Still open from Run 5 and unchanged:
- **R5-O2:** the top toast covers the phone header for 3.4 s.
- **R5-O3:** on i14 and SE, the auto-selected room drops 2 → 1 on landing.

### Step 3 — CI and merge conflicts

**CI, local evidence:** the scratchpad CI logs from earlier sessions (`run_*.log`, `fe-ci.log`) predate both heads (13:06–14:48 against commits at 16:33 and 16:41), so they do not count. The workflows' own commands were re-run at the pinned SHAs in the scratch worktrees. **This is a local reproduction, not a GitHub Actions status; the Actions result is not evidenced locally.** Locally Node 22.23.5 and npm 10.9.9 were used; CI uses Node 24.18.0 and npm 11.16.0.

| Repo @ SHA | Steps (`.github/workflows/checks.yml`) | Result |
|---|---|---|
| backend `19b88ca` | `npm ci --ignore-scripts`, typecheck, lint, `test:unit`, build | All exit 0. Lint 0 errors (195 warnings); 36 suites / 824 tests. |
| frontend `10896fe` | `npm ci --ignore-scripts`, typecheck, build, `test:staging`, `test:consent`, `test:session`, `test:socket`, `test:messaging`, `test:seo`, `test:shops`, `test:location`, lint | All exit 0 (pass counts 17, 10, 34, 14, 47, 18, 6, 29; fail 0). |

**Merge conflicts:** `git fetch origin main` was run (backend `--depth=200`, since the clone is already shallow; frontend as a normal fetch, to avoid making a full clone shallow). `origin/main` is unchanged: backend `5bc53a8` and frontend `0c31f71`. `git merge-tree --write-tree origin/main <head>` exited 0 with no conflicts in both repos, and each head's merge-base is the `main` tip.

**Deployed vs main:** frontend `origin/main` is `0c31f71`, one merge (#24, cutout fallback) ahead of the deployed `83d30d6`. The old-client checks used `83d30d6`, as instructed.

### Evidence

Screenshots are in `doc/release/e2e-shots/run6/`, all local simulation at `deviceScaleFactor` 1:

| File | What it shows |
|---|---|
| `t-dismiss-before-iph14.png` | Reset page after a wrong code on iPhone 14: the single visible top toast, clear of the OTP row and Continue (older toasts hidden in the DOM until Dismiss clears them) |
| `m-open-bob-iph14.png` | Room tapped on iPhone 14: the newest message and the composer are above the bottom nav |
| `j4-report-rc-d1440.png` | Desktop 1440: report sent with a reason selected |
| `j1-verify-prod-iph.png` | Deployed `83d30d6` on iPhone 14: the R3 "Verification failed" page after a successful verify |

The raw JSON (`results/j1234-*.json`, `j56-all.json`, `j78-all.json`, `j9to12-all.json`, `r6-*.json`, `probe.json`), the harness (`h/*.js`) and the CI logs (`ci-*.log`, `ci-summary.txt`) are in the session scratchpad (`…/scratchpad/gate/`). They are not kept in the repo.
