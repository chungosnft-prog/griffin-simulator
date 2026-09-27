"use client"

import { useMemo } from "react"
import * as THREE from "three"
import { Reflector } from "three/examples/jsm/objects/Reflector.js"
import { tex, worldBox } from "./ps1Materials"

/*
 * Bathroom dressing. Room interior (measured): X -10.008 … -7.609,
 * Z -3.66 … -1.62, ceiling 2.02, doorway in the south wall at X -9.45 … -8.48.
 * Sink sits on the north wall under the mirror, toilet in the north-east corner.
 * Everything here uses lit materials so it matches the GLB's interior lighting.
 */

const R = { x0: -10.008, x1: -7.609, z0: -3.66, z1: -1.62, ceil: 2.02, door0: -9.45, door1: -8.48 }
const TILE_H = 1.05

function paintingTexture() {
  const cv = document.createElement("canvas")
  cv.width = 48; cv.height = 36
  const c = cv.getContext("2d")!
  const sky = c.createLinearGradient(0, 0, 0, 20)
  sky.addColorStop(0, "#f4a86a"); sky.addColorStop(1, "#fbe3b0")
  c.fillStyle = sky; c.fillRect(0, 0, 48, 20)
  c.fillStyle = "#ffe89a"; c.beginPath(); c.arc(33, 17, 5, 0, Math.PI * 2); c.fill()
  c.fillStyle = "#3f6f8f"; c.fillRect(0, 20, 48, 16)
  c.fillStyle = "#6c9bb6"; for (let y = 22; y < 36; y += 3) c.fillRect((y * 7) % 11, y, 18, 1)
  // Sailboat
  c.fillStyle = "#5a3b28"; c.fillRect(10, 22, 12, 2)
  c.fillStyle = "#ffffff"; c.beginPath(); c.moveTo(16, 21); c.lineTo(16, 9); c.lineTo(23, 21); c.fill()
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  return t
}

type B = [number, number, number, number, number, number]
function Box({ b, mat, tile }: { b: B; mat: THREE.Material; tile?: number }) {
  const [x0, x1, y0, y1, z0, z1] = b
  const geo = useMemo(() => worldBox(x1 - x0, y1 - y0, z1 - z0, tile ?? 1), [x0, x1, y0, y1, z0, z1, tile])
  return <mesh geometry={geo} material={mat} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} />
}

function Cyl({ p, r, h, mat, rTop, seg = 12, rot }: {
  p: [number, number, number]; r: number; h: number; mat: THREE.Material; rTop?: number; seg?: number; rot?: [number, number, number]
}) {
  return (
    <mesh material={mat} position={p} rotation={rot}>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
    </mesh>
  )
}

export default function BathroomDecor() {
  const m = useMemo(() => ({
    tile:    new THREE.MeshStandardMaterial({ color: "#d3e3e6", map: tex("tiles"), roughness: 0.35 }),
    rail:    new THREE.MeshStandardMaterial({ color: "#f3f1ec", roughness: 0.5 }),
    chrome:  new THREE.MeshStandardMaterial({ color: "#c9ced4", roughness: 0.2, metalness: 0.9 }),
    towel:   new THREE.MeshStandardMaterial({ color: "#3f7fa0", roughness: 1 }),
    towel2:  new THREE.MeshStandardMaterial({ color: "#e9e1d0", roughness: 1 }),
    matRug:  new THREE.MeshStandardMaterial({ color: "#5f8fa3", roughness: 1 }),
    wood:    new THREE.MeshStandardMaterial({ color: "#8a6242", roughness: 0.7 }),
    frame:   new THREE.MeshStandardMaterial({ color: "#2e2a26", roughness: 0.6 }),
    art:     new THREE.MeshStandardMaterial({ map: paintingTexture(), roughness: 0.8 }),
    paper:   new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 1 }),
    pot:     new THREE.MeshStandardMaterial({ color: "#b8643e", roughness: 0.9 }),
    leaf:    new THREE.MeshStandardMaterial({ color: "#3f7a3a", roughness: 0.8, flatShading: true }),
    bin:     new THREE.MeshStandardMaterial({ color: "#d9dcdf", roughness: 0.4, metalness: 0.3 }),
    bottleA: new THREE.MeshStandardMaterial({ color: "#6fb3c8", roughness: 0.3 }),
    bottleB: new THREE.MeshStandardMaterial({ color: "#e8c65a", roughness: 0.3 }),
    bottleC: new THREE.MeshStandardMaterial({ color: "#d66f8a", roughness: 0.3 }),
    candle:  new THREE.MeshStandardMaterial({ color: "#fff4dc", roughness: 0.9, emissive: "#ffcf80", emissiveIntensity: 40 }),
    shade:   new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.4, emissive: "#fff4d8", emissiveIntensity: 200 }),
  }), [])

  // Real mirror over the sink, in front of the GLB's black "MIRROR TEXTURE THIS" plane
  const mirror = useMemo(() => {
    const r = new Reflector(new THREE.PlaneGeometry(0.9, 0.9), {
      textureWidth: 256, textureHeight: 256, color: 0xa9b4b8, clipBias: 0.003, multisample: 0,
    })
    r.position.set(-8.785, 1.31, -3.585)
    return r
  }, [])

  const e = 0.012   // tile panel thickness
  const tiles: B[] = [
    [R.x0, R.x0 + e, 0, TILE_H, R.z0, R.z1],                  // west
    [R.x1 - e, R.x1, 0, TILE_H, R.z0, R.z1],                  // east
    [R.x0, R.x1, 0, TILE_H, R.z0, R.z0 + e],                  // north
    [R.x0, R.door0, 0, TILE_H, R.z1 - e, R.z1],               // south, either side of the door
    [R.door1, R.x1, 0, TILE_H, R.z1 - e, R.z1],
  ]
  const rails: B[] = [
    [R.x0, R.x0 + 0.03, TILE_H, TILE_H + 0.05, R.z0, R.z1],
    [R.x1 - 0.03, R.x1, TILE_H, TILE_H + 0.05, R.z0, R.z1],
    [R.x0, R.x1, TILE_H, TILE_H + 0.05, R.z0, R.z0 + 0.03],
    [R.x0, R.door0, TILE_H, TILE_H + 0.05, R.z1 - 0.03, R.z1],
    [R.door1, R.x1, TILE_H, TILE_H + 0.05, R.z1 - 0.03, R.z1],
  ]

  return (
    <group>
      {/* Tiled wainscot + chair rail */}
      {tiles.map((b, i) => <Box key={"t" + i} b={b} mat={m.tile} tile={0.6} />)}
      {rails.map((b, i) => <Box key={"r" + i} b={b} mat={m.rail} />)}

      {/* Mirror + frame */}
      <primitive object={mirror} />
      <Box b={[-9.28, -8.29, 1.74, 1.8, -3.63, -3.57]} mat={m.frame} />
      <Box b={[-9.28, -8.29, 0.82, 0.88, -3.63, -3.57]} mat={m.frame} />
      <Box b={[-9.28, -9.22, 0.82, 1.8, -3.63, -3.57]} mat={m.frame} />
      <Box b={[-8.35, -8.29, 0.82, 1.8, -3.63, -3.57]} mat={m.frame} />

      {/* Soap dispenser + toothbrush cup on the sink corners */}
      <Cyl p={[-8.98, 0.99, -3.36]} r={0.03} h={0.12} mat={m.bottleA} />
      <Cyl p={[-8.98, 1.07, -3.36]} r={0.008} h={0.05} mat={m.chrome} />
      <Cyl p={[-8.6, 0.98, -3.36]} r={0.03} rTop={0.035} h={0.1} mat={m.chrome} />
      <Box b={[-8.61, -8.6, 1.0, 1.12, -3.37, -3.36]} mat={m.bottleC} />
      <Box b={[-8.595, -8.585, 1.0, 1.1, -3.355, -3.345]} mat={m.bottleB} />

      {/* Bath mat in front of the sink */}
      <Box b={[-9.12, -8.46, 0.012, 0.026, -2.98, -2.52]} mat={m.matRug} />

      {/* Towel bar + towels on the west wall */}
      <Box b={[R.x0 + 0.01, R.x0 + 0.06, 1.2, 1.24, -3.0, -2.98]} mat={m.chrome} />
      <Box b={[R.x0 + 0.01, R.x0 + 0.06, 1.2, 1.24, -2.2, -2.18]} mat={m.chrome} />
      <Cyl p={[R.x0 + 0.07, 1.22, -2.59]} r={0.012} h={0.84} mat={m.chrome} rot={[Math.PI / 2, 0, 0]} />
      <Box b={[R.x0 + 0.04, R.x0 + 0.075, 0.62, 1.24, -2.9, -2.3]} mat={m.towel} />
      <Box b={[R.x0 + 0.075, R.x0 + 0.1, 0.75, 1.24, -2.88, -2.32]} mat={m.towel} />
      <Box b={[R.x0 + 0.1, R.x0 + 0.105, 0.74, 0.8, -2.88, -2.32]} mat={m.towel2} />

      {/* Floating shelf with toiletries, candle and a succulent */}
      <Box b={[R.x0, R.x0 + 0.22, 1.5, 1.53, -3.5, -3.1]} mat={m.wood} />
      <Cyl p={[R.x0 + 0.1, 1.61, -3.44]} r={0.03} h={0.16} mat={m.bottleB} />
      <Cyl p={[R.x0 + 0.1, 1.59, -3.36]} r={0.028} h={0.12} mat={m.bottleC} />
      <Cyl p={[R.x0 + 0.12, 1.57, -3.26]} r={0.04} h={0.08} mat={m.candle} />
      <Cyl p={[R.x0 + 0.1, 1.57, -3.16]} r={0.035} rTop={0.045} h={0.08} mat={m.pot} />
      <mesh material={m.leaf} position={[R.x0 + 0.1, 1.64, -3.16]}><icosahedronGeometry args={[0.055, 0]} /></mesh>

      {/* Toilet paper holder + roll, and a toilet brush, beside the toilet */}
      <Box b={[R.x1 - 0.03, R.x1, 0.66, 0.7, -2.3, -2.08]} mat={m.chrome} />
      <Cyl p={[R.x1 - 0.1, 0.62, -2.19]} r={0.055} h={0.1} mat={m.paper} rot={[Math.PI / 2, 0, 0]} />
      <Cyl p={[R.x1 - 0.14, 0.09, -2.0]} r={0.06} h={0.18} mat={m.bin} />
      <Cyl p={[R.x1 - 0.14, 0.28, -2.0]} r={0.008} h={0.25} mat={m.chrome} />

      {/* Framed seascape above the toilet */}
      <Box b={[R.x1 - 0.03, R.x1, 1.3, 1.82, -3.05, -2.35]} mat={m.frame} />
      <mesh material={m.art} position={[R.x1 - 0.032, 1.56, -2.7]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.62, 0.44]} />
      </mesh>

      {/* Pedal bin next to the sink */}
      <Cyl p={[-9.55, 0.16, -3.45]} r={0.12} rTop={0.13} h={0.32} mat={m.bin} />
      <Cyl p={[-9.55, 0.33, -3.45]} r={0.135} h={0.02} mat={m.chrome} />

      {/* Potted plant in the south-west corner */}
      <Cyl p={[R.x0 + 0.22, 0.15, R.z1 - 0.22]} r={0.13} rTop={0.16} h={0.3} mat={m.pot} />
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} material={m.leaf}
          position={[R.x0 + 0.22 + Math.cos(i * 1.3) * 0.07, 0.45 + (i % 3) * 0.1, R.z1 - 0.22 + Math.sin(i * 1.3) * 0.07]}
          rotation={[i, i * 2, 0]}>
          <icosahedronGeometry args={[0.13 - i * 0.012, 0]} />
        </mesh>
      ))}

      {/* Ceiling light */}
      <Cyl p={[-9.14, R.ceil - 0.05, -2.3]} r={0.18} rTop={0.12} h={0.08} mat={m.shade} />
    </group>
  )
}
