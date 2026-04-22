import type { Point, Line, Circle } from "../geometry/math";
import {
  distance,
  signedArea,
  perpendicularBisector,
  pointOnLine,
  intersectCircles,
  circumcenter,
  areCoincident,
  distancePointToLine,
  EPSILON,
} from "../geometry/math";

// ── Roles ────────────────────────────────────────────────────────────────────

export interface Roles {
  i: number;      // reduction pair index A (lower)
  j: number;      // reduction pair index B (higher)
  m: number;      // remaining index A (first non-reduction)
  n: number;      // remaining index B (second non-reduction)
  refIdx: number; // reference pose = i always
}

export function deriveRoles(reductionPair: [number, number]): Roles {
  const [i, j] = reductionPair; // already i < j by construction
  const remaining = [0, 1, 2, 3].filter((x) => x !== i && x !== j);
  const [m, n] = remaining; // sorted ascending by filter order
  return { i, j, m, n, refIdx: i };
}

// ── Grashof ──────────────────────────────────────────────────────────────────

export type GrashofType =
  | "Crank-Rocker"
  | "Double-Crank"
  | "Rocker-Crank"
  | "Double-Rocker (Grashof)"
  | "Change-Point"
  | "Double-Rocker (Non-Grashof)";

export interface GrashofResult {
  type: GrashofType;
  grashof: boolean;
  sPlusL: number;
  pPlusQ: number;
  shortest: { name: string; len: number };
  longest: { name: string; len: number };
}

// ── Result type ──────────────────────────────────────────────────────────────

export interface SynthesisResult {
  status: "success" | "error";
  error?: string;
  stage?: string;

  /** 4 or 5 point mode */
  pointMode?: 4 | 5;

  roles?: Roles;

  HR?: Point;
  HC?: Point;
  A?: Point[];
  B1?: Point;
  B?: Point[];
  Pm?: Point;
  Pn?: Point;

  bisectorCij?: Line;
  bisectorAij?: Line;
  rCircle?: Circle;
  crankCircle?: Circle;

  /** 5-point: second bisector c_kl */
  bisectorCkl?: Line;
  /** 5-point: overlay lines for construction visualization */
  overlayLines?: { a23: Line; c1: Line; c2: Line };

  lengths?: {
    ground: number;
    crank: number;
    coupler: number;
    follower: number;
  };

  couplerTriangle?: {
    AB: number;
    AC: number;
    BC: number;
  };

  grashof?: GrashofType;
  grashofDetail?: GrashofResult;
  grashofValues?: { sPlusL: number; pPlusQ: number };

  canFullRotate?: boolean;

  /**
   * True when the follower (HR side) is the shortest link and is therefore
   * the fully-rotating link (Rocker-Crank).  The animator drives phi at HR
   * instead of theta at HC.
   */
  followerIsDriver?: boolean;

  /** Starting angle for animation */
  startAngle?: number;

  /** Cross product at reference pose — used for branch selection */
  crossRef?: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

export interface LinkSet {
  ground: number;
  crank: number;
  coupler: number;
  follower: number;
}

export function classifyGrashof(links: LinkSet): GrashofResult {
  const { ground, crank, coupler, follower } = links;

  const named = [
    { name: "ground" as const, len: ground },
    { name: "crank" as const, len: crank },
    { name: "coupler" as const, len: coupler },
    { name: "follower" as const, len: follower },
  ].sort((a, b) => a.len - b.len);

  const s = named[0];
  const l = named[3];
  const p = named[1];
  const q = named[2];

  const sPlusL = s.len + l.len;
  const pPlusQ = p.len + q.len;
  const shortest = { name: s.name, len: s.len };
  const longest = { name: l.name, len: l.len };

  if (Math.abs(sPlusL - pPlusQ) < EPSILON * 100) {
    return {
      type: "Change-Point",
      grashof: true,
      sPlusL,
      pPlusQ,
      shortest,
      longest,
    };
  }

  if (sPlusL < pPlusQ) {
    let type: GrashofType;
    switch (s.name) {
      case "ground":
        type = "Double-Crank";
        break;
      case "crank":
        type = "Crank-Rocker";
        break;
      case "follower":
        type = "Rocker-Crank";
        break;
      case "coupler":
        type = "Double-Rocker (Grashof)";
        break;
    }
    return { type: type!, grashof: true, sPlusL, pPlusQ, shortest, longest };
  }

  return {
    type: "Double-Rocker (Non-Grashof)",
    grashof: false,
    sPlusL,
    pPlusQ,
    shortest,
    longest,
  };
}

/**
 * Returns true when the link driven from HC (the "crank" in our naming)
 * can make a full 360° rotation.
 *
 * Grashof types where HC-driven link fully rotates:
 *   • Crank-Rocker  – crank is shortest  → HC-link fully rotates ✓
 *   • Double-Crank  – ground is shortest → both links fully rotate ✓
 *
 * Rocker-Crank: follower is shortest → HR-link fully rotates, HC-link rocks.
 *   canInputFullyRotate returns false; followerIsDriver flag handles animation.
 */
export function canInputFullyRotate(links: LinkSet): boolean {
  const { ground, crank, coupler, follower } = links;

  const sorted = [ground, crank, coupler, follower].sort((a, b) => a - b);
  const s = sorted[0];
  const l = sorted[3];
  const p = sorted[1];
  const q = sorted[2];

  if (s + l >= p + q - EPSILON * 100) return false;

  const tol = EPSILON * 100;
  return Math.abs(crank - s) < tol || Math.abs(ground - s) < tol;
}

export function pickByOrientation(
  candidates: Point[],
  refP: Point,
  refQ: Point,
  refS: Point,
  testP: Point,
  testQ: Point,
  swap: boolean
): Point | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const targetSign = Math.sign(signedArea(refP, refQ, refS));
  const idx0Sign = Math.sign(signedArea(testP, testQ, candidates[0]));

  const pick = !swap
    ? idx0Sign === targetSign
      ? 0
      : 1
    : idx0Sign === targetSign
      ? 1
      : 0;

  return candidates[pick];
}

// ── Main synthesis function ──────────────────────────────────────────────────

export const runSynthesis = (
  pts: [Point, Point, Point, Point],
  R: number,
  r: number,
  hrOffset: number,
  hcOffset: number,
  swapAij: boolean,
  swapAm: boolean,
  swapAn: boolean,
  reductionPair: [number, number] = [0, 2]
): SynthesisResult => {
  const C = pts;
  const roles = deriveRoles(reductionPair);
  const { i, j, m, n } = roles;

  // ── Phase A, Step 1: HR on perpendicular bisector of C[i]–C[j] ──────────
  const bisectorCij = perpendicularBisector(C[i], C[j]);
  const HR = pointOnLine(bisectorCij, hrOffset);
  const rCircle: Circle = { center: HR, radius: R };

  // ── Phase A, Step 2–3: A[i] on R-circle ──────────────────────────────────
  const aiCands = intersectCircles({ center: C[i], radius: r }, rCircle);
  if (aiCands.length === 0) {
    return {
      status: "error",
      stage: "Ai",
      error: `r-arc from C${i} does not reach R-circle. Increase r or adjust R/H_R.`,
      roles,
      HR,
      bisectorCij,
      rCircle,
    };
  }

  const Ai = aiCands.length === 1 ? aiCands[0] : aiCands[swapAij ? 1 : 0];

  // ── Phase A, Step 4: A[j] with orientation matching ───────────────────────
  const ajCands = intersectCircles({ center: C[j], radius: r }, rCircle);
  if (ajCands.length === 0) {
    return {
      status: "error",
      stage: "Aj",
      error: `r-arc from C${j} does not reach R-circle. Increase r or adjust R/H_R.`,
      roles,
      HR,
      bisectorCij,
      rCircle,
    };
  }

  const targetSignA = Math.sign(signedArea(C[i], Ai, HR));
  let Aj: Point;
  if (ajCands.length === 1) {
    Aj = ajCands[0];
  } else {
    const s0 = Math.sign(signedArea(C[j], ajCands[0], HR));
    Aj = s0 === targetSignA ? ajCands[0] : ajCands[1];
  }

  // ── Phase A, Step 5: Sanity check — bisector of A[i]–A[j] passes thru HR ─
  const bisectorAij = perpendicularBisector(Ai, Aj);
  const distHRtoAij = distancePointToLine(HR, bisectorAij);
  if (distHRtoAij > 0.5) {
    return {
      status: "error",
      stage: "bisector",
      error: `Sanity check failed: bisector of A${i}–A${j} does not pass through H_R (dist=${distHRtoAij.toFixed(2)}).`,
      roles,
      HR,
      bisectorCij,
      bisectorAij,
      rCircle,
    };
  }

  // ── Phase A, Step 6: HC on perpendicular bisector of A[i]–A[j] ────────────
  const HC = pointOnLine(bisectorAij, hcOffset);
  if (areCoincident(HC, HR)) {
    return {
      status: "error",
      stage: "bisector",
      error: "H_C coincides with H_R. Adjust H_C offset.",
      roles,
      HR,
      HC,
      bisectorCij,
      bisectorAij,
      rCircle,
    };
  }

  const crankLen = distance(HC, Ai);
  const crankCircle: Circle = { center: HC, radius: crankLen };

  // ── Phase A, Step 8: A[m] on crank circle ──────────────────────────────────
  const amCands = intersectCircles({ center: C[m], radius: r }, crankCircle);
  if (amCands.length === 0) {
    const partialA: Point[] = new Array(4);
    partialA[i] = Ai;
    partialA[j] = Aj;
    return {
      status: "error",
      stage: "Am",
      error: `r-arc from C${m} does not reach crank circle. Adjust parameters.`,
      roles,
      HR,
      HC,
      A: partialA,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }
  let Am: Point;
  if (amCands.length === 1) {
    Am = amCands[0];
  } else {
    const s0 = Math.sign(signedArea(C[m], amCands[0], HR));
    const matchIdx = s0 === targetSignA ? 0 : 1;
    Am = amCands[swapAm ? (1 - matchIdx) : matchIdx];
  }

  // ── Phase A, Step 9: A[n] on crank circle ──────────────────────────────────
  const anCands = intersectCircles({ center: C[n], radius: r }, crankCircle);
  if (anCands.length === 0) {
    const partialA: [Point, Point, Point, Point] = [
      undefined!,
      undefined!,
      undefined!,
      undefined!,
    ];
    partialA[i] = Ai;
    partialA[j] = Aj;
    partialA[m] = Am;
    return {
      status: "error",
      stage: "An",
      error: `r-arc from C${n} does not reach crank circle. Adjust parameters.`,
      roles,
      HR,
      HC,
      A: partialA,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }
  let An: Point;
  if (anCands.length === 1) {
    An = anCands[0];
  } else {
    const s0 = Math.sign(signedArea(C[n], anCands[0], HR));
    const matchIdx = s0 === targetSignA ? 0 : 1;
    An = anCands[swapAn ? (1 - matchIdx) : matchIdx];
  }

  // Assemble A array in precision-point order
  const A: Point[] = new Array(4);
  A[i] = Ai;
  A[j] = Aj;
  A[m] = Am;
  A[n] = An;

  // ── Phase B, Step 10: Construct Pm ─────────────────────────────────────────
  // Pm such that △(C[i] A[i] Pm) ≅ △(C[m] A[m] HR) (same orientation)
  const rCm_HR = distance(C[m], HR);
  const rAm_HR = distance(A[m], HR);
  const pmCands = intersectCircles(
    { center: C[i], radius: rCm_HR },
    { center: A[i], radius: rAm_HR }
  );
  if (pmCands.length === 0) {
    return {
      status: "error",
      stage: "Pm",
      error: "Inversion circles for P_m do not intersect.",
      roles,
      HR,
      HC,
      A,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }
  const Pm = pickByOrientation(pmCands, C[m], A[m], HR, C[i], A[i], false);
  if (!Pm) {
    return {
      status: "error",
      stage: "Pm",
      error: "Could not determine P_m orientation.",
      roles,
      HR,
      HC,
      A,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }

  // ── Phase B, Step 11: Construct Pn ─────────────────────────────────────────
  const rCn_HR = distance(C[n], HR);
  const rAn_HR = distance(A[n], HR);
  const pnCands = intersectCircles(
    { center: C[i], radius: rCn_HR },
    { center: A[i], radius: rAn_HR }
  );
  if (pnCands.length === 0) {
    return {
      status: "error",
      stage: "Pn",
      error: "Inversion circles for P_n do not intersect.",
      roles,
      HR,
      HC,
      A,
      Pm,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }
  const Pn = pickByOrientation(pnCands, C[n], A[n], HR, C[i], A[i], false);
  if (!Pn) {
    return {
      status: "error",
      stage: "Pn",
      error: "Could not determine P_n orientation.",
      roles,
      HR,
      HC,
      A,
      Pm,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }

  // ── Phase B, Step 12: B[i] = circumcenter of {HR, Pm, Pn} ─────────────────
  const Bi = circumcenter(HR, Pm, Pn);
  if (!Bi) {
    return {
      status: "error",
      stage: "B1",
      error: "H_R, P_m, P_n are collinear — B at infinity.",
      roles,
      HR,
      HC,
      A,
      Pm,
      Pn,
      bisectorCij,
      bisectorAij,
      rCircle,
      crankCircle,
    };
  }

  // ── Phase C: Finding B[j], B[m], B[n] ─────────────────────────────────────
  const couplerLen = distance(A[i], Bi);
  const BC_ref = distance(C[i], Bi);
  const targetSign_B = Math.sign(signedArea(A[i], C[i], Bi));

  const B: Point[] = new Array(4);
  B[i] = Bi;

  for (const k of [j, m, n]) {
    const bkCands = intersectCircles(
      { center: A[k], radius: couplerLen },
      { center: C[k], radius: BC_ref }
    );
    if (bkCands.length === 0) {
      return {
        status: "error",
        stage: "Bk",
        error: `Cannot find B${k} — arcs do not intersect.`,
        roles,
        HR,
        HC,
        A,
        B1: Bi,
        B,
        Pm,
        Pn,
        bisectorCij,
        bisectorAij,
        rCircle,
        crankCircle,
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

  // ── Link lengths & classification ──────────────────────────────────────────
  const ground = distance(HC, HR);
  const crank = crankLen;
  const coupler = couplerLen;
  const follower = distance(HR, Bi);

  const links: LinkSet = { ground, crank, coupler, follower };
  const grashofResult = classifyGrashof(links);
  const canFull = canInputFullyRotate(links);

  // Rocker-Crank: follower is shortest → it fully rotates when driven from HR.
  const followerIsDriver = grashofResult.type === "Rocker-Crank";

  // startAngle: angle of the DRIVING link's moving pivot from its fixed pivot.
  const startAngle = followerIsDriver
    ? Math.atan2(Bi.y - HR.y, Bi.x - HR.x)
    : Math.atan2(Ai.y - HC.y, Ai.x - HC.x);

  // crossRef for kinematic branch selection
  const crossRef =
    (Bi.x - Ai.x) * (HR.y - Ai.y) - (Bi.y - Ai.y) * (HR.x - Ai.x);

  return {
    status: "success",
    pointMode: 4,
    roles,
    HR,
    HC,
    A,
    B1: Bi,
    B,
    Pm,
    Pn,
    bisectorCij,
    bisectorAij,
    rCircle,
    crankCircle,
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