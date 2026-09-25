import { CORD } from './config.ts';

export interface Point { x: number; y: number }
interface Particle extends Point { px: number; py: number; weight: number }

/** A small 2D XPBD rope: compliant segment constraints plus a hard stretch cap. */
export class CordSimulation {
  readonly points: Particle[] = [];
  awake = false;
  dragging = false;
  private target: Point | null = null;
  private dragVelocity: Point = { x: 0, y: 0 };
  private lastDragTime = 0;
  private accumulator = 0;
  private quietTime = 0;
  private payout = 0;
  private readonly segmentLength = CORD.length / CORD.segments;
  readonly maxSegments = CORD.segments + Math.ceil(CORD.extraLength / (CORD.length / CORD.segments));
  constructor() { this.reset(); }

  get deployedLength() { return CORD.length + this.payout; }
  get maxLength() { return this.deployedLength * (1 + CORD.maxStretch); }
  get segmentCount() { return this.points.length - 1; }

  /** Only the ceiling segment changes length. All lower segments retain their original spacing. */
  segmentRestLength(index: number) {
    return index === 0
      ? this.segmentLength + this.payout - (this.segmentCount - CORD.segments) * this.segmentLength
      : this.segmentLength;
  }

  get end(): Point { return this.points[this.points.length - 1]; }
  get angle(): number {
    const a = this.points[this.points.length - 2];
    return Math.atan2(this.end.x - a.x, a.y - this.end.y);
  }

  reset() {
    this.points.length = 0;
    for (let i = 0; i <= CORD.segments; i++) {
      const x = CORD.anchor.x;
      const y = CORD.anchor.y - CORD.length * i / CORD.segments;
      this.points.push({ x, y, px: x, py: y, weight: i === 0 ? 0 : 1 / (i === CORD.segments ? CORD.bulbMass : CORD.cordMass) });
    }
    this.target = null;
    this.dragging = this.awake = false;
    this.accumulator = this.quietTime = 0;
    this.payout = 0;
    this.dragVelocity = { x: 0, y: 0 };
  }

  private bounded(point: Point, maximum = this.maxLength): Point {
    const dx = point.x - CORD.anchor.x;
    const dy = Math.min(point.y, CORD.anchor.y - 0.01) - CORD.anchor.y;
    const scale = Math.min(1, maximum / Math.hypot(dx, dy));
    return { x: CORD.anchor.x + dx * scale, y: CORD.anchor.y + dy * scale };
  }

  beginDrag(time: number) {
    this.target = { ...this.end };
    this.lastDragTime = time;
    this.dragVelocity = { x: 0, y: 0 };
    this.dragging = this.awake = true;
    this.quietTime = this.accumulator = 0;
  }

  dragTo(point: Point, time: number) {
    if (!this.dragging) return;
    // Remember demand beyond the currently deployed length so holding the pointer
    // still can continue feeding cord. The solver uses the current-length bound.
    const next = this.bounded(point, (CORD.length + CORD.extraLength) * (1 + CORD.maxStretch));
    const dt = Math.max(1 / 240, (time - this.lastDragTime) / 1000);
    const last = this.target ?? this.end;
    const vx = (next.x - last.x) / dt;
    const vy = (next.y - last.y) / dt;
    const scale = Math.min(1, CORD.maxReleaseSpeed / Math.max(0.0001, Math.hypot(vx, vy)));
    this.dragVelocity = { x: vx * scale, y: vy * scale };
    this.target = next;
    this.lastDragTime = time;
    this.awake = true;
  }

  release(time: number, animate = true) {
    if (!this.dragging) return;
    if (!animate) { this.reset(); return; }
    this.dragging = false;
    this.target = null;
    const end = this.points[this.points.length - 1];
    const velocity = time - this.lastDragTime > 100 ? { x: 0, y: 0 } : this.dragVelocity;
    end.px = end.x - velocity.x * CORD.timestep;
    end.py = end.y - velocity.y * CORD.timestep;
    this.awake = true;
  }

  /** Drop elapsed background time instead of integrating a huge jump on return. */
  pause() { this.accumulator = 0; }

  advance(elapsed: number) {
    if (!this.awake) return false;
    this.accumulator += Math.min(Math.max(0, elapsed), CORD.timestep * CORD.maxSubsteps);
    let steps = 0;
    while (this.accumulator >= CORD.timestep && steps++ < CORD.maxSubsteps) {
      this.step();
      this.accumulator -= CORD.timestep;
    }
    return this.awake;
  }

  private updatePayout(dt: number) {
    const demand = this.target
      ? Math.min(CORD.extraLength, Math.max(0, Math.hypot(this.target.x - CORD.anchor.x, this.target.y - CORD.anchor.y) - CORD.length))
      : 0;
    const next = this.target
      ? Math.min(CORD.extraLength, this.payout + Math.min(CORD.payoutSpeed * dt, Math.max(0, demand - this.payout)))
      : Math.max(0, this.payout - CORD.retractSpeed * dt);
    const addedSegments = Math.floor(next / this.segmentLength);

    // Keep the leading rest length between one and two normal segments, avoiding
    // tiny/zero-length constraints. Split/merge only at the fixed ceiling end.
    while (this.segmentCount < CORD.segments + addedSegments) {
      const a = this.points[0], b = this.points[1];
      const leadingLength = this.segmentLength + next - (this.segmentCount - CORD.segments) * this.segmentLength;
      const t = (leadingLength - this.segmentLength) / leadingLength;
      this.points.splice(1, 0, {
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        px: a.px + (b.px - a.px) * t, py: a.py + (b.py - a.py) * t,
        weight: 1 / CORD.cordMass,
      });
    }
    // The surviving particles retain both current and previous positions, so
    // joining the top two segments does not assign an artificial release velocity.
    while (this.segmentCount > CORD.segments + addedSegments) this.points.splice(1, 1);
    this.payout = next;
  }

  private step() {
    const dt = CORD.timestep;
    this.updatePayout(dt);
    const damping = Math.exp(-CORD.damping * dt);
    const endIndex = this.points.length - 1;
    for (let i = 1; i <= endIndex; i++) {
      const p = this.points[i];
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy - CORD.gravity * dt * dt;
    }
    const lambda = new Float64Array(endIndex);
    const alpha = CORD.compliance / (dt * dt);
    const target = this.target ? this.bounded(this.target) : null;
    for (let iteration = 0; iteration < CORD.iterations; iteration++) {
      if (target) Object.assign(this.points[endIndex], target);
      for (let i = 0; i < endIndex; i++) {
        const a = this.points[i], b = this.points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.max(1e-8, Math.hypot(dx, dy));
        const wa = a.weight;
        const wb = this.target && i + 1 === endIndex ? 0 : b.weight;
        const correction = (-(length - this.segmentRestLength(i)) - alpha * lambda[i]) / (wa + wb + alpha);
        lambda[i] += correction;
        a.x -= wa * correction * dx / length; a.y -= wa * correction * dy / length;
        b.x += wb * correction * dx / length; b.y += wb * correction * dy / length;
      }
    }
    // Forward projection enforces the absolute length cap even after an extreme drag.
    for (let i = 1; i <= endIndex; i++) {
      const a = this.points[i - 1], b = this.points[i];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const max = this.segmentRestLength(i - 1) * (1 + CORD.maxStretch);
      if (length > max) { b.x = a.x + dx / length * max; b.y = a.y + dy / length * max; }
    }
    if (this.dragging) return;
    let speed = 0;
    for (const p of this.points) speed = Math.max(speed, Math.hypot(p.x - p.px, p.y - p.py) / dt);
    this.quietTime = this.payout === 0 && speed < CORD.sleepSpeed && Math.abs(this.end.x - CORD.anchor.x) < CORD.sleepOffset ? this.quietTime + dt : 0;
    if (this.quietTime >= CORD.sleepDelay) {
      this.awake = false;
      this.points.forEach((p) => { p.px = p.x; p.py = p.y; });
    }
  }
}
