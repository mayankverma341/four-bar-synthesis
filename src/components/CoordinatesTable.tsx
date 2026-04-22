import { useState } from "react";
import type { Point } from "../lib/geometry/math";
import type { SynthesisResult } from "../lib/synthesis/pipeline";
import { useSynthesisStore } from "../store/useSynthesisStore";

interface Props {
  result: SynthesisResult | null;
}

export default function CoordinatesTable({ result }: Props) {
  const pts = useSynthesisStore((s) => s.precisionPoints);
  const [isOpen, setIsOpen] = useState(true);

  const rows: {
    label: string;
    point: Point | undefined;
    color: string;
    description: string;
  }[] = [];

  const pointColors = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#ef4444"];

  // Precision points
  pts.forEach((p, i) =>
    rows.push({
      label: `C${i}`,
      point: p,
      color: pointColors[i],
      description: `Precision point ${i}`,
    })
  );

  const roles = result?.roles;

  // Pivots
  if (result?.HR)
    rows.push({
      label: "H_R",
      point: result.HR,
      color: "#dc2626",
      description: "Fixed pivot (follower)",
    });
  if (result?.HC)
    rows.push({
      label: "H_C",
      point: result.HC,
      color: "#2563eb",
      description: "Fixed pivot (crank)",
    });

  // A positions
  if (result?.A) {
    result.A.forEach((a, idx) => {
      if (!a) return;
      let roleLabel = `pose ${idx}`;
      if (roles) {
        roleLabel =
          idx === roles.i || idx === roles.j
            ? `reduction pose ${idx}`
            : `remaining pose ${idx}`;
      }
      rows.push({
        label: `A${idx}`,
        point: a,
        color: "#f59e0b",
        description: `Crank pin, ${roleLabel}`,
      });
    });
  }

  // B positions
  if (result?.B) {
    result.B.forEach((b, idx) => {
      if (b) {
        rows.push({
          label: `B${idx}`,
          point: b,
          color: "#10b981",
          description: `Coupler pin, pose ${idx}`,
        });
      }
    });
  } else if (result?.B1) {
    const refLabel = roles ? roles.i : 0;
    rows.push({
      label: `B${refLabel}`,
      point: result.B1,
      color: "#10b981",
      description: `Coupler pin, pose ${refLabel}`,
    });
  }

  // Inversion points
  if (result?.Pm) {
    const pmLabel = roles ? `P${roles.m}` : "P_combined";
    const pmDesc = roles ? `Inversion point for pose ${roles.m}` : "Combined inversion point";
    rows.push({
      label: pmLabel,
      point: result.Pm,
      color: "#6b7280",
      description: pmDesc,
    });
  }
  if (result?.Pn) {
    const pnLabel = roles ? `P${roles.n}` : "P_ref";
    const pnDesc = roles ? `Inversion point for pose ${roles.n}` : "Reference inversion point";
    rows.push({
      label: pnLabel,
      point: result.Pn,
      color: "#6b7280",
      description: pnDesc,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 p-3 shadow-lg rounded-lg text-xs w-full">
      <div
        className="flex justify-between items-center cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-sm font-semibold text-gray-800">Coordinates</h3>
        <span className="text-gray-400 text-sm">{isOpen ? "▾" : "▸"}</span>
      </div>
      {isOpen && (
        <div className="mt-2 pt-2 border-t border-gray-100 max-h-64 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-normal">Pt</th>
                <th className="text-right font-normal pl-3">x</th>
                <th className="text-right font-normal pl-3">y</th>
                <th className="text-left font-normal pl-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(
                (row) =>
                  row.point && (
                    <tr key={row.label} className="select-all">
                      <td className="py-0.5 whitespace-nowrap">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1"
                          style={{ backgroundColor: row.color }}
                        />
                        {row.label}
                      </td>
                      <td className="text-right font-mono pl-3">
                        {row.point.x.toFixed(1)}
                      </td>
                      <td className="text-right font-mono pl-3">
                        {row.point.y.toFixed(1)}
                      </td>
                      <td className="text-left pl-2 text-gray-400 whitespace-nowrap">
                        {row.description}
                      </td>
                    </tr>
                  )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
