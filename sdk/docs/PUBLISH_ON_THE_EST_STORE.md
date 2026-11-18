# Publish a plugin on the EST Store

This page takes a plugin from an idea to a listing on the **EST Store** (STORE in Cyber's header): building it so it passes, becoming a developer, publishing, making its store page, getting it Reviewed, and looking after it once people use it. It starts where [Build an EST plugin](BUILD_AN_EST_PLUGIN.md) ends: you have a plugin folder that passes `npx est validate`.

## What is open today, and what waits for Cyber's owner

Building, validating, profiling and testing a plugin works today, on your computer, with the kit alone. Everything from step 3 on is **built but closed** until Cyber's owner opens it on the server (the owner's steps, in order, are Cyber's `docs/est/EST_LAUNCH_CHECKLIST.md`). Until then the routes answer 404 and Cyber draws none of it.

| Part | Needs | Until it opens |
|---|---|---|
| Steps 1–2: build, validate, profile, test | nothing | works now |
| Step 3: become a developer, keys, your `dev.` namespace | developer accounts (`EST_DEVELOPERS_OPEN`) | Settings shows no **Become a developer**; `est login` says developer accounts are not open |
| Step 4: publish (CLI, browser, Plugin Studio) | developer accounts **and** Community (`EST_COMMUNITY_OPEN`); the Plugin Studio also `EST_STUDIO_OPEN` | `est publish` is refused; STORE has no **My plugins** |
| Steps 5–6: store page, page look, demo clip, review, Checks, Analytics | developer accounts | not drawn |
| Step 7: ratings, reviews, developer profiles and Follow | Community | the store shows none |
| Step 9: paid plugins and tips | the paid store (`STORE_PAID_OPEN`) | every listing is free |

Some Cyber accounts can already add their own `.est` to their own account through **Add a plugin** ([Sharing](SHARING.md)); that is not publishing, and nobody else is offered it.

## 1. From an idea to a plugin

Start from the template or recipe closest to your idea ([templates](templates.md), [cookbook](cookbook.md); the [prompt kit](PROMPT_KIT.md) has a prompt for each). Two decisions are hard to change later:

- **The id.** Once published it never changes, and projects name it. It must start with your assigned namespace from step 3, `dev.<10 hex>.<name>`, or a reversed domain you prove: `com.example.…` from the guide cannot be published. Become a developer first and pass the id to `est new` (`npx est new effect-as my-delay --id dev.a1b2c3d4e5.my-delay`). Renaming later means `est.json`'s `id` **and** the code's (Rust `export_effect!`/`export_instrument!`, AssemblyScript `new Descriptor(…)` in `index.ts`; C/C++ takes it from `est.json`), then building again.
- **The parameters.** Projects save values by parameter id. Renaming or splitting one later needs a `migrate` entry (step 8).

## 2. Build it so it passes

Every check below is the one Cyber runs at install, at publish (again, on Cyber's own conformance service) and at review. Pass them on your machine first.

**Validate.** `npx est validate` builds the folder, packs `dist/<id>-<version>.est` and runs every check, with a 10-second conformance run (`--seconds` to change it), writing `dist/validation.json`. It exits 1 when a check fails, and each failure names a rule id (see "Common refusals" below and [the validator's rules](validator-rules.md)).

**Test.** `npx est test` renders the golden spec (`test/golden.json`) and compares it with the stored render; after you change the sound on purpose, listen, then `npx est test --update`.

**Profile.** A block has a fixed fuel budget. `npx est profile` lists the functions by the fuel they spend; `npx est profile --debug` builds a copy with names so they show by name (your `dist/` is untouched). Cyber's own plugins all stay under 75 % of the budget (`sdk/tests/profile.test.ts`, `src/audio/est/install/estMeter.fuel.test.ts`), and the host stops a plugin whose blocks use 90 % of their fuel for a run of 32 (`SLOW_SHARE`, `SLOW_QUANTA` in `src/audio/est/estProcessor.ts`). Aim well under: a slower computer than yours runs the same fuel slower. Over budget at install is EST-P001.

**Sample rates.** People run 44.1 and 48 kHz, and an export renders at the project's rate. Size every time, buffer and coefficient in seconds from the rate `activate` receives ([concepts: Sample rates](concepts.md#sample-rates)). Cyber holds its own plugins to this at both rates in `src/audio/est/install/parity.test.ts`. Check yours: the golden spec takes a `sampleRate`, and `npx est compare` takes `--sample-rate`, so render at 44100 and at 48000 and listen for anything that moves.

**Denormals.** WebAssembly has no flush-to-zero, so a filter or reverb tail decaying in silence can run on denormal numbers, which are very slow and which the fuel meter cannot see. Set any recursive state below 1e-20 to 0 (Cyber's catalogue plugins do; `src/audio/est/install/estDenormalsHarness.ts` counts them over 240 s of zeros). The automatic review renders your plugin and reports denormal-prone silence (step 6).

**Comparing versions.** `npx est compare dist/old.est dist/new.est` renders the same input through both and reports where they part, which is the check to run before you publish an update that should sound the same.

## 3. Become a developer (needs developer accounts open)

In Cyber, signed in (a real account: a guest trial cannot), open **Settings → Plugins → Become a developer**, accept the developer terms and choose the name shown on your plugins. It may not be "Cyber" or look like it, and may not contain invisible or direction characters.

**Your namespace.** Cyber assigns you `dev.` and your developer id's ten hex characters: the developer `dev-a1b2c3d4e5` publishes under `dev.a1b2c3d4e5` (`assignedNamespaceOf`, `shared/estCommunity.mjs`). No domain or proof is needed, nobody else can publish under it, and no DNS claim can take it. A reversed domain you own (`com.yourname`) can be claimed too, proved by a DNS TXT record, and is signed into the registry by Cyber's owner by hand ([publishing](publishing.md#3-your-namespace)). `org.cyber.*` and the vendor "Cyber" are Cyber's own.

**Your keys.** Publishing from the browser (step 4) needs no command line: **Publish a version** makes your key when you first need it. Every version you publish carries your Ed25519 signature. Two ways to hold a key; you may have up to 5 live keys and 5 claimed namespaces (`DEVELOPER_LIMITS`, `server/estDevelopers.mjs`):

- **On your computer:** `npx est keygen --out ~/.est/developer-key.pem` writes the private key (keep it outside every repository; back it up offline) and prints the public key, which you paste under **Keys** in Settings → Plugins → Developer.
- **In your browser:** STORE → My plugins → **Publish a version** → **Make a publishing key**. The private half is non-extractable, kept in this browser for this account only; only the public half is registered.

Cyber never asks for a private key. A browser key lives only in that browser's own storage: a copied or restored browser profile does not carry it, and signing then says to press **Replace this key**. A key you lose is **revoked** (nothing signed with it publishes again; what it signed before stays yours).

**A new developer waits 48 hours on each device.** Until Cyber's owner signs you into the registry's root, every device, your own included, offers your versions only once it has seen you in a valid delegation for 48 hours (`DELEGATED_QUARANTINE_MS`, `src/audio/est/install/community.ts`). Your plugin's store page says on that device when it can be played and installed there; nothing is wrong with the plugin meanwhile. Approved reviews end the wait for you everywhere once Cyber's owner signs them.

Before your first publish, try the plugin on your own tracks: Home's **EST PLUGINS → Add a plugin**, or Developer tools' **Follow `est dev`** ([Sharing](SHARING.md)).

## 4. Publish (needs developer accounts and Community open)

A version is published once and never changes: to fix anything, publish a new version number. The browser is the shortest way (no keygen, no login). Three ways, one server path (`server/estPublish.mjs`' `receive`; the browser route `server/estPublishWeb.mjs` only wraps it):

**From the command line.**

```sh
npx est validate
npx est login                                     # approve the code in Cyber; the token lasts an hour
npx est publish dist/dev.a1b2c3d4e5.delay-1.0.0.est --screenshots shots/main.png --homepage https://example.com/delay
```

`est publish` signs with your key (`--key <file>`, else `$EST_DEVELOPER_KEY_FILE`, else `~/.est/developer-key.pem`), sends the bundle, its signature, up to 6 screenshots (PNG or WebP, at most 2 MB each, checked by their bytes, never SVG), the top section of `CHANGELOG.md` (or `--changelog <file>`, at most 4000 characters) and https links (`--homepage`, `--source-url`, `--support`). `--early-only` keeps a version from ever becoming `latest` for others. `--to <url>` (or `$EST_CYBER_URL`) names another Cyber.

**From the browser.** STORE → My plugins → **Publish a version**: drop the `.est` (or Choose a file…). Cyber checks it in your browser first with the install pipeline (nothing stored), signs it with your browser key and sends it. **Early only** is the CLI's `--early-only`.

**From the Plugin Studio** (also needs `EST_STUDIO_OPEN`): a project whose last build passed has **Publish to the EST Store**. It names the plugin under your namespace (`dev.<10 hex>.<slug>-<4>`), asks a name, a summary (at most 280 characters) and a version, builds it again, signs it with your browser key and sends it ([the Plugin Studio](plugin-studio.md)).

**What the server does.** It checks your account, key and signature; that the id is under one of your namespaces and the names are clean; that the id and version (and the bytes) were never published; your limits; then runs the conformance check on Cyber's separate check service and countersigns the version into the **Community** tier. The limits (`PUBLISH_LIMITS`, `server/estPublish.mjs`): 64 MiB a bundle, 50 versions a day, 2 GB of published bundles a developer (yanked ones count), 30 publishes an hour from one address and 60 from one account.

Publishing waits for Cyber's conformance service, usually seconds; under load it can take a minute. If the page shows nothing after it, open **My plugins** again before publishing again: a second publish of the same version is refused ("published already").

**After it.** A version is **Early** for 14 days (`EARLY_DAYS`): people see it only with Show early plugins, behind "Early: new, not reviewed by Cyber", and the store's search and shelves leave it out for everyone else; its link (`/store/plugin/<id>`) always opens it. A new version of a plugin already out is **staged** for 72 hours (`STAGING_HOURS`) before it is `latest` for everyone. `npx est yank <id>@<version>` hides a version (projects that use it keep it; `--undo` lists it again). Cyber blocks malware, misleading names, licence or trademark misuse and abuse; a blocked version becomes a placeholder in projects.

## 5. Your listing

Everything here is edited in STORE → **My plugins** (`#store/dev`), on the plugin's tabs, by you or an admin (needs developer accounts open).

| Part | Where | Rules (code) |
|---|---|---|
| **Summary** | Store page | one paragraph of plain text, at most 280 characters; it replaces `est.json`'s description on the listing (`SUMMARY_MAX`, `shared/storeDevPage.mjs`) |
| **Tags** | Store page | at most 8; lower case a–z, 0–9 and `-`, at most 32 characters each (`STORE_TAGS_MAX`, `cleanTag`, `shared/storeListing.mjs`) |
| **Links** | Store page, or `est publish` | https only: homepage, source, support |
| **Changelog** | Store page, or `est publish` | plain text, at most 4000 characters a version |
| **Screenshots** | Store page (**Add screenshots…**), or `est publish --screenshots` | at most 6 a version, PNG or WebP, 2 MB each (`shared/estPluginMeta.mjs`); shown on the public plugin page `/plugins/<id>`. The STORE's own page shows one picture: Page look's **Screenshot on the page** |
| **Demo clip** | Store page | WAV or MP3, at most 30 s and 3 MB, its length computed from its bytes; an upload in your own storage. It plays only when someone presses it, never by itself (`DEMO_LIMITS`). `npx est demo` makes one |
| **Banner** | Page look | exactly 1600 × 500, PNG, JPEG or WebP, at most 2 MB (`PAGE_BANNER_*`, `shared/estPluginMeta.mjs`); drawn full width under your plugin, Standard showing its middle 1600 × 400 and Compact its middle 1600 × 300, so keep words in the middle |
| **Accent** | Page look | one of the store's twelve colours (`PAGE_ACCENTS`) |
| **Layout** | Page look | Standard, Showcase or Compact (`PAGE_TEMPLATES`) |
| **Trailer** | Page look | audio (WAV, MP3, M4A, WebM) or a short video (MP4, WebM), at most 60 s and 20 MB, its length read from the file; never autoplays (`server/storePageLook.mjs`) |

**Card art.** Store cards for Cyber's own plugins show a picture of the plugin's window, made by Cyber at build time (`shared/storeArt.mjs`). A Community plugin's card shows its kind's panel; Page look's banner, screenshot and trailer are on its STORE page, and the version's screenshots on its public plugin page. Page look's **Summary on the page** and **Screenshot on the page**, when set, replace the Store page tab's on the STORE page only.

**Text rules.** Summaries, tags, changelogs, bios and reviews are plain text, never HTML; control, zero-width and direction characters are refused.

**What to fill.** On the plugin's **Store page** tab: the summary, tags, changelog, links, screenshots (shown on your public plugin page) and the **demo clip**: `npx est demo` renders one from your plugin (an effect on Cyber's test loop, an instrument playing the test phrase) as `dist/demo.wav`, a 16-bit WAV within the store's limits. On **Page look**: the banner, accent, layout, the one screenshot the store's own page shows, and a trailer.

**Your own window waits for review.** A Community version's own window (its `ui/`) opens for other people only once the version is Reviewed or a Cyber admin allows that version's window; until then they get Cyber's generated knobs, and the listing says so. Make those knobs read well too: name a stepped parameter's choices with `.labels([...])` (each at most 32 characters, at most 64 steps), since the generated knobs show them.

**Try it before install.** Visitors can play your plugin on the store before installing it (run through the install checks, stored nowhere), try it on a track of their own song, or on a loop of their own. That is why the sound checks below matter.

**A/B test.** Page look can test a second summary and screenshot: one test at a time, at most 30 days; results are counts of views, plays and installs per variant, and say "not enough data yet" under 100 views each (`shared/storeAb.mjs`).

**Your profile** (needs Community): STORE → My plugins → **Profile**: a bio of at most 500 characters, up to 4 https links and an avatar (`shared/storeProfile.mjs`), shown on your public developer page. People can **Follow** you; you see a follower count, never who.

## 6. Review: the automatic checks and the Reviewed tier

**The automatic checks** (`server/estAutoReview.mjs`) run on every Community version after it is published, in the background:

- **copy**: your WebAssembly against every other developer's published versions; a similarity of 0.8 or more is flagged as a possible copy;
- **sound**: a 10-second render at 48 kHz on the test loop (an instrument: the phrase): stopped, silence, clipping, DC offset, fuel against the block budget, and denormal-prone silence;
- **name**: whether the name or vendor matches a known product or brand (`shared/estNameCheck.mjs`).

You see the results in words on the plugin's **Checks** tab. **A check never rejects, yanks or hides a version: only a person declines.** The results are information for the reviewer, and for you to fix in your next version.

**Getting Reviewed.** The **Review** tab (and **Review by Cyber** on your plugin's own store page) sends **Request review** for one version, with an optional note (at most 1000 characters). One request per plugin at a time, 10 a day (`REVIEW_LIMITS`, `server/estReview.mjs`); yanked, staged or blocked versions cannot be reviewed. A Cyber admin looks at the version: its permissions and parameters, the name check and the automatic checks. A name that matches a known product is approved only with a typed reason.

- **Declined:** the reviewer's words (10 to 2000 characters) reach your dashboard. Fix and request again.
- **Approved:** the listing says "Review approved, waiting to be published". **Reviewed** is a tier signed by Cyber's owner, offline, into the registry; once the signed index lists your version as Reviewed, the listing says so. Approval alone never makes a plugin Reviewed.

Reviewed is per version: a new version is Community until it is reviewed. Only a Reviewed or Cyber listing may be Featured or, once paid plugins open, sold.

## 7. Ratings and reviews (needs Community)

People rate 1–5 stars, with an optional review of plain text (at most 1000 characters), once per plugin, and only after they installed it or played it for 5 minutes in all (`shared/storeReviews.mjs`). A plugin's rating shows from 5 ratings; under that the listing says "Not enough ratings yet". You may post **one reply** to each review (at most 1000 characters; a second replaces it). Readers mark reviews helpful (a count) and can report one to Cyber's moderators; admins hide and restore reviews, never you.

## 8. Analytics and updates

**Analytics** (the plugin's **Analytics** tab, needs developer accounts): counts per day, never who: plays, installs, uninstalls, plays that became installs within 7 days, demo clip listens, factory presets opened, projects using the plugin and crashes (`server/storeAnalytics.mjs`). **Every figure under 5 shows as "fewer than 5"** (`HIDDEN_BELOW`), so a small plugin's numbers are partly hidden on purpose. The **Overview**, **Reports** and **Crashes** tabs show reports (never who filed them) and crash records (the trap message and the block index only).

**Updates.** Publish a new version number. People who have the plugin see **Update** in STORE → Your library (`#store/new` lists what changed, once Cyber's owner opens update notifications); they may choose **Keep this version**. A project keeps the exact version it was saved with until its owner switches it on the plugin's card, and only then do your `migrate` entries apply.

**Keep settings across versions** with `est.json`'s optional `migrate` list (Cyber 1.337; [the manifest](manifest.md)): each entry's `from` is a version range (`">=1.0.0 <1.2.0"`, a single version, or `*`); `params` maps an old parameter id to its new id (the value moves) or to `null` (dropped on purpose); `state` is `keep` (default) or `drop`. Cyber applies the first entry whose `from` takes the version a slot moves from, in one undo step, and says what it kept, moved and dropped. A manifest with `migrate` lists its `parameters`; a bad entry is EST-M022. Without an entry, values cross by id. Bump `stateVersion` and read your earlier states when the state's layout changes.

## 9. Paid plugins and tips (not open)

Cyber's paid store is built but closed: while `STORE_PAID_OPEN` is off, every listing is free, nobody can buy or tip, and the payout tab is not drawn. What is built, so you can plan (the owner may change it before opening; `shared/storeMoneyWords.mjs`, `server/storeMoney.mjs`):

- only a **Reviewed** listing may be paid;
- a developer sells through their own Stripe account (Connect), set up on My plugins' **Get paid** tab; Cyber's application fee is 0 and card fees come from your payout;
- the price is a Stripe price an admin sets, never typed into the app;
- buyers may refund within 14 days;
- a one-off listing fee per plugin is waived until 27 November 2027.

## Common refusals and their fixes

**At validate, install or publish (a rule id; full list in [validator-rules.md](validator-rules.md)):**

| Rule | What it means | Fix |
|---|---|---|
| EST-M002 | the id is not a reverse-DNS id | `dev.<10 hex>.<name>` or `com.yourname.<name>`, the same in `est.json` and the descriptor |
| EST-M014 | `est.json` asks for permissions | `"permissions": []`; do the work inside the plugin |
| EST-M018 | a zero-width or direction character in a text field | retype the name, vendor or description |
| EST-M022 | the `migrate` list is not valid | a range such as `">=1.0.0 <1.2.0"`, ids as strings, new ids that `parameters` lists |
| EST-B004 | the bundle is too large | leave out build output, sources and large samples; 64 MiB at most |
| EST-W004 | the module imports something EST does not allow | in AssemblyScript, no `Math.random` (it imports `env.seed`): an xorshift seeded from a constant |
| EST-W011 | a WebAssembly feature EST does not run | keep the template's build flags (no threads, relaxed SIMD or exceptions) |
| EST-C001 | the plugin does not start | the id matches the descriptor's, `init` and `activate` return true; run `npx est test` |
| EST-C010 | the state does not round-trip | save settings only, and load every state you save |
| EST-C013 | the plugin stopped while processing | most often allocating in `render()`: allocate in the constructor or `activate` |
| EST-C014 | the output is not finite | guard divisions, `log` and `sqrt`; flush denormals; feedback below 1 |
| EST-C015 | the output is too loud | clamp feedback and resonance at every parameter's extremes |
| EST-C018 | two renders differ | seed randomness from a constant at `activate`, never the clock |
| EST-U002 | the UI reaches an external host | put every file in the bundle; no CDN |
| EST-U005 | the UI page loads a module script | one classic `iife` script, no `type="module"` |
| EST-P001 | a block costs more than the budget | `npx est profile --debug`, then cut per-sample `pow`, `exp` and divisions |

**At publish (a code in the server's answer, `server/estPublish.mjs`):**

| Code | Fix |
|---|---|
| `exists` | that id and version (or those bytes) were published already: raise the version |
| `namespace` | the id is not under a namespace of yours: use `dev.<your 10 hex>.…` or a proved domain |
| `signature` | sign with a key you registered and have not revoked (`npx est sign <file.est> --developer`, or `est publish` does it) |
| `conformance` | Cyber's check service refused it: run `npx est validate` and fix the rule it names |
| `limit`, `rate` | a day's, an hour's or the 2 GB limit: wait, or ask the admins to remove old yanked versions |
| `blocked` | the developer account is blocked: contact Cyber's support |
| `not-set-up`, `conformance-down` | the server's side; nothing was published: try again later |

On the store page, a demo clip over its limits is refused as `demo-size` or `demo-length`, and a banner or trailer with words saying which rule it broke.

## See also

[publishing.md](publishing.md) (the command line in detail: namespaces, DNS proofs, yanking, the plugin pages), [Sharing](SHARING.md), [the Plugin Studio](plugin-studio.md), [concepts](concepts.md), [the manifest](manifest.md).
