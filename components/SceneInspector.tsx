"use client"
/**
 * SceneInspector — hover any mesh in the scene to see its object name,
 * mesh name, world Y, and hit Y. Toggle with the I key (from Game.tsx).
 * Writes to the shared `inspectorState` object so Game.tsx can display it.
 */

import { useRef, useEffect } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

export type InspectorHit = {
  objName:    string
  meshName:   string
  parentName: string
  worldPos:   { x: number; y: number; z: number }
  hitPoint:   { x: number; y: number; z: number }
} | null

export const inspectorState: {
  active:  boolean
  hovered: InspectorHit
  clicked: InspectorHit
} = {
  active:  false,
  hovered: null,
  clicked: null,
}

export default function SceneInspector() {
  const { scene, camera, gl } = useThree()

  const ray        = useRef(new THREE.Raycaster())
  const mouse      = useRef(new THREE.Vector2(-9999, -9999))
  const highlighted = useRef<{ obj: THREE.Object3D; savedColor: THREE.Color } | null>(null)

  // Track mouse position on the canvas
  useEffect(() => {
    const canvas = gl.domElement

    const onMove = (e: MouseEvent) => {
      if (!inspectorState.active) return
      const rect = canvas.getBoundingClientRect()
      mouse.current.set(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        -((e.clientY - rect.top)  / rect.height) *  2 + 1,
      )
    }

    const onClick = () => {
      if (!inspectorState.active) return
      // Snapshot current hover as the "clicked" selection
      inspectorState.clicked = inspectorState.hovered
        ? { ...inspectorState.hovered }
        : null
    }

    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("click",     onClick)
    return () => {
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("click",     onClick)
    }
  }, [gl])

  useFrame(() => {
    // ── Restore previous highlight whenever not in inspect mode ──────────
    if (!inspectorState.active) {
      if (highlighted.current) {
        const mat = (highlighted.current.obj as any).material
        if (mat?.emissive) mat.emissive.copy(highlighted.current.savedColor)
        highlighted.current = null
      }
      inspectorState.hovered = null
      return
    }

    ray.current.setFromCamera(mouse.current, camera)

    // Collect all visible meshes in the scene
    const meshes: THREE.Object3D[] = []
    scene.traverse((obj) => {
      if ((obj as any).isMesh && (obj as any).visible) meshes.push(obj)
    })

    const hits = ray.current.intersectObjects(meshes, false)

    // Restore previous highlight
    if (highlighted.current) {
      const mat = (highlighted.current.obj as any).material
      if (mat?.emissive) mat.emissive.copy(highlighted.current.savedColor)
      highlighted.current = null
    }

    if (hits.length === 0) {
      inspectorState.hovered = null
      return
    }

    const hit = hits[0]
    const obj = hit.object as THREE.Mesh

    // Highlight hovered mesh
    const mat = (obj as any).material as THREE.MeshStandardMaterial | undefined
    if (mat?.emissive) {
      highlighted.current = { obj, savedColor: mat.emissive.clone() }
      mat.emissive.set(0x444400)  // yellow tint
    }

    const wp = new THREE.Vector3()
    obj.getWorldPosition(wp)

    // Walk up to find a meaningful parent name
    let parentName = ""
    let p: THREE.Object3D | null = obj.parent
    while (p && !parentName) {
      if (p.name) parentName = p.name
      p = p.parent
    }

    inspectorState.hovered = {
      objName:    obj.name    || "(unnamed)",
      meshName:   (obj.geometry as any)?.name || obj.name || "?",
      parentName,
      worldPos:   { x: +wp.x.toFixed(3),         y: +wp.y.toFixed(3),         z: +wp.z.toFixed(3)         },
      hitPoint:   { x: +hit.point.x.toFixed(3),  y: +hit.point.y.toFixed(3),  z: +hit.point.z.toFixed(3)  },
    }
  })

  return null   // all output goes through inspectorState
}
