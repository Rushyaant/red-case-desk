import { useEffect, useRef } from 'react'

const clamp = value => Math.max(0, Math.min(1, value))
const ease = value => value * value * (3 - 2 * value)

export default function SceneStage({ chapters, main }) {
  const stage = useRef(null)

  useEffect(() => {
    const root = main.current
    const layers = [...stage.current.querySelectorAll('img')]
    const events = new AbortController()
    let camera = { position: 0, motionOff: true }
    let ready = false

    function draw() {
      if (!ready) return
      const left = Math.floor(camera.position)
      const mix = ease(clamp(camera.position - left))
      layers.forEach((layer, index) => {
        layer.style.opacity = String(index === left ? 1 : index === left + 1 ? mix : 0)
        // Only the full-bleed artwork travels in depth; controls never become 3D cards.
        const distance = camera.position - index
        layer.style.transform = camera.motionOff ? 'none'
          : `translate3d(${distance * -0.5}%, 0, ${80 + distance * 50}px)`
      })
      root.dataset.sceneMotion = ''
    }

    root.addEventListener('camera-frame', event => {
      camera = event.detail
      draw()
    }, { signal: events.signal })

    Promise.all(layers.map(layer => layer.decode())).then(() => {
      if (events.signal.aborted) return
      ready = true
      draw()
    }).catch(() => {
      // Each chapter retains its original background if a stage image fails.
    })

    return () => {
      events.abort()
      delete root.dataset.sceneMotion
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
