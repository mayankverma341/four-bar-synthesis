import type { Point } from "../geometry/math";
import {
  distance,
  subtract,
  intersectCircles,
  cross2D,
  normalizeAngle,
  normalizeAngle2PI,
  EPSILON,
} from "../geometry/math";

export interface KinematicPose {
  A: Point;
  B: Point;
  C: Point;
}

export interface RockerLimits {
  canFullRotate: boolean;
  thetaCenter: number;
  halfSpan: number;
  lo: number;
  hi: number;
}

// ─── Rigid body transform ────────────────────────────────────────────────────

function rigidTransformPoint(
  A1: Point, B1: Point, C1: Point,
  A: Point, B: Point
): Point {
  const refAB  = subtract(B1, A1);
  const refLen = Math.hypot(refAB.x, refAB.y);
  if (refLen < EPSILON) return { ...A };

  const ex = { x: refAB.x / refLen, y: refAB.y / refLen };
  const ey = { x: -ex.y, y: ex.x };
  const refAC = subtract(C1, A1);
  const lx = refAC.x * ex.x + refAC.y * ex.y;
  const ly = refAC.x * ey.x + refAC.y * ey.y;

  const newAB  = subtract(B, A);
  const newLen = Math.hypot(newAB.x, newAB.y);
  if (newLen < EPSILON) return { ...A };

  const nex = { x: newAB.x / newLen, y: newAB.y / newLen };
  const ney = { x: -nex.y, y: nex.x };

  return {
    x: A.x + lx * nex.x + ly * ney.x,
    y: A.y + lx * nex.y + ly * ney.y,
  };
}

// ─── Position solver (drive from HC) ─────────────────────────────────────────

export function solvePosition(
  HC: Point, HR: Point,
  crankLen: number, couplerLen: number, followerLen: number,
  A1: Point, B1: Point, C1: Point,
  theta: number,
  branch: 1 | -1
): KinematicPose | null {
  const A: Point = {
    x: HC.x + crankLen * Math.cos(theta),
    y: HC.y + crankLen * Math.sin(theta),
  };

  const cands = intersectCircles(
    { center: A,  radius: couplerLen  },
    { center: HR, radius: followerLen }
  );
  if (cands.length === 0) return null;

  let B: Point;
  if (cands.length === 1) {
    B = cands[0];
  } else {
    const refCross = cross2D(subtract(B1, A1), subtract(HR, A1));
    const c0Cross  = cross2D(subtract(cands[0], A), subtract(HR, A));
    const same     = Math.sign(c0Cross) === Math.sign(refCross);
    B = (branch === 1 ? same : !same) ? cands[0] : cands[1];
  }

  return { A, B, C: rigidTransformPoint(A1, B1, C1, A, B) };
}

// ─── Position solver (drive from HR — Rocker-Crank) ─────────────────────────

export function solvePositionInverse(
  HC: Point, HR: Point,
  crankLen: number, couplerLen: number, followerLen: number,
  A1: Point, B1: Point, C1: Point,
  phi: number,          // follower angle measured at HR
  branch: 1 | -1
): KinematicPose | null {
  // B is fixed on the follower circle
  const B: Point = {
    x: HR.x + followerLen * Math.cos(phi),
    y: HR.y + followerLen * Math.sin(phi),
  };

  // A must lie on both the crank circle (HC, crankLen) and
  // the coupler circle (B, couplerLen)
  const cands = intersectCircles(
    { center: HC, radius: crankLen   },
    { center: B,  radius: couplerLen }
  );
  if (cands.length === 0) return null;

  let A: Point;
  if (cands.length === 1) {
    A = cands[0];
  } else {
    // Use the same signed-area branch convention but referenced to the
    // follower side: compare (A1, B1) orientation vs (cand, B) orientation.
    const refCross = cross2D(subtract(A1, B1), subtract(HC, B1));
    const c0Cross  = cross2D(subtract(cands[0], B), subtract(HC, B));
    const same     = Math.sign(c0Cross) === Math.sign(refCross);
    A = (branch === 1 ? same : !same) ? cands[0] : cands[1];
  }

  return { A, B, C: rigidTransformPoint(A1, B1, C1, A, B) };
}

// ─── Branch detection ────────────────────────────────────────────────────────

export function detectBranch(
  HC: Point, HR: Point,
  crankLen: number, couplerLen: number, followerLen: number,
  A1: Point, B1: Point, C1: Point,
  followerIsDriver = false
): 1 | -1 {
  if (followerIsDriver) {
    // Seed angle: phi of B1 from HR
    const phi = Math.atan2(B1.y - HR.y, B1.x - HR.x);
    const tol = Math.max(crankLen * 0.01, 0.1);
    for (const b of [1, -1] as const) {
      const pose = solvePositionInverse(
        HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, phi, b
      );
      if (pose && distance(pose.A, A1) < tol) return b;
    }
    const p1 = solvePositionInverse(HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, phi, 1);
    const p2 = solvePositionInverse(HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, phi, -1);
    if (!p1) return -1;
    if (!p2) return 1;
    return distance(p1.A, A1) <= distance(p2.A, A1) ? 1 : -1;
  }

  // Original: drive from HC
  const theta = Math.atan2(A1.y - HC.y, A1.x - HC.x);
  const tol   = Math.max(followerLen * 0.01, 0.1);
  for (const b of [1, -1] as const) {
    const pose = solvePosition(
      HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, theta, b
    );
    if (pose && distance(pose.B, B1) < tol) return b;
  }
  const p1 = solvePosition(HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, theta, 1);
  const p2 = solvePosition(HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, theta, -1);
  if (!p1) return -1;
  if (!p2) return 1;
  return distance(p1.B, B1) <= distance(p2.B, B1) ? 1 : -1;
}

// ─── Ghost pose solver ───────────────────────────────────────────────────────

export function solveGhostPose(
  HC: Point, HR: Point,
  crankLen: number, couplerLen: number, followerLen: number,
  A1: Point, B1: Point, C1: Point,
  Ai: Point, Ci: Point,
  followerIsDriver = false
): KinematicPose | null {
  if (followerIsDriver) {
    // For ghost poses in Rocker-Crank we know Ai (the crank pin position).
    // Back-solve: find phi such that solvePositionInverse recovers Ai.
    // Equivalently, Bi lies on follower circle at HR, and coupler connects
    // Ai to Bi.  Bi = intersect(follower-circle, circle(Ai, couplerLen)).
    const biCands = intersectCircles(
      { center: HR, radius: followerLen },
      { center: Ai, radius: couplerLen  }
    );
    if (biCands.length === 0) return null;
    // Pick the Bi that best reproduces the known Ai and Ci positions
    let bestPose: KinematicPose | null = null;
    let bestDist = Infinity;
    for (const Bi of biCands) {
      const phi  = Math.atan2(Bi.y - HR.y, Bi.x - HR.x);
      for (const b of [1, -1] as const) {
        const pose = solvePositionInverse(
          HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, phi, b
        );
        if (!pose) continue;
        const d = distance(pose.A, Ai) + distance(pose.C, Ci);
        if (d < bestDist) { bestDist = d; bestPose = pose; }
      }
    }
    return bestPose;
  }

  // Original: drive from HC
  const theta = Math.atan2(Ai.y - HC.y, Ai.x - HC.x);
  let bestPose: KinematicPose | null = null;
  let bestDist = Infinity;
  for (const b of [1, -1] as const) {
    const pose = solvePosition(
      HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, theta, b
    );
    if (!pose) continue;
    const d = distance(pose.C, Ci);
    if (d < bestDist) { bestDist = d; bestPose = pose; }
  }
  return bestPose;
}

// ─── Rocker limits (HC-driven, numerical scan) ────────────────────────────────

const SCAN_STEPS = 720;

export function computeRockerLimits(
  HC: Point, HR: Point,
  ground: number, crank: number,
  coupler: number, follower: number,
  canFullRotate: boolean,
  startAngle?: number
): RockerLimits {
  const TWO_PI = 2 * Math.PI;
  const ref = startAngle ?? Math.atan2(HR.y - HC.y, HR.x - HC.x);

  const noMotion = (): RockerLimits => ({
    canFullRotate: false,
    thetaCenter: ref, halfSpan: 0, lo: ref, hi: ref,
  });

  if (crank < EPSILON || ground < EPSILON) return noMotion();

  if (canFullRotate) {
    return {
      canFullRotate: true,
      thetaCenter: ref, halfSpan: Math.PI,
      lo: ref - Math.PI, hi: ref + Math.PI,
    };
  }

  const assemblesAt = (theta: number): boolean => {
    const Ax = HC.x + crank * Math.cos(theta);
    const Ay = HC.y + crank * Math.sin(theta);
    const d  = Math.hypot(Ax - HR.x, Ay - HR.y);
    return d <= coupler + follower + EPSILON &&
           d >= Math.abs(coupler - follower) - EPSILON;
  };

  if (!assemblesAt(ref)) {
    const step = TWO_PI / SCAN_STEPS;
    for (let i = 1; i <= SCAN_STEPS / 2; i++) {
      if (assemblesAt(ref + i * step)) {
        return computeRockerLimits(
          HC, HR, ground, crank, coupler, follower,
          canFullRotate, ref + i * step
        );
      }
      if (assemblesAt(ref - i * step)) {
        return computeRockerLimits(
          HC, HR, ground, crank, coupler, follower,
          canFullRotate, ref - i * step
        );
      }
    }
    return noMotion();
  }

  const stepSize = TWO_PI / SCAN_STEPS;
  let hiOffset   = 0;
  for (let i = 1; i <= SCAN_STEPS; i++) {
    if (!assemblesAt(ref + i * stepSize)) break;
    hiOffset = i * stepSize;
    if (hiOffset >= Math.PI - stepSize) { hiOffset = Math.PI; break; }
  }

  let loOffset = 0;
  for (let i = 1; i <= SCAN_STEPS; i++) {
    if (!assemblesAt(ref - i * stepSize)) break;
    loOffset = i * stepSize;
    if (loOffset >= Math.PI - stepSize) { loOffset = Math.PI; break; }
  }

  if (hiOffset >= Math.PI - EPSILON && loOffset >= Math.PI - EPSILON) {
    return {
      canFullRotate: true,
      thetaCenter: ref, halfSpan: Math.PI,
      lo: ref - Math.PI, hi: ref + Math.PI,
    };
  }

  const lo          = ref - loOffset;
  const hi          = ref + hiOffset;
  const thetaCenter = (lo + hi) / 2;
  const halfSpan    = (hi - lo) / 2;

  if (halfSpan < EPSILON) return noMotion();

  return { canFullRotate: false, thetaCenter, halfSpan, lo, hi };
}

// ─── Rocker limits (HR-driven, Rocker-Crank) ─────────────────────────────────

/**
 * When the follower is the shortest link (Rocker-Crank), it makes a full
 * 360° rotation when driven from HR.  The limits are trivially a full circle.
 */
export function computeRockerLimitsFollower(
  startAngle?: number
): RockerLimits {
  const ref = startAngle ?? 0;
  return {
    canFullRotate: true,
    thetaCenter:  ref,
    halfSpan:     Math.PI,
    lo:           ref - Math.PI,
    hi:           ref + Math.PI,
  };
}

// ─── Coupler curve ────────────────────────────────────────────────────────────

export function computeCouplerCurve(
  HC: Point, HR: Point,
  crankLen: number, couplerLen: number, followerLen: number,
  A1: Point, B1: Point, C1: Point,
  branch: 1 | -1,
  lim: RockerLimits,
  followerIsDriver: boolean,
  steps = 720
): Point[] {
  const start = lim.canFullRotate ? 0             : lim.lo;
  const end   = lim.canFullRotate ? 2 * Math.PI   : lim.hi;
  const span  = end - start;
  const pts: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const angle = start + (i / steps) * span;
    const pose  = followerIsDriver
      ? solvePositionInverse(
          HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, angle, branch
        )
      : solvePosition(
          HC, HR, crankLen, couplerLen, followerLen, A1, B1, C1, angle, branch
        );
    if (pose) pts.push(pose.C);
  }
  return pts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isAngleInRange(theta: number, lim: RockerLimits): boolean {
  if (lim.canFullRotate) return true;
  const alpha = normalizeAngle(theta - lim.thetaCenter);
  return Math.abs(alpha) <= lim.halfSpan + EPSILON;
}

export function clampToRange(theta: number, lim: RockerLimits): number {
  if (lim.canFullRotate) return theta;
  const alpha = normalizeAngle(theta - lim.thetaCenter);
  if (Math.abs(alpha) <= lim.halfSpan) return theta;
  return alpha > 0 ? lim.hi : lim.lo;
}

// ─── Animation tick ───────────────────────────────────────────────────────────

export function rockerTick(
  currentAngle: number,
  direction: 1 | -1,
  dt: number,
  speedRPM: number,
  lim: RockerLimits
): { angle: number; direction: 1 | -1 } {
  const dTheta = (speedRPM * 2 * Math.PI / 60) * dt;
  const TWO_PI = 2 * Math.PI;

  if (lim.canFullRotate) {
    return {
      angle: normalizeAngle2PI(currentAngle + dTheta * direction),
      direction,
    };
  }

  const { lo, hi, thetaCenter } = lim;

  let diff = currentAngle - thetaCenter;
  diff    -= Math.round(diff / TWO_PI) * TWO_PI;
  let raw  = thetaCenter + diff;

  raw = Math.max(lo, Math.min(hi, raw));

  let next   = raw + dTheta * direction;
  let newDir = direction;

  if (next >= hi) {
    next   = hi;
    newDir = -1;
  } else if (next <= lo) {
    next   = lo;
    newDir =  1;
  }

  return { angle: next, direction: newDir };
}