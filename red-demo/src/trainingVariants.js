import punycode from 'punycode/punycode.js'
import { getDomain } from 'tldts'

const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const suffixOptions = { allowPrivateDomains: true, extractHostname: false }
const keys = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'].flatMap((row, y) =>
  Array.from(row, (key, x) => ({ key, x: 4 * x + [0, 2, 3, 5][y], y })),
)
// shortcut: a small Cyrillic and Greek teaching set, with the full Unicode table in the local lab.
const lookalikes = { a: 'аα', c: 'с', e: 'е', i: 'і', j: 'ј', o: 'оο', p: 'рρ', s: 'ѕ', x: 'х', y: 'у' }

export function isDomain(domain) {
  return typeof domain === 'string' && domain.length <= 253 &&
    domain.includes('.') && domain.split('.').every(label => labelPattern.test(label))
}

export function websiteDomain(input) {
  const value = input.trim()
  const message = 'Enter a website domain or HTTP(S) URL, such as amazon.com.'
  if (!value || /[\s\\\p{Cc}]/u.test(value)) throw new Error(message)
  const address = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const url = URL.parse(address)
  const host = url?.hostname.replace(/\.$/, '')
  const domain = url && !url.username && !url.password && isDomain(host) && getDomain(host, suffixOptions)
  if (!domain) throw new Error(message)
  return domain
}

export function generateTrainingVariants(domain, unicode) {
  const dot = domain.indexOf('.')
  const name = punycode.toUnicode(domain.slice(0, dot))
  const suffix = domain.slice(dot)
  const characters = Array.from(name)
  const candidates = new Map()

  function add(label, technique) {
    if (!label || label === name || label.startsWith('xn--') || label.startsWith('-') || label.endsWith('-')) return
    const host = label + suffix
    const candidate = labelPattern.test(label) ? host : URL.parse(`https://${host}`)?.hostname
    if (!isDomain(candidate) || candidate === domain || getDomain(candidate, suffixOptions) !== candidate) return
    const row = candidates.get(candidate) ?? { domain: candidate, techniques: [] }
    if (!row.techniques.includes(technique)) row.techniques.push(technique)
    const display = punycode.toUnicode(candidate)
    if (display !== candidate) row.unicode_domain = display
    candidates.set(candidate, row)
  }

  characters.forEach((character, index) => {
    const before = characters.slice(0, index).join('')
    const after = characters.slice(index + 1).join('')
    add(before + after, 'omission')
    add(before + character.repeat(2) + after, 'repetition')
    if (after) {
      add(before + characters[index + 1] + character + characters.slice(index + 2).join(''), 'adjacent_swap')
      add(before + character + '-' + after, 'hyphen_insertion')
    }
    const position = keys.find(key => key.key === character)
    if (position) {
      for (const neighbor of keys) {
        if (Math.abs(neighbor.y - position.y) <= 1 && Math.abs(neighbor.x - position.x) <= 4) {
          add(before + neighbor.key + after, 'keyboard_neighbor')
        }
      }
    }
    if (character.charCodeAt(0) < 128) {
      for (let bit = 0; bit < 7; bit++) {
        const replacement = String.fromCharCode(character.charCodeAt(0) ^ (1 << bit))
        if (labelPattern.test(replacement) || replacement === '-') add(before + replacement + after, 'bit_flip')
      }
    }
    if (unicode) {
      for (const replacement of lookalikes[character] ?? '') {
        add(before + replacement + after, 'unicode_lookalike')
      }
    }
  })

  const variants = Array.from(candidates.keys()).sort().map(candidate => {
    const row = candidates.get(candidate)
    row.techniques.sort()
    return row
  })
  const display = punycode.toUnicode(domain)
  return { domain, variants, ...(display !== domain && { unicode_domain: display }) }
}
