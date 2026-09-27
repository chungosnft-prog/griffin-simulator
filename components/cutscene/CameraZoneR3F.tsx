"use client"
/**
 * Runtime camera-zone controller — lives INSIDE the <Canvas>.
 *
 * Every frame it checks whether the character is inside any enabled
 * CameraZone. When they enter one, it smoothly lerps the camera to
 * that zone's saved position + lookAt. When they leave it hands
 * control back to the normal CameraController.
 *
 * Also renders wireframe sphere gizmos for each zone while free-cam
 * is active so you can see exactly where the trigger volumes are.
 */
import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { useCutsceneContext } from "./CutsceneContext"
import type { CameraZone } from "./types"

function easeInOut(t: number) {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c
}

// ── Zone gizmo (wireframe sphere shown in free-cam mode) ──────────────────────
function ZoneGizmo({ zone, isSelected, isActive }: {
  zone:       CameraZone
  isSelected: boolean
  isActive:   boolean
}) {
  const color = isActive ? "#33ff88" : isSelected ? "#8866ff" : "#4466aa"

  // Build the connector line geometry imperatively — JSX <line> is unreliable
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(...zone.cameraPosition)
      .sub(new THREE.Vector3(...zone.triggerPosition)),
  ])

  const camOffset = new THREE.Vector3(...zone.cameraPosition)
    .sub(new THREE.Vector3(...zone.triggerPosition))
    .toArray() as [number, number, number]

  return (
    <group position={zone.triggerPosition}>
      {/* Trigger sphere */}
      <mesh>
        <sphereGeometry args={[zone.radius, 24, 14]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>

      {/* Camera position marker — octahedron at where the cam will sit */}
      <mesh position={camOffset}>
        <octahedronGeometry args={[0.4]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Dot at trigger centre */}
      <mesh>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Line: trigger centre → camera position */}
      <primitive object={new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color }))} />
    </group>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function CameraZoneR3F() {
  const { camera } = useThree()
  const {
    zonesRef,
    freeCamRef,
    playingRef,
    livePlayerRef,
    activeZoneIdRef,
    setActiveZoneId,
    zones,
    activeZoneId,
    selectedZoneId,
    isFreeCameraMode,
  } = useCutsceneContext()

  // Blend state
  const currentZoneId   = useRef<string | null>(null)
  const blendFrom       = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() })
  const blendTo         = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() })
  const blendDuration   = useRef(0.5)
  const blendProgress   = useRef(1)           // start at 1 = no blend in progress
  const hasControl      = useRef(false)

  useFrame((_, delta) => {
    // Yield to editor / cutscene playback
    if (freeCamRef.current || playingRef.current) {
      if (hasControl.current) {
        hasControl.current  = false
        currentZoneId.current = null
        blendProgress.current = 1
        setActiveZoneId(null)
      }
      return
    }

    const player = livePlayerRef.current
    if (!player) return

    const allZones = zonesRef.current
    const pv = new THREE.Vector3(player.x, player.y, player.z)

    // Find highest-priority zone that contains the player
    let best: CameraZone | null = null
    let bestDist = Infinity
    for (const z of allZones) {
      if (!z.enabled) continue
      const dist = pv.distanceTo(new THREE.Vector3(...z.triggerPosition))
      if (dist < z.radius) {
        if (
          !best ||
          z.priority > best.priority ||
          (z.priority === best.priority && dist < bestDist)
        ) {
          best = z
          bestDist = dist
        }
      }
    }

    if (best) {
      // Entered a new zone — start blend
      if (best.id !== currentZoneId.current) {
        currentZoneId.current = best.id
        setActiveZoneId(best.id)

        // Capture current camera state as blend origin
        blendFrom.current.pos.copy(camera.position)
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
        blendFrom.current.look.copy(camera.position).addScaledVector(fwd, 20)

        blendTo.current.pos.set(...best.cameraPosition)
        blendTo.current.look.set(...best.cameraLookAt)
        blendDuration.current = best.blendTime
        blendProgress.current = 0
        hasControl.current = true
      }

      // Drive blend
      if (blendProgress.current < 1) {
        blendProgress.current = Math.min(
          1,
          blendProgress.current + delta / Math.max(0.001, blendDuration.current)
        )
      }
      const t = easeInOut(blendProgress.current)
      camera.position.lerpVectors(blendFrom.current.pos, blendTo.current.pos, t)
      camera.lookAt(
        new THREE.Vector3().lerpVectors(blendFrom.current.look, blendTo.current.look, t)
      )
    } else {
      // No zone — release control so CameraController can take over
      if (hasControl.current) {
        hasControl.current    = false
        currentZoneId.current = null
        blendProgress.current = 1
        setActiveZoneId(null)
      }
    }
  })

  // Render zone gizmos only while free-cam is on
  if (!isFreeCameraMode || zones.length === 0) return null

  return (
    <>
      {zones.map(z => (
        <ZoneGizmo
          key={z.id}
          zone={z}
          isSelected={z.id === selectedZoneId}
          isActive={z.id === activeZoneId}
        />
      ))}
    </>
  )
}
