import * as THREE from "three"

/**
 * Helpers for props that live outside the house's baked lighting.
 *
 * The interior is lit by very bright GLB point lights with no range limit and
 * the renderer runs at a tiny tone-mapping exposure, so regular lit materials
 * either render black outdoors or get lit straight through the walls. Exterior
 * props instead use unlit, non-tone-mapped materials with the sun shading baked
 * into vertex colours — flat-shaded, which also suits the PS1 look.
 */

export const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.4).normalize()

const _n = new THREE.Vector3()
const _c = new THREE.Color()

/** Non-indexed copy of `geo` with per-face sun shading written into vertex colours. */
export function bakeSun(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, ambient = 0.55) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  g.computeVertexNormals()
  const nrm = g.attributes.normal as THREE.BufferAttribute
  const pos = g.attributes.position as THREE.BufferAttribute
  const cols = new Float32Array(pos.count * 3)
  const base = new THREE.Color(color)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    // Flat face normal so every triangle gets one shade
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
    _n.subVectors(c, b).cross(a.clone().sub(b)).normalize()
    if (_n.lengthSq() < 0.5) _n.fromBufferAttribute(nrm, i)
    const lit = ambient + (1 - ambient) * Math.max(0, _n.dot(SUN_DIR))
    // Slight sky-blue fill on faces pointing away from the sun
    _c.copy(base).multiplyScalar(lit)
    if (_n.dot(SUN_DIR) < 0) _c.lerp(new THREE.Color("#8fa9c9").multiplyScalar(lit), 0.12)
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = _c.r; cols[(i + k) * 3 + 1] = _c.g; cols[(i + k) * 3 + 2] = _c.b }
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3))
  return g
}

/** Box whose UVs tile every `tile` metres, so textures keep a constant scale. */
export function worldBox(w: number, h: number, d: number, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.attributes.uv as THREE.BufferAttribute
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile)
  }
  return g
}

/** Unlit material that ignores the scene's tone mapping (see file comment). */
export function unlit(opts: THREE.MeshBasicMaterialParameters = {}) {
  if ("map" in opts && !opts.map) { opts = { ...opts }; delete opts.map }   // avoid three's "map is undefined" warning spam
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, ...opts })
}

// ── Small pixel-art canvas textures ──────────────────────────────────────────

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat: [number, number] = [1, 1]) {
  const cv = document.createElement("canvas")
  cv.width = cv.height = size
  const ctx = cv.getContext("2d")!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestMipmapNearestFilter   // blocky texels at any distance, PS1-style
  return t
}

// Deterministic noise so textures look the same every load
function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
}

function speckle(ctx: CanvasRenderingContext2D, s: number, base: string, shades: string[], n: number, seed: number, w = 1, h = 1) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s)
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = shades[Math.floor(r() * shades.length)]
    ctx.fillRect(Math.floor(r() * s), Math.floor(r() * s), w, h)
  }
}

export const textures = {
  grass: () => canvasTex(64, (ctx, s) => {
    speckle(ctx, s, "#ffffff", ["#d6e8c4", "#c2dcae", "#e9f3dc", "#b4d19c", "#a3c28a"], 1100, 7, 1, 2)
    const r = rng(8)
    ctx.fillStyle = "#d8c9a8"                                   // worn dirt specks
    for (let i = 0; i < 30; i++) ctx.fillRect(Math.floor(r() * s), Math.floor(r() * s), 2, 1)
  }),
  asphalt: () => canvasTex(64, (ctx, s) => {
    speckle(ctx, s, "#ffffff", ["#d9d9d9", "#c4c4c4", "#ececec", "#b5b5b5"], 900, 11)
    const r = rng(12)
    // Patch repairs, oil stains and cracks
    ctx.fillStyle = "#d2d2d2"; ctx.fillRect(38, 6, 18, 12)
    ctx.fillStyle = "rgba(90,90,90,0.12)"; ctx.fillRect(8, 40, 10, 7); ctx.fillRect(12, 44, 6, 6)
    ctx.fillStyle = "#a6a6a6"
    for (let c = 0; c < 3; c++) {
      let x = Math.floor(r() * s), y = Math.floor(r() * s)
      for (let i = 0; i < 22; i++) { ctx.fillRect(x & 63, y & 63, 1, 1); x += Math.round(r() * 2 - 0.5); y += 1 }
    }
  }),
  concrete: () => canvasTex(64, (ctx, s) => {
    speckle(ctx, s, "#ffffff", ["#e6e6e6", "#f2f2f2", "#d8d8d8", "#cfcfcf"], 600, 3)
    ctx.fillStyle = "rgba(120,110,95,0.18)"; ctx.fillRect(20, 26, 14, 9); ctx.fillRect(44, 48, 9, 6)   // stains
    ctx.fillStyle = "#a9a9a9"; ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s)                     // slab joints
    ctx.fillStyle = "#c4c4c4"; ctx.fillRect(40, 1, 1, 18)                                              // hairline crack
  }),
  pavers: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#9e9a94"; ctx.fillRect(0, 0, s, s)
    const r = rng(31)
    for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < s; x += 16) {
      const v = 190 + Math.floor(r() * 50)
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 12})`; ctx.fillRect(x + 1, y + 1, 15, 7)
    }
  }),
  glass: () => canvasTex(32, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, "#c9dcea"); g.addColorStop(0.55, "#6f8aa3"); g.addColorStop(1, "#3c4a58")
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = "rgba(255,255,255,0.35)"                                   // sky glint
    for (let i = 0; i < 10; i++) ctx.fillRect(4 + i, 14 - i, 3, 1)
    ctx.fillStyle = "rgba(235,225,200,0.55)"; ctx.fillRect(0, 0, 7, s)          // net curtain edge
  }),
  gravel: () => canvasTex(32, (ctx, s) =>
    speckle(ctx, s, "#ffffff", ["#d0d0d0", "#b8b8b8", "#e6e6e6", "#a0a0a0"], 500, 41)),
  ballast: () => canvasTex(32, (ctx, s) =>
    speckle(ctx, s, "#9a948a", ["#7b756c", "#b3aca0", "#5f5a53", "#c7c0b4"], 520, 43, 2, 2)),
  chainlink: () => canvasTex(32, (ctx, s) => {
    ctx.clearRect(0, 0, s, s)
    ctx.fillStyle = "#c9cdd0"
    for (let i = 0; i < s; i++) {           // diamond mesh
      for (let k = -s; k < s; k += 8) { ctx.fillRect(i, (i + k + s) % s, 1, 1); ctx.fillRect(i, (k - i + 2 * s) % s, 1, 1) }
    }
  }),
  mural: () => canvasTex(128, (ctx, s) => {
    // Purple/blue wall with teal & yellow fish shapes, like the mural on Boyer
    const g = ctx.createLinearGradient(0, 0, s, s)
    g.addColorStop(0, "#5a4fa8"); g.addColorStop(1, "#3c67b8")
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
    const fish = (x: number, y: number, w: number, col: string, fin: string) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.38, -0.4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = fin; ctx.beginPath(); ctx.moveTo(x - w * 0.9, y + w * 0.3); ctx.lineTo(x - w * 1.5, y - w * 0.1); ctx.lineTo(x - w * 1.3, y + w * 0.8); ctx.fill()
      ctx.fillStyle = "#101820"; ctx.fillRect(x + w * 0.55, y - w * 0.25, 3, 3)
    }
    fish(70, 34, 30, "#2fb3a8", "#e8c35a")
    fish(40, 88, 22, "#e8c35a", "#2fb3a8")
    fish(100, 100, 16, "#8fe0d6", "#d94f8a")
    ctx.strokeStyle = "#8fe0d6"; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(0, 60); ctx.bezierCurveTo(40, 40, 80, 80, 128, 58); ctx.stroke()
  }),
  siding: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s)
    for (let y = 0; y < s; y += 8) {
      ctx.fillStyle = "#c9c9c9"; ctx.fillRect(0, y + 6, s, 1)     // board shadow line
      ctx.fillStyle = "#e4e4e4"; ctx.fillRect(0, y + 7, s, 1)
    }
  }),
  shingles: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s)
    const r = rng(5)
    for (let y = 0; y < s; y += 8) {
      const off = (y / 8) % 2 ? 4 : 0
      for (let x = -off; x < s; x += 8) {
        const v = 200 + Math.floor(r() * 55)
        ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 7, 7)
      }
      ctx.fillStyle = "#8a8a8a"; ctx.fillRect(0, y + 7, s, 1)
    }
  }),
  planks: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s)
    const r = rng(9)
    for (let x = 0; x < s; x += 8) {
      const v = 215 + Math.floor(r() * 40)
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 12})`; ctx.fillRect(x, 0, 7, s)
      ctx.fillStyle = "#9a8a78"; ctx.fillRect(x + 7, 0, 1, s)
    }
  }),
  bark: () => canvasTex(32, (ctx, s) =>
    speckle(ctx, s, "#ffffff", ["#cfc4b8", "#b8ab9c", "#e2dad0"], 160, 13, 1, 3)),
  leaves: () => canvasTex(32, (ctx, s) =>
    speckle(ctx, s, "#ffffff", ["#cfe0bf", "#b9d0a4", "#e6f0dc", "#a8c290"], 260, 17, 2, 2)),
  brick: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#b9b1a8"; ctx.fillRect(0, 0, s, s)          // mortar
    const r = rng(23)
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0
      for (let x = -off; x < s; x += 16) {
        const v = 205 + Math.floor(r() * 50)
        ctx.fillStyle = `rgb(${v},${v - 4 - Math.floor(r() * 10)},${v - 8 - Math.floor(r() * 12)})`
        ctx.fillRect(x + 1, row * 8 + 1, 15, 7)
      }
    }
  }),
  panels: () => canvasTex(32, (ctx, s) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = "#c8c8c8"; ctx.fillRect(0, s / 2 - 1, s, 2)
    ctx.fillStyle = "#e0e0e0"; ctx.fillRect(3, 3, s - 6, s / 2 - 7); ctx.fillRect(3, s / 2 + 4, s - 6, s / 2 - 7)
  }),
  tiles: () => canvasTex(64, (ctx, s) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = "#b9c4c8"
    for (let i = 0; i < s; i += 16) { ctx.fillRect(i, 0, 1, s); ctx.fillRect(0, i, s, 1) }
  }),
}

let cache: Partial<Record<keyof typeof textures, THREE.Texture>> = {}
/** Shared texture instance (cloned when a different repeat is needed). */
export function tex(name: keyof typeof textures, repeat?: [number, number]) {
  const base = cache[name] ?? (cache[name] = textures[name]())
  if (!repeat) return base
  const t = base.clone()
  t.repeat.set(repeat[0], repeat[1])
  t.needsUpdate = true
  return t
}
