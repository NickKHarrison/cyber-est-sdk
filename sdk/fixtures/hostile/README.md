# Hostile EST fixtures

Attack inputs built during the EST sandbox attack of November 2026
([Cyber_EST_Sandbox_Attack_Work_Order.md](../../../Cyber_EST_Sandbox_Attack_Work_Order.md);
the report: [docs/security/est-sandbox-attack-2026-11.md](../../../docs/security/est-sandbox-attack-2026-11.md)).
Each tries one way round a defence. They are kept in the suite so a later change that reopens a
hole fails a test. **Never signed, never in `est-plugins/dist/`, never in a catalogue list.**

Unlike `../broken/` (modules the validator must refuse), a hostile fixture may **pass** the
validator: the attack is in what it then does or says.

| Fixture | What it tries | Its test |
|---|---|---|
| `hidden-name/` | Invisible and format characters in a display string (finding B1): a name that carries hidden text or reads as another. `attack.json` lists the code points. A manifest, not a packed bundle: it fails at `parseManifest`, before anything compiles. | `src/audio/est/install/bundle.test.ts` ("refuses the invisible and format characters the first ranges missed") |
| `e-host/text-everywhere/` | A bundle that passes the whole validator and whose every string is an attack (markup with handlers, `javascript:` links, `</script>`, template tokens, `__proto__`, each field at its longest); its DSP also reports parameter and module names from its own memory at run time. Built by `e-host/build.sh` from `e-host/src/text-everywhere.c`. | `e-host/e-host.test.ts` (it passes validation); `e2e/est-hostile-text.spec.ts` (every place the app draws it); `server/hostileText.plugin.test.mjs` (every server page and feed) |

Attacks that needed no bundle are tests of their own, beside the code they attack:

- The meter (stream A): `src/audio/est/install/estMeter.hostileOps.test.ts` builds its modules by hand.
- The frame (stream C): the probe plugin, `e2e/est/probe/` and `e2e/est-frame.spec.ts`; `server/estSandboxC.test.mjs`.
- The trust chain (stream D): `server/*.sandboxD.test.mjs`, and the "D-n" cases of `src/audio/est/install/registry.test.ts` and `community.test.ts`.
- The front door (stream E): `src/state/hostileChannels.*.test.ts`, `src/audio/est/hostileChannels.held.test.ts`, `src/components/est/frameCommitBudget.test.ts`, `src/components/est/page/hostileOpen.trialWake.test.tsx`, `server/hostileText.*.test.mjs`, `server/hostileOpen.classes.test.mjs`.

The server and strict reader divergence (finding B2, open) is not a packed fixture: nothing reaches
it today. Its reproduction is in the report.
