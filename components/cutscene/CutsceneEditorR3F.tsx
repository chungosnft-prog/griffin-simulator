"use client"
/**
 * Three.js-side of the cutscene editor — lives INSIDE the <Canvas>.
 * Handles:
 *   • Free camera (WASD + mouse-drag, no pointer-lock)
 *   • Smooth "goto keyframe" fly-to
 *   • Camera capture on demand
 *   • Editor preview playback
 *   • liveCamRef update every frame
 *   • Timeline scrub: when scrubTimeRef >= 0 (and not playing, not freeCam), position camera at that time
 */
import { useEffect, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { useCutsceneContext } from "./CutsceneContext"
import { ease } from "./easings"
import type { Keyframe } from "./types"

export function CutsceneEditorR3F() {
  const { camera } = useThree()

  const {
    isFreeCameraMode,
    freeCamRef,
    playingRef,
    keyframesRef,
    pendingCaptureRef,
    gotoTargetRef,
    liveCamRef,
    scrubTimeRef,
    clearGoto,
    deliverCapture,
    stopPlayback,
  } = useCutsceneContext()

  // ── Free-camera state ────────────────────────────────────────────────────
  const yaw         = useRef(0)
  const pitch       = useRef(0)
  const isDragging  = useRef(false)
  const flySpeed    = useRef(8)
  const keysHeld    = useRef(new Set<string>())
  const initDone    = useRef(false)

  // ── Goto tween ────────────────────────────────────────────────────────────
  const gotoFrom     = useRef(new THREE.Vector3())
  const gotoFromYaw  = useRef(0)
  const gotoFromPitch = useRef(0)
  const gotoProgress = useRef(0)
  const isGoing      = useRef(false)

  // ── Playback state ────────────────────────────────────────────────────────
  const pbSeg     = useRef(0)
  const pbSegTime = useRef(0)
  const pbActive  = useRef(false)

  // ── Event listeners for free camera ──────────────────────────────────────
  useEffect(() => {
    if (!isFreeCameraMode) {
      keysHeld.current.clear()
      isDragging.current = false
      initDone.current = false
      return
    }

    // Sync yaw/pitch from wherever the camera currently is
    {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      yaw.current   =  Math.atan2(fwd.x, fwd.z)
      pitch.current = -Math.asin(Math.max(-1, Math.min(1, fwd.y)))
    }

    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    if (!canvas) return

    // Intercept canvas clicks so the game doesn't request pointer-lock
    const trapClick = (e: MouseEvent) => { e.stopPropagation() }
    canvas.addEventListener("click", trapClick, true)

    const onDown  = (e: MouseEvent) => { if (e.button === 0) isDragging.current = true }
    const onUp    = ()              => { isDragging.current = false }
    const onMove  = (e: MouseEvent) => {
      if (!isDragging.current) return
      yaw.current   -= e.movementX * 0.003
      pitch.current  = Math.max(-1.45, Math.min(1.45, pitch.current - e.movementY * 0.003))
    }
    const onKD    = (e: KeyboardEvent) => { keysHeld.current.add(e.code) }
    const onKU    = (e: KeyboardEvent) => { keysHeld.current.delete(e.code) }
    const onWheel = (e: WheelEvent)    => {
      flySpeed.current = Math.max(1, Math.min(80, flySpeed.current * (1 - e.deltaY * 0.001)))
    }

    canvas.addEventListener("mousedown", onDown)
    document.addEventListener("mouseup",  onUp)
    document.addEventListener("mousemove", onMove)
    document.addEventListener("keydown",  onKD)
    document.addEventListener("keyup",    onKU)
    canvas.addEventListener("wheel", onWheel, { passive: true })

    return () => {
      canvas.removeEventListener("click", trapClick, true)
      canvas.removeEventListener("mousedown", onDown)
      document.removeEventListener("mouseup",  onUp)
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("keydown",  onKD)
      document.removeEventListener("keyup",    onKU)
      canvas.removeEventListener("wheel", onWheel)
      keysHeld.current.clear()
      isDragging.current = false
    }
  }, [isFreeCameraMode, camera])

  // ── Main loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1) // cap large deltas

    // ── FREE CAMERA ──────────────────────────────────────────────────────────
    if (freeCamRef.current) {
      const gotoTarget = gotoTargetRef.current

      // Kick off goto tween
      if (gotoTarget && !isGoing.current) {
        isGoing.current   = true
        gotoProgress.current = 0
        gotoFrom.current.copy(camera.position)
        gotoFromYaw.current   = yaw.current
        gotoFromPitch.current = pitch.current
      }

      if (isGoing.current && gotoTargetRef.current) {
        gotoProgress.current = Math.min(1, gotoProgress.current + dt * 1.2)
        const t  = ease(gotoProgress.current, "easeInOut")
        const tgt = gotoTargetRef.current

        // Fly to target position
        camera.position.lerpVectors(
          gotoFrom.current,
          new THREE.Vector3(...tgt.position),
          t
        )

        // Aim at target lookAt
        const dir = new THREE.Vector3(...tgt.lookAt)
          .sub(new THREE.Vector3(...tgt.position))
          .normalize()
        const targetYaw   =  Math.atan2(dir.x, dir.z)
        const targetPitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)))
        yaw.current   = THREE.MathUtils.lerp(gotoFromYaw.current,   targetYaw,   t)
        pitch.current = THREE.MathUtils.lerp(gotoFromPitch.current, targetPitch, t)

        if (gotoProgress.current >= 1) {
          isGoing.current = false
          clearGoto()
        }
      } else if (!isGoing.current) {
        // Regular WASD movement
        const k = keysHeld.current
        const fwd   = new THREE.Vector3( Math.sin(yaw.current), 0,  Math.cos(yaw.current))
        const right = new THREE.Vector3( Math.cos(yaw.current), 0, -Math.sin(yaw.current))
        const up    = new THREE.Vector3(0, 1, 0)
        const move  = new THREE.Vector3()

        if (k.has("KeyW")) move.addScaledVector(fwd,    1)
        if (k.has("KeyS")) move.addScaledVector(fwd,   -1)
        if (k.has("KeyD")) move.addScaledVector(right,  1)
        if (k.has("KeyA")) move.addScaledVector(right, -1)
        if (k.has("KeyE")) move.addScaledVector(up,     1)
        if (k.has("KeyQ")) move.addScaledVector(up,    -1)

        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(flySpeed.current * dt)
          camera.position.add(move)
        }
      }

      // Apply yaw + pitch to camera quaternion
      camera.quaternion.multiplyQuaternions(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch.current)
      )

      // ── Capture ──────────────────────────────────────────────────────────
      if (pendingCaptureRef.current) {
        pendingCaptureRef.current = false
        const fwd    = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
        const lookAt = camera.position.clone().addScaledVector(fwd, 20)
        const snap   = (n: number) => parseFloat(n.toFixed(3))

        const kf: Keyframe = {
          id:       `kf_${Date.now()}`,
          label:    "",
          position: [snap(camera.position.x), snap(camera.position.y), snap(camera.position.z)],
          lookAt:   [snap(lookAt.x),          snap(lookAt.y),          snap(lookAt.z)         ],
          fov:      (state.camera as any).fov ?? 50,
          duration: 2.0,
          easing:   "easeInOut",
        }
        deliverCapture(kf)
      }
    }

    // ── TIMELINE SCRUB ───────────────────────────────────────────────────────
    // When scrubTimeRef >= 0, not playing, and not in free cam — set camera to that time
    if (scrubTimeRef.current >= 0 && !playingRef.current && !freeCamRef.current) {
      const kfs = keyframesRef.current
      if (kfs && kfs.length >= 2) {
        const scrubT = scrubTimeRef.current

        // Build cumulative times array: [0, d1, d1+d2, ...]
        const cumTimes: number[] = [0]
        for (let i = 1; i < kfs.length; i++) {
          cumTimes.push(cumTimes[i - 1] + kfs[i].duration)
        }
        const totalDur = cumTimes[cumTimes.length - 1]

        if (totalDur > 0) {
          const clampedT = Math.max(0, Math.min(totalDur, scrubT))

          // Find which segment we're in
          let seg = 0
          for (let i = 0; i < kfs.length - 1; i++) {
            if (clampedT >= cumTimes[i] && clampedT <= cumTimes[i + 1]) {
              seg = i
              break
            }
            if (clampedT > cumTimes[i + 1]) seg = i + 1
          }
          seg = Math.min(seg, kfs.length - 2)

          const from = kfs[seg]
          const to   = kfs[seg + 1]
          const segDur = to.duration
          const segT   = segDur > 0 ? (clampedT - cumTimes[seg]) / segDur : 1
          const easedT = ease(Math.max(0, Math.min(1, segT)), to.easing)

          camera.position.copy(
            new THREE.Vector3(...from.position).lerp(new THREE.Vector3(...to.position), easedT)
          )
          camera.lookAt(
            new THREE.Vector3(...from.lookAt).lerp(new THREE.Vector3(...to.lookAt), easedT)
          )
        }
      }
    }

    // ── EDITOR PLAYBACK ───────────────────────────────────────────────────────
    if (playingRef.current) {
      const kfs = keyframesRef.current
      if (!kfs || kfs.length < 2) { stopPlayback(); return }

      if (!pbActive.current) {
        pbActive.current = true
        pbSeg.current    = 0
        pbSegTime.current = 0
      }

      pbSegTime.current += dt

      // Advance through segments
      while (pbSeg.current < kfs.length - 1) {
        const nextDur = kfs[pbSeg.current + 1].duration
        if (pbSegTime.current >= nextDur) {
          pbSegTime.current -= nextDur
          pbSeg.current++
        } else break
      }

      if (pbSeg.current >= kfs.length - 1) {
        const last = kfs[kfs.length - 1]
        camera.position.set(...last.position)
        camera.lookAt(new THREE.Vector3(...last.lookAt))
        pbActive.current = false
        stopPlayback()
        return
      }

      const from = kfs[pbSeg.current]
      const to   = kfs[pbSeg.current + 1]
      const t    = ease(
        Math.min(1, pbSegTime.current / Math.max(0.001, to.duration)),
        to.easing
      )

      camera.position.copy(
        new THREE.Vector3(...from.position).lerp(new THREE.Vector3(...to.position), t)
      )
      camera.lookAt(
        new THREE.Vector3(...from.lookAt).lerp(new THREE.Vector3(...to.lookAt), t)
      )
    } else {
      pbActive.current = false
    }

    // ── UPDATE liveCamRef every frame ─────────────────────────────────────────
    // Compute yaw and pitch from the camera's current quaternion
    const fwdVec = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const liveYaw   =  Math.atan2(fwdVec.x, fwdVec.z)
    const livePitch = -Math.asin(Math.max(-1, Math.min(1, fwdVec.y)))
    liveCamRef.current = {
      x:     camera.position.x,
      y:     camera.position.y,
      z:     camera.position.z,
      pitch: livePitch,
      yaw:   liveYaw,
    }
  })

  return null
}
