import { useEffect, useRef, useState } from 'react'
import { advanceCamera, cameraDepth, clamp, createWheelGesture } from './cameraMotion.js'
import './camera.css'

const preferenceKey = 'red-case-desk-motion-off'
const interactive = 'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="listbox"], [role="menu"]'
const ease = value => value * value * (3 - 2 * value)

function fragmentId(hash) {
  try { return decodeURIComponent(hash.slice(1)) } catch { return hash.slice(1) }
}

function savedPreference() {
  try { return localStorage.getItem(preferenceKey) === 'true' } catch { return false }
}

function canScroll(element, panel, direction) {
  for (let node = element; node && panel.contains(node); node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (/(auto|scroll)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) {
      if (direction > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 2) return true
      if (direction < 0 && node.scrollTop > 2) return true
    }
    if (node === panel) break
  }
  return false
}

export default function CameraNavigation({ chapters, main }) {
  const controls = useRef(null)
  const [current, setCurrent] = useState(0)
  const [moving, setMoving] = useState(false)
  const [motionOff, setMotionOff] = useState(savedPreference)
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const root = main.current
    const world = root.querySelector('.camera-world')
    const panels = [...world.children]
    const navigation = document.querySelector('.chapter-nav')
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const events = new AbortController()
    const { signal } = events
    const gesture = createWheelGesture()
    const supports3d = CSS.supports('perspective', '1100px') && CSS.supports('transform-style', 'preserve-3d')
    const state = {
      position: 0, velocity: 0, target: 0, frame: 0, time: 0, moving: false,
      disabled: savedPreference(), fragment: null, focus: false, touch: null,
    }

    function instant() { return state.disabled || media.matches || !supports3d }

    function emit() {
      root.dispatchEvent(new CustomEvent('camera-frame', {
        detail: { position: state.position, moving: state.moving, motionOff: instant() },
      }))
    }

    function paint() {
      const width = root.clientWidth
      // Chapter planes share one perspective space. The camera returns to neutral at every stop.
      const stops = [0, 0.16, -0.12, 0.14, 0]
      const left = Math.floor(state.position)
      const mix = state.position - left
      const cameraX = ((stops[left] ?? 0) * (1 - mix) + (stops[left + 1] ?? 0) * mix) * width
      world.style.transform = instant() ? 'none' : `translate3d(${-cameraX}px, 0, ${state.position * cameraDepth}px)`
      panels.forEach((panel, index) => {
        const behind = state.position - index
        const visible = state.moving ? Math.abs(behind) < 1.05 : index === state.target
        panel.style.transform = instant() ? 'none' : `translate3d(${(stops[index] ?? 0) * width}px, 0, ${-index * cameraDepth}px)`
        panel.style.visibility = visible ? 'visible' : 'hidden'
        panel.style.opacity = instant() ? '1' : String(behind > 0 ? 1 - ease(clamp(behind / 0.72, 0, 1)) : 1)
        panel.inert = state.moving || index !== state.target
        panel.setAttribute('aria-hidden', String(panel.inert))
      })
      root.toggleAttribute('data-moving', state.moving)
      root.toggleAttribute('data-instant', instant())
      emit()
    }

    function arrive() {
      state.moving = false
      state.velocity = 0
      setCurrent(state.target)
      setMoving(false)
      navigation.querySelectorAll('a[href^="#"]').forEach(link => {
        if (link.hash === '#' + panels[state.target].id) link.setAttribute('aria-current', 'step')
        else link.removeAttribute('aria-current')
      })
      paint()
      const panel = panels[state.target]
      if (state.fragment) {
        const element = document.getElementById(state.fragment)
        panel.scrollTop = element === panel ? 0
          : panel.scrollTop + element.getBoundingClientRect().top - panel.getBoundingClientRect().top
      }
      if (state.focus) panel.querySelector('h1, h2').focus({ preventScroll: true })
      state.fragment = null
      state.focus = false
      emit()
    }

    function tick(time) {
      state.frame = 0
      const result = advanceCamera(state.position, state.velocity, state.target, (time - state.time) / 1000)
      state.time = time
      state.position = clamp(result.position, 0, panels.length - 1)
      state.velocity = result.velocity
      if (state.position === state.target && state.velocity === 0) {
        arrive()
        return
      }
      paint()
      state.frame = requestAnimationFrame(tick)
    }

    function go(index, { fragment = null, focus = null, history = true } = {}) {
      const target = clamp(index, 0, panels.length - 1)
      state.fragment = fragment
      state.focus = focus ?? (root.contains(document.activeElement) || document.activeElement === document.body)
      if (history) {
        const url = new URL(location.href)
        url.hash = fragment ?? panels[target].id
        if (url.href !== location.href) window.history.pushState(null, '', url)
      }
      state.target = target
      if (instant()) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
        state.position = target
        arrive()
        return
      }
      if (state.position === target && !state.moving) {
        arrive()
        return
      }
      state.moving = true
      setMoving(true)
      paint()
      if (!state.frame) {
        state.time = performance.now()
        state.frame = requestAnimationFrame(tick)
      }
    }

    function step(direction) {
      if (state.moving) {
        if (direction === Math.sign(state.target - state.position)) return
        go(direction < 0 ? Math.floor(state.position) : Math.ceil(state.position))
      } else {
        go(state.target + direction)
      }
    }

    function fromHash() {
      const element = document.getElementById(fragmentId(location.hash))
      const index = panels.findIndex(panel => element && (panel === element || panel.contains(element)))
      if (index >= 0) go(index, { fragment: element.id, focus: true, history: false })
      else if (!location.hash) go(0, { focus: false, history: false })
    }

    function resize() {
      root.style.setProperty('--navigation-height', `${navigation.getBoundingClientRect().height}px`)
      paint()
    }

    function syncMotion(event) {
      if (event.type === 'camera-motion') state.disabled = event.detail
      setSystemReduced(media.matches)
      if (instant()) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
        state.position = state.target
        arrive()
      } else paint()
    }

    controls.current = { step }
    root.setAttribute('data-spatial', '')
    document.documentElement.classList.add('spatial-document')
    panels.forEach(panel => {
      const heading = panel.querySelector('h1, h2')
      heading.tabIndex = -1
      panel.addEventListener('scroll', emit, { passive: true, signal })
    })

    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target.closest('a[href]')
      if (!link || link.target || link.hasAttribute('download')) return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return
      const element = document.getElementById(fragmentId(url.hash))
      const index = panels.findIndex(panel => element && (panel === element || panel.contains(element)))
      if (index < 0) return
      event.preventDefault()
      go(index, { fragment: element.id, focus: true })
    }, { signal })

    root.addEventListener('wheel', event => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      if (event.target.closest(interactive)) return
      const direction = Math.sign(event.deltaY)
      if (!direction) return
      const panel = panels[state.target]
      const scrollable = !state.moving && canScroll(event.target, panel, direction)
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1)
      const intent = gesture.feed(delta, performance.now(), scrollable)
      if (scrollable) return
      event.preventDefault()
      if (intent) step(intent)
    }, { passive: false, signal })

    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest(interactive)) return
      const direction = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key) ? 1
        : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0
      if (!direction || event.repeat) return
      // Space on links retains activation semantics.
      if (event.key === ' ' && event.target.closest('a')) return
      const panel = panels[state.target]
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) && !state.moving && canScroll(panel, panel, direction)) {
        if (canScroll(event.target, panel, direction)) return
        event.preventDefault()
        panel.scrollBy({ top: direction * (event.key.startsWith('Arrow') ? 60 : panel.clientHeight * 0.85) })
        return
      }
      event.preventDefault()
      step(direction)
    }, { signal })

    root.addEventListener('touchstart', event => {
      state.touch = event.touches.length === 1 && !event.target.closest(interactive)
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY, used: false } : null
    }, { passive: true, signal })
    root.addEventListener('touchmove', event => {
      const touch = state.touch
      if (event.defaultPrevented) return
      if (!touch || event.touches.length !== 1) { state.touch = null; return }
      const x = touch.x - event.touches[0].clientX
      const y = touch.y - event.touches[0].clientY
      if (Math.abs(x) > Math.abs(y) || Math.abs(y) < 8) return
      if (!state.moving && canScroll(event.target, panels[state.target], Math.sign(y))) {
        touch.used = true
        return
      }
      if (event.cancelable) event.preventDefault()
      if (!touch.used && Math.abs(y) > 50) {
        touch.used = true
        step(Math.sign(y))
      }
    }, { passive: false, signal })
    root.addEventListener('touchend', () => { state.touch = null }, { passive: true, signal })
    root.addEventListener('camera-motion', syncMotion, { signal })
    window.addEventListener('popstate', fromHash, { signal })
    window.addEventListener('hashchange', fromHash, { signal })
    media.addEventListener('change', syncMotion, { signal })
    const layout = new ResizeObserver(resize)
    layout.observe(navigation)
    window.addEventListener('resize', resize, { signal })
    const initialId = fragmentId(location.hash)
    const initialElement = document.getElementById(initialId)
    const initialIndex = panels.findIndex(panel => initialElement && (panel === initialElement || panel.contains(initialElement)))
    if (initialIndex >= 0) state.position = state.target = initialIndex
    resize()
    fromHash()

    return () => {
      events.abort()
      layout.disconnect()
      cancelAnimationFrame(state.frame)
      controls.current = null
      document.documentElement.classList.remove('spatial-document')
      root.removeAttribute('data-spatial')
      root.removeAttribute('data-moving')
      root.removeAttribute('data-instant')
      world.style.removeProperty('transform')
      panels.forEach(panel => {
        panel.inert = false
        panel.removeAttribute('aria-hidden')
        for (const property of ['transform', 'visibility', 'opacity']) panel.style.removeProperty(property)
      })
    }
  }, [chapters, main])

  useEffect(() => {
    try { localStorage.setItem(preferenceKey, String(motionOff)) } catch { /* Session preference still works. */ }
    main.current.dispatchEvent(new CustomEvent('camera-motion', { detail: motionOff }))
  }, [main, motionOff])

  return (
    <div className="camera-controls" role="group" aria-label="Camera navigation">
      <button type="button" aria-label="Previous chapter" aria-disabled={current === 0 && !moving}
        onClick={() => controls.current?.step(-1)}>Back</button>
      <span className="camera-announcement" role="status" aria-live="polite" aria-atomic="true">
        {moving ? 'Traveling…' : `${current + 1} of ${chapters.length} · ${chapters[current].label}`}
      </span>
      <button type="button" aria-label="Next chapter" aria-disabled={current === chapters.length - 1 && !moving}
        onClick={() => controls.current?.step(1)}>Forward</button>
      <button type="button" aria-pressed={motionOff} onClick={() => setMotionOff(!motionOff)}>
        {systemReduced ? 'Motion off (system)' : motionOff ? 'Motion off' : 'Motion on'}
      </button>
    </div>
  )
}
