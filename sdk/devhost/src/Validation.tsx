/**
 * The last `validation.json` (4-A's report, docs/est/EST_Phase4_Work_Order.md §6) and the install
 * check this page ran itself (Cyber's own pipeline in the compiling Worker).
 */
import type { InstallCheck } from './engine';

interface Check { rule?: string; title?: string; status?: string; message?: string; fix?: string; where?: string }
/** 4-A's `ValidationReport` (sdk/packages/tools/src/validate.ts), read loosely: a hand-edited file shows what it can. */
interface Report {
  ok?: boolean;
  plugin?: { id?: string | null; version?: string | null; hash?: string };
  checks?: Check[];
  tool?: { name?: string; version?: string };
  rules?: { version?: string; count?: number };
  /** What depends on the machine and the moment (the time a block, against the budget). */
  measured?: { blockUs?: number | null; budgetUs?: number; at?: string };
}

const asReport = (v: unknown): Report | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Report) : null);
const STATUS: Record<string, string> = { pass: 'Pass', fail: 'Fail', warn: 'Warning', skip: 'Skipped' };

export function Validation({ check, validation, note, preview = false }: { check: InstallCheck | null; validation: unknown; note: string; preview?: boolean }) {
  const report = asReport(validation);
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const shown = checks.filter(c => c.status !== 'pass');
  return (
    <section aria-labelledby="h-validation" className="card wide">
      <h2 id="h-validation">Validation</h2>
      <h3>Install check (Cyber's pipeline)</h3>
      {!check ? <p className="dim">{preview ? 'None: a UI preview runs no module.' : 'Not run yet.'}</p> : check.ok ? (
        <p data-testid="install-check" data-ok="true"><span className="tag ok">Pass</span> read, metered ({check.points} metering points), compiled and run by the conformance check
          {check.report ? `; ${check.report.deterministic ? 'deterministic' : 'NOT deterministic'}, ${Math.round(Number(check.report.blockUs) * 10) / 10} µs a block` : ''}
          {check.timings ? `; ${Math.round(check.timings.readMs + check.timings.meterMs + check.timings.compileMs + check.timings.conformanceMs)} ms` : ''}.</p>
      ) : (
        <p data-testid="install-check" data-ok="false"><span className="tag alert">Refused</span> {check.rule ? `${check.rule} ` : ''}({check.code}) {check.message}</p>
      )}
      <h3>validation.json</h3>
      {!report ? <p className="dim">{note || 'None.'}</p> : (
        <>
          <p data-testid="validation-summary"><span className={`tag ${report.ok ? 'ok' : 'alert'}`}>{report.ok ? 'Pass' : 'Fail'}</span> {checks.length} checks, {checks.filter(c => c.status === 'fail').length} failed, {checks.filter(c => c.status === 'warn').length} warnings <span className="dim">({note})</span></p>
          {typeof report.measured?.blockUs === 'number' && (
            <p className="dim" data-testid="validation-measured">Measured: {Math.round(report.measured.blockUs * 10) / 10} µs a block{typeof report.measured.budgetUs === 'number' ? ` (budget ${report.measured.budgetUs} µs, a warning only)` : ''}{report.tool?.version ? `; ${report.tool.name ?? '@cyber-est/tools'} ${report.tool.version}` : ''}{report.rules?.version ? `, rules ${report.rules.version}` : ''}.</p>
          )}
          {shown.length > 0 && (
            <div className="scroll">
              <table className="params">
                <thead><tr><th scope="col">Rule</th><th scope="col">Status</th><th scope="col">Where</th><th scope="col">Message</th><th scope="col">Fix</th></tr></thead>
                <tbody>
                  {shown.map((c, i) => (
                    <tr key={`${c.rule}-${i}`}><td>{c.rule}</td><td>{STATUS[c.status ?? ''] ?? c.status}</td><td>{c.where ?? '—'}</td><td>{c.message || c.title}</td><td>{c.fix}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
