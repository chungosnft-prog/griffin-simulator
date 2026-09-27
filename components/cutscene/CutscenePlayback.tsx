"use client"
/**
 * Standalone runtime cutscene player — no editor context needed.
 * Drop this inside your <Canvas> / <Physics> alongside GameScene.
 *
 * Usage:
 *   <CutscenePlayback cutscene={myData} playing={isPlaying} onComplete={() => setPlaying(false)} />
 */
import { useRef, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import type { Cutscene } from "./types"
import { ease } from "./easings"

interface Props {
  cutscene: Cutscene
  playing:  boolean
  onComplete?: () => void
  loop?:    boolean
}

export function CutscenePlayback({ cutscene, playing, onComplete, loop = false }: Props) {
  const seg      = useRef(0)
  const segTime  = useRef(0)
  const active   = useRef(false)
  const done     = useRef(false)

  useEffect(() => {
    if (playing) {
      seg.current     = 0
      segTime.current = 0
      active.current  = true
      done.current    = false
    } else {
      active.current = false
    }
  }, [playing])

  useFrame(({ camera }, delta) => {
    if (!active.current) return
    const kfs = cutscene.keyframes
    if (!kfs || kfs.length < 2) return

    const dt = Math.min(delta, 0.1)
    segTime.current += dt

    while (seg.current < kfs.length - 1) {
      const dur = kfs[seg.current + 1].duration
      if (segTime.current >= dur) { segTime.current -= dur; seg.current++ }
      else break
    }

    if (seg.current >= kfs.length - 1) {
      const last = kfs[kfs.length - 1]
      camera.position.set(...last.position)
      camera.lookAt(new THREE.Vector3(...last.lookAt))
      if (loop) { seg.current = 0; segTime.current = 0 }
      else if (!done.current) { done.current = true; active.current = false; onComplete?.() }
      return
    }

    const from = kfs[seg.current]
    const to   = kfs[seg.current + 1]
    const t    = ease(Math.min(1, segTime.current / Math.max(0.001, to.duration)), to.easing)

    camera.position.copy(
      new THREE.Vector3(...from.position).lerp(new THREE.Vector3(...to.position), t)
    )
    camera.lookAt(
      new THREE.Vector3(...from.lookAt).lerp(new THREE.Vector3(...to.lookAt), t)
    )
  })

  return null
}
