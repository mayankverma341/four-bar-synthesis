import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { useSynthesisStore } from "../store/useSynthesisStore";
import type { SynthesisResult } from "../lib/synthesis/pipeline";
import type { Point } from "../lib/geometry/math";
import {
  solvePosition,
  solvePositionInverse,
  solveGhostPose,
  computeCouplerCurve,
  computeRockerLimits,
  computeRockerLimitsFollower,
  detectBranch,
  rockerTick,
} from "../lib/synthesis/kinematic";
import type { KinematicPose, RockerLimits } from "../lib/synthesis/kinematic";
import { distance } from "../lib/geometry/math";

interface Props {
  result: SynthesisResult | null;
}

const POINT_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#ef4444"];
const GRID_SPACING = 50;
const MIN_LABEL_PX = 55;
const EPSILON = 1e-9;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;

function niceStep(zoom: number): number {
  const minWorld = MIN_LABEL_PX / zoom;
  const rawMult = minWorld / GRID_SPACING;
  const multiples = [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 500, 1000];
  for (const m of multiples) if (m >= rawMult) return m * GRID_SPACING;
  return 1000 * GRID_SPACING;
}

/** Detect if two line segments P1–P2 and P3–P4 intersect; return point or null */
function segmentIntersection(
  P1: Point,
  P2: Point,
  P3: Point,
  P4: Point
): Point | null {
  const d1x = P2.x - P1.x,
    d1y = P2.y - P1.y;
  const d2x = P4.x - P3.x,
    d2y = P4.y - P3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const dx = P3.x - P1.x,
    dy = P3.y - P1.y;
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: P1.x + t * d1x, y: P1.y + t * d1y };
}

export default function CanvasArea({ result }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const animRef = useRef({
    crankAngle: 0,
    rockerDirection: 1 as 1 | -1,
    isPlaying: false,
    speedRPM: 30,
  });
  const limitsRef = useRef<RockerLimits | null>(null);
  const drawFnRef = useRef<() => void>(() => {});
  const rafRef = useRef<number>(0);
  const lastTRef = useRef<number>(0);

  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = React.useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });

  // ── Store subscriptions ────────────────────────────────────────────
  const precisionPoints = useSynthesisStore((s) => s.precisionPoints);
  const showConstruction = useSynthesisStore((s) => s.showConstruction);
  const showGhosts = useSynthesisStore((s) => s.showGhosts);
  const isPlaying = useSynthesisStore((s) => s.isPlaying);
  const speedRPM = useSynthesisStore((s) => s.speedRPM);
  const crankAngle = useSynthesisStore((s) => s.crankAngle);
  const rockerDirection = useSynthesisStore((s) => s.rockerDirection);
  const r = useSynthesisStore((s) => s.r);
  const zoom = useSynthesisStore((s) => s.zoom);
  const panX = useSynthesisStore((s) => s.panX);
  const panY = useSynthesisStore((s) => s.panY);
  const showCouplerCurve = useSynthesisStore((s) => s.showCouplerCurve);
  const configuration = useSynthesisStore((s) => s.configuration);
  const constructionStep = useSynthesisStore((s) => s.constructionStep);
  const pointMode = useSynthesisStore((s) => s.pointMode);

  const placePoint = useSynthesisStore((s) => s.placePoint);
  const setCrankAngle = useSynthesisStore((s) => s.setCrankAngle);
  const setRockerDirection = useSynthesisStore((s) => s.setRockerDirection);
  const setZoom = useSynthesisStore((s) => s.setZoom);
  const setPan = useSynthesisStore((s) => s.setPan);
  const resetView = useSynthesisStore((s) => s.resetView);

  // Sync anim refs
  useEffect(() => {
    animRef.current.crankAngle = crankAngle;
  }, [crankAngle]);
  useEffect(() => {
    animRef.current.rockerDirection = rockerDirection;
  }, [rockerDirection]);
  useEffect(() => {
    animRef.current.isPlaying = isPlaying;
    if (!isPlaying) lastTRef.current = 0;
  }, [isPlaying]);
  useEffect(() => {
    animRef.current.speedRPM = speedRPM;
  }, [speedRPM]);

  // ── Convenience flags ───────────────────────────────────────────────
  const followerIsDriver =
    result?.status === "success"
      ? (result.followerIsDriver ?? false)
      : false;

  const roles = result?.roles;

  // ── Construction mode helpers ───────────────────────────────────────
  const cs = constructionStep; // 0 = normal, 1–N = construction
  const show = (step: number) => cs === 0 || step <= cs;
  const hl = (step: number) => cs > 0 && step === cs;

  // Mode-aware step numbers for shared rendering (ground link, coupler curve)
  const is5pt = !roles;
  const stepGround = is5pt ? 17 : 15;
  const stepVerify = is5pt ? 19 : 16;

  // Compute reference index for kinematic calculations
  // 4-point: roles.i, 5-point: first index from pair1 (stored generically)
  const refIdx = useMemo(() => {
    if (result?.pointMode === 5) {
      // For 5-point, the reference is pair1[0] — stored at A[pair1[0]]
      // We need to find it from the result
      if (result.A && result.A.length === 5) {
        // Find the first index that has a valid A entry and matches pair1[0]
        // The pipeline stores the ref index implicitly as the first reduction pair element
        // We can derive it: the pipeline uses pair1[0] as the reference for kinematic seed
        const store = useSynthesisStore.getState();
        return store.reductionPair1[0];
      }
    }
    return roles?.i ?? 0;
  }, [result, roles]);

  // ── Derived kinematics ─────────────────────────────────────────────
  const rockerLimits = useMemo((): RockerLimits | null => {
    if (
      result?.status !== "success" ||
      !result.HC ||
      !result.HR ||
      !result.lengths
    )
      return null;

    if (result.followerIsDriver) {
      return computeRockerLimitsFollower(result.startAngle);
    }

    return computeRockerLimits(
      result.HC,
      result.HR,
      result.lengths.ground,
      result.lengths.crank,
      result.lengths.coupler,
      result.lengths.follower,
      result.canFullRotate ?? false,
      result.startAngle
    );
  }, [result]);

  // Atomic update when result changes: sync limits + angle together
  useEffect(() => {
    if (result?.status === "success" && result.startAngle !== undefined) {
      const sa = result.startAngle;
      const lim = rockerLimits;

      limitsRef.current = lim;
      animRef.current.crankAngle = sa;
      animRef.current.rockerDirection = 1;

      setCrankAngle(sa);
      setRockerDirection(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.startAngle, rockerLimits]);

  useEffect(() => {
    limitsRef.current = rockerLimits;
  }, [rockerLimits]);

  // Branch: detectBranch gives the "open" branch, flip for "crossed"
  const branch = useMemo((): (1 | -1) => {
    if (
      result?.status !== "success" ||
      !result.HC ||
      !result.HR ||
      !result.B1 ||
      !result.A ||
      !result.lengths
    )
      return 1;
    const Ci = precisionPoints[refIdx];
    if (!Ci || !result.A[refIdx]) return 1;
    const openBranch = detectBranch(
      result.HC,
      result.HR,
      result.lengths.crank,
      result.lengths.coupler,
      result.lengths.follower,
      result.A[refIdx],
      result.B1,
      Ci,
      followerIsDriver
    );
    return configuration === "crossed"
      ? ((-openBranch) as 1 | -1)
      : openBranch;
  }, [result, precisionPoints, followerIsDriver, configuration, refIdx]);

  const couplerCurve = useMemo((): Point[] => {
    if (
      result?.status !== "success" ||
      !result.HC ||
      !result.HR ||
      !result.B1 ||
      !result.A ||
      !result.lengths ||
      !rockerLimits
    )
      return [];
    const Ci = precisionPoints[refIdx];
    if (!Ci || !result.A[refIdx]) return [];
    return computeCouplerCurve(
      result.HC,
      result.HR,
      result.lengths.crank,
      result.lengths.coupler,
      result.lengths.follower,
      result.A[refIdx],
      result.B1,
      Ci,
      branch,
      rockerLimits,
      followerIsDriver,
      720
    );
  }, [result, precisionPoints, rockerLimits, branch, followerIsDriver, refIdx]);

  const ghostPoses = useMemo((): (KinematicPose | null)[] => {
    if (
      result?.status !== "success" ||
      !result.HC ||
      !result.HR ||
      !result.B1 ||
      !result.A ||
      !result.lengths
    )
      return [];
    const pts = precisionPoints;
    const numPts = result.A.length;
    if (pts.length < numPts) return [];
    const Ci = pts[refIdx];
    if (!Ci || !result.A[refIdx]) return [];

    // If synthesis provides B array, use the exact synthesized positions
    // instead of re-solving kinematics (which may pick wrong assembly branch)
    if (result.B && result.B.length === numPts) {
      return Array.from({ length: numPts }, (_, k) => {
        const Ak = result.A![k];
        const Bk = result.B![k];
        const Ck = pts[k];
        if (!Ak || !Bk || !Ck) return null;
        const theta = Math.atan2(Ak.y - result.HC!.y, Ak.x - result.HC!.x);
        return { A: Ak, B: Bk, C: Ck, theta } as KinematicPose;
      });
    }

    // Fallback: re-solve kinematics (for backward compatibility with 4-point)
    const indices = Array.from({ length: numPts }, (_, k) => k);
    return indices.map((k) =>
      solveGhostPose(
        result.HC!,
        result.HR!,
        result.lengths!.crank,
        result.lengths!.coupler,
        result.lengths!.follower,
        result.A![refIdx],
        result.B1!,
        Ci,
        result.A![k],
        pts[k],
        followerIsDriver
      )
    );
  }, [result, precisionPoints, followerIsDriver, refIdx]);

  // ── Canvas resize ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const setSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(canvas);
    setSize();
    return () => ro.disconnect();
  }, []);

  // ── Coordinate helper ──────────────────────────────────────────────
  const canvasToWorld = useCallback(
    (cx: number, cy: number, rect: DOMRect): Point => ({
      x: (cx - rect.width / 2 - panX) / zoom,
      y: -((cy - rect.height / 2 - panY) / zoom),
    }),
    [zoom, panX, panY]
  );

  // ── Wheel zoom ─────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Read current values directly from store to avoid stale closure
      const { zoom: z, panX: px, panY: py } = useSynthesisStore.getState();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
      // Skip if zoom didn't change (clamped at limit) to avoid pan snap
      if (Math.abs(newZoom - z) < 1e-12) return;
      const zr = newZoom / z;
      setZoom(newZoom);
      setPan(
        cx - rect.width / 2 - zr * (cx - rect.width / 2 - px),
        cy - rect.height / 2 - zr * (cy - rect.height / 2 - py)
      );
    },
    [setZoom, setPan]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Pan ────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = true;
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { x: panX, y: panY };
        e.preventDefault();
      }
    },
    [panX, panY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPanningRef.current) return;
      setPan(
        panOriginRef.current.x + e.clientX - panStartRef.current.x,
        panOriginRef.current.y + e.clientY - panStartRef.current.y
      );
    },
    [setPan]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);
  const handleCtxMenu = useCallback(
    (e: React.MouseEvent) => e.preventDefault(),
    []
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanningRef.current) return;
      if (e.button !== 0 || e.altKey) return;
      if (precisionPoints.length >= pointMode) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      placePoint(
        canvasToWorld(e.clientX - rect.left, e.clientY - rect.top, rect)
      );
    },
    [precisionPoints.length, pointMode, placePoint, canvasToWorld]
  );

  // ── Build draw function ────────────────────────────────────────────
  useEffect(() => {
    drawFnRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + panX, h / 2 + panY);
      ctx.scale(zoom, -zoom);

      const xMin = (-w / 2 - panX) / zoom;
      const xMax = (w / 2 - panX) / zoom;
      const yMin = (-h / 2 - panY) / zoom;
      const yMax = (h / 2 - panY) / zoom;

      // ── Grid ──────────────────────────────────────────────────────
      const gStep = GRID_SPACING;
      ctx.strokeStyle = "#f1f5f9";
      ctx.lineWidth = 1 / zoom;
      const gx0 = Math.floor(xMin / gStep) * gStep;
      const gx1 = Math.ceil(xMax / gStep) * gStep;
      const gy0 = Math.floor(yMin / gStep) * gStep;
      const gy1 = Math.ceil(yMax / gStep) * gStep;
      for (let x = gx0; x <= gx1; x += gStep) {
        ctx.beginPath();
        ctx.moveTo(x, gy0);
        ctx.lineTo(x, gy1);
        ctx.stroke();
      }
      for (let y = gy0; y <= gy1; y += gStep) {
        ctx.beginPath();
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
        ctx.stroke();
      }

      // ── Axes ──────────────────────────────────────────────────────
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(xMin, 0);
      ctx.lineTo(xMax, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, yMin);
      ctx.lineTo(0, yMax);
      ctx.stroke();

      // ── Origin marker ─────────────────────────────────────────────
      const omr = 3 / zoom;
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(0, 0, omr, 0, Math.PI * 2);
      ctx.fill();

      // ── Labels ─────────────────────────────────────────────────────
      const labelStep = niceStep(zoom);
      ctx.save();
      ctx.scale(1 / zoom, -1 / zoom);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      for (
        let x = Math.ceil(xMin / labelStep) * labelStep;
        x <= xMax;
        x += labelStep
      ) {
        if (Math.abs(x) < EPSILON) continue;
        ctx.fillText(String(Math.round(x)), x * zoom + 2, 14);
      }
      for (
        let y = Math.ceil(yMin / labelStep) * labelStep;
        y <= yMax;
        y += labelStep
      ) {
        if (Math.abs(y) < EPSILON) continue;
        ctx.fillText(String(Math.round(y)), 4, -y * zoom + 4);
      }
      ctx.restore();

      // ── Drawing helpers ───────────────────────────────────────────
      const lw = (n: number) => n / zoom;

      const dot = (
        p: Point,
        color: string,
        label: string,
        screenR = 5,
        shape: "circle" | "square" | "diamond" = "circle"
      ) => {
        const pr = screenR / zoom;
        ctx.fillStyle = color;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 / zoom;
        if (shape === "circle") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (shape === "square") {
          ctx.fillRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
          ctx.strokeRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
        } else {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + pr);
          ctx.lineTo(p.x + pr, p.y);
          ctx.lineTo(p.x, p.y - pr);
          ctx.lineTo(p.x - pr, p.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        if (label) {
          ctx.save();
          ctx.scale(1 / zoom, -1 / zoom);
          ctx.fillStyle = color;
          ctx.font = "bold 11px sans-serif";
          ctx.fillText(label, (p.x + pr) * zoom + 4, -p.y * zoom - 4);
          ctx.restore();
        }
      };

      const xMarker = (p: Point, color: string, label: string) => {
        const sz = 4 / zoom;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(p.x - sz, p.y - sz);
        ctx.lineTo(p.x + sz, p.y + sz);
        ctx.moveTo(p.x + sz, p.y - sz);
        ctx.lineTo(p.x - sz, p.y + sz);
        ctx.stroke();
        if (label) {
          ctx.save();
          ctx.scale(1 / zoom, -1 / zoom);
          ctx.fillStyle = color;
          ctx.font = "bold 10px sans-serif";
          ctx.fillText(label, (p.x + sz) * zoom + 4, -p.y * zoom - 4);
          ctx.restore();
        }
      };

      const seg = (
        p1: Point,
        p2: Point,
        color: string,
        width: number,
        dash: number[] = []
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw(width);
        ctx.setLineDash(dash.map((d) => d / zoom));
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const circ = (
        c: Point,
        rad: number,
        color: string,
        width: number,
        dash: number[] = []
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw(width);
        ctx.setLineDash(dash.map((d) => d / zoom));
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const arcSeg = (
        c: Point,
        rad: number,
        a0: number,
        a1: number,
        color: string,
        width: number,
        dash: number[] = []
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw(width);
        ctx.setLineDash(dash.map((d) => d / zoom));
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, a0, a1);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const infSeg = (
        ln: { p: Point; dir: Point },
        color: string,
        width: number,
        dash: number[] = []
      ) => {
        const ext = (Math.max(w, h) * 3) / zoom;
        seg(
          {
            x: ln.p.x - ln.dir.x * ext,
            y: ln.p.y - ln.dir.y * ext,
          },
          {
            x: ln.p.x + ln.dir.x * ext,
            y: ln.p.y + ln.dir.y * ext,
          },
          color,
          width,
          dash
        );
      };

      const anchor = (p: Point) => {
        const sz = 8 / zoom;
        const tick = sz / 2;
        ctx.fillStyle = "#374151";
        ctx.beginPath();
        ctx.moveTo(p.x - sz, p.y - sz);
        ctx.lineTo(p.x + sz, p.y - sz);
        ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#374151";
        ctx.lineWidth = lw(1);
        for (let ii = -sz; ii <= sz; ii += tick) {
          ctx.beginPath();
          ctx.moveTo(p.x + ii, p.y - sz);
          ctx.lineTo(p.x + ii - tick, p.y - sz - tick);
          ctx.stroke();
        }
      };

      // ════════════════════════════════════════════════════
      // L1: Precision points (construction step 1)
      // ════════════════════════════════════════════════════
      if (show(1)) {
        const pointColor = (idx: number) =>
          hl(1) ? "#f59e0b" : POINT_COLORS[idx];
        precisionPoints.forEach((p, idx) =>
          dot(p, pointColor(idx), `C${idx}`, 6)
        );
      }

      // Reduction pair highlight (construction step 2)
      if (show(2) && roles && precisionPoints.length >= 4) {
        if (hl(2)) {
          const pi = precisionPoints[roles.i];
          const pj = precisionPoints[roles.j];
          seg(pi, pj, "#f59e0b", 2, [6, 4]);
        }
      }

      // 5pt Step 2: highlight both reduction pairs
      if (is5pt && show(2) && precisionPoints.length >= 5 && (showConstruction || hl(2))) {
        const st5s2 = useSynthesisStore.getState();
        const p1s2 = st5s2.reductionPair1;
        const p2s2 = st5s2.reductionPair2;
        const hlc2 = hl(2) ? "#f59e0b" : "#94a3b8";
        seg(precisionPoints[p1s2[0]], precisionPoints[p1s2[1]], hlc2, 2, [6, 4]);
        seg(precisionPoints[p2s2[0]], precisionPoints[p2s2[1]], hlc2, 2, [6, 4]);
      }

      if (!result?.HR || !result.HC) {
        ctx.restore();
        return;
      }

      // ════════════════════════════════════════════════════
      // L2: Construction geometry
      // ════════════════════════════════════════════════════

      // Step 3: Bisector c_ij
      if (show(3) && showConstruction && result.bisectorCij) {
        infSeg(
          result.bisectorCij,
          hl(3) ? "#f59e0b" : "#f87171",
          1,
          [6, 4]
        );
      }

      // Step 4: HR
      if (show(4)) {
        dot(result.HR, hl(4) ? "#f59e0b" : "#dc2626", "H_R", 6, "square");
      }

      // Step 4 (5pt): bisector c_{pair2}
      if (is5pt && show(4) && showConstruction && result.bisectorCkl) {
        infSeg(result.bisectorCkl, hl(4) ? "#f59e0b" : "#f87171", 1, [6, 4]);
      }

      // Step 5 (4pt): R-circle
      if (show(5) && showConstruction && result.rCircle) {
        circ(
          result.rCircle.center,
          result.rCircle.radius,
          hl(5) ? "rgba(245,158,11,.5)" : "rgba(239,68,68,.25)",
          1,
          [4, 4]
        );
      }

      // Steps 5–6 (5pt): Overlay lines with dynamic labels
      if (is5pt && show(5) && showConstruction && result.overlayLines) {
        const ol = result.overlayLines as { a23: any; c1: any; c2: any };
        const hlOvl = hl(5) || hl(6);
        const st5ol = useSynthesisStore.getState();
        const p1ol = st5ol.reductionPair1;
        const p2ol = st5ol.reductionPair2;
        // a line (merged bisector) + label
        if (ol.a23) {
          infSeg(ol.a23, hlOvl ? "#f59e0b" : "rgba(100,116,139,.5)", 1.5, [4, 4]);
          const ld1 = 80 / zoom;
          ctx.save();
          ctx.scale(1 / zoom, -1 / zoom);
          ctx.fillStyle = hlOvl ? "#f59e0b" : "rgba(100,116,139,.9)";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText(`a${p1ol[0]}${p1ol[1]}/${p2ol[0]}${p2ol[1]}`, (ol.a23.p.x + ol.a23.dir.x * ld1) * zoom + 4, -(ol.a23.p.y + ol.a23.dir.y * ld1) * zoom - 4);
          ctx.restore();
        }
        // c1' line + label
        if (ol.c1) {
          infSeg(ol.c1, hlOvl ? "#f59e0b" : "rgba(59,130,246,.5)", 1, [3, 3]);
          const ld2 = 100 / zoom;
          ctx.save();
          ctx.scale(1 / zoom, -1 / zoom);
          ctx.fillStyle = hlOvl ? "#f59e0b" : "rgba(59,130,246,.9)";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText(`c${p1ol[0]}${p1ol[1]}'`, (ol.c1.p.x + ol.c1.dir.x * ld2) * zoom + 4, -(ol.c1.p.y + ol.c1.dir.y * ld2) * zoom - 4);
          ctx.restore();
        }
        // c2' line + label
        if (ol.c2) {
          infSeg(ol.c2, hlOvl ? "#f59e0b" : "rgba(34,197,94,.5)", 1, [3, 3]);
          const ld3 = 120 / zoom;
          ctx.save();
          ctx.scale(1 / zoom, -1 / zoom);
          ctx.fillStyle = hlOvl ? "#f59e0b" : "rgba(34,197,94,.9)";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText(`c${p2ol[0]}${p2ol[1]}'`, (ol.c2.p.x + ol.c2.dir.x * ld3) * zoom + 4, -(ol.c2.p.y + ol.c2.dir.y * ld3) * zoom - 4);
          ctx.restore();
        }
      }

      // Step 6 (5pt): Alpha arc visualization
      if (is5pt && hl(6) && result.bisectorCkl && result.overlayLines && result.HR) {
        const ol6 = result.overlayLines as { a23: any; c1: any; c2: any };
        const baseAngle = Math.atan2(result.bisectorCkl.dir.y, result.bisectorCkl.dir.x);
        const a23Angle = Math.atan2(ol6.a23.dir.y, ol6.a23.dir.x);
        // Dashed base direction line (before α rotation)
        infSeg({ p: result.HR, dir: result.bisectorCkl.dir }, "rgba(107,114,128,.4)", 1, [2, 4]);
        // Alpha arc
        const arcR = 40 / zoom;
        const stAlpha = useSynthesisStore.getState().alpha;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = lw(2);
        ctx.beginPath();
        ctx.arc(result.HR.x, result.HR.y, arcR, baseAngle, a23Angle, stAlpha < 0);
        ctx.stroke();
        // Label α
        const midAngle = (baseAngle + a23Angle) / 2;
        const labelR = arcR + 14 / zoom;
        ctx.save();
        ctx.scale(1 / zoom, -1 / zoom);
        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("α", (result.HR.x + Math.cos(midAngle) * labelR) * zoom, -(result.HR.y + Math.sin(midAngle) * labelR) * zoom);
        ctx.restore();
      }

      if (!result.A || !result.B1 || !result.lengths) {
        ctx.restore();
        return;
      }

      const Ai = result.A[refIdx];
      const Aj = roles ? result.A[roles.j] : undefined;
      const Am = roles ? result.A[roles.m] : undefined;
      const An = roles ? result.A[roles.n] : undefined;
      const Bi = result.B1;
      const Ci = precisionPoints[refIdx];
      if (!Ci || !Ai) {
        ctx.restore();
        return;
      }

      const lim = limitsRef.current;
      const fid = result.followerIsDriver ?? false;

      // ════════════════════════════════════════════════════
      // 4-point specific construction steps (6–14)
      // ════════════════════════════════════════════════════
      if (roles) {
        // Step 6: A[i], A[j] + r-arcs
        if (show(6)) {
          if (showConstruction && result.rCircle) {
            circ(
              precisionPoints[roles.i],
              r,
              hl(6) ? "rgba(245,158,11,.3)" : "rgba(59,130,246,.2)",
              1,
              [3, 3]
            );
            circ(
              precisionPoints[roles.j],
              r,
              hl(6) ? "rgba(245,158,11,.3)" : "rgba(34,197,94,.2)",
              1,
              [3, 3]
            );
          }
          const aColor = hl(6) ? "#f59e0b" : "#f59e0b";
          dot(Ai, aColor, `A${roles.i}`, 4);
          dot(Aj!, aColor, `A${roles.j}`, 4);
        }

        // Step 7: Orientation triangles (visual only in construction mode)
        if (hl(7)) {
          ctx.fillStyle = "rgba(245,158,11,.12)";
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = lw(1.5);
          ctx.beginPath();
          ctx.moveTo(precisionPoints[roles.i].x, precisionPoints[roles.i].y);
          ctx.lineTo(Ai.x, Ai.y);
          ctx.lineTo(result.HR.x, result.HR.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(precisionPoints[roles.j].x, precisionPoints[roles.j].y);
          ctx.lineTo(Aj!.x, Aj!.y);
          ctx.lineTo(result.HR.x, result.HR.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Step 8: Bisector a_ij + HC
        if (show(8)) {
          if (showConstruction && result.bisectorAij) {
            infSeg(
              result.bisectorAij,
              hl(8) ? "#f59e0b" : "#60a5fa",
              1,
              [6, 4]
            );
          }
          dot(result.HC, hl(8) ? "#f59e0b" : "#2563eb", "H_C", 6, "square");
        }

        // Step 9: Crank circle
        if (show(9) && showConstruction && result.crankCircle) {
          circ(
            result.crankCircle.center,
            result.crankCircle.radius,
            hl(9) ? "rgba(245,158,11,.5)" : "rgba(37,99,235,.25)",
            1,
            [4, 4]
          );
        }

        // Step 10: A[m], A[n]
        if (show(10)) {
          if (showConstruction) {
            circ(
              precisionPoints[roles.m],
              r,
              hl(10) ? "rgba(245,158,11,.3)" : "rgba(59,130,246,.15)",
              1,
              [3, 3]
            );
            circ(
              precisionPoints[roles.n],
              r,
              hl(10) ? "rgba(245,158,11,.3)" : "rgba(59,130,246,.15)",
              1,
              [3, 3]
            );
          }
          const aColor = hl(10) ? "#f59e0b" : "#f59e0b";
          dot(Am!, aColor, `A${roles.m}`, 4);
          dot(An!, aColor, `A${roles.n}`, 4);
        }

        // Step 11: Pm
        if (show(11) && result.Pm) {
          if (hl(11)) {
            ctx.fillStyle = "rgba(245,158,11,.1)";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = lw(1);
            ctx.beginPath();
            ctx.moveTo(Ci.x, Ci.y);
            ctx.lineTo(Ai.x, Ai.y);
            ctx.lineTo(result.Pm.x, result.Pm.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(precisionPoints[roles.m].x, precisionPoints[roles.m].y);
            ctx.lineTo(Am!.x, Am!.y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          if (showConstruction) {
            xMarker(result.Pm, hl(11) ? "#f59e0b" : "#6b7280", `P${roles.m}`);
          }
        }

        // Step 12: Pn
        if (show(12) && result.Pn) {
          if (hl(12)) {
            ctx.fillStyle = "rgba(245,158,11,.1)";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = lw(1);
            ctx.beginPath();
            ctx.moveTo(Ci.x, Ci.y);
            ctx.lineTo(Ai.x, Ai.y);
            ctx.lineTo(result.Pn.x, result.Pn.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(precisionPoints[roles.n].x, precisionPoints[roles.n].y);
            ctx.lineTo(An!.x, An!.y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          if (showConstruction) {
            xMarker(result.Pn, hl(12) ? "#f59e0b" : "#6b7280", `P${roles.n}`);
          }
        }

        // Step 13: B[i] + circumcircle
        if (show(13)) {
          if (showConstruction && result.Pm && result.Pn) {
            circ(
              Bi,
              distance(Bi, result.HR),
              hl(13) ? "rgba(245,158,11,.4)" : "rgba(168,85,247,.2)",
              1,
              [3, 3]
            );
          }
          if (showConstruction && result.Pm) {
            circ(
              Ci,
              distance(precisionPoints[roles.m], result.HR),
              "rgba(107,114,128,.15)",
              1,
              [2, 4]
            );
            circ(
              Ai,
              distance(Am!, result.HR),
              "rgba(107,114,128,.15)",
              1,
              [2, 4]
            );
          }
          dot(Bi, hl(13) ? "#f59e0b" : "#10b981", `B${roles.i}`, 6, "diamond");
        }

        // Step 14: B[j], B[m], B[n]
        if (show(14) && result.B) {
          for (const k of [roles.j, roles.m, roles.n]) {
            const Bk = result.B[k];
            if (Bk) {
              dot(
                Bk,
                hl(14) ? "#f59e0b" : "#10b981",
                `B${k}`,
                4,
                "diamond"
              );
            }
          }
        }
      } // end if (roles) — 4-point specific

      // ════════════════════════════════════════════════════
      // 5-point construction steps (7–16) + normal mode
      // ════════════════════════════════════════════════════
      if (is5pt) {
        const st5 = useSynthesisStore.getState();
        const p1 = st5.reductionPair1;
        const p2 = st5.reductionPair2;
        const usedSet5 = new Set([...p1, ...p2]);
        const refPtIdx = [0, 1, 2, 3, 4].find((x) => !usedSet5.has(x)) ?? 0;
        const remaining5 = [0, 1, 2, 3, 4].filter(
          (x) => x !== p1[0] && x !== p2[0]
        );

        // Step 7: A_{p1a} + r-arc from C_{p1a} on c₁′
        if (show(7) && result.A?.[p1[0]]) {
          if (showConstruction) {
            circ(
              precisionPoints[p1[0]], r,
              hl(7) ? "rgba(245,158,11,.3)" : "rgba(59,130,246,.2)", 1, [3, 3]
            );
          }
          dot(result.A[p1[0]], hl(7) ? "#f59e0b" : "#f59e0b", `A${p1[0]}`, 4);
        }

        // Step 8: A_{p2a} + r-arc + orientation triangles
        if (show(8) && result.A?.[p2[0]]) {
          if (showConstruction) {
            circ(
              precisionPoints[p2[0]], r,
              hl(8) ? "rgba(245,158,11,.3)" : "rgba(34,197,94,.2)", 1, [3, 3]
            );
          }
          dot(result.A[p2[0]], hl(8) ? "#f59e0b" : "#f59e0b", `A${p2[0]}`, 4);
          if (hl(8) && result.A[p1[0]]) {
            ctx.fillStyle = "rgba(245,158,11,.12)";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = lw(1.5);
            ctx.beginPath();
            ctx.moveTo(precisionPoints[p1[0]].x, precisionPoints[p1[0]].y);
            ctx.lineTo(result.A[p1[0]].x, result.A[p1[0]].y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(precisionPoints[p2[0]].x, precisionPoints[p2[0]].y);
            ctx.lineTo(result.A[p2[0]].x, result.A[p2[0]].y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
        }

        // Step 9: bisector a₁₂ + H_C
        if (show(9)) {
          if (showConstruction && result.bisectorAij) {
            infSeg(result.bisectorAij, hl(9) ? "#f59e0b" : "#60a5fa", 1, [6, 4]);
          }
          dot(result.HC, hl(9) ? "#f59e0b" : "#2563eb", "H_C", 6, "square");
        }

        // Step 10: Crank circle
        if (show(10) && showConstruction && result.crankCircle) {
          circ(
            result.crankCircle.center, result.crankCircle.radius,
            hl(10) ? "rgba(245,158,11,.5)" : "rgba(37,99,235,.25)", 1, [4, 4]
          );
        }

        // Step 11: Remaining crank pins
        if (show(11) && result.A) {
          for (const k of remaining5) {
            if (result.A[k]) {
              if (showConstruction) {
                circ(
                  precisionPoints[k], r,
                  hl(11) ? "rgba(245,158,11,.3)" : "rgba(59,130,246,.15)", 1, [3, 3]
                );
              }
              dot(result.A[k], hl(11) ? "#f59e0b" : "#f59e0b", `A${k}`, 4);
            }
          }
        }

        // Step 12: Combined inversion point [p2a,p2b]
        if (show(12) && result.Pm) {
          if (hl(12) && result.A?.[p1[0]] && result.A?.[p2[0]]) {
            ctx.fillStyle = "rgba(245,158,11,.1)";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = lw(1);
            ctx.beginPath();
            ctx.moveTo(precisionPoints[p1[0]].x, precisionPoints[p1[0]].y);
            ctx.lineTo(result.A[p1[0]].x, result.A[p1[0]].y);
            ctx.lineTo(result.Pm.x, result.Pm.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(precisionPoints[p2[0]].x, precisionPoints[p2[0]].y);
            ctx.lineTo(result.A[p2[0]].x, result.A[p2[0]].y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
          if (showConstruction) {
            xMarker(result.Pm, hl(12) ? "#f59e0b" : "#6b7280", `[${p2[0]},${p2[1]}]`);
          }
        }

        // Step 13: Reference inversion point
        if (show(13) && result.Pn) {
          if (hl(13) && result.A?.[p1[0]] && result.A?.[refPtIdx]) {
            ctx.fillStyle = "rgba(245,158,11,.1)";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = lw(1);
            ctx.beginPath();
            ctx.moveTo(precisionPoints[p1[0]].x, precisionPoints[p1[0]].y);
            ctx.lineTo(result.A[p1[0]].x, result.A[p1[0]].y);
            ctx.lineTo(result.Pn.x, result.Pn.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(precisionPoints[refPtIdx].x, precisionPoints[refPtIdx].y);
            ctx.lineTo(result.A[refPtIdx].x, result.A[refPtIdx].y);
            ctx.lineTo(result.HR.x, result.HR.y);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
          }
          if (showConstruction) {
            xMarker(result.Pn, hl(13) ? "#f59e0b" : "#6b7280", `Pt${refPtIdx}`);
          }
        }

        // Step 14: B₁ + circumcircle
        if (show(14)) {
          if (showConstruction && result.Pm && result.Pn) {
            circ(
              Bi, distance(Bi, result.HR),
              hl(14) ? "rgba(245,158,11,.4)" : "rgba(168,85,247,.2)", 1, [3, 3]
            );
          }
          dot(Bi, hl(14) ? "#f59e0b" : "#10b981", `B${p1[0]}`, 6, "diamond");
        }

        // Step 16: Remaining B positions
        if (show(16) && result.B) {
          const otherIdx5 = [0, 1, 2, 3, 4].filter((x) => x !== p1[0]);
          for (const k of otherIdx5) {
            const Bk = result.B[k];
            if (Bk) {
              dot(Bk, hl(16) ? "#f59e0b" : "#10b981", `B${k}`, 4, "diamond");
            }
          }
        }
      } // end 5-point construction

      // Ground anchors + ground link
      if (show(stepGround)) {
        anchor(result.HC);
        anchor(result.HR);
        seg(result.HC, result.HR, hl(stepGround) ? "#f59e0b" : "#1f2937", 3);
      }

      // ════════════════════════════════════════════════════
      // L3: Coupler curve + valid arc (step 16 in construction, always in normal)
      // ════════════════════════════════════════════════════
      if (show(stepVerify) && showCouplerCurve) {
        if (fid) {
          circ(result.HR, result.lengths.follower, "rgba(34,197,94,.4)", 2);
        } else if (lim && !lim.canFullRotate && lim.halfSpan > EPSILON) {
          arcSeg(
            result.HC,
            result.lengths.crank,
            lim.lo,
            lim.hi,
            "rgba(34,197,94,.5)",
            2.5
          );
          arcSeg(
            result.HC,
            result.lengths.crank,
            lim.hi,
            lim.lo + 2 * Math.PI,
            "rgba(239,68,68,.2)",
            1.5,
            [4, 4]
          );
          for (const ang of [lim.lo, lim.hi])
            dot(
              {
                x: result.HC.x + result.lengths.crank * Math.cos(ang),
                y: result.HC.y + result.lengths.crank * Math.sin(ang),
              },
              "#ef4444",
              "",
              3
            );
        }

        if (couplerCurve.length > 1) {
          ctx.strokeStyle = hl(stepVerify)
            ? "rgba(245,158,11,.8)"
            : "rgba(245,158,11,.55)";
          ctx.lineWidth = lw(1.5);
          ctx.beginPath();
          ctx.moveTo(couplerCurve[0].x, couplerCurve[0].y);
          for (let ii = 1; ii < couplerCurve.length; ii++)
            ctx.lineTo(couplerCurve[ii].x, couplerCurve[ii].y);
          ctx.stroke();
        }
      }

      // ════════════════════════════════════════════════════
      // L4: Ghost poses (step 16 in construction, always in normal)
      // ════════════════════════════════════════════════════
      if (show(stepVerify) && showGhosts) {
        ghostPoses.forEach((pose, idx) => {
          if (!pose) return;
          const gc = "rgba(100,116,139,.25)";
          seg(result.HC!, pose.A, gc, 2);
          seg(result.HR!, pose.B, gc, 2);
          ctx.fillStyle = "rgba(245,158,11,.07)";
          ctx.strokeStyle = gc;
          ctx.lineWidth = lw(1);
          ctx.beginPath();
          ctx.moveTo(pose.A.x, pose.A.y);
          ctx.lineTo(pose.B.x, pose.B.y);
          ctx.lineTo(pose.C.x, pose.C.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Ghost index maps directly to point index (generated in order 0..N-1)
          const pointIdx = idx;
          dot(pose.C, POINT_COLORS[pointIdx] ?? "#64748b", "", 3);
        });
      }

      // ════════════════════════════════════════════════════
      // L5: Active pose (skip in construction mode)
      // ════════════════════════════════════════════════════
      if (cs === 0 || cs >= stepGround) {
        const theta = animRef.current.crankAngle;
        const animPose = fid
          ? solvePositionInverse(
              result.HC,
              result.HR,
              result.lengths.crank,
              result.lengths.coupler,
              result.lengths.follower,
              Ai,
              Bi,
              Ci,
              theta,
              branch
            )
          : solvePosition(
              result.HC,
              result.HR,
              result.lengths.crank,
              result.lengths.coupler,
              result.lengths.follower,
              Ai,
              Bi,
              Ci,
              theta,
              branch
            );

        if (animPose) {
          // Crank link (HC → A) — blue
          seg(result.HC, animPose.A, "#2563eb", 3);
          // Follower link (HR → B) — red (per spec)
          seg(result.HR, animPose.B, "#dc2626", 3);

          // Detect and mark link crossing (regardless of configuration)
          {
            const crossing = segmentIntersection(
              result.HC,
              animPose.A,
              result.HR,
              animPose.B
            );
            if (crossing) {
              ctx.strokeStyle = "#f97316";
              ctx.lineWidth = lw(2);
              ctx.beginPath();
              ctx.arc(crossing.x, crossing.y, 5 / zoom, 0, Math.PI * 2);
              ctx.stroke();
              ctx.save();
              ctx.scale(1 / zoom, -1 / zoom);
              ctx.fillStyle = "#f97316";
              ctx.font = "bold 12px sans-serif";
              ctx.textAlign = "center";
              ctx.fillText(
                "⊗",
                crossing.x * zoom,
                -crossing.y * zoom + 4
              );
              ctx.restore();
            }
          }

          // Coupler triangle (A → B → C)
          ctx.fillStyle = "rgba(245,158,11,.15)";
          ctx.strokeStyle = "#d97706";
          ctx.lineWidth = lw(2.5);
          ctx.beginPath();
          ctx.moveTo(animPose.A.x, animPose.A.y);
          ctx.lineTo(animPose.B.x, animPose.B.y);
          ctx.lineTo(animPose.C.x, animPose.C.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          dot(animPose.A, "#2563eb", "", 4);
          dot(animPose.B, "#dc2626", "", 4);
          dot(animPose.C, "#d97706", "C", 4);
        } else {
          // Dead-zone indicator
          if (fid) {
            const deadB = {
              x: result.HR.x + result.lengths.follower * Math.cos(theta),
              y: result.HR.y + result.lengths.follower * Math.sin(theta),
            };
            seg(result.HR, deadB, "rgba(239,68,68,.4)", 2, [4, 4]);
            dot(deadB, "#ef4444", "✕", 4);
          } else {
            const deadA = {
              x: result.HC.x + result.lengths.crank * Math.cos(theta),
              y: result.HC.y + result.lengths.crank * Math.sin(theta),
            };
            seg(result.HC, deadA, "rgba(239,68,68,.4)", 2, [4, 4]);
            dot(deadA, "#ef4444", "✕", 4);
          }
        }
      }

      ctx.restore();
    };
  }, [
    result,
    precisionPoints,
    showConstruction,
    showGhosts,
    showCouplerCurve,
    r,
    couplerCurve,
    ghostPoses,
    branch,
    followerIsDriver,
    zoom,
    panX,
    panY,
    configuration,
    cs,
    roles,
    refIdx,
    hl,
    show,
  ]);

  // ── Single stable rAF loop ─────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const loop = (time: number) => {
      if (!alive) return;
      const dt =
        lastTRef.current > 0
          ? Math.min((time - lastTRef.current) / 1000, 0.05)
          : 0;
      lastTRef.current = time;

      const st = animRef.current;
      const lim = limitsRef.current;

      // Don't animate in construction mode
      if (st.isPlaying && lim && constructionStep === 0) {
        const { angle, direction } = rockerTick(
          st.crankAngle,
          st.rockerDirection,
          dt,
          st.speedRPM,
          lim
        );
        const dirChanged = direction !== st.rockerDirection;
        st.crankAngle = angle;
        st.rockerDirection = direction;
        setCrankAngle(angle);
        if (dirChanged) setRockerDirection(direction);
      }

      drawFnRef.current();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [setCrankAngle, setRockerDirection, constructionStep]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleCtxMenu}
        className="w-full h-full"
        style={{
          cursor: isPanning
            ? "grabbing"
            : precisionPoints.length < pointMode
              ? "crosshair"
              : "default",
        }}
      />
      <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-10">
        <button
          onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.2))}
          className="w-8 h-8 bg-white border border-gray-300 rounded shadow text-lg hover:bg-gray-50 flex items-center justify-center"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.2))}
          className="w-8 h-8 bg-white border border-gray-300 rounded shadow text-lg hover:bg-gray-50 flex items-center justify-center"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="w-8 h-8 bg-white border border-gray-300 rounded shadow text-xs hover:bg-gray-50 flex items-center justify-center"
          title="Reset view"
        >
          ⊙
        </button>
        <div className="text-xs text-center text-gray-500 bg-white/80 rounded px-1">
          {Math.round(zoom * 100)}%
        </div>
      </div>
      <div className="absolute bottom-4 left-16 text-xs text-gray-400 pointer-events-none select-none">
        Scroll to zoom · Alt+drag or middle-drag to pan
      </div>
    </div>
  );
}