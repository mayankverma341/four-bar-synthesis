import React from "react";
import { useSynthesisStore } from "../store/useSynthesisStore";
import type { SynthesisResult } from "../lib/synthesis/pipeline";
import { deriveRoles } from "../lib/synthesis/pipeline";

interface Props {
  result: SynthesisResult | null;
}

const SliderControl: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <label className="flex flex-col text-sm gap-1">
    <span className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono text-gray-500">{value.toFixed(1)}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      className="w-full accent-blue-600"
    />
  </label>
);

const Toggle: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex items-start gap-2 cursor-pointer select-none group">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-blue-600 mt-0.5 flex-shrink-0"
    />
    <span>
      <span className="text-sm text-gray-700 group-hover:text-gray-900">
        {label}
      </span>
      <span className="block text-xs text-gray-400 leading-snug mt-0.5">
        {description}
      </span>
    </span>
  </label>
);

function AnimationNotice({ result }: { result: SynthesisResult | null }) {
  if (result?.status !== "success") return null;

  if (result.followerIsDriver) {
    return (
      <div className="text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-200">
        ↺ Rocker-Crank — output link (follower) makes full rotation
      </div>
    );
  }

  if (result.canFullRotate && result.grashof === "Double-Crank") {
    return (
      <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200">
        ↺ Double-Crank — both links make full rotation
      </div>
    );
  }

  if (result.canFullRotate) {
    return (
      <div className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
        ↺ Crank-Rocker — input link makes full rotation
      </div>
    );
  }

  return (
    <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
      ↔ Rocker mode — input link oscillates between limits
    </div>
  );
}

// All 4-point reduction pair combinations
const REDUCTION_PAIRS_4PT: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

// 5-point: grouped by left-out point
const LEFT_OUT_OPTIONS = [0, 1, 2, 3, 4];

function getPairCombinations(
  leftOut: number
): { pair1: [number, number]; pair2: [number, number] }[] {
  const available = [0, 1, 2, 3, 4].filter((x) => x !== leftOut);
  // Generate all ways to split 4 elements into 2 pairs
  const combos: { pair1: [number, number]; pair2: [number, number] }[] = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const pair1: [number, number] = [available[i], available[j]];
      const remaining = available.filter((x) => x !== available[i] && x !== available[j]);
      const pair2: [number, number] = [remaining[0], remaining[1]];
      combos.push({ pair1, pair2 });
    }
  }
  return combos;
}

const POINT_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#ef4444"];

export default function ControlPanel({ result }: Props) {
  const s = useSynthesisStore();
  const pointMode = s.pointMode;

  const roles = deriveRoles(s.reductionPair);
  const { i, j, m, n } = roles;

  // Derive left-out point from current 5-point pairs
  const leftOutPoint = React.useMemo(() => {
    const used = new Set([...s.reductionPair1, ...s.reductionPair2]);
    return [0, 1, 2, 3, 4].find((x) => !used.has(x)) ?? 0;
  }, [s.reductionPair1, s.reductionPair2]);

  const pairCombinations = React.useMemo(
    () => getPairCombinations(leftOutPoint),
    [leftOutPoint]
  );

  const ready = s.precisionPoints.length >= pointMode;

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-800">Linkage Synthesis</h1>
        <p className="text-xs text-gray-400 mt-1">
          Burmester Reduction Method
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-sm mb-2 text-gray-700">
          Synthesis Mode
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => s.setPointMode(4)}
            className={`flex-1 py-1.5 text-sm rounded border transition-colors font-medium ${
              pointMode === 4
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            4-Point
          </button>
          <button
            onClick={() => s.setPointMode(5)}
            className={`flex-1 py-1.5 text-sm rounded border transition-colors font-medium ${
              pointMode === 5
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            5-Point
          </button>
        </div>
      </div>

      {/* Precision Points */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-sm mb-2 text-gray-700">
          Precision Points
        </h2>
        {s.precisionPoints.length < pointMode && (
          <p className="text-xs text-gray-500 mb-2">
            Click canvas to place{" "}
            {pointMode - s.precisionPoints.length} more point
            {pointMode - s.precisionPoints.length !== 1 ? "s" : ""}
          </p>
        )}
        <div className="space-y-1 mb-3">
          {s.precisionPoints.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs font-mono">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0 inline-block"
                style={{ backgroundColor: POINT_COLORS[idx] }}
              />
              C{idx}: ({p.x.toFixed(1)}, {p.y.toFixed(1)})
            </div>
          ))}
        </div>
        <button
          onClick={s.clearAll}
          className="w-full py-1.5 text-sm bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100 transition-colors"
        >
          Clear All
        </button>
      </div>

      {ready && (
        <>
          {/* ── 4-POINT CONTROLS ── */}
          {pointMode === 4 && (
            <>
              {/* Reduction Pair Selector */}
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold text-sm mb-2 text-gray-700">
                  Reduction Pair
                </h2>
                <p className="text-xs text-gray-400 mb-2">
                  H_R lies on the perpendicular bisector of the selected pair.
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {REDUCTION_PAIRS_4PT.map(([a, b]) => {
                    const isActive =
                      s.reductionPair[0] === a && s.reductionPair[1] === b;
                    return (
                      <button
                        key={`${a}-${b}`}
                        onClick={() => s.setReductionPair([a, b])}
                        className={`px-2 py-1.5 text-xs rounded border transition-colors font-mono ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-600 font-semibold"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        C{a}, C{b}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Synthesis Parameters */}
              <div className="p-4 border-b border-gray-200 space-y-3">
                <h2 className="font-semibold text-sm text-gray-700">
                  Synthesis Parameters
                </h2>
                <SliderControl
                  label="R (R-circle radius)"
                  value={s.R}
                  min={1}
                  max={200}
                  onChange={s.setR}
                />
                <SliderControl
                  label="r (coupler dist)"
                  value={s.r}
                  min={1}
                  max={200}
                  onChange={s.setr}
                />
                <SliderControl
                  label="H_R offset"
                  value={s.hrOffset}
                  min={-300}
                  max={300}
                  onChange={s.setHrOffset}
                />
                <SliderControl
                  label="H_C offset"
                  value={s.hcOffset}
                  min={-300}
                  max={300}
                  onChange={s.setHcOffset}
                />
              </div>

              {/* Branch Toggles */}
              <div className="p-4 border-b border-gray-200 space-y-2">
                <h2 className="font-semibold text-sm text-gray-700">
                  Branch Toggles
                </h2>
                <Toggle
                  label={`Swap A${i}/A${j} side`}
                  description={`Flips which intersection of the r-arc and R-circle is used for A${i}`}
                  checked={s.swapAij}
                  onChange={s.setSwapAij}
                />
                <Toggle
                  label={`Swap A${m} branch`}
                  description={`Flips which intersection of the r-arc and crank circle is used for A${m}`}
                  checked={s.swapAm}
                  onChange={s.setSwapAm}
                />
                <Toggle
                  label={`Swap A${n} branch`}
                  description={`Flips which intersection of the r-arc and crank circle is used for A${n}`}
                  checked={s.swapAn}
                  onChange={s.setSwapAn}
                />
              </div>
            </>
          )}

          {/* ── 5-POINT CONTROLS ── */}
          {pointMode === 5 && (
            <>
              {/* Reduction Pair Selector (5-point) */}
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold text-sm mb-2 text-gray-700">
                  Reduction Pairs
                </h2>
                <p className="text-xs text-gray-400 mb-2">
                  H_R = intersection of two perpendicular bisectors.
                </p>
                {/* Step 1: Choose left-out point */}
                <label className="text-xs text-gray-600 block mb-1">
                  Reference (left-out) point:
                </label>
                <div className="flex gap-1.5 mb-3">
                  {LEFT_OUT_OPTIONS.map((lo) => (
                    <button
                      key={lo}
                      onClick={() => {
                        const combos = getPairCombinations(lo);
                        if (combos.length > 0) {
                          s.setReductionPair1(combos[0].pair1);
                          s.setReductionPair2(combos[0].pair2);
                        }
                      }}
                      className={`flex-1 py-1 text-xs rounded border transition-colors font-mono ${
                        leftOutPoint === lo
                          ? "bg-blue-600 text-white border-blue-600 font-semibold"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      C{lo}
                    </button>
                  ))}
                </div>
                {/* Step 2: Choose pair combination within group */}
                <label className="text-xs text-gray-600 block mb-1">
                  Pair combination:
                </label>
                <div className="space-y-1">
                  {pairCombinations.map((combo, idx) => {
                    const isActive =
                      s.reductionPair1[0] === combo.pair1[0] &&
                      s.reductionPair1[1] === combo.pair1[1] &&
                      s.reductionPair2[0] === combo.pair2[0] &&
                      s.reductionPair2[1] === combo.pair2[1];
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          s.setReductionPair1(combo.pair1);
                          s.setReductionPair2(combo.pair2);
                        }}
                        className={`w-full px-2 py-1.5 text-xs rounded border transition-colors font-mono text-left ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-600 font-semibold"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        (C{combo.pair1[0]}C{combo.pair1[1]}) + (C{combo.pair2[0]}C{combo.pair2[1]})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Synthesis Parameters (5-point) */}
              <div className="p-4 border-b border-gray-200 space-y-3">
                <h2 className="font-semibold text-sm text-gray-700">
                  Synthesis Parameters
                </h2>
                <SliderControl
                  label="r (coupler dist)"
                  value={s.r}
                  min={1}
                  max={200}
                  onChange={s.setr}
                />
                <SliderControl
                  label="α (overlay rotation)"
                  value={s.alpha}
                  min={-180}
                  max={180}
                  step={0.5}
                  onChange={s.setAlpha}
                />
              </div>

              {/* Branch Toggles (5-point) */}
              <div className="p-4 border-b border-gray-200 space-y-2">
                <h2 className="font-semibold text-sm text-gray-700">
                  Branch Toggles
                </h2>
                <Toggle
                  label={`Swap A${s.reductionPair1[0]} branch`}
                  description={`Flips which intersection on c₁′ is used for A${s.reductionPair1[0]}`}
                  checked={s.swapA1_5pt}
                  onChange={s.setSwapA1_5pt}
                />
                {(() => {
                  const remaining = [0, 1, 2, 3, 4].filter(
                    (x) => x !== s.reductionPair1[0] && x !== s.reductionPair2[0]
                  );
                  return remaining.map((k, idx) => {
                    const swapVal = [s.swapA3_5pt, s.swapA4_5pt, s.swapA5_5pt][idx];
                    const setFn = [s.setSwapA3_5pt, s.setSwapA4_5pt, s.setSwapA5_5pt][idx];
                    return (
                      <Toggle
                        key={k}
                        label={`Swap A${k} branch`}
                        description={`Flips which intersection on crank circle is used for A${k}`}
                        checked={swapVal}
                        onChange={setFn}
                      />
                    );
                  });
                })()}
              </div>
            </>
          )}

          {/* Configuration Toggle */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-sm mb-2 text-gray-700">
              Configuration
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => s.setConfiguration("open")}
                className={`flex-1 py-1.5 text-sm rounded border transition-colors ${
                  s.configuration === "open"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                ● Open
              </button>
              <button
                onClick={() => s.setConfiguration("crossed")}
                className={`flex-1 py-1.5 text-sm rounded border transition-colors ${
                  s.configuration === "crossed"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                ✕ Crossed
              </button>
            </div>
          </div>

          {/* Display */}
          <div className="p-4 border-b border-gray-200 space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">Display</h2>
            <Toggle
              label="Show construction lines"
              description="Bisectors, R-circle, r-arcs, crank circle, inversion points"
              checked={s.showConstruction}
              onChange={s.setShowConstruction}
            />
            <Toggle
              label="Show ghost poses"
              description="Crank pins, coupler pins, and the coupler triangle at each precision point"
              checked={s.showGhosts}
              onChange={s.setShowGhosts}
            />
            <Toggle
              label="Show coupler curve"
              description="Full path traced by coupler point C, and the valid / dead-zone arc"
              checked={s.showCouplerCurve}
              onChange={s.setShowCouplerCurve}
            />
          </div>

          {/* Animation */}
          <div className="p-4 border-b border-gray-200 space-y-3">
            <h2 className="font-semibold text-sm text-gray-700">Animation</h2>
            <div className="flex gap-2">
              <button
                onClick={s.isPlaying ? s.pause : s.play}
                disabled={result?.status !== "success"}
                className="flex-1 py-1.5 text-sm rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              >
                {s.isPlaying ? "⏸ Pause" : "▶️ Play"}
              </button>
              <button
                onClick={() => s.resetAnimation(result?.startAngle ?? 0)}
                className="flex-1 py-1.5 text-sm rounded border bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 transition-colors"
              >
                🔄 Reset
              </button>
            </div>
            <SliderControl
              label="Speed (RPM)"
              value={s.speedRPM}
              min={1}
              max={120}
              onChange={s.setSpeed}
            />
            <div className="text-xs text-gray-500 font-mono">
              θ = {((s.crankAngle * 180) / Math.PI).toFixed(1)}°
            </div>
            <AnimationNotice result={result} />
          </div>

          {/* Construction Viewer button */}
          {result?.status === "success" && (
            <div className="p-4 border-b border-gray-200">
              <button
                onClick={() =>
                  s.setConstructionStep(s.constructionStep > 0 ? 0 : 1)
                }
                className="w-full py-1.5 text-sm rounded border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors"
              >
                {s.constructionStep > 0
                  ? "✕ Close Construction Steps"
                  : "🔍 Show Construction Steps"}
              </button>
            </div>
          )}

          {/* View Controls */}
          <div className="p-4 border-b border-gray-200 space-y-2">
            <h2 className="font-semibold text-sm text-gray-700">View</h2>
            <p className="text-xs text-gray-400">
              Scroll to zoom · Alt+drag or middle-drag to pan
            </p>
            <button
              onClick={s.resetView}
              className="w-full py-1.5 text-sm bg-gray-50 text-gray-700 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              Reset View (⊙)
            </button>
          </div>
        </>
      )}
    </div>
  );
}