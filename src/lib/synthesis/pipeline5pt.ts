import type { Point, Line, Circle } from "../geometry/math";
import {
  distance,
  signedArea,
  perpendicularBisector,
  intersectCircles,
  intersectLines,
  intersectLineCircle,
  circumcenter,
  rotateLine,
} from "../geometry/math";

import type { SynthesisResult } from "./pipeline";
import {
  classifyGrashof,
  canInputFullyRotate,
  type LinkSet,
} from "./pipeline";

// ── 5-point roles ────────────────────────────────────────────────────────────

export interface Roles5pt {
  /** Reduction pair 1 indices */
  pair1: [number, number];
  /** Reduction pair 2 indices */
  pair2: [number, number];
  /** Reference (unpaired) point index */
  ref: number;
  /** All 5 indices in order */
  all: number[];
}

export function deriveRoles5pt(
  pair1: [number, number],
  pair2: [number, number]
): Roles5pt {
  const used = new Set([...pair1, ...pair2]);
  const ref = [0, 1, 2, 3, 4].find((x) => !used.has(x))!;
  return { pair1, pair2, ref, all: [0, 1, 2, 3, 4] };
}

// ── Main 5-point synthesis ───────────────────────────────────────────────────

export const runSynthesis5pt = (
  pts: Point[],
  r: number,
  alpha: number,
  pair1: [number, number],
  pair2: [number, number],
  swapA1: boolean,
  swapA3: boolean,
  swapA4: boolean,
  swapA5: boolean
): SynthesisResult => {
  const C = pts; // 5 precision points
  const roles = deriveRoles5pt(pair1, pair2);
  const [p1a, p1b] = pair1;
  const [p2a, p2b] = pair2;

  // ── Step 1–2: Bisectors for both reduction pairs ───────────────────────
  const bisectorCij = perpendicularBisector(C[p1a], C[p1b]);
  const bisectorCkl = perpendicularBisector(C[p2a], C[p2b]);

  // ── Step 3: H_R = intersection of both bisectors ──────────────────────
  const HR = intersectLines(bisectorCij, bisectorCkl);
  if (!HR) {
    return {
      status: "error",
      stage: "HR",
      error: `Bisectors of C${p1a}C${p1b} and C${p2a}C${p2b} are parallel — choose different pairs.`,
      pointMode: 5,
      bisectorCij,
      bisectorCkl,
    };
  }

  // ── Steps 4–8: Overlay technique to find a₂₃, c₁′, c₂′ ──────────────
  //
  // The overlay aligns c₁₅ with c₂₃. When that happens:
  //   c₁′ carries its signed angular offset from c₁₅ into the c₂₃ frame.
  //   c₂′ is H_R→C[p2a], with its signed offset from c₂₃.
  //
  // Using SIGNED offsets handles both same-handedness and opposite-handedness
  // cases correctly (Issue 3 from the review).

  // Directions from H_R to each precision point
  const angle_p1a = Math.atan2(C[p1a].y - HR.y, C[p1a].x - HR.x);
  const angle_p2a = Math.atan2(C[p2a].y - HR.y, C[p2a].x - HR.x);

  // Bisector directions
  const bisAngle_ij = Math.atan2(bisectorCij.dir.y, bisectorCij.dir.x);
  const bisAngle_kl = Math.atan2(bisectorCkl.dir.y, bisectorCkl.dir.x);

  // Signed angular offset: from bisector c₁₅ to H_R→C[p1a]
  // This is the "position" of c₁′ relative to c₁₅ on the overlay tracing paper
  const signedOffset1 = angle_p1a - bisAngle_ij;

  // Signed angular offset: from bisector c₂₃ to H_R→C[p2a]
  // This is where c₂′ sits relative to c₂₃ on the base sheet
  const signedOffset2 = angle_p2a - bisAngle_kl;

  // a₂₃: overlay aligns c₁₅ with c₂₃, then rotated by free angle α
  const a23_base: Line = { p: HR, dir: bisectorCkl.dir };
  const a23 = rotateLine(a23_base, HR, alpha);
  const a23_angle = Math.atan2(a23.dir.y, a23.dir.x);

  // c₁′ = a₂₃ + signedOffset1 (carried from overlay)
  // c₂′ = a₂₃ + signedOffset2 (from base sheet)
  const c1_angle = a23_angle + signedOffset1;
  const c2_angle = a23_angle + signedOffset2;

  const c1Line: Line = {
    p: HR,
    dir: { x: Math.cos(c1_angle), y: Math.sin(c1_angle) },
  };
  const c2Line: Line = {
    p: HR,
    dir: { x: Math.cos(c2_angle), y: Math.sin(c2_angle) },
  };

  // ── Step 9: A₁ on c₁′ at distance r from C[p1a] ─────────────────────
  const a1Cands = intersectLineCircle(c1Line, { center: C[p1a], radius: r });
  if (a1Cands.length === 0) {
    return {
      status: "error",
      stage: "A1",
      error: `r-arc from C${p1a} does not reach line c₁′. Adjust r or α.`,
      pointMode: 5,
      HR,
      bisectorCij,
      bisectorCkl,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }
  const A1 = a1Cands.length === 1 ? a1Cands[0] : a1Cands[swapA1 ? 1 : 0];

  // ── Step 10: A₂ on c₂′ at distance r from C[p2a], orientation-matched ─
  const a2Cands = intersectLineCircle(c2Line, { center: C[p2a], radius: r });
  if (a2Cands.length === 0) {
    return {
      status: "error",
      stage: "A2",
      error: `r-arc from C${p2a} does not reach line c₂′. Adjust r or α.`,
      pointMode: 5,
      HR,
      bisectorCij,
      bisectorCkl,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }

  // A₂ orientation: use coupler-local vector rotation criterion (rigorous).
  // sign[(A₁−C₁) × (A₂−C₂)] must represent a proper rotation (not reflection).
  // The reference sign is derived from pair1: sign[(A₁−C₁) × (A₅−C₅)] where
  // A₅ = rotation of A₁ about H_R by φ₁₅ — but we don't have A₅ yet.
  // Instead, compute the cross product of the coupler-local vectors for both
  // A₂ candidates and pick the one that gives the same sign as the reference.
  //
  // Reference direction: the vector (A₁ − C[p1a]) rotated by any finite angle
  // keeps the same cross-product sign with itself → we use the sign of the
  // cross product (A₁−C₁) × (A₂−C₂). Both candidates give opposite signs;
  // the "correct" one is the one producing a proper (non-reflective) motion.
  //
  // For the default, we pick using the signedArea(C, A, HR) heuristic and
  // keep targetSignA for the remaining A positions (which also use this heuristic).
  // The user can flip the A1 branch toggle to explore the other family.
  const targetSignA = Math.sign(signedArea(C[p1a], A1, HR));
  let A2: Point;
  if (a2Cands.length === 1) {
    A2 = a2Cands[0];
  } else {
    // Coupler-local vectors
    const v1x = A1.x - C[p1a].x;
    const v1y = A1.y - C[p1a].y;
    const v2a_x = a2Cands[0].x - C[p2a].x;
    const v2a_y = a2Cands[0].y - C[p2a].y;
    // 2D cross product: (A₁−C₁) × (A₂−C₂)
    const cross_a = v1x * v2a_y - v1y * v2a_x;
    // Pick the candidate whose cross product sign matches targetSignA
    // (consistent handedness with the A1/HR relationship)
    A2 = Math.sign(cross_a) === targetSignA ? a2Cands[0] : a2Cands[1];
  }

  // ── Step 11–12: Bisector a₁₂, then H_C = a₁₂ ∩ a₂₃ ──────────────────
  const bisectorAij = perpendicularBisector(A1, A2);
  const HC = intersectLines(bisectorAij, a23);
  if (!HC) {
    return {
      status: "error",
      stage: "HC",
      error: "Bisector a₁₂ is parallel to a₂₃ — adjust r or α.",
      pointMode: 5,
      HR,
      bisectorCij,
      bisectorCkl,
      bisectorAij,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }

  // ── Step 13: Crank circle ─────────────────────────────────────────────
  const crankLen = distance(HC, A1);
  const crankCircle: Circle = { center: HC, radius: crankLen };

  // ── Step 14: Remaining A positions via crank circle intersection ─────
  // Just like 4-point: each remaining point uses arc(Ck, r) ∩ crankCircle,
  // default orientation matches A1, and branch toggles flip the choice.
  const A: Point[] = new Array(5);
  A[p1a] = A1;
  A[p2a] = A2;

  const remainingIndices = [0, 1, 2, 3, 4].filter(
    (x) => x !== p1a && x !== p2a
  );
  const swaps = [swapA3, swapA4, swapA5];

  for (let idx = 0; idx < remainingIndices.length; idx++) {
    const k = remainingIndices[idx];
    const akCands = intersectCircles(
      { center: C[k], radius: r },
      crankCircle
    );
    if (akCands.length === 0) {
      return {
        status: "error",
        stage: `A${k}`,
        error: `r-arc from C${k} does not reach crank circle. Adjust r or α.`,
        pointMode: 5,
        HR,
        HC,
        A,
        bisectorCij,
        bisectorCkl,
        bisectorAij,
        crankCircle,
        overlayLines: { a23, c1: c1Line, c2: c2Line },
      };
    }
    if (akCands.length === 1) {
      A[k] = akCands[0];
    } else {
      // Default: orientation-matched to A1
      const s0 = Math.sign(signedArea(C[k], akCands[0], HR));
      const matchIdx = s0 === targetSignA ? 0 : 1;
      A[k] = akCands[swaps[idx] ? 1 - matchIdx : matchIdx];
    }
  }

  // ── Steps 15–16: Kinematic inversion for B₁ ──────────────────────────
  // Combined point [p2a, p2b]: △C[p2a] A[p2a] H_R ≅ △C[p1a] A[p1a] · [2,3]
  const invCands23 = intersectCircles(
    { center: C[p1a], radius: distance(C[p2a], HR) },
    { center: A[p1a], radius: distance(A[p2a], HR) }
  );
  if (invCands23.length === 0) {
    return {
      status: "error",
      stage: "Inv23",
      error: `Cannot find combined inversion point [${p2a},${p2b}]. Adjust parameters.`,
      pointMode: 5,
      HR,
      HC,
      A,
      bisectorCij,
      bisectorCkl,
      bisectorAij,
      crankCircle,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }

  // orientation matching for combined point [2,3]
  const refSign23 = Math.sign(signedArea(C[p2a], A[p2a], HR));
  let combinedPt: Point;
  if (invCands23.length === 1) {
    combinedPt = invCands23[0];
  } else {
    const s0 = Math.sign(signedArea(C[p1a], A[p1a], invCands23[0]));
    combinedPt = s0 === refSign23 ? invCands23[0] : invCands23[1];
  }

  // Point ref (e.g., point 4): △C[ref] A[ref] H_R ≅ △C[p1a] A[p1a] · refPt
  const refIdx = roles.ref;
  const invCandsRef = intersectCircles(
    { center: C[p1a], radius: distance(C[refIdx], HR) },
    { center: A[p1a], radius: distance(A[refIdx], HR) }
  );
  if (invCandsRef.length === 0) {
    return {
      status: "error",
      stage: "InvRef",
      error: `Cannot find inversion point for C${refIdx}. Adjust parameters.`,
      pointMode: 5,
      HR,
      HC,
      A,
      bisectorCij,
      bisectorCkl,
      bisectorAij,
      crankCircle,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }

  const refSignRef = Math.sign(signedArea(C[refIdx], A[refIdx], HR));
  let refPt: Point;
  if (invCandsRef.length === 1) {
    refPt = invCandsRef[0];
  } else {
    const s0 = Math.sign(signedArea(C[p1a], A[p1a], invCandsRef[0]));
    refPt = s0 === refSignRef ? invCandsRef[0] : invCandsRef[1];
  }

  // ── Step 17: B₁ = circumcenter({H_R, combinedPt, refPt}) ─────────────
  const Bi = circumcenter(HR, combinedPt, refPt);
  if (!Bi) {
    return {
      status: "error",
      stage: "B1",
      error: "H_R, [2,3], and reference point are collinear — B₁ at infinity. Adjust r or α.",
      pointMode: 5,
      HR,
      HC,
      A,
      Pm: combinedPt,
      Pn: refPt,
      bisectorCij,
      bisectorCkl,
      bisectorAij,
      crankCircle,
      overlayLines: { a23, c1: c1Line, c2: c2Line },
    };
  }

  // ── Steps 18–19: Phase C — B positions for all 5 ─────────────────────
  const couplerLen = distance(A[p1a], Bi);
  const BC_ref = distance(C[p1a], Bi);
  const targetSign_B = Math.sign(signedArea(A[p1a], C[p1a], Bi));

  const B: Point[] = new Array(5);
  B[p1a] = Bi;

  const otherIndices = [0, 1, 2, 3, 4].filter((x) => x !== p1a);
  for (const k of otherIndices) {
    const bkCands = intersectCircles(
      { center: A[k], radius: couplerLen },
      { center: C[k], radius: BC_ref }
    );
    if (bkCands.length === 0) {
      return {
        status: "error",
        stage: "Bk",
        error: `Cannot find B${k} — arcs do not intersect.`,
        pointMode: 5,
        HR,
        HC,
        A,
        B1: Bi,
        B,
        Pm: combinedPt,
        Pn: refPt,
        bisectorCij,
        bisectorCkl,
        bisectorAij,
        crankCircle,
        overlayLines: { a23, c1: c1Line, c2: c2Line },
      };
    }
    let Bk: Point;
    if (bkCands.length === 1) {
      Bk = bkCands[0];
    } else {
      const s0 = Math.sign(signedArea(A[k], C[k], bkCands[0]));
      Bk = s0 === targetSign_B ? bkCands[0] : bkCands[1];
    }
    B[k] = Bk;
  }

  // ── Link lengths & classification ─────────────────────────────────────
  const ground = distance(HC, HR);
  const crank = crankLen;
  const coupler = couplerLen;
  const follower = distance(HR, Bi);

  const links: LinkSet = { ground, crank, coupler, follower };
  const grashofResult = classifyGrashof(links);
  const canFull = canInputFullyRotate(links);

  const followerIsDriver = grashofResult.type === "Rocker-Crank";

  const Ai = A[p1a];
  const startAngle = followerIsDriver
    ? Math.atan2(Bi.y - HR.y, Bi.x - HR.x)
    : Math.atan2(Ai.y - HC.y, Ai.x - HC.x);

  const crossRef =
    (Bi.x - Ai.x) * (HR.y - Ai.y) - (Bi.y - Ai.y) * (HR.x - Ai.x);

  return {
    status: "success",
    pointMode: 5,
    HR,
    HC,
    A,
    B1: Bi,
    B,
    Pm: combinedPt,
    Pn: refPt,
    bisectorCij,
    bisectorCkl,
    bisectorAij,
    crankCircle,
    overlayLines: { a23, c1: c1Line, c2: c2Line },
    lengths: { ground, crank, coupler, follower },
    couplerTriangle: {
      AB: coupler,
      AC: r,
      BC: BC_ref,
    },
    grashof: grashofResult.type,
    grashofDetail: grashofResult,
    grashofValues: {
      sPlusL: grashofResult.sPlusL,
      pPlusQ: grashofResult.pPlusQ,
    },
    canFullRotate: canFull || followerIsDriver,
    followerIsDriver,
    startAngle,
    crossRef,
  };
};
