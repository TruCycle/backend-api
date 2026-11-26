# TruCycle website closeout: consolidated plan

As of 26 Nov 2026. Production runs frontend `83d30d6` and backend `5bc53a8`.
This plan replaces the sitrep's five priorities. Every item sits in one of three buckets:

- **A. Executed in this session**, with evidence in this folder.
- **B. Prepared, awaiting a named approval**, because the action is irreversible or touches production.
- **C. Needs hardware or a human.** Simulation cannot close these.

Supporting evidence (both are local simulations, not production evidence):

- [`migration-rehearsal.md`](migration-rehearsal.md): `main` schema → candidate migrations, on local Postgres.
- [`frontend-promotion-list.md`](frontend-promotion-list.md): frontend branch diff and API contract check.

---

## The governing rule: one coordinated release

> ⚠️ **Correction.** An earlier version of this plan said that, with flags off, signup, verify and reset behave as on production today. **That was wrong.** The contract check against the deployed frontend found breaking changes. The backend candidate **must not** ship on its own.

**Backend and frontend go out together, in one change window.** Risk is managed by flag activation, not by commit batches. The backend checkpoint commit `b2a6d2d` alone is 104 files and about 6k of the 9.7k changed lines, so batching would not hold together.

Why the deploy must be coordinated:

| Risk | Effect if the backend ships without the new frontend | Handled by |
|---|---|---|
| R3 | `/auth/verify` now returns `{verified:true}` with no tokens. The deployed frontend shows an error on every verification link, even though the account *is* verified. | Coordinated frontend release. The staging change was deliberate hardening and is **not** reverted. |
| R2 | Every signed-in user is logged out at deploy. Old tokens carry no session id, and the rehearsal confirmed a 401 on `/auth/me` and `/auth/refresh`. | Accept it and announce a forced re-login. |
| R1 / R6 | The default access-token lifetime drops from 60d (main) to 15m. Old clients without "remember me", and their realtime sockets, drop after about 15 minutes. | **Pin `JWT_EXPIRES_IN` explicitly in production before deploy.** The production value is unknown from here. |
| R4 | The deployed Found Items page sends nearest + 5mi with no location, and gets a 400. | ✅ Shimmed in the backend (`eda6820`). |
| R5 | The deployed spot report sends free-text reasons, and gets a 400. | ✅ Shimmed in the backend: the reason becomes `other` and the text is kept. |
| R7 | Production had no read state, so every historical message would show as unread. | ✅ Migration 0036 backfills receipts. Tested on a copy of the migrated database: idempotent, no self-receipts. |
| R7 residual | Deployed clients never call the read endpoint. Messages that arrive after the release stay unread on old tabs until the user moves to the new frontend. Confirmed in simulation. | Coordinated frontend release. Stale tabs self-correct on reload. |
| R8, R9, R10, R14 | Names show as "Community member", `gone` displays as available, and duplicate-tab or 429 refresh logs the user out. | Coordinated frontend release, plus owner awareness. |
| R15 | The staging Vision worker requires a secret. If it reaches the production worker before the new frontend, Smart Spot silently stops. | Promote the worker **with** the frontend, never before it. |

---

## Standing rule from the owner (26 Nov 2026): no colour or visual redesign

- The frontend release uses **staging as its base**, with the colour change reverted (`03c1b54`, the same change as abandoned PR #18).
- From staging, keep anything tied to functionality, UX, accessibility or the QA work.
- **Do not implement any change that is only a redesign** (colours, palette, theme or restyling). Leave it out of every PR until the owner finishes the design compendium and the redesign is integrated as its own piece of work.
- This applies to every PR in this programme. When a commit mixes the two, keep the functional part and drop the colour part.

---

## A. Executed in this session

| # | Item | Result |
|---|---|---|
| A1 | Backend reconciliation: staging (29 ahead) merged into `main` (2 ahead) | Done in [backend-api#11](https://github.com/TruCycle/backend-api/pull/11). Four conflicts resolved. Main's `verificationDelivery`, suspended-account guard and single-use reset codes are confirmed present at HEAD. |
| A2 | Main's Brevo→Resend fallback | Restored. Staging had dropped it. |
| A3 | Main's email tests were not in the CI allowlist | Added, so the production email fix is now a merge gate. |
| A4 | Compatibility shims R4, R5 and R7 (migration 0036) | Done, with tests. |
| A5 | CI gate on the candidate | Typecheck ✅. Lint 0 errors ✅. 36 suites / 820 tests ✅. Build ✅. GitHub Actions ✅ on #11. |
| A6 | Flag defaults | Outbox, shared rate budgets and per-email reset limits are all off by default. |
| A7 | Migration rehearsal (simulated) | The upgrade applies cleanly. Findings are folded into B and the pre-checks below. |
| A8 | Frontend promotion list and contract check | Done. Results are in the table above and in the doc. Frontend staging build, lint and tests pass locally. |
| A9 | Simulated browser journeys: both frontends against the local candidate ([`simulated-e2e.md`](simulated-e2e.md)) | R3 reproduced on the deployed frontend, while staging passes. The R4, R5 and R7 backfill shims work. Reset single-use, refresh and mobile layout pass on both. Staging logout revokes the server session. Keyboard sign-in passes. Defect **D1** was found in the R5 shim and fixed: a free-text reason is now kept alongside details. |

---

## B. Prepared, awaiting a named approval

### B0. Read-only production pre-checks (required before anything else)

1. **Migration ledger top: 026 or 027?** This decides the `--expect` list. Main never registers 027. With the ledger at 026, the list is 027–036; at 027, it is 028–036.
2. **`TYPEORM_SYNC` must be `false` in production.** If it is `true`, then the moment the schema is migrated, main's next restart will either crash-loop or drop new columns. See rehearsal 5b.
3. **Runtime DB role.** Every new table has row-level security with no policies. The role must own the tables or have `BYPASSRLS`. Grants alone give 0 rows and a 503 on login.
4. **`JWT_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN`.** Pin them explicitly. **Recommended:** `JWT_EXPIRES_IN=15m` (the value QA and the simulation exercised) and an explicit `JWT_REFRESH_EXPIRES_IN` matching hosted staging, set in the same window as the frontend. Everyone re-logs in at deploy anyway (R2), and the new frontend refreshes silently. `JWT_SECRET` must be at least 32 bytes and not `change-me`, or the candidate refuses to boot.
5. **Duplicate `google_id` values, and the Postgres version.** The 027 unique index fails if duplicates exist.

### B1–B9. Approval queue

| # | Action | Approver | Post-action check |
|---|---|---|---|
| B1 | **Frontend reconciliation.** Promote staging as the new base, then re-apply the main-only features it lacks: List-item camera + Spot retry `66ad6ea`, `2209236`, `c15a8cb`, the cutout fallback `f9a7ca5`/#24, and reset-code recovery from `5a2ca07`. This session can't push there. | Owner (**push access needed**) | Frontend CI. Simulated runs against the local candidate. |
| B2 | Set the production env from B0 (`TYPEORM_SYNC=false`, JWT lifetimes) | Owner | Env diff recorded. |
| B3 | **Migrate first, immediately before B4 in the same window:** apply 027/028–036 with `PGOPTIONS='-c lock_timeout=5s'`. 0036 only marks messages that exist when it runs, so messages sent between B3 and B4 would show as unread. | Owner + DB access | Ledger shows 036. Main is still serving, which the rehearsal shows is safe with sync off. |
| B4 | Merge and deploy backend #11 | Owner | New SHA is live. `/health` returns 200. |
| B5 | Deploy the reconciled frontend, together with the Vision worker | Owner | Signup → verify → sign-in → reset. Messaging unread counts. Spot report. Cutout flag **off**. |
| B6 | Announce the forced re-login (R2) | Owner | n/a |
| B7 | Turn flags on, one per window: `AUTH_RATE_LIMITS`, then `AUTH_RESET_EMAIL_LIMITS` + key, then `AUTH_EMAIL_OUTBOX_ENABLED` + key | Owner. Name the alert owner first (DEP-301). | Redacted `auth_budget` events. |
| B8 | Branch protection on both `main` branches, with the checks job required | Repo admin | A test PR is blocked until checks pass. |
| B9 | HSTS on the production frontend and API | Hosting | `curl -I` shows `strict-transport-security`. |
| n/a | Cutout activation | **Deferred** | Hosted Cloudinary validation must pass first. |
| n/a | Close Linear DEP-291…315 | Owner | Only on production evidence. |

**Order:** B0 → B1 → B2 → (B3 → B4 + B5 + B6 back-to-back in one window) → smoke tests → B7, one flag per window → B8 / B9.

**Rollback pair:** main backend `5bc53a8` plus frontend `83d30d6`, running on the migrated schema with `TYPEORM_SYNC=false`. This was rehearsed: main works, and attachment messages display as empty. **Never** roll back with sync on.

**Redesign decision (resolved 26 Nov: staging base, colour reverted, see the standing rule):** staging tip `c93693e` is the merge of frontend PR #21 ("redesign-charcoal-mint": 16 commits, 138 files). It contains `03c1b54`, which is the **same 24-file colour change** as the abandoned PR #18 (`8f826c3`). Promoting staging as-is ships the redesign you asked to abandon. The alternative base is `c93693e^1` (`83d7827`), but every QA fix inside #21 would then need re-applying. The simulation ran on `c93693e`, with the redesign.

**Observations:**
- **Cookie banner:** on the iPhone-sized viewport it covers *Log in* on the deployed frontend until it is dismissed.
- **Geocoder:** a failure still returns 503 on item search, the same as main. The new shared provider cooldown (`cff51cf`) means one upstream 429 briefly pauses lookups for every user.

**Frontend base warning:** staging `c93693e` forks from deployed `83d30d6` at `c7d7e2b`. It lacks deployed PRs #19, #20, #22 and #23: auth-mail recovery (reset 401 → back to OTP), camera framing, the Vision structured response, and optional cutout. It also has no postcode field on signup. B1 must carry these forward. Confirm the exact staging commit to promote.

**Stale item corrected:** frontend PR #24 is already **merged** to frontend main (`0c31f71`) but is **not deployed**, and staging lacks it. It is carried in B1.

---

## C. Needs hardware or a human

Simulated Playwright runs are regression evidence only. They do not close the items below.

| Item | Needs |
|---|---|
| Live Spot catalogue check (upload → profile → weight, CO₂ and points → edit weight → stop before publishing) | A person with a real file picker |
| Android Chrome hardware checks: camera, pinch, gallery, permissions, rotation, blocked-posting recovery | A physical Android phone. The S24 was skipped at your request. |
| iPhone Safari: camera, gallery, permissions, PWA install, deep links | A physical iPhone |
| QR handoff → *Collected*, with no duplicate rewards | Two devices and a designated QA donation |
| Two-account messaging on real browsers | Two people or browsers, after B5 |
| VoiceOver / TalkBack; desktop Safari and Firefox | Real assistive technology |
| Copy, policy and support sign-off (DEP-307–308) | Owner |
| Erasure and retention (DEP-296), GA4/Meta scope (DEP-297), historical carbon totals (DEP-306) | Owner decisions |
| Recovery storage and a production recovery rehearsal (DEP-291–294) | Infra access |
| Vision Worker config capture (DEP-314) | Cloudflare access |

---

## Decisions made under the defer-to-model delegation

1. **One coordinated release, gated by flags, with no commit batches.** Reason: the checkpoint commits on both repos span several features.
2. **Staging's auth wins** wherever it is a superset of main's fixes. Main's tests remain the oracle.
3. **Do not revert verify-issues-no-tokens (R3).** It is deliberate hardening, and coordination is the fix.
4. **Shim only what is cheap and security-neutral** (R4, R5, R7), to protect stale tabs and PWAs after the release.
5. **Migrate before deploy**, because the rehearsal showed that deploy-then-migrate breaks login with a 503.
6. **Cutout stays off.** PR #18 (the colour overhaul) stays out. Recommend closing it.
7. **Rate limits are the first flag**, as the lowest risk and the fastest rollback.
