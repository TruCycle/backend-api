# Frontend promotion list: `codex/stabilisation-baseline` → production

Read-only analysis, 2026-11-26. Nothing was pushed and no PRs were opened. The analysis used a local clone at `/home/user/trucycle/web-frontend`, plus a worktree of staging at `/home/user/trucycle/fe-staging` for the checks.

| Ref | SHA | Note |
|---|---|---|
| Production (deployed) | `83d30d6` | Merge of PR #23 |
| `origin/main` now | `0c31f71` | **PR #24 (poor-cutout fallback, `f9a7ca5`) is already MERGED to main**, so it is not open. It is not deployed yet. |
| Staging `origin/codex/stabilisation-baseline` | `c93693e` | 53 commits ahead of prod and 10 behind. Against `origin/main` it is 53 ahead and 12 behind. |
| Merge base | `c7d7e2b` | Merge of PR #13 (`stage`), 2026-09-15 |
| Backend candidate | `/home/user/backend-api` index (merge in progress, `MERGE_HEAD=7d65fde`) | It differs from `origin/codex/stabilisation-baseline` only in `email.service.ts` and its specs. So the API surface equals backend staging. |

---

## 1. The 10 main-only commits (prod `83d30d6`, not in staging)

To check for equivalents, I compared the added lines of each commit against the full staging tree, then read the code by hand. `git cherry` reports all of them as `+`, so none was cherry-picked verbatim.

| Commit | Subject | Equivalent in staging? | Verdict |
|---|---|---|---|
| `5a2ca07` | Truthful signup status and recovery from invalid reset codes | **Partly.** Signup: staging `91ccd6a` supersedes it with a richer `verificationDelivery.status` (`queued`/`accepted`/`unknown`), resend button and `RegistrationResult` type. Password reset: staging `b170240` only changes the copy. Staging is missing the resend/submit double-click guard (`isResending`), the **401 → back to OTP step with fields cleared** recovery, and the responsive OTP grid. | **Lost:** reset-code 401 recovery and the resend guard. Re-port into staging's `PasswordResetPage.tsx`. |
| `810a5ba` | Keep camera zoom and captured framing in sync | **Yes.** 156 of 158 added lines exist in staging (`src/features/found-items/lib/cameraFraming.ts` and `ui/components/CameraCapture.tsx`, via `91ccd6a`). The only differences are restyle class names. | Safe |
| `66ad6ea` | Share item camera and recover failed Spot uploads | **No.** It moves `CameraCapture`/`cameraFraming`/`visionClassifier` to `src/shared/ui/camera` and `src/shared/lib/vision`, adds the camera and Vision prefill to `ListItemDialog`, and adds Spot upload-failure recovery in `PostFoundItemPage`. Staging keeps the files under `features/found-items`. | **Lost:** listing-dialog camera and Spot upload retry |
| `4069ea2` | Fix lint errors and run checks on main PRs | **Partly.** Staging has its own `.github/workflows/checks.yml` (a superset: typecheck, build, 8 test suites, lint) and `.node-version`. The individual lint fixes (`void _viewerId`, `useMediaQuery`, `useMessageAlerts`, `CameraQrScanner`, `useRescueTicker`) were rewritten differently in `91ccd6a`. Staging lint passes (see §4). | Effectively superseded. Keep staging's workflow but **re-add `push: [main]`**, because staging's `checks.yml` only pushes on `codex/**`. |
| `2209236` | Structured Vision defaults for listing photos | **No.** Staging's classifier calls the backend `/found-items/vision` and has no `context: 'listing'` parameter. | **Lost** (listing Vision prefill), but it depends on `66ad6ea` |
| `c15a8cb` | Preview optional photo cutouts and confirm Spot catalogue matches | **No.** `PhotoCutoutPreview.tsx`, the `VITE_ENABLE_PHOTO_CUTOUT` flag and the catalogue-match confirm are all absent. | **Lost** |
| `f9a7ca5` (main, PR #24) | Keep original photo when cutout removes too much or too little | **No.** It depends on `PhotoCutoutPreview.tsx`. | **Lost** |
| `aa78137`, `279d0c4`, `4c8abd2`, `83d30d6` | Merge commits for PRs #19, #20, #22 and #23 | n/a | n/a |

**What staging would lose if promoted as-is:**
- The reset-OTP 401 recovery
- The camera and Vision prefill in the "List item" dialog
- Spot upload-failure recovery
- Optional photo cutout with its quality fallback (flag-gated and off by default)
- Structured listing Vision defaults

Also note that the Vision transport differs by design:
- Prod calls the Cloudflare worker directly from the browser (`VITE_VISION_WORKER_URL`).
- Staging calls the authenticated backend proxy `POST /found-items/vision` and removes `visionWorkerUrl`. `VITE_ENABLE_SMART_SPOT` now defaults to `false`.

### Trial merge (`git merge --no-commit --no-ff 83d30d6` into a local copy of staging)

There were 20 conflicting paths. Merging `origin/main` (with `f9a7ca5`) gives the same 20. The merge was aborted afterwards.

| File | Hunks | Main side | Staging side |
|---|---|---|---|
| `.github/workflows/checks.yml` | add/add | New workflow: lint + build, push on main | Typecheck, build, 8 test suites, lint, npm 11.16 pin, no push on main |
| `src/features/auth/api/authApi.ts` | 2 | `registerUser` returns `verificationAccepted` | `RegistrationResult` with `verificationDelivery`, `/auth/logout`, verify returns `{verified}`, timeouts |
| `src/features/auth/ui/PasswordResetPage.tsx` | 6 | Resend guard, 401 → OTP step, copy, OTP grid | Restyle tokens, "reset requested" copy |
| `src/features/auth/ui/SignupPage.tsx` | 6 | Boolean accepted flag message | Delivery-status messages, resend button, restyle |
| `src/features/found-items/api/foundItemsApi.ts` | 4 | `void _param` lint fixes | Lifecycle endpoints, `includeRecentClosed`, location privacy |
| `src/features/found-items/ui/FoundItemsMapPage.tsx` | 2 | Lint/effect fix | Opt-in map location, report-reason select, restyle |
| `src/features/found-items/ui/FoundItemsPage.tsx` | 1 | Lint fix | `includeRecentClosed`, restyle |
| `src/features/found-items/ui/PostFoundItemPage.tsx` | 2 | Shared camera import, upload recovery, cutout preview, catalogue confirm | Postcode hook, location privacy, restyle |
| `src/features/found-items/ui/components/FoundItemDetailsPanel.tsx` | 2 | Lint fix | Dialog a11y labels, lifecycle actions, report select |
| `src/features/messaging/hooks/useMessageAlerts.ts` | 2 | Lint refactor of effects | Authoritative unread counts, read state, visibility, reconnect |
| `src/shared/context/AuthSessionContext.tsx` | 1 | `register` returns a boolean | Full session-recovery rewrite (`isSessionUnavailable`, `retrySession`, server sign-out) |
| `src/shared/context/useAuthSession.ts` | 1 | `register: Promise<boolean>` | `register: Promise<RegistrationResult>` and new session fields |
| `src/shared/hooks/useMediaQuery.ts` | 2 | `useSyncExternalStore` lint rewrite | Its own rewrite |
| `src/shared/lib/config/env.ts` | 2 | Adds `enablePhotoCutout` | Removes `visionWorkerUrl`, Smart Spot default false, adds `enableMetaPixelSdk` |
| `src/shared/lib/vision/visionClassifier.ts` | 2 | Direct worker fetch with `context` param | (staging version at `features/found-items/lib/`) backend proxy with `unwrapApiData` |
| `src/shared/lib/vision/cameraFraming.ts` | AU | (git rename heuristic) main moved `found-items/lib` to `shared/lib/vision` | Staging added `cameraFraming.ts` in old dir. Real home on main is `shared/ui/camera/`. |
| `src/shared/lib/vision/foundItemLocation.ts` | AU | Same rename heuristic | Staging-only file. It should stay in `features/found-items/lib/`. |
| `src/shared/ui/camera/CameraCapture.tsx` | 5 | Moved file plus prefill hooks | Staging edits at old path (restyle, framing) |
| `src/shared/ui/modal/ListItemDialog.tsx` | 4 | Camera, Vision prefill and cutout in listing dialog | Restyle, modal focus trap, a11y |
| `src/shared/ui/qr/CameraQrScanner.tsx` | 1 | Lint fix | Restyle and close-target a11y |

**Recommendation:** do not merge main into staging wholesale. Promote staging as the new base, then re-apply the main features as new, small commits on top:
1. The reset 401 recovery
2. The shared camera in `ListItemDialog` plus Spot upload recovery
3. Photo cutout (flag) together with the PR #24 fallback, adapted to the backend Vision proxy

---

## 2. The 53 staging-only commits, grouped into release batches

Excluding the 8 merge commits leaves 45 non-merge commits. The two large checkpoints span several areas: `91ccd6a` (136 files) and `18aec92` (59 files).

### B1 Auth / session (largest risk)
- **Commits:** `91ccd6a` (session part: `AuthSessionContext` rewrite, `shared/lib/auth/{recovery,returnPath,schedule,session}.ts`, `SessionUnavailable`, `api/client.ts` 401 retry and timeouts), `b170240`, `18aec92` (part)
- **User-visible change:**
  - Signup shows the real delivery status (queued/accepted/unknown) and has a resend button.
  - Verify-email page says "verified, sign in" and no longer auto-logs in.
  - The reset page avoids claiming delivery.
  - Sign-out revokes server-side.
  - A "session unavailable" retry screen appears on 503.
  - After login, the user returns to the page they came from.
- **Backend dependencies:**
  - `POST /auth/register` → `data.verificationDelivery.status`
  - `POST /auth/verify` → `data.verified`
  - `POST /auth/logout`, `/auth/logout-all`
  - `/auth/refresh` with rotation and session `sid`
  - 429 rate-limit responses
  - `/auth/me`
- **Flags/env:** none new. Relies on backend `JWT_EXPIRES_IN=15m`, `AUTH_REFRESH_RETRY_GRACE_SECONDS`.
- **Risk:** High. The new staging frontend is incompatible with the old backend verify shape. It must ship together with the backend.

### B2 Messaging / notifications
- **Commits:** `2c268fa`, `02d2775`, `ef32eba`, `11816eb`, `50e2967`, `cca128a`, `176879b`, `be6f4cf`, `366a3d4`, `23f77ad`, `91ccd6a` (`websocket/client.ts` token refresh and `auth:ready`)
- **User-visible change:**
  - Drafts are kept until the server confirms them.
  - Missed messages are recovered after reconnect, going online, or a clear/delete.
  - Unread badges are authoritative across reload.
  - Messages are marked read only when visible.
  - Private image attachments work (pilot).
- **Backend dependencies:**
  - `POST /messages/rooms/:id/messages/text` `{clientMessageId,text}`
  - `POST /messages/rooms/:id/read` `{messageIds}`
  - Socket events `messages:read`, `auth:ready`, `notification:read:changed`
  - `POST /notifications/read`, `/notifications/read-all`
  - `POST /messages/rooms/:id/messages/image` (+`clientMessageId`) and `GET .../messages/:messageId/image`
  - `room.unreadCount`, `message.hasAttachment`
- **Flags/env:** `VITE_MESSAGE_ATTACHMENTS_ENABLED` (staging build script defaults `true`), backend `MESSAGE_ATTACHMENTS_ENABLED=true` plus migration `1700000000032` and the attachments migration.
- **Risk:** Medium-high. Attachments must stay off in prod unless the backend flag, the migration and the storage grants are live.

### B3 Claims / collection / listings
- **Commits:** `bc1241b` (confirm approved exchange without QR), `121a8b0` (pending donor requests "awaiting approval"), `91ccd6a` (listings/partner pieces)
- **User-visible change:** The donor or collector can complete an approved exchange without scanning, and pending states are labelled.
- **Backend dependencies:** Approved-claim completion path (`0b4cc22`, `claims.service.ts`) and `claim_status` values.
- **Flags/env:** none
- **Risk:** Medium (it changes the exchange lifecycle).

### B4 Found items (Spot lifecycle)
- **Commits:** `91ccd6a` (`FoundItemLifecycleActions`, `useSpotPostcode`, `foundItemLocation`, status display), `47f6e34` (404 for malformed item links), `3b1619d` (map location opt-in)
- **User-visible change:**
  - "Still there" / "Gone" observations
  - Poster reconfirm and acknowledge of pickup
  - Report reason select (enum)
  - Recently closed spots shown
  - Coarse public location
  - Map geolocation only on opt-in
- **Backend dependencies:**
  - `POST /found-items/:id/observations`, `/:id/reconfirm`, `PATCH /:id/claims/:claimId/acknowledge`
  - `includeRecentClosed`
  - Report `reason` enum
  - New status `gone`, claim status `acknowledged`
  - Lifecycle scheduler (`FOUND_ITEM_LIFECYCLE_SWEEP_ENABLED`)
- **Flags/env:** backend `FOUND_ITEM_LIFECYCLE_SWEEP_ENABLED` (default false)
- **Risk:** Medium

### B5 Browse / items
- **Commits:** `f769ddb` (public discovery and top-category showcase), `82e8c0c`, `ac1a910`, `91ccd6a` (`PublicItemPage`, items API)
- **User-visible change:** A public item page, a single error/empty state, a category showcase, and server-side `search`.
- **Backend dependencies:** `GET /items?search=`, public item detail projection (redacted location `precision:'approximate'`, no donor names), `GET /items/:id`.
- **Flags/env:** `VITE_DEFAULT_SEARCH_POSTCODE`
- **Risk:** Low-medium

### B6 Analytics / consent
- **Commits:** `d4efae5`, `8e1e689` (PostHog EU staging project), `91ccd6a` (`trackingConsent`, `clearAnalyticsCookies`, `posthogAnalytics`, GA/Meta gating)
- **User-visible change:** Consent banner gating is enforced, analytics cookies are cleared on withdrawal, and PostHog loads only after consent.
- **Backend dependencies:** none
- **Flags/env:** `VITE_POSTHOG_PROJECT_TOKEN`, `VITE_POSTHOG_HOST`, `VITE_GA_MEASUREMENT_ID`, `VITE_META_PIXEL_ID`, **new `VITE_ENABLE_META_PIXEL_SDK`** (default off)
- **Risk:** Medium (legal/compliance). **Prod must not reuse the staging PostHog project.**

### B7 Camera / Spot / Vision
- **Commits:** `39defc7` (exclude internal Vision debug tool from staging), `18aec92` (Vision part: `visionClassifier` → backend proxy, `workers/imgrc/worker.js` bearer auth and `wrangler.toml` staging env, `InternalVisionPage`), `6d61005`, `b7c9497`, plus framing via `91ccd6a`
- **User-visible change:** Smart Spot prefill goes through the authenticated backend proxy and is off by default. `/internal/vision` is removed from staging builds.
- **Backend dependencies:** `POST /found-items/vision` (multipart JPEG ≤1.5 MB, response `{status,message,data:<worker JSON>}`), backend `VISION_WORKER_URL` and `VISION_WORKER_SECRET` (64-hex)
- **Flags/env:** `VITE_ENABLE_SMART_SPOT` (now default **false**). `VITE_VISION_WORKER_URL` is no longer read.
- **Risk:** Medium. This conflicts with the main-only cutout and listing-Vision features (§1).

### B8 SEO / noindex / PWA / hosting
- **Commits:** `c738394` (manifest with credentials), `ccc8f54`, `91ccd6a` (`pageMetadata`, `prerender`, `spa-routes`, icons and manifest, `workers/staging-web`), `47f6e34`, `736413a`
- **User-visible change:** New icons and maskable PWA manifest, per-route metadata, device fonts. Staging only: noindex header and meta, Cloudflare Access.
- **Backend dependencies:** none
- **Flags/env:** `scripts/build-staging.mjs` (staging only)
- **Risk:** Low. Verified: the plain `npm run build` output has `dist/index.html` `<meta name="robots" content="index, follow">`, `dist/_headers` `X-Robots-Tag: index, follow` and an allow-all `robots.txt`. Noindex comes only from `scripts/build-staging.mjs`, `workers/staging-web` and `MODE==='staging'` (`usePageMeta.ts:7`), plus per-route `noIndex` on the dashboard, not-found and support FAQ pages.

### B9 Accessibility
- **Commits:** `3657c75`, `83f52cd`, `91ccd6a` (`modalFocus.ts` focus trap, `Modal`)
- **User-visible change:** Dialog labels, a 44 px scan close target, a focus trap, and phone-width layouts.
- **Risk:** Low (`3657c75` gives the close button `h-11 w-11`, which is 44 px)

### B10 Copy / content
- **Commits:** `121a8b0`, `b170240`, `91ccd6a` (landing, FAQ, legal, `CompanyDetails`, `ReuseSafetyNotice`, removed testimonials and impact claims)
- **User-visible change:** Truthful claims, company details, and a reuse safety notice.
- **Risk:** Low. Needs content/legal sign-off.

### B11 Visual redesign (charcoal / mint), not one of the requested categories
- **Commits:** `03c1b54`, `80b2e7f`, `3dc9fa3`, `4ce2021`, `23f1325`, `e7fcdf1`, `03bb92e`, `22edc49`, `8c92e35`, `fc5f819`, `70a4600`, `ee6bad2`, `e3f4655`, `88d50bb` (confetti once per reward), `1bf8893`, `83f52cd`
- **User-visible change:** Whole-app restyle, Inter font, new logo and icons.
- **Risk:** Medium, because of its size; it touches nearly every page. No backend dependency.

### Note on `18aec92` (59 files)
Its subject says Vision, but it spans several batches:
- B2: `useMessages`, `useMessageAlerts`, `MessagingPage`, `PrivateMessageImage`, `roomState`, `notificationsApi`, a `useNotifications` rewrite, `NotificationsPage`
- B1: `client.ts` +66, `VerifyEmailPage`, `SignupPage`, `authApi`, `returnPath`
- B4: found-items hooks, `FoundItemsMapPage`
- B5: browse and landing items
- B6: `TrackingConsentBanner`, `metaPixel`, `posthogAnalytics`, `authenticationPath`
- B7: Vision and the `imgrc` worker
- B8: `seo.test`, `staging-web` worker
- It also removes 640 lines of `package-lock.json` (a dependency drop)

It cannot be promoted as one batch-pure unit.

### Ops / CI
- **Commits:** `d854d06`, `6d61005`, `b7c9497`, `ccc8f54`, `9c5217e`, `b929aaa`
- **Risk:** None for runtime

---

## 3. API contract: DEPLOYED frontend (`83d30d6`) vs backend candidate

**Verdict: NOT compatible.** The deployed frontend breaks in several user-facing flows once the backend candidate is live. The staging frontend (B1/B2/B4) is the matching client. Backend and frontend must be promoted together, with the backend first and the frontend within minutes. Otherwise, backend compatibility shims are needed.

| # | Severity | Flow | Deployed frontend evidence | Backend candidate evidence | Effect |
|---|---|---|---|---|---|
| R1 | **High** (only if prod `JWT_EXPIRES_IN` is unset or set to `15m`; verify the Railway env) | Sessions without "remember me" | `src/shared/context/AuthSessionContext.tsx` (`login`: `keepRefreshToken: options.rememberSession`), timer at ~L166-195 → `clearSession()` when there is no refresh token. Confirmed in `src/shared/lib/auth/session.ts:168-180`: `storeSession` removes the refresh token unless `keepRefreshToken`. | Access lifetime `JWT_EXPIRES_IN` default changes from `60d` (`origin/main:src/common/security/jwt-auth.module.ts:9`) to `15m` (`src/common/security/auth-session-options.ts` `buildAuthSessionOptions`, `.env.example:27`) | Users who did not tick "remember me" are **signed out every ~15 min**. Users who did are refreshed every ~10 min. The deployed `api/client.ts` has no 401→refresh retry, so a tab woken from sleep gets 401s until the timer fires. |
| R2 | **High** | All existing sessions at deploy | Tokens stored by prod carry no `sid`. Confirmed: main signs `{sub,email,roles}` / `{sub,email,type:'refresh'}` (`origin/main:src/modules/auth/auth.service.ts:439-448`), and `auth-sessions.service.ts` is absent on main. | `src/modules/auth/auth-sessions.service.ts:111` (`assertActive` requires a UUID `sid`). `verifyAccessToken` in `src/common/security/access-token.ts` is used by the HTTP guard, the sockets and optional auth on `/items`. | **Every logged-in user is signed out** when the backend deploys. This is expected, but communicate it. |
| R3 | **High** | Email verification | `src/features/auth/api/authApi.ts:146-161` (`normalizeUser(response.data.user)`, `mapTokens(response.data)`), `AuthSessionContext.tsx:231-240` | `src/modules/auth/auth.controller.ts:272-278` returns `data: { verified: true }` with no user and no tokens | `normalizeUser(undefined)` throws, so **every verification link shows the error state** even though the account was verified. The user is not logged in and must sign in manually. |
| R4 | **High** | Found Items list page `/found-items` (and NearbyPage when the user has no postcode) | `src/features/found-items/ui/FoundItemsPage.tsx:24-27` (`sortBy:'nearest', maxDistance:5`, no postcode/lat), `NearbyPage.tsx:57-59` (postcode only if the profile has one), query building at `foundItemsApi.ts:258-274` | `src/modules/found-items/found-items.service.ts:122-124` throws 400 "Provide a search location for distance filtering or nearest sorting". Main returned all items when there was no origin (`origin/main:...found-items.service.ts:96`). `:98-100` gives 400 for an invalid postcode. `:886-888` gives 400 when geocoding fails (main fell back to `null`). | The **list page fails to load** for users without a location |
| R5 | **High** | Report a spot | Free-text input `FoundItemDetailsPanel.tsx:239-243` and `FoundItemsMapPage.tsx:374-378` → `foundItemsApi.ts:427-434` sends `{reason: <free text>}` | `src/modules/found-items/dto/report-found-item.dto.ts:5,14` `@IsIn(['already_gone','not_there','unsafe','misleading','duplicate','other'])` | **Every report returns 400** |
| R6 | **High** (same `JWT_EXPIRES_IN` condition as R1) | Realtime messages and notifications after access-token expiry | `src/shared/lib/websocket/client.ts:53-67` captures `auth: { token }` once. There is no `disconnect`/`connect_error` handling (only `.connect()` in `useMessages.ts:273`, `useMessageAlerts.ts:87`, `useNotifications.ts:137`, `useRescueTicker.ts:95`). | `src/common/security/socket-access.ts:100-106` arms expiry and `:126` calls `client.disconnect(true)` (server disconnect, so no client auto-reconnect). `authorize()` re-verifies the stored token on every packet. | Sockets drop at access-token expiry (≤15 min) and **stay dead until reload**. `useMessages.ts:301-303` then falls back to sending as a *general* message via REST, so it still persists but is categorised differently. Notification read-marking via the socket `notification:read` (`useNotifications.ts:158,174`) is silently lost. |
| R7 | Medium | Unread message badge | `useMessageAlerts.ts:56` sums `room.unreadCount`, `useMessages.ts:71` uses `Math.max(existing, room.unreadCount)`. The deployed client never calls a read endpoint. | `messages.service.ts:117-159,467` now returns a persisted `unreadCount` that only `POST /messages/rooms/:id/read` (`messages.controller.ts` `acknowledgeRead`) clears. Main returned no `unreadCount`. Migration `1700000000032-CreateMessageReadReceipts.ts` creates `message_read_receipt` **with no backfill**, and `UNREAD_COUNTS_SQL` (`message-read-state.ts`) counts every incoming direct message without a receipt. | The unread badge **grows and never clears** for prod users. **For every client, the new frontend included, all historical incoming messages become unread at deploy.** Consider a one-off backfill of receipts for messages older than the deploy. |
| R8 | Medium | Conversation names | `messagingApi.ts:28-41,65-70` render `firstName/lastName` | `messages.service.ts:33,448,501` set `firstName: 'Community member'`, `lastName: null` | All conversations show "Community member", so users cannot tell rooms apart. Intentional privacy change, but a UX regression on the old client. |
| R9 | Medium | Spot status `gone` / claim `acknowledged` | `foundItemsApi.ts:66-70` maps unknown status → `'available'`, `types.ts:1-7` (no `gone`) | `found-item.entity.ts:5-12` adds `GONE`, service sets it via observations, sweep and report | Gone spots appear "available" in my-posts and details. A claim attempt then gets 400 (`found-items.service.ts` `claim` requires AVAILABLE and not expired). |
| R10 | Medium | Refresh-token rotation | `AuthSessionContext.tsx:75-101` reads the stored refresh token per tab. `session` persist mode uses `sessionStorage`, so duplicated tabs hold separate copies. | `auth-sessions.service.ts:49-83`: rotation with a 30 s grace. An older generation outside the grace **revokes the whole session family**. | A duplicated or long-backgrounded tab can log out all tabs |
| R11 | Low | Upgrade to partner | `authApi.ts:252-262` makes tokens optional, falls back to `storeUser` | `auth.controller.ts:369-374` drops `tokens`. Roles are now read from the DB per request (`access-token.ts`, final lines). | Compatible |
| R12 | Low | Signup copy | `SignupPage.tsx:98-107,174-176` checks `=== 'accepted'` | `auth.service.ts:103`: the outbox path returns `{status:'queued'}` | It shows "delivery could not be confirmed" when the email is in fact queued (misleading copy only) |
| R13 | Low | Partner shop create/update | `PartnerShopForm.tsx:27` days `Mon..Sun`, HH:mm times, no client postcode check | `shops/dto/create-shop.dto.ts`, `update-shop.dto.ts`: full UK postcode regex, HH:mm, non-empty unique days | Compatible for normal input. An outward-only postcode now gets 400 with a message. |
| R14 | Low | Rate limits | No 429 handling (generic error toast) | `@LimitAuthOperation` on register, login, google, refresh, resend, reset | Throttled users see the server message. A 429 on `/auth/refresh` makes the deployed client **sign the user out** (`handleTokenWindow` → `clearSession`). |
| R15 | **Medium (coupled infra)** | Vision (f6e81a1) | The deployed client calls the worker directly: `src/shared/lib/vision/visionClassifier.ts:111` (`fetch(env.visionWorkerUrl)`) and `features/internal/ui/InternalVisionPage.tsx:242` | New `POST /found-items/vision` proxy (`vision.controller.ts`) sends `Authorization: Bearer ${VISION_WORKER_SECRET}` to the worker and wraps it as `{status,message,data:<worker JSON>}` | **No backend contract break** for the deployed client, which never calls the proxy. The worker source in the frontend repo **does** require the bearer: staging `18aec92` changes `workers/imgrc/worker.js:111-118` to return 401 without `Bearer <VISION_WORKER_SECRET>`. If that worker build is deployed to the prod `imgrc` worker, prod Smart Spot and listing prefill **silently return no suggestion**, because `classifyImageWithWorker` throws on non-OK and callers fall back. Keep the worker accepting unauthenticated calls until the frontend ships, or ship together. |
| R16 | Info | Notification envelope (0a01cbf) | The deployed client uses only `GET /notifications` and `/notifications/unread-count` (`notificationsApi.ts:54,68`) plus the socket `notification:read` | 0a01cbf changes only `POST /notifications/send` (explicit envelope), and that route now requires `userId === sub` | **Compatible.** Not called by the deployed client. List and unread-count shapes are unchanged. |
| R17 | Info | Items list/detail | `itemsApi.ts:60-175` is defensive (reads `location.postcode` / `address_line`, owner names optional) | Public projection: `address_line:null`, outward postcode, `precision:'approximate'`, donor names redacted. `search-items.dto.ts`: malformed numerics now 400. | Compatible. Location labels become coarser. The deployed client omits empty params (`shared/lib/api/query.ts`). The deployed client has no `GET /items/:id` call. |
| R18 | Info | Messaging socket send | `useMessages.ts:303` `emit('message:send',{roomId,text})` | `messages.gateway.ts`: `clientMessageId` is optional, `files` must be absent or `[]` | Compatible (until R6 drops the socket) |
| R20 | Info | Shops, gamification, rewards, claims, `/items/me/*`, `/qr/*`, `/users/me/profile` | Defensive mappers (`partnerApi.ts`, `shopsApi.ts`, `gamificationApi.ts` use `?? 0` defaults, `itemsApi.ts`, `listingsApi.ts`). `ListingOffcanvas.tsx:127,289` uses `claim.collector.id` for chat. | No controller or route changes for gamification, rewards, claims, qr or users (they are absent from the controller diff). Service diffs add validation throws: shops radius ≤50000 (the client sends 5000), coordinates, "at least one active shop". Claims completion is restricted to the donor or assigned collector. Collector `id` is preserved and the name fallback becomes "Community member" (`items.service.ts` diff). Gamification totals may now be `null`. | Compatible as far as I checked. Not examined in depth: per-field response shapes of the gamification/rewards services. |
| R19 | Info | Error envelope | `api/client.ts:40-53` reads `payload.message` | `http-exception.filter.ts`: 5xx now returns a generic message | Compatible |

**Release ordering implication:**
- First, check the production `JWT_EXPIRES_IN`. Pinning it to a long value (for example `60d`) until the new frontend ships neutralises R1 and R6.
- R1-R8 mean the backend candidate **cannot be deployed under the current production frontend** without visible regressions.
- The staging frontend needs the new backend (verify `{verified}`, `/messages/.../text`, `/read`, observations, the Vision proxy).
- Option A: deploy both in one window, backend first and frontend immediately after. Accept R2 (a global sign-out).
- Option B: add temporary backend shims before deploy:
  - Keep `JWT_EXPIRES_IN` long until the frontend ships.
  - Accept free-text report reasons (map them to `other`).
  - Return all items when there is no origin.
  - Keep `user`/`tokens` in the verify response, or at least `user`.

---

## 4. Frontend checks on staging (`c93693e`, worktree `/home/user/trucycle/fe-staging`)

Environment: node v22.23.5 / npm 10.9.9. The repo pins `.node-version` 24.18.0 and CI installs npm 11.16.0, so the local versions differ from CI.

| Step | Result | Tail |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS | `added 298 packages in 8s` |
| `npm run typecheck` (`tsc -b`) | PASS | exit 0 |
| `npm run build` | PASS | `dist/assets/index-D2lL5qtG.js 351.61 kB │ gzip: 111.63 kB` / `✓ built in 5.20s` |
| `npm run lint` | PASS | `eslint .`, no findings |
| `test:staging` | PASS | 17/17 |
| `test:consent` | PASS | 10/10 |
| `test:session` | PASS | 34/34 |
| `test:socket` | PASS | 14/14 |
| `test:messaging` | PASS | 47/47 |
| `test:seo` | PASS | 18/18 |
| `test:shops` | PASS | 6/6 |
| `test:location` | PASS | 29/29 |

The repo has no browser/E2E run here. The `91ccd6a` message mentions 32 browser scenarios, which were not run. The tests are offline node tests and do not exercise the live backend contract.
