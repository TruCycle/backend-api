# TruCycle web app: critique of the staging redesign ("charcoal + mint", PR #21)

*Prepared 26 Nov 2026 for the TruCycle design compendium. This document gives advice only. No repository was changed.*

| | Commit | What it is |
|---|---|---|
| **Production** | `83d30d6` (main, merge of #23) | What trucycle.co.uk serves |
| **Staging** | `c93693e` (merge of #21 `codex/redesign-charcoal-mint`) | What staging.trucycle.co.uk serves |
| **Baseline** | `83d7827` (staging just before #21) | Used to separate what the restyle changed from other staging work |

---

## How this was produced

### Builds and fixtures

- Each commit was built with `npm ci && npm run build` and served with `vite preview` on ports 4301, 4302 and 4303.
- Every `/api/**` call was mocked with Playwright `page.route`. All builds received the same fixture data, shaped like the parsers in `src/features/*/api`. The fixtures cover:
  - 8 listings, 5 spots and 2 partner shops;
  - a conversation, progress, badges, a leaderboard and notifications;
  - a partner account;
  - "empty" variants of the main pages.
- Sign-in was seeded through the legacy `auth_token` and `auth_user` keys, which both builds accept. Cookie consent was pre-set except on the `02-consent-banner` shot.
- External resources were replaced with stand-ins:
  - **Unsplash hero photos:** both builds hotlink them, and they are blocked in this sandbox. They were swapped for placeholder "photo" SVGs.
  - **OpenStreetMap tiles:** swapped for a flat placeholder tile.
  - **Listing photos:** placeholder SVGs.
- Images therefore show composition only, not the quality of the photography.
- **Fixture artefacts to ignore:**
  - Partner KPI tiles all read "8" because every fixture count is the same.
  - The `16-spot-an-item` mobile shot shows the "camera unavailable" state, because headless Chromium has no camera.

### Screenshots

- Location: `doc/design-critique/shots/{prod,staging,staging-pre21}/{desktop,mobile}/NN-name.png`.
- Desktop shots are 1440×900. Mobile shots use iPhone 14 emulation at DSF 2.
- Pages that scroll inside the app shell were captured at full length.
- Side-by-side comparisons (prod left, staging right) are in `shots/compare/{desktop,mobile}-NN-name.png`.
- The capture scripts are in `harness/`.

### Measurements

- **axe-core 4.10:** WCAG 2.0, 2.1 and 2.2 A/AA rules, run on every page of all three builds at 390 px.
- **Custom probes:** horizontal overflow, the size of every interactive element, the heading outline and the computed font.
- **Keyboard focus:** captured after the transition settles.
- **Contrast:** computed for the token pairs listed in the appendix.
- **Lighthouse 12.2:** mobile preset, headless Chromium, run against localhost. Treat the absolute numbers as relative; the difference between the builds is what matters.
  - The API was not mocked during Lighthouse runs, so `/browse` measured the empty or error state.
  - Unsplash requests were blocked in all builds.
- **Repository tools:** `tools/palette-check.mjs` and `tools/restyle-guard.mjs` were run.

Raw data is in `data/`.

### Attribution

- Staging is 53 commits ahead of the shared base. Only about 16 of them are #21.
- `restyle-guard --base 83d7827` reports that #21 changed only styling, except in three files:
  - `useConfetti.ts`
  - `AchievementsPage.tsx` (confetti once per new badge)
  - `MyFoundPostsPage.tsx` (thumbnail markup restructured)
- So every difference in **words, data or flow** between prod and staging comes from the earlier staging QA work, not from the restyle. Examples:
  - "(this page)" labels;
  - "Unavailable" estimates;
  - removal of the hard-coded landing stats;
  - the public item page.
- Findings are tagged accordingly:
  - **[#21]** – caused by the restyle;
  - **[branch]** – pre-existing on staging, outside #21;
  - **[both]** – present in prod as well.

### Skills applied

Each finding cites the skill that drove it:

- **DC** = `design-skills:design-critique` + `design:design-critique` (Nielsen heuristics H1–H10, UX laws)
- **A11Y** = `design:accessibility-review` + `design-skills:accessibility-audit` (WCAG 2.2)
- **DS** = `design-skills:design-systems` + `design:design-system`
- **IxD** = `design-skills:interaction-design`
- **UXW** = `design-skills:ux-writing` + `design:ux-copy`
- **STRAT** = `design-skills:ux-strategy`
- **ELEV** = `design-skills:design-elevation`
- **JM** = `design-skills:journey-mapping`

---

## 1. Executive verdict

**Yes, staging is clearly better than production. It is not yet "modern".**

- **What PR #21 achieved:**
  - It turned an ad-hoc green UI into a *system*.
  - It removed every automated colour-contrast failure: 22 of 32 pages fail on the pre-#21 baseline, 0 on staging.
  - It replaced device fonts with self-hosted Inter and replaced a 107 KB logo with a 1.5 KB vector.
  - It fixed the remaining phone-width layouts (commit `83f52cd`).
- **What earlier staging work achieved [branch]:**
  - Dropping prod's 947 KiB of SF Pro OTFs in favour of device fonts (`736413a`). This is where most of the performance gain comes from.
  - The mobile bottom tab bar, which replaced prod's stack of three FABs that covered content.
  - The honesty pass on the landing page.
- **Why it is not yet modern:**
  - It reads as a tidy, neutral SaaS dashboard: charcoal, white cards, one pale-mint tint everywhere.
  - Some of prod's warmth and reward feeling is gone.
- **What needs fixing before promotion:**
  - The staging branch carries several *content* defects that surface on the first signed-in screen.
  - The P0 below should be fixed before staging is promoted.

### Scorecard (1 = poor, 5 = excellent)

| Dimension | Prod | Staging | Evidence |
|---|:-:|:-:|---|
| **Visual hierarchy** | 3 | 3.5 | **Staging gains:** quieter shell, one dark primary button style, larger H1s (`compare/desktop-10`, `-13`).<br>**Staging loses:** when an estimate is missing, the word "Unavailable" is set at display size and breaks mid-word (`AchievementsPage.tsx:193`, `CarbonLedgerPanel.tsx:70`, `CommunityBoardPostcodeList.tsx:52`); every listing card still has two full-width buttons (`compare/desktop-13`). |
| **Brand / identity** | 3 | 4 | **Staging:** coherent charcoal + mint; the logo became a 1.5 KB vector (prod's is a 107 KB SVG wrapping a bitmap); regenerated app icons; `theme-color #232323`.<br>**Prod:** three unrelated greens (`#0D3B24`, `#16A34A`, `#A4F5A6`) plus SF Pro. |
| **Consistency / design system** | 2 | 4 | `palette-check`: staging clean, prod 518 off-palette colours, baseline 541.<br>Staging radius tokens used 405 times and shadow tokens 34 times.<br>Gaps: type is still ad hoc (`text-[13px]` ×142, `text-[15px]` ×32, `text-[30px]` ×24, 11 px and 10 px sizes); no semantic status tokens. |
| **Accessibility** | 2 | 4 | **axe at 390 px:**<br>• prod: `color-contrast` fails on 24 of 32 pages; `button-name` (critical) on 23 pages; prod's item modal also lacks `role="dialog"`.<br>• baseline before #21: contrast fails on 22 of 32 pages (button names had already been fixed on the branch).<br>• staging: 0 contrast failures; residual axe rules are `scrollable-region-focusable` on 2 pages and `target-size` on 1 map pin. The probe (not axe) also found no H1 on Spot an item.<br>**Focus:** staging uses a 3 px charcoal outline with a 3 px white halo; prod uses the browser's 1 px auto outline (`shots/*/desktop/63-focus-*`). |
| **Mobile** | 2 | 4 | **Prod:**<br>• the FAB stack covers KPI tiles, chat and listings (`compare/mobile-10`, `-21`, `-72`);<br>• the chat pane is cut off at the right edge (`compare/mobile-21`);<br>• the leaderboard collapses into a one-word column (`compare/mobile-20`).<br>**Staging:** bottom tab bar "Spot / List / Rescue" [branch, restyled by #21], no overflow on any page, dashboard targets ≥44 px. |
| **Interaction / feedback** | 3 | 3 | **Same in both:** the claim fires on the first tap with no review step, then shows a modal *and* a toast for the same event (`shots/staging/desktop/50-claim-modal.png`).<br>**Staging gains:** confetti respects reduced motion and fires once per badge (prod showed confetti with reduced motion on, `compare/mobile-18`).<br>**Staging loses [#21]:** on desktop, the baseline's labelled bottom bar became three icon-only FABs whose labels appear only on hover or focus. |
| **Copy** | 3 | 2.5 | **Prod:** warm voice, but hard-coded figures (landing stats; a dashboard chart drawn from a constant array).<br>**Staging [branch]:** honest, but leaks how it is built: "Items listed (this page)", "0.0kg Est. CO2e (completed, this page)", "Unavail/able", raw values such as `like_new`, "catalog score", and a duplicated distance ("About 1 km away · 1.2 km away"). |
| **Trust / credibility (marketplace)** | 2 | 3.5 | **Prod:**<br>• hard-coded, unsubstantiated stats in `LandingHero.tsx` and `LandingImpactSection.tsx` ("12,400+ items rehomed / 38 tons / 94%");<br>• hard-coded 5-star testimonials;<br>• a dashboard "CO2 Saved" that sums the estimate for *every* listing, not just completed hand-offs;<br>• full postcodes on cards ("E15 1AA");<br>• a cookie banner that nudges towards Accept.<br>**Staging:** "Illustrative photos, not current listings"; approximate areas; Reject and Accept given equal weight.<br>**Still weak:** the public item page has no donor, description, photo gallery or safety cues (`shots/staging/desktop/06-item-detail.png`). |
| **Delight / gamification** | 3.5 | 3 | **Prod:** colourful gradient badges, tier colours, and a "Your Environmental Impact" chart drawn from `IMPACT_VALUES = [52, 31, 56, …]`, a constant rather than user data (`DonorEnvironmentalImpactCard.tsx:10`).<br>**Staging:**<br>• flattened badges to grey and mint discs [#21; the baseline still had gradients, `shots/staging-pre21/desktop/18-my-impact.png`];<br>• the level track is now L1–L10 boxes in charcoal and mint;<br>• there is no data visualisation of impact at all (`compare/desktop-18`). |
| **Performance (extra)** | 2 | 5 | **Lighthouse home:** prod 59 perf (LCP 9.4 s, 1,452 KiB); baseline 86 (LCP 3.7 s, 266 KiB); staging 91 (LCP 3.2 s, 213 KiB).<br>**Lighthouse login:** prod 59; baseline 94; staging 97.<br>Prod ships three SF Pro `.OTF` files (947 KiB) plus a 111 KiB favicon. The big jump is [branch] (`736413a`, device fonts); #21 then added Inter (47 KiB) and still gained a little by shrinking the logo and icons. |

> **Note on the font.** Prod self-hosts Apple's SF Pro OTF files at `/fonts/SFPRODISPLAY*.OTF`. Apple licenses SF Pro for Apple platforms only, so serving it on the web is a licensing risk as well as a performance problem. The staging branch stopped loading it in `736413a`, and #21 deleted the now-unused files (`23f1325`). Keep it out.

---

## 2. What staging got right (keep)

1. **Token-first palette** (`tailwind.config.js`, DS).
   - A single `brand` object feeds the semantic groups (`tc.app.*`, `tc.shell.*`, `tc.auth.*`, `tc.action.*`).
   - Tailwind's own grey, green and red scales are re-pointed at the palette, so legacy class names can't drift.
   - That is the right migration trick for a codebase with ~670 `rounded-*` call sites.
2. **Guard tools** (DS governance).
   - `palette-check.mjs` stops off-palette colours. It is clean on staging and finds 518 on prod.
   - `restyle-guard.mjs` checks that a restyle diff touches styling only.
   - Few teams of this size have that discipline. **Put both in CI** for every PR and document them in the compendium.
3. **Text tokens that pass contrast** (A11Y). Verified:

   | Token | On white | On the page tint |
   |---|---|---|
   | `ink` | 18.5:1 | — |
   | `body` | 7.8:1 | 7.4:1 |
   | `muted` | 5.6:1 | 5.4:1 |

   The config comment says "all pass 4.5:1", and that is true for these tokens. axe found zero contrast failures on 32 staging pages, against 24 of 32 on prod and 22 of 32 on the pre-#21 baseline. **This is #21's clearest win.**
4. **Strong focus indicator** (A11Y, WCAG 2.4.7 and 2.4.13).
   - `:focus-visible` gives a 3 px `#232323` outline at 3 px offset, plus a 3 px white halo.
   - It is visible on both the light canvas and the charcoal sidebar and navigation (`shots/staging/desktop/63-focus-sidebar.png`, `-homenav.png`).
   - There is also a skip link ("Skip to main content").
5. **Mobile bottom tab bar** in place of three stacked FABs [branch; restyled by #21] (DC Fitts's law, IxD).
   - On mobile it puts Spot / List / Rescue in the thumb zone with text labels.
   - Content is no longer covered (`compare/mobile-21`, `-72`).
6. **Inter, self-hosted and variable** (ELEV). About 47 KiB of woff2 with no third-party request, and the same typeface on every OS, which device fonts can't guarantee.
   - Performance held up: home 86 → 91 against the baseline.
   - Most of the gain over prod (59) comes from the branch dropping SF Pro.
7. **Honest marketing surfaces [branch]** (STRAT trust, UXW responsible lens).
   - Hard-coded stats and testimonials were removed from the landing page.
   - "Illustrative photos, not current listings" is stated plainly.
   - Real listings now appear on the home page ("See what neighbours are giving away").
   - Areas are shown as approximate outward codes.
   - For a marketplace whose central risk is "is this real and safe?", this is the right instinct.
8. **Equal-weight cookie choices** (UXW responsible lens, UK PECR/ICO guidance).
   - "Reject optional" and "Accept optional" have the same visual weight.
   - Prod highlights "Accept cookies" in green against a muted "Not now" (`compare/mobile-02`).
9. **Chat bubbles and status chips** (DC Law of Similarity).
   - Incoming messages are mint and outgoing messages are charcoal (`compare/mobile-21`).
   - Listing status now has distinct chips: Active, Awaiting approval, Ready for collection.
   - Desktop KPI cards and tables are calmer (`compare/desktop-30`).
10. **Motion hygiene** (IxD).
    - `prefers-reduced-motion` disables the FAB bob, float and glow animations.
    - Confetti is checked against reduced motion and fires once per new badge (`useConfetti.ts`, `AchievementsPage.tsx`).

---

## 3. Problems, prioritised

Severity follows Nielsen's 0–4 scale mapped onto P0–P3:

- **P0** – fix before staging is promoted to production;
- **P1** – next sprint;
- **P2** – soon;
- **P3** – polish.

### P0

**P0-1 · Signed-in home KPIs show build details and a misleading 0 [branch]**
- **Where:** `compare/desktop-10-dashboard-donor.png` and `compare/mobile-10-dashboard-donor.png`.
- **Problem:** The first tiles a donor sees read:
  - "Items listed (this page)";
  - "Completed (this page)";
  - "0.0kg Est. CO2e (completed, this page)".
  These sit next to "1240 pts".
- **Code:** `Dashboard.tsx:111` computes CO₂e from `donorListings`, the first page of listings, counting only status `Completed`. It returns `null` if any completed listing has no estimate. The labels at lines 194–206 say "(this page)" outright.
- **Principles:** H2 match with the real world (pagination is a developer concept); UXW (useful lens); STRAT (the impact number *is* the product promise). A donor whose completed hand-offs sit on page 2 sees 0 kg.
- **Context:** Prod's version is worse in the opposite direction. "35.7kg CO2 Saved" sums every listing, completed or not. Staging's honesty is right; the presentation is what needs fixing.
- **Fix:**
  - Back the tiles with account totals (`/items/me/impact` already returns `items_donated` and `total_co2_saved_kg`), or drop them.
  - Copy: "Items listed · 4", "Handed on · 0", "CO₂e kept out of landfill (est.) · 12 kg", "Points · 1,240".
  - When the estimate is missing, show "—" with the helper text "Estimate appears after your first hand-off", never "0.0kg".

### P1

**P1-0 · Missing estimates are shown as "Unavailable" at display size and break mid-word [branch copy; #21 added `[overflow-wrap:anywhere]`]**
- **Where:**
  - My Impact hero tile: `AchievementsPage.tsx:193` renders `totalCo2eKg ?? 'Unavailable'` at 30 px.
  - Points ledger: `CarbonLedgerPanel.tsx:70`.
  - Leaderboard rows: `CommunityBoardPostcodeList.tsx:52`.
  - The mid-word split ("Unavaila / ble") was observed during a capture where the endpoint returned no estimate. With an estimate present the tile reads "120.5" (`compare/desktop-18`). How often real users hit the empty case depends on the backend.
- **Principles:** Visual hierarchy and Von Restorff (when empty, the most prominent thing on the page is a non-value); H8.
- **Fix:**
  - Never set an empty state at display size.
  - Make the value slot a component with `value | empty` states. When empty, render `—` in `text-tc-brand-muted text-2xl` with a 13 px caption "Not estimated yet".
  - Replace `[overflow-wrap:anywhere]` with `overflow-wrap: normal` on numerals.
  - On leaderboard rows, drop the CO₂e column when it is empty for every row.

**P1-1 · Two different "primary" button treatments for the same action [both; #21 kept the split]**
- **Where:** On `compare/desktop-01-home.png` the navigation has "Post an item" in **mint** and the hero has "Post an item →" in **charcoal**. Prod has the same split (light-green navigation CTA, dark hero CTA). Elsewhere:
  - "List New Item" is mint (`compare/desktop-10`, `-41`);
  - "Request a Claim", "Sign Up", "Log in" and "Start Scan" are charcoal.
- **Principles:** H4 consistency; DC Law of Similarity; DS "same purpose means same pattern".
- **Fix:** Write the rule into the system and enforce it with one `<Button variant>`:
  - `primary` = charcoal (`action.primary`), the one main action per view;
  - `accent` = mint, reserved for *creating supply* ("Post / List / Spot") and for celebration states;
  - one accent button per screen at most;
  - change the hero CTA to `accent`, or the navigation CTA to `primary`, so the same action matches on the same page.

**P1-2 · Listing cards carry two full-width buttons each; IA labels don't match [both]**
- **Where:** `compare/desktop-13-browse-signed-in.png`. There are 16 stacked buttons for 8 items. The page H1 reads "Welcome back!" under the navigation item "Browse Items".
- **Principles:** Hick's law and H8 (noise); Krug "page name matches what was clicked"; IA labelling.
- **Fix:**
  - Make the whole card the link to the item.
  - Keep one action, "Request" (charcoal, `min-h-11`), or move the request into the item view.
  - Set H1 to "Browse items" with a count ("8 free items near E15").
  - Turn chips into a horizontally scrolling `role="tablist"` with a fade edge. "Garden + Too…" is currently clipped with no scroll cue (`compare/desktop-05`).

**P1-3 · Item detail is too thin to convert or reassure [branch for the public page; both for the signed-in modal]**
- **Where:**
  - Public page: `shots/staging/desktop/06-item-detail.png`. Prod has no public item route, so `/items/:id` returns its 404.
  - Signed-in "View Item" modal: `compare/desktop-52-item-detail-signed-in.png`. Both builds show only category, condition and location under the subtitle "View and manage your item details", although this is someone else's item. Neither offers a request action inside the modal. Prod's modal also has no `role="dialog"`.
  - The public page shows only the title, one image, a key/value table (`furniture`, `good`, `active`), a mint note and one button. Missing: donor, description, posted date, CO₂e estimate, more photos, similar items, safety guidance, share.
- **Principles:** STRAT marketplace trust (the transaction's "moment of truth" is here, and this page is where search and shared links land); H2 (raw values); JM.
- **Fix:** Use a two-column layout at `lg`:
  - **Left:** a gallery with 4:3 crop and thumbnails.
  - **Right:**
    - title;
    - chips for category and condition in human labels ("Like new");
    - "Given by Priya S. · member since 2025 · 12 hand-offs";
    - "Area E15 · about 1 km";
    - an "Est. 12 kg CO₂e kept in use" pill;
    - a primary "Sign in to request";
    - a secondary "Share".
  - **Below:**
    - "How collection works", in three steps;
    - "Similar items nearby";
    - structured data (`Product` and `Offer` with `price: 0`) for SEO.

**P1-4 · Raw values and duplicated data in copy [branch]**
- **Where:**
  - `compare/desktop-05` and `-13`: chips `like_new`, `good`, `furniture`.
  - Partner table: `furniture`, `electronics`.
  - Home and public browse: "Area E15 - About 1 km away · 1.2 km away".
  - Item page: `active`.
  - Map: "Last seen 26/11/2026, 14:25:19".
  - Leaderboard: "Ranked by catalog score".
- **Principles:** H2; UXW clarity and consistency; numbers and dates guidance.
- **Fix:**
  - Add a `labels.ts` map: `like_new` → "Like new", `active` → "Available", and so on.
  - Show one distance string only: "E15 · about 1 km".
  - Dates: "Seen today, 2:25pm" or "26 Nov, 2:25pm", never with seconds.
  - "catalog score" → "impact points".

**P1-5 · Status colour semantics: the same amber means "waiting" and "ready" [branch logic + #21 colour]**
- **Where:** `compare/mobile-72-selected-items.png`. "Ready for collection" and "Awaiting approval" are both amber.
- **Problem:**
  - `CollectedItemsPage.tsx` `statusTone()` has only two tones, `claimed` and `collected` [branch]. #21 painted `claimed` amber.
  - The palette has `danger` but no success, warning or info roles. `palette-check` allows amber only as "claimed". Mint-600 `#2F8F55` reaches only 4.05:1 on white, so it cannot be used for status text.
- **Principles:** WCAG 1.4.1 (colour plus label is fine, but the colours contradict each other); DS semantic tier.
- **Fix:** Add semantic tokens (values in §4). Then:
  - Ready for collection = `success` (fg `#1F6B3F` on `#DDF4E3`, 5.6:1);
  - Awaiting approval = `warning` (fg `#7A4B00` on `#FFF1D6`, 6.6:1);
  - Completed = `neutral`;
  - Removed = `danger`.

**P1-6 · Desktop quick actions became icon-only mystery buttons [#21 regression]**
- **Where:** `compare/desktop-13`, `-18`, `-41`. There are three circular buttons (camera, plus, van), and the labels appear only on hover or focus.
  - The pre-#21 baseline had a labelled "Spot / List / Rescue" bar at the bottom on desktop too (`shots/staging-pre21/desktop/13-browse-signed-in.png`).
  - Prod showed the FAB labels permanently. On My Impact they also overlap the badge card edge.
- **Principles:** IA "icon-only labels" and DC mystery-meat navigation; Fitts's law (bottom-right is far from the content's F-path).
- **Fix:** On `lg` and up, replace the FAB stack with one "+ New" split button in the header (Spot an item / List an item / Find items to rescue). Alternatively, use a single labelled extended FAB (`h-12 px-5`, "Spot an item"). Keep the bottom bar on mobile.

**P1-7 · Claim and collect: no review step, then double feedback [both]**
- **Where:** `shots/staging/desktop/50-claim-modal.png`. One tap on "Request a Claim" sends the request immediately. Then a centred "Request Sent!" modal *and* a "Claim request submitted" toast appear together.
- **Principles:** H5 error prevention (a claim commits the user to travel and to a social contract with the donor); IxD "match feedback intensity", "one feedback per event"; peak-end rule.
- **Fix:**
  - Open a short sheet: item, area, pickup option, an optional message to the donor, then "Send request".
  - On success, close the sheet with one toast: "Request sent to Priya. We'll message you when she replies." Add an "Undo" action for 10 s.
  - Reserve the celebration modal for **collection completed**, which is the real peak.

**P1-8 · Sign-in still shows a hard-coded, unattributed testimonial; mobile auth has no brand [both]**
- **Where:** `compare/desktop-03-sign-in.png` shows "Sophie, London ★★★★★ Jan 2026". `compare/mobile-04-sign-up.png` starts straight with "Welcome to TruCycle", with no logo.
- **Principles:** STRAT trust (it contradicts the honesty of the landing page); H4.
- **Fix:**
  - Replace the card with verifiable facts ("Free, always · No selling · Approximate locations only") or a real, consented quote.
  - On mobile, add a 40 px logo and a back link above the form.
  - Make "Terms of Service" and "Privacy Policy" links. They are plain text today.

### P2

**P2-1 · Type scale is ad hoc [#21]**
- **Problem:** `text-[13px]` ×142, `[15px]` ×32, `[30px]` ×24, `[11px]` ×13, `[10px]` ×3, plus custom `tracking-[…]` values ×142. Eleven and ten px are below a legible floor for body text on mobile.
- **Skills:** DS (no typography tokens); ELEV.
- **Fix:** Use the scale in §4 and ban sizes below 12 px with a lint rule, extending `palette-check` with a `TYPE` regex.

**P2-2 · Surfaces lack separation [#21]**
- **Problem:** Card border `line #E6EAE4` on the `haze #F7FBF4` page is 1.16:1. Pale-mint panels `#DDF4E3` on white are also 1.16:1. Separation therefore rests on the `tc-card` shadow (6% alpha). In sunlight, or on low-quality panels, cards dissolve, and the many mint "info" boxes look like selected states (`compare/mobile-10`: the Streak and Points panel and the rescue ticker are the same mint as selected chips).
- **Skills:** DC common region; WCAG 1.4.11 only where a boundary identifies a control.
- **Fix:**
  - Use `line-strong #C9D3CD` for card borders on the haze canvas.
  - Reserve `mintSoft` for *selected / you* states.
  - Use `soft #F0F3ED` for neutral info panels.

**P2-3 · Progress track contrast [#21]**
- **Problem:** The level-progress track `#B4BFB8` against white is 1.89:1 (WCAG 1.4.11 needs 3:1 for the bar's extent to be perceivable).
- **Fix:** Use `#8A968E` (3.07:1) or add a 1 px `control` outline.

**P2-4 · Notification dot is `#FF9C2D` on white (2.09:1) [both]**
- **Problem:** It is the only unread signal on the bell in the light header.
- **Skills:** A11Y 1.4.11.
- **Fix:** Use `#C2410C` (5.18:1) or a numeric badge with `aria-label="3 unread notifications"`.

**P2-5 · Emoji as category icons [branch, kept by #21]**
- **Problem:** 🛋️ ⚡ 🍳 📚 🧸 🪴 appear on chips next to Lucide line icons. They render differently on each OS; on the Linux capture 🍳 rendered as a magnifier. They clash with the Lucide 1.5 px stroke style.
- **Skills:** DS iconography; ELEV.
- **Fix:** Use a Lucide set at 16 px, `stroke-width 1.75`: `Sofa`, `Zap`/`PlugZap`, `CookingPot`, `BookOpen`, `Baby`, `Sprout`, `Shirt`.

**P2-6 · Map: hard to read, and pin numbers are unexplained [both]**
- **Problem:**
  - Pins show impact points (20, 30…) with no legend entry.
  - "Claimed" is a hollow circle and "Rescued" a black dot. This is shape plus colour, which is good, but the pin itself doesn't use those shapes.
  - There is no clustering.
  - The distance stat breaks into five lines in a narrow tile ("Less than 1 km away (approx.)", `compare/desktop-15`).
  - One pin fails WCAG 2.5.8 target size (22 px, axe `target-size`).
- **Fix:** See map styling in §4. Also:
  - give pins a 32 px hit area;
  - shorten the distance tile to "< 1 km";
  - add "pts" to the legend.

**P2-7 · Missing H1 on Spot an item; scrollable table not focusable [both]**
- **Problem:** The heading outline is empty on `/found-items/post` in all builds. axe reports `scrollable-region-focusable` on the partner tables (`.overflow-x-auto`).
- **Skills:** A11Y 1.3.1 and 2.1.1.
- **Fix:**
  - Add a visually hidden `<h1>Spot an item</h1>`.
  - Add `tabindex="0" role="region" aria-label="Recent activity table"` on the scroll wrapper.

**P2-8 · Empty states state a fact but give no reason [both]**
- **Where:**
  - `compare/desktop-41` shows "Your listed items will be displayed here" with a lone, unlabelled refresh icon button.
  - `compare/desktop-42` shows the messages empty state.
- **Skills:** UXW empty-state pattern; IxD "avoid blank slates".
- **Fix:**
  - "Nothing listed yet. Offer something you no longer need and a neighbour can collect it — most items go within 48 hours¹." Then a "List an item" button.
  - Remove the refresh button, or label it "Refresh list".
  - ¹ Use the stat only when it is real.

**P2-9 · Consent banner covers the hero CTA on mobile [both]**
- **Where:** `compare/mobile-02`. The card sits over the search box and "Post an item".
- **Skills:** WCAG 2.4.11 focus not obscured (when tabbing into the CTA).
- **Fix:** Anchor it as a bottom sheet with `inset-x-0 bottom-0`, add body bottom padding equal to its height, and leave the hero visible.

**P2-10 · Hotlinked Unsplash photography [both]**
- **Problem:** The landing hero and category tiles load from `images.unsplash.com`. This adds a third-party dependency and a privacy leak (referrer and IP), offers no art direction, and the photos are not of real TruCycle items.
- **Skills:** STRAT; ELEV.
- **Fix:** Self-host 3–6 commissioned or owned photos (see the photography direction in §4) as AVIF/WebP with `srcset`.

### P3

- **P3-1 · Delight was flattened [#21].** Badges became grey or mint discs, and tiers lost their colour (`compare/desktop-18`). IxD peak-end rule. Restore one celebratory moment per achievement (§4 micro-interactions) without going back to rainbow gradients.
- **P3-2 · Wordy role toggle.** The "Spotter / Collector / Donor" segmented control sits at the bottom of the sidebar, where it is easy to miss. The dashboard content changes completely, but the page title stays "Welcome back!". Name the mode in the page header ("Donor view ▾"). IxD modes need to be impossible to miss.
- **P3-3 · Inconsistent capitalisation.** "List New Item", "Request a Claim", "View All" and "Browse Other Items" are in Title Case. Use sentence case for buttons (UXW): "List an item", "Request item", "View all".
- **P3-4 · Messages: error copy.** "Read status could not be saved. Retry read status" exposes the plumbing. Use "Couldn't mark as read. Retry" with an icon, inline under the thread header. This was seen only with an early fixture that rejected the read receipt, and it is no longer in the delivered shots, but the string is real UI.
- **P3-5 · `rounded-[24|28|32|36|48px]` one-offs** (8 call sites). Fold them into `tc-xl` or a new `tc-2xl`.

---

## 4. Make it modern: a concrete direction

The direction is **"neighbourly utility, quietly premium"**. Think of the calm density of modern resale and local-exchange apps, with the confident numbers of fitness and impact trackers:

- photo-first cards;
- a single strong accent;
- big tabular numerals for impact;
- soft but legible surfaces;
- motion that confirms rather than decorates;
- a real dark mode.

### 4.1 Type scale (Inter Variable, `font-feature-settings: "cv11","ss01","tnum" on numerals`)

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 48/52 (mobile 36/40) | 650 | -0.03em | Landing hero only |
| `title-1` | 30/36 (mobile 26/32) | 650 | -0.02em | Page H1 |
| `title-2` | 22/28 | 600 | -0.015em | Section H2 / card group |
| `title-3` | 18/24 | 600 | -0.01em | Card title |
| `body-lg` | 17/26 | 400 | 0 | Lead paragraphs |
| `body` | 15/22 | 400 | 0 | Default UI text; replaces 13–15 px |
| `label` | 14/20 | 550 | 0 | Buttons, chips, form labels |
| `caption` | 13/18 | 450 | 0.005em | Metadata only |
| `overline` | 12/16 | 600 | 0.06em, uppercase | ≤3-word eyebrows |
| `numeric-xl` | 40/44 | 650 | -0.02em, `tabular-nums` | KPI values |

Floor: nothing below 12 px. In Tailwind, these become `fontSize: { 'tc-display': ['48px', { lineHeight: '52px', letterSpacing: '-0.03em', fontWeight: '650' }], … }`.

### 4.2 Colour roles: light, dark and semantic

The contrast ratios below were computed for this document.

| Role | Light | Dark | Notes |
|---|---|---|---|
| `bg/canvas` | `#F7FBF4` | `#0F1311` | |
| `bg/surface` | `#FFFFFF` | `#181D1A` | |
| `bg/surface-sunken` | `#F0F3ED` | `#121613` | Info panels |
| `bg/inverse` (shell) | `#232323` | `#1E2420` | Keep the charcoal sidebar on light |
| `border/subtle` | `#E6EAE4` | `#2C332E` | Dividers inside cards |
| `border/default` | `#C9D3CD` | `#3A433D` | Card edge on canvas |
| `border/control` | `#87928A` (3.2:1) | `#6B776F` (3.65:1) | Inputs, outline buttons |
| `text/primary` | `#0F1510` (18.5) | `#ECF1EC` (16.4) | |
| `text/secondary` | `#4A554C` (7.8) | `#A3AEA6` (7.5) | |
| `text/tertiary` | `#5C6B63` (5.6) | `#8A958E` | |
| `accent` (mint) | `#8EE3A8` + `onAccent #0B1F16` (11.2) | same | Mint is a *fill*, never text on white (1.53:1) |
| `accent/strong` | `#1F7A45` (5.35 on white) | `#8EE3A8` (11.2) | Links, icons and "you" marks on light |
| `success` fg / bg | `#1F6B3F` / `#DDF4E3` (5.6) | `#8EE3A8` / `#16301F` | |
| `warning` fg / bg | `#7A4B00` / `#FFF1D6` (6.6) | `#F5C26B` (10.4) / `#2E2410` | |
| `danger` fg / bg | `#B3261E` / `#FBEDEC` (5.7) | `#F2B8B5` (10.0) / `#3A1412` | |
| `info` fg / bg | `#1D4F7A` / `#E3EEF8` (7.3) | `#9CC7EE` / `#14263A` | |
| `notify` | `#C2410C` (5.2) | `#FF9C2D` | Unread dot |
| `focus` | outline `#232323` + halo `#FFF` | outline `#8EE3A8` + halo `#0F1311` | |

- **Dark mode:** ship it with `darkMode: 'class'` plus `prefers-color-scheme`. Staging has 0 `dark:` classes today.
- Because the semantic `tc.*` layer already exists, dark mode means redefining the CSS variables, not rewriting components.

### 4.3 Elevation

There are four levels. Each uses a border *and* a shadow, so separation survives bright screens.

| Level | Treatment |
|---|---|
| `e0` | Flat; `border/subtle` |
| `e1` (card) | `border/default` + `0 1px 2px rgb(15 21 16 / .06)` |
| `e2` (raised / sticky) | `0 6px 16px rgb(15 21 16 / .10)` |
| `e3` (sheet / dialog) | `0 24px 64px rgb(15 21 16 / .22)` + backdrop `rgb(15 21 16 / .45)` with `backdrop-blur-sm` |

On dark, replace shadows with a 1 px lighter top border (`#FFFFFF0F`).

### 4.4 Radius

Keep the existing four steps and add one:

| Token | Size | Use |
|---|---|---|
| `sm` | 8 | Chips |
| `md` | 12 | Controls |
| `lg` | 18 | Cards |
| `xl` | 24 | Sheets and panels |
| `2xl` (new) | 32 | Hero media only |
| `full` | — | Avatars, pills and segmented controls only, not primary buttons |

Make primary buttons `md` (12). Pill buttons and pill inputs (search) blur the button/chip distinction.

### 4.5 Motion tokens

| Token | Value | Use |
|---|---|---|
| `duration-instant` | 100 ms | Colour and opacity |
| `duration-fast` | 160 ms | Press scale 0.97, chip select |
| `duration-base` | 240 ms | Sheet and toast enter |
| `duration-slow` | 400 ms | Celebratory count-up, page-level transitions (View Transitions API for list → item) |

- **Easing:** `standard cubic-bezier(.2,0,0,1)`, `emphasised cubic-bezier(.3,0,0,1.2)` (celebrate only), `exit cubic-bezier(.4,0,1,1)`.
- Remove the perpetual `tc-fab-bob` animation. Continuous motion on an always-visible control is noise (IxD feedback that never diminishes).
- Keep the reduced-motion rule as it is.

### 4.6 Iconography

- Lucide only, with three sizes (16/20/24) and stroke 1.75.
- Filled variants only for "selected / you".
- Swap the emoji for Lucide (P2-5).
- Give each top-level verb its own glyph, used everywhere:

  | Verb | Glyph | Shape |
  |---|---|---|
  | Spot | `ScanEye` or `Camera` | Circle |
  | List | `PackagePlus` | Square |
  | Rescue / Collect | `HandHeart` or `Truck` | Pin-drop |

  These same three shapes become map pin glyphs.

### 4.7 Illustration and photography

- **Photography:** real items in real London doorways and hallways.
  - Natural light, 4:3, eye-level, the object fills 60% of the frame, with a warm neutral background.
  - This matches the "List with light" advice the app already gives donors, so the marketing shows the behaviour it asks for.
- **Listing images:**
  - auto-crop to 4:3 with `object-cover`;
  - lay a subtle `bg-gradient-to-t from-black/30` scrim under the overlaid chips;
  - add blur-up placeholders.
- **Illustration:** a single-weight line illustration set in charcoal with mint fills, for empty states only (empty listings, no messages, no spots nearby, offline). It should be friendly, not cartoonish. Six drawings cover the app.

### 4.8 Map styling

- Use a custom vector or raster style in the brand neutrals:
  - land `#EEF1EC`, water `#D6E6EE`, parks `#DCEBD9`, roads white with `#D5DBD6` casings;
  - labels in `#5C6B63`, with POIs turned off.
- MapTiler or Stadia "light" base styles can be recoloured; OSM attribution stays.
- **Pins:** a 32 px charcoal teardrop with a mint glyph for live spots, outline only for claimed, a small grey dot for rescued.
- Cluster above 10 pins.
- Selected pin: scale 1.15 plus the `e2` shadow, with a bottom sheet (mobile) or side card (desktop).
- Your location: a mint dot with a pulsing halo (static under reduced motion).
- Show the approximate-area circle instead of a point for privacy-approximate items. That makes the privacy promise visible.

### 4.9 Data visualisation for impact

Replace "numbers in cards" with three honest, glanceable visuals:

1. **"Kept in use" ring.** Count of items handed on this month against a personal goal, with a count-up on load.
2. **Monthly bar chart.** Twelve bars of estimated CO₂e. Use mint fill for confirmed hand-offs and a hatched pattern for estimates, labelled "estimate" directly on the chart, never via colour alone.
3. **Local leaderboard rows.** Rank number in `numeric-xl`, a sparkline of the last 4 weeks, and a "You" highlight using the `success` role.

Hide any chart with fewer than 2 data points and show the empty-state illustration instead. Never show a sample curve, as prod does today.

### 4.10 Micro-interactions (Saffer trigger → rules → feedback)

| Moment | Trigger | Feedback |
|---|---|---|
| **Request sent** | "Send request" | Button morphs to a ✓ (160 ms); toast with Undo (10 s). |
| **Spot posted** | Photo + location locked | Card flies to "My spots" (240 ms, emphasised); points chip "+25" counts up. |
| **Collection confirmed (the peak)** | QR scan or "Confirm collection" | Full-screen sheet: item photo, "You kept 14 kg CO₂e in use", streak +1, one confetti burst (reduced motion: static badge). Share card generated (html-to-image is already a dependency). |
| **Status chip change** | Server event | Chip cross-fades colour and label, plus `aria-live="polite"` announcement. |
| **Pull to refresh (mobile lists)** | Overscroll | Mint progress ring, not a spinner. |

**Benchmark patterns** (described, not copied):

- local-exchange apps put photo, distance and "given by" on each card with a single tap target;
- resale marketplaces show seller reputation and response time at the top of the item page;
- fitness and impact trackers use rings, streak flames and month bars with big tabular numerals;
- transit apps use clustered, glyph-coded pins with a bottom sheet.

TruCycle's difference is **honesty about estimates**. Make "est." and approximate areas a visible design feature (hatched bars, area circles), not a footnote.

---

## 5. Design-system recommendations for the compendium

### 5.1 Token naming (W3C DTCG three-tier)

- **Reference tier:** `tc.ref.charcoal.900 = #232323`, `tc.ref.mint.300 = #8EE3A8`, `tc.ref.neutral.50…950`. These are today's `brand.*` and `neutralScale`, renamed numerically.
- **System / semantic tier:** `tc.sys.color.{bg,text,border,accent,success,warning,danger,info,focus}.{default,subtle,strong,inverse,on}`, plus `tc.sys.{radius,elevation,motion,type}.*`.
- **Component tier:** `tc.comp.button.primary.bg → tc.sys.color.bg.inverse`, `tc.comp.chip.selected.bg → tc.sys.color.success.subtle`, and so on.
- **Retire the screen-named groups.** `tc.auth.*` has 30 keys and `tc.header.*` and `tc.shell.*` overlap. They are named by *page*, not purpose, so `auth.submit`, `action.primary` and `header.avatar` are all `#232323`. Map them to the semantic tier, then delete them.
- Emit tokens as CSS variables (`--tc-color-text-primary`) so dark mode and future native apps share one source. Style Dictionary can produce the Tailwind config, CSS and iOS/Android outputs.
- **Lint:**
  - extend `palette-check.mjs` with **TYPE** (ban `text-[Npx]`), **RADIUS** (ban `rounded-[…]`) and **SPACE** (flag `p-[…]`; 239 arbitrary spacing values today);
  - run `restyle-guard` and `palette-check` in CI on PRs to `staging` and `main`.

### 5.2 Component inventory (current state → target)

| Component | Variants (≤5) | States to spec | Today |
|---|---|---|---|
| Button | primary, accent, secondary, ghost, danger | default, hover, pressed, focus, disabled, loading | Exists in `shared/ui/button`, but bypassed by bespoke classes (P1-1) |
| IconButton | default, inverse | + `aria-label` required | Prod had unnamed buttons (axe `button-name`) |
| Chip / FilterChip | filter, status, tag | selected, focus, disabled | Mixed emoji + raw values |
| StatusBadge | success, warning, danger, info, neutral | — | Needs the semantic tokens (P1-5) |
| Card / ListingCard | grid, row, compact | loading skeleton, sold/claimed overlay | Two-button pattern (P1-2) |
| KPI / StatTile | number, ring, delta | value, empty "—", loading | "Unavailable" problem (P1-0) |
| ProgressTrack / LevelTrack | linear, segmented | — | Track contrast (P2-3) |
| Sheet / Dialog | modal, bottom-sheet, side-panel | focus trap, return focus, Esc | Claim flow (P1-7) |
| Toast | success, error, info (+ action) | auto-dismiss 5 s, pause on hover | Duplicates modal |
| EmptyState | first-use, cleared, no-results, error | illustration + body + CTA | P2-8 |
| SegmentedControl / Tabs | default, inverse | arrow-key nav, `role=tablist` | Leaderboard, map filters |
| MapPin / MapLegend / AreaCircle | live, claimed, rescued, cluster, you | 32 px hit area | P2-6 |
| BottomNav (mobile) / QuickCreate (desktop) | — | current, badge | Replaces FABs (P1-6) |
| AppShell / Sidebar / RoleSwitcher | — | — | P3-2 |

### 5.3 Documentation format per component (for the compendium)

Each entry should cover:

- **Basics:** name, purpose (one sentence), anatomy diagram, variants with when-to-use, and the states matrix screenshot.
- **Tokens used.**
- **Content rules:** labels in sentence case, maximum characters, truncation.
- **Accessibility:** role, keyboard, announcement.
- **Do and don't**, illustrated with prod-vs-staging shots from `shots/compare`.

Keep a **content glossary** in the same place:

| Term | Meaning |
|---|---|
| Spot | Something found on the street |
| List / Offer | Your own item |
| Request | Collector asks |
| Approve | Donor accepts |
| Collect | Hand-off done |
| Est. CO₂e | Always "est." |
| Area | Outward postcode only |

Also include the **voice chart**: honest, neighbourly, brief; never "awesome", never invented numbers.

---

## 6. Quick wins vs bigger bets

### Quick wins (≤1 day each)

1. KPI tile copy and data fix: remove "(this page)", show "—" for empty values (P0-1, P1-0).
2. `labels.ts` for condition, category and status values, plus a single distance string (P1-4).
3. One CTA rule. The landing hero and navigation "Post an item" should use the same variant (P1-1).
4. Semantic status tokens: `success`, `warning` and `info`, applied to listing and claim chips (P1-5).
5. Notification dot `#C2410C`; progress track `#8A968E`; `border/default` on cards (P2-2, P2-3, P2-4).
6. Spot page H1; focusable table region; 32 px map pin hit area (P2-6, P2-7).
7. Replace emoji with Lucide category icons (P2-5).
8. Sentence-case button labels across the app (P3-3).
9. Replace the sign-in testimonial with verifiable facts; link Terms and Privacy (P1-8).
10. Add `palette-check` and `restyle-guard` to CI; add TYPE and RADIUS lint rules (§5.1).

### Bigger bets (1–3 sprints)

1. **Claim and collect redesign.** Request sheet, Undo toast, status timeline (Requested → Approved → Ready → Collected), and a celebratory collection-complete screen with a share card. This makes the moment of truth the peak (JM, IxD).
2. **Public item page v2** with donor reputation, gallery, CO₂e estimate, similar items and structured data. This is the landing page for every shared link and search result (STRAT).
3. **Impact data viz.** Ring, monthly bars with hatched estimates, leaderboard sparklines (§4.9).
4. **Dark mode** through CSS-variable semantic tokens (§4.2).
5. **Branded map:** custom style, glyph pins, clusters, approximate-area circles (§4.8).
6. **Type scale tokens and migration** of the 142 `text-[13px]` call sites (§4.1).
7. **Owned photography and an illustration set** to replace the Unsplash hotlinks (§4.7).
8. **Desktop QuickCreate split button** replacing the FABs (P1-6).

### Journey notes (JM)

Each journey lists its phases in order, then the main pain points.

**List an item** (donor). Phases: decide → open "List" → photos → details → pickup option → submit → wait for requests → approve → hand off.
- **Pain:** the form opens with a guidance panel before Photos (`compare/mobile-70`). That is useful once, but on repeat listings it pushes the photo picker below the fold.
  - **Fix:** collapse it after the first listing.
  - **Fix:** auto-suggest category and condition from the photo (the Vision work on prod #22/#23).
- **Moment of truth:** the first request arriving. Notify with the collector's name and reputation.

**Spot an item** (spotter, mobile only). Phases: see item → open Spot → camera → GPS lock → catalogue match → post → points.
- **Pain:** the desktop route is a dead end ("Use a mobile device to post", `compare/desktop-16`).
  - **Fix:** offer "Send link to my phone" (QR) instead.
- **Pain:** the camera-denied state is two buttons on black (`compare/mobile-16`).
  - **Fix:** explain why the camera matters and offer upload first.
- **Peak:** the "+25" points.

**Claim and collect** (collector). Phases: browse → item → request → wait → approved → navigate → meet or drop-off → confirm collection → impact.
- **Pain:** request without review (P1-7).
- **Pain:** "Ready for collection" looks like "Awaiting approval" (P1-5).
- **Pain:** there is no timeline.
- **Peak:** "Confirm collection" (currently a plain charcoal button, `compare/mobile-72`). Design the ending (§4.10).

---

## Appendix A · Contrast table (computed WCAG 2.x ratios)

| Build | Pair | Ratio | Needs | Result |
|---|---|---|---|---|
| Staging | `ink #0F1510` on white | 18.50 | 4.5 | pass |
| Staging | `body #4A554C` on white / haze | 7.79 / 7.44 | 4.5 | pass |
| Staging | `muted #5C6B63` on white / haze / soft / mintSoft | 5.62 / 5.37 / 5.02 / 4.85 | 4.5 | pass |
| Staging | `gray-400 → #6A776F` on white | 4.69 | 4.5 | pass |
| Staging | `gray-400 → #6A776F` on charcoal | 3.35 | 4.5 | **fail** (avoid on the shell) |
| Staging | `onDeep #C9CEC9` on charcoal | 9.85 | 4.5 | pass |
| Staging | white on charcoal (primary button) | 15.72 | 4.5 | pass |
| Staging | `onMint #0B1F16` on mint | 11.22 | 4.5 | pass |
| Staging | white on mint / mint as text on white | 1.53 | 4.5 / 3 | **fail** (never do this) |
| Staging | mint on charcoal | 10.26 | 4.5 | pass |
| Staging | `control #87928A` input border on white | 3.23 | 3 | pass |
| Staging | `line #E6EAE4` on haze; mintSoft on white | 1.16 | (3 if it identifies a control) | separation weak |
| Staging | `track #B4BFB8` on white | 1.89 | 3 | **fail** |
| Staging | `green-600 #2F8F55` text on white | 4.05 | 4.5 | **fail** (unused today; block it) |
| Staging | white on `green-500 #5FCB82` | 2.03 | 4.5 | **fail** (unused; block it) |
| Staging | `danger #B3261E` on white / dangerSoft | 6.54 / 5.74 | 4.5 | pass |
| Staging | `notify #FF9C2D` on white | 2.09 | 3 | **fail** |
| Staging | focus: charcoal on haze / white halo on charcoal | 15.0 / 15.7 | 3 | pass |
| Prod | auth link `#15A119` on white | 3.42 | 4.5 | **fail** |
| Prod | white on avatar `#16A34A` | 3.30 | 4.5 | **fail** |
| Prod | `slate-400 #94A3B8` labels | 2.56 | 4.5 | **fail** |
| Prod | white on `#F43F5E` (Remove button) | 3.67 | 4.5 | **fail** |
| Prod | input border `#CBD5E1` | 1.48 | 3 | **fail** |

## Appendix B · Automated results (mobile 390 px)

| Page | Prod axe | Staging axe | Staging targets <44 px |
|---|---|---|---|
| Home / browse (public) | 0 | 0 | 14–19 (chips 32–40 px tall; 1 footer link 17 px) |
| Sign-in / sign-up | color-contrast 2 / 1 | 0 | "Forgot password?" 20 px, "Sign up" 17 px high |
| Dashboards (3 roles) | button-name 1 + contrast 1–5 | 0 | "View All" 75×20 |
| Found items / map | button-name + contrast 15 | 0 / target-size 1 (pin) | Filter chips 36 px |
| My impact / leaderboard | button-name + contrast 6 / 12 | 0 | Segmented tabs 36 px |
| Messages | button-name 2 + contrast 3 | 0 | — |
| Partner console / items | button-name, contrast, scrollable-region | scrollable-region 1 | — |
| Horizontal overflow at 390 px | none detected by the probe, but the prod chat pane is visibly cut off (`compare/mobile-21`) | none | — |

- **Lighthouse (localhost, mobile preset):**

  | Page | Prod | Staging |
  |---|---|---|
  | Home | perf 59, a11y 99, LCP 9.4 s, 1,452 KiB | perf 91, a11y 99, LCP 3.2 s, 213 KiB |
  | Browse | 59 / 95 | 95 / 99 |
  | Login | 59 / 95 | 97 / 100 |

  Login scores 66 for SEO on both because it is `noindex`, which is intended.
- **Repository tools:** `palette-check` is clean on staging (518 on prod). `restyle-guard --base 83d7827` FAILED on 3 files: the intended confetti changes (`useConfetti.ts`, `AchievementsPage.tsx`) and a restructured thumbnail block in `MyFoundPostsPage.tsx`, where the markup changed and not just the classes. Record these as reviewed exceptions in the PR, or use `--allow-layout`.
- **Data files:** `data/axe-and-probes-mobile.json` (re-run after the fixture fixes) and `data/lighthouse-summary.jsonl` (prod and staging; baseline: home 86 perf / 266 KiB, login 94 / 249 KiB).
