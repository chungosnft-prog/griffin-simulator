"use client"

import { useMemo } from "react"
import { useGLTF } from "@react-three/drei"
import { RigidBody, TrimeshCollider, CuboidCollider } from "@react-three/rapier"
import * as THREE from "three"
import { asset } from "./assetPath"

if (typeof window !== "undefined") {
  try { useGLTF.preload(asset("/house.glb")) } catch {}
}

// GLB meshes removed from the scene (visual + collision). Plane.006 was a loose
// partition panel in the unfinished west end; decor/Mudroom replaces it with a
// wall that has a doorway through to the front door.
// Plane.003 (the east/back wall) is rebuilt by decor/Exterior with a doorway
// behind the raised tile landing.
const HIDDEN_MESHES = new Set(["Plane006", "Plane003"])

const MAX_PHYSICS_TRIS   = 80_000
const MAX_VERTS_PER_MESH = 10_000

function buildPhysicsGeo(root: THREE.Group) {
  const allPos: number[] = []
  const allIdx: number[] = []
  let vertexOffset = 0
  let trisAdded    = 0

  root.traverse((node: any) => {
    if (trisAdded >= MAX_PHYSICS_TRIS) return
    if (!node.isMesh || !node.geometry) return
    if (HIDDEN_MESHES.has(node.name)) return

    const geo     = node.geometry as THREE.BufferGeometry
    const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined
    if (!posAttr || posAttr.count < 3) return
    if (posAttr.count > MAX_VERTS_PER_MESH) return

    node.updateWorldMatrix(true, false)
    const mat = node.matrixWorld
    if (mat.elements.some((e: number) => !isFinite(e))) return

    const rollback = allPos.length
    const v = new THREE.Vector3()
    let meshOK = true
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mat)
      if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) { meshOK = false; break }
      allPos.push(v.x, v.y, v.z)
    }
    if (!meshOK) { allPos.length = rollback; return }

    const rawIdx: number[] = []
    if (geo.index) {
      const src = geo.index.array
      const tc  = Math.floor(src.length / 3) * 3
      for (let i = 0; i < tc; i++) rawIdx.push(src[i] + vertexOffset)
    } else {
      const tc = Math.floor(posAttr.count / 3) * 3
      for (let i = 0; i < tc; i++) rawIdx.push(i + vertexOffset)
    }

    const maxIdx = allPos.length / 3 - 1
    for (let i = 0; i < rawIdx.length; i += 3) {
      const a = rawIdx[i], b = rawIdx[i+1], c = rawIdx[i+2]
      if (a > maxIdx || b > maxIdx || c > maxIdx) continue
      if (a === b || b === c || a === c) continue
      const px=allPos[a*3],py=allPos[a*3+1],pz=allPos[a*3+2]
      const qx=allPos[b*3],qy=allPos[b*3+1],qz=allPos[b*3+2]
      const rx=allPos[c*3],ry=allPos[c*3+1],rz=allPos[c*3+2]
      const ex=qx-px,ey=qy-py,ez=qz-pz
      const fx=rx-px,fy=ry-py,fz=rz-pz
      const area2=(ey*fz-ez*fy)**2+(ez*fx-ex*fz)**2+(ex*fy-ey*fx)**2
      if (area2 < 1e-12) continue
      allIdx.push(a, b, c)
      trisAdded++
      if (trisAdded >= MAX_PHYSICS_TRIS) break
    }
    vertexOffset += posAttr.count
  })

  if (allPos.length < 9 || allIdx.length < 3) return null
  const safeLen = Math.floor(allIdx.length / 3) * 3
  console.log(`[House] ${(safeLen/3).toLocaleString()} tris`)
  return { positions: new Float32Array(allPos), indices: new Uint32Array(allIdx.slice(0, safeLen)) }
}

export default function HouseEnvironment() {
  const { scene } = useGLTF(asset("/house.glb"))

  useMemo(() => {
    if (!scene) return
    scene.traverse((child: any) => {
      if (!child.isMesh) return
      if (HIDDEN_MESHES.has(child.name)) { child.visible = false; return }
      child.castShadow    = false
      child.receiveShadow = false
      const mats: any[] = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((mat: any) => {
        mat.side = THREE.DoubleSide
        if (!mat.map && mat.color) {
          const { r, g, b } = mat.color
          if (r < 0.04 && g < 0.04 && b < 0.04) mat.color.set(0.45, 0.45, 0.45)
        }
        if (mat.transparent && mat.opacity < 0.05) mat.opacity = 0.3
        mat.needsUpdate = true
        ;["map","normalMap","roughnessMap","metalnessMap","emissiveMap","aoMap","lightMap"]
          .forEach((key) => {
            const tex: THREE.Texture | null = mat[key]
            if (!tex) return
            tex.minFilter   = THREE.LinearFilter
            tex.magFilter   = THREE.NearestFilter
            tex.needsUpdate = true
          })
      })
    })
  }, [scene])

  const physicsGeo = useMemo(() => {
    if (!scene) return null
    return buildPhysicsGeo(scene as unknown as THREE.Group)
  }, [scene])

  if (!scene) return null

  return (
    <group>
      <primitive object={scene} />

      {physicsGeo && (
        <RigidBody type="fixed" colliders={false}>
          <TrimeshCollider args={[physicsGeo.positions, physicsGeo.indices]} />
        </RigidBody>
      )}

      <RigidBody type="fixed" colliders={false} position={[0, -0.5, 0]}>
        <CuboidCollider args={[500, 0.5, 500]} />
      </RigidBody>
    </group>
  )
}
