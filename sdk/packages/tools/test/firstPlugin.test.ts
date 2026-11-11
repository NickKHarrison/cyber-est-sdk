// @vitest-environment node
// 1.400 (P3, the plugin kit anyone can follow): the words a first plugin meets. EST-W004 names what
// put the import there (`Math.random`'s `env.seed`, the runtime's `env.abort`), an EST-C013 trap says
// "probably allocating in render()", validate notes a peak above full scale, `est compare` warns
// when the two kinds differ, `est login` explains a network failure and a closed service, `est
// help` lists the owner's commands apart, and `est profile --debug` builds with names without
// touching dist/.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importHint, inspectWasm, moduleRefusalOf } from '../../../../src/audio/est/install/bundle';
import { trapHint } from '../../../../src/audio/est/install/conformance';
import { estRule } from '../../../../src/audio/est/install/rules';
import { compareWarnings } from '../src/compare';
import { peakNote } from '../src/validate';
import { CLOSED_WORDS, login, unreachableWords } from '../src/publishClient.mjs';
import { help } from '../../cli/src/main';
import { namesBuildOf } from '../../cli/src/build';
import type { EstCommand } from '../../cli/src/command';
import type { EstProject } from '../src/project';

/** A module importing `env.<name>` and nothing else (the import check runs before any export check). */
function importing(name: string): Uint8Array {
  const str = (s: string) => [s.length, ...new TextEncoder().encode(s)];
  const type = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];
  const body = [0x01, ...str('env'), ...str(name), 0x00, 0x00];
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...type, 0x02, body.length, ...body]);
}

describe('EST-W004 names what put the import there', () => {
  it("Math.random's env.seed and the runtime's env.abort, in the refusal's message", () => {
    expect(moduleRefusalOf(inspectWasm(importing('seed')))).toEqual({ rule: 'EST-W004', message: expect.stringMatching(/env\.seed .*Math\.random.*seeded from a constant/) });
    expect(moduleRefusalOf(inspectWasm(importing('abort')))!.message).toMatch(/env\.abort .*abort=assembly\/index\/abort/);
    expect(importHint('env', 'console.log')).toMatch(/console/);
    expect(importHint('env', 'Date.now')).toMatch(/clock/);
  });
  it('leaves any other import as it was (the words other tests hold)', () => {
    expect(importHint('env', 'fetch')).toBeNull();
    expect(importHint('wasi_snapshot_preview1', 'sock_open')).toBeNull();
    expect(moduleRefusalOf(inspectWasm(importing('now')))!.message).toBe('the module imports env.now (function), which EST does not allow');
  });
  it("the rule's fix names Math.random and env.abort too", () => {
    expect(estRule('EST-W004').fix).toMatch(/Math\.random.*env\.seed/);
    expect(estRule('EST-W004').fix).toMatch(/env\.abort/);
  });
});

describe('EST-C013 says what a trap most likely is', () => {
  it('an unreachable or an out-of-bounds access: probably allocating in render()', () => {
    expect(trapHint('block 12: process: RuntimeError: unreachable')).toMatch(/Probably allocating in render\(\)/);
    expect(trapHint('block 3: process: RuntimeError: memory access out of bounds')).toMatch(/allocating in render\(\)/);
    expect(trapHint('block 1: process: RuntimeError: divide by zero')).toMatch(/Guard the division/);
    expect(trapHint('block 1: something else')).toBe('');
    expect(estRule('EST-C013').fix).toMatch(/allocating in `render\(\)`/);
  });
});

describe('validate notes a peak above full scale', () => {
  it('above 1.0 a note in words (the stress run, not the defaults); at or under it none', () => {
    expect(peakNote(1)).toBeNull();
    expect(peakNote(0.5)).toBeNull();
    const n = peakNote(3.1)!;
    expect(n).toMatch(/peaked at 3\.10 \(\+9\.8 dBFS\), above full scale \(1\.0\)/);
    expect(n).toMatch(/stress signal/);
    expect(n).toMatch(/EST-C015/);
  });
});

describe('est compare warns when the comparison means little', () => {
  it('two kinds, instruments without notes, effects on silence; a port with a WAV side says nothing', () => {
    expect(compareWarnings('effect', 'instrument', 'noise', true)[0]).toMatch(/A is an effect and B an instrument/);
    expect(compareWarnings('instrument', 'instrument', 'noise', false)[0]).toMatch(/both are instruments.*--events/);
    expect(compareWarnings('instrument', 'instrument', 'silence', true)).toEqual([]);
    expect(compareWarnings('effect', 'effect', 'silence')[0]).toMatch(/silence/);
    expect(compareWarnings('effect', 'effect', 'noise')).toEqual([]);
    expect(compareWarnings('effect', null, 'a file')).toEqual([]);
  });
});

describe('est login explains a network failure and a closed service', () => {
  it('a name that does not resolve, a refused connection, a certificate: the reason and where the address comes from', () => {
    const fail = (code: string, message = `connect ${code}`) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
    expect(unreachableWords('https://cyber.example', fail('ENOTFOUND', 'getaddrinfo ENOTFOUND cyber.example'))).toMatch(/could not reach https:\/\/cyber\.example \(getaddrinfo ENOTFOUND cyber\.example\): its name did not resolve.*--to/);
    expect(unreachableWords('https://cyber.example', fail('ECONNREFUSED'))).toMatch(/nothing answered there/);
    expect(unreachableWords('https://cyber.example', fail('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain'))).toMatch(/NODE_EXTRA_CA_CERTS/);
    expect(unreachableWords('https://cyber.example', new TypeError('fetch failed'))).not.toBe('fetch failed');
  });
  it('login: never a bare "fetch failed"; a 404 is a closed service, in words', async () => {
    const offline = (() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND cyber.example'), { code: 'ENOTFOUND' }) }))) as unknown as typeof fetch;
    await expect(login({ url: 'https://cyber.example', onCode: () => {}, fetchFn: offline })).rejects.toThrow(/could not reach https:\/\/cyber\.example .*did not resolve/);
    const closed = (() => Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))) as unknown as typeof fetch;
    await expect(login({ url: 'https://cyber.example', onCode: () => {}, fetchFn: closed })).rejects.toThrow(CLOSED_WORDS('https://cyber.example'));
    expect(CLOSED_WORDS('https://cyber.example')).toMatch(/developer accounts are not open there.*est validate/);
  });
});

describe('est help lists the owner\'s commands apart', () => {
  const run = async () => 0;
  const cmds: EstCommand[] = [
    { name: 'new', summary: 'Make a plugin', usage: '', run },
    { name: 'keygen', summary: 'registry key', owner: 'Make the registry key', ownerOnly: true, usage: '', run },
    { name: 'publish', summary: 'Publish your .est bundle to Cyber', owner: 'Build and sign the registry', usage: '', run },
  ];
  it('the developer\'s list leads; keygen (the registry key) only under the owner\'s; publish leads with the developer\'s meaning', () => {
    const h = help(cmds);
    const [mine, owners] = h.split("Cyber's own registry");
    expect(mine).toMatch(/^ {2}publish\s+Publish your \.est bundle to Cyber$/m);
    expect(mine).not.toMatch(/keygen/);
    expect(owners).toMatch(/^ {2}keygen\s+Make the registry key$/m);
    expect(owners).toMatch(/^ {2}publish\s+Build and sign the registry$/m);
    expect(h).toMatch(/BUILD_AN_EST_PLUGIN\.md/);
  });
});

describe('est profile --debug builds with names, away from dist/', () => {
  it('AssemblyScript: --debug and its own --outFile; Rust: strip off in a target folder of its own; C++ and prebuilt: none', () => {
    const dir = '/p';
    const as: EstProject = { dir, kind: 'as', wasm: join(dir, 'build', 'module.wasm'), build: { cmd: 'asc', args: ['assembly/index.ts', '--config', 'asconfig.json', '--target', 'release', '--outFile', join(dir, 'build', 'module.wasm')] }, golden: '' };
    const a = namesBuildOf(as, '/tmp/x')!;
    expect(a.args).toEqual(['assembly/index.ts', '--config', 'asconfig.json', '--target', 'release', '--debug', '--outFile', join('/tmp/x', 'module.wasm')]);
    expect(a.wasm).not.toBe(as.wasm);
    const was = process.env.CARGO_TARGET_DIR;
    delete process.env.CARGO_TARGET_DIR;
    try {
      const rust: EstProject = { dir, kind: 'rust', wasm: join(dir, 'target', 'wasm32-unknown-unknown', 'release', 'my_fx.wasm'), build: { cmd: 'cargo', args: ['build', '--release'] }, golden: '' };
      const r = namesBuildOf(rust, '/tmp/x')!;
      expect(r.env).toMatchObject({ CARGO_TARGET_DIR: join(dir, 'target', 'est-profile'), CARGO_PROFILE_RELEASE_STRIP: 'false' });
      expect(r.wasm).toBe(join(dir, 'target', 'est-profile', 'wasm32-unknown-unknown', 'release', 'my_fx.wasm'));
    } finally {
      if (was !== undefined) process.env.CARGO_TARGET_DIR = was;
    }
    expect(namesBuildOf({ dir, kind: 'cpp', wasm: '', build: { cmd: 'node', args: [] }, golden: '' }, '/tmp/x')).toBeNull();
    expect(namesBuildOf({ dir, kind: 'prebuilt', wasm: '', build: null, golden: '' }, '/tmp/x')).toBeNull();
  });
});
