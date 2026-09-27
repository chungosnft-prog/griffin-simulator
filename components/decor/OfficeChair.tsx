"use client"

import { useMemo } from "react"
import * as THREE from "three"
import { RigidBody, CuboidCollider } from "@react-three/rapier"

/** Where the chair stands, pulled out from the MacBook desk (desk spans X -9.18…-7.18, Z 2.39…3.43). */
export const OFFICE_CHAIR_SEAT = { x: -8.18, z: 1.72 }

const SEAT_Y = 0.47   // top of the cushion

/**
 * Black mesh office chair with a five-star base. It faces +Z (towards the desk),
 * which is also the direction the player faces while seated in it.
 */
export default function OfficeChair() {
  const mats = useMemo(() => ({
    fabric: new THREE.MeshStandardMaterial({ color: "#1d1f24", roughness: 0.9 }),
    mesh:   new THREE.MeshStandardMaterial({ color: "#2a2d34", roughness: 0.8, side: THREE.DoubleSide }),
    plastic:new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.25, metalness: 0.9 }),
  }), [])

  const legs = [0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2 + Math.PI / 10)

  return (
    <group position={[OFFICE_CHAIR_SEAT.x, 0, OFFICE_CHAIR_SEAT.z]}>
      {/* Five-star base with casters */}
      {legs.map((a, i) => (
        <group key={i} rotation={[0, a, 0]}>
          <mesh material={mats.plastic} position={[0.15, 0.09, 0]} rotation={[0, 0, 0.08]}>
            <boxGeometry args={[0.3, 0.035, 0.05]} />
          </mesh>
          <mesh material={mats.plastic} position={[0.29, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.035, 10]} />
          </mesh>
        </group>
      ))}
      <mesh material={mats.plastic} position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.06, 12]} />
      </mesh>

      {/* Gas lift */}
      <mesh material={mats.chrome} position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.26, 10]} />
      </mesh>
      <mesh material={mats.plastic} position={[0, 0.38, 0]}>
        <boxGeometry args={[0.2, 0.03, 0.2]} />
      </mesh>

      {/* Seat cushion */}
      <mesh material={mats.fabric} position={[0, SEAT_Y - 0.04, 0]}>
        <boxGeometry args={[0.5, 0.08, 0.48]} />
      </mesh>

      {/* Backrest: frame + mesh panel, leaning back slightly */}
      <group position={[0, SEAT_Y, -0.24]} rotation={[-0.12, 0, 0]}>
        <mesh material={mats.plastic} position={[0, 0.09, 0.02]}>
          <boxGeometry args={[0.08, 0.2, 0.03]} />
        </mesh>
        <mesh material={mats.plastic} position={[0, 0.45, 0]}>
          <boxGeometry args={[0.47, 0.6, 0.035]} />
        </mesh>
        <mesh material={mats.mesh} position={[0, 0.45, 0.02]}>
          <boxGeometry args={[0.41, 0.52, 0.01]} />
        </mesh>
        {/* Headrest */}
        <mesh material={mats.fabric} position={[0, 0.84, 0.01]}>
          <boxGeometry args={[0.3, 0.13, 0.05]} />
        </mesh>
      </group>

      {/* Armrests */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.27, SEAT_Y, -0.02]}>
          <mesh material={mats.plastic} position={[0, 0.1, 0]}>
            <boxGeometry args={[0.03, 0.2, 0.04]} />
          </mesh>
          <mesh material={mats.fabric} position={[0, 0.21, 0.03]}>
            <boxGeometry args={[0.07, 0.03, 0.26]} />
          </mesh>
        </group>
      ))}

      {/* Collision: seat block + backrest (player is pinned in place while seated) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.26, SEAT_Y / 2, 0.25]} position={[0, SEAT_Y / 2, 0]} />
        <CuboidCollider args={[0.24, 0.35, 0.04]} position={[0, SEAT_Y + 0.45, -0.3]} />
      </RigidBody>
    </group>
  )
}
