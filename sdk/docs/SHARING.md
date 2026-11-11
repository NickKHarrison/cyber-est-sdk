# Sharing what you made

You have a `.est` that passes `npx est validate` and `npx est test` (the [prompt kit](PROMPT_KIT.md) or [Build an EST plugin](BUILD_AN_EST_PLUGIN.md) got you there). This page says how to hear it in Cyber, put it in a song, and share the song, and what others can and cannot do with it today.

## 1. Install your own plugin

**The quick way (while adding your own plugins is open on Cyber):** on Home, **EST PLUGINS → Add a plugin**, then drop `dist/<id>-<version>.est` on the dialog (or **Choose a file…**). No key is needed. Cyber runs the same checks `est validate` ran, names the same rule id if it refuses, and installs it on your own account.

**As a developer** (for Follow `est dev` and your plugin's own window), in Cyber, signed in:

1. **Settings → Plugins → Become a developer.** Accept the terms. Cyber assigns you a namespace, `dev.<10 hex>`, no domain needed; you can use it in your plugin's id.
2. Make a signing key with `npx est keygen --out ~/.est/developer-key.pem` (outside any repository), paste the public key it prints into Settings and press **Register key**. Cyber never asks for the private key. A developer with a registered key gets **Developer tools**.
3. **Developer tools → Developer mode** on (this browser only), then **Load a bundle file…** and pick `dist/<id>-<version>.est`. Cyber runs the same checks `est validate` ran and names the same rule ids if it refuses.

The plugin is installed on your own account as a developer plugin. Nobody else gets it: in anyone else's copy of a project, it is a silent placeholder that keeps its notes and settings.

While you are still changing the sound, **Follow `est dev`** (in Developer tools, with `npx est dev --cyber` running) plays the plugin `est dev` is building in your own project and swaps each rebuild in while it plays.

**If Add a plugin offers only the catalogue and Settings shows no Become a developer**, adding your own plugins is not open on that Cyber yet. You can still build and play your plugin with `npx est dev` on your computer; loading it into Cyber waits until it opens.

## 2. Make a song with it

Open or make a DAW project. Your plugin is in the Browser's **Plugins** category with the others: drag it onto a track (an effect onto an insert slot, an instrument onto a track), or select a track and press Enter on the row. Its window opens from its card. Presets you save there (the window's preset row) are yours, on your account; to give someone a preset, copy it as text.

Bump the plugin's `version` (in `est.json` and the code) for every change you load: a version, once loaded, never changes, and a project pins the exact bytes it used.

## 3. Make a listen link

In the project: **Share → Listen link → Make a preview.** In a DAW project you choose which part it captures: **From the start**, **The loop** (the default when the song has one), **The selection** or **From the playhead**; a part longer than 60 seconds is cut to its first 60, and one shorter than 5 seconds is lengthened to 5. Cyber renders it on your machine (your own plugins included, so it sounds as you hear it), uploads it as a WAV into your own storage, and gives you a link to `/listen/<id>`. **Copy** it and post it anywhere. **Make a new preview** after you change the song; **Turn off** ends the link at once.

A listen link is for DAW and Editor projects you own.

## What people who open the link see

- **A plain page** with the project's name and a player for the preview. It runs no script and needs no account. Shared on social media, it unfurls with the name.
- **The plugins the song uses, named only by Cyber's catalogue.** Your developer plugin is not in it, so the page says "A plugin Cyber's catalogue does not list" (Cyber cannot install it), never your plugin's own name.
- **Open in Cyber.** After signing in, the project opens **view-only**: they can play it and look, but not save, copy, comment or see who it is shared with. **Plugins in this project** lists the plugins they do not have, with **Install…** only for plugins Cyber's catalogue offers, behind the usual confirm. Your developer plugin shows as a placeholder there: silent in their copy, though the preview on the page has its sound.

## What waits for Community publishing

Until Community publishing opens on Cyber:

- nobody else can install your plugin, from a listen link or anywhere;
- `npx est publish <file.est>`, `est login` and `est yank` are built but answer that developer accounts or Community are not open ([publishing.md](publishing.md));
- there is no public page for your plugin, no Featured list and no reports;
- a `.est` file you send someone installs only through **Add a plugin** (while adding your own is open) or Developer tools' **Load a bundle file…**, on their own account, and Cyber marks it unsigned.

Once it opens, a published version gets its own page with Play, Open in Cyber offers Install from a shared project (an early version behind "Early: new, not reviewed by Cyber"), and the same song plays for everyone.

## Etiquette

- **Licences.** `est.json`'s `license` is the licence you give your plugin. The templates and the cookbook are MIT, so you may build on them freely. Port only code you are allowed to (yours, or under a licence that permits it, and keep its notice), and compile in only samples you have the rights to.
- **Credit.** Put your name in `vendor` and say in `description` what the plugin is. If it started from someone else's plugin, a paper or a tutorial, say so in the description or the README you share with it. Do not give a plugin another product's name or look.
- **Your id is yours.** Use a namespace you own (`dev.<10 hex>`, or a reversed domain you control), keep it for the plugin's life, and never reuse another developer's.
- **Be clear about what it is.** A listen link is your song: say which sounds are your plugin. Keep a preview's level sensible; nobody likes a link that clips.
