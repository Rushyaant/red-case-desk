import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import test from 'node:test'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const publicRoot = resolve('dist')
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(publicRoot + '/')) throw new Error('Invalid path')
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }
    response.writeHead(200, { 'Content-Type': type[extname(file)] ?? 'application/octet-stream' })
    response.end(await readFile(file))
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const chapters = ['intake', 'lookalikes', 'evidence', 'qr-lab', 'case-report']
const errors = []
const measurements = []
async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.waitForFunction(() => document.querySelector('main').hasAttribute('data-spatial'))
  await page.waitForFunction(() => document.querySelector('main').hasAttribute('data-scene-motion'))
  return { context, page }
}
async function settled(page, id) {
  await page.waitForFunction(id => {
    const main = document.querySelector('main')
    return !main.hasAttribute('data-moving') &&
      document.getElementById(id).getAttribute('aria-hidden') === 'false' &&
      Number(getComputedStyle(document.querySelector('#' + id + ' .chapter-copy')).opacity) >= 0.999
  }, id)
}
async function go(page, id) {
  await page.locator(`.chapter-nav a[href="#${id}"]`).click()
  await settled(page, id)
}
async function layout(page, id, size) {
  const data = await page.evaluate(id => {
    const nav = document.querySelector('.chapter-nav').getBoundingClientRect()
    const footer = document.querySelector('.camera-controls').getBoundingClientRect()
    const section = document.getElementById(id)
    const heading = section.querySelector('h1,h2').getBoundingClientRect()
    const body = section.querySelector('.chapter-body').getBoundingClientRect()
    const copy = section.querySelector('.chapter-copy').getBoundingClientRect()
    return {
      navBottom: nav.bottom, footerTop: footer.top, headingTop: heading.top,
      headingBottom: heading.bottom, bodyTop: body.top, bodyBottom: body.bottom,
      bodyHeight: body.height, copyWidth: copy.width, width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      scrollY, panelScroll: section.scrollTop,
      active: [...document.querySelectorAll('.chapter')].filter(p => !p.inert).map(p => p.id),
      panelTransform: getComputedStyle(section).transform,
      worldTransform: getComputedStyle(document.querySelector('.camera-world')).transform,
      cards: [...section.querySelectorAll('.sheet,.ledger,.evidence-record')].map(p => ({
        background: getComputedStyle(p).backgroundColor, shadow: getComputedStyle(p).boxShadow,
      })),
      headingOutline: getComputedStyle(section.querySelector('h1,h2')).outlineStyle,
    }
  }, id)
  measurements.push({ size, id, ...data })
  assert.ok(data.headingTop >= data.navBottom - 1, JSON.stringify(data))
  assert.ok(data.headingBottom <= data.bodyTop + 1, JSON.stringify(data))
  assert.ok(data.bodyBottom <= data.footerTop + 1, JSON.stringify(data))
  assert.ok(data.bodyHeight >= 100, JSON.stringify(data))
  assert.deepEqual(data.active, [id])
  assert.equal(data.overflow, false)
  assert.equal(data.scrollY, 0)
  assert.equal(data.panelScroll, 0)
  assert.equal(data.panelTransform, 'none')
  assert.equal(data.worldTransform, 'none')
  assert.equal(data.headingOutline, 'none')
  for (const card of data.cards) {
    assert.equal(card.background, 'rgba(0, 0, 0, 0)')
    assert.equal(card.shadow, 'none')
  }
  if (data.width >= 850) assert.ok(data.copyWidth / data.width <= 0.561)
}

try {
  for (const [name, width, height] of [
    ['desktop', 1440, 900], ['mobile', 390, 844],
    ['short', 1024, 600], ['narrow', 320, 640],
  ]) {
    await test(`all five chapter layouts: ${name}`, async () => {
      const { context, page } = await open({ viewport: { width, height } })
      for (const id of chapters) {
        await go(page, id)
        await layout(page, id, name)
        if (['desktop', 'mobile'].includes(name)) {
          await page.screenshot({ path: resolve(output, `${name}-${id}.png`) })
        }
      }
      await context.close()
    })
  }

  await test('depth travel shows no ghost interfaces or transformed webpage cards', async () => {
    const { context, page } = await open()
    await page.evaluate(() => {
      window.framesSeen = []
      let last = 0
      const inspect = () => {
        const main = document.querySelector('main')
        if (main.hasAttribute('data-moving')) {
          const copies = [...document.querySelectorAll('.chapter-copy')].filter(el =>
            getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0)
          window.framesSeen.push({
            copies: copies.length, scroll: scrollY,
            transformed: [...document.querySelectorAll('.chapter')].some(p => getComputedStyle(p).transform !== 'none'),
          })
        }
        last = requestAnimationFrame(inspect)
      }
      window.stopInspection = () => cancelAnimationFrame(last)
      inspect()
    })
    await go(page, 'case-report')
    await go(page, 'intake')
    const frames = await page.evaluate(() => { stopInspection(); return framesSeen })
    assert.ok(frames.length > 10)
    assert.ok(frames.every(f => f.copies === 0 && f.scroll === 0 && !f.transformed))
    await context.close()
  })

  await test('wheel over artwork and keyboard follow the same chapter route', async () => {
    const { context, page } = await open()
    await page.mouse.move(1270, 420)
    await page.mouse.wheel(0, 110)
    await settled(page, 'lookalikes')
    await page.locator('#lookalikes-title').focus()
    await page.keyboard.press('ArrowRight')
    await settled(page, 'evidence')
    await page.keyboard.press('ArrowLeft')
    await settled(page, 'lookalikes')
    assert.equal(await page.evaluate(() => scrollY), 0)
    await context.close()
  })

  await test('forms, training evidence, QR scanning, exports, and return positions', async () => {
    const { context, page } = await open()
    await go(page, 'lookalikes')
    await page.getByLabel('Domain', { exact: true }).fill('campusdesk.test')
    await page.getByRole('button', { name: 'Generate variants', exact: true }).click()
    await page.getByRole('checkbox', { name: /^Select / }).first().waitFor()
    await page.getByRole('checkbox', { name: /^Select / }).first().check()
    const body = page.locator('#lookalikes .chapter-body')
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    const initialScroll = await body.evaluate(el => el.scrollTop)
    assert.ok(initialScroll > 0)
    await body.hover()
    await page.mouse.wheel(0, 900)
    assert.equal(await page.locator('main').getAttribute('data-moving'), null)
    assert.equal(new URL(page.url()).hash, '#lookalikes')
    await go(page, 'evidence')
    await page.locator('#evidence button.action').click()
    await page.locator('#evidence .evidence-record').first().waitFor()
    await go(page, 'qr-lab')
    await page.getByRole('button', { name: 'Scan sample', exact: true }).click()
    await page.getByText('Needs review', { exact: true }).waitFor()
    await go(page, 'case-report')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export JSON' }).click()
    const result = await download
    const content = JSON.parse(await readFile(await result.path(), 'utf8'))
    assert.ok(content.variants.variants.length > 0)
    assert.equal(content.evidence.length, 1)
    assert.equal(content.qr.result, 'review')
    for (const [from, to] of [['case-report', 'qr-lab'], ['qr-lab', 'evidence'], ['evidence', 'lookalikes']]) {
      await page.getByRole('button', { name: 'Back to previous chapter' }).click()
      await settled(page, to)
      assert.equal(await page.locator('#' + to + ' .chapter-body').evaluate(el => el.scrollTop), 0, from)
    }
    assert.equal(await page.getByLabel('Domain', { exact: true }).inputValue(), 'campusdesk.test')
    assert.equal(await page.getByRole('checkbox', { name: /^Select / }).first().isChecked(), true)
    await context.close()
  })

  await test('history, deep links, input state, and reduced motion remain usable', async () => {
    const { context, page } = await open()
    await go(page, 'lookalikes')
    await page.getByLabel('Domain', { exact: true }).fill('https://www.amazon.co.uk/path')
    await go(page, 'evidence')
    await page.goBack()
    await settled(page, 'lookalikes')
    assert.equal(await page.getByLabel('Domain', { exact: true }).inputValue(), 'https://www.amazon.co.uk/path')
    await page.goForward()
    await settled(page, 'evidence')
    await page.getByRole('button', { name: 'Motion on', exact: true }).click()
    await go(page, 'case-report')
    await page.reload()
    await settled(page, 'case-report')
    assert.equal(await page.getByRole('button', { name: 'Motion off', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await go(page, 'intake')
    assert.equal(await page.locator('main').getAttribute('data-instant'), '')
    assert.equal(await page.locator('.scene-stage img').first().evaluate(el => getComputedStyle(el).transform), 'none')
    await context.close()
  })

  await test('mobile touch navigates and keyboard focus remains visible on controls', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const session = await context.newCDPSession(page)
    const top = await page.locator('main').evaluate(el => el.getBoundingClientRect().top)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 350, y: top + 125 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 350, y: top + 50 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await settled(page, 'lookalikes')
    await page.locator('.chapter-nav a').first().focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid')
    await context.close()
  })


  await test('keyboard skip link, native endpoints, touch targets, and phone input sizing', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } })
    assert.equal(await page.getByRole('button', { name: 'Back to previous chapter' }).isDisabled(), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    await settled(page, 'intake')
    assert.equal(await page.locator('#intake-title').evaluate(el => el === document.activeElement), true)
    for (const link of await page.locator('.chapter-nav a').all()) {
      assert.ok((await link.boundingBox()).height >= 44)
    }
    await go(page, 'lookalikes')
    assert.ok(await page.getByLabel('Domain', { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16))
    assert.equal(await page.title(), 'Lookalikes · Red Case Desk')
    await go(page, 'case-report')
    assert.equal(await page.getByRole('button', { name: 'Forward to next chapter' }).isDisabled(), true)
    await context.close()
  })

  await test('200 percent text remains readable and forms remain reachable', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const { context, page } = await open({ viewport })
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      for (const id of chapters) {
        await go(page, id)
        const bounds = await page.locator('#' + id + ' .chapter-body').boundingBox()
        assert.ok(bounds.height >= 80, id + ' ' + JSON.stringify(viewport) + ' ' + JSON.stringify(bounds))
        const control = page.locator('#' + id + ' .chapter-body').locator('a,button,input,select').filter({ visible: true }).first()
        if (await control.count()) {
          await control.scrollIntoViewIfNeeded()
          const box = await control.boundingBox()
          const safe = await page.locator('main').boundingBox()
          assert.ok(box.y >= safe.y - 1 && box.y + box.height <= safe.y + safe.height + 1, id + ' control clipped')
        }
      }
      await go(page, 'lookalikes')
      await page.getByRole('button', { name: 'Generate variants', exact: true }).click()
      await page.getByRole('checkbox', { name: /^Select / }).first().check()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await context.close()
    }
  })

  await test('automated accessibility audit across all five chapters', async () => {
    const { default: AxeBuilder } = await import(process.env.AXE_MODULE ?? '@axe-core/playwright')
    const { context, page } = await open()
    const audit = []
    for (const id of chapters) {
      await go(page, id)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      audit.push({ chapter: id, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), incomplete: result.incomplete.map(v => v.id) })
    }
    await writeFile(resolve(output, 'accessibility.json'), JSON.stringify(audit, null, 2))
    assert.ok(audit.every(row => row.violations.length === 0), JSON.stringify(audit))
    await context.close()
  })

  await test('camera stops rendering at rest and reverses travel without losing its destination', async () => {
    const { context, page } = await open()
    await page.evaluate(() => { window.cameraFrames = 0; document.querySelector('main').addEventListener('camera-frame', () => window.cameraFrames++) })
    await page.evaluate(() => new Promise(resolve => {
      const start = performance.now()
      const sample = time => time - start >= 250 ? resolve() : requestAnimationFrame(sample)
      requestAnimationFrame(sample)
    }))
    assert.equal(await page.evaluate(() => window.cameraFrames), 0)
    assert.ok(await page.locator('.scene-stage img').evaluateAll(layers => layers.every(el => getComputedStyle(el).willChange === 'auto')))
    await page.getByRole('button', { name: 'Forward to next chapter' }).click()
    await page.waitForFunction(() => document.querySelector('main').hasAttribute('data-moving'))
    await page.getByRole('button', { name: 'Back to previous chapter' }).click()
    await settled(page, 'intake')
    assert.equal(await page.evaluate(() => scrollY), 0)
    await context.close()
  })

  await test('failed training-data requests show an error and allow retry', async () => {
    const { context, page } = await open()
    await go(page, 'lookalikes')
    await page.route('**/demo-cases.json', route => route.fulfill({ status: 503, json: { error: 'Training data unavailable. Try again.' } }))
    await page.getByRole('button', { name: 'Generate variants', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Generate variants', exact: true }).isEnabled(), true)
    await page.unroute('**/demo-cases.json')
    await page.getByRole('button', { name: 'Generate variants', exact: true }).click()
    await page.getByRole('checkbox', { name: /^Select / }).first().waitFor()
    await context.close()
  })


  await test('no browser JavaScript exceptions', () => assert.deepEqual(errors, []))
} finally {
  await writeFile(resolve(output, 'layout-measurements.json'), JSON.stringify(measurements, null, 2))
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

