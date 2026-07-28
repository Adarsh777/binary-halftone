import { clamp, shade, type Field } from "./halftone-core";

/* ============================================================
   SOURCE A — procedural 3D by sphere tracing
   ============================================================ */
const sdSphere = (x: number, y: number, z: number, r: number): number => Math.hypot(x, y, z) - r;
const sdTorus = (x: number, y: number, z: number, R: number, r: number): number =>
  Math.hypot(Math.hypot(x, z) - R, y) - r;
function sdRBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number): number {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
       + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export type SceneKind = "blob" | "sphere" | "stack" | "torus";
type SceneMap = (X: number, Y: number, Z: number) => number;

function makeMap(scene: string, yaw: number, pitch: number): SceneMap {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return function (X: number, Y: number, Z: number): number {
    let x = X * cy - Z * sy, z = X * sy + Z * cy;
    const y = Y * cp - z * sp; z = Y * sp + z * cp;
    if (scene === "sphere") return sdSphere(x, y, z, 1.05);
    if (scene === "torus")  return sdTorus(x, y, z, 0.78, 0.34);
    if (scene === "blob")   return smin(sdSphere(x, y - 0.35, z, 0.72),
                                        sdRBox(x, y + 0.5, z, 0.62, 0.34, 0.5, 0.14), 0.45);
    return Math.min(sdRBox(x - 0.42, y - 0.86, z, 0.42, 0.30, 0.42, 0.10),
           Math.min(sdRBox(x,        y,        z, 0.62, 0.30, 0.48, 0.10),
                    sdRBox(x + 0.46, y + 0.86, z, 0.82, 0.30, 0.54, 0.10)));
  };
}

export type SceneOptions = {
  lightDir: readonly [number, number, number];
  pitch: number;
  rim: number;
  scene: string;
  yaw: number;
};

export function renderScene(W: number, H: number, o: SceneOptions): Field {
  const map = makeMap(o.scene, o.yaw, o.pitch);
  const lum = new Float32Array(W * H);
  const alive = new Uint8Array(W * H);
  const dep = new Float32Array(W * H).fill(1e3);
  const aspect = W / H, eps = 0.0015;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = ((i + 0.5) / W * 2 - 1) * aspect * 1.5;
    const v = (1 - (j + 0.5) / H * 2) * 1.5;
    let t = 0, hit = false;                    // orthographic, ray dir (0,0,-1)
    for (let s = 0; s < 72; s++) {
      const d = map(u, v, 3 - t);
      if (d < 0.0012) { hit = true; break; }
      t += d;
      if (t > 6.5) break;
    }
    if (!hit) continue;
    const k = j * W + i, hx = u, hy = v, hz = 3 - t;
    const nx = map(hx + eps, hy, hz) - map(hx - eps, hy, hz);
    const ny = map(hx, hy + eps, hz) - map(hx, hy - eps, hz);
    const nz = map(hx, hy, hz + eps) - map(hx, hy, hz - eps);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const Nx = nx / nl, Ny = ny / nl, Nz = nz / nl;
    let occ = 0;
    for (let s = 1; s <= 4; s++) {
      const hh = s * 0.06;
      occ += (hh - map(hx + Nx * hh, hy + Ny * hh, hz + Nz * hh)) / Math.pow(2, s);
    }
    lum[k] = shade(Nx, Ny, Nz, clamp(1 - 2.2 * occ, 0, 1), o.rim, o.lightDir);
    dep[k] = t;
    alive[k] = 1;
  }
  return { W, H, lum, dep, alive };
}
