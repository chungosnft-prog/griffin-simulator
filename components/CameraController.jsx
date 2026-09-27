"use client"
import { useRef, useEffect, useMemo } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { playerState } from "./playerState"

const _raycaster = new THREE.Raycaster()
const _upRaycaster = new THREE.Raycaster()
const _up        = new THREE.Vector3(0, 1, 0)
const _dir       = new THREE.Vector3()

export default function CameraController({ target, cameraMode, initialPosition = [-50.35, 0.93, -500.11] }) {
  const { scene } = useThree()
  const { camera } = useThree()
  const currentPos = useRef(new THREE.Vector3())
  const currentLookAt = useRef(new THREE.Vector3())
  const mousePos = useRef({ x: 0, y: 0 })
  const pointerLocked = useRef(false)
  const initialized = useRef(false)
  const frameCount = useRef(0)
  const userHasMovedMouse = useRef(false) // Track if user has moved mouse
  const wasPointerLocked = useRef(false) // Track if pointer was previously locked
  const savedCameraState = useRef({ position: null, mousePos: null }) // Save camera state when locked

  // Add mobile game active state tracking
  const mobileGameActive = useRef(false)

  // Scroll-wheel zoom: multiplies the follow distance (close-up to wide shot)
  const zoom = useRef(1)

  // On mount: if the camera is already somewhere reasonable (e.g. coming out of a
  // couch cutscene) start from its current position so there's no ceiling clip.
  // Only fall back to initialPosition on the very first ever mount.
  useEffect(() => {
    const cam = camera.position
    const farFromOrigin = cam.length() > 0.5   // not at world origin = already placed
    if (farFromOrigin) {
      currentPos.current.copy(cam)
      initialized.current       = true
      userHasMovedMouse.current = true

      // Derive yaw from the cutscene camera's XZ offset relative to the player,
      // and force a low pitch so the camera can't clip the ceiling.
      try {
        const pPos = target.current?.translation?.() ?? { x: 0, z: 0 }
        mousePos.current.x = Math.atan2(cam.x - pPos.x, cam.z - pPos.z)
      } catch {}
      // Negative Y = camera sits LOW (just above player shoulder height).
      // This keeps it well clear of any ceiling when the controller re-mounts.
      mousePos.current.y = -0.35
    } else {
      camera.position.set(initialPosition[0], initialPosition[1], initialPosition[2])
      currentPos.current.set(initialPosition[0], initialPosition[1], initialPosition[2])
      mousePos.current.y = -0.15
    }
  }, [camera, initialPosition])

  useEffect(() => {
    const canvas = document.querySelector("canvas")
    // May mount after the pointer is already locked (e.g. standing up from a seat)
    pointerLocked.current = !!canvas && document.pointerLockElement === canvas

    const requestLock = () => {
      if (canvas && !pointerLocked.current) {
        canvas.requestPointerLock()
      }
    }

    const handleMouseMove = (e) => {
      // Free-mouse look is paused while dragging the ragdoll around
      if (document.pointerLockElement === canvas || (playerState.freeMouse && !playerState.ragdoll)) {
        // Mark that user has moved mouse
        userHasMovedMouse.current = true

        mousePos.current.x += -e.movementX * 0.002
        mousePos.current.y += e.movementY * 0.002
        // ✅ EXPANDED: Allow full vertical range instead of limited range
        mousePos.current.y = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, mousePos.current.y))
      }
    }

    const handleMobileCameraMove = (deltaX, deltaY) => {
      if (userHasMovedMouse.current || wasPointerLocked.current) {
        mousePos.current.x += deltaX
        mousePos.current.y += deltaY
        mousePos.current.y = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, mousePos.current.y))
      }
    }

    // Mobile camera control
    const handleMobileCameraControl = (e) => {
      if (e.detail && e.detail.deltaX !== undefined && e.detail.deltaY !== undefined) {
        handleMobileCameraMove(e.detail.deltaX, e.detail.deltaY)
      }
    }

    const handlePointerLockChange = () => {
      const isLocked = document.pointerLockElement === canvas

      // If we're unlocking after being locked, save the current camera state
      if (pointerLocked.current && !isLocked && userHasMovedMouse.current) {
        savedCameraState.current = {
          position: currentPos.current.clone(),
          mousePos: { x: mousePos.current.x, y: mousePos.current.y },
        }
        wasPointerLocked.current = true
      }

      // If we're locking again after being unlocked, restore the saved state
      if (!pointerLocked.current && isLocked && wasPointerLocked.current && savedCameraState.current.position) {
        currentPos.current.copy(savedCameraState.current.position)
        mousePos.current.x = savedCameraState.current.mousePos.x
        mousePos.current.y = savedCameraState.current.mousePos.y
        camera.position.copy(currentPos.current)
      }

      pointerLocked.current = isLocked
    }

    const handleWheel = (e) => {
      zoom.current = Math.max(0.45, Math.min(4, zoom.current * (1 + e.deltaY * 0.0012)))
    }

    const handleKeyDown = (e) => {
      if (e.code === "Escape" && pointerLocked.current) {
        document.exitPointerLock()
      }
    }

    const handleClick = () => {
      if (!pointerLocked.current && !playerState.ragdoll) {
        requestLock()
      }
    }

    // Add event listener for mobile game activation
    const handleMobileGameActive = (e) => {
      mobileGameActive.current = e.detail
      if (e.detail) {
        userHasMovedMouse.current = true // Treat mobile activation as user interaction
      }
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("pointerlockchange", handlePointerLockChange)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("wheel", handleWheel, { passive: true })
    document.addEventListener("mobileCameraMove", handleMobileCameraControl)
    window.addEventListener("mobileGameActive", handleMobileGameActive)

    if (canvas) {
      canvas.addEventListener("click", handleClick)
      // User must click to activate - no auto-activation
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("pointerlockchange", handlePointerLockChange)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("wheel", handleWheel)
      document.removeEventListener("mobileCameraMove", handleMobileCameraControl)
      window.removeEventListener("mobileGameActive", handleMobileGameActive)
      if (canvas) {
        canvas.removeEventListener("click", handleClick)
      }
    }
  }, [])

  useFrame((state) => {
    frameCount.current++

    if (!target.current) return

    let targetPos
    try {
      if (target.current.translation) {
        targetPos = target.current.translation()
      } else if (target.current.getRigidBody) {
        const rigidBody = target.current.getRigidBody()
        if (rigidBody && rigidBody.translation) {
          targetPos = rigidBody.translation()
        }
      }
    } catch (error) {
      return
    }
    if (!targetPos) return

    const targetVec = new THREE.Vector3(targetPos.x, targetPos.y + 1, targetPos.z)

    // ✅ UPDATED: Use angled camera position until user moves mouse OR mobile game is active
    if (!userHasMovedMouse.current && !wasPointerLocked.current && !mobileGameActive.current) {
      camera.position.set(initialPosition[0], initialPosition[1], initialPosition[2])
      currentPos.current.set(initialPosition[0], initialPosition[1], initialPosition[2])
      currentLookAt.current.copy(targetVec)
      camera.lookAt(targetVec)

      // ✅ ANGLED: Calculate initial mouse position based on the angled camera
      if (!initialized.current) {
        const initialOffset = new THREE.Vector3().subVectors(camera.position, targetVec)
        const distance = initialOffset.length()
        mousePos.current.x = Math.atan2(initialOffset.x, initialOffset.z)
        // Keep the upward angle we set in useEffect
        // mousePos.current.y is already set to -0.15 for upward angle
        initialized.current = true

        console.log("🎯 CAMERA INITIALIZED - Angled Up:")
        console.log("  Mouse X (horizontal):", ((mousePos.current.x * 180) / Math.PI).toFixed(1), "°")
        console.log("  Mouse Y (vertical/up):", ((mousePos.current.y * 180) / Math.PI).toFixed(1), "°")
      }
      return
    }

    // Only allow normal camera movement AFTER user has moved mouse OR mobile game is active OR we've restored saved state
    if (!initialized.current && !wasPointerLocked.current && !mobileGameActive.current) return

    const cameraDistance = (cameraMode === "close" ? 2 : 3) * zoom.current
    const cameraHeight = (cameraMode === "close" ? 1 : 1.5) * Math.min(1.6, Math.max(0.6, zoom.current))

    // ✅ ENHANCED: Full vertical camera movement with the angled start
    const idealPosition = new THREE.Vector3(
      targetVec.x + Math.sin(mousePos.current.x) * cameraDistance * Math.cos(mousePos.current.y),
      targetVec.y + cameraHeight + Math.sin(mousePos.current.y) * cameraDistance,
      targetVec.z + Math.cos(mousePos.current.x) * cameraDistance * Math.cos(mousePos.current.y),
    )

    // ── Ceiling check: cast straight up from player ─────────────────────────
    // Find how much headroom there is and derive a hard Y ceiling for the camera.
    _upRaycaster.set(targetVec, _up)
    _upRaycaster.near = 0.05
    _upRaycaster.far  = 6
    const upHits = _upRaycaster.intersectObjects(scene.children, true)
    const upHit  = upHits.find(h => {
      let o = h.object
      while (o) { if (o.name === "player") return false; o = o.parent }
      return true
    })
    // Keep the camera at least 0.35 m below the ceiling (prevents clipping)
    const maxCamY = upHit
      ? targetVec.y + upHit.distance - 0.35
      : Infinity

    // Clamp ideal position before the diagonal raycast
    if (idealPosition.y > maxCamY) idealPosition.y = maxCamY

    // ── Diagonal raycast: player → ideal position (walls / obstacles) ────────
    _dir.subVectors(idealPosition, targetVec)
    const fullDist = _dir.length()
    _dir.normalize()
    _raycaster.set(targetVec, _dir)
    _raycaster.near = 0.1
    _raycaster.far  = fullDist + 0.5

    const hits = _raycaster.intersectObjects(scene.children, true)
    const wallHit = hits.find(h => {
      let o = h.object
      while (o) { if (o.name === "player") return false; o = o.parent }
      return true
    })

    const clampedDist = wallHit
      ? Math.max(0.5, wallHit.distance - 0.4)
      : fullDist

    const clampedIdeal = new THREE.Vector3()
      .copy(targetVec)
      .addScaledVector(_dir, clampedDist)

    // Smooth camera movement
    currentPos.current.lerp(clampedIdeal, 0.1)
    // Hard-clamp Y after lerp so the camera can never actually be above the ceiling
    if (currentPos.current.y > maxCamY) currentPos.current.y = maxCamY
    currentLookAt.current.lerp(targetVec, 0.2)

    camera.position.copy(currentPos.current)
    camera.lookAt(currentLookAt.current)

    if (target.current && target.current.updateCameraInfo) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      forward.y = 0
      forward.normalize()
      target.current.updateCameraInfo(forward, camera.quaternion)
    }
  })

  return null
}
