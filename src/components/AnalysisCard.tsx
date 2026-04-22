import React, { useState } from "react";
import type { SynthesisResult } from "../lib/synthesis/pipeline";

interface Props {
  result: SynthesisResult | null;
}

export default function AnalysisCard({ result }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  if (!result) return null;

  const grashofColors: Record<string, string> = {
    "Crank-Rocker": "text-green-700 bg-green-50 border-green-200",
    "Double-Crank": "text-blue-700 bg-blue-50 border-blue-200",
    "Rocker-Crank": "text-purple-700 bg-purple-50 border-purple-200",
    "Double-Rocker (Grashof)":
      "text-yellow-700 bg-yellow-50 border-yellow-200",
    "Change-Point": "text-orange-700 bg-orange-50 border-orange-200",
    "Double-Rocker (Non-Grashof)": "text-red-700 bg-red-50 border-red-200",
  };

  const rotationLabel = (r: SynthesisResult): React.ReactNode => {
    if (r.status !== "success") return null;

    if (r.followerIsDriver) {
      return (
        <span className="text-purple-600">
          ↺ Output link: full rotation · Input link: rocker
        </span>
      );
    }

    if (r.canFullRotate) {
      if (r.grashof === "Double-Crank") {
        return (
          <span className="text-blue-600">
            ↺ Input link: full rotation · Output link: full rotation
          </span>
        );
      }
      return (
        <span className="text-green-600">
          ↺ Input link: full rotation · Output link: rocker
        </span>
      );
    }

    return (
      <span className="text-amber-600">
        ↔ Input link: rocker (limited swing)
      </span>
    );
  };

  return (
    <div className="bg-white border border-gray-200 p-4 shadow-lg rounded-lg text-sm w-full">
      <div
        className="flex justify-between items-center cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-sm font-semibold text-gray-800">Linkage Analysis</h3>
        <span className="text-gray-400 text-sm">{isOpen ? "▾" : "▸"}</span>
      </div>

      {isOpen && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          {result.status === "error" && (
            <div className="text-red-600 text-xs">
              ❌ {result.stage ? `[${result.stage}] ` : ""}
              {result.error}
            </div>
          )}

          {result.status === "success" && result.lengths && (
            <>
              {/* Link lengths */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-gray-500">Ground:</span>
                <span className="text-right font-mono">
                  {result.lengths.ground.toFixed(2)}
                </span>
                <span className="text-gray-500">Crank:</span>
                <span className="text-right font-mono">
                  {result.lengths.crank.toFixed(2)}
                </span>
                <span className="text-gray-500">Coupler AB:</span>
                <span className="text-right font-mono">
                  {result.lengths.coupler.toFixed(2)}
                </span>
                <span className="text-gray-500">Follower:</span>
                <span className="text-right font-mono">
                  {result.lengths.follower.toFixed(2)}
                </span>
              </div>

              {/* Coupler triangle */}
              {result.couplerTriangle && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2 pt-2 border-t border-gray-100">
                  <span className="text-gray-400">Coupler AC (r):</span>
                  <span className="text-right font-mono text-gray-400">
                    {result.couplerTriangle.AC.toFixed(2)}
                  </span>
                  <span className="text-gray-400">Coupler BC:</span>
                  <span className="text-right font-mono text-gray-400">
                    {result.couplerTriangle.BC.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Reduction pair, reference pose, configuration */}
              {result.roles && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2 pt-2 border-t border-gray-100">
                  <span className="text-gray-400">Reduction pair:</span>
                  <span className="text-right font-mono text-gray-500">
                    C{result.roles.i}, C{result.roles.j}
                  </span>
                  <span className="text-gray-400">Reference pose:</span>
                  <span className="text-right font-mono text-gray-500">
                    position {result.roles.refIdx}
                  </span>
                </div>
              )}

              {/* Grashof */}
              {result.grashof && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${
                      grashofColors[result.grashof] || ""
                    }`}
                  >
                    {result.grashof}
                  </span>
                  {result.grashofValues && (
                    <div className="text-xs text-gray-400 mt-1 font-mono">
                      s+ℓ = {result.grashofValues.sPlusL.toFixed(2)}, p+q ={" "}
                      {result.grashofValues.pPlusQ.toFixed(2)}
                    </div>
                  )}
                  {result.grashofDetail && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-1">
                      <span className="text-gray-400">Grashof?</span>
                      <span className="text-right">
                        {result.grashofDetail.grashof ? "✅ Yes" : "❌ No"}
                      </span>
                      <span className="text-gray-400">Shortest link:</span>
                      <span className="text-right font-mono text-gray-500">
                        {result.grashofDetail.shortest.name}
                      </span>
                    </div>
                  )}
                  <div className="text-xs mt-1">
                    <span className="text-gray-400">Valid crank range: </span>
                    <span className="font-mono text-gray-500">
                      {result.canFullRotate ? "Full 360°" : "Limited swing"}
                    </span>
                  </div>
                  <div className="text-xs mt-1">{rotationLabel(result)}</div>
                </div>
              )}

              {/* Status */}
              <div className="mt-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-green-600">✅ Valid mechanism</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}