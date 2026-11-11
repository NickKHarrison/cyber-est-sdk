# Publishing a plugin to Cyber

**Not open yet.** Developer accounts and the Community listing are built but closed until Cyber's owner opens them (gates 1 and 3 of Cyber's `docs/est/EST_PUBLIC_GATES.md`). Until then `est login` answers that developer accounts are not open on this server. Everything below is how it works once they are.

You publish a plugin as a **developer**: a Cyber account with a name and a signing key. Your plugin then appears in every Cyber's **Available** list, in the **Community** tier, marked **Early** while it is new.

## The short version

```sh
npx est keygen --out ~/.est/developer-key.pem   # once: your key; paste the public key it prints into Cyber
npx est validate                                 # in your plugin's folder: builds, packs, checks
npx est login                                    # approve the code in the browser; the token lasts an hour
npx est publish dist/dev.a1b2c3d4e5.delay-1.0.0.est   # your ids go under your assigned namespace
```

## 1. Become a developer (once)

In Cyber, signed in, open **Settings → Plugins → Become a developer**. Read the terms, tick that you accept them, and choose the name shown on your plugins. It may not be "Cyber" or look like it, and it may not contain invisible or right-to-left control characters.

## 2. Your key (once)

```sh
npx est keygen --out ~/.est/developer-key.pem
```

This writes the **private** key to that file (mode 600, never inside a repository) and prints the **public** key. Paste the public key under **Keys** in Settings → Plugins → Developer. Cyber never asks for the private key and never sees it. Back it up offline.

You may register up to five keys (a laptop and a desktop, say). **Revoke** a key you lost: nothing signed with it publishes again. A revoked key stays listed as revoked, so versions it signed before stay attributable to you, and a key is never reused.

## 3. Your namespace

**You do not need a domain.** When you become a developer, Cyber gives you a namespace of your own, `dev.` and the ten characters of your developer id (for example `dev.a1b2c3d4e5` for the developer `dev-a1b2c3d4e5`), shown under **Namespaces** in Settings → Plugins → Developer. Give your plugins ids under it, such as `dev.a1b2c3d4e5.delay`, and publish them as they are: no proof, no waiting. Nobody else can publish under it, and no DNS proof can claim it. Cyber signs your keys and this namespace into its registry automatically when you register a key, so other people are offered your plugins straight away. (If the server says automatic signing is not set up, your plugins publish but are offered to others only once Cyber's owner signs you in by hand.)

**Before you publish, try it on your own track.** Once you have registered a key, **Load a bundle file…** and **Follow est dev** (Settings → Plugins → Developer tools) work on your own account: load your build, play it in your own projects, and rebuild as you go. What you load stays yours: nobody else is offered it, someone else sees a placeholder, and Follow never reloads into a live session or a project someone else shared with you.

**Have a domain? (optional)** You can also publish under it, reversed: `com.yourname.delay` for `yourname.com`. Under **Namespaces**, claim `com.yourname`. Cyber shows a DNS TXT record:

```
_cyber-est.yourname.com  TXT  "cyber-est-verify=<token>"
```

Add it at your DNS host, then press **Check the proof**. DNS can take a few minutes to update. Once proved, the namespace is yours: no other developer can publish under it. A proof lasts 90 days: keep the TXT record, and press **Check the proof** again when Cyber says it has lapsed. A domain namespace is signed into the registry by Cyber's owner by hand, which may take a day or two after you prove it. `org.cyber.*` is Cyber's own and is never claimable.

## 4. Validate

```sh
npx est validate
```

`est validate` runs your folder's own build (`cargo`, or the project's `node_modules/.bin/asc`), packs `dist/<id>-<version>.est`, and runs the same checks Cyber runs at install. Publish only a bundle that passes. Cyber runs its own checks again when you publish, on a separate conformance service, and refuses a bundle that fails there.

## 5. Log in

```sh
npx est login
```

It prints a link and a code like `BCDF-GHJK`. Open the link in the browser where you are signed in to Cyber, check that the page shows the same code, and approve it. The terminal then gets a **token that publishes as you for one hour**, kept in `~/.est/session.json` (mode 600). There is no long-lived token. `est login --logout` forgets it.

## 6. Sign and publish

```sh
npx est publish dist/com.yourname.delay-1.0.0.est
```

`est publish` signs the bundle with your key (`~/.est/developer-key.pem`, or `--key <file>`, or `$EST_DEVELOPER_KEY_FILE`). The signature covers `{ id, version, contentHash, publishedAt }`. It uploads the bundle and the signature. To sign separately, run `est sign <file.est> --developer`, which writes `<file>.developer.json`, and `est publish` sends that file.

Cyber then:

1. checks the token, and that the key is one of yours and not revoked;
2. checks your signature over the bytes;
3. checks the names: the id is under a namespace you proved; the name, vendor and description have no invisible characters; "Cyber" is not the vendor or the name;
4. refuses an id and version that were published before, by anyone;
5. runs the conformance check on its own service;
6. **countersigns** `{ id, version, contentHash, tier: 'community', publishedAt, validatedAt }` and lists the version.

Every Cyber that installs your plugin checks both signatures again: Cyber's, for the Community tier only, and yours, against the key the registry lists for you. Nobody can publish bytes in your name without your private key.

Each refusal comes back as a sentence with a code, such as `exists`, `namespace`, `reserved`, `display`, `signature`, `conformance`, `limit` or `rate`.

## 7. Your plugin's page

Every plugin has a public page on Cyber, `/plugins/<id>` (and yours are listed together at `/plugins/by/<your developer id>`). Like publishing, these pages are not open yet. The page shows the name, your developer name, the tier and the Early badge, the description and parameters from `est.json`, the licence, and how many accounts have the plugin installed (a number, never who). Visitors can **Play** it there on a built-in loop before they install it: Cyber runs it through the same checks as an install and installs nothing. A plugin's own UI is never shown on the page.

Add screenshots, the changes and links when you publish:

```sh
npx est publish dist/com.yourname.delay-1.0.0.est --screenshots shots/main.png shots/dark.webp --homepage https://yourname.com/delay
```

- **Screenshots:** PNG or WebP only (Cyber checks the bytes, not the name; never SVG), at most 6 of 2 MB each. Running the command again for the same version replaces them. The bundle itself never changes.
- **Changes:** the top section of `CHANGELOG.md` in the folder you run it from (or `--changelog <file>`): the text under its first `## ` heading. Plain text, at most 4000 characters, no invisible or right-to-left characters.
- **Links:** `--homepage`, `--source-url` and `--support`, https addresses only. Your own link, on your developer page, is set in Settings → Plugins → Developer → Your page.

## What happens after you publish

- **Early.** A version is marked **Early** for 14 days, longer if your account was blocked or a report was upheld meanwhile. Early means only *new*: Cyber checks Community plugins automatically, and does not review them. People see Early plugins only when they turn on **Show early plugins**. In a class, community plugins are off until the teacher allows them, and a student in several classes needs every one of them to allow it.
- **Staging (72 hours).** When you publish a new version of a plugin that is already out, it waits 72 hours before it becomes `latest` for everyone else. People with early updates see it at once. To keep a version from ever becoming `latest`, add `--early-only`.
- **Versions never change.** To fix something, publish a new version number.
- **Yank.** `npx est yank com.yourname.delay@1.0.0` hides a version. Projects that use it keep it: it stays installable by its exact pin, with a warning. `--undo` lists it again.
- **Blocks.** Cyber blocks malware, misleading names or descriptions, licence and trademark misuse, and abusive content. A blocked version stops being offered or installed, and its slots in projects become placeholders that say why. A blocked developer's keys are all revoked.

## Limits

These are enforced by Cyber's server:

- 50 versions a day per developer;
- 2 GB of published bundles per developer;
- 64 MiB per bundle;
- 30 publishes an hour from one address, and 60 an hour from one account.

## Also

`est sign <file.est>` without `--developer` is the registry owner's countersignature, for a private registry you run yourself. Without a file, `est publish` builds a registry from a folder (Cyber's own registry is built this way, offline, by its owner).
