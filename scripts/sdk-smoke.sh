#!/usr/bin/env bash
# The EST SDK packages' smoke test (1.319, DEV-A §5; EST-16, gate 3 of docs/est/EST_PUBLIC_GATES.md).
#
#   bash scripts/sdk-smoke.sh               # build twice, pack, check, install, build a template
#   bash scripts/sdk-smoke.sh <tarballs>    # the same on tarballs already packed (scripts/sdk-publish.mjs)
#
# 1. Builds the three packages (scripts/sdk-build.mjs) twice, each with its own fresh dev host
#    page, packs both with `npm pack`, and requires the same bytes: the build is reproducible.
# 2. Checks each tarball (scripts/sdk-pack-check.mjs): only its "files", exactly what was staged,
#    no TypeScript source, exact pins, no install scripts, nothing imported from outside.
# 3. In an empty folder outside the clone, installs the CLI's tarball alone (its dependencies come
#    from npm), then `est new effect-as smoke && est validate --json && est pack`, `est compare` on that
#    bundle, and (1.326, DEV-G; only where est doctor finds a clang for wasm32) `est new cpp-clap` and
#    `est validate`, built through the package's own `assets/sdk/cpp`; it requires no
#    failed rule in dist/validation.json and no path of the clone in anything it made. Rust is not
#    here (CI has no rustup); the AssemblyScript path is the proof.
# 4. Installs @cyber-est/tools alone and @cyber-est/ui alone, each in its own empty folder: the
#    tools validate that bundle and resolve nothing outside their own folder and their dependency;
#    the UI's copy rule finds its script inside its own folder.
# Nothing is published, and no npm credentials are read or needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cyber-est-smoke-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
# --ignore-scripts on every install: our packages declare none (sdk-pack-check refuses one), and a
# dependency's install script must never run here either (binaryen and assemblyscript have none).
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
say() { printf '\n== %s\n' "$*"; }

if [ $# -gt 0 ]; then
  say "the tarballs given"
  mkdir -p "$WORK/a"
  cp "$@" "$WORK/a/"
  STAGE_ARG=()
else
  say "build (twice) and pack"
  node "$ROOT/scripts/sdk-build.mjs" --out "$WORK/stage-a"
  node "$ROOT/scripts/sdk-build.mjs" --out "$WORK/stage-b"
  for side in a b; do
    mkdir -p "$WORK/$side"
    for p in tools ui cli; do (cd "$WORK/$side" && npm pack "$WORK/stage-$side/$p" --silent >/dev/null); done
  done
  for f in "$WORK"/a/*.tgz; do
    if ! cmp -s "$f" "$WORK/b/$(basename "$f")"; then
      echo "sdk-smoke: $(basename "$f") differs between two builds of the same commit (not reproducible)" >&2
      exit 1
    fi
  done
  echo "the same bytes twice: $(cd "$WORK/a" && sha256sum ./*.tgz | sed 's#  ./#  #' | tr '\n' ';')"
  STAGE_ARG=(--stage-root "$WORK/stage-a")
fi
CLI_TGZ="$(ls "$WORK"/a/cyber-est-cli-*.tgz)"
TOOLS_TGZ="$(ls "$WORK"/a/cyber-est-tools-*.tgz)"
UI_TGZ="$(ls "$WORK"/a/cyber-est-ui-*.tgz)"

say "check the tarballs"
node "$ROOT/scripts/sdk-pack-check.mjs" "${STAGE_ARG[@]}" "$CLI_TGZ" "$TOOLS_TGZ" "$UI_TGZ"

say "install @cyber-est/cli alone into an empty folder"
mkdir "$WORK/app"
cd "$WORK/app"
npm init -y >/dev/null
npm install --save-exact --ignore-scripts "$CLI_TGZ"
EST="$WORK/app/node_modules/.bin/est"
"$EST" version
"$EST" doctor --json > doctor.json
node -e "const d = require('./doctor.json'); if (!d.ready.as) { console.error('sdk-smoke: est doctor says the AssemblyScript templates are not ready', JSON.stringify(d.probes)); process.exit(1); }"
# 1.322 (DEV-C follow-up): keygen, sign and publish are the developer's versions here, and the
# registry owner's modes (sign without --developer, publish without a file) refuse with words.
for c in keygen sign publish; do "$EST" help | grep -Eq "^  $c " || { echo "sdk-smoke: the published CLI has no est $c" >&2; exit 1; }; done
"$EST" help keygen | grep -q 'developer' || { echo "sdk-smoke: the published est keygen is not the developer's" >&2; exit 1; }
set +e
"$EST" sign some.est > owner-sign.out 2>&1; SIGN=$?
"$EST" publish > owner-publish.out 2>&1; PUB=$?
set -e
[ $SIGN -ne 0 ] && grep -q "registry owner" owner-sign.out || { echo "sdk-smoke: est sign without --developer did not refuse" >&2; cat owner-sign.out >&2; exit 1; }
[ $PUB -ne 0 ] && grep -q "registry owner" owner-publish.out || { echo "sdk-smoke: est publish without a file did not refuse" >&2; cat owner-publish.out >&2; exit 1; }
KEYDIR="$(mktemp -d)"
"$EST" keygen --out "$KEYDIR/developer-key.pem" --json > keygen.json
node -e "const k = require('./keygen.json'); if (!k.publicKey || !k.keyId) { console.error('sdk-smoke: est keygen gave no public key', JSON.stringify(k)); process.exit(1); }"
[ "$(stat -c %a "$KEYDIR/developer-key.pem" 2>/dev/null || stat -f %Lp "$KEYDIR/developer-key.pem")" = "600" ] || { echo "sdk-smoke: the developer key is not mode 600" >&2; exit 1; }

say "est new effect-as smoke && est validate --json && est pack"
"$EST" new effect-as smoke --id org.test.smoke --name Smoke
cd smoke
set +e
"$EST" validate --json > ../validate.out
CODE=$?
set -e
"$EST" pack
node - "$ROOT" <<'EOF'
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[2];
const v = JSON.parse(readFileSync('dist/validation.json', 'utf8'));
const failed = (v.checks ?? []).filter((c) => c.status === 'fail');
if (!v.ok || failed.length) { console.error('sdk-smoke: validation failed:', JSON.stringify(failed, null, 2)); process.exit(1); }
const est = readdirSync('dist').filter((f) => f.endsWith('.est'));
if (est.length !== 1) { console.error('sdk-smoke: est pack wrote', est); process.exit(1); }
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === 'build' ? [] : walk(join(d, n))) : [join(d, n)]));
for (const f of walk('.')) if (!f.endsWith('.wasm') && !f.endsWith('.est') && !f.endsWith('.f32') && readFileSync(f, 'utf8').includes(root)) { console.error(`sdk-smoke: ${f} names the clone (${root})`); process.exit(1); }
console.log(`validated: ${v.plugin.id} ${v.plugin.version}, ${v.checks.length} checks, none failed; packed ${est[0]}`);
EOF
[ "$CODE" -eq 0 ] || { echo "sdk-smoke: est validate exited $CODE" >&2; exit 1; }

# A cookbook recipe from the package (the guide's `est new chorus my-chorus`): the recipes are packed with the templates.
say "est new chorus (a cookbook recipe) && est validate --json"
cd "$WORK/app"
"$EST" new chorus smoke-chorus --id org.test.smokechorus --name SmokeChorus
cd smoke-chorus
"$EST" validate --json > ../validate-chorus.out || { echo "sdk-smoke: est validate failed on the chorus recipe" >&2; cat ../validate-chorus.out >&2; exit 1; }
node -e "const v = JSON.parse(require('node:fs').readFileSync('../validate-chorus.out', 'utf8')); if (!v.ok) { console.error('sdk-smoke: the chorus recipe did not validate'); process.exit(1); } console.log('chorus recipe validated from the package: ' + v.plugin.id);"
cd "$WORK/app/smoke"
BUNDLE="$WORK/app/smoke/dist/$(ls "$WORK/app/smoke/dist" | grep '\.est$')"

# DEV-G (1.326): the packed CLI's est compare, and the C++ kit from the package's own assets/sdk/cpp.
say "est compare on the bundle against itself (identical: exit 0)"
"$EST" compare "$BUNDLE" "$BUNDLE" --seconds 0.25 --report "$WORK/app/compare.html" > /dev/null
[ -s "$WORK/app/compare.html" ] || { echo "sdk-smoke: est compare wrote no report" >&2; exit 1; }
if node -e "process.exit(require('$WORK/app/doctor.json').ready.cpp ? 0 : 1)"; then
  say "est new cpp-clap && est validate --json (the C++ build from the package)"
  cd "$WORK/app"
  "$EST" new cpp-clap cppsmoke --id org.test.cppsmoke --name "Cpp Smoke"
  cd cppsmoke
  "$EST" validate --json > ../validate-cpp.out || { echo "sdk-smoke: est validate failed on cpp-clap" >&2; cat ../validate-cpp.out >&2; exit 1; }
  node - <<'EOF2'
const v = JSON.parse(require('node:fs').readFileSync('../validate-cpp.out', 'utf8'));
if (!v.ok) { console.error('sdk-smoke: cpp-clap did not validate', JSON.stringify(v.checks.filter((c) => c.status === 'fail'))); process.exit(1); }
console.log(`cpp-clap validated from the package: ${v.plugin.id}, ${v.checks.length} checks`);
EOF2
  cd "$WORK/app"
else
  echo "sdk-smoke: no clang for wasm32 here (est doctor's C++ probe): the cpp-clap step is skipped"
fi

say "install @cyber-est/tools alone and validate that bundle"
mkdir "$WORK/tools"
cd "$WORK/tools"
npm init -y >/dev/null
npm install --save-exact --ignore-scripts "$TOOLS_TGZ"
cat > hooks.mjs <<'EOF'
import { appendFileSync } from 'node:fs';
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.startsWith('file:')) appendFileSync(process.env.SMOKE_RESOLVED, `${r.url}\n`);
  return r;
}
EOF
cat > register.mjs <<'EOF'
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
EOF
cat > use.mjs <<'EOF'
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPEC_FILES, TOOL_VERSION, inspect, validate } from '@cyber-est/tools';
const bytes = new Uint8Array(readFileSync(process.argv[2]));
const report = await validate(bytes);
if (!report.ok) { console.error('sdk-smoke: @cyber-est/tools refused the bundle est validated'); process.exit(1); }
const pkgDir = fileURLToPath(new URL('./node_modules/@cyber-est/tools/', import.meta.url));
for (const [k, p] of Object.entries(SPEC_FILES)) if (!p.startsWith(pkgDir) || !existsSync(p)) { console.error(`sdk-smoke: SPEC_FILES.${k} is ${p}, not inside ${pkgDir}`); process.exit(1); }
const want = JSON.parse(readFileSync(new URL('./node_modules/@cyber-est/tools/package.json', import.meta.url), 'utf8')).version;
if (TOOL_VERSION !== want) { console.error(`sdk-smoke: TOOL_VERSION ${TOOL_VERSION} is not the package's ${want}`); process.exit(1); }
console.log(`@cyber-est/tools ${TOOL_VERSION}: validated ${(await inspect(bytes)).manifest.id}`);
EOF
: > resolved.txt
SMOKE_RESOLVED="$WORK/tools/resolved.txt" node --import ./register.mjs use.mjs "$BUNDLE"
node - "$WORK/tools" <<'EOF'
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const base = pathToFileURL(`${process.argv[2]}/`).href;
const inside = [`${base}node_modules/@cyber-est/tools/`, `${base}node_modules/binaryen/`, `${base}use.mjs`, `${base}register.mjs`, `${base}hooks.mjs`];
const urls = [...new Set(readFileSync(`${process.argv[2]}/resolved.txt`, 'utf8').split('\n').filter(Boolean))];
const out = urls.filter((u) => !inside.some((p) => u.startsWith(p)));
if (out.length) { console.error('sdk-smoke: @cyber-est/tools resolved files outside its folder:', out); process.exit(1); }
console.log(`@cyber-est/tools resolved ${urls.length} files, all inside its own folder and binaryen's`);
EOF

say "install @cyber-est/ui alone"
mkdir "$WORK/ui"
cd "$WORK/ui"
npm init -y >/dev/null
npm install --save-exact --ignore-scripts "$UI_TGZ"
node --input-type=module -e "
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const r = await import('@cyber-est/ui/copy-rule');
const dir = fileURLToPath(new URL('./node_modules/@cyber-est/ui/', 'file://$WORK/ui/'));
for (const f of [r.EST_UI_FILE, r.EST_UI_TYPES]) if (!f.startsWith(dir) || !existsSync(f)) { console.error('sdk-smoke: @cyber-est/ui names', f); process.exit(1); }
console.log('@cyber-est/ui: its copy rule finds est-ui.js and est-ui.d.ts inside its own folder');
"

say "sdk-smoke: passed"
