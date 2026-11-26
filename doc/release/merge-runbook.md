# Merge runbook: backend #11 + frontend #25

This prepares the coordinated release. **Nothing in this file has been executed.** Every step is waiting for the owner's go-ahead.

| | Backend | Frontend |
|---|---|---|
| PR | [TruCycle/backend-api#11](https://github.com/TruCycle/backend-api/pull/11) | [TruCycle/web-frontend#25](https://github.com/TruCycle/web-frontend/pull/25) |
| Pinned head | `19b88ca` | `10896fe` |
| Base | `main` @ `5bc53a8` | `main` @ `0c31f71` |
| CI | ✅ green | ✅ green |
| Conflicts | none | none |

**Not in this release:** [web-frontend#18](https://github.com/TruCycle/web-frontend/pull/18), the colour palette change. It is excluded by the owner's no-redesign rule, and the recommendation is to close it.

If either PR gains a commit that changes anything outside `doc/`, the pinned heads above are void, and the alignment gate (step 0.1) runs again. To confirm a later head is still covered, run `git diff --stat <pinned> HEAD -- . ':!doc'`; it must print nothing.

---

## 0. Go / no-go (all must be ✅)

1. **Alignment gate passed on the pinned pair.** That means a contract check, a simulated E2E on desktop and phones, the old-client checks, and no conflicts (`simulated-e2e.md`, Run 6).
2. **Read-only production checks are done** (`closeout-plan.md` §B0). The results decide:
   - the `--expect` list (§2);
   - whether duplicate `google_id` rows must be resolved first;
   - whether the runtime DB role owns the new tables or has `BYPASSRLS`.
3. **Production backend env set:**
   - `TYPEORM_SYNC=false`
   - `JWT_SECRET` ≥ 32 bytes
   - `JWT_EXPIRES_IN=15m` plus an explicit `JWT_REFRESH_EXPIRES_IN`
   - `AUTH_RATE_LIMITS`, `AUTH_RESET_EMAIL_LIMITS`, `AUTH_EMAIL_OUTBOX_ENABLED`, `MESSAGE_ATTACHMENTS_ENABLED` and `FOUND_ITEM_LIFECYCLE_SWEEP_ENABLED` unset or false
4. **Production frontend build env:** `VITE_ENABLE_SMART_SPOT`, `VITE_ENABLE_PHOTO_CUTOUT` and `VITE_MESSAGE_ATTACHMENTS_ENABLED` unset or false.
5. **A recent, restorable database backup exists.** Note its timestamp here: `__________`.
6. **Users are told** they will be signed out once (R2), and the window is low-traffic.
7. **The owner has said "go"** in their own words.

## 1. Prepare (reversible, no production effect)

- Mark both PRs **Ready for review**.
- Choose **"Create a merge commit"** for both, not squash or rebase. This keeps `main` and the staging lineage as ancestors, so later reconciliation stays clean.
- Confirm each `main` has not moved since the pin: backend `5bc53a8`, frontend `0c31f71`. If one has moved, merge it into the PR branch, then rerun step 0.1.

## 2. Migrate (immediately before step 3, same window)

Run against production with a lock timeout, from the backend release-candidate checkout:

```bash
PGOPTIONS='-c lock_timeout=5s' npm run migration:run -- --apply --expect AddGoogleAuthToUser1700000000027,FoundItemLifecycle1700000000028,CreateAuthSessions1700000000029,CreateAuthRateCounters1700000000030,CreateAuthResetEmailCounters1700000000031,CreateMessageReadReceipts1700000000032,CreatePrivateMessageAttachments1700000000033,AllowRefreshRateCounter1700000000034,CreateAuthEmailOutbox1700000000035,BackfillMessageReadReceipts1700000000036
```

This list assumes the ledger ends at **026**. If it ends at 027, drop the first name. That case was not rehearsed, so rehearse it locally first.

Run the CLI **as the backend's runtime database role**, or as a role whose tables that role can use. Export the production database variables in the shell first, because the CLI no longer reads `.env`.

Then check:

```sql
SELECT name FROM public.migrations ORDER BY "timestamp" DESC LIMIT 1;  -- BackfillMessageReadReceipts1700000000036
```

The current production code keeps serving on the migrated schema, with sync off. This was rehearsed.

**Stop check before any merge.** The runtime role must be able to use the new tables, otherwise login returns 503 as soon as #11 deploys:

```sql
SELECT tablename, tableowner FROM pg_tables
 WHERE tablename IN ('auth_session','auth_rate_counter','auth_reset_email_counter','message_read_receipt','message_attachment','auth_email_outbox','found_item_observation');
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = '<runtime role>';
```

Continue only if each owner is the runtime role, or the runtime role has `rolbypassrls = true`. If not, stop. The current production code is unaffected, and nothing has been merged yet.

## 3. Merge and deploy (back-to-back)

Before merging, confirm with the owner:
- whether merging to each `main` deploys automatically, and whether that can be paused;
- that each host can **redeploy the previous build**;
- the Node version each host builds with (≥22.12, <25).

`/auth/health` can return 200 while login fails, so it is **not** a readiness signal. Use the sign-in check below.

1. Merge **backend #11**. Wait for the production deploy to show the new SHA.
   - Check that `/auth/health` returns 200.
   - Sign in on a fresh browser. It should return 200, and a new `auth_session` row should appear.
   - **If the backend deploy or the sign-in check fails, do not merge #25.** Roll the backend back (§5) and stop.
2. Merge **frontend #25** straight away. Wait for the deploy to show the new SHA.
   - **If the frontend deploy fails** while the backend is live: retry once. If the new frontend is not live within **15 minutes** of the backend going live, roll the backend back (§5). The deployed frontend breaks verify links against the new backend (R3).
3. If the Vision Worker is redeployed in this window, it goes **with** the frontend, never before it (R15).

## 4. Smoke tests (production, a real browser and a phone)

- Sign up → verification link → "Email verified" → sign in.
- Sign out, then sign in again; the session survives a reload.
- Password reset: a wrong code returns to code entry, and the correct code works.
- Found Items loads with and without a postcode.
- Spot report submits.
- Messages: send one between two accounts; the unread count clears after opening.
- Donor dashboard tiles show account-wide totals.
- Cutout flag still **off**; Smart Spot still off.

## 5. Roll back if a smoke test fails

1. **First choice: the host's "redeploy previous build"** for the frontend, then for the backend. This is the fastest route and leaves `main` untouched.
2. Use `git revert` of the merge commits only if staying rolled back. Re-releasing later then needs the reverts reverted, and the alignment gate rerun.
3. **Keep `TYPEORM_SYNC=false`.** Do not roll back the schema. The migrations are additive, and the old code runs on them (rehearsed). Attachment messages render empty until the release is re-applied.
4. Users signed in on the new release are signed out again by the rollback.

## 6. Afterwards

- Turn feature flags on one per window: rate limits, then reset-email limits, then the outbox.
- Record the evidence on DEP-291 and close the packages on production evidence only.
- Close #18 if the owner agrees.
