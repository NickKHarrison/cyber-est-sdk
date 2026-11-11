# Security

EST runs plugins written by strangers, so the sandbox is the product. If you find a way for a plugin to escape it, read outside its own memory, reach the network, run JavaScript in Cyber's page, starve the audio thread past its budget, or get past the validator with something the host then refuses or mishandles, please tell us privately.

**How to report:** use GitHub's private vulnerability reporting on this repository (the **Security** tab → **Report a vulnerability**). If that is not available to you, write to the address on Cyber's [contact page](https://cyber-audio.fly.dev/contact). Please do not open a public issue for a security problem.

Include what you did, what you expected, what happened, and a bundle or a short program that shows it if you can. We will answer within a week, tell you what we will do, and credit you in the release notes if you wish.

**Scope:** the validator and meter (`src/audio/est/install/`), the plugin runtime (`src/audio/est/runtime/`), the plugin origin's serving rules and frame guard (`server/est*.mjs`), the UI library (`sdk/packages/ui`) and the CLI and dev host (`sdk/packages/cli`, `sdk/devhost`). The sandbox's code is public by design: it never relies on being secret.

**Not a vulnerability:** `est validate <dir>` runs that folder's own build (`cargo`, or its `node_modules/.bin/asc`), as `npm install` runs a package's scripts. Validate only folders you trust; Cyber and its servers check only `.est` bytes.

**Supported versions:** the latest release of each package. A fixed version is published; a bad one is deprecated on npm, never replaced.
