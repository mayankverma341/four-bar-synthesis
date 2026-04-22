export interface Point {
  x: number;
  y: number;
}

export interface Line {
  p: Point;
  dir: Point;
}

export interface Circle {
  center: Point;
  radius: number;
}

export const EPSILON = 1e-9;

export const distance = (p1: Point, p2: Point): number =>
  Math.hypot(p2.x - p1.x, p2.y - p1.y);

export const signedArea = (p: Point, q: Point, s: Point): number =>
  0.5 * ((q.x - p.x) * (s.y - p.y) - (s.x - p.x) * (q.y - p.y));

export const midpoint = (p1: Point, p2: Point): Point => ({
  x: (p1.x + p2.x) / 2,
  y: (p1.y + p2.y) / 2,
});

export const normalize = (v: Point): Point => {
  const len = Math.hypot(v.x, v.y);
  return len < EPSILON ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
};

export const subtract = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

export const add = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

export const scale = (p: Point, s: number): Point => ({
  x: p.x * s,
  y: p.y * s,
});

export const cross2D = (a: Point, b: Point): number =>
  a.x * b.y - a.y * b.x;

export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

export const rotate = (p: Point, angle: number): Point => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export const perpendicularBisector = (p1: Point, p2: Point): Line => {
  const mid = midpoint(p1, p2);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return { p: mid, dir: normalize({ x: -dy, y: dx }) };
};

export const pointOnLine = (line: Line, offset: number): Point => ({
  x: line.p.x + line.dir.x * offset,
  y: line.p.y + line.dir.y * offset,
});

export const intersectCircles = (c1: Circle, c2: Circle): Point[] => {
  const d = distance(c1.center, c2.center);
  if (d < EPSILON) return [];
  if (d > c1.radius + c2.radius + EPSILON) return [];
  if (d < Math.abs(c1.radius - c2.radius) - EPSILON) return [];

  const a = (c1.radius ** 2 - c2.radius ** 2 + d ** 2) / (2 * d);
  const hSq = c1.radius ** 2 - a ** 2;
  const h = hSq < 0 ? 0 : Math.sqrt(hSq);

  const px = c1.center.x + (a * (c2.center.x - c1.center.x)) / d;
  const py = c1.center.y + (a * (c2.center.y - c1.center.y)) / d;

  if (h < EPSILON) {
    return [{ x: px, y: py }];
  }

  const offX = (h * (c2.center.y - c1.center.y)) / d;
  const offY = (h * (c2.center.x - c1.center.x)) / d;

  return [
    { x: px + offX, y: py - offY },
    { x: px - offX, y: py + offY },
  ];
};

export const circumcenter = (
  p1: Point,
  p2: Point,
  p3: Point
): Point | null => {
  const d =
    2 *
    (p1.x * (p2.y - p3.y) +
      p2.x * (p3.y - p1.y) +
      p3.x * (p1.y - p2.y));
  if (Math.abs(d) < EPSILON) return null;

  const p1sq = p1.x ** 2 + p1.y ** 2;
  const p2sq = p2.x ** 2 + p2.y ** 2;
  const p3sq = p3.x ** 2 + p3.y ** 2;

  const ux =
    (p1sq * (p2.y - p3.y) + p2sq * (p3.y - p1.y) + p3sq * (p1.y - p2.y)) / d;
  const uy =
    (p1sq * (p3.x - p2.x) + p2sq * (p1.x - p3.x) + p3sq * (p2.x - p1.x)) / d;

  return { x: ux, y: uy };
};

export const areCollinear = (p1: Point, p2: Point, p3: Point): boolean =>
  Math.abs(signedArea(p1, p2, p3)) < EPSILON * 100;

export const areCoincident = (p1: Point, p2: Point): boolean =>
  distance(p1, p2) < EPSILON * 10;

export const distancePointToLine = (pt: Point, line: Line): number => {
  const v = subtract(pt, line.p);
  const proj = dot(v, line.dir);
  const closest = add(line.p, scale(line.dir, proj));
  return distance(pt, closest);
};

/**
 * Normalize angle to [-PI, PI]
 */
export const normalizeAngle = (a: number): number => {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r < -Math.PI) r += 2 * Math.PI;
  return r;
};

/**
 * Normalize angle to [0, 2*PI)
 */
export const normalizeAngle2PI = (a: number): number => {
  let r = a % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
};

/**
 * Intersect two lines. Returns null if parallel.
 * Line is { p: Point, dir: Point (normalized) }.
 */
export const intersectLines = (
  l1: Line,
  l2: Line
): Point | null => {
  const det = cross2D(l1.dir, l2.dir);
  if (Math.abs(det) < EPSILON) return null; // parallel

  const diff = subtract(l2.p, l1.p);
  const t = cross2D(diff, l2.dir) / det;
  return {
    x: l1.p.x + l1.dir.x * t,
    y: l1.p.y + l1.dir.y * t,
  };
};

/**
 * Intersect a line with a circle.
 * Returns 0, 1, or 2 intersection points.
 */
export const intersectLineCircle = (
  line: Line,
  circle: Circle
): Point[] => {
  const oc = subtract(line.p, circle.center);
  // Quadratic: |oc + t*dir|^2 = R^2
  const a = dot(line.dir, line.dir); // should be 1 if normalized
  const b = 2 * dot(oc, line.dir);
  const c = dot(oc, oc) - circle.radius ** 2;
  const disc = b * b - 4 * a * c;

  if (disc < -EPSILON) return [];

  if (disc < EPSILON) {
    const t = -b / (2 * a);
    return [{ x: line.p.x + line.dir.x * t, y: line.p.y + line.dir.y * t }];
  }

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  return [
    { x: line.p.x + line.dir.x * t1, y: line.p.y + line.dir.y * t1 },
    { x: line.p.x + line.dir.x * t2, y: line.p.y + line.dir.y * t2 },
  ];
};

/**
 * Rotate a point about a center by an angle (radians, CCW positive).
 */
export const rotatePoint = (
  pt: Point,
  center: Point,
  angle: number
): Point => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * c - dy * s,
    y: center.y + dx * s + dy * c,
  };
};

/**
 * Rotate a line about a center by an angle.
 * Both the base point and direction are rotated.
 */
export const rotateLine = (
  line: Line,
  center: Point,
  angle: number
): Line => {
  const newP = rotatePoint(line.p, center, angle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const newDir = normalize({
    x: line.dir.x * c - line.dir.y * s,
    y: line.dir.x * s + line.dir.y * c,
  });
  return { p: newP, dir: newDir };
};

/**
 * Construct a line from a point through another point (normalized direction).
 */
export const lineThrough = (from: Point, to: Point): Line => ({
  p: from,
  dir: normalize(subtract(to, from)),
});
