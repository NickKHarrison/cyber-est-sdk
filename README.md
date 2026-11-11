# cyber-est-sdk: the EST plugin kit for Cyber

EST is how a plugin runs in [Cyber](https://cyber-audio.fly.dev): its DSP is a WebAssembly module in a sandbox, and its UI, if it has one, is a web page in a sandboxed frame on a second origin. A plugin is one file, a `.est` bundle. This kit takes you from an empty folder to a bundle that validates and that Cyber installs.

This repository holds the kit's sources and publishes its three npm packages:

| Package | What it is |
|---|---|
| [`@cyber-est/cli`](https://www.npmjs.com/package/@cyber-est/cli) | the `est` command: `new`, `validate`, `pack`, `test`, `doctor`, `inspect`, `dev`, `compare`, with the templates and the dev host inside |
| [`@cyber-est/tools`](https://www.npmjs.com/package/@cyber-est/tools) | the validator, the same code as Cyber's install check, with a stable id for every rule |
| [`@cyber-est/ui`](https://www.npmjs.com/package/@cyber-est/ui) | the library for a plugin's own UI |

## Start

With Node 20 or newer:

```
npx @cyber-est/cli new effect-as my-chorus --id com.example.my-chorus --name "My Chorus"
cd my-chorus && npm install --save-dev --save-exact @cyber-est/cli
npx est doctor
npx est validate
```

In a folder with the kit installed `npx est` is the command; anywhere else write `npx @cyber-est/cli`, because a bare `npx est` fetches npm's unrelated package called `est`. The guide is [`sdk/README.md`](sdk/README.md) and [`sdk/docs/`](sdk/docs/getting-started.md).

From a clone of this repository instead:

```
npm ci
alias est="node $PWD/sdk/packages/cli/bin/est.mjs"
```

## What is here

This repository is a **mirror**: Cyber's own repository is private, and the kit's sources are exported here from it by Cyber's `scripts/sdk-export.mjs`, with every path as it is in Cyber. So beside `sdk/` (the kit) there are the files the packages are built from:

- `src/audio/est/` and a few files of `src/` and `shared/` it imports: Cyber's bundle reader, validator rules, meter, conformance run and plugin runtime, which the packages bundle. **The sandbox's code is public by design**: its safety never depends on its code being secret.
- `server/estOrigin.mjs`, `server/estFrameGuard.mjs`, `server/estDevUi.mjs`, `server/http.mjs`: the plugin origin's serving rules, which `est dev` serves your plugin's page with.
- `scripts/sdk-*.mjs`: the package build, the tarball check, the smoke test and the publish script.

`npm run build` stages the packages, `npm test` runs the kit's suites, `npm run smoke` packs, installs and exercises them in empty folders, and `npm run check` does all of it (what CI runs on every push).

## Releases

The packages are published only by this repository's [`publish.yml`](.github/workflows/publish.yml), on a version tag, through npm's trusted publishing with provenance: no npm token exists for them, and nothing is published from anyone's machine. Each package page on npm shows its provenance, linking the tarball to the commit and the workflow run that built it.

## Licence

MIT ([LICENSE](LICENSE)). The CLI's dev host page bundles React and Binaryen; their licences ship in its `THIRD_PARTY_LICENSES.md`.

Security reports: [SECURITY.md](SECURITY.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).
