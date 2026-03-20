export default function GovernanceWorkspace({ governance }) {
  const metrics = governance?.metrics || [];
  const backlog = governance?.backlog || [];
  const glossary = governance?.glossary || [];

  return (
    <section className="gh-governance-workspace">
      <section className="gh-panel gh-governance-summary">
        <div className="gh-panel-title">Governance Summary</div>
        <div className="gh-summary-grid">
          {metrics.map((metric) => (
            <div className="gh-stat-card" key={metric.label}>
              <span className="gh-stat-label">{metric.label}</span>
              <span className="gh-stat-value">{metric.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gh-panel gh-governance-backlog">
        <div className="gh-panel-title">Open Requests</div>
        <div className="gh-request-list">
          {backlog.map((item) => (
            <article className="gh-request-card" key={`${item.asset}-${item.title}`}>
              <div className="gh-request-title">{item.title}</div>
              <div className="gh-request-meta">{item.asset}</div>
              <p>{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gh-panel gh-governance-glossary">
        <div className="gh-panel-title">Glossary</div>
        <table className="gh-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Definition</th>
            </tr>
          </thead>
          <tbody>
            {glossary.map((row) => (
              <tr key={row.term}>
                <td>{row.term}</td>
                <td>{row.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
