/* eslint-disable */
/** Asset 360 — drawer */
const { useState: uS3 } = React;

function Asset360({ assetId, onClose, onLineage }) {
  useLucide();
  const asset = window.GA.ASSETS.find(a => a.id === assetId);
  const [tab, setTab] = uS3('overview');
  if (!asset) return null;
  const cols = window.GA.ASSET_COLUMNS[asset.id] || [];

  return (
    <>
      <div className={`drawer-bg ${assetId ? 'open' : ''}`} onClick={onClose}></div>
      <div className={`drawer ${assetId ? 'open' : ''}`}>
        <div className="drawer-head">
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--srf-3)', display:'flex', alignItems:'center', justifyContent:'center', color: 'var(--accent)' }}>
            <Icon name={window.GA.ASSET_ICON[asset.type] || 'table-2'} size={20}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap', marginBottom: 4 }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize: 20, fontWeight: 700, color:'var(--txt-strong)', margin:0, letterSpacing:'-0.01em' }}>{asset.name}</h2>
              <CertBadge status={asset.certification}/>
              <ClassChip value={asset.classification}/>
              {asset.cde && <Chip tone="teal" icon="key-round">CDE</Chip>}
              {asset.pii && <Chip tone="crit" icon="shield-alert">PII</Chip>}
            </div>
            <div className="mono subtle" style={{ fontSize: 12 }}>{asset.fullPath}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="tabs">
          {[['overview','Overview'],['columns',`Columns · ${cols.length}`],['lineage',`Lineage · ${asset.upstream + asset.downstream}`],['quality','Quality'],['access','Access']].map(([id, label]) => (
            <div key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</div>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'overview' && <OverviewTab asset={asset}/>}
          {tab === 'columns' && <ColumnsTab asset={asset} cols={cols}/>}
          {tab === 'lineage' && <LineageMini asset={asset} onExpand={onLineage}/>}
          {tab === 'quality' && <QualityTab asset={asset}/>}
          {tab === 'access' && <AccessTab asset={asset}/>}
        </div>

        <div style={{ borderTop: '1px solid var(--srf-line-soft)', padding: '12px 22px', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--srf-2)' }}>
          <button className="btn btn-ghost"><Icon name="message-square" size={14}/>Comment</button>
          <button className="btn btn-secondary"><Icon name="user-plus" size={14}/>Request access</button>
          <button className="btn btn-primary"><Icon name="badge-check" size={14}/>Certify</button>
        </div>
      </div>
    </>
  );
}

function OverviewTab({ asset }) {
  return (
    <div style={{ padding: 22 }}>
      <p style={{ fontSize: 14, color: 'var(--txt)', lineHeight: 1.6, margin: '0 0 18px' }}>{asset.description}</p>

      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <Stat label="Owner" value={asset.owner.name} sub={asset.owner.team} icon={<Avatar name={asset.owner.name} size={28}/>}/>
        <Stat label="Steward team" value={asset.steward} sub="3 members"/>
        <Stat label="Freshness" value={asset.freshness} sub={`SLA · ${asset.freshnessSla}`} tone={asset.freshnessOk ? 'good' : 'crit'}/>
        <Stat label="Quality score" value={`${asset.qualityScore} / 100`} sub="6 of 6 checks pass" tone={asset.qualityScore >= 90 ? 'good' : 'warn'}/>
        {asset.rows && <Stat label="Rows" value={asset.rows.toLocaleString()} sub={`${asset.cols} columns · ${asset.sizeGb} GB`}/>}
        <Stat label="Usage · 30d" value={asset.queries30d.toLocaleString() + ' queries'} sub={`${asset.usagePct}% of org`}/>
      </div>

      <Section title="Tags & glossary">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {asset.tags.map(t => <span key={t} className={`tag ${t === 'CDE' ? 'cde' : t === 'pii' ? 'pii' : 'uc-tag'}`}>{t}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {asset.glossary.map(g => <Chip key={g} icon="book-text">{g}</Chip>)}
        </div>
      </Section>

      <Section title="Buildability note" subtitle="How this view is composed">
        <div style={{ background: 'var(--srf-2)', border: '1px solid var(--srf-line-soft)', borderRadius: 8, padding: 14, fontSize: 12.5, color: 'var(--txt-muted)', lineHeight: 1.6 }}>
          Metadata sourced from <span className="mono" style={{color:'var(--accent)'}}>system.information_schema.tables</span> · description and tags from <span className="mono" style={{color:'var(--accent)'}}>information_schema.table_tags</span> · ownership from UC grants · freshness from a Lakeflow Job that records last-write timestamp · trust score is computed nightly into <span className="mono" style={{color:'var(--accent)'}}>governance_state.asset_trust</span>.
        </div>
      </Section>
    </div>
  );
}

function ColumnsTab({ asset, cols }) {
  if (cols.length === 0) return <div style={{ padding: 22 }}><Empty icon="columns-3" title="Column metadata not loaded" sub="Click ‘Profile now’ to run a Lakeflow scan job."/></div>;
  return (
    <div>
      {asset.permissionGated && <div style={{ padding: '14px 22px 0' }}><Veil>Some columns are masked because your role lacks <span className="mono">RESTRICTED</span> on this catalog.</Veil></div>}
      <table className="tbl">
        <thead><tr><th>Column</th><th>Type</th><th>Null %</th><th>Tags</th><th>Description</th></tr></thead>
        <tbody>
          {cols.map(c => (
            <tr key={c.name}>
              <td>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ color: c.cde ? 'var(--teal)' : 'var(--accent)' }}><Icon name={c.cde ? 'key-round' : 'columns-3'} size={13}/></span>
                  <span className="mono" style={{ color: 'var(--txt-strong)', fontWeight: 600, fontSize: 12.5 }}>{c.name}</span>
                </div>
              </td>
              <td><span className="tag">{c.type}</span></td>
              <td className="num tnum subtle">{(c.null * 100).toFixed(2)}%</td>
              <td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {c.tags.map(t => <span key={t} className={`tag ${t === 'CDE' ? 'cde' : t.startsWith('pii') ? 'pii' : 'uc-tag'}`}>{t}</span>)}
                </div>
              </td>
              <td style={{ fontSize: 12, color: 'var(--txt-muted)', maxWidth: 260 }}>
                {c.masked ? <span style={{ color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="eye-off" size={11}/> {c.desc}</span> : c.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityTab({ asset }) {
  const checks = [
    { name: 'Schema drift', state: 'pass', detail: 'No schema changes in last 30 days.' },
    { name: 'Freshness SLA', state: asset.freshnessOk ? 'pass' : 'fail', detail: `Last write ${asset.freshness} (SLA ${asset.freshnessSla}).` },
    { name: 'Null rate', state: 'pass', detail: 'All NOT NULL columns have null rate ≤ baseline.' },
    { name: 'Row count', state: 'pass', detail: 'Within ±10% expected daily window.' },
    { name: 'Referential integrity', state: 'pass', detail: 'FKs validated against current dim tables.' },
    { name: 'Profile coverage', state: 'partial', detail: '8 of 10 columns profiled in last 7 days.' },
  ];
  return (
    <div style={{ padding: 22 }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
        <Donut value={asset.qualityScore} sub="Quality" tone={asset.qualityScore >= 90 ? 'good' : 'warn'}/>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Quality score</div>
          <div style={{ fontSize: 14, color: 'var(--txt)', lineHeight: 1.5 }}>
            Computed from 6 checks evaluated on the last successful Lakeflow run. Weighted by column criticality (CDEs count 2×).
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checks.map(c => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--srf-2)', border: '1px solid var(--srf-line-soft)', borderRadius: 6, padding: '10px 14px' }}>
            <Icon name={c.state === 'pass' ? 'check-circle-2' : c.state === 'fail' ? 'x-circle' : 'circle-dashed'} size={16} style={{ color: c.state === 'pass' ? 'var(--good)' : c.state === 'fail' ? 'var(--crit)' : 'var(--warn)' }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-strong)' }}>{c.name}</div>
              <div style={{ fontSize: 12, color: 'var(--txt-muted)' }}>{c.detail}</div>
            </div>
            <span className={`chip ${c.state === 'pass' ? 'good' : c.state === 'fail' ? 'crit' : 'warn'}`}>{c.state.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessTab({ asset }) {
  const grants = [
    { principal: 'group:finance-leads', type: 'group', grants: ['SELECT'], src: 'Direct grant', note: '4 members' },
    { principal: 'group:bi-readers', type: 'group', grants: ['SELECT'], src: 'Direct grant', note: '128 members' },
    { principal: 'svc-bi-warehouse', type: 'service', grants: ['SELECT'], src: 'Direct grant', note: 'BI warehouse SP' },
    { principal: 'group:finance-stewards', type: 'group', grants: ['ALL PRIVILEGES'], src: 'Owner', note: 'Owner team' },
  ];
  return (
    <div>
      <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--srf-line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--txt-muted)' }}>UC grants · permission-aware</div>
        <button className="btn btn-secondary btn-sm"><Icon name="user-plus" size={12}/>Request access</button>
      </div>
      <table className="tbl">
        <thead><tr><th>Principal</th><th>Privileges</th><th>Source</th><th></th></tr></thead>
        <tbody>
          {grants.map((g,i) => (
            <tr key={i}>
              <td>
                <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
                  <Icon name={g.type === 'group' ? 'users' : 'cpu'} size={14} style={{ color: 'var(--accent)' }}/>
                  <div>
                    <div className="mono" style={{ color: 'var(--txt-strong)', fontWeight: 600 }}>{g.principal}</div>
                    <div className="subtle" style={{ fontSize: 11 }}>{g.note}</div>
                  </div>
                </div>
              </td>
              <td>{g.grants.map(p => <span key={p} className="tag uc-tag" style={{ marginRight: 4 }}>{p}</span>)}</td>
              <td className="muted" style={{ fontSize: 12 }}>{g.src}</td>
              <td><Icon name="more-vertical" size={14} style={{ color: 'var(--txt-subtle)' }}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineageMini({ asset, onExpand }) {
  return (
    <div style={{ padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Lineage preview</div>
          <div style={{ fontSize: 13, color: 'var(--txt-muted)', marginTop: 4 }}>{asset.upstream} upstream · {asset.downstream} downstream</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onExpand}><Icon name="git-fork" size={12}/>Open Lineage Atlas</button>
      </div>
      <LineageGraph compact/>
    </div>
  );
}

function Stat({ label, value, sub, icon, tone }) {
  return (
    <div style={{ background:'var(--srf-2)', border:'1px solid var(--srf-line-soft)', borderRadius: 8, padding: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display:'flex', gap: 10, alignItems:'center' }}>
        {icon}
        <div>
          <div style={{ fontSize: 14, color: tone === 'good' ? 'var(--good)' : tone === 'crit' ? 'var(--crit)' : 'var(--txt-strong)', fontWeight: 700 }}>{value}</div>
          {sub && <div style={{ fontSize: 11.5, color: 'var(--txt-subtle)' }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}
function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--txt-subtle)', marginBottom: 8 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

window.Asset360 = Asset360;
