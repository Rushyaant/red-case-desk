import { useRef, useState } from 'react'
import SceneStage from './SceneStage.jsx'
import CameraNavigation from './CameraNavigation.jsx'
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
        <p id="domain-help">{trainingMode
          ? <>Enter a domain or paste a website URL. For <code>www.amazon.co.uk</code>, the desk uses <code>amazon.co.uk</code>.</>
          : <>Enter a two-label domain, such as <code>campusdesk.test</code>.</>} Each candidate applies one change.</p>
        <label htmlFor="domain">Domain</label>
        <input id="domain" name="domain" defaultValue="campusdesk.test" maxLength={trainingMode ? undefined : 128}
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
                      <ChangedDomain original={report.unicode_domain ?? report.domain} candidate={row.unicode_domain ?? row.domain} />
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

const chapters = [
  { id: 'intake', label: 'Intake', title: 'Phishing Case Desk', location: 'Zhujiajiao', image: 'zhujiajiao', position: '71%', description: 'Open a fictional Campus Desk case and inspect the evidence.' },
  { id: 'lookalikes', label: 'Lookalikes', location: 'Wukang Mansion', image: 'wukang', position: '29%', align: 'end', description: 'Examine how a small change turns a familiar domain into a different address.' },
  { id: 'evidence', label: 'Evidence', location: 'Yuyuan Garden', image: 'yuyuan', position: '67%', description: 'Compare registry, DNS, and certificate observations for the same candidate. Each source has its own result.' },
  { id: 'qr-lab', label: 'QR Lab', location: 'The Bund', image: 'bund', position: '29%', align: 'end', description: 'Decode a QR and inspect the destination in plain text.' },
  { id: 'case-report', label: 'Report', title: 'Case Report', location: 'Lujiazui', image: 'lujiazui', position: '74%', dark: true, description: 'Review the current session and save a copy for your records.' },
].map(chapter => ({ ...chapter, image: `${assets}scenes/${chapter.image}.webp` }))

export default function App() {
  const main = useRef(null)
  const [selected, setSelected] = useState([])
  const [variants, setVariants] = useState(null)
  const [observations, setObservations] = useState(null)
  const [scan, setScan] = useState(null)

  const desks = {
    intake: <Intake />,
    lookalikes: <Lookalikes selected={selected} setSelected={setSelected} report={variants} setReport={setVariants} />,
    evidence: <Evidence selected={selected} onRemove={name => setSelected(selected.filter(domain => domain !== name))}
      results={observations} setResults={setObservations} />,
    'qr-lab': <QrLab report={scan} setReport={setScan} />,
    'case-report': <CaseReport variants={variants} observations={observations} scan={scan} selected={selected} />,
  }

  return (
    <>
      <nav className="chapter-nav" aria-label="Chapters">
        <span>Red Case Desk</span>
        <div>{chapters.map(({ id, label }, index) => (
          <a key={id} href={`#${id}`}>0{index + 1} {label}</a>
        ))}</div>
      </nav>
      <main ref={main}>
        <div className="camera-world">
          {chapters.map(({ id, label, title, location, description, image, position, align, dark }, index) => {
            const Heading = index === 0 ? 'h1' : 'h2'
            return (
              <section key={id} id={id} aria-labelledby={`${id}-title`}>
                <header className="scene" data-align={align} data-dark={dark}
                  style={{ '--scene-image': `url("${image}")`, '--scene-position': position }}>
                  <div className="scene-copy">
                    <Heading id={`${id}-title`}>{title ?? label}</Heading>
                    <p>{description}</p>
                    {index === 0 && <span className="stamp">{trainingMode ? 'Hosted training' : 'Simulation'}</span>}
                  </div>
                  <span className="scene-location">{location}</span>
                </header>
                <div className="chapter-body">{desks[id]}</div>
              </section>
            )
          })}
        </div>
      </main>
      <SceneStage chapters={chapters} main={main} />
      <CameraNavigation chapters={chapters} main={main} />
    </>
  )
}
