import "./evidence.css";
import { useEffect } from "react";
import { PageShell, TabStrip } from "../../components/system";
import { useSurfaceParams } from "../../nav/useSurfaceParams";
import { EventsTab } from "./EventsTab.jsx";
import { QualityTab } from "./QualityTab.jsx";

/*
 * surfaces/evidence/EvidencePage.jsx — the unified Evidence surface
 * (Wave C5, COHESION surface map: /evidence = audit events AND quality
 * findings). One PageShell, two URL-addressed tabs:
 *
 *   ?tab=events (default)  — the immutable governance event log (the former
 *                            Audit Evidence surface, behavior-complete port);
 *                            ?event=AUD-<hex8> addresses one event's evidence.
 *   ?tab=quality           — browsable quality-run findings (J6/J7 gap
 *                            closed); ?severity/?outcome/?asset/?run filter,
 *                            ?finding=QF-<hex8> addresses one finding.
 *
 * The URL is the state: every filter, window, slice and selection lives in
 * surface params, so risk drills (/evidence?tab=quality&severity=high),
 * audit-chip links (/evidence?event=AUD-…) and shared views all restore.
 */

// Mirrors (and extends) the nav/routes.js evidence paramsSchema; module-level
// so useSurfaceParams normalizes it once.
const PARAMS_SCHEMA = {
  tab: { type: "string" },
  event: { type: "string" },
  actor: { type: "string" },
  action: { type: "string" },
  asset: { type: "string" },
  q: { type: "string" },
  range: { type: "string" },
  kind: { type: "string" },
  severity: { type: "string" },
  outcome: { type: "string" },
  run: { type: "string" },
  finding: { type: "string" },
};

export function EvidencePage({ shell = null }) {
  const [params, setParams] = useSurfaceParams(PARAMS_SCHEMA);
  const tab = params.tab === "quality" ? "quality" : "events";

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Evidence - Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <PageShell
      className="ga-evid-page"
      eyebrow="Knowledge & Proof"
      title="Evidence"
      subtitle="The governed proof surface: an immutable audit event log and browsable quality-run findings, filterable and exportable for compliance review."
      tabs={
        <TabStrip
          ariaLabel="Evidence views"
          param={{
            value: tab,
            // Default tab keeps the URL clean; switching tabs drops the other
            // tab's selection params so a stale ?event= never rides into the
            // quality view (and vice versa).
            set: (key) =>
              setParams(
                key === "quality" ? { tab: "quality", event: "" } : { tab: "", finding: "", run: "" },
              ),
          }}
          tabs={[
            { key: "events", label: "Audit events" },
            { key: "quality", label: "Quality findings" },
          ]}
        />
      }
    >
      {tab === "quality" ? (
        <QualityTab params={params} setParams={setParams} />
      ) : (
        <EventsTab params={params} setParams={setParams} shell={shell} />
      )}
    </PageShell>
  );
}

export default EvidencePage;

// Re-exported for tests that need the same param vocabulary.
export { PARAMS_SCHEMA as EVIDENCE_PARAMS_SCHEMA };
