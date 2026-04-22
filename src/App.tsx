import { useMemo } from "react";
import { useSynthesisStore } from "./store/useSynthesisStore";
import { runSynthesis } from "./lib/synthesis/pipeline";
import { runSynthesis5pt } from "./lib/synthesis/pipeline5pt";
import ControlPanel from "./components/ControlPanel";
import CanvasArea from "./components/CanvasArea";
import AnalysisCard from "./components/AnalysisCard";
import CoordinatesTable from "./components/CoordinatesTable";
import ConstructionViewer from "./components/ConstructionViewer";
import { areCoincident, areCollinear } from "./lib/geometry/math";

export default function App() {
  const pts = useSynthesisStore((s) => s.precisionPoints);
  const pointMode = useSynthesisStore((s) => s.pointMode);
  const R = useSynthesisStore((s) => s.R);
  const r = useSynthesisStore((s) => s.r);
  const hrOffset = useSynthesisStore((s) => s.hrOffset);
  const hcOffset = useSynthesisStore((s) => s.hcOffset);
  const swapAij = useSynthesisStore((s) => s.swapAij);
  const swapAm = useSynthesisStore((s) => s.swapAm);
  const swapAn = useSynthesisStore((s) => s.swapAn);
  const reductionPair = useSynthesisStore((s) => s.reductionPair);
  const constructionStep = useSynthesisStore((s) => s.constructionStep);

  // 5-point params
  const alpha = useSynthesisStore((s) => s.alpha);
  const reductionPair1 = useSynthesisStore((s) => s.reductionPair1);
  const reductionPair2 = useSynthesisStore((s) => s.reductionPair2);
  const swapA1_5pt = useSynthesisStore((s) => s.swapA1_5pt);
  const swapA3_5pt = useSynthesisStore((s) => s.swapA3_5pt);
  const swapA4_5pt = useSynthesisStore((s) => s.swapA4_5pt);
  const swapA5_5pt = useSynthesisStore((s) => s.swapA5_5pt);

  const warnings = useMemo(() => {
    const w: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (areCoincident(pts[i], pts[j])) {
          w.push(`C${i} and C${j} are coincident.`);
        }
      }
    }
    if (pts.length >= 3) {
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          for (let k = j + 1; k < pts.length; k++) {
            if (areCollinear(pts[i], pts[j], pts[k])) {
              w.push(`C${i}, C${j}, C${k} are collinear.`);
            }
          }
        }
      }
    }
    return w;
  }, [pts]);

  const result = useMemo(() => {
    if (pts.length < pointMode) return null;
    if (warnings.length > 0) return null;

    if (pointMode === 5) {
      return runSynthesis5pt(
        pts,
        r,
        (alpha * Math.PI) / 180, // convert degrees → radians
        reductionPair1,
        reductionPair2,
        swapA1_5pt,
        swapA3_5pt,
        swapA4_5pt,
        swapA5_5pt
      );
    }

    return runSynthesis(
      pts as [any, any, any, any],
      R,
      r,
      hrOffset,
      hcOffset,
      swapAij,
      swapAm,
      swapAn,
      reductionPair
    );
  }, [
    pts,
    pointMode,
    R,
    r,
    hrOffset,
    hcOffset,
    swapAij,
    swapAm,
    swapAn,
    reductionPair,
    alpha,
    reductionPair1,
    reductionPair2,
    swapA1_5pt,
    swapA3_5pt,
    swapA4_5pt,
    swapA5_5pt,
    warnings,
  ]);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <ControlPanel result={result} />
      <div className="flex-1 relative">
        {warnings.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-white px-6 py-2 rounded-lg shadow-lg z-20 text-sm font-medium">
            ⚠️ {warnings.join(" ")}
          </div>
        )}
        {result?.status === "error" && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-2 rounded-lg shadow-lg z-20 text-sm font-medium max-w-lg text-center">
            ❌ {result.stage ? `[${result.stage}] ` : ""}
            {result.error}
          </div>
        )}
        <CanvasArea result={result} />
        <div className="absolute top-4 right-4 w-fit min-w-80 max-w-[28rem] flex flex-col gap-3 z-10 max-h-[calc(100%-2rem)] overflow-y-auto">
          <CoordinatesTable result={result} />
          <AnalysisCard result={result} />
        </div>
        {constructionStep > 0 && result?.status === "success" && (
          <ConstructionViewer result={result} />
        )}
      </div>
    </div>
  );
}
