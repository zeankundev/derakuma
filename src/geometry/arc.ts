/**
 * Pure FontoBene arc-flattening and bounding-box geometry utilities.
 * Zero platform dependencies – safe in Node, browsers, Deno, edge runtimes.
 */

import type { RawVector2 } from '../core/types.js';

/**
 * Linearise a single arc segment defined by the FontoBene bulge convention.
 *
 * The bulge ranges from **-9** (180° clockwise arc) through **0** (straight line)
 * to **+9** (180° counter-clockwise arc).  It encodes the central angle θ as:
 *
 *   θ = bulge × π / 9   (radians)
 *
 * A **positive** bulge produces a CCW arc; a **negative** bulge a CW arc.
 *
 * @param p0    - Start point of the chord.
 * @param p1    - End point of the chord.
 * @param bulge - FontoBene bulge value [-9, +9].
 * @param tolerance - Maximum angular step per segment in radians (default π/18 ≈ 10°).
 * @returns Array of interpolated points from just after `p0` up to and including `p1`.
 */
export function flattenArc(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    bulge: number,
    tolerance: number = Math.PI / 18
): Array<{ x: number; y: number }> {
    const theta = (bulge * Math.PI) / 9; // total subtended angle (signed)
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const chordLen = Math.hypot(dx, dy);

    // Degenerate: straight line or zero-length chord
    if (Math.abs(theta) < 1e-9 || chordLen < 1e-9) {
        return [{ x: p1.x, y: p1.y }];
    }

    const halfTheta = theta / 2;
    const radius = chordLen / (2 * Math.sin(halfTheta));

    // Midpoint and perpendicular direction
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    // Perpendicular to chord direction (rotated 90° CCW)
    const perpX = -dy / chordLen;
    const perpY = dx / chordLen;
    // Distance from midpoint to arc centre along the perpendicular
    const offset = radius * Math.cos(halfTheta);
    const cx = midX + perpX * offset;
    const cy = midY + perpY * offset;

    const realRadius = Math.hypot(p0.x - cx, p0.y - cy);
    const angle0 = Math.atan2(p0.y - cy, p0.x - cx);

    const segmentCount = Math.max(2, Math.ceil(Math.abs(theta) / tolerance));
    const points: Array<{ x: number; y: number }> = [];

    for (let s = 1; s <= segmentCount; s++) {
        if (s === segmentCount) {
            // Always use the exact endpoint to avoid floating-point drift
            points.push({ x: p1.x, y: p1.y });
            break;
        }
        const t = s / segmentCount;
        const angle = angle0 + theta * t;
        points.push({
            x: cx + realRadius * Math.cos(angle),
            y: cy + realRadius * Math.sin(angle),
        });
    }
    return points;
}

/**
 * Flatten a raw FontoBene polyline (which may contain arc bulge values)
 * into a simple array of straight-line points.
 *
 * @param polyline - Raw points, each optionally carrying a `bulge` for the
 *                   segment leading *from* that point to the next.
 * @param tolerance - Passed through to `flattenArc`.
 */
export function flattenPolyline(
    polyline: RawVector2[],
    tolerance?: number
): Array<{ x: number; y: number }> {
    const result: Array<{ x: number; y: number }> = [];
    for (let idx = 0; idx < polyline.length; idx++) {
        const p = polyline[idx];
        if (idx === 0) {
            result.push({ x: p.x, y: p.y });
            continue;
        }
        const prev = polyline[idx - 1];
        if (prev.bulge) {
            result.push(...flattenArc({ x: prev.x, y: prev.y }, { x: p.x, y: p.y }, prev.bulge, tolerance));
        } else {
            result.push({ x: p.x, y: p.y });
        }
    }
    return result;
}

/**
 * Compute the axis-aligned bounding box of a set of polylines.
 * Returns `{ minX: 0, maxX: 0, minY: 0, maxY: 0 }` for empty input.
 */
export function computeBounds(polylines: Array<Array<{ x: number; y: number }>>): {
    minX: number; maxX: number; minY: number; maxY: number;
} {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const polyline of polylines) {
        for (const { x, y } of polyline) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return Number.isFinite(minX)
        ? { minX, maxX, minY, maxY }
        : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}
