import React from "react";
import type { SynthesisResult } from "../lib/synthesis/pipeline";
import { useSynthesisStore } from "../store/useSynthesisStore";
import { distance, signedArea } from "../lib/geometry/math";

interface Props {
  result: SynthesisResult;
}

const TOTAL_STEPS_4PT = 16;
const TOTAL_STEPS_5PT = 19;

function f(n: number): string {
  return n.toFixed(2);
}

function getStepData(
  result: SynthesisResult,
  pts: { x: number; y: number }[]
): { title: string; description: string }[] {
  const { roles } = result;
  if (!roles) return [];
  const { i, j, m, n } = roles;

  const HR = result.HR!;
  const HC = result.HC;
  const A = result.A;
  const Bi = result.B1;
  const B = result.B;
  const Pm = result.Pm;
  const Pn = result.Pn;
  const lengths = result.lengths;

  const storeState = useSynthesisStore.getState();
  const hrOffset = storeState.hrOffset;
  const hcOffset = storeState.hcOffset;
  const R = storeState.R;
  const r = storeState.r;

  const steps: { title: string; description: string }[] = [];

  // ── Step 1 ────────────────────────────────────────────────────────
  steps.push({
    title: "Precision Points C0–C3",
    description:
      `The four precision points that the coupler point C must pass through. These are given (placed by user on the canvas).\n\n` +
      pts.map((p, k) => `  C${k}: (${f(p.x)}, ${f(p.y)})`).join("\n"),
  });

  // ── Step 2 ────────────────────────────────────────────────────────
  steps.push({
    title: `Reduction Pair (C${i}, C${j})`,
    description:
      `🔧 FREE CHOICE: Select any pair of precision points as the reduction pair. Selected: C${i} and C${j}.\n\n` +
      `The reduction pair determines which two poses are "reduced" — the rigid motion from pose ${i} → pose ${j} becomes a pure rotation about H_R.`,
  });

  // ── Step 3 ────────────────────────────────────────────────────────
  const mid = {
    x: (pts[i].x + pts[j].x) / 2,
    y: (pts[i].y + pts[j].y) / 2,
  };
  steps.push({
    title: `Perpendicular Bisector c_${i}${j}`,
    description:
      `Construct the perpendicular bisector of segment C${i}–C${j}. Midpoint at (${f(mid.x)}, ${f(mid.y)}).\n\n` +
      `Any point on this line is equidistant from C${i} and C${j}. H_R must lie on this line to ensure |H_R C${i}| = |H_R C${j}|.`,
  });

  // ── Step 4 ────────────────────────────────────────────────────────
  steps.push({
    title: "Fixed Pivot H_R (Follower Pivot)",
    description:
      `🔧 FREE CHOICE: Place H_R ANYWHERE on c_${i}${j}. Current offset along bisector: ${f(hrOffset)}. H_R = (${f(HR.x)}, ${f(HR.y)}).\n\n` +
      `H_R is the fixed ground pivot for the follower (output) link. Placing H_R on c_${i}${j} guarantees |H_R C${i}| = |H_R C${j}|, so the motion from pose ${i} to pose ${j} is a pure rotation about H_R.`,
  });

  // ── Step 5 ────────────────────────────────────────────────────────
  steps.push({
    title: "R-Circle (Rocker Circle)",
    description:
      `🔧 FREE CHOICE: Choose ANY radius R. Current R = ${f(R)}.\n\n` +
      `Draw a circle centered at H_R with radius R. A${i} and A${j} will both lie on this circle, ensuring |H_R A${i}| = |H_R A${j}| = R.`,
  });

  // ── Step 6 ────────────────────────────────────────────────────────
  if (A) {
    steps.push({
      title: `Crank Pins A${i} and A${j}`,
      description:
        `🔧 FREE CHOICE: Choose ANY radius r (coupler distance |C–A|). Current r = ${f(r)}.\n\n` +
        `Strike r-arcs from C${i} and C${j} to intersect the R-circle:\n` +
        `  • arc(C${i}, r) ∩ R-circle → A${i} = (${f(A[i].x)}, ${f(A[i].y)})\n` +
        `  • arc(C${j}, r) ∩ R-circle → A${j} = (${f(A[j].x)}, ${f(A[j].y)})\n\n` +
        `Both satisfy: |C A| = r and |H_R A| = R. Each arc gives 2 candidates; the branch toggle selects which.\n` +
        `⚠️ Pick intersections with SAME ORIENTATION (see next step).`,
    });
  } else {
    steps.push({
      title: `Crank Pins A${i} and A${j}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 7 ────────────────────────────────────────────────────────
  if (A) {
    const sa_i = signedArea(pts[i], A[i], HR);
    const sa_j = signedArea(pts[j], A[j], HR);
    const sign_i = sa_i >= 0 ? "positive" : "negative";
    const sign_j = sa_j >= 0 ? "positive" : "negative";
    const match = Math.sign(sa_i) === Math.sign(sa_j);
    steps.push({
      title: `Orientation Check on A${i}, A${j}`,
      description:
        `Verify that △(C${i} A${i} H_R) and △(C${j} A${j} H_R) have the SAME orientation. This ensures the motion is a proper rotation, not a reflection.\n\n` +
        `  SignedArea(△C${i} A${i} H_R) = ${f(sa_i)}  (${sign_i})\n` +
        `  SignedArea(△C${j} A${j} H_R) = ${f(sa_j)}  (${sign_j})\n` +
        `  Signs ${match ? "match ✅ — proper rotation" : "DO NOT match ❌ — reflection!"}.\n\n` +
        `A${j} is automatically chosen to match A${i}'s orientation. The "Swap A${i}/A${j} side" toggle selects between two equally valid (A${i}, A${j}) pairs — both have matching orientation, but produce different linkage geometries.`,
    });
  } else {
    steps.push({
      title: `Orientation Check on A${i}, A${j}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 8 ────────────────────────────────────────────────────────
  if (A && HC) {
    const dist_HC_Aj = distance(HC, A[j]);
    steps.push({
      title: `Perpendicular Bisector a_${i}${j} and Fixed Pivot H_C`,
      description:
        `Construct perpendicular bisector a_${i}${j} of segment A${i}–A${j}.\n\n` +
        `Sanity check: this bisector MUST pass through H_R ✅ (because |H_R A${i}| = |H_R A${j}| = R by construction).\n\n` +
        `🔧 FREE CHOICE: Place H_C ANYWHERE on a_${i}${j}. Current offset: ${f(hcOffset)}. H_C = (${f(HC.x)}, ${f(HC.y)}).\n\n` +
        `H_C is the fixed ground pivot for the crank (input) link. Placing H_C on a_${i}${j} guarantees |H_C A${i}| = |H_C A${j}|. Verification: |H_C A${j}| = ${f(dist_HC_Aj)} ✅`,
    });
  } else {
    steps.push({
      title: `Perpendicular Bisector a_${i}${j} and H_C`,
      description: "Not yet computed.",
    });
  }

  // ── Step 9 ────────────────────────────────────────────────────────
  if (HC && lengths) {
    steps.push({
      title: "Crank Circle",
      description:
        `Draw the crank circle: center H_C, radius |H_C A${i}| = ${f(lengths.crank)}.\n\n` +
        (A ? `Verification: A${j} also lies on this circle — |H_C A${j}| = ${f(distance(HC, A[j]))} ✅\n\n` : "") +
        `All four crank pins A0–A3 must lie on this circle. A${i} and A${j} are already on it by construction. A${m} and A${n} will be found in the next step.`,
    });
  } else {
    steps.push({
      title: "Crank Circle",
      description: "Not yet computed.",
    });
  }

  // ── Step 10 ───────────────────────────────────────────────────────
  if (A) {
    steps.push({
      title: `Crank Pins A${m} and A${n}`,
      description:
        `Strike r-arcs from the remaining precision points to intersect the crank circle:\n` +
        `  • arc(C${m}, r) ∩ crank circle → A${m} = (${f(A[m].x)}, ${f(A[m].y)})\n` +
        `  • arc(C${n}, r) ∩ crank circle → A${n} = (${f(A[n].x)}, ${f(A[n].y)})\n\n` +
        `Each intersection has 2 candidates; the "Swap A${m}" and "Swap A${n}" branch toggles select which. Now all four crank pins A0–A3 are determined.`,
    });
  } else {
    steps.push({
      title: `Crank Pins A${m} and A${n}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 11 ───────────────────────────────────────────────────────
  if (Pm && A) {
    steps.push({
      title: `Inversion Point P${m} (Coupler Inversion)`,
      description:
        `PERFORM INVERSION ON COUPLER for pose ${m}. Find point P${m} such that △(C${i} A${i} P${m}) ≅ △(C${m} A${m} H_R) with same orientation.\n\n` +
        `P${m} represents H_R "pulled back" to the reference frame of pose ${i} through the coupler's rigid-body motion from pose ${m} → pose ${i}.\n\n` +
        `Construction: circle(C${i}, |C${m}–H_R|) ∩ circle(A${i}, |A${m}–H_R|) → P${m} = (${f(Pm.x)}, ${f(Pm.y)})`,
    });
  } else {
    steps.push({
      title: `Inversion Point P${m}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 12 ───────────────────────────────────────────────────────
  if (Pn && A) {
    steps.push({
      title: `Inversion Point P${n} (Coupler Inversion)`,
      description:
        `PERFORM INVERSION ON COUPLER for pose ${n}. Find point P${n} such that △(C${i} A${i} P${n}) ≅ △(C${n} A${n} H_R) with same orientation.\n\n` +
        `P${n} represents H_R "pulled back" to the reference frame of pose ${i} through the coupler's rigid-body motion from pose ${n} → pose ${i}.\n\n` +
        `Construction: circle(C${i}, |C${n}–H_R|) ∩ circle(A${i}, |A${n}–H_R|) → P${n} = (${f(Pn.x)}, ${f(Pn.y)})`,
    });
  } else {
    steps.push({
      title: `Inversion Point P${n}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 13 ───────────────────────────────────────────────────────
  if (Bi && lengths) {
    steps.push({
      title: `Coupler Pin B${i} — Circumcenter`,
      description:
        `Locating B${i} (rocker tip at pose ${i}) is adequate — the other B positions follow from the rigid coupler.\n\n` +
        `P${m}, P${n}, and H_R all represent H_R in the reference frame. They must all rotate about B${i} (the follower pivot in pose ${i}). Therefore B${i} is equidistant from all three — it is their CIRCUMCENTER.\n\n` +
        `B${i} = circumcenter({H_R, P${m}, P${n}}) = (${f(Bi.x)}, ${f(Bi.y)})\n\n` +
        `Link lengths determined:\n` +
        `  |H_R – B${i}| = ${f(lengths.follower)}  (follower length)\n` +
        `  |A${i} – B${i}| = ${f(lengths.coupler)}  (coupler AB length)`,
    });
  } else {
    steps.push({
      title: `Coupler Pin B${i} — Circumcenter`,
      description: "Not yet computed.",
    });
  }

  // ── Step 14 ───────────────────────────────────────────────────────
  if (B && Bi) {
    const bj = B[j];
    const bm = B[m];
    const bn = B[n];
    const AB = lengths ? f(lengths.coupler) : "?";
    const BC = Bi ? f(distance(pts[i], Bi)) : "?";
    steps.push({
      title: `Remaining Coupler Pins B${j}, B${m}, B${n}`,
      description:
        `For each remaining pose k ∈ {${j}, ${m}, ${n}}: the coupler triangle A–B–C is rigid, so |A_k – B_k| = ${AB} (coupler AB) and |C_k – B_k| = ${BC} (coupler BC).\n\n` +
        `Construct: arc(A_k, ${AB}) ∩ arc(C_k, ${BC}) → B_k (pick intersection with same orientation as reference).\n\n` +
        (bj ? `  B${j} = (${f(bj.x)}, ${f(bj.y)})\n` : `  B${j} = N/A\n`) +
        (bm ? `  B${m} = (${f(bm.x)}, ${f(bm.y)})\n` : `  B${m} = N/A\n`) +
        (bn ? `  B${n} = (${f(bn.x)}, ${f(bn.y)})` : `  B${n} = N/A`),
    });
  } else {
    steps.push({
      title: `Remaining Coupler Pins B${j}, B${m}, B${n}`,
      description: "Not yet computed.",
    });
  }

  // ── Step 15 ───────────────────────────────────────────────────────
  if (lengths && result.grashof) {
    steps.push({
      title: "Four-Bar Linkage — Summary",
      description:
        `The four-bar linkage is now fully defined:\n` +
        `  Ground link:   H_C – H_R  = ${f(lengths.ground)}\n` +
        `  Crank (input): H_C – A    = ${f(lengths.crank)}\n` +
        `  Coupler:       A – B      = ${f(lengths.coupler)}\n` +
        `  Follower:      H_R – B    = ${f(lengths.follower)}\n\n` +
        `Grashof classification: ${result.grashof}. Valid crank range: ${result.canFullRotate ? "Full 360°" : "Limited swing"}.\n\n` +
        `Free choices made:\n` +
        `  🔧 Reduction pair: C${i}, C${j}\n` +
        `  🔧 H_R offset: ${f(hrOffset)}  (position on bisector c_${i}${j})\n` +
        `  🔧 R: ${f(R)}  (R-circle radius)\n` +
        `  🔧 r: ${f(r)}  (coupler distance |C–A|)\n` +
        `  🔧 H_C offset: ${f(hcOffset)}  (position on bisector a_${i}${j})`,
    });
  } else {
    steps.push({
      title: "Four-Bar Linkage",
      description: "Not yet computed.",
    });
  }

  // ── Step 16 ───────────────────────────────────────────────────────
  steps.push({
    title: "Verification — Geometric Poses",
    description:
      `The Burmester synthesis guarantees that four GEOMETRIC poses exist where the coupler point C coincides with C0, C1, C2, C3. These four poses are shown as ghost coupler triangles on the canvas.\n\n` +
      `⚠️ IMPORTANT: Geometric existence ≠ Kinematic reachability\n\n` +
      `The synthesis does NOT guarantee all four poses are reachable in continuous motion. Some poses may require:\n` +
      `  • Crank angles outside the mechanism's motion range\n` +
      `  • Switching between assembly branches (disassembly needed)\n` +
      `  • Passage through singular configurations\n\n` +
      `Use the animation controls to verify which precision points are actually reached during continuous rotation. The coupler curve shows the actual trajectory.\n\n` +
      `If not all four points are reached, adjust the free choices (R, r, H_R offset, H_C offset) or try a different reduction pair or configuration (open ↔ crossed).`,
  });

  return steps;
}

function getStepData5pt(
  result: SynthesisResult,
  pts: { x: number; y: number }[]
): { title: string; description: string }[] {
  const HR = result.HR;
  const HC = result.HC;
  const A = result.A;
  const Bi = result.B1;
  const B = result.B;
  const Pm = result.Pm; // combined inversion point [2,3]
  const Pn = result.Pn; // reference inversion point
  const lengths = result.lengths;

  const storeState = useSynthesisStore.getState();
  const r = storeState.r;
  const alpha = storeState.alpha;
  const pair1 = storeState.reductionPair1;
  const pair2 = storeState.reductionPair2;
  const used = new Set([...pair1, ...pair2]);
  const refPt = [0, 1, 2, 3, 4].find((x) => !used.has(x)) ?? 0;

  const steps: { title: string; description: string }[] = [];

  // Step 1
  steps.push({
    title: "Precision Points C0–C4",
    description:
      `The five precision points that the coupler point C must pass through.\n\n` +
      pts.map((p, k) => `  C${k}: (${f(p.x)}, ${f(p.y)})`).join("\n"),
  });

  // Step 2
  steps.push({
    title: `Reduction Pairs (C${pair1[0]}C${pair1[1]}) + (C${pair2[0]}C${pair2[1]})`,
    description:
      `🔧 FREE CHOICE: Select two disjoint pairs. Reference (left-out) point: C${refPt}.\n\n` +
      `Pair 1: C${pair1[0]}C${pair1[1]} — bisector c_${pair1[0]}${pair1[1]}\n` +
      `Pair 2: C${pair2[0]}C${pair2[1]} — bisector c_${pair2[0]}${pair2[1]}\n\n` +
      `H_R will be the intersection of these two bisectors (0 DOF).`,
  });

  // Step 3
  steps.push({
    title: `Bisector c_${pair1[0]}${pair1[1]}`,
    description:
      `Perpendicular bisector of C${pair1[0]}–C${pair1[1]}.\n\n` +
      `Every point on this line is equidistant from C${pair1[0]} and C${pair1[1]}, and can serve as the center of a finite rotation mapping C${pair1[0]} to C${pair1[1]}.`,
  });

  // Step 4
  steps.push({
    title: `Bisector c_${pair2[0]}${pair2[1]} and H_R`,
    description:
      (!HR ? "Not yet computed." :
      `Perpendicular bisector of C${pair2[0]}–C${pair2[1]}.\n\n` +
      `H_R = intersection of c_${pair1[0]}${pair1[1]} and c_${pair2[0]}${pair2[1]}:\n` +
      `  H_R = (${f(HR.x)}, ${f(HR.y)})\n\n` +
      `H_R is simultaneously the rotation center for motions ${pair1[0]}→${pair1[1]} and ${pair2[0]}→${pair2[1]}. This is the key difference from 4-point: two bisectors fix H_R uniquely (0 DOF).`),
  });

  // Step 5
  steps.push({
    title: `Overlay Technique — Lines a(${pair1[0]}${pair1[1]}/${pair2[0]}${pair2[1]}), c${pair1[0]}${pair1[1]}', c${pair2[0]}${pair2[1]}'`,
    description:
      (!HR ? "Not yet computed." :
      `Construct three lines through H_R via the overlay technique:\n\n` +
      `• a(${pair1[0]}${pair1[1]}/${pair2[0]}${pair2[1]}): merged bisector — aligns bisector c_${pair1[0]}${pair1[1]} with c_${pair2[0]}${pair2[1]}\n` +
      `• c${pair1[0]}${pair1[1]}': offset from a toward C${pair1[0]} — signed angular offset from bisector c_${pair1[0]}${pair1[1]}\n` +
      `• c${pair2[0]}${pair2[1]}': offset from a toward C${pair2[0]} — signed angular offset from bisector c_${pair2[0]}${pair2[1]}\n\n` +
      `Signed offsets handle both same-handedness and opposite-handedness rotation cases.`),
  });

  // Step 6
  steps.push({
    title: "Overlay Rotation α",
    description:
      `🔧 FREE CHOICE: Rotate the entire overlay by angle α = ${f(alpha)}°.\n\n` +
      `α determines the direction of line a₂₃ through H_R, which constrains where H_C can fall. Different α values produce different valid mechanisms.`,
  });

  // Step 7
  if (A && HR) {
    steps.push({
      title: `Crank Pin A${pair1[0]} on c₁′`,
      description:
        `🔧 FREE CHOICE: Choose radius r = ${f(r)} (coupler distance |C–A|).\n\n` +
        `arc(C${pair1[0]}, r) ∩ c₁′ → A${pair1[0]} = (${f(A[pair1[0]].x)}, ${f(A[pair1[0]].y)})\n\n` +
        `🔧 FREE CHOICE: A${pair1[0]} branch selects which of the 2 intersection candidates.`,
    });
  } else {
    steps.push({ title: `Crank Pin A${pair1[0]}`, description: "Not yet computed." });
  }

  // Step 8
  if (A && HR) {
    // Use the actual cross product criterion from the pipeline
    const v1 = { x: A[pair1[0]].x - pts[pair1[0]].x, y: A[pair1[0]].y - pts[pair1[0]].y };
    const v2 = { x: A[pair2[0]].x - pts[pair2[0]].x, y: A[pair2[0]].y - pts[pair2[0]].y };
    const crossProd = v1.x * v2.y - v1.y * v2.x;
    const targetSign = Math.sign(signedArea(pts[pair1[0]], A[pair1[0]], HR));
    const match = Math.sign(crossProd) === targetSign;
    steps.push({
      title: `Crank Pin A${pair2[0]} on c₂′ (Orientation-Matched)`,
      description:
        `arc(C${pair2[0]}, r) ∩ c₂′ → A${pair2[0]} = (${f(A[pair2[0]].x)}, ${f(A[pair2[0]].y)})\n\n` +
        `A${pair2[0]} is NOT a free choice — it must match A${pair1[0]}'s orientation:\n` +
        `  Reference sign = sign(signedArea(△C${pair1[0]} A${pair1[0]} H_R)) = ${targetSign > 0 ? "+" : "−"}\n` +
        `  Cross product (A${pair1[0]}−C${pair1[0]}) × (A${pair2[0]}−C${pair2[0]}) = ${f(crossProd)}\n` +
        `  sign(cross) = ${Math.sign(crossProd) > 0 ? "+" : "−"}\n` +
        `  ${match ? "Match ✅ — proper rotation" : "MISMATCH ❌ — reflection!"}`,
    });
  } else {
    steps.push({ title: `Crank Pin A${pair2[0]}`, description: "Not yet computed." });
  }

  // Step 9
  if (A && HC) {
    steps.push({
      title: "Bisector a₁₂ and Fixed Pivot H_C",
      description:
        `Perpendicular bisector a₁₂ of A${pair1[0]}–A${pair2[0]}.\n\n` +
        `H_C = a₁₂ ∩ a₂₃ = (${f(HC.x)}, ${f(HC.y)})\n\n` +
        `H_C depends on both free choices: changing α rotates a₂₃ about H_R, changing r moves A₁/A₂ along their lines.`,
    });
  } else {
    steps.push({ title: "H_C", description: "Not yet computed." });
  }

  // Step 10
  if (HC && lengths) {
    steps.push({
      title: "Crank Circle",
      description:
        `Center H_C, radius |H_C A${pair1[0]}| = ${f(lengths.crank)}.\n\n` +
        `Both A${pair1[0]} and A${pair2[0]} lie on this circle by construction.`,
    });
  } else {
    steps.push({ title: "Crank Circle", description: "Not yet computed." });
  }

  // Step 11
  {
    const remaining = [0, 1, 2, 3, 4].filter((x) => x !== pair1[0] && x !== pair2[0]);
    if (A) {
      steps.push({
        title: `Remaining Crank Pins (A${remaining.join(", A")})`,
        description:
          `For each remaining point: arc(Cₖ, r) ∩ crank circle.\n` +
          `Default orientation matches A${pair1[0]} via signedArea.\n\n` +
          remaining.map((k) => A[k] ? `  A${k} = (${f(A[k].x)}, ${f(A[k].y)})` : `  A${k} = N/A`).join("\n") +
          `\n\n🔧 FREE CHOICE: Each has a branch toggle (3 toggles total).`,
      });
    } else {
      steps.push({ title: `Remaining Crank Pins`, description: "Not yet computed." });
    }
  }

  // Step 12
  if (Pm && A && HR) {
    steps.push({
      title: `Combined Inversion Point [${pair2[0]},${pair2[1]}]`,
      description:
        `△(C${pair2[0]} A${pair2[0]} H_R) ≅ △(C${pair1[0]} A${pair1[0]} · [${pair2[0]},${pair2[1]}]) with same orientation.\n\n` +
        `[${pair2[0]},${pair2[1]}] = (${f(Pm.x)}, ${f(Pm.y)})\n\n` +
        `This point serves both positions ${pair2[0]} and ${pair2[1]} because H_R is the rotation center for motion ${pair2[0]}→${pair2[1]} — a rotation center is fixed under the motion it generates.`,
    });
  } else {
    steps.push({ title: "Combined Inversion Point", description: "Not yet computed." });
  }

  // Step 13
  if (Pn && A && HR) {
    steps.push({
      title: `Inversion Point for C${refPt}`,
      description:
        `△(C${refPt} A${refPt} H_R) ≅ △(C${pair1[0]} A${pair1[0]} · Pt${refPt}) with same orientation.\n\n` +
        `Pt${refPt} = (${f(Pn.x)}, ${f(Pn.y)})\n\n` +
        `C${refPt} is not covered by any reduction pair — yields an independent image.`,
    });
  } else {
    steps.push({ title: "Reference Inversion Point", description: "Not yet computed." });
  }

  // Step 14
  if (Bi && lengths && HR && Pm && Pn) {
    steps.push({
      title: `Coupler Pin B — Circumcenter`,
      description:
        `B = circumcenter({H_R, [${pair2[0]},${pair2[1]}], Pt${refPt}}) = (${f(Bi.x)}, ${f(Bi.y)})\n\n` +
        `Why 3 distinct images from 5 positions:\n` +
        `  • H_R covers positions ${pair1[0]} and ${pair1[1]} (reduction pair 1)\n` +
        `  • [${pair2[0]},${pair2[1]}] covers positions ${pair2[0]} and ${pair2[1]} (reduction pair 2)\n` +
        `  • Pt${refPt} covers position ${refPt} (independent)\n\n` +
        `Follower length |H_R – B| = ${f(lengths.follower)}\n` +
        `Coupler AB = ${f(lengths.coupler)}`,
    });
  } else {
    steps.push({ title: "Coupler Pin B", description: "Not yet computed." });
  }

  // Step 15
  if (Bi) {
    steps.push({
      title: "Coupler Lengths",
      description:
        `AB = |A₀ – B| = ${f(distance(A![pair1[0]], Bi))}\n` +
        `CB = |C₀ – B| = ${f(distance(pts[pair1[0]], Bi))}\n\n` +
        `These are constant across all 5 positions (rigid coupler triangle).`,
    });
  } else {
    steps.push({ title: "Coupler Lengths", description: "Not yet computed." });
  }

  // Step 16
  if (B && Bi) {
    const otherIndices = [0, 1, 2, 3, 4].filter((x) => x !== pair1[0]);
    const AB = lengths ? f(lengths.coupler) : "?";
    const BC = f(distance(pts[pair1[0]], Bi));
    steps.push({
      title: "Remaining Coupler Pins B₁–B₄",
      description:
        `For each k: arc(A_k, ${AB}) ∩ arc(C_k, ${BC}) → B_k (orientation-matched).\n\n` +
        otherIndices.map((k) => B[k] ? `  B${k} = (${f(B[k].x)}, ${f(B[k].y)})` : `  B${k} = N/A`).join("\n"),
    });
  } else {
    steps.push({ title: "Remaining B Positions", description: "Not yet computed." });
  }

  // Step 17
  if (lengths && result.grashof) {
    steps.push({
      title: "Four-Bar Linkage — Summary",
      description:
        `The four-bar linkage is now fully defined:\n` +
        `  Ground:   H_C – H_R  = ${f(lengths.ground)}\n` +
        `  Crank:    H_C – A    = ${f(lengths.crank)}\n` +
        `  Coupler:  A – B      = ${f(lengths.coupler)}\n` +
        `  Follower: H_R – B    = ${f(lengths.follower)}\n\n` +
        `Grashof: ${result.grashof}. Range: ${result.canFullRotate ? "Full 360°" : "Limited"}.\n\n` +
        `Free choices: pair combo, α=${f(alpha)}°, r=${f(r)}, A${pair1[0]} branch, 3 crank-circle branches.`,
    });
  } else {
    steps.push({ title: "Summary", description: "Not yet computed." });
  }

  // Step 18
  steps.push({
    title: "Free Choices Summary",
    description:
      `  1. Pair combination: (C${pair1[0]}C${pair1[1]}) + (C${pair2[0]}C${pair2[1]}), ref=C${refPt}  [15 options]\n` +
      `  2. Overlay rotation α = ${f(alpha)}°  [continuous]\n` +
      `  3. Coupler distance r = ${f(r)}  [continuous]\n` +
      `  4. A${pair1[0]} branch  [2 options]\n` +
      `  5–7. A branch toggles for remaining 3 points  [2³ = 8 options]\n\n` +
      `A${pair2[0]} is orientation-matched to A${pair1[0]} — not a free choice.\n\n` +
      `Discrete branches: 15 × 2⁴ = 240 distinct mechanisms\n` +
      `Continuous DOF: 2 (α and r)`,
  });

  // Step 19
  steps.push({
    title: "Verification",
    description:
      `The synthesis guarantees five GEOMETRIC poses where C passes through C0–C4.\n\n` +
      `⚠️ Geometric existence ≠ Kinematic reachability\n\n` +
      `Some poses may require switching assembly branches or passing through singularities. ` +
      `Animate to verify which poses are reachable in continuous motion.\n\n` +
      `If fewer than 5 are reached, adjust α, r, try a different pair combination, or toggle branch choices.`,
  });

  return steps;
}

export default function ConstructionViewer({ result }: Props) {
  const step = useSynthesisStore((s) => s.constructionStep);
  const setStep = useSynthesisStore((s) => s.setConstructionStep);
  const pts = useSynthesisStore((s) => s.precisionPoints);
  const pointMode = useSynthesisStore((s) => s.pointMode);

  const TOTAL_STEPS = pointMode === 5 ? TOTAL_STEPS_5PT : TOTAL_STEPS_4PT;

  const steps = React.useMemo(
    () => pointMode === 5 ? getStepData5pt(result, pts) : getStepData(result, pts),
    [result, pts, pointMode]
  );

  if (step < 1 || step > TOTAL_STEPS || steps.length === 0) return null;

  const currentStep = steps[step - 1];

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-sm font-semibold text-gray-700">
          Construction Viewer
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono">
            Step {step} / {TOTAL_STEPS}
          </span>
          <button
            onClick={() => setStep(0)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <h4 className="font-semibold text-sm text-amber-700 mb-1">
          Step {step}: {currentStep.title}
        </h4>
        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
          {currentStep.description}
        </pre>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
        <button
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step <= 1}
          className="px-3 py-1 text-xs rounded border bg-white text-gray-700 border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ◀ Prev
        </button>

        <div className="flex items-center gap-1">
          {Array.from({ length: TOTAL_STEPS }, (_, k) => k + 1).map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`w-5 h-5 rounded text-[9px] transition-colors ${
                s === step
                  ? "bg-amber-500 text-white font-bold"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={() => setStep(Math.min(TOTAL_STEPS, step + 1))}
          disabled={step >= TOTAL_STEPS}
          className="px-3 py-1 text-xs rounded border bg-white text-gray-700 border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Next ▶
        </button>
      </div>
    </div>
  );
}
