const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const trainingDomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.test$/
const keys = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'].flatMap((row, y) =>
  Array.from(row, (key, x) => ({ key, x: 4 * x + [0, 2, 3, 5][y], y })),
)
// shortcut: a small Cyrillic and Greek teaching set, with the full Unicode table in the local lab.
const lookalikes = { a: 'аα', c: 'с', e: 'е', i: 'і', j: 'ј', o: 'оο', p: 'рρ', s: 'ѕ', x: 'х', y: 'у' }

export function isTrainingDomain(domain) {
  return typeof domain === 'string' && trainingDomainPattern.test(domain)
}

export function generateTrainingVariants(domain, unicode) {
  const name = domain.slice(0, -'.test'.length)
  const candidates = new Map()

  function add(label, technique, unicodeDomain) {
    if (label === name || !labelPattern.test(label) || (!unicodeDomain && label.startsWith('xn--'))) return
    const candidate = `${label}.test`
    const row = candidates.get(candidate) ?? { domain: candidate, techniques: [] }
    if (!row.techniques.includes(technique)) row.techniques.push(technique)
    if (unicodeDomain) row.unicode_domain = unicodeDomain
    candidates.set(candidate, row)
  }

  Array.from(name).forEach((character, index) => {
    const before = name.slice(0, index)
    const after = name.slice(index + 1)
    add(before + after, 'omission')
    add(before + character.repeat(2) + after, 'repetition')
    if (after) {
      add(before + after[0] + character + after.slice(1), 'adjacent_swap')
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
    for (let bit = 0; bit < 7; bit++) {
      const replacement = String.fromCharCode(character.charCodeAt(0) ^ (1 << bit))
      add(before + replacement + after, 'bit_flip')
    }
    if (unicode) {
      for (const replacement of lookalikes[character] ?? '') {
        const visual = `${before}${replacement}${after}.test`
        const ascii = new URL(`https://${visual}`).hostname
        add(ascii.slice(0, -'.test'.length), 'unicode_lookalike', visual)
      }
    }
  })

  const variants = Array.from(candidates.keys()).sort().map(candidate => {
    const row = candidates.get(candidate)
    row.techniques.sort()
    return row
  })
  return { domain, variants }
}
