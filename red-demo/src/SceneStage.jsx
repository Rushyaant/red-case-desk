import { useEffect, useRef } from 'react'

const clamp = value => Math.max(0, Math.min(1, value))
const ease = value => value * value * (3 - 2 * value)

export default function SceneStage({ chapters, main }) {
  const stage = useRef(null)

  useEffect(() => {
    const stageNode = stage.current
    const mainNode = main.current
    const layers = [...stageNode.querySelectorAll('img')]
    const headers = [...mainNode.querySelectorAll('.scene')]
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const events = new AbortController()
    const { signal } = events
    const layout = new ResizeObserver(schedule)
    const animation = { frame: 0 }
    let ready = false
    let camera = null

    function draw() {
      animation.frame = 0
      if (motion.matches || camera?.motionOff) {
        delete mainNode.dataset.sceneMotion
        headers.forEach(header => header.style.setProperty('--copy-opacity', '1'))
        return
      }
      if (camera && mainNode.hasAttribute('data-spatial')) {
        const incoming = Math.ceil(camera.position)
        const mix = ease(camera.position - Math.floor(camera.position))
        layers.forEach((layer, index) => {
          const opacity = index === Math.floor(camera.position) ? 1 : index === incoming ? mix : 0
          layer.style.opacity = String(opacity)
          if (opacity > 0) {
            const panel = headers[index].parentElement
            const travel = clamp(0.5 + panel.scrollTop / mainNode.clientHeight * 0.4)
            layer.style.transform = `scale(${1.025 + travel * 0.055})`
          }
        })
        headers.forEach((header, index) => {
          const remaining = clamp((header.offsetHeight - header.parentElement.scrollTop) / (mainNode.clientHeight * 0.32))
          const readable = Math.min(remaining, 1 - clamp(Math.abs(camera.position - index)))
          header.style.setProperty('--copy-opacity', String(0.55 + 0.45 * ease(readable)))
        })
        mainNode.dataset.sceneMotion = ''
        return
      }
      const height = window.innerHeight
      const bounds = headers.map(header => header.getBoundingClientRect())
      const incoming = Math.max(0, bounds.findLastIndex(({ top }) => top < height * 0.9))
      const mix = incoming > 0 ? ease(clamp((height * 0.9 - bounds[incoming].top) / (height * 0.62))) : 1

      layers.forEach((layer, index) => {
        const opacity = index === incoming ? mix : Number(index === Math.max(0, incoming - 1) && mix < 1)
        layer.style.opacity = String(opacity)
        if (opacity > 0) {
          const travel = clamp(0.5 - bounds[index].top / height)
          layer.style.transform = `scale(${1.025 + travel * 0.055})`
        }
      })

      headers.forEach((header, index) => {
        const { top, bottom } = bounds[index]
        const entering = clamp((height - top) / (height * 0.54))
        const leaving = clamp(bottom / (height * 0.32))
        header.style.setProperty('--copy-opacity', String(0.55 + 0.45 * ease(Math.min(entering, leaving))))
      })
      mainNode.dataset.sceneMotion = ''
    }

    function schedule() {
      if (ready && !animation.frame) animation.frame = requestAnimationFrame(draw)
    }

    function syncMotion() {
      if (!ready || motion.matches) {
        delete mainNode.dataset.sceneMotion
        return
      }
      schedule()
    }

    mainNode.addEventListener('camera-frame', event => {
      camera = event.detail
      schedule()
    }, { signal })
    window.addEventListener('scroll', schedule, { passive: true, signal })
    window.addEventListener('resize', schedule, { signal })
    motion.addEventListener('change', syncMotion, { signal })
    for (const header of headers) layout.observe(header)

    Promise.all(layers.map(layer => layer.decode())).then(() => {
      if (signal.aborted) return
      ready = true
      syncMotion()
    }).catch(() => {
      // Leave the in-flow artwork visible if a stage image cannot load.
    })

    return () => {
      events.abort()
      delete mainNode.dataset.sceneMotion
      cancelAnimationFrame(animation.frame)
      layout.disconnect()
    }
  }, [chapters, main])

  return (
    <div className="scene-stage" ref={stage} aria-hidden="true">
      {chapters.map(({ id, image, position }, index) => (
        <img key={id} src={image} alt="" width="1600" height="900" fetchPriority={index === 0 ? 'high' : 'low'}
          style={{ '--scene-position': position }} />
      ))}
    </div>
  )
}
