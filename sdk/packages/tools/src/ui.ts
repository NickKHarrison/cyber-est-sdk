/**
 * @cyber-est/tools: the UI probe (rules `EST-U001` to `EST-U005`). 1.898: the probe itself is
 * `src/audio/est/install/uiProbe.ts` (pure), so the kit's validator and the app's own builder
 * (`src/components/est/vibe/`) read one rule; this file is its name in the kit.
 */
export * from '../../../../src/audio/est/install/uiProbe';
// 1.912: the window check (does the window show every parameter, does every kit control name a real one), the same pure rule the app's builder reads.
export * from '../../../../src/audio/est/install/uiKitCheck';
