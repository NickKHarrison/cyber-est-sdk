# Measuring an instrument's presets: `est quality`

`est quality` plays every factory preset of an instrument bundle with a standard phrase and measures
what a listener notices first: how loud it is, whether it clips, clicks, hums, keeps playing or costs
too much. It runs in Node on Cyber's own `est-plugin` processor (the same code that plays the plugin
in the app, metered as at install), block by block, so the numbers are the same on every run.

```sh
npm run est -- quality path/to/plugin.est                         # one bundle
npm run est -- quality est-plugins/catalogue-src/org.example.synth  # a plugin folder (built and packed first)
npm run est -- quality a.est b.est --profile profiles.json --md report.md --json report.json
npm run est -- quality a.est --preset "Warm Pad"                  # one preset
npm run est -- quality a.est --preset "Warm Pad" --values try.json  # try other values before writing them
```

It prints a Markdown table, one row a preset, and exits 1 when a preset has a finding other than its
level. Effects are refused: it measures instruments' presets.

## What it plays

A preset's values are sent as parameter events (the bundle's `.state` files in the SDK's format), the
transport runs at 120 BPM from the start and stops at the last note-off (an instrument with a groove of
its own plays while it runs), and its kind decides the phrase:

| Kind | From the tags | Phrase | Loudness target |
|---|---|---|---|
| chord | pad, choir, drone, keys, organ, strings, … | three held chords, 4 s | −16 LUFS |
| melody | anything else (lead, pluck, bell, …) | ten notes around C5, 3 s | −16 LUFS |
| bass | bass, sub, 808, fretless, slap | nine eighth notes around C2, 2.6 s | −14 LUFS |
| drums | drums, kit, percussion, groove, … | two bars of kick, snare, hats on the kit's keys | −14 LUFS |

Every kind has the same ceiling: the true peak under −1 dBTP.

## What it measures

| Column | How | Flagged when |
|---|---|---|
| LUFS | ITU-R BS.1770-4 integrated loudness of the phrase and a second of its release | more than 1 LU from the target (the **Gain** column is the change that meets it without passing the ceiling) |
| dBTP | the peak of a 4× oversampled copy | over −1 dBTP |
| DC | either channel's mean over the phrase | over −50 dBFS |
| Corr | left against right (Pearson) | under −0.2 (a channel inverted somewhere) |
| Click on/off/steal/change | the largest second difference just after the moment against the sound's own around it, at every note-on and note-off, at each voice stolen (more notes held than the profile's voices) and at a change to this preset from the one before under a held chord | over 8 (a stolen voice: also 2.5× the run's ordinary note-ons); a drum kit's note-ons are reported, not flagged |
| Denormals | every subnormal float the module stores in the 10 s after the last note-off (the store's review counter) | any |
| Alias Δ (inh48) | a held C7 at 48 and 96 kHz: the power between its harmonics below 18 kHz at each rate; Δ is 48 kHz's over 96 kHz's (noise, detuning and reverb are there at both rates, aliases only at the lower) | Δ over 10 dB with inh48 over −40 dB, unless the profile says aliasing is the sound |
| HF | the power above 18 kHz against the fundamental's (reported) | |
| Fuel | the heaviest block of the stealing run, a share of `BLOCK_FUEL` | over 75 % |
| After 10 s | the level 10 s after the last note-off, and at the manifest's `tailSeconds` when not yet quiet | above −80 dBFS at both |
| Time (reported) | the stealing run's block times on the measuring machine, µs: mean, 95th percentile and largest, against a 128-frame block at 48 kHz (2667 µs); `cpu` in the JSON | never flagged here (it moves with the machine) |
| Tail (reported) | when every 50 ms after the last note-off stays under −60 dBFS (`decayS`), the energy after the notes against the phrase's (`energyDb`) and the level at the manifest's `tailSeconds` (`atDeclared`); `tail` in the JSON | never flagged here |

## Profiles

A profile (JSON) tells the harness what the tags cannot: `kitKeys` (`{ kick, snare, hat, open }`, the
default General MIDI's 36, 38, 42, 46), `polyphony` (voices before one is stolen, default 8), `tags`
(a kind for a tag of the instrument's own), `kinds` (a kind by preset name), `levelParam` (default: the
parameter called Level in dB) and `aliasByDesign` (a chip's reduced rate is its sound). A file may hold
one profile or profiles by plugin id; Cyber's catalogue instruments' are `est-plugins/quality/profiles.json`.

## Matching the levels

Level-match by each preset's own gain, never by compressing it: in a catalogue source folder,
`presets.levels.json` (`{ "levels": { "<preset name>": <Level in dB> } }`) sets presets' Level over the
source (read by `est-plugins/catalogue-src/tools/presets.mjs`), and `est quality` again should show the
loudness moved by the gain and the peak-to-loudness distance unchanged.

When a preset is held short of its target (its Level at its top, or a raise that would only squash into the
ceiling), change the sound's own values first, then its Level. `--values` tries values before you write them:
`{ "values": { "<preset name>": { "<parameter id>": value } } }` (or such by plugin id), sent over the
preset's state; a `--levels` trial wins over a trial value of the level parameter.

A change of values also changes the sound's own peak-to-loudness distance (a denser layer lowers it), so
the Level rule above cannot tell squashing from the new sound. Measure the new values twice: at the Level
you mean to write, and 12 dB lower (the true peak far under the ceiling). The lower one's loudness plus 12,
less the louder one's, is the ceiling's share: what the soft output ceiling took. Keep it where the preset
as it was had it (within 0.2 LU).

## The catalogue's summary

Cyber's own catalogue is measured as a whole by `node scripts/est-quality-summary.mjs` (in Cyber's repository),
which writes `est-plugins/quality/summary.json` for Admin → Store → Quality: every version's presets, flagged
against the band (±1 LU of the kind's target), the ceiling, half the block budget, any subnormal store and a tail
still over −60 dBFS when the declared tail ends, with the summary before kept for the trend.
