import { useCallback, useEffect, useRef, useState } from 'react'
import { checkEvidence, trainingMode } from './labApi.js'

const watchKey = 'red-case-desk-watchlist-v1'
const watchInterval = 10 * 60 * 1000

function readWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(watchKey))
    return Array.isArray(saved) ? saved.filter(name => typeof name === 'string').slice(0, 3) : []
  } catch {
    return []
  }
}

function exportReport(format, report) {
  const rows = [['Section', 'Subject', 'Result', 'Details']]
  if (report.variants) {
    for (const row of report.variants.variants) {
      rows.push(['Lookalikes', row.domain, row.techniques.join(', '), row.unicode_domain ?? ''])
    }
  }
  for (const [label, observations] of [['Evidence', report.evidence], ['Watchlist', report.watchResults]]) {
    for (const row of observations ?? []) {
      rows.push([label, row.domain, row.status, JSON.stringify(row)])
    }
  }
  if (report.qr) {
    rows.push(['QR Lab', report.qr.file, report.qr.result, ''])
    for (const url of report.qr.urls) rows.push(['QR Lab', url.destination ?? '', url.source, url.value])
    for (const finding of report.qr.findings) rows.push(['QR Lab', report.qr.file, finding.rule, JSON.stringify(finding)])
    for (const failure of report.qr.scan_errors) rows.push(['QR Lab', report.qr.file, failure.source, failure.error])
  }

  let content = JSON.stringify(report, null, 2) + '\n'
  let mime = 'application/json'
  if (format === 'csv') {
    function cell(value) {
      const text = String(value)
      const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text) ? "'" + text : text
      return '"' + safe.replaceAll('"', '""') + '"'
    }
    content = rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
    mime = 'text/csv'
  } else if (format === 'html') {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    const escape = value => String(value).replace(/[&<>"']/g, character => entities[character])
    const cells = (row, tag) => row.map(value => '<' + tag + '>' + escape(value) + '</' + tag + '>').join('')
    content = '<!doctype html><html lang="en"><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<meta name="viewport" content="width=device-width"><title>Red Case Desk report</title>' +
      '<style>body{font:16px system-ui;margin:2rem;color:#242b24}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:.55rem;border:1px solid #aaa;text-align:left;overflow-wrap:anywhere;vertical-align:top}</style>' +
      '<h1>Red Case Desk report</h1><p>' + escape(report.createdAt) + ' · ' + escape(report.mode) + '</p>' +
      '<table><thead><tr>' + cells(rows[0], 'th') + '</tr></thead><tbody>' +
      rows.slice(1).map(row => '<tr>' + cells(row, 'td') + '</tr>').join('') + '</tbody></table></html>'
    mime = 'text/html'
  }

  const url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'red-case-desk-report.' + format
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function CaseReport({ variants, observations, scan, selected }) {
  const [watchlist, setWatchlist] = useState(readWatchlist)
  const [watchResults, setWatchResults] = useState(null)
  const [autoCheck, setAutoCheck] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [storageError, setStorageError] = useState('')
  const running = useRef(false)

  useEffect(() => {
    if (trainingMode) return
    try {
      localStorage.setItem(watchKey, JSON.stringify(watchlist))
    } catch {
      setStorageError('Browser storage is unavailable. The watchlist is available for this session.')
    }
  }, [watchlist])

  const check = useCallback(async () => {
    if (!watchlist.length || running.current) return
    running.current = true
    setChecking(true)
    setMessage('')
    try {
      const data = await checkEvidence(watchlist)
      setWatchResults({ time: new Date().toISOString(), rows: data.results })
    } catch (failure) {
      setMessage(failure.message)
    } finally {
      setChecking(false)
      running.current = false
    }
  }, [watchlist])

  useEffect(() => {
    if (!autoCheck || !watchlist.length) return
    const timer = setInterval(check, watchInterval)
    return () => clearInterval(timer)
  }, [autoCheck, check, watchlist.length])

  function saveSelected() {
    const next = [...new Set([...watchlist, ...selected])]
    if (next.length > 3) {
      setMessage('Remove a saved domain first. The watchlist holds up to three.')
      return
    }
    setMessage('')
    setWatchlist(next)
  }

  function download(format) {
    exportReport(format, {
      createdAt: new Date().toISOString(),
      mode: trainingMode ? 'Hosted training' : 'Local lab',
      variants, evidence: observations, qr: scan,
      watchlist: trainingMode ? [] : watchlist,
      watchCheckedAt: watchResults?.time ?? null,
      watchResults: watchResults?.rows ?? null,
    })
  }

  const hasReport = Boolean(variants || observations || scan || watchResults)
  return (
    <section id="case-report" aria-labelledby="case-report-title" className="evidence-chapter">
      <header className="desk evidence-heading">
        <h2 id="case-report-title">Case Report</h2>
        <p>Review the current session and save a copy for your records.</p>
      </header>
      <div className="desk variant-layout report-desk">
        <article className="sheet" aria-labelledby="report-summary-title">
          <h3 id="report-summary-title">Session summary</h3>
          <dl className="report-summary">
            <div><dt>Lookalikes</dt><dd>{variants ? <>{variants.variants.length} candidates for <code>{variants.domain}</code></> : 'No candidates generated'}</dd></div>
            <div><dt>Evidence</dt><dd>{observations ? `${observations.length} ${observations.length === 1 ? 'domain' : 'domains'} checked` : 'No domains checked'}</dd></div>
            <div><dt>QR Lab</dt><dd>{scan ? <>{scan.findings.length} {scan.findings.length === 1 ? 'finding' : 'findings'} in <code>{scan.file}</code></> : 'No file scanned'}</dd></div>
          </dl>
          <div className="report-exports">
            {['json', 'csv', 'html'].map(format => (
              <button key={format} type="button" className="action" disabled={!hasReport} onClick={() => download(format)}>Export {format.toUpperCase()}</button>
            ))}
          </div>
        </article>

        <div className="ledger">
          <h3>Watchlist</h3>
          {trainingMode ? <p>Live monitoring is available in the local lab.</p> : (
            <>
              <p>Save up to three selected candidates in this browser. Checks use the same public sources as Evidence.</p>
              {watchlist.length > 0 && <ul className="evidence-selection">
                {watchlist.map(domain => <li key={domain}><code>{domain}</code>
                  <button className="more" type="button" disabled={checking} aria-label={`Remove ${domain} from watchlist`}
                    onClick={() => setWatchlist(watchlist.filter(name => name !== domain))}>Remove</button>
                </li>)}
              </ul>}
              <div className="report-exports">
                <button className="action" type="button" disabled={!selected.length || checking} onClick={saveSelected}>Save selected candidates</button>
                <button className="action" type="button" disabled={!watchlist.length || checking} onClick={check}>{checking ? 'Checking…' : 'Check watchlist now'}</button>
              </div>
              <label className="check"><input type="checkbox" checked={autoCheck} onChange={event => setAutoCheck(event.target.checked)} />Recheck every 10 minutes while this page is open</label>
              {storageError && <p role="status">{storageError}</p>}
              {message && <p className="error" role="alert">{message}</p>}
              {watchResults && <div role="status">
                <p>Last watchlist check <time dateTime={watchResults.time}>{new Date(watchResults.time).toLocaleString()}</time></p>
                <ul className="variants">{watchResults.rows.map(row => (
                  <li key={row.domain}><code>{row.domain}</code>
                    <small>RDAP {row.status} · A {row.evidence.dns_a.status} · AAAA {row.evidence.dns_aaaa.status} · CT {row.evidence.ct.status}</small>
                  </li>
                ))}</ul>
              </div>}
            </>
          )}
          <div className="report-notes">
            <h3>Campaign notes</h3>
            <p>Microsoft’s Defender team documented QR phishing that used images to carry deceptive destinations. Compare the decoded host with the domain you expected before treating a QR as trustworthy.</p>
            <p><a href="https://www.microsoft.com/en-us/security/blog/2024/11/04/how-microsoft-defender-for-office-365-innovated-to-address-qr-code-phishing-attacks/">Microsoft’s QR phishing analysis</a></p>
          </div>
        </div>
      </div>
    </section>
  )
}
