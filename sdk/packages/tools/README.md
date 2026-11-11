# @cyber-est/tools

The EST plugin validator, packer and inspector: the same code as [Cyber](https://cyber-audio.fly.dev)'s install check, run in Node, with a stable id for every rule (`EST-…`). `@cyber-est/cli` (the `est` command) is a command line over it; use this package when a script of your own validates or packs bundles.

Node 20 or newer, ESM. MIT.

```js
import { readFileSync } from 'node:fs';
import { validate, inspect, pack, EST_RULES } from '@cyber-est/tools';

const report = await validate(new Uint8Array(readFileSync('dist/com.example.my-chorus-1.0.0.est')));
console.log(report.ok, report.checks.filter(c => c.status === 'fail').map(c => c.rule));
```

- `validate(bytes | { dir }, opts)`: the report `est validate` writes as `validation.json`. Given `{ dir }` it runs that folder's own build first; given bytes it only reads them.
- `pack(dir, opts)`: a plugin folder's canonical `.est` (it does not build).
- `inspect(bytes, { meter })`: the manifest, the files and the module.
- `render`, `renderGoldenBundle`, `compareGolden`: renders on the conformance host.
- `EST_RULES`, `SPEC_FILES`: the rules table and the spec's machine-readable files (the ABI, the manifest schema), shipped in the package.
- `@cyber-est/tools/pack`: the packer alone.

There are no type declarations yet in 0.1.0.
