import { useState } from 'react'
import { checkEvidence, trainingMode } from './labApi.js'

const statusLabels = {
  registered: 'Registered', not_found: 'No registration record returned',
  unsupported_suffix: 'No supported RDAP service', unavailable: 'Unavailable',
  rate_limited: 'Rate limited', skipped: 'Skipped', nxdomain: 'Name does not resolve (NXDOMAIN)',
  no_records: 'No records of this type', records_found: 'Records found',
  exact_match_found: 'Exact name found', no_exact_match: 'No exact name found',
}

function EvidenceSource({ label, result }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{statusLabels[result.status] ?? result.status}</strong>
        {result.http_status && <span>HTTP {result.http_status}</span>}
        {result.rcode != null && <span>DNS response code {result.rcode}</span>}
        {result.reason && <span>{result.reason}</span>}
        {result.addresses?.map(address => <code key={address}>{address}</code>)}
        {result.match_count != null && <span>{result.match_count} matches on the first page of unexpired issuances</span>}
        {result.sample_ids?.length > 0 && <span>Sample IDs <code>{result.sample_ids.join(', ')}</code></span>}
        {result.retry_after && <span>Retry after <code>{result.retry_after}</code></span>}
        {(result.source || result.service) && <small>{result.source ?? result.service}</small>}
      </dd>
    </div>
  )
}

export default function Evidence({ selected, onRemove, results, setResults }) {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  async function check() {
    setChecking(true)
    setResults(null)
    setError('')
    try {
      const data = await checkEvidence(selected)
      setResults(data.results)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <section id="evidence" aria-labelledby="evidence-title" className="evidence-chapter">
      <header className="desk evidence-heading">
        <h2 id="evidence-title">Evidence</h2>
        <p>Compare registry, DNS, and certificate observations for the same candidate. Each source has its own result.</p>
      </header>
      <div className="desk evidence-desk">
        <section className="sheet" aria-labelledby="selected-title">
          <h3 id="selected-title">Selected candidates</h3>
          {selected.length ? (
            <ul className="evidence-selection">
              {selected.map(domain => (
                <li key={domain}><code dir="ltr">{domain}</code>
                  <button type="button" className="more" aria-label={`Remove ${domain}`} onClick={() => onRemove(domain)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p><a href="#lookalikes">Choose up to three candidates in Lookalikes.</a></p>}
          <p>{trainingMode
            ? 'This demo shows the reserved-domain result for fictional names.'
            : 'Checking sends public names to RDAP, Google Public DNS, and Cert Spotter. Reserved training names skip external lookups.'}</p>
          <button className="action" type="button" onClick={check} disabled={checking || !selected.length}>
            {checking ? 'Checking evidence…' : 'Check evidence'}
          </button>
          {checking && <p role="status">Contacting evidence sources. Slow providers can take a moment.</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </section>

        {results && (
          <section className="ledger" aria-labelledby="observations-title">
            <h3 id="observations-title">Last check</h3>
            <p role="status">Checked {results.length} {results.length === 1 ? 'candidate' : 'candidates'}.</p>
            {results.map(row => (
              <article className="evidence-record" key={row.domain}>
                <h4><code dir="ltr">{row.domain}</code></h4>
                <dl>
                  <EvidenceSource label="RDAP" result={row} />
                  <EvidenceSource label="DNS · A" result={row.evidence.dns_a} />
                  <EvidenceSource label="DNS · AAAA" result={row.evidence.dns_aaaa} />
                  <EvidenceSource label="Certificate transparency" result={row.evidence.ct} />
                </dl>
              </article>
            ))}
          </section>
        )}
      </div>
    </section>
  )
}
