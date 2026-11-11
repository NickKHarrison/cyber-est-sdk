/**
 * EST Phase 1: the host-callback shim. A plugin calls the host through function pointers it reads
 * from `clap_host`, `clap_input_events` and the other host structs, that is through its own
 * `funcref` table, and a table holds only Wasm functions. A JS function cannot go in one
 * (`WebAssembly.Function` is not in every engine), so the host builds a small module that imports
 * each callback from JS and exports a Wasm function that calls it; the runtime adds those exports
 * to the plugin's table (`table.grow`, `table.set`) and writes their indices into the host structs.
 *
 * `buildEstShim` writes the module's bytes from the signatures in the ABI table (`compactAbi().sig`,
 * themselves read from the CLAP headers). It is serialised into the worklet (no imports, no outer
 * values, no class fields) and also runs on the main thread, where the module is compiled when the
 * page may compile (the processor compiles it itself otherwise).
 *
 * The module: one type per function, imports `h.<struct>.<field>`, the same number of functions
 * each calling its import with its own arguments, exported under the same name.
 */
export function buildEstShim(sigs: Record<string, string>): Uint8Array<ArrayBuffer> {
  const VAL: Record<string, number> = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
  const bytes: number[] = [];
  const u32 = (out: number[], v: number) => {
    let n = v >>> 0;
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      out.push(b);
    } while (n);
  };
  const name = (out: number[], s: string) => {
    u32(out, s.length);
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
  };
  const section = (id: number, body: number[]) => {
    bytes.push(id);
    u32(bytes, body.length);
    for (let i = 0; i < body.length; i++) bytes.push(body[i]!);
  };
  const names = Object.keys(sigs).sort();
  const parsed = names.map(n => {
    const m = /^\(([^)]*)\)->(\w+)$/.exec(sigs[n] ?? '');
    if (!m) throw new Error(`bad signature for ${n}: ${sigs[n]}`);
    const params = m[1] ? m[1].split(',').map(t => { const v = VAL[t]; if (v === undefined) throw new Error(`bad type ${t}`); return v; }) : [];
    const ret = m[2] === 'void' ? [] : [VAL[m[2]!] ?? -1];
    if (ret[0] === -1) throw new Error(`bad return type in ${n}`);
    return { params, ret: ret as number[] };
  });
  bytes.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  // 1: types
  const types: number[] = [];
  u32(types, parsed.length);
  for (const p of parsed) {
    types.push(0x60);
    u32(types, p.params.length);
    for (const t of p.params) types.push(t);
    u32(types, p.ret.length);
    for (const t of p.ret) types.push(t);
  }
  section(1, types);
  // 2: imports, h.<name>, function of type i
  const imports: number[] = [];
  u32(imports, names.length);
  names.forEach((n, i) => { name(imports, 'h'); name(imports, n); imports.push(0x00); u32(imports, i); });
  section(2, imports);
  // 3: functions, the wrapper i has type i
  const funcs: number[] = [];
  u32(funcs, names.length);
  names.forEach((_, i) => u32(funcs, i));
  section(3, funcs);
  // 7: exports, the wrapper i (function index names.length + i) under the import's name
  const exports: number[] = [];
  u32(exports, names.length);
  names.forEach((n, i) => { name(exports, n); exports.push(0x00); u32(exports, names.length + i); });
  section(7, exports);
  // 10: code, local.get 0..k-1, call i, end
  const code: number[] = [];
  u32(code, names.length);
  parsed.forEach((p, i) => {
    const body: number[] = [0x00];
    for (let a = 0; a < p.params.length; a++) { body.push(0x20); u32(body, a); }
    body.push(0x10);
    u32(body, i);
    body.push(0x0b);
    u32(code, body.length);
    for (const b of body) code.push(b);
  });
  section(10, code);
  return new Uint8Array(bytes);
}
