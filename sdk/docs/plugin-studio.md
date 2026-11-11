# The Plugin Studio

The Plugin Studio is a page in Cyber where you describe a plugin, an agent writes it, and your browser builds, checks, plays and installs it: nothing to install on your computer. It is **built but not open yet** (Cyber 1.320): it opens when Cyber's owner switches it on, and until then nothing of it shows in Cyber. This page says what it will do, so a plugin you start there and continue here (or the reverse) behaves the same.

## What it does

- **Templates.** A Studio project starts from the AssemblyScript templates, `effect-as` or `instrument-as`, with its id in the `studio.<seed>.<name>` namespace. Rust is not in the Studio (no browser toolchain): use `npx @cyber-est/cli`.
- **The agent.** You write what you want; the agent answers with whole-file edits to the project's own files, and only those (an edit to any other path is refused). It never runs anything: your browser does.
- **Build and Validate.** The browser compiles `assembly/index.ts` with AssemblyScript's own compiler, with the flags of the templates' `asconfig.json` release target and the manifest's `limits.memoryPagesMax`, packs the bundle exactly as `est pack` does (the same sources give the same hash), and runs Cyber's install checks on it: the validator's rules, the meter and the conformance run, with the same rule ids as `est validate`. A failed report is sent back to the agent to fix, at most three times in a row.
- **Play.** The checked module runs on Cyber's own runtime: an effect on a test sound, an instrument holding a chord, its parameters as sliders.
- **Install.** The build is recorded in the project and installed into your plugins on this device as a **Plugin Studio** plugin, with its generated knobs. No other account can install it; on theirs, a project that uses it shows a placeholder.
- **Download .est** gives the bundle, **Export source** a zip of the project's files: put them beside a template's `asconfig.json` and `est validate` checks them as the Studio did.

## Limits

The agent has a number of turns a day by plan, a monthly allowance per account, and Cyber has a daily allowance for everyone; when it is used, the agent rests until the next day and the editor, Build and Play still work. Your messages to the agent are kept for 30 days for abuse review, readable by Cyber's admins only; the files are not kept with them.
