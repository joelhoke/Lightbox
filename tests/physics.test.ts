import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CordSimulation } from '../src/physics.ts';
import { CORD } from '../src/config.ts';

function lifted() {
  const simulation = new CordSimulation();
  simulation.beginDrag(0);
  simulation.dragTo({ x: 0.18, y: 0.49 }, 100);
  for (let i = 0; i < 90; i++) simulation.advance(CORD.timestep);
  return simulation;
}

test('lifted slack cord falls, swings across the anchor, stretches, and settles', () => {
  const simulation = lifted();
  const liftedY = simulation.end.y;
  simulation.release(1000);
  let crossed = false, stretched = false;
  for (let i = 0; i < 2400; i++) {
    simulation.advance(CORD.timestep);
    crossed ||= simulation.end.x < CORD.anchor.x - 0.01;
    stretched ||= Math.hypot(simulation.end.x - CORD.anchor.x, simulation.end.y - CORD.anchor.y) > CORD.length + 0.002;
    for (let j = 1; j < simulation.points.length; j++) {
      const a = simulation.points[j - 1], b = simulation.points[j];
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= simulation.segmentRestLength(j - 1) * (1 + CORD.maxStretch) + 1e-8);
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    }
  }
  assert.ok(simulation.end.y < liftedY - 0.1);
  assert.ok(crossed && stretched);
  assert.equal(simulation.awake, false);
  assert.ok(Math.abs(simulation.end.x - CORD.anchor.x) < CORD.sleepOffset);
});

test('extreme drags and background time are bounded, reset clears velocity', () => {
  const simulation = lifted();
  simulation.dragTo({ x: 200, y: -200 }, 100.1);
  simulation.advance(1000);
  assert.ok(Math.hypot(simulation.end.x - CORD.anchor.x, simulation.end.y - CORD.anchor.y) <= simulation.maxLength + 1e-8);
  simulation.release(110);
  simulation.pause();
  simulation.advance(60);
  assert.ok(Number.isFinite(simulation.end.x));
  simulation.reset();
  assert.equal(simulation.awake, false);
  assert.equal(simulation.dragging, false);
  assert.equal(simulation.end.x, CORD.anchor.x);
  assert.equal(simulation.end.y, CORD.anchor.y - CORD.length);
});

test('reduced-motion release returns to rest without animation', () => {
  const simulation = lifted();
  simulation.release(1000, false);
  assert.equal(simulation.awake, false);
  assert.equal(simulation.end.x, CORD.anchor.x);
});

test('fixed steps produce equivalent motion at 60 and 120 Hz', () => {
  const a = lifted(), b = lifted();
  a.release(1000); b.release(1000);
  for (let i = 0; i < 120; i++) a.advance(1 / 60);
  for (let i = 0; i < 240; i++) b.advance(1 / 120);
  assert.ok(Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) < 1e-8);
});


function advance(simulation: CordSimulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds / CORD.timestep); i++) simulation.advance(CORD.timestep);
}

function assertLengths(simulation: CordSimulation) {
  let restLength = 0;
  assert.ok(simulation.segmentCount <= simulation.maxSegments);
  for (let i = 0; i < simulation.segmentCount; i++) {
    const a = simulation.points[i], b = simulation.points[i + 1];
    const rest = simulation.segmentRestLength(i);
    restLength += rest;
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= rest * (1 + CORD.maxStretch) + 1e-8);
    if (i > 0) assert.equal(rest, CORD.length / CORD.segments);
  }
  assert.ok(Math.abs(restLength - simulation.deployedLength) < 1e-10);
}

function extended() {
  const simulation = new CordSimulation();
  simulation.beginDrag(0);
  simulation.dragTo({ x: 0.43, y: 0.45 }, 100);
  advance(simulation, 1);
  return simulation;
}

test('original-length gestures retain the original segment layout without payout', () => {
  const simulation = lifted();
  assert.equal(simulation.deployedLength, CORD.length);
  assert.equal(simulation.segmentCount, CORD.segments);
  assertLengths(simulation);
});

test('taut dragging pays out at a bounded speed, caps at 10 cm, and lifting retains slack', () => {
  const simulation = new CordSimulation();
  simulation.beginDrag(0);
  simulation.dragTo({ x: 10, y: 0.3 }, 100);
  for (let i = 0; i < 240; i++) {
    const before = simulation.deployedLength;
    simulation.advance(CORD.timestep);
    assert.ok(simulation.deployedLength - before <= CORD.payoutSpeed * CORD.timestep + 1e-10);
    assertLengths(simulation);
  }
  assert.ok(Math.abs(simulation.deployedLength - 0.41) < 1e-10);
  const paidOut = simulation.deployedLength;
  simulation.dragTo({ x: 0.05, y: 0.57 }, 2200);
  advance(simulation, 1);
  assert.equal(simulation.deployedLength, paidOut);
  assert.ok(Math.hypot(simulation.end.x, simulation.end.y - CORD.anchor.y) < 0.15);
  assertLengths(simulation);
});

test('slow payout follows demand instead of immediately releasing the full allowance', () => {
  const simulation = new CordSimulation();
  simulation.beginDrag(0);
  for (let i = 1; i <= 240; i++) {
    const demand = CORD.length + 0.04 * i / 240;
    simulation.dragTo({ x: 0, y: CORD.anchor.y - demand }, i * CORD.timestep * 1000);
    simulation.advance(CORD.timestep);
    assert.ok(Math.abs(simulation.deployedLength - demand) < 1e-10);
    assertLengths(simulation);
  }
});

test('ceiling splits and merges preserve lower particles and avoid bulb jumps', () => {
  const simulation = new CordSimulation();
  simulation.beginDrag(0);
  simulation.dragTo({ x: 0.43, y: 0.45 }, 100);
  const lower = simulation.points.slice(-8);
  let splits = 0, merges = 0;
  const step = () => {
    const count = simulation.segmentCount, end = { ...simulation.end };
    simulation.advance(CORD.timestep);
    simulation.points.slice(-8).forEach((particle, i) => assert.equal(particle, lower[i]));
    assertLengths(simulation);
    if (count !== simulation.segmentCount) {
      assert.ok(Math.hypot(simulation.end.x - end.x, simulation.end.y - end.y) < 0.006, 'No topology-induced bulb snap');
      if (count < simulation.segmentCount) splits++; else merges++;
    }
  };
  for (let i = 0; i < 120; i++) step();
  simulation.release(2000);
  for (let i = 0; i < 600; i++) step();
  assert.ok(splits > 0);
  assert.equal(merges, splits);
  assert.equal(simulation.segmentCount, CORD.segments);
});

test('release retracts at a constant rate while swinging, then settles at the original length', () => {
  const simulation = extended();
  simulation.release(2000);
  let crossed = false;
  for (let i = 0; i < 1200; i++) {
    const before = simulation.deployedLength;
    simulation.advance(CORD.timestep);
    const expected = Math.max(CORD.length, before - CORD.retractSpeed * CORD.timestep);
    assert.ok(Math.abs(simulation.deployedLength - expected) < 1e-10);
    if (simulation.deployedLength > CORD.length) assert.equal(simulation.awake, true);
    crossed ||= simulation.end.x < -0.01;
    assertLengths(simulation);
  }
  assert.ok(crossed);
  assert.equal(simulation.deployedLength, CORD.length);
  assert.equal(simulation.awake, false);
  assert.ok(Math.abs(simulation.end.x) < CORD.sleepOffset);
});

test('re-grabbing stops retraction; repeated changes, reset, and reduced motion stay bounded', () => {
  const simulation = extended();
  simulation.release(2000);
  advance(simulation, 1);
  const length = simulation.deployedLength;
  simulation.beginDrag(3000);
  simulation.dragTo({ x: 0.05, y: 0.5 }, 3010);
  advance(simulation, 0.5);
  assert.equal(simulation.deployedLength, length);
  for (let i = 0; i < 480; i++) {
    simulation.dragTo({ x: Math.sin(i / 25) * 0.45, y: 0.35 + Math.cos(i / 30) * 0.15 }, 3500 + i * CORD.timestep * 1000);
    simulation.advance(CORD.timestep);
    assertLengths(simulation);
  }
  simulation.release(8000, false);
  assert.equal(simulation.deployedLength, CORD.length);
  assert.equal(simulation.segmentCount, CORD.segments);
  assert.equal(simulation.awake, false);
  simulation.beginDrag(9000);
  simulation.dragTo({ x: 1, y: 0.2 }, 9100);
  advance(simulation, 1);
  simulation.reset();
  assert.equal(simulation.deployedLength, CORD.length);
  assert.equal(simulation.segmentCount, CORD.segments);
});

test('payout and retraction use fixed time and do not catch up an entire background pause', () => {
  const a = extended(), b = extended();
  a.release(2000); b.release(2000);
  for (let i = 0; i < 240; i++) a.advance(1 / 60);
  for (let i = 0; i < 480; i++) b.advance(1 / 120);
  assert.ok(Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) < 1e-8);
  const c = extended(); c.release(2000); c.pause();
  const length = c.deployedLength;
  c.advance(60);
  assert.ok(length - c.deployedLength <= CORD.retractSpeed * CORD.timestep * CORD.maxSubsteps + 1e-10);
});

test('a held extended cord settles without persistent snaking', () => {
  const simulation = extended();
  advance(simulation, 2);
  const points = simulation.points.map(({ x, y }) => ({ x, y }));
  advance(simulation, 1);
  assert.ok(Math.max(...simulation.points.map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))) < 0.001);
  // A taut sideways cord must not fold back over itself.
  for (let i = 1; i < simulation.points.length; i++) assert.ok(simulation.points[i].x >= simulation.points[i - 1].x);
});
