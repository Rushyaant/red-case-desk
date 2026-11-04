import { generateTrainingVariants, isTrainingDomain } from './trainingVariants.js'

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
  const input = options.domain.trim()
  const domain = input.toLowerCase()
  if (!/^[a-zA-Z0-9.-]+$/.test(input) || !isTrainingDomain(domain) || domain.startsWith('xn--')) {
    throw new Error('Enter a fictional domain ending in .test, such as librarydesk.test. Use ASCII letters, numbers, or hyphens.')
  }
  if (domain !== 'campusdesk.test') return generateTrainingVariants(domain, options.unicode)
  const { variants } = await trainingData()
  return { ...variants, variants: options.unicode ? variants.variants : variants.variants.filter(row => !row.unicode_domain) }
}

export async function checkEvidence(domains) {
  if (!trainingMode) return post('/api/red/evidence', { domains })
  if (!domains.every(isTrainingDomain)) throw new Error('Select fictional .test candidates from Lookalikes.')
  const { reservedEvidence } = await trainingData()
  return { results: domains.map(domain => ({ ...reservedEvidence, domain })) }
}

export async function trainingScan(sample) {
  const { scans } = await trainingData()
  if (!Object.hasOwn(scans, sample)) throw new Error('Select a built-in training QR.')
  return scans[sample]
}
