import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceCamera, createWheelGesture } from './cameraMotion.js'

test('adjacent camera travel settles in about 1.2 seconds', () => {
  let camera = { position: 0, velocity: 0 }
  for (let frame = 0; frame < 85; frame++) {
    camera = advanceCamera(camera.position, camera.velocity, 1, 1 / 60)
    if (frame < 59) assert.ok(camera.position < 1)
  }
  assert.equal(camera.position, 1)
  assert.equal(camera.velocity, 0)
})

test('reversal preserves continuity and settles back at its stop', () => {
  let camera = { position: 0, velocity: 0 }
  for (let frame = 0; frame < 20; frame++) camera = advanceCamera(camera.position, camera.velocity, 1, 1 / 60)
  const before = camera.position
  camera = advanceCamera(camera.position, camera.velocity, 0, 1 / 60)
  assert.ok(Math.abs(camera.position - before) < 0.04)
  for (let frame = 0; frame < 90; frame++) {
    camera = advanceCamera(camera.position, camera.velocity, 0, 1 / 60)
    assert.ok(camera.position >= 0 && camera.position <= 1)
  }
  assert.equal(camera.position, 0)
})

test('small trackpad deltas trigger once, then reject the same gesture momentum', () => {
  const gesture = createWheelGesture()
  for (let frame = 0; frame < 11; frame++) assert.equal(gesture.feed(5, frame * 16), 0)
  assert.equal(gesture.feed(5, 176), 1)
  for (let frame = 12; frame < 50; frame++) assert.equal(gesture.feed(80, frame * 16), 0)
  assert.equal(gesture.feed(80, 1200), 1)
})

test('an opposite gesture can reverse immediately and normal content scrolling consumes momentum', () => {
  const gesture = createWheelGesture()
  assert.equal(gesture.feed(80, 0), 1)
  assert.equal(gesture.feed(-80, 20), -1)
  assert.equal(gesture.feed(80, 40, true), 0)
  assert.equal(gesture.feed(80, 60), 0)
  assert.equal(gesture.feed(80, 400), 1)
})
