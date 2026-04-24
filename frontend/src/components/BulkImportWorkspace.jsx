import { useCallback, useMemo, useRef, useState } from "react";
import { postBulkImportCommit, postBulkImportDryRun } from "../lib/api";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

const CSV_TEMPLATE = [
  "fqn,description,domain,tier,business_criticality,is_cde,cde_rationale,tags",
  "main.sales.orders,Primary orders fact,Finance,T1,Business Critical,true,Revenue reporting depends on this,retention=7y;pii=false",
  "main.sales.customers,Customer master,Finance,T2,Business Critical,true,Key identifier for regulated reporting,pii=true",
].join("\n");

function toneForOutcome(outcome) {
  if (outcome === "applied") return "good";
  if (outcome === "queued") return "warn";
  if (outcome === "failed") return "bad";
  return "neutral";
}

function RowStatusChip({ result }) {
  if (result?.errors?.length) {
    return <span className="gh-chip tone-bad">Invalid</span>;
  }
  if (!result?.patch || !Object.keys(result.patch).length) {
    return <span className="gh-chip tone-neutral">Skip</span>;
  }
  if (result?.warnings?.length) {
    return <span className="gh-chip tone-warn">Warn</span>;
  }
  return <span className="gh-chip tone-good">Ready</span>;
}

function DiffList({ patch }) {
  const entries = Object.entries(patch || {});
  if (!entries.length) {
    return <span className="gh-bulk-import-empty">No changes</span>;
  }
  return (
    <ul className="gh-bulk-import-diff">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="gh-bulk-import-diff-key">{key}</span>
          <span className="gh-bulk-import-diff-value">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function BulkImportWorkspace({ bootstrap }) {
  const [csvText, setCsvText] = useState("");
  const [dryRun, setDryRun] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const shellRole = String(bootstrap?.shell?.role || "").trim();
  const isElevated = /admin|steward/i.test(shellRole);

  const handleFile = useCallback((event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setDryRun(null);
      setCommitResult(null);
      setError("");
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsText(file);
  }, []);

  const handleDryRun = useCallback(async () => {
    if (!csvText.trim()) {
      setError("Paste or upload CSV text first.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await postBulkImportDryRun(csvText);
      setDryRun(response);
      setCommitResult(null);
    } catch (err) {
      setError(err?.message || "Dry run failed.");
    } finally {
      setLoading(false);
    }
  }, [csvText]);

  const allowCommit = useMemo(() => {
    if (!dryRun?.results) return false;
    return dryRun.results.some(
      (row) => !row.errors?.length && row.patch && Object.keys(row.patch).length,
    );
  }, [dryRun]);

  const handleCommit = useCallback(async () => {
    if (!dryRun?.results?.length) return;
    setError("");
    setLoading(true);
    try {
      // Send the raw row fields the server expects (not the
      // post-validation patch keys) so the commit endpoint can
      // re-validate against the same rules. Skip rows the dry-run
      // flagged as invalid or empty.
      const payload = dryRun.results
        .filter((row) => !row.errors?.length && row.patch && Object.keys(row.patch).length)
        .map((row) => ({
          raw: {
            fqn: row.fqn,
            description: row.patch.description || "",
            domain: row.patch.domain || "",
            tier: row.patch.tier || "",
            certification: row.patch.certification || "",
            sensitivity: row.patch.sensitivity || "",
            criticality: row.patch.criticality || "",
            business_criticality: row.patch.businessCriticality || "",
            data_product: row.patch.dataProduct || "",
            is_cde:
              row.patch.isCde === true
                ? "true"
                : row.patch.isCde === false
                  ? "false"
                  : "",
            cde_rationale: row.patch.cdeRationale || "",
            tags: Object.entries(row.patch.freeformTags || {})
              .map(([k, v]) => `${k}=${v}`)
              .join(";"),
          },
        }));
      if (!payload.length) {
        setError("No valid rows to apply.");
        return;
      }
      const response = await postBulkImportCommit(payload);
      setCommitResult(response);
    } catch (err) {
      setError(err?.message || "Commit failed.");
    } finally {
      setLoading(false);
    }
  }, [dryRun]);

  const summary = dryRun?.summary;
  const commitSummary = commitResult?.summary;

  return (
    <section className="gh-bulk-import-surface">
      {!isElevated ? (
        <WorkspaceStateCard
          eyebrow="Restricted"
          title="Bulk import requires steward or admin"
          message="You can preview the workspace but the commit endpoint is server-gated."
          tone="warn"
        />
      ) : null}

      <section className="gh-panel gh-bulk-import-step">
        <header className="gh-bulk-import-step-head">
          <div>
            <div className="gh-eyebrow">Step 1</div>
            <h2>Upload or paste CSV</h2>
          </div>
          <div className="gh-bulk-import-actions">
            <input
              accept=".csv,text/csv"
              onChange={handleFile}
              ref={fileInputRef}
              style={{ display: "none" }}
              type="file"
            />
            <button
              className="gh-secondary-button"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Choose CSV file
            </button>
            <button
              className="gh-tertiary-button"
              onClick={() => setCsvText(CSV_TEMPLATE)}
              type="button"
            >
              Load example
            </button>
          </div>
        </header>
        <textarea
          aria-label="Bulk import CSV text"
          className="gh-input gh-textarea gh-bulk-import-textarea"
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="fqn,description,domain,tier,business_criticality,..."
          rows={10}
          value={csvText}
        />
        <div className="gh-bulk-import-step-foot">
          <small>
            Up to 5000 rows per request. Split larger files and commit in chunks.
          </small>
          <button
            className="gh-primary-button"
            disabled={loading || !csvText.trim()}
            onClick={handleDryRun}
            type="button"
          >
            {loading && !commitResult ? "Validating…" : "Validate (dry run)"}
          </button>
        </div>
      </section>

      {error ? <div className="gh-inline-alert tone-warn">{error}</div> : null}

      {dryRun ? (
        <section className="gh-panel gh-bulk-import-step">
          <header className="gh-bulk-import-step-head">
            <div>
              <div className="gh-eyebrow">Step 2</div>
              <h2>Review dry-run diff</h2>
            </div>
            <div className="gh-bulk-import-actions">
              <button
                className="gh-primary-button"
                disabled={loading || !allowCommit}
                onClick={handleCommit}
                type="button"
              >
                {loading && commitResult === null
                  ? "Committing…"
                  : allowCommit
                    ? "Apply changes"
                    : "Nothing to apply"}
              </button>
            </div>
          </header>
          {summary ? (
            <dl className="gh-bulk-import-summary">
              <div>
                <dt>Total rows</dt>
                <dd>{summary.total}</dd>
              </div>
              <div>
                <dt>Ready</dt>
                <dd>{summary.valid}</dd>
              </div>
              <div>
                <dt>Invalid</dt>
                <dd>{summary.invalid}</dd>
              </div>
              <div>
                <dt>Empty</dt>
                <dd>{summary.empty}</dd>
              </div>
            </dl>
          ) : null}
          {dryRun.parseErrors?.length ? (
            <ul className="gh-bulk-import-parse-errors">
              {dryRun.parseErrors.map((err, index) => (
                <li key={`${err.row}-${index}`}>
                  <strong>Row {err.row || "—"}:</strong> {err.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="gh-bulk-import-table">
            {(dryRun.results || []).map((row) => (
              <article className="gh-bulk-import-row" key={`${row.row}-${row.fqn}`}>
                <div className="gh-bulk-import-row-head">
                  <div className="gh-bulk-import-row-fqn">
                    <span className="gh-eyebrow">Row {row.row}</span>
                    <code>{row.fqn || "(missing fqn)"}</code>
                  </div>
                  <RowStatusChip result={row} />
                </div>
                <DiffList patch={row.patch} />
                {row.errors?.length ? (
                  <ul className="gh-bulk-import-errors">
                    {row.errors.map((message, index) => (
                      <li key={index}>⚠ {message}</li>
                    ))}
                  </ul>
                ) : null}
                {row.warnings?.length ? (
                  <ul className="gh-bulk-import-warnings">
                    {row.warnings.map((message, index) => (
                      <li key={index}>• {message}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {commitResult ? (
        <section className="gh-panel gh-bulk-import-step">
          <header className="gh-bulk-import-step-head">
            <div>
              <div className="gh-eyebrow">Step 3</div>
              <h2>Commit results</h2>
            </div>
          </header>
          {commitSummary ? (
            <dl className="gh-bulk-import-summary">
              <div>
                <dt>Applied</dt>
                <dd>{commitSummary.applied}</dd>
              </div>
              <div>
                <dt>Queued for approval</dt>
                <dd>{commitSummary.queued}</dd>
              </div>
              <div>
                <dt>Failed</dt>
                <dd>{commitSummary.failed}</dd>
              </div>
              <div>
                <dt>Skipped</dt>
                <dd>{commitSummary.skipped}</dd>
              </div>
            </dl>
          ) : null}
          <div className="gh-bulk-import-table">
            {(commitResult.results || []).map((row) => (
              <article
                className="gh-bulk-import-row"
                key={`${row.row}-${row.fqn}-commit`}
              >
                <div className="gh-bulk-import-row-head">
                  <div className="gh-bulk-import-row-fqn">
                    <span className="gh-eyebrow">Row {row.row}</span>
                    <code>{row.fqn || "(missing fqn)"}</code>
                  </div>
                  <span className={`gh-chip tone-${toneForOutcome(row.outcome)}`}>
                    {row.outcome || "pending"}
                  </span>
                </div>
                {row.error ? (
                  <div className="gh-inline-alert tone-warn">{row.error}</div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
