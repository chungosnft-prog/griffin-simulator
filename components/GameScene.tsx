"use client"

// Patch Three.js shaders for PS1 style BEFORE any materials are compiled
import { applyPS1Shaders } from "./ps1Shaders"
applyPS1Shaders()

import { useRef, useState, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import { useKeyboardControls } from "@react-three/drei"
import { playerState } from "./playerState"
import Player from "./Player"
import CameraController from "./CameraController"
import HouseEnvironment from "./HouseEnvironment"
import OfficeChair from "./decor/OfficeChair"
import BathroomDecor from "./decor/BathroomDecor"
import Exterior from "./decor/Exterior"
import Mudroom from "./decor/Mudroom"
import { CutsceneEditorR3F } from "./cutscene/CutsceneEditorR3F"
import { CutscenePlayback } from "./cutscene/CutscenePlayback"
import { useCutsceneContext } from "./cutscene/CutsceneContext"
import { test } from "./cutscenes/test"
import { couchCutscene } from "./cutscenes/couchCutscene"
import ZoneCameraSystem from "./ZoneCameraSystem"
import BoneGizmos from "./animation/BoneGizmos"
import { animEditorState } from "./animation/animEditorState"
import SceneInspector from "./SceneInspector"
import { SCENE_READY_EVENT } from "./LoadingScreen"

interface GameSceneProps {
  initialPlayerPosition?: [number, number, number]
  initialCameraPosition?: [number, number, number]
  isPointerLocked?: boolean
  introDone?: boolean
  onIntroDone?: () => void
}

export default function GameScene({
  initialPlayerPosition = [0, 15, 0],
  initialCameraPosition = [0, 15, 10],
  isPointerLocked = false,
  introDone = false,
  onIntroDone,
}: GameSceneProps) {
  const playerRef = useRef<any>()
  const [cameraMode, setCameraMode] = useState("normal")
  const [, get] = useKeyboardControls()
  const lastCameraCheck = useRef(0)

  const { isFreeCameraMode, isPlaying } = useCutsceneContext()
  const editorActive  = isFreeCameraMode || isPlaying
  const introPlaying  = !introDone && !editorActive

  // Track sitting / zone / rig-edit state each frame
  const prevSitting    = useRef(true)
  const prevZoneId     = useRef<string | null>(null)
  const prevCreateMode = useRef(false)
  const [couchPlaying,   setCouchPlaying]   = useState(true)
  const [zoneActive,     setZoneActive]     = useState(false)
  const [animCreateMode, setAnimCreateMode] = useState(false)

  // Tell the loading screen once a few frames have actually rendered
  // (GameScene only mounts after the house + player finish loading)
  const framesRendered = useRef(0)
  useFrame(() => {
    if (framesRendered.current < 3 && ++framesRendered.current === 3) {
      window.dispatchEvent(new Event(SCENE_READY_EVENT))
    }
  })

  useFrame(() => {
    // Only the couch has a seated cutscene; the office chair keeps the normal camera
    const s = playerState.sitting && playerState.seat === "couch"
    if (s !== prevSitting.current) { prevSitting.current = s; setCouchPlaying(s) }

    const z = playerState.activeZoneId
    if (z !== prevZoneId.current) { prevZoneId.current = z; setZoneActive(!!z) }

    const c = animEditorState.createMode
    if (c !== prevCreateMode.current) { prevCreateMode.current = c; setAnimCreateMode(c) }
  })

  useEffect(() => {
    const checkCameraToggle = () => {
      if (editorActive || introPlaying) return
      const now = Date.now()
      if (now - lastCameraCheck.current < 500) return
      const { camera } = get() as any
      if (camera) {
        setCameraMode((prev) => (prev === "normal" ? "close" : "normal"))
        lastCameraCheck.current = now
      }
    }
    const interval = setInterval(checkCameraToggle, 500)
    return () => clearInterval(interval)
  }, [get, editorActive, introPlaying])

  return (
    <>
      {/* Sky */}
      <color attach="background" args={["#cfe2f1"]} />
      <fog attach="fog" args={["#c4d8e8", 45, 260]} />

      {/* General fill lighting — softens harsh shadows from baked GLB lights */}
      <ambientLight intensity={0.12} color="#ffffff" />
      <hemisphereLight args={["#c8d8f0", "#4a4a58", 0.4]} />

      {/* House */}
      <HouseEnvironment />
      <OfficeChair />
      <BathroomDecor />
      <Mudroom />
      <Exterior />

      {/* Player — hidden but still ticking physics when editor is active */}
      <Player
        ref={playerRef}
        position={initialPlayerPosition}
        isPointerLocked={isPointerLocked && !editorActive && !introPlaying}
      />

      {/* Intro cutscene */}
      <CutscenePlayback
        cutscene={test}
        playing={introPlaying}
        onComplete={onIntroDone}
      />

      {/* Couch sit cutscene — plays whenever player is seated */}
      <CutscenePlayback
        cutscene={couchCutscene}
        playing={couchPlaying && !editorActive}
      />

      {/* RE-style fixed camera zones */}
      <ZoneCameraSystem />

      {/* Normal third-person camera — locked while rig editor is active */}
      {!editorActive && introDone && !couchPlaying && !zoneActive && !animCreateMode && (
        <CameraController
          target={playerRef}
          cameraMode={cameraMode}
          initialPosition={initialCameraPosition}
        />
      )}

      {/* Bone gizmos for animation editor rig posing */}
      <BoneGizmos />

      {/* Cutscene editor R3F layer */}
      <CutsceneEditorR3F />

      {/* Scene mesh inspector (I key toggle) */}
      <SceneInspector />
    </>
  )
}
