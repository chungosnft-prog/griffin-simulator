"use client"
/**
 * BoneGizmos — renders clickable dots on every bone of the character skeleton
 * and attaches TransformControls to the selected bone for FK posing.
 * Only active when animEditorState.createMode === true.
 */
import { useRef, useState, useEffect, useMemo } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { TransformControls } from "@react-three/drei"
import * as THREE from "three"
import { animEditorState } from "./animEditorState"

// Bones to hide from the gizmo (too small / not useful to pose)
const SKIP_BONES = new Set(["", "undefined"])

// ── individual bone dot ───────────────────────────────────────────────────────
function BoneDot({
  bone,
  selected,
  onSelect,
}: {
  bone:     THREE.Bone
  selected: boolean
  onSelect: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null!)

  useFrame(() => {
    if (meshRef.current) bone.getWorldPosition(meshRef.current.position)
  })

  return (
    <mesh
      ref={meshRef}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      renderOrder={999}
    >
      <sphereGeometry args={[0.025, 8, 8]} />
      <meshBasicMaterial
        color={selected ? "#ff8800" : "#00ddff"}
        depthTest={false}
        transparent
        opacity={selected ? 1 : 0.7}
      />
    </mesh>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function BoneGizmos() {
  const { gl } = useThree()
  const [skeleton, setSkeleton] = useState<THREE.Skeleton | null>(null)
  const [selName,  setSelName]  = useState<string | null>(null)
  const [visible,  setVisible]  = useState(false)
  const pollRef = useRef<number>()

  // Poll createMode and skeleton from animEditorState
  useEffect(() => {
    const tick = () => {
      setVisible(animEditorState.createMode)
      setSkeleton(animEditorState.skeleton)
      setSelName(animEditorState.selectedBoneName)
      pollRef.current = requestAnimationFrame(tick)
    }
    pollRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(pollRef.current!)
  }, [])

  const selectedBone = useMemo(
    () => skeleton?.bones.find(b => b.name === selName) ?? null,
    [skeleton, selName],
  )

  const bones = useMemo(
    () => skeleton?.bones.filter(b => b.name && !SKIP_BONES.has(b.name)) ?? [],
    [skeleton],
  )

  if (!visible || !skeleton) return null

  return (
    <>
      {/* Bone dots */}
      {bones.map(bone => (
        <BoneDot
          key={bone.uuid}
          bone={bone}
          selected={bone.name === selName}
          onSelect={() => {
            animEditorState.selectedBoneName = bone.name
            setSelName(bone.name)
          }}
        />
      ))}

      {/* Deselect on background click */}
      <mesh
        position={[0, -100, 0]}
        onClick={() => {
          animEditorState.selectedBoneName = null
          setSelName(null)
        }}
      >
        <planeGeometry args={[10000, 10000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Transform gizmo on selected bone */}
      {selectedBone && (
        <TransformControls
          object={selectedBone}
          mode="rotate"
          space="local"
          size={0.6}
        />
      )}
    </>
  )
}
