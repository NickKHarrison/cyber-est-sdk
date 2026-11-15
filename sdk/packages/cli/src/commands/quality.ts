import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { qualityOf, qualityTable, type QualityProfile, type QualityReport } from '../../../tools/src/quality';
import { UsageError, flagString, type EstCommand } from '../command';
import { buildAndPack, isBundleFile, shown } from '../build';

/**
 * `est quality <bundle|dir> …` (1.604; sdk/docs/quality.md): every factory preset of an instrument
 * played with a standard phrase for its kind and measured (`quality` in @est/tools): loudness and true
 * peak against the targets, DC, clicks at note-on, note-off, a stolen voice and a preset change,
 * denormals after the notes, aliasing, fuel at full polyphony, stuck notes and stereo correlation.
 */

/** A profile file: one profile, or profiles by plugin id. */
function profileFor(file: string | undefined, id: string): QualityProfile {
  if (!file) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const byId = raw[id];
  if (byId && typeof byId === 'object') return byId as QualityProfile;
  return Object.keys(raw).some(k => k.includes('.')) ? {} : (raw as QualityProfile);
}

/** A levels file: `{ levels }`, or `{ "<id>": { levels } }`. */
function levelsFor(file: string | undefined, id: string): Record<string, number> | undefined {
  if (!file) return undefined;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { levels?: Record<string, number> } & Record<string, { levels?: Record<string, number> }>;
  return raw[id]?.levels ?? (raw.levels as Record<string, number> | undefined);
}

const command: EstCommand = {
  name: 'quality',
  summary: 'Measure every factory preset of an instrument: loudness, true peak, DC, clicks, denormals, aliasing, fuel, stuck notes',
  usage: [
    'est quality <bundle|dir> [more…] [--profile <file.json>] [--preset <name>] [--levels <file.json> [--only-listed]] [--json <file>] [--md <file>] [--no-build]',
    '',
    '  bundle|dir     a .est bundle, a plugin folder (built and packed first), or a folder of bundles',
    '  --profile      a quality profile (or profiles by plugin id): kitKeys, kinds by preset name,',
    '                 polyphony, levelParam, aliasByDesign (sdk/docs/quality.md)',
    '  --preset       measure only the preset of this name',
    '  --levels       try presets\' Level (dB) by name before writing them: a presets.levels.json',
    '                 ({ "levels": { "<preset>": -4.5 } }), or such files\' levels by plugin id',
    '  --only-listed  measure only the presets --levels names',
    '  --json, --md   also write the reports as JSON, or as Markdown tables',
    '',
    'Each preset is played at 48 kHz with a phrase for its kind (from its tags: a chord, a melody, a',
    'bass line, or two bars of drums on the kit\'s keys) and measured against the targets: -16 LUFS',
    'for leads, keys and pads, -14 for basses and drums, the true peak under -1 dBTP. Exit 1 when a',
    'preset has a flag other than its level.',
  ].join('\n'),
  valueFlags: ['profile', 'preset', 'levels', 'json', 'md'],
  async run(args, ctx) {
    if (!args.positional.length) throw new UsageError('est quality needs a bundle or a plugin folder');
    const files: { name: string; bytes: () => Uint8Array }[] = [];
    for (const spec of args.positional) {
      const p = resolve(ctx.cwd, spec);
      if (isBundleFile(p)) files.push({ name: shown(ctx.cwd, p), bytes: () => new Uint8Array(readFileSync(p)) });
      else if (existsSync(p) && statSync(p).isDirectory() && existsSync(join(p, 'est.json'))) {
        files.push({ name: shown(ctx.cwd, p), bytes: () => buildAndPack(p, ctx, { noBuild: args.flags['no-build'] === true }).bytes });
      } else if (existsSync(p) && statSync(p).isDirectory()) {
        for (const f of readdirSync(p).filter(f => f.endsWith('.est')).sort()) files.push({ name: shown(ctx.cwd, join(p, f)), bytes: () => new Uint8Array(readFileSync(join(p, f))) });
      } else throw new UsageError(`${spec} is not a .est bundle, a plugin folder or a folder of bundles`);
    }
    const profileFile = flagString(args, 'profile');
    if (profileFile && !existsSync(resolve(ctx.cwd, profileFile))) throw new UsageError(`--profile: ${profileFile} is not there`);
    const only = flagString(args, 'preset');
    const levelsFile = flagString(args, 'levels') && resolve(ctx.cwd, flagString(args, 'levels')!);
    if (levelsFile && !existsSync(levelsFile)) throw new UsageError(`--levels: ${flagString(args, 'levels')} is not there`);
    const reports: QualityReport[] = [];
    let bad = 0;
    for (const f of files) {
      const bytes = f.bytes();
      const { readBundle } = await import('../../../../../src/audio/est/install/bundle');
      const id = (await readBundle(bytes)).manifest.id;
      const report = await qualityOf(bytes, profileFor(profileFile && resolve(ctx.cwd, profileFile), id), { only: only ? [only] : args.flags['only-listed'] === true ? Object.keys(levelsFor(levelsFile, id) ?? {}) : undefined, progress: s => ctx.err(s), levels: levelsFor(levelsFile, id) });
      reports.push(report);
      ctx.out(qualityTable(report));
      bad += report.presets.filter(p => p.error || p.flags.some(x => !x.startsWith('level '))).length;
    }
    const json = flagString(args, 'json'), md = flagString(args, 'md');
    if (json) writeFileSync(resolve(ctx.cwd, json), `${JSON.stringify(reports, null, 2)}\n`);
    if (md) writeFileSync(resolve(ctx.cwd, md), reports.map(qualityTable).join('\n'));
    return bad ? 1 : 0;
  },
};
export default command;
