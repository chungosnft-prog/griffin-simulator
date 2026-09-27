"use client"

import { useMemo } from "react"
import * as THREE from "three"
import { RigidBody, CuboidCollider } from "@react-three/rapier"

/*
 * The unfinished west end of house.glb (X -19.1 … -14.66) becomes a back
 * room / mudroom off the drum room. The GLB's loose partition panel there
 * (Plane.006) is hidden by HouseEnvironment and replaced by this wall with a
 * walkable doorway. Lit like the rest of the interior.
 */

const PART_X  = -14.66            // partition wall centre
const Z_BACK  = -4.32             // inner face of the back siding wall
const Z_FRONT = 3.55              // inner face of the front siding wall
const X_WEST  = -19.1             // inner face of the west siding wall
const CEIL    = 2.68
const DOORWAY = { z0: -1.6, z1: -0.5, h: 2.1 }

type B = [number, number, number, number, number, number]
const PARTITION: B[] = [
  [PART_X - 0.06, PART_X + 0.06, 0, CEIL, Z_BACK, DOORWAY.z0],
  [PART_X - 0.06, PART_X + 0.06, 0, CEIL, DOORWAY.z1, Z_FRONT],
  [PART_X - 0.06, PART_X + 0.06, DOORWAY.h, CEIL, DOORWAY.z0, DOORWAY.z1],
]
// Drywall lining the inside of the new siding walls
const LINING: B[] = [
  [X_WEST, X_WEST + 0.02, 0, CEIL, Z_BACK, Z_FRONT],
  [X_WEST, PART_X, 0, CEIL, Z_FRONT - 0.02, Z_FRONT],
]

function Box({ b, mat }: { b: B; mat: THREE.Material }) {
  const [x0, x1, y0, y1, z0, z1] = b
  return (
    <mesh material={mat} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]}>
      <boxGeometry args={[x1 - x0, y1 - y0, z1 - z0]} />
    </mesh>
  )
}

export default function Mudroom() {
  const m = useMemo(() => ({
    wall:  new THREE.MeshStandardMaterial({ color: "#d8cfb8", roughness: 0.95 }),
    trim:  new THREE.MeshStandardMaterial({ color: "#f2eee6", roughness: 0.7 }),
    wood:  new THREE.MeshStandardMaterial({ color: "#7a5236", roughness: 0.8 }),
    dark:  new THREE.MeshStandardMaterial({ color: "#26282c", roughness: 0.6 }),
    mat:   new THREE.MeshStandardMaterial({ color: "#6a4a33", roughness: 1 }),
    coat1: new THREE.MeshStandardMaterial({ color: "#36495e", roughness: 0.9 }),
    coat2: new THREE.MeshStandardMaterial({ color: "#8a3a2c", roughness: 0.9 }),
    boot:  new THREE.MeshStandardMaterial({ color: "#3b2a1e", roughness: 0.8 }),
    floor: new THREE.MeshStandardMaterial({ color: "#3a3833", roughness: 1 }),
  }), [])

  const d = DOORWAY
  return (
    <group>
      {PARTITION.map((b, i) => <Box key={"p" + i} b={b} mat={m.wall} />)}
      {LINING.map((b, i) => <Box key={"l" + i} b={b} mat={m.wall} />)}

      {/* Doorway casing on both faces of the partition */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box b={[PART_X + s * 0.06 - 0.015, PART_X + s * 0.06 + 0.015, 0, d.h + 0.08, d.z0 - 0.08, d.z0]} mat={m.trim} />
          <Box b={[PART_X + s * 0.06 - 0.015, PART_X + s * 0.06 + 0.015, 0, d.h + 0.08, d.z1, d.z1 + 0.08]} mat={m.trim} />
          <Box b={[PART_X + s * 0.06 - 0.015, PART_X + s * 0.06 + 0.015, d.h, d.h + 0.08, d.z0 - 0.08, d.z1 + 0.08]} mat={m.trim} />
        </group>
      ))}

      {/* Baseboards */}
      <Box b={[X_WEST + 0.02, X_WEST + 0.04, 0, 0.1, Z_BACK, Z_FRONT]} mat={m.trim} />
      <Box b={[PART_X - 0.08, PART_X - 0.06, 0, 0.1, Z_BACK, d.z0]} mat={m.trim} />
      <Box b={[PART_X - 0.08, PART_X - 0.06, 0, 0.1, d.z1, Z_FRONT]} mat={m.trim} />

      {/* Floor strip where the GLB floor stops short of the new west wall */}
      <Box b={[X_WEST, -18.95, -0.02, 0.012, Z_BACK, Z_FRONT]} mat={m.floor} />


      {/* Bench along the west wall with boots underneath */}
      <Box b={[X_WEST + 0.05, X_WEST + 0.45, 0.42, 0.47, -3.2, -1.4]} mat={m.wood} />
      {[-3.1, -1.5].map((z) => <Box key={z} b={[X_WEST + 0.07, X_WEST + 0.43, 0, 0.42, z, z + 0.06]} mat={m.wood} />)}
      {[-2.9, -2.6, -2.1].map((z) => (
        <group key={z}>
          <Box b={[X_WEST + 0.12, X_WEST + 0.38, 0, 0.1, z, z + 0.11]} mat={m.boot} />
          <Box b={[X_WEST + 0.3, X_WEST + 0.38, 0.1, 0.3, z, z + 0.11]} mat={m.boot} />
        </group>
      ))}

      {/* Coat hooks + coats */}
      <Box b={[X_WEST + 0.02, X_WEST + 0.05, 1.62, 1.72, -3.2, -1.4]} mat={m.wood} />
      <Box b={[X_WEST + 0.06, X_WEST + 0.22, 0.95, 1.62, -2.95, -2.55]} mat={m.coat1} />
      <Box b={[X_WEST + 0.06, X_WEST + 0.2, 1.05, 1.62, -2.1, -1.75]} mat={m.coat2} />

      {/* Umbrella stand */}
      <mesh material={m.dark} position={[-17.8, 0.28, Z_FRONT - 0.25]}>
        <cylinderGeometry args={[0.12, 0.1, 0.56, 10]} />
      </mesh>

      {/* Ceiling lamp + light */}
      <mesh material={m.trim} position={[-16.9, CEIL - 0.06, -0.4]}>
        <cylinderGeometry args={[0.22, 0.16, 0.1, 12]} />
      </mesh>
      <pointLight position={[-16.9, 2.4, -0.4]} intensity={6000} color="#ffe9c4" decay={2} />

      <RigidBody type="fixed" colliders={false}>
        {PARTITION.map((b, i) => {
          const [x0, x1, y0, y1, z0, z1] = b
          return <CuboidCollider key={i} args={[(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} />
        })}
        <CuboidCollider args={[0.2, 0.235, 0.9]} position={[X_WEST + 0.25, 0.235, -2.3]} />
        {LINING.map((b, i) => {
          const [x0, x1, y0, y1, z0, z1] = b
          return <CuboidCollider key={"l" + i} args={[(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} />
        })}
      </RigidBody>
    </group>
  )
}
