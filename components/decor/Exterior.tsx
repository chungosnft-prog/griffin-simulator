"use client"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { RigidBody, CuboidCollider } from "@react-three/rapier"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { bakeSun, unlit, tex, worldBox, textures, SUN_DIR } from "./ps1Materials"
import { playerState } from "../playerState"

/*
 * Outdoors, modelled on the real place: a Montreal brick row house whose back
 * faces a paved parking pad on Boyer St, with Parc des Carrières across the street.
 *
 * World orientation (house.glb coordinates):
 *   +X  → towards the yard / Boyer St / the park
 *   ±Z  → along the row (neighbours are attached on both sides)
 *   The GLB interior's east wall (X≈5) is the building's back wall. Its big
 *   opening beside the red chairs is the garage; the door goes through the
 *   solid bit behind the raised tile landing.
 */

// ── Layout ───────────────────────────────────────────────────────────────────

export const HOUSE = { back: 5.45, front: -22.05, n: -4.67, s: 3.9 }   // outer faces incl. party walls
const IN_WALL  = { x0: 4.97, x1: 5.2 }                                  // rebuilt interior east wall
const DOOR     = { z0: -3.95, z1: -3.05, sill: 0.26, head: 2.36 }
const GARAGE   = { z0: -2.72, z1: -0.44, top: 2.36 }
const KWINDOW  = { z0: -0.34, z1: 3.38, y0: 1.5, y1: 2.48 }
const CEIL     = 2.71
const STOREY   = 3.05
export const FRONT_DOOR = { x: (IN_WALL.x0 + HOUSE.back) / 2, z: (DOOR.z0 + DOOR.z1) / 2 }

// Rue Boyer runs along Z in front of the lots; Rue des Carrières crosses it at
// the south-east end of the row (-Z), with the Réseau Vert path and the railway beyond.
const SIDEWALK = { x0: 19, x1: 21.2 }                 // our side of Boyer
const ROAD     = { x0: 21.2, x1: 31 }                 // Boyer
const VERGE    = { x0: 31, x1: 32.8 }                 // grass strip, park side
const PARK_SW  = { x0: 32.8, x1: 34.6 }               // park-side sidewalk
const PARK     = { x0: 35, x1: 112, z0: -22.2, z1: 90 }
const ROW_Z    = { z0: -22.5, z1: 60 }
const DC       = { z0: -33.3, z1: -24.3 }             // Rue des Carrières
const DC_SW    = { z0: -24.3, z1: -22.5 }             // its sidewalk on our/park side
const GREENWAY = { z0: -39, z1: -35.5 }               // Réseau Vert paver path
const RAIL     = { z0: -52, z1: -40.6 }
const X_MIN = -40, X_MAX = 130, Z_MAX = 90

const C = {
  brick: "#a14f39", trim: "#ecebe6", glass: "#3a4b5c", wood: "#8a5a3a",
  fence: "#7a4a33", asphalt: "#48484c", concrete: "#b8b4ab", metal: "#1f2124", roof: "#6d6d70",
  grass: "#6f9748", sand: "#cdb68a", leaves: "#4c7a34",
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

type B = [number, number, number, number, number, number]   // x0,x1,y0,y1,z0,z1

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  )
  return g.applyMatrix4(m)
}

function slab(b: B, tile = 1) {
  const [x0, x1, y0, y1, z0, z1] = b
  return at(worldBox(x1 - x0, y1 - y0, z1 - z0, tile), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
}

/** Flat ground rectangle, subdivided so the PS1 vertex snapping can't make it flicker. */
function ground(x0: number, x1: number, z0: number, z1: number, y: number, tile: number, cell = 4) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(1, Math.ceil((x1 - x0) / cell)), Math.max(1, Math.ceil((z1 - z0) / cell)))
  g.rotateX(-Math.PI / 2)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile)
  return g.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
}

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
}

type TexName = keyof typeof textures
type Bucket = { color: string; map?: TexName; ambient?: number; solid?: boolean; cutout?: boolean; parts: THREE.BufferGeometry[] }

/** Collects geometry by look, so the whole neighbourhood renders in a few dozen draw calls. */
class Kit {
  buckets = new Map<string, Bucket>()
  colliders: B[] = []
  add(g: THREE.BufferGeometry, color: string, o: { map?: TexName; ambient?: number; solid?: boolean; cutout?: boolean } = {}) {
    const key = [color, o.map ?? "", o.ambient ?? "", o.solid ? 1 : 0, o.cutout ? 1 : 0].join("|")
    let b = this.buckets.get(key)
    if (!b) { b = { color, map: o.map, ambient: o.ambient, solid: o.solid, cutout: o.cutout, parts: [] }; this.buckets.set(key, b) }
    b.parts.push(g)
    return this
  }
  box(b: B, color: string, o: { map?: TexName; ambient?: number; solid?: boolean; cutout?: boolean; tile?: number; collide?: boolean } = {}) {
    this.add(slab(b, o.tile ?? 1), color, o)
    if (o.collide) this.colliders.push(b)
    return this
  }
}

const noRaycast = () => {}

function Baked({ bucket }: { bucket: Bucket }) {
  const { geo, mat } = useMemo(() => {
    const clean = bucket.parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p
      const out = new THREE.BufferGeometry()
      out.setAttribute("position", g.attributes.position)
      out.setAttribute("uv", g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      return out
    })
    const merged = mergeGeometries(clean, false)!
    const map = bucket.map ? tex(bucket.map) : undefined
    const mat = bucket.cutout
      ? unlit({ map, alphaTest: 0.5, side: THREE.DoubleSide })   // see-through chain-link
      : unlit({ map })
    return { geo: bakeSun(merged, bucket.color, bucket.ambient), mat }
  }, [bucket])
  // Only buildings take part in raycasts (camera collision). Testing every
  // triangle of the big merged scenery meshes each frame was the main lag source.
  // (Don't pass raycast={undefined} — R3F would assign it and break raycasting.)
  return bucket.solid
    ? <mesh geometry={geo} material={mat} />
    : <mesh geometry={geo} material={mat} raycast={noRaycast} />
}

function KitMeshes({ kit }: { kit: Kit }) {
  return (
    <>
      {Array.from(kit.buckets.values()).map((b, i) => <Baked key={i} bucket={b} />)}
      <RigidBody type="fixed" colliders={false}>
        {kit.colliders.map(([x0, x1, y0, y1, z0, z1], i) => (
          <CuboidCollider key={i} args={[(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} />
        ))}
      </RigidBody>
    </>
  )
}

// ── Building pieces (all back facades face +X) ──────────────────────────────

/** Window on a +X facing wall at `x`: frame, sill, glass and mullions. */
function windowX(k: Kit, x: number, zc: number, yc: number, w: number, h: number, cols = 2, rows = 1, frame = C.trim) {
  const f = 0.07, o = x + 0.03
  k.add(slab([o - 0.02, o + 0.01, yc - h / 2, yc + h / 2, zc - w / 2, zc + w / 2], Math.max(w, h)), "#ffffff", { map: "glass", ambient: 1 })
  k.box([o, o + 0.06, yc + h / 2, yc + h / 2 + f, zc - w / 2 - f, zc + w / 2 + f], frame)
  k.box([o, o + 0.06, yc - h / 2 - f, yc - h / 2, zc - w / 2 - f, zc + w / 2 + f], frame)
  k.box([o, o + 0.06, yc - h / 2, yc + h / 2, zc - w / 2 - f, zc - w / 2], frame)
  k.box([o, o + 0.06, yc - h / 2, yc + h / 2, zc + w / 2, zc + w / 2 + f], frame)
  k.box([x, o + 0.14, yc - h / 2 - f - 0.05, yc - h / 2 - f, zc - w / 2 - f - 0.05, zc + w / 2 + f + 0.05], "#9a948c")   // stone sill
  for (let c = 1; c < cols; c++) k.box([o, o + 0.05, yc - h / 2, yc + h / 2, zc - w / 2 + (w * c) / cols - 0.025, zc - w / 2 + (w * c) / cols + 0.025], frame)
  for (let r = 1; r < rows; r++) k.box([o, o + 0.05, yc - h / 2 + (h * r) / rows - 0.025, yc - h / 2 + (h * r) / rows + 0.025, zc - w / 2, zc + w / 2], frame)
}

/** Railing along Z at x, from z0..z1, standing on y. */
function railing(k: Kit, x: number, y: number, z0: number, z1: number, h = 1.0, color = C.trim) {
  k.box([x - 0.03, x + 0.03, y + h - 0.05, y + h, z0, z1], color)
  k.box([x - 0.02, x + 0.02, y + 0.08, y + 0.12, z0, z1], color)
  for (let z = z0; z <= z1 + 0.001; z += 0.14) k.box([x - 0.015, x + 0.015, y + 0.1, y + h - 0.05, z - 0.015, z + 0.015], color)
}
function railingX(k: Kit, z: number, y: number, x0: number, x1: number, h = 1.0, color = C.trim) {
  k.box([x0, x1, y + h - 0.05, y + h, z - 0.03, z + 0.03], color)
  k.box([x0, x1, y + 0.08, y + 0.12, z - 0.02, z + 0.02], color)
  for (let x = x0; x <= x1 + 0.001; x += 0.14) k.box([x - 0.015, x + 0.015, y + 0.1, y + h - 0.05, z - 0.015, z + 0.015], color)
}

/** Balcony across a building's back, optionally with a steel stair down to the yard. */
function balcony(k: Kit, back: number, z0: number, z1: number, floorY: number, stairs: boolean, stairColor = C.metal) {
  const d = 1.6
  k.box([back, back + d, floorY - 0.12, floorY, z0 + 0.3, z1 - 0.3], "#d8d6d0", { collide: true })
  railing(k, back + d - 0.03, floorY, z0 + 0.3, z1 - 0.3)
  railingX(k, z0 + 0.33, floorY, back, back + d)
  for (const z of [z0 + 0.4, z1 - 0.4]) k.box([back + d - 0.2, back + d - 0.08, 0, floorY - 0.12, z - 0.06, z + 0.06], "#d8d6d0", { collide: true })
  if (!stairs) return
  const steps = Math.round(floorY / 0.19), run = 0.25
  const x0 = back + d, x1 = back + d + 0.95
  const zTop = z1 - 0.35
  for (let i = 0; i < steps; i++) {
    const y = floorY - (i + 1) * (floorY / steps)
    const z = zTop - (i + 1) * run
    k.box([x0, x1, y - 0.03, y, z - run, z], stairColor)
  }
  const zBot = zTop - (steps + 1) * run
  const len = Math.hypot(zTop - zBot, floorY), ang = Math.atan2(floorY, zTop - zBot)
  for (const x of [x0, x1]) {
    k.add(at(new THREE.BoxGeometry(0.04, 0.18, len), x, floorY / 2, (zTop + zBot) / 2, -ang), stairColor)
    k.add(at(new THREE.BoxGeometry(0.03, 0.03, len), x, floorY / 2 + 0.95, (zTop + zBot) / 2, -ang), stairColor)
  }
  k.colliders.push([x0, x1, 0, 0.9, zBot, zTop - 1.2])
}

/** Flat roof with parapet, flashing and a few rooftop units. */
function roof(k: Kit, x0: number, x1: number, z0: number, z1: number, y: number, seed: number) {
  k.box([x0, x1, y - 0.05, y + 0.02, z0, z1], C.roof, { map: "gravel", tile: 1.5, ambient: 0.75 })
  const p = 0.4
  k.box([x1 - 0.25, x1, y, y + p, z0, z1], C.brick, { map: "brick", tile: 0.6, solid: true })
  k.box([x1 - 0.3, x1 + 0.05, y + p, y + p + 0.06, z0, z1], "#c9c9c9")
  k.box([x0, x0 + 0.25, y, y + p, z0, z1], C.brick, { map: "brick", tile: 0.6 })
  const r = rng(seed)
  for (let i = 0; i < 3; i++) {
    const cx = x0 + 3 + r() * (x1 - x0 - 6), cz = z0 + 1.5 + r() * (z1 - z0 - 3)
    k.box([cx - 0.5, cx + 0.5, y, y + 0.7, cz - 0.4, cz + 0.4], "#9c9ea1")
  }
}

type Bldg = {
  z0: number; z1: number; back: number; storeys: number; brick: string
  balcony?: boolean; stairs?: boolean; stairColor?: string; mural?: boolean; terrace?: boolean; siding?: string
}

// The attached row either side of ours (ours sits between HOUSE.n and HOUSE.s),
// from the Rue des Carrières corner (-Z) up Boyer (+Z), as seen on Street View.
const ROW: Bldg[] = [
  { z0: ROW_Z.z0, z1: -12.5, back: 1.5, storeys: 2, brick: "#7a3b2e" },                                    // corner building
  { z0: -12.5, z1: HOUSE.n, back: 5.45, storeys: 3, brick: "#8a4633", balcony: true, stairs: true, stairColor: "#e8e8e4" },
  { z0: HOUSE.s, z1: 11.2, back: 6.0, storeys: 2, brick: "#8e4a36", siding: "#565b63", balcony: true },
  { z0: 11.2, z1: 20, back: 3.5, storeys: 3, brick: "#9a5a40", mural: true, terrace: true },               // mural on its side wall
  { z0: 20, z1: 28, back: 3.0, storeys: 2, brick: "#a0603f", balcony: true, stairs: true },
  { z0: 28, z1: 36, back: 2.5, storeys: 3, brick: "#874534", siding: "#c9ccce" },
  { z0: 36, z1: 44, back: 4.0, storeys: 2, brick: "#95513b" },
  { z0: 44, z1: 52, back: 3.2, storeys: 3, brick: "#8f4b37", balcony: true, stairs: true },
  { z0: 52, z1: ROW_Z.z1, back: 2.0, storeys: 2, brick: "#a3654a" },
]

function neighbour(k: Kit, b: Bldg, seed: number) {
  const r = rng(seed)
  const top = b.storeys * STOREY
  k.box([HOUSE.front, b.back, 0, top, b.z0, b.z1], b.brick, { map: "brick", tile: 0.6, solid: true, collide: true })
  if (b.siding) k.box([b.back, b.back + 0.04, STOREY * (b.storeys - 1), top, b.z0, b.z1], b.siding, { map: "siding", solid: true })
  if (b.mural) {
    // The mural covers the side wall facing down the street (-Z), above the lower neighbour
    const g = new THREE.PlaneGeometry(b.back - HOUSE.front, top)
    g.rotateY(Math.PI)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b.back - HOUSE.front) / 9, uv.getY(i) * top / 9)
    k.add(g.translate((HOUSE.front + b.back) / 2, top / 2, b.z0 - 0.02), "#ffffff", { map: "mural", ambient: 1 })
    const g2 = new THREE.PlaneGeometry(b.z1 - b.z0, top - STOREY)
    g2.rotateY(Math.PI / 2)
    k.add(g2.translate(b.back + 0.02, STOREY + (top - STOREY) / 2, (b.z0 + b.z1) / 2), "#ffffff", { map: "mural", ambient: 1 })
  }
  if (b.terrace) {
    railing(k, b.back - 0.1, top + 0.4, b.z0 + 0.3, b.z1 - 0.3, 1.0, C.trim)
    k.box([b.back - 3, b.back - 0.3, top, top + 2.3, b.z1 - 3, b.z1 - 0.3], "#d9d6cf", { solid: true })   // stair bulkhead
  }
  const w = b.z1 - b.z0
  const doorZ = b.z0 + 1.2
  k.box([b.back, b.back + 0.06, 0.3, 2.35, doorZ - 0.45, doorZ + 0.45], ["#f2f0ea", "#6b3b2a", "#2e3a4a"][Math.floor(r() * 3)])
  k.box([b.back, b.back + 0.6, 0, 0.3, doorZ - 0.6, doorZ + 0.6], C.concrete, { map: "concrete", collide: true })
  if (!b.mural) windowX(k, b.back, b.z0 + w * 0.62, 1.55, Math.min(2.2, w * 0.4), 1.3, 3, 1)
  for (let s = 1; s < b.storeys; s++) {
    if (b.mural) break
    const y = s * STOREY
    windowX(k, b.back, b.z0 + w * 0.27, y + 1.55, 1.3, 1.5, 2, 1)
    if (b.balcony && s === 1) {
      k.box([b.back, b.back + 0.06, y + 0.05, y + 2.3, b.z0 + w * 0.62 - 0.45, b.z0 + w * 0.62 + 0.45], "#f2f0ea")
      windowX(k, b.back, b.z0 + w * 0.62 + 1.1, y + 1.55, 0.8, 1.3, 1, 1)
    } else {
      windowX(k, b.back, b.z0 + w * 0.68, y + 1.55, 1.5, 1.5, 3, 1)
    }
  }
  if (b.balcony) balcony(k, b.back, b.z0, b.z1, STOREY, !!b.stairs, b.stairColor)
  roof(k, HOUSE.front, b.back, b.z0, b.z1, top, seed)
}

/** Our building: brick skin around the GLB ground floor + two storeys above. */
function ourBuilding(k: Kit) {
  const x0 = IN_WALL.x1, x1 = HOUSE.back
  const brick = { map: "brick" as TexName, tile: 0.6, solid: true, collide: true }
  // Ground-floor back wall with the door, garage and kitchen-window openings
  k.box([x0, x1, 0, CEIL, -4.47, DOOR.z0], C.brick, brick)
  k.box([x0, x1, DOOR.head, CEIL, DOOR.z0, DOOR.z1], C.brick, brick)
  k.box([x0, x1, 0, DOOR.sill, DOOR.z0, DOOR.z1], C.brick, brick)
  k.box([x0, x1, 0, CEIL, DOOR.z1, GARAGE.z0], C.brick, brick)
  k.box([x0, x1, GARAGE.top, CEIL, GARAGE.z0, GARAGE.z1], C.brick, brick)
  k.box([x0, x1, 0, CEIL, GARAGE.z1, KWINDOW.z0], C.brick, brick)
  k.box([x0, x1, 0, KWINDOW.y0, KWINDOW.z0, KWINDOW.z1], C.brick, brick)
  k.box([x0, x1, KWINDOW.y1, CEIL, KWINDOW.z0, KWINDOW.z1], C.brick, brick)
  k.box([x0, x1, 0, CEIL, KWINDOW.z1, 3.7], C.brick, brick)
  // Upper storeys, party walls and the street-front wall (closes off the GLB's ragged edges)
  const top = STOREY * 3
  k.box([HOUSE.front, x1, CEIL, top, HOUSE.n, HOUSE.s], C.brick, brick)
  k.box([HOUSE.front, x1, 0, CEIL, HOUSE.n, -4.47], C.brick, brick)
  k.box([HOUSE.front, x1, 0, CEIL, 3.7, HOUSE.s], C.brick, brick)
  k.box([HOUSE.front, HOUSE.front + 0.2, 0, CEIL, -4.47, 3.7], C.brick, brick)

  // Kitchen window in the existing opening
  const kw = KWINDOW
  k.add(slab([x0 + 0.1, x0 + 0.12, kw.y0, kw.y1, kw.z0, kw.z1], 1.2), "#ffffff", { map: "glass", ambient: 1 })
  for (const z of [kw.z0 + 0.04, kw.z1 - 0.04, (kw.z0 + kw.z1) / 2, kw.z0 + (kw.z1 - kw.z0) / 4, kw.z0 + (3 * (kw.z1 - kw.z0)) / 4]) {
    k.box([x0 + 0.06, x1, kw.y0, kw.y1, z - 0.04, z + 0.04], C.trim)
  }
  k.box([x0 + 0.06, x1, kw.y0, kw.y0 + 0.06, kw.z0, kw.z1], C.trim)
  k.box([x0 + 0.06, x1, kw.y1 - 0.06, kw.y1, kw.z0, kw.z1], C.trim)
  k.box([x1 - 0.02, x1 + 0.1, kw.y0 - 0.06, kw.y0, kw.z0 - 0.05, kw.z1 + 0.05], "#9a948c")

  // Roll-up garage door in the big opening beside the red chairs
  k.box([x0 + 0.1, x0 + 0.16, 0, GARAGE.top, GARAGE.z0, GARAGE.z1], "#dcdad4", { map: "panels", tile: 0.55, collide: true })
  k.box([x1, x1 + 0.05, GARAGE.top - 0.02, GARAGE.top + 0.12, GARAGE.z0 - 0.1, GARAGE.z1 + 0.1], C.trim)

  // Door frame
  k.box([x0 + 0.05, x1 + 0.04, DOOR.sill, DOOR.head, DOOR.z0 - 0.06, DOOR.z0], C.trim)
  k.box([x0 + 0.05, x1 + 0.04, DOOR.sill, DOOR.head, DOOR.z1, DOOR.z1 + 0.06], C.trim)
  k.box([x0 + 0.05, x1 + 0.04, DOOR.head, DOOR.head + 0.07, DOOR.z0 - 0.06, DOOR.z1 + 0.06], C.trim)

  // Wooden landing + step outside the door, with a pergola beam over it
  const lx = x1 + 1.3
  k.box([x1, lx, 0, DOOR.sill, -4.45, -2.75], C.wood, { map: "planks", tile: 0.8, collide: true })
  k.box([lx, lx + 0.32, 0, DOOR.sill / 2, -4.45, -2.75], C.wood, { map: "planks", tile: 0.8 })
  for (const z of [-4.4, -2.8]) k.box([x1 + 1.2, x1 + 1.3, DOOR.sill, 2.9, z - 0.05, z + 0.05], C.wood, { collide: true })
  k.box([x1, x1 + 1.35, 2.8, 2.95, -4.5, -2.7], C.wood)

  // Second floor: triple window + French door with a Juliet balcony
  windowX(k, x1, -2.7, STOREY + 1.55, 2.4, 1.5, 3, 1)
  k.box([x1, x1 + 0.06, STOREY + 0.1, STOREY + 2.35, 0.45, 1.75], C.trim)
  windowX(k, x1, 1.1, STOREY + 1.25, 1.1, 1.9, 2, 3)
  k.box([x1, x1 + 0.35, STOREY + 0.02, STOREY + 0.1, 0.35, 1.85], "#d8d6d0")
  railing(k, x1 + 0.33, STOREY + 0.1, 0.35, 1.85, 0.9, C.metal)
  windowX(k, x1, 2.9, STOREY + 1.7, 0.6, 0.8, 1, 1)
  // Third floor
  windowX(k, x1, -2.6, STOREY * 2 + 1.55, 1.5, 1.5, 2, 1)
  windowX(k, x1, 1.2, STOREY * 2 + 1.55, 1.5, 1.5, 2, 1)
  roof(k, HOUSE.front, x1, HOUSE.n, HOUSE.s, top, 99)

  // "No parking" sign on the landing post
  k.box([x1 + 1.3, x1 + 1.33, 1.3, 1.62, -2.95, -2.65], "#f4f4f0", { ambient: 0.9 })
  k.box([x1 + 1.33, x1 + 1.335, 1.34, 1.42, -2.92, -2.68], "#2a2a2a", { ambient: 1 })
}

// ── Yards, street, park ──────────────────────────────────────────────────────

type Tree = { x: number; z: number; s: number; kind: "round" | "pine" | "birch" | "sumac" | "purple" }

function addTree(k: Kit, t: Tree, r: () => number) {
  const s = t.s
  const barkCol = t.kind === "birch" ? "#d9d4c7" : "#6b5140"
  const trunkH = t.kind === "birch" ? 3.2 * s : t.kind === "sumac" ? 1.4 * s : 2.2 * s
  k.add(at(new THREE.CylinderGeometry(0.1 * s, 0.16 * s, trunkH, 6), t.x, trunkH / 2, t.z, (r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12), barkCol, { map: "bark" })
  k.colliders.push([t.x - 0.15 * s, t.x + 0.15 * s, 0, 2.2, t.z - 0.15 * s, t.z + 0.15 * s])
  const leaf = { round: C.leaves, pine: "#3d6a33", birch: "#7ea24a", sumac: "#d9772e", purple: "#5a3348" }[t.kind]
  if (t.kind === "pine") {
    for (let i = 0; i < 3; i++) k.add(at(new THREE.ConeGeometry((1.5 - i * 0.4) * s, 1.8 * s, 7), t.x, (2 + i * 1.05) * s, t.z, 0, r() * 3), leaf, { map: "leaves", ambient: 0.5 })
    return
  }
  if (t.kind === "sumac") {
    // Wide, flat umbrella of orange fronds
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      k.add(at(new THREE.IcosahedronGeometry(1.1 * s, 0).scale(1.2, 0.55, 1.2), t.x + Math.cos(a) * 0.9 * s, trunkH + 0.5 * s + r() * 0.3, t.z + Math.sin(a) * 0.9 * s, r(), r(), r()), i % 2 ? "#e0892f" : "#c9642a", { map: "leaves", ambient: 0.55 })
    }
    return
  }
  const blobs = t.kind === "birch" ? 5 : 3
  for (let i = 0; i < blobs; i++) {
    const rad = (t.kind === "birch" ? 0.9 : 1.3 - i * 0.15) * s
    const oy = t.kind === "birch" ? trunkH - 0.6 * s + i * 0.55 * s : 3 * s + (i - 1) * 0.4 * s
    k.add(at(new THREE.IcosahedronGeometry(rad, 0), t.x + (r() - 0.5) * 1.4 * s, oy, t.z + (r() - 0.5) * 1.4 * s, r(), r(), r()), leaf, { map: "leaves", ambient: 0.5 })
  }
}

/** Low-poly car; nose faces +X unless `flip`. */
function car(k: Kit, x: number, z: number, color: string, kind: "suv" | "wagon" | "hatch", flip = false) {
  const L = kind === "wagon" ? 5.1 : kind === "suv" ? 4.5 : 3.8
  const W = kind === "hatch" ? 1.66 : 1.84
  const bodyTop = kind === "hatch" ? 0.85 : 1.0
  const roofY = kind === "hatch" ? 1.5 : kind === "wagon" ? 1.72 : 1.66
  const s = flip ? -1 : 1
  const cabin0 = kind === "hatch" ? -1.5 : -2.0, cabin1 = kind === "hatch" ? 0.55 : kind === "wagon" ? 1.0 : 0.6
  const xs = (a: number, b: number): [number, number] => { const p = x + a * s, q = x + b * s; return [Math.min(p, q), Math.max(p, q)] }
  const [bx0, bx1] = xs(-L / 2, L / 2)
  k.box([bx0, bx1, 0.32, bodyTop, z - W / 2, z + W / 2], color, { collide: true })
  const [cx0, cx1] = xs(cabin0 * (L / 4.5), cabin1 * (L / 4.5))
  k.box([cx0, cx1, bodyTop, roofY, z - W / 2 + 0.08, z + W / 2 - 0.08], color, { collide: true })
  k.box([cx0 - 0.01, cx1 + 0.01, bodyTop + 0.06, roofY - 0.08, z - W / 2 + 0.07, z + W / 2 - 0.07], "#2b3440", { ambient: 0.9 })
  const [fx0, fx1] = xs(L / 2 - 0.02, L / 2 + 0.02)
  k.box([fx0, fx1, 0.62, 0.78, z - W / 2 + 0.1, z - W / 2 + 0.45], "#f2efe0", { ambient: 1 })
  k.box([fx0, fx1, 0.62, 0.78, z + W / 2 - 0.45, z + W / 2 - 0.1], "#f2efe0", { ambient: 1 })
  const [rx0, rx1] = xs(-L / 2 - 0.02, -L / 2 + 0.02)
  k.box([rx0, rx1, 0.7, 0.9, z - W / 2 + 0.08, z - W / 2 + 0.35], "#b3261e", { ambient: 1 })
  k.box([rx0, rx1, 0.7, 0.9, z + W / 2 - 0.35, z + W / 2 - 0.08], "#b3261e", { ambient: 1 })
  for (const a of [-L / 2 + 0.85, L / 2 - 0.8]) for (const side of [-1, 1]) {
    k.add(at(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), x + a * s, 0.34, z + side * (W / 2 - 0.08), Math.PI / 2), "#1c1c1e")
  }
}

function fenceZ(k: Kit, z: number, x0: number, x1: number, h: number, color: string, map: TexName = "planks") {
  k.box([x0, x1, 0, h, z - 0.04, z + 0.04], color, { map, tile: 1.2, collide: true })
  for (let x = x0; x <= x1; x += 2.4) k.box([x - 0.05, x + 0.05, 0, h + 0.08, z - 0.06, z + 0.06], color)
}

/** Chain-link fence run along Z (x fixed) or X (z fixed). */
function chainLink(k: Kit, a: [number, number], b: [number, number], h = 1.8) {
  const [x0, z0] = a, [x1, z1] = b
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0)
  const g = new THREE.PlaneGeometry(len, h)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.5, uv.getY(i) * h / 0.5)
  k.add(at(g, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, 0, ang), "#ffffff", { map: "chainlink", cutout: true, ambient: 1 })
  for (let t = 0; t <= len + 0.01; t += 3) {
    const px = x0 + ((x1 - x0) * t) / len, pz = z0 + ((z1 - z0) * t) / len
    k.box([px - 0.03, px + 0.03, 0, h + 0.05, pz - 0.03, pz + 0.03], "#9ea3a8")
  }
  k.add(at(new THREE.CylinderGeometry(0.025, 0.025, len, 5), (x0 + x1) / 2, h, (z0 + z1) / 2, 0, ang, Math.PI / 2), "#9ea3a8")
  k.colliders.push([Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, 0, h, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05])
}

/** Wooden hydro pole with a cobra-head street lamp reaching over the road (-X). */
function pole(k: Kit, x: number, z: number, lampDir: -1 | 1 = -1, alongZ = true) {
  k.add(at(new THREE.CylinderGeometry(0.13, 0.17, 10, 6), x, 5, z), "#6b5646", { map: "bark" })
  // Crossarm spans across the wire direction; one insulator per wire
  const along = alongZ ? 1 : 0
  k.box(alongZ ? [x - 1.1, x + 1.1, 9.1, 9.25, z - 0.06, z + 0.06] : [x - 0.06, x + 0.06, 9.1, 9.25, z - 1.1, z + 1.1], "#6b5646")
  for (const d of [-0.9, 0, 0.9]) {
    const ix = x + d * along, iz = z + d * (1 - along)
    k.box([ix - 0.05, ix + 0.05, 9.25, 9.4, iz - 0.05, iz + 0.05], "#d8d8d8")
  }
  k.add(at(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 7), x + 0.35, 7.6, z), "#7c8084")           // transformer
  // Lamp arm reaches over the road: across X for Boyer poles, across Z for des Carrières
  const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]
  const arm = (u0: number, u1: number, y0: number, y1: number, half: number, col: string, amb?: number) => {
    const [a, b] = span(u0, u1)
    k.box(alongZ ? [x + a, x + b, y0, y1, z - half, z + half] : [x - half, x + half, y0, y1, z + a, z + b], col, amb ? { ambient: amb } : {})
  }
  arm(0, lampDir * 2.4, 7.0, 7.08, 0.04, "#8a8e92")
  arm(lampDir * 2.3, lampDir * 2.9, 6.9, 7.08, 0.17, "#8a8e92")
  arm(lampDir * 2.35, lampDir * 2.85, 6.86, 6.9, 0.13, "#fff3c8", 1)
  k.colliders.push([x - 0.17, x + 0.17, 0, 3, z - 0.17, z + 0.17])
}

function buildWorld() {
  const k = new Kit()
  const r = rng(11)

  ourBuilding(k)
  ROW.forEach((b, i) => neighbour(k, b, 20 + i))

  // ── Ground layers: side by side, never stacked, so nothing flickers through ──
  const lotEdge = SIDEWALK.x0
  for (const b of [...ROW, { z0: HOUSE.n, z1: HOUSE.s, back: HOUSE.back }]) {
    k.add(ground(b.back, lotEdge, b.z0, b.z1, -0.01, 3), C.asphalt, { map: "asphalt", ambient: 1 })
  }
  const zEnd = Z_MAX
  // Boyer: our sidewalk, the road (incl. the intersection), verge + park sidewalk
  k.add(ground(SIDEWALK.x0, SIDEWALK.x1, DC_SW.z0, zEnd, 0, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  k.add(ground(ROAD.x0, ROAD.x1, DC.z0, zEnd, -0.08, 3), C.asphalt, { map: "asphalt", ambient: 1 })
  k.add(ground(VERGE.x0, VERGE.x1, DC_SW.z1, zEnd, -0.005, 2, 2), C.grass, { map: "grass", ambient: 1 })
  k.add(ground(PARK_SW.x0, PARK_SW.x1, DC_SW.z0, zEnd, 0, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  k.add(ground(VERGE.x0, VERGE.x1, DC_SW.z0, DC_SW.z1, 0, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  // Rue des Carrières either side of Boyer, its sidewalks, the corner lot strip
  k.add(ground(X_MIN, ROAD.x0, DC.z0, DC.z1, -0.08, 3), C.asphalt, { map: "asphalt", ambient: 1 })
  k.add(ground(ROAD.x1, X_MAX, DC.z0, DC.z1, -0.08, 3), C.asphalt, { map: "asphalt", ambient: 1 })
  k.add(ground(X_MIN, SIDEWALK.x0, DC_SW.z0, DC_SW.z1, 0, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  k.add(ground(PARK_SW.x1, X_MAX, DC_SW.z0, DC_SW.z1, 0, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  k.add(ground(PARK_SW.x1, X_MAX, DC_SW.z1, PARK.z0, -0.005, 2, 2), C.grass, { map: "grass", ambient: 1 })
  // Far side of des Carrières: verge, Réseau Vert pavers, verge, then the railway
  k.add(ground(X_MIN, X_MAX, DC.z0 - 2.2, DC.z0, -0.005, 2, 2), C.grass, { map: "grass", ambient: 1 })
  k.add(ground(X_MIN, X_MAX, GREENWAY.z0, GREENWAY.z1, 0, 1.2, 2), "#d8d2c8", { map: "pavers", ambient: 1 })
  k.add(ground(X_MIN, X_MAX, RAIL.z1, GREENWAY.z0, -0.005, 2, 2), C.grass, { map: "grass", ambient: 1 })
  // Curbs
  k.box([ROAD.x0 - 0.12, ROAD.x0, -0.08, 0, DC.z1, zEnd], "#a8a49c")
  k.box([ROAD.x1, ROAD.x1 + 0.12, -0.08, 0, DC.z1, zEnd], "#a8a49c")
  k.box([X_MIN, ROAD.x0, -0.08, 0, DC.z1, DC.z1 + 0.12], "#a8a49c")
  k.box([ROAD.x1, X_MAX, -0.08, 0, DC.z1, DC.z1 + 0.12], "#a8a49c")
  k.box([X_MIN, X_MAX, -0.08, 0, DC.z0 - 0.12, DC.z0], "#a8a49c")
  // Road markings: Boyer bike lane + crosswalks at the corner
  for (let z = DC.z1 + 2; z < zEnd; z += 5) k.add(ground(ROAD.x1 - 1.9, ROAD.x1 - 1.78, z, z + 3, -0.072, 1, 4), "#f0f0ea", { ambient: 1 })
  for (let x = ROAD.x0 + 0.4; x < ROAD.x1 - 0.4; x += 1.1) k.add(ground(x, x + 0.55, DC.z1 + 0.4, DC.z1 + 2.6, -0.072, 1, 4), "#f0f0ea", { ambient: 1 })
  for (let z = DC.z0 + 0.4; z < DC.z1 - 0.4; z += 1.1) k.add(ground(ROAD.x1 + 0.3, ROAD.x1 + 2.5, z, z + 0.55, -0.072, 1, 4), "#f0f0ea", { ambient: 1 })
  // Grass beyond the far end of the row
  k.add(ground(-30, lotEdge, ROW_Z.z1, zEnd, -0.01, 2), C.grass, { map: "grass", ambient: 1 })

  // ── Our lot: wooden fence on the door side, bins, the two cars, tree by the sidewalk ──
  fenceZ(k, -4.57, HOUSE.back + 1.3, 15.5, 1.8, C.fence)
  for (const [z, col] of [[-4.0, "#2f5a36"], [-3.3, "#2f5a36"]] as [number, string][]) {
    k.box([17.2, 17.9, 0, 1.05, z - 0.3, z + 0.3], col, { collide: true })
    k.box([17.15, 17.95, 1.05, 1.12, z - 0.34, z + 0.34], col)
  }
  car(k, 15.1, -2.45, "#e9ebec", "suv")            // white VW SUV, nose to the street
  car(k, 15.3, 1.35, "#233c8c", "wagon", true)     // blue Ford Flex, rear to the street
  addTree(k, { x: 18.2, z: 3.4, s: 1.4, kind: "round" }, r)
  for (let x = 8; x < 18; x += 0.9) k.add(at(new THREE.IcosahedronGeometry(0.28 + r() * 0.2, 0), x, 0.2, 3.55 + r() * 0.2, r(), r(), r()), "#5d7f36", { map: "leaves", ambient: 0.55 })

  // ── Neighbours' lots ──
  // Down the street: red car + green bins, then the corner lot's tall plank fence
  car(k, 14.8, -8.6, "#c8261f", "hatch")
  for (const z of [-11.6, -10.9, -10.2]) {
    k.box([18.2, 18.85, 0, 1.05, z - 0.3, z + 0.3], "#2f6a3a", { collide: true })
    k.box([18.15, 18.9, 1.05, 1.12, z - 0.34, z + 0.34], "#2f6a3a")
  }
  k.box([16.8, 16.9, 0, 2.2, ROW_Z.z0 + 0.3, -12.6], C.fence, { map: "planks", tile: 1.2, collide: true })
  fenceZ(k, -12.5, 1.5, 16.8, 2.2, C.fence)
  k.box([1.5, 16.8, 0, 2.2, ROW_Z.z0 + 0.2, ROW_Z.z0 + 0.3], C.fence, { map: "planks", tile: 1.2, collide: true })
  // Up the street: sumac, raised beds, grey panel fence, mural lot
  addTree(k, { x: 17.8, z: 9.8, s: 1.3, kind: "sumac" }, r)
  for (const z of [5.4, 8.0]) k.box([8.4, 10.2, 0, 0.4, z - 0.55, z + 0.55], C.wood, { map: "planks", tile: 0.8, collide: true })
  fenceZ(k, 11.2, 6.0, 16.5, 1.7, "#cfd0cc", "concrete")
  car(k, 12.5, 15.5, "#2a2d33", "suv", true)
  car(k, 14.2, 24, "#e6e2d6", "wagon")
  fenceZ(k, 28, 2.5, 14, 1.8, C.fence)
  car(k, 14.5, 40, "#6d7075", "hatch")
  fenceZ(k, 44, 3.2, 14, 1.6, "#bfb9ae", "concrete")
  for (let i = 0; i < 26; i++) k.add(at(new THREE.IcosahedronGeometry(0.3 + r() * 0.35, 0), 16 + r() * 2.5, 0.25, 12 + r() * 46, r(), r(), r()), "#557a33", { map: "leaves", ambient: 0.55 })

  // ── Boyer: cars parked on our side, hydro poles + wires on the park side ──
  const cols = ["#d9d9d9", "#1f2226", "#8a1d1d", "#5a6a7a", "#e0e0e0", "#2d4f7a", "#9aa0a6", "#f2f2f2"]
  for (let z = -18, i = 0; z < 86; z += 6.2 + r() * 2.5, i++) {
    if (r() < 0.35 || (z > -6 && z < 4)) continue   // keep our driveway clear
    car(k, ROAD.x0 + 1.1, z, cols[i % cols.length], i % 3 === 0 ? "suv" : "hatch", true)
  }
  const poleX = VERGE.x0 + 0.9
  const poleZs: number[] = []
  for (let z = -21; z < zEnd; z += 31) { pole(k, poleX, z); poleZs.push(z) }
  for (let i = 0; i < poleZs.length - 1; i++) {
    for (const dx of [-0.9, 0, 0.9]) {
      k.box([poleX + dx - 0.015, poleX + dx + 0.015, 9.38, 9.41, poleZs[i], poleZs[i + 1]], "#1a1a1a")
    }
  }
  for (let x = -30; x < X_MAX; x += 30) pole(k, x, DC.z0 - 1.2, 1, false)
  for (let x = -30; x < X_MAX - 30; x += 30) for (const dz of [-0.9, 0, 0.9]) {
    k.box([x, x + 30, 9.38, 9.41, DC.z0 - 1.2 + dz - 0.015, DC.z0 - 1.2 + dz + 0.015], "#1a1a1a")
  }
  for (let z = -14; z < zEnd; z += 12) addTree(k, { x: VERGE.x0 + 0.9 + (r() - 0.5) * 0.3, z: z + 6 + r() * 3, s: 0.9 + r() * 0.3, kind: "round" }, r)

  // ── Réseau Vert + railway ──
  for (let x = -36; x < X_MAX; x += 9) addTree(k, { x: x + r() * 3, z: GREENWAY.z1 + 1.1, s: 0.9 + r() * 0.4, kind: r() < 0.3 ? "purple" : "round" }, r)
  chainLink(k, [X_MIN, RAIL.z1 + 0.3], [X_MAX, RAIL.z1 + 0.3], 1.8)
  k.box([X_MIN, X_MAX, -0.3, 0.6, RAIL.z0, RAIL.z1], "#9a948a", { map: "ballast", tile: 1.5 })
  for (const tz of [-44.2, -48.4]) {
    for (let x = X_MIN; x < X_MAX; x += 0.65) k.box([x, x + 0.22, 0.6, 0.72, tz - 1.25, tz + 1.25], "#4a3b30")
    for (const off of [-0.72, 0.72]) k.box([X_MIN, X_MAX, 0.72, 0.84, tz + off - 0.04, tz + off + 0.04], "#6e6a66")
  }
  // Freight cars parked on the far track
  for (let x = 40, i = 0; x < 120; x += 16, i++) {
    k.box([x, x + 14.5, 1.2, 4.6, -49.8, -47], ["#6b2e22", "#3f4d5c", "#7a6a3a"][i % 3], { map: "panels", tile: 1.2 })
    for (const wx of [x + 2, x + 12.5]) k.box([wx - 1, wx + 1, 0.84, 1.2, -49.6, -47.2], "#222222")
  }

  // ── Parc des Carrières ──
  const P = PARK
  k.add(ground(P.x0, P.x1, P.z0, P.z1, -0.02, 2, 4), C.grass, { map: "grass", ambient: 1 })
  // Chain-link fence along Boyer + des Carrières, with gaps for the entrances
  chainLink(k, [P.x0 - 0.1, P.z0], [P.x0 - 0.1, 2])
  chainLink(k, [P.x0 - 0.1, 6], [P.x0 - 0.1, 44])
  chainLink(k, [P.x0 - 0.1, 48], [P.x0 - 0.1, P.z1])
  chainLink(k, [P.x0 + 4, P.z0 - 0.1], [P.x1, P.z0 - 0.1])
  const fz = 34, fx = 76
  // Soccer field with worn sand goalmouths
  for (const zg of [fz - 30, fz + 30]) {
    const zs = Math.sign(zg - fz)
    k.add(ground(fx - 3, fx + 3, zg - (zs > 0 ? 7 : 0), zg + (zs < 0 ? 7 : 0), 0.004, 2, 2), C.sand, { map: "concrete", ambient: 1 })
    const gz = zg + zs * 0.2
    k.box([fx - 3.66, fx - 3.56, 0, 2.44, gz - 0.05, gz + 0.05], "#f4f4f4", { collide: true })
    k.box([fx + 3.56, fx + 3.66, 0, 2.44, gz - 0.05, gz + 0.05], "#f4f4f4", { collide: true })
    k.box([fx - 3.66, fx + 3.66, 2.34, 2.44, gz - 0.05, gz + 0.05], "#f4f4f4")
  }
  k.add(ground(fx - 2, fx + 2, fz - 12, fz + 12, 0.003, 2, 2), "#b9a57a", { map: "concrete", ambient: 1 })
  // Path loop around the field + entrance paths
  const pathPts: [number, number][] = []
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2
    pathPts.push([fx + Math.cos(a) * 24, fz + Math.sin(a) * 44])
  }
  for (let i = 0; i < pathPts.length - 1; i++) {
    const [ax, az] = pathPts[i], [bx, bz] = pathPts[i + 1]
    const len = Math.hypot(bx - ax, bz - az) + 0.3
    k.add(at(new THREE.PlaneGeometry(len, 2.2, 2, 1).rotateX(-Math.PI / 2), (ax + bx) / 2, 0.006, (az + bz) / 2, 0, -Math.atan2(bz - az, bx - ax)), C.concrete, { map: "concrete", ambient: 1 })
  }
  for (const z of [4, 46]) k.add(ground(P.x0, fx - 22, z - 1.1, z + 1.1, 0.006, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  k.add(ground(P.x0 + 1, P.x0 + 3.2, P.z0, 4, 0.006, 1.4, 2), C.concrete, { map: "concrete", ambient: 1 })
  // Playgrounds on the Boyer side
  k.add(ground(38, 52, 10, 22, 0.005, 2, 2), C.sand, { map: "concrete", ambient: 1 })
  k.add(ground(38, 50, 26, 38, 0.005, 2, 2), C.sand, { map: "concrete", ambient: 1 })
  k.box([42, 44, 1.2, 1.35, 13, 15], "#3b6fb6", { collide: true })
  for (const [px, pz] of [[42, 13], [44, 13], [42, 15], [44, 15]]) k.box([px - 0.06, px + 0.06, 0, 2.6, pz - 0.06, pz + 0.06], "#d23b2f", { collide: true })
  k.add(at(new THREE.BoxGeometry(3.0, 0.08, 0.7), 45.35, 0.65, 14, 0, 0, -0.42), "#e7c43a")
  k.add(at(new THREE.ConeGeometry(1.5, 1.0, 4).rotateY(Math.PI / 4), 43, 3.1, 14), "#d23b2f")
  for (const z of [17.5, 20.5]) k.box([47.5, 47.6, 0, 2.3, z - 0.05, z + 0.05], "#2f7d4f", { collide: true })
  k.box([47.45, 47.65, 2.2, 2.35, 17.5, 20.5], "#2f7d4f")
  for (const z of [18.2, 19.8]) k.box([47.3, 47.8, 0.45, 0.5, z - 0.2, z + 0.2], "#222222")
  // Teal climbing sculpture in the second playground
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9
    k.add(at(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), 44 + Math.cos(a) * 2, 1.2, 32 + Math.sin(a) * 2, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6), "#3aa7a0")
  }
  k.add(at(new THREE.IcosahedronGeometry(1.1, 0), 44, 2.3, 32), "#2f8f9a")
  k.colliders.push([42.5, 45.5, 0, 2.5, 30.5, 33.5])
  // Bocce court + basketball court
  k.add(ground(38, 46, -16, -4, 0.006, 1.5, 2), "#c9b894", { map: "concrete", ambient: 1 })
  k.box([37.9, 46.1, 0, 0.2, -16.1, -16], C.wood); k.box([37.9, 46.1, 0, 0.2, -4, -3.9], C.wood)
  k.add(ground(96, 108, 52, 68, 0.006, 1.5, 2), "#8d8d8f", { map: "concrete", ambient: 1 })
  for (const z of [52.8, 67.2]) {
    k.box([101.92, 102.08, 0, 3.05, z - 0.08, z + 0.08], C.metal, { collide: true })
    k.box([101.1, 102.9, 2.9, 3.9, z - 0.05, z + 0.05], "#f4f4f4")
  }
  // Benches along the path
  for (let i = 3; i < 40; i += 6) {
    const [bx, bz] = pathPts[i]
    const ox = (bx - fx) / 24 * 1.8, oz = (bz - fz) / 44 * 1.8
    k.box([bx + ox - 0.8, bx + ox + 0.8, 0.42, 0.48, bz + oz - 0.25, bz + oz + 0.25], C.wood, { collide: true })
  }
  // Park trees around the edges, a few copper beeches
  for (let i = 0; i < 100; i++) {
    const a = r() * Math.PI * 2
    const d = 0.78 + r() * 0.3
    const tx = fx + Math.cos(a) * 36 * d, tz = fz + Math.sin(a) * 58 * d
    if (tx < P.x0 + 2 || tx > P.x1 - 2 || tz < P.z0 + 2 || tz > P.z1 - 2) continue
    if (tx < 53 && tz > 8 && tz < 40) continue    // keep the playgrounds open
    addTree(k, { x: tx, z: tz, s: 1.1 + r() * 0.6, kind: r() < 0.12 ? "purple" : r() < 0.2 ? "pine" : "round" }, r)
  }
  // Apartment block across Boyer beyond the park (skyline)
  k.box([40, 70, 0, 12.5, 96, 124], "#6e4638", { map: "brick", tile: 0.6, solid: true })
  for (let y = 1; y < 12; y += 3.05) for (let z = 98; z < 122; z += 3.2) windowX(k, 40 - 0.06, z, y + 0.6, 1.4, 1.3, 2, 1)

  // ── Far ground + horizon treeline ──
  k.add(ground(-400, 400, -400, 400, -0.35, 2, 25), "#5f8a45", { map: "grass", ambient: 1 })
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + r() * 0.05, d = 170 + r() * 50
    const x = 40 + Math.cos(a) * d, z = 20 + Math.sin(a) * d
    const s = 2.2 + r() * 1.5
    k.add(at(new THREE.CylinderGeometry(0.2 * s, 0.3 * s, 2 * s, 5), x, s, z), "#5a4535")
    k.add(at(new THREE.IcosahedronGeometry(1.8 * s, 0), x, 3 * s, z, r(), r(), r()), "#446d35", { map: "leaves", ambient: 0.5 })
  }

  // ── World bounds: railway fence, far ends of the streets, park edge ──
  k.colliders.push([PARK.x1, PARK.x1 + 0.5, 0, 6, RAIL.z1, Z_MAX + 2])
  k.colliders.push([-30, PARK.x1, 0, 6, Z_MAX, Z_MAX + 0.5])
  k.colliders.push([X_MIN, X_MIN + 0.5, 0, 6, RAIL.z1, DC_SW.z1])
  k.colliders.push([X_MAX - 0.5, X_MAX, 0, 6, RAIL.z1, DC_SW.z1])
  k.colliders.push([-30.5, -30, 0, 6, ROW_Z.z1, Z_MAX])

  return k
}

// ── Interior side of the rebuilt east wall (lit like the rest of the room) ──

function InteriorEastWall() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e7ded0", roughness: 0.95 }), [])
  const x0 = IN_WALL.x0, x1 = IN_WALL.x1
  const pieces: B[] = [
    [x0, x1, 0, CEIL, -4.3, DOOR.z0],
    [x0, x1, DOOR.head, CEIL, DOOR.z0, DOOR.z1],
    [x0, x1, 0, DOOR.sill, DOOR.z0, DOOR.z1],
    [x0, x1, 0, CEIL, DOOR.z1, GARAGE.z0],
    [x0, x1, GARAGE.top, CEIL, GARAGE.z0, GARAGE.z1],
    [x0, x1, 0, CEIL, GARAGE.z1, KWINDOW.z0],
    [x0, x1, 0, KWINDOW.y0, KWINDOW.z0, KWINDOW.z1],
    [x0, x1, KWINDOW.y1, CEIL, KWINDOW.z0, KWINDOW.z1],
    [x0, x1, 0, CEIL, KWINDOW.z1, 3.5],
  ]
  return (
    <group>
      {pieces.map(([a, b, c, d, e, f], i) => (
        <mesh key={i} material={mat} position={[(a + b) / 2, (c + d) / 2, (e + f) / 2]}>
          <boxGeometry args={[b - a, d - c, f - e]} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {pieces.map(([a, b, c, d, e, f], i) => (
          <CuboidCollider key={i} args={[(b - a) / 2, (d - c) / 2, (f - e) / 2]} position={[(a + b) / 2, (c + d) / 2, (e + f) / 2]} />
        ))}
        {/* Invisible ramps so the capsule can walk up the 26 cm tile landing and the outside step */}
        <Ramp x0={2.3} x1={3.14} z0={-4.23} z1={-2.23} h={DOOR.sill} axis="x" dir={1} />
        <Ramp x0={3.14} x1={4.97} z0={-2.23} z1={-1.4} h={DOOR.sill} axis="z" dir={-1} />
        <Ramp x0={HOUSE.back + 1.3} x1={HOUSE.back + 2.2} z0={-4.45} z1={-2.75} h={DOOR.sill} axis="x" dir={-1} />
      </RigidBody>
    </group>
  )
}

/** Sloped collider rising by `h` across the rectangle, highest at the `dir` end of `axis`. */
function Ramp({ x0, x1, z0, z1, h, axis, dir }: { x0: number; x1: number; z0: number; z1: number; h: number; axis: "x" | "z"; dir: 1 | -1 }) {
  const run = axis === "x" ? x1 - x0 : z1 - z0
  const width = axis === "x" ? z1 - z0 : x1 - x0
  const len = Math.hypot(run, h), a = Math.atan2(h, run), t = 0.1
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  // Drop the box by half its thickness along the slope normal so its top face is the slope
  const ny = Math.cos(a) * t / 2, nr = Math.sin(a) * t / 2
  if (axis === "x") {
    return <CuboidCollider args={[len / 2, t / 2, width / 2]} position={[cx + nr * dir, h / 2 - ny, cz]} rotation={[0, 0, a * dir]} />
  }
  return <CuboidCollider args={[width / 2, t / 2, len / 2]} position={[cx, h / 2 - ny, cz + nr * dir]} rotation={[-a * dir, 0, 0]} />
}

/** Glazed back door; swings open into the house whenever the player is close. */
function BackDoor() {
  const hinge = useRef<THREE.Group>(null)
  const amt = useRef(0)
  const { frame, glass } = useMemo(() => {
    const w = DOOR.z1 - DOOR.z0 - 0.02, h = DOOR.head - DOOR.sill - 0.02
    const fr: THREE.BufferGeometry[] = []
    const t = 0.05, bar = 0.035
    // Leaf frame, then a 3×5 grid of muntins like the real door
    fr.push(at(new THREE.BoxGeometry(t, h, 0.1), 0, h / 2, 0.05))
    fr.push(at(new THREE.BoxGeometry(t, h, 0.1), 0, h / 2, w - 0.05))
    fr.push(at(new THREE.BoxGeometry(t, 0.12, w), 0, h - 0.06, w / 2))
    fr.push(at(new THREE.BoxGeometry(t, 0.22, w), 0, 0.11, w / 2))
    for (let c = 1; c < 3; c++) fr.push(at(new THREE.BoxGeometry(t * 0.8, h - 0.34, bar), 0, 0.22 + (h - 0.34) / 2, 0.1 + ((w - 0.2) * c) / 3))
    for (let r = 1; r < 5; r++) fr.push(at(new THREE.BoxGeometry(t * 0.8, bar, w - 0.2), 0, 0.22 + ((h - 0.34) * r) / 5, w / 2))
    const merged = mergeGeometries(fr.map((g) => { const o = new THREE.BufferGeometry(); o.setAttribute("position", g.toNonIndexed().attributes.position); return o }), false)!
    const gl = at(new THREE.BoxGeometry(0.015, h - 0.34, w - 0.2), 0, 0.22 + (h - 0.34) / 2, w / 2)
    return { frame: bakeSun(merged, "#f3f1eb", 0.65), glass: bakeSun(gl, "#5d7489", 0.85) }
  }, [])
  const mat = useMemo(() => unlit(), [])
  useFrame((_, dt) => {
    const p = playerState.position
    const near = Math.hypot(p.x - FRONT_DOOR.x, p.z - FRONT_DOOR.z) < 2.4
    amt.current = THREE.MathUtils.damp(amt.current, near ? 1 : 0, 5, dt)
    if (hinge.current) hinge.current.rotation.y = -amt.current * 1.6
  })
  return (
    <group ref={hinge} position={[(IN_WALL.x0 + IN_WALL.x1) / 2 + 0.05, DOOR.sill + 0.01, DOOR.z0 + 0.01]}>
      <mesh geometry={frame} material={mat} raycast={noRaycast} />
      <mesh geometry={glass} material={mat} raycast={noRaycast} />
    </group>
  )
}

// ── Sky + lighting ───────────────────────────────────────────────────────────

/**
 * Sunlight for lit objects (the player) while outdoors. Lights in three can't be
 * limited to an area, so it fades in only once the player leaves the building;
 * the interior isn't visible from outside so it never shows up indoors.
 * Intensities are huge because of the scene's 0.002 exposure.
 */
function OutdoorSun() {
  const sun = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.HemisphereLight>(null)
  const amt = useRef(0)
  useFrame((_, dt) => {
    const p = playerState.position
    const outside = p.x > IN_WALL.x1 || p.z < HOUSE.n || p.z > HOUSE.s
    amt.current = THREE.MathUtils.damp(amt.current, outside ? 1 : 0, 4, dt)
    if (sun.current) sun.current.intensity = 1600 * amt.current
    if (fill.current) fill.current.intensity = 900 * amt.current
  })
  const pos = SUN_DIR.clone().multiplyScalar(60)
  return (
    <>
      <directionalLight ref={sun} position={[pos.x, pos.y, pos.z]} intensity={0} color="#fff3dd" />
      <hemisphereLight ref={fill} args={["#cfe2f1", "#8a8577", 0]} />
    </>
  )
}

function Sky() {
  const { dome, sun, clouds } = useMemo(() => {
    const g = new THREE.SphereGeometry(800, 24, 12)
    const pos = g.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const top = new THREE.Color("#4f86cc"), hor = new THREE.Color("#cfe2f1"), low = new THREE.Color("#9fb2a0")
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 800
      if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6))
      else c.copy(hor).lerp(low, Math.min(1, -y * 4))
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3))
    const domeMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }))
    domeMesh.raycast = noRaycast

    const sunMesh = new THREE.Mesh(new THREE.CircleGeometry(28, 16), new THREE.MeshBasicMaterial({ color: "#fff7da", fog: false, toneMapped: false, depthWrite: false }))
    sunMesh.raycast = noRaycast

    const r = rng(21)
    const cl: THREE.BufferGeometry[] = []
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2, d = 220 + r() * 300
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 90 + r() * 60
      for (let k = 0; k < 4; k++) {
        const s = 14 + r() * 16
        cl.push(at(new THREE.IcosahedronGeometry(s, 0).scale(1.6, 0.45, 1), cx + (k - 1.5) * s * 1.3, cy + r() * 5, cz + r() * 10))
      }
    }
    const cloudGeo = bakeSun(mergeGeometries(cl.map((p) => { const o = new THREE.BufferGeometry(); o.setAttribute("position", p.toNonIndexed().attributes.position); return o }), false)!, "#ffffff", 0.82)
    const cloudMesh = new THREE.Mesh(cloudGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }))
    cloudMesh.raycast = noRaycast
    return { dome: domeMesh, sun: sunMesh, clouds: cloudMesh }
  }, [])

  useFrame(({ camera }) => {
    dome.position.copy(camera.position)
    sun.position.copy(SUN_DIR).multiplyScalar(700).add(camera.position)
    sun.lookAt(camera.position)
  })

  return (
    <>
      <primitive object={dome} renderOrder={-1} />
      <primitive object={sun} renderOrder={-1} />
      <primitive object={clouds} />
    </>
  )
}

export default function Exterior() {
  const kit = useMemo(() => buildWorld(), [])
  return (
    <group>
      <OutdoorSun />
      <Sky />
      <KitMeshes kit={kit} />
      <InteriorEastWall />
      <BackDoor />
    </group>
  )
}
