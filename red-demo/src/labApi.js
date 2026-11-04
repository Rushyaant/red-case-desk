export const trainingMode = import.meta.env.MODE === 'training'

async function read(response) {
  const data = await response.json().catch(() => null)
  if (!response.ok || data == null) throw new Error(data?.error || 'Could not load the report. Check that the local Flask server is running.')
  return data
}

async function trainingData() {
  return read(await fetch(`${import.meta.env.BASE_URL}demo-cases.json`))
}

async function post(path, body) {
  return read(await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function generateVariants(options) {
  if (!trainingMode) return post('/api/red/variants', options)
  const { generateTrainingVariants, websiteDomain } = await import('./trainingVariants.js')
  const domain = websiteDomain(options.domain)
  if (domain !== 'campusdesk.test') return generateTrainingVariants(domain, options.unicode)
  const { variants } = await trainingData()
  return { ...variants, variants: options.unicode ? variants.variants : variants.variants.filter(row => !row.unicode_domain) }
}

export async function checkEvidence(domains) {
  if (!trainingMode) return post('/api/red/evidence', { domains })
  const { isDomain } = await import('./trainingVariants.js')
  if (!domains.every(isDomain)) throw new Error('Select valid domain candidates from Lookalikes.')
  const reservedEvidence = domains.some(domain => domain.endsWith('.test'))
    ? (await trainingData()).reservedEvidence
    : null
  const skipped = { status: 'skipped', reason: 'Live lookups are available in the local lab.' }
  return { results: domains.map(domain => domain.endsWith('.test')
    ? { ...reservedEvidence, domain }
    : { domain, ...skipped, evidence: { dns_a: skipped, dns_aaaa: skipped, ct: skipped } }) }
}

export async function trainingScan(sample) {
  const { scans } = await trainingData()
  if (!Object.hasOwn(scans, sample)) throw new Error('Select a built-in training QR.')
  return scans[sample]
}
