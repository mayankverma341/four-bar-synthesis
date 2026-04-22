import { create } from "zustand";
import type { Point } from "../lib/geometry/math";

export interface SynthesisState {
  precisionPoints: Point[];

  // Mode: 4 or 5 precision points
  pointMode: 4 | 5;

  // Reduction pair (4-point: indices into precisionPoints, i < j)
  reductionPair: [number, number];

  // 5-point: two reduction pairs
  reductionPair1: [number, number];
  reductionPair2: [number, number];

  // Free choices (4-point)
  R: number;
  r: number;
  hrOffset: number;
  hcOffset: number;

  // Free choices (5-point)
  alpha: number; // overlay rotation

  // Branch toggles (4-point)
  swapAij: boolean;
  swapAm: boolean;
  swapAn: boolean;

  // Branch toggles (5-point)
  swapA1_5pt: boolean;
  swapA3_5pt: boolean;
  swapA4_5pt: boolean;
  swapA5_5pt: boolean;

  // Configuration
  configuration: "open" | "crossed";

  // Display
  showConstruction: boolean;
  showGhosts: boolean;
  showCouplerCurve: boolean;

  // Animation
  isPlaying: boolean;
  speedRPM: number;
  crankAngle: number;
  rockerDirection: 1 | -1;

  // View
  zoom: number;
  panX: number;
  panY: number;

  // Construction viewer
  constructionStep: number; // 0 = not open, 1–N = active step

  // Actions
  placePoint: (p: Point) => void;
  clearAll: () => void;
  setPointMode: (v: 4 | 5) => void;
  setR: (v: number) => void;
  setr: (v: number) => void;
  setHrOffset: (v: number) => void;
  setHcOffset: (v: number) => void;
  setAlpha: (v: number) => void;
  setSwapAij: (v: boolean) => void;
  setSwapAm: (v: boolean) => void;
  setSwapAn: (v: boolean) => void;
  setSwapA1_5pt: (v: boolean) => void;
  setSwapA3_5pt: (v: boolean) => void;
  setSwapA4_5pt: (v: boolean) => void;
  setSwapA5_5pt: (v: boolean) => void;
  setReductionPair: (pair: [number, number]) => void;
  setReductionPair1: (pair: [number, number]) => void;
  setReductionPair2: (pair: [number, number]) => void;
  setConfiguration: (v: "open" | "crossed") => void;
  setShowConstruction: (v: boolean) => void;
  setShowGhosts: (v: boolean) => void;
  setShowCouplerCurve: (v: boolean) => void;
  play: () => void;
  pause: () => void;
  resetAnimation: (startAngle?: number) => void;
  setSpeed: (rpm: number) => void;
  setCrankAngle: (angle: number) => void;
  setRockerDirection: (dir: 1 | -1) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  setConstructionStep: (step: number) => void;
}

export const useSynthesisStore = create<SynthesisState>((set) => ({
  precisionPoints: [],

  pointMode: 4,

  reductionPair: [0, 2],

  reductionPair1: [0, 4],
  reductionPair2: [1, 2],

  R: 80,
  r: 60,
  hrOffset: 20,
  hcOffset: 50,

  alpha: 0,

  swapAij: false,
  swapAm: false,
  swapAn: false,

  swapA1_5pt: false,
  swapA3_5pt: false,
  swapA4_5pt: false,
  swapA5_5pt: false,

  configuration: "open",

  showConstruction: true,
  showGhosts: true,
  showCouplerCurve: true,

  isPlaying: false,
  speedRPM: 30,
  crankAngle: 0,
  rockerDirection: 1,

  zoom: 1,
  panX: 0,
  panY: 0,

  constructionStep: 0,

  placePoint: (p) =>
    set((s) => ({
      precisionPoints:
        s.precisionPoints.length < s.pointMode
          ? [...s.precisionPoints, p]
          : s.precisionPoints,
    })),

  // Per V3 spec U11: Clear All resets points only, keeps all other settings
  clearAll: () =>
    set({
      precisionPoints: [],
      crankAngle: 0,
      isPlaying: false,
      rockerDirection: 1,
      constructionStep: 0,
    }),

  setPointMode: (v) =>
    set({
      pointMode: v,
      precisionPoints: [],
      crankAngle: 0,
      isPlaying: false,
      rockerDirection: 1,
      constructionStep: 0,
    }),

  setR: (R) => set({ R }),
  setr: (r) => set({ r }),
  setHrOffset: (v) => set({ hrOffset: v }),
  setHcOffset: (v) => set({ hcOffset: v }),
  setAlpha: (v) => set({ alpha: v }),
  setSwapAij: (v) => set({ swapAij: v }),
  setSwapAm: (v) => set({ swapAm: v }),
  setSwapAn: (v) => set({ swapAn: v }),
  setSwapA1_5pt: (v) => set({ swapA1_5pt: v }),
  setSwapA3_5pt: (v) => set({ swapA3_5pt: v }),
  setSwapA4_5pt: (v) => set({ swapA4_5pt: v }),
  setSwapA5_5pt: (v) => set({ swapA5_5pt: v }),
  setReductionPair: (pair) => set({ reductionPair: pair }),
  setReductionPair1: (pair) => set({ reductionPair1: pair }),
  setReductionPair2: (pair) => set({ reductionPair2: pair }),
  setConfiguration: (v) => set({ configuration: v }),
  setShowConstruction: (v) => set({ showConstruction: v }),
  setShowGhosts: (v) => set({ showGhosts: v }),
  setShowCouplerCurve: (v) => set({ showCouplerCurve: v }),

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),

  resetAnimation: (startAngle = 0) =>
    set({ crankAngle: startAngle, isPlaying: false, rockerDirection: 1 }),

  setSpeed: (v) => set({ speedRPM: v }),
  setCrankAngle: (v) => set({ crankAngle: v }),
  setRockerDirection: (v) => set({ rockerDirection: v }),

  setZoom: (z) => set({ zoom: Math.max(0.01, z) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),

  setConstructionStep: (step) => set({ constructionStep: step }),
}));