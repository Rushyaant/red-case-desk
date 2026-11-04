import { useState } from 'react'
import Evidence from './Evidence.jsx'
import QrLab from './QrLab.jsx'
import CaseReport from './CaseReport.jsx'
import { generateVariants, trainingMode } from './labApi.js'

const assets = import.meta.env.BASE_URL
const cases = [
  { id: 'clean', title: 'Clean control', detail: 'Start with a baseline campus notice. Use it to compare the examples that follow.' },
  { id: 'omission', title: 'Lookalike domain', detail: 'Compare the destination in the email with the fictional Campus Desk domain.' },
  { id: 'userinfo-qr', title: 'QR destination trick', detail: 'Take this file to the scanner and compare the decoded address with its destination host.' },
]
const techniques = {
  omission: 'Omission', repetition: 'Repetition', adjacent_swap: 'Adjacent swap',
  hyphen_insertion: 'Hyphen insertion', keyboard_neighbor: 'Keyboard neighbor',
  bit_flip: 'Bit flip', tld_swap: 'TLD swap', unicode_lookalike: 'Unicode lookalike',
}

function Intake() {
  const [selected, setSelected] = useState(cases[0])
  return (
    <div className="desk case-layout">
      <div className="case-list" aria-label="Training cases" role="group">
        {cases.map((item, index) => (
          <button key={item.id} type="button" aria-pressed={selected.id === item.id} onClick={() => setSelected(item)}>
            <span className="case-number" aria-hidden="true">0{index + 1}</span>{item.title}
          </button>
        ))}
      </div>
      <article className="sheet" aria-labelledby="case-title">
        <h2 id="case-title">{selected.title}</h2>
        <p>{selected.detail}</p>
        {selected.id === 'userinfo-qr' && (
          <img className="training-qr" src={`${assets}fixtures/${selected.id}.png`}
            alt="QR code for the fictional Campus Desk training case" width="176" height="176" />
        )}
        <a className="action" href={`${assets}fixtures/${selected.id}.eml`} download>Download sample email</a>
      </article>
    </div>
  )
}

function ChangedDomain({ original, candidate }) {
  const before = Array.from(original)
  const after = Array.from(candidate)
  let start = 0
  let end = 0
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++
  while (end < Math.min(before.length, after.length) - start && before.at(-end - 1) === after.at(-end - 1)) end++
  const changed = after.slice(start, after.length - end).join('')
  const removed = before.slice(start, before.length - end).join('')
  return (
    <>
      <code dir="ltr">{after.slice(0, start).join('')}{changed && <mark>{changed}</mark>}{after.slice(after.length - end).join('')}</code>
      {!changed && <small>Removed <code>{removed}</code></small>}
    </>
  )
}

const maxSelected = 3

function Lookalikes({ selected, setSelected, report, setReport }) {
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(12)
  const matching = report?.variants.filter(row => !filter || row.techniques.includes(filter)) ?? []

  async function generate(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setRunning(true)
    setSelected([])
    setReport(null)
    setError('')
    setFilter('')
    setLimit(12)
    try {
      const body = await generateVariants({
        domain: form.get('domain'),
        tlds: String(form.get('tlds') ?? '').split(/[,\s]+/).filter(Boolean),
        unicode: form.has('unicode'),
      })
      setReport(body)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="desk variant-layout">
      <form className="sheet" onSubmit={generate} aria-busy={running}>
        <h3>Generate domain variants</h3>
        <p id="domain-help">{trainingMode ? 'Enter a fictional domain ending in .test, such as ' : 'Enter a two-label domain, such as '}<code>campusdesk.test</code>. Each candidate applies one change.</p>
        <label htmlFor="domain">Domain</label>
        <input id="domain" name="domain" defaultValue="campusdesk.test" maxLength="128"
          aria-describedby="domain-help" spellCheck={false} autoCapitalize="none" required disabled={running} />
        {!trainingMode && <>
          <label htmlFor="tlds">Extra suffixes (optional)</label>
          <input id="tlds" name="tlds" placeholder="co, org" maxLength="512" disabled={running} />
        </>}
        <label className="check"><input type="checkbox" name="unicode" defaultChecked disabled={running} />Include Unicode lookalikes</label>
        <button className="action" type="submit" disabled={running}>{running ? 'Generating…' : 'Generate variants'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

      <section className="ledger" aria-labelledby="ledger-title">
        <h3 id="ledger-title">Candidate ledger</h3>
        {report ? (
          <>
            <p role="status">{report.variants.length} candidates for <code>{report.domain}</code></p>
            <label htmlFor="technique">Filter by technique</label>
            <select id="technique" value={filter} onChange={event => { setFilter(event.target.value); setLimit(12) }}>
              <option value="">All techniques</option>
              {Object.entries(techniques).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
            <p>{matching.length} matching · {Math.min(limit, matching.length)} shown</p>
            <p>{selected.length} / {maxSelected} selected. <a href="#evidence">Open Evidence</a></p>
            <ul className="variants">
              {matching.slice(0, limit).map(row => (
                <li key={row.domain}>
                  <label className="candidate">
                    <input type="checkbox" aria-label={`Select ${row.domain}`}
                      checked={selected.includes(row.domain)}
                      disabled={selected.length >= maxSelected && !selected.includes(row.domain)}
                      onChange={event => setSelected(event.target.checked
                        ? [...selected, row.domain]
                        : selected.filter(domain => domain !== row.domain))} />
                    <span>
                      <ChangedDomain original={report.domain} candidate={row.unicode_domain ?? row.domain} />
                      {row.unicode_domain && <small>ASCII <code>{row.domain}</code></small>}
                      <small>{row.techniques.map(technique => techniques[technique] ?? technique).join(' · ')}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {matching.length > limit && <button className="more" onClick={() => setLimit(limit + 12)}>Show more candidates</button>}
          </>
        ) : <p>Generated candidates appear here, with the changed characters and the technique used.</p>}
      </section>
    </div>
  )
}

export default function App() {
  const [selected, setSelected] = useState([])
  const [variants, setVariants] = useState(null)
  const [observations, setObservations] = useState(null)
  const [scan, setScan] = useState(null)

  return (
    <>
      <nav className="chapter-nav" aria-label="Chapters">
        <span>Red Case Desk</span>
        <div><a href="#intake">01 Intake</a><a href="#lookalikes">02 Lookalikes</a><a href="#evidence">03 Evidence</a><a href="#qr-lab">04 QR Lab</a><a href="#case-report">05 Report</a></div>
      </nav>
      <main>
        <section id="intake" aria-labelledby="intake-title">
          <header className="scene scene-intake">
            <img className="scene-art" src={`${assets}scenes/intake.webp`} alt="" width="1536" height="333" />
            <div className="scene-copy">
              <h1 id="intake-title">Phishing<br />Case Desk</h1>
              <p>Open a fictional Campus Desk case and inspect the evidence.</p>
              <span className="stamp">{trainingMode ? 'Hosted training' : 'Simulation'}</span>
            </div>
          </header>
          <Intake />
        </section>
        <section id="lookalikes" aria-labelledby="lookalikes-title">
          <header className="scene scene-lookalikes">
            <img className="scene-art" src={`${assets}scenes/lookalikes.webp`} alt="" width="1536" height="328" />
            <div className="scene-copy">
              <h2 id="lookalikes-title">Lookalikes</h2>
              <p>Examine how a small change turns a familiar domain into a different address.</p>
            </div>
          </header>
          <Lookalikes selected={selected} setSelected={setSelected} report={variants} setReport={setVariants} />
        </section>
        <Evidence selected={selected} onRemove={name => setSelected(selected.filter(domain => domain !== name))}
          results={observations} setResults={setObservations} />
        <QrLab report={scan} setReport={setScan} />
        <CaseReport variants={variants} observations={observations} scan={scan} selected={selected} />
      </main>
    </>
  )
}
