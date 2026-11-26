# TruCycle website closeout — consolidated plan

As of 26 Nov 2026. Production: frontend `83d30d6`, backend `5bc53a8`.
This plan replaces the sitrep's five-priority list. Everything is in one of three buckets.

- **A. Executed in this session.** Done, with evidence in this folder.
- **B. Prepared, awaiting a named approval.** Ready to go, but the action is irreversible or affects production.
- **C. Needs hardware or a human.** These can't be closed by simulation.

The governing rule: one reconciled release candidate per repo, with risk managed **by flag activation, not by commit batches**.
The backend checkpoint commit `b2a6d2d` alone is 104 files and ~6k lines of the 9.7k diff, so per-commit batches aren't realistic.

---

## A. Executed in this session

| # | Item | Result | Evidence |
|---|---|---|---|
| A1 | Backend reconciliation: staging (29 ahead) merged into `main` (2 ahead) | Merge commit on `uiadedo/sleepy-bardeen-hxi0z4`. 4 conflicts resolved. Main's live fixes are preserved (see below). | `git show 096d016` |
| A2 | Backend CI gate on the candidate | Typecheck ✅. Lint: 0 errors (195 pre-existing warnings). Unit tests 35 suites / 815 tests ✅. Build ✅. | local run, 26 Nov |
| A3 | Main's email-outcome tests were not in the CI allowlist | `email.service.spec.ts` is now added to `scripts/check-unit-tests.cjs`, so the production email fix is a merge gate. | same commit |
| A4 | Feature-flag defaults | `AUTH_EMAIL_OUTBOX_ENABLED=false`, `AUTH_RATE_LIMITS=` (empty), `AUTH_RESET_EMAIL_LIMITS=` (empty). With these unset, signup/verify/reset follow the same path as the live-passed journey. | `.env.example`, `auth-email-outbox.service.ts:40`, `auth-rate-limit.guard.ts:127-154` |
| A5 | Migration upgrade rehearsal: `main` schema → `0028–0035` (simulated, local Postgres) | See `migration-rehearsal.md` | agent run |
| A6 | Frontend promotion list and API-contract check against the deployed frontend `83d30d6` | See `frontend-promotion-list.md` | agent run |

### How the four backend conflicts were resolved

| File | Decision | Why |
|---|---|---|
| `auth.service.ts` | staging side | Staging already re-implements both of main's fixes (`verificationDelivery`, the suspended-account guard, single-use reset codes) under `pessimistic_write` row locks. It also revokes sessions on reset. |
| `auth.controller.ts` | staging side | Keeps main's `verificationDelivery` in the register response, and adds `logout`/`logout-all` and opt-in limiters. The generic anti-enumeration messages differ only in wording. |
| `email.service.ts` | staging side, plus main's behaviour grafted on | Main's Brevo→Resend fallback after a definitive 401/403/404 was missing on staging. 408/429/5xx is now always `failed`, matching production. |
| `auth.service.spec.ts` | union | Main's concurrent-reset test is ported to the locked-row transaction. |

---

## B. Prepared, awaiting a named approval

The defer-to-model delegation does **not** cover these: each is irreversible or touches production.

| # | Action | Approver | Pre-checks already done | Post-action check |
|---|---|---|---|---|
| B1 | Merge the backend reconciliation PR to `main` | Owner | A1–A5 | Railway deploy shows the new SHA. `/health` returns 200. Repeat one signup→verify→reset journey. |
| B2 | Run production migrations 0028–0035 and grant runtime privileges on the new tables | Owner + DB access | A5 rehearsal | Migration ledger shows 0035. The runtime role can read and write the auth_sessions, counter, outbox, receipt and attachment tables. |
| B3 | Merge frontend PR #24 (poor-cutout fallback) | Owner | Green, mergeable (per sitrep) | Production cutout flag still reads **off**. |
| B4 | Frontend promotion merge (staging → main, 53/10) | Owner | A6 list | Deployed SHA, plus representative signed-in flows. |
| B5 | Activate flags in production, one per change window: (1) `AUTH_RATE_LIMITS`, (2) `AUTH_RESET_EMAIL_LIMITS` plus key, (3) `AUTH_EMAIL_OUTBOX_ENABLED` plus key | Owner | defaults verified (A4) | Alert owner named first (DEP-301). Watch the redacted `auth_budget` events. |
| B6 | Branch protection on both `main` branches, with "Backend checks" as a required check | Owner (repo admin) | CI exists | Open a PR and confirm the merge is blocked until checks pass. |
| B7 | HSTS on production frontend and API | Owner / hosting | missing in sampled responses | `curl -I` shows `strict-transport-security`. |
| B8 | Cutout activation | **Deferred** | Cloudinary shows a crowded-shelf failure | Hosted validation (slow processing, read failure, multiple objects) must pass first. |
| B9 | Close Linear DEP-291…315 | Owner | evidence comments | Close only on production evidence, not on simulation. |

**Release order:** B6 → B1 → B2 → smoke → B3 → B4 → smoke → B5 (one flag per window) → B7. B8 waits.
**Rollback pair:** the frontend `83d30d6` and backend `5bc53a8` code can run against the migrated schema only if the rehearsal confirms the migrations are additive (see `migration-rehearsal.md`).

---

## C. Needs hardware or a human

Simulated browser runs (Playwright device emulation) are useful regression evidence. They do **not** close these items.

| Item | Needs |
|---|---|
| Signed-in catalogue check on live Spot: upload a photo, pick a profile, compare weight, CO₂ and points, edit the weight, stop before publishing | A person with a real browser file picker. Automation can do it on staging with a fixture file, but not as production acceptance. |
| Android Chrome hardware: camera, pinch, gallery, permissions, rotation, the blocked-posting recovery | Physical Android phone (the S24 was skipped at your request) |
| iPhone Safari: camera, gallery, permissions, PWA install, deep links | Physical iPhone |
| QR handoff, then *Collected*, with no duplicate rewards | Two devices and a designated QA donation |
| Two-account messaging on real browsers | Two people or two browsers on production after B4 |
| VoiceOver / TalkBack, desktop Safari and Firefox smoke tests | Real assistive tech |
| Copy, policy and support sign-off (DEP-307–308) | Owner |
| Erasure and retention rules (DEP-296), GA4/Meta scope (DEP-297), historical carbon totals (DEP-306) | Owner decisions |
| Independent recovery storage and a production recovery rehearsal (DEP-291–294) | Infra access |
| Vision Worker config capture (DEP-314) | Cloudflare access |

### Decisions made under the defer-to-model delegation

1. **One candidate per repo, gated by flags**, rather than commit batches. Reason: the checkpoint commit makes batches incoherent.
2. **Staging's auth implementation wins** wherever it is a superset of main's fixes, and main's tests stay as the oracle.
3. **Cutout stays off.** PR #24 can merge independently, because it only adds a fallback.
4. **PR #18 (colour overhaul)** stays out of the queue. Recommend closing it.
5. **Flags are activated one per window**, rate limits first, because they are the lowest-risk and fastest to roll back.
