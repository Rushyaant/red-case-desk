export const cameraDepth = 1200
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// A critically damped camera keeps its position and velocity when retargeted.
export function advanceCamera(position, velocity, target, seconds) {
  const rate = 8
  const time = Math.min(seconds, 0.05)
  const distance = position - target
  const decay = Math.exp(-rate * time)
  const impulse = velocity + rate * distance
  const next = target + (distance + impulse * time) * decay
  const speed = (velocity - rate * impulse * time) * decay
  return Math.abs(next - target) < 0.001 && Math.abs(speed) < 0.008
    ? { position: target, velocity: 0 }
    : { position: next, velocity: speed }
}

export function createWheelGesture() {
  let amount = 0
  let last = -Infinity
  let direction = 0
  let consumed = false
  return {
    feed(delta, now, contentScrolled = false) {
      const nextDirection = Math.sign(delta)
      if (now - last > 220 || nextDirection !== direction) {
        amount = 0
        consumed = false
      }
      last = now
      direction = nextDirection
      if (contentScrolled) consumed = true
      if (consumed) return 0
      amount += delta
      if (Math.abs(amount) < 60) return 0
      consumed = true
      return direction
    },
  }
}
