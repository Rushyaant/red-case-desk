import { useState } from 'react'
import { trainingMode, trainingScan } from './labApi.js'

const assets = import.meta.env.BASE_URL
const samples = {
  'clean-qr': 'Clean control',
  'homoglyph-qr': 'Unicode lookalike',
  'userinfo-qr': 'Misleading @ address',
}
const verdicts = { review: 'Needs review', no_indicators: 'No indicators found', incomplete: 'Scan incomplete' }
const explanations = {
  url_userinfo: 'Text before @ can disguise the destination.',
  lookalike_host: 'The destination resembles the lab’s trusted domain.',
  misleading_subdomain: 'The trusted name appears inside a different domain.',
  unsupported_url_scheme: 'The payload uses a scheme outside the HTTP and HTTPS checks.',
  invalid_url: 'The scanner could not parse the URL.',
  reply_to_mismatch: 'The email’s sender and Reply-To domains differ.',
}
const maxBytes = 5_000_000

async function preparePhoto(file) {
  if (file.size > 20_000_000) throw new Error('Choose a camera photo under 20 MB.')
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read the photo. Try a JPEG or PNG file.')
  })
  try {
    const canvas = document.createElement('canvas')
    // Keep camera photos within the scanner's four-million-pixel input cap.
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('Could not prepare the photo. Try a JPEG or PNG file.')
    return new File([blob], 'camera-qr.jpg', { type: 'image/jpeg' })
  } finally {
    image.close()
  }
}

function Report({ report }) {
  const codes = report.urls.filter(row => row.source.startsWith('qr:'))
  return (
    <>
      <p role="status"><strong>{verdicts[report.result] ?? 'Scan complete'}</strong></p>
      <p><code>{report.file}</code> · Trusted domain <code>{report.trusted_domain}</code></p>
      <h4>Decoded QR payloads</h4>
      {codes.length ? (
        <ul className="variants">
          {codes.map(({ source, value, destination }) => (
            <li key={JSON.stringify([source, value])}>
              <code dir="ltr">{value}</code>
              {destination && <p>Destination host <code dir="ltr">{destination}</code></p>}
            </li>
          ))}
        </ul>
      ) : <p>No QR payload was decoded.</p>}
      {report.findings.length > 0 && (
        <>
          <h4>Findings</h4>
          <ul className="variants">
            {report.findings.map((finding, index) => (
              <li key={index}>
                <strong>{explanations[finding.rule] ?? finding.rule}</strong>
                {finding.value && <small><code dir="ltr">{finding.value}</code></small>}
              </li>
            ))}
          </ul>
        </>
      )}
      {report.scan_errors.length > 0 && (
        <>
          <h4>Scan limitations</h4>
          <ul className="variants">
            {report.scan_errors.map(({ source, error }, index) => <li key={index}><code>{source}</code> · {error}</li>)}
          </ul>
        </>
      )}
    </>
  )
}

export default function QrLab({ report, setReport }) {
  const [sample, setSample] = useState('userinfo-qr')
  const [file, setFile] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const samplePath = `${assets}fixtures/${sample}.png`

  async function scan(loadFile, builtInSample) {
    setScanning(true)
    setReport(null)
    setError('')
    try {
      if (trainingMode && builtInSample) {
        setReport(await trainingScan(builtInSample))
        return
      }
      const input = await loadFile()
      if (input.size > maxBytes) throw new Error('Choose a file at most 5 MB in size.')
      const form = new FormData()
      form.set('file', input)
      const response = await fetch('/api/blue/scan', { method: 'POST', body: form })
      const body = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(body?.urls)) {
        throw new Error(body?.error || 'Start the local Flask server on port 8000, then try again.')
      }
      setReport(body)
    } catch (failure) {
      setError(failure instanceof TypeError ? 'Could not reach the local scanner.' : failure.message)
    } finally {
      setScanning(false)
    }
  }

  function scanSample() {
    return scan(async () => {
      const response = await fetch(samplePath)
      if (!response.ok) throw new Error('Could not load the training QR.')
      return new File([await response.blob()], `${sample}.png`, { type: 'image/png' })
    }, sample)
  }

  return (
    <section id="qr-lab" aria-labelledby="qr-title">
      <header className="scene scene-qr">
        <img className="scene-art" src={`${assets}scenes/qr-lab.webp`} alt="" width="1536" height="343" />
        <div className="scene-copy">
          <h2 id="qr-title">QR Lab</h2>
          <p>Decode a QR and inspect the destination in plain text.</p>
        </div>
      </header>
      <div className="desk variant-layout">
        <section className="sheet qr-form" aria-labelledby="scan-title" aria-busy={scanning}>
          <h3 id="scan-title">Scan an exhibit</h3>
          <p>{trainingMode ? 'Choose a built-in QR to see its recorded scan.' : 'The local scanner reads the file offline and displays the address as text.'}</p>
          {!trainingMode && <>
          <label htmlFor="qr-file">Upload an EML, PNG, or JPEG</label>
          <input id="qr-file" type="file" accept=".eml,.png,.jpg,.jpeg" disabled={scanning}
            onChange={event => setFile(event.target.files[0] ?? null)} />
          <button className="action" type="button" disabled={scanning || !file} onClick={() => scan(() => file)}>Scan file</button>

          <label htmlFor="qr-camera">Capture a QR photo</label>
          <input id="qr-camera" type="file" accept="image/*" capture="environment" disabled={scanning}
            onChange={event => setPhoto(event.target.files[0] ?? null)} />
          <button className="action" type="button" disabled={scanning || !photo} onClick={() => scan(() => preparePhoto(photo))}>Scan photo</button>
          </>}

          <div className="qr-sample">
            <label htmlFor="qr-sample">Training QR</label>
            <select id="qr-sample" value={sample} onChange={event => setSample(event.target.value)} disabled={scanning}>
              {Object.entries(samples).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="qr-sample-actions">
              <button className="action" type="button" disabled={scanning} onClick={scanSample}>Scan sample</button>
              <a href={samplePath} download>Download PNG</a>
            </div>
          </div>
          {scanning && <p role="status">Scanning locally…</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section className="ledger qr-findings" aria-labelledby="qr-findings-title">
          <h3 id="qr-findings-title">Scan results</h3>
          {report ? <Report report={report} /> : <p>Decoded payloads, destination hosts, and findings appear here.</p>}
        </section>
      </div>
    </section>
  )
}
