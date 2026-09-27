"use client"
/**
 * ZoneCameraSystem — RE-style fixed camera zones.
 * Lives inside <Canvas>. When the player enters a zone trigger volume the
 * camera blends to that zone's saved position/lookAt.  When they leave it
 * blends back and hands control to CameraController.
 *
 * Writes playerState.activeZoneId so GameScene can disable CameraController
 * while a zone is active.
 */
import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { playerState } from "./playerState"
import { CAMERA_ZONES } from "./cutscenes/cameraZones"

const _camTarget  = new THREE.Vector3()
const _camLookAt  = new THREE.Vector3()
const DEG = Math.PI / 180

/** Look target for a zone: from pitch/yaw (editor readout convention) if given. */
function zoneLookAt(zone: typeof CAMERA_ZONES[number], out: THREE.Vector3) {
  if (zone.pitchDeg === undefined || zone.yawDeg === undefined) return out.set(...zone.cameraLookAt)
  const p = zone.pitchDeg * DEG, y = zone.yawDeg * DEG
  // Readout: yaw = atan2(fwd.x, fwd.z), pitch = -asin(fwd.y)
  return out.set(Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)).add(_camTarget.set(...zone.cameraPosition))
}

export default function ZoneCameraSystem() {
  const blendRef = useRef(0)   // 0 = fully out, 1 = fully in
  const activeId = useRef<string | null>(null)
  const baseFov  = useRef<number | null>(null)   // camera FOV to restore on exit

  useFrame(({ camera }, delta) => {
    const pos = playerState.position

    // Find the highest-priority enabled zone the player is standing in
    let found: typeof CAMERA_ZONES[number] | null = null
    let bestPriority = -Infinity
    for (const zone of CAMERA_ZONES) {
      if (!zone.enabled) continue
      let inside: boolean
      if (zone.bounds) {
        const [x0, x1, z0, z1] = zone.bounds
        inside = pos.x > x0 && pos.x < x1 && pos.z > z0 && pos.z < z1
      } else {
        const dx = pos.x - zone.triggerPosition[0]
        const dy = pos.y - zone.triggerPosition[1]
        const dz = pos.z - zone.triggerPosition[2]
        inside = Math.sqrt(dx*dx + dy*dy + dz*dz) < zone.radius
      }
      if (inside && zone.priority > bestPriority) {
        found = zone
        bestPriority = zone.priority
      }
    }

    const nextId = found ? found.id : null

    // Blend speed derived from zone's blendTime (seconds to go 0→1)
    const blendSpeed = found ? (1 / Math.max(0.01, found.blendTime)) : 4

    if (nextId) {
      // Entering / inside zone — blend in
      blendRef.current = Math.min(1, blendRef.current + delta * blendSpeed)
      playerState.activeZoneId = nextId
      activeId.current = nextId

      zoneLookAt(found!, _camLookAt)
      _camTarget.set(...found!.cameraPosition)
      camera.position.lerp(_camTarget, blendRef.current)
      camera.lookAt(_camLookAt)

      const cam = camera as THREE.PerspectiveCamera
      if (found!.fov && cam.isPerspectiveCamera) {
        if (baseFov.current === null) baseFov.current = cam.fov
        cam.fov = THREE.MathUtils.lerp(baseFov.current, found!.fov, blendRef.current)
        cam.updateProjectionMatrix()
      }
    } else if (activeId.current) {
      // Exiting — blend out
      blendRef.current = Math.max(0, blendRef.current - delta * blendSpeed)
      const cam = camera as THREE.PerspectiveCamera
      if (baseFov.current !== null && cam.isPerspectiveCamera) {
        cam.fov = THREE.MathUtils.lerp(baseFov.current, cam.fov, blendRef.current)
        cam.updateProjectionMatrix()
        if (blendRef.current <= 0) { cam.fov = baseFov.current; cam.updateProjectionMatrix(); baseFov.current = null }
      }
      if (blendRef.current <= 0) {
        playerState.activeZoneId = null
        activeId.current = null
      }
      // Let camera drift to its last blended position; CameraController
      // will smoothly take over once activeZoneId is cleared.
    }
  })

  return null
}
