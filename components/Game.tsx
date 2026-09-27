"use client"
import { Canvas } from "@react-three/fiber"
import { Physics } from "@react-three/rapier"
import { KeyboardControls } from "@react-three/drei"
import GameScene from "./GameScene"
import { Suspense, useState, useEffect, useRef } from "react"
import { CutsceneProvider } from "./cutscene/CutsceneContext"
import CutsceneEditorPanel from "./cutscene/CutsceneEditorPanel"
import { useCutsceneContext } from "./cutscene/CutsceneContext"
import { playerState } from "./playerState"
import { animEditorState } from "./animation/animEditorState"
import LoadingScreen from "./LoadingScreen"
import AnimationEditorPanel from "./animation/AnimationEditorPanel"
import { inspectorState, type InspectorHit } from "./SceneInspector"

const controlsMap = [
  { name: "forward",  keys: ["KeyW", "ArrowUp"]    },
  { name: "backward", keys: ["KeyS", "ArrowDown"]  },
  { name: "left",     keys: ["KeyA", "ArrowLeft"]  },
  { name: "right",    keys: ["KeyD", "ArrowRight"] },
  { name: "jump",     keys: ["Space"]              },
  { name: "sprint",   keys: ["ShiftLeft"]          },
  { name: "camera",   keys: ["KeyC"]               },
  { name: "interact", keys: ["KeyE"]               },
  { name: "ragdoll",  keys: ["KeyR"]               },
  { name: "drink",    keys: ["KeyF"]               },
]

// Inner game — needs to be inside CutsceneProvider to access context
function GameInner() {
  const [isReady,         setIsReady]         = useState(false)
  const [pointerLocked, setPointerLocked]     = useState(false)
  // Fallback for browsers/embeds that refuse pointer lock: play without it,
  // using plain mouse movement for camera look. ESC pauses.
  const [unlockedPlay, setUnlockedPlay]       = useState(false)
  const isPointerLocked = pointerLocked || unlockedPlay
  const [loadingError,    setLoadingError]    = useState<string | null>(null)
  const canvasRef = useRef<any>(null)

  const { isFreeCameraMode, isPlaying } = useCutsceneContext()
  const editorActive = isFreeCameraMode || isPlaying

  const [introDone, setIntroDone]         = useState(true)
  const [showSitPrompt, setShowSitPrompt] = useState(false)
  const [isSittingUI, setIsSittingUI]     = useState(true)
  const [isDrinkingUI, setIsDrinkingUI]   = useState(false)
  const [seatUI, setSeatUI]               = useState<"couch" | "chair" | null>("couch")
  const [mirrorUI, setMirrorUI]           = useState(false)
  const [ragdollUI, setRagdollUI]         = useState(false)
  const [posDisplay, setPosDisplay]       = useState({ x: 0, y: 0, z: 0 })

  // ── Scene inspector (I key) ───────────────────────────────────────────────
  const [inspectMode,    setInspectMode]    = useState(false)
  const [inspectHovered, setInspectHovered] = useState<InspectorHit>(null)
  const [inspectClicked, setInspectClicked] = useState<InspectorHit>(null)

  // Poll playerState + inspectorState every frame
  useEffect(() => {
    let raf: number
    const tick = () => {
      const near     = playerState.nearCouch
      const sitting  = playerState.sitting
      const drinking = playerState.drinking
      setShowSitPrompt(near || sitting)
      setIsSittingUI(sitting)
      setIsDrinkingUI(drinking)
      setSeatUI(sitting ? playerState.seat : playerState.nearSeat)
      setMirrorUI(playerState.nearMirror && !playerState.taunting)
      setRagdollUI(playerState.ragdoll)
      setPosDisplay({ ...playerState.position })

      // Inspector reads
      setInspectHovered(inspectorState.hovered ? { ...inspectorState.hovered } : null)
      if (inspectorState.clicked) {
        setInspectClicked({ ...inspectorState.clicked })
        inspectorState.clicked = null  // consume so it only fires once
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // I key: toggle scene inspector
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyI") return
      setInspectMode((prev) => {
        inspectorState.active = !prev
        return !prev
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => { setIsReady(true) }, [])

  useEffect(() => {
    const handlePointerLockChange = () => {
      let locked = false
      try { locked = document.pointerLockElement === canvasRef.current } catch {}
      setPointerLocked(locked)
      // Ragdoll releases the cursor so you can grab him — keep playing instead of pausing
      if (!locked && playerState.ragdoll) setUnlockedPlay(true)
    }
    document.addEventListener("pointerlockchange", handlePointerLockChange)
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange)
  }, [])

  // Click canvas → lock pointer. CameraController also does this, but it isn't
  // mounted while seated (the couch cutscene owns the camera), so the game
  // start click would otherwise do nothing and "Click to play" would stick.
  useEffect(() => {
    if (!isReady) return
    const canvas: HTMLCanvasElement | null = canvasRef.current
    if (!canvas) return
    const startUnlocked = () => setUnlockedPlay(true)
    const onClick = () => {
      if (document.pointerLockElement === canvas) return
      if (editorActive || animEditorState.createMode || inspectorState.active) return
      if (playerState.ragdoll) return   // clicks grab the ragdoll; re-lock on the next click after
      try {
        const req: any = canvas.requestPointerLock()
        if (req && typeof req.catch === "function") req.catch(startUnlocked)
      } catch { startUnlocked() }
    }
    const onKey = (e: KeyboardEvent) => { if (e.code === "Escape") setUnlockedPlay(false) }
    canvas.addEventListener("click", onClick)
    document.addEventListener("pointerlockerror", startUnlocked)
    window.addEventListener("keydown", onKey)
    return () => {
      canvas.removeEventListener("click", onClick)
      document.removeEventListener("pointerlockerror", startUnlocked)
      window.removeEventListener("keydown", onKey)
    }
  }, [isReady, editorActive])

  // Lets CameraController read mouse movement without pointer lock
  useEffect(() => { playerState.freeMouse = unlockedPlay && !pointerLocked }, [unlockedPlay, pointerLocked])


  if (!isReady) {
    return (
      <div style={{ width:"100vw", height:"100vh", background:"#111", display:"flex",
                    alignItems:"center", justifyContent:"center", color:"white", fontFamily:"monospace" }}>
        Loading…
      </div>
    )
  }

  if (loadingError) {
    return (
      <div style={{ width:"100vw", height:"100vh", background:"#111", display:"flex",
                    alignItems:"center", justifyContent:"center", color:"white",
                    fontFamily:"monospace", flexDirection:"column", gap:16 }}>
        <div>Graphics error: {loadingError}</div>
        <button onClick={() => window.location.reload()} style={{ padding:"8px 16px", cursor:"pointer" }}>Reload</button>
      </div>
    )
  }

  return (
    <div style={{ width:"100%", height:"100%", position:"relative" }}>

      {/* Click-to-play overlay (hidden once pointer locked, in editor mode, or in rig edit mode) */}
      {!isPointerLocked && !editorActive && !animEditorState.createMode && (
        <div style={{
          position:"absolute", inset:0,
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:10, pointerEvents:"none",
        }}>
          <div style={{
            background:"rgba(0,0,0,0.65)", color:"white", padding:"20px 40px",
            borderRadius:8, fontFamily:"monospace", fontSize:18, textAlign:"center",
          }}>
            Click to play
            <div style={{ fontSize:13, opacity:0.7, marginTop:8 }}>WASD · SPACE · SHIFT · ESC</div>
            {isSittingUI && (
              <div style={{ fontSize:13, opacity:0.9, marginTop:10, color:"#ffe080" }}>
                Press <strong>E</strong> to stand up
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-game controls HUD */}
      {isPointerLocked && !editorActive && (
        <div style={{
          position:"absolute", top:10, left:10, color:"white",
          fontFamily:"monospace", fontSize:12,
          background:"rgba(0,0,0,0.7)", padding:"12px 16px",
          borderRadius:8, zIndex:1000,
        }}>
          {ragdollUI ? (
            <>
              <div style={{ color: "#ffe080" }}>RAGDOLL — zero gravity</div>
              <div>WASD — Drift · SPACE — Up · SHIFT — Down</div>
              <div>Drag him with the mouse · R — Stand up</div>
            </>
          ) : (
            <>
              <div>WASD — Move · SHIFT — Sprint</div>
              <div>SPACE — Jump · C — Camera · R — Ragdoll · ESC — Unlock</div>
            </>
          )}
        </div>
      )}

      {/* Free camera HUD */}
      {isFreeCameraMode && (
        <div style={{
          position:"absolute", top:10, left:10, color:"#b0a0ff",
          fontFamily:"monospace", fontSize:12,
          background:"rgba(0,0,0,0.8)", padding:"12px 16px",
          borderRadius:8, zIndex:1000, border:"1px solid #4a3a88",
        }}>
          <div style={{ fontWeight:700, marginBottom:4 }}>🎥 FREE CAMERA</div>
          <div>WASD — fly · E/Q — up/down</div>
          <div>LMB drag — look · Scroll — speed</div>
          <div>📷 Hit Capture in the editor panel</div>
        </div>
      )}

      {/* Skip intro button */}
      {!introDone && !editorActive && (
        <div style={{
          position: "absolute", bottom: 30, right: 30, zIndex: 1000,
        }}>
          <button
            onClick={() => setIntroDone(true)}
            style={{
              background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6,
              fontFamily: "monospace", fontSize: 12, padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            Skip ▶▶
          </button>
        </div>
      )}

      {/* Playback indicator */}
      {isPlaying && (
        <div style={{
          position:"absolute", top:10, left:"50%", transform:"translateX(-50%)",
          color:"#33cc77", fontFamily:"monospace", fontSize:12,
          background:"rgba(0,0,0,0.8)", padding:"6px 16px",
          borderRadius:8, zIndex:1000, border:"1px solid #33cc77",
        }}>
          ▶ Previewing cutscene…
        </div>
      )}

      {/* Couch interact prompt
          – always visible when sitting (even before pointer lock, so player knows what to do)
          – only visible when pointer-locked if just nearby but not yet seated            */}
      {showSitPrompt && !editorActive && (isSittingUI || isPointerLocked) && (
        <div style={{
          position: "absolute",
          bottom: 60,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8,
          padding: "10px 20px",
          fontFamily: "monospace",
          color: "white",
          fontSize: 14,
          pointerEvents: "none",
          userSelect: "none",
        }}>
          <span style={{
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.4)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1,
          }}>E</span>
          <span>{isSittingUI ? "Stand up" : seatUI === "chair" ? "Sit at desk" : "Sit on couch"}</span>
        </div>
      )}

      {/* Bathroom mirror prompt */}
      {mirrorUI && !editorActive && isPointerLocked && (
        <div style={{
          position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, display: "flex", alignItems: "center", gap: 10,
          background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8, padding: "10px 20px", fontFamily: "monospace", color: "white",
          fontSize: 14, pointerEvents: "none", userSelect: "none",
        }}>
          <span style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.4)",
            borderRadius: 4, padding: "2px 8px", fontSize: 13, fontWeight: 700, letterSpacing: 1,
          }}>E</span>
          <span>Taunt in the mirror 🪞</span>
        </div>
      )}

      {/* Position debug overlay */}
      <div style={{
        position: "absolute", bottom: 10, right: 10, zIndex: 2000,
        fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
        background: "rgba(0,0,0,0.75)", color: "#00ff88",
        padding: "8px 12px", borderRadius: 6,
        pointerEvents: "none", userSelect: "none",
      }}>
        <div>X {posDisplay.x.toFixed(3)}</div>
        <div>Y {posDisplay.y.toFixed(3)}</div>
        <div>Z {posDisplay.z.toFixed(3)}</div>
      </div>

      {/* Drink beer prompt — shown while sitting */}
      {isSittingUI && seatUI === "couch" && !editorActive && isPointerLocked && (
        <div style={{
          position: "absolute",
          bottom: 110,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8,
          padding: "10px 20px",
          fontFamily: "monospace",
          color: "white",
          fontSize: 14,
          pointerEvents: "none",
          userSelect: "none",
        }}>
          <span style={{
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.4)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1,
          }}>F</span>
          <span>{isDrinkingUI ? "Stop drinking" : "Drink beer 🍺"}</span>
        </div>
      )}

      {/* Scene inspector overlay */}
      {inspectMode && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: "none", zIndex: 3000,
        }}>
          {/* Mode banner */}
          <div style={{
            position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
            background: "rgba(80,60,0,0.92)", color: "#ffe080",
            fontFamily: "monospace", fontSize: 13, fontWeight: 700,
            padding: "6px 20px", borderRadius: 6,
            border: "1px solid #ffe080",
          }}>
            🔍 INSPECT MODE — hover any mesh · click to pin · [I] to exit
          </div>

          {/* Hover tooltip */}
          {inspectHovered && (
            <div style={{
              position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.88)", color: "#fff",
              fontFamily: "monospace", fontSize: 12, lineHeight: 1.7,
              padding: "10px 16px", borderRadius: 6,
              border: "1px solid rgba(255,255,100,0.4)",
              minWidth: 320,
            }}>
              <div style={{ color: "#ffe080", fontWeight: 700, marginBottom: 4 }}>
                {inspectHovered.objName}
              </div>
              <div>mesh&nbsp;&nbsp;&nbsp; <span style={{ color: "#88ffcc" }}>{inspectHovered.meshName}</span></div>
              <div>parent&nbsp; <span style={{ color: "#aaaaff" }}>{inspectHovered.parentName || "—"}</span></div>
              <div>worldPos  X {inspectHovered.worldPos.x}  Y <span style={{ color: "#ff8866" }}>{inspectHovered.worldPos.y}</span>  Z {inspectHovered.worldPos.z}</div>
              <div>hitPoint  X {inspectHovered.hitPoint.x}  Y <span style={{ color: "#ff8866" }}>{inspectHovered.hitPoint.y}</span>  Z {inspectHovered.hitPoint.z}</div>
            </div>
          )}

          {/* Pinned (clicked) selection */}
          {inspectClicked && (
            <div style={{
              position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,40,0,0.92)", color: "#88ffcc",
              fontFamily: "monospace", fontSize: 12, lineHeight: 1.7,
              padding: "10px 16px", borderRadius: 6,
              border: "1px solid #44cc88",
              minWidth: 320,
            }}>
              <div style={{ fontWeight: 700, color: "#44ff88", marginBottom: 4 }}>
                📌 PINNED SELECTION
              </div>
              <div>obj&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#ffe080" }}>{inspectClicked.objName}</span></div>
              <div>mesh&nbsp;&nbsp;&nbsp; <span style={{ color: "#88ffcc" }}>{inspectClicked.meshName}</span></div>
              <div>parent&nbsp; <span style={{ color: "#aaaaff" }}>{inspectClicked.parentName || "—"}</span></div>
              <div>worldPos  X {inspectClicked.worldPos.x}  Y <span style={{ color: "#ff8866" }}>{inspectClicked.worldPos.y}</span>  Z {inspectClicked.worldPos.z}</div>
              <div>hitPoint  X {inspectClicked.hitPoint.x}  Y <span style={{ color: "#ff8866" }}>{inspectClicked.hitPoint.y}</span>  Z {inspectClicked.hitPoint.z}</div>
            </div>
          )}
        </div>
      )}

      {/* HTML editor overlay */}
      <CutsceneEditorPanel />

      {/* Animation editor overlay */}
      <AnimationEditorPanel />

      {/* 3D canvas */}
      <KeyboardControls map={controlsMap}>
        <Canvas
          ref={canvasRef}
          className="game-canvas"
          shadows
          dpr={0.4}
          gl={{
            antialias: false,
            powerPreference: "high-performance",
            alpha: false,
            depth: true,
            stencil: false,
            // ACESFilmic tone mapping prevents the GLB lights from blowing out.
            // Exposure < 1 dims the overall scene — tweak if too dark/bright.
            toneMapping: 4,          // THREE.ACESFilmicToneMapping
            toneMappingExposure: 0.002,
          }}
          camera={{ position: [0, 5, 10], fov: 50, near: 0.1, far: 2000 }}
          style={{ display: "block" }}
          tabIndex={0}
          onError={(error: any) => setLoadingError(error?.message || "Unknown WebGL error")}
        >
          <Suspense fallback={<></>}>
            <Physics gravity={[0, -30, 0]} timeStep={1 / 60}>
              <GameScene
                initialPlayerPosition={[-4.636, 0.912, 0.142]}
                initialCameraPosition={[-4.636, 3, 3]}
                isPointerLocked={isPointerLocked}
                introDone={introDone}
                onIntroDone={() => setIntroDone(true)}
              />
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </div>
  )
}

// Outer wrapper — provides context to both HTML overlay and Canvas
export default function Game() {
  return (
    <CutsceneProvider>
      <LoadingScreen />
      <GameInner />
    </CutsceneProvider>
  )
}
