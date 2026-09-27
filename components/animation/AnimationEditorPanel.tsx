"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import * as THREE from "three"
import { animEditorState, PoseKeyframe } from "./animEditorState"

const R2D = THREE.MathUtils.radToDeg
const D2R = THREE.MathUtils.degToRad

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`

const btn = (label: string, onClick: () => void, opts: {
  active?: boolean; color?: string; borderColor?: string; style?: any
} = {}) => (
  <button
    onClick={onClick}
    style={{
      background:   opts.active ? "rgba(160,120,255,0.25)" : "rgba(255,255,255,0.07)",
      border:       `1px solid ${opts.borderColor ?? (opts.active ? "#a078ff" : "rgba(255,255,255,0.15)")}`,
      color:        opts.color ?? "white",
      borderRadius: 4,
      padding:      "4px 10px",
      fontFamily:   "monospace",
      fontSize:     11,
      cursor:       "pointer",
      ...opts.style,
    }}
  >{label}</button>
)

// ── build THREE.AnimationClip from saved keyframes ────────────────────────────
function buildClip(
  name:      string,
  duration:  number,
  keyframes: PoseKeyframe[],
  skeleton:  THREE.Skeleton,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []

  for (const bone of skeleton.bones) {
    const times: number[] = []
    const values: number[] = []
    for (const kf of keyframes) {
      const q = kf.bones[bone.name]
      if (q) { times.push(kf.time); values.push(...q) }
    }
    if (times.length >= 1) {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${bone.name}.quaternion`, times, values,
      ))
    }
  }

  return new THREE.AnimationClip(name, duration, tracks)
}

// ── main component ────────────────────────────────────────────────────────────
export default function AnimationEditorPanel() {
  const [open,       setOpen]       = useState(false)
  const [tab,        setTab]        = useState<"preview" | "create">("preview")
  const [clips,      setClips]      = useState<string[]>([])
  const [active,     setActive]     = useState("")
  const [time,       setTime]       = useState(0)
  const [duration,   setDuration]   = useState(0)
  const [speed,      setSpeed]      = useState(1)
  const [paused,     setPaused]     = useState(false)
  const [controlled, setControlled] = useState(false)
  // create tab state
  const [createMode,  setCreateMode]  = useState(false)
  const [keyframes,   setKeyframes]   = useState<PoseKeyframe[]>([])
  const [animName,    setAnimName]    = useState("MyAnimation")
  const [animDur,     setAnimDur]     = useState(3)
  const [cursorTime,  setCursorTime]  = useState(0)
  const [selBone,     setSelBone]     = useState<string | null>(null)
  const [boneNames,   setBoneNames]   = useState<string[]>([])
  const [boneRot,     setBoneRot]     = useState({ x: 0, y: 0, z: 0 })   // degrees
  const raf = useRef<number>()

  // Poll animEditorState every frame
  useEffect(() => {
    const tick = () => {
      setClips(c => {
        const n = animEditorState.clips
        return (n.length !== c.length || n.some((x, i) => x !== c[i])) ? [...n] : c
      })
      setActive(animEditorState.activeClip)
      setTime(animEditorState.time)
      setDuration(animEditorState.duration)
      const sb = animEditorState.selectedBoneName
      setSelBone(sb)
      // Read the selected bone's current Euler rotation for the sliders
      if (sb && animEditorState.skeleton) {
        const bone = animEditorState.skeleton.bones.find(b => b.name === sb)
        if (bone) {
          setBoneRot({
            x: R2D(bone.rotation.x),
            y: R2D(bone.rotation.y),
            z: R2D(bone.rotation.z),
          })
        }
      }
      if (animEditorState.skeleton) {
        const names = animEditorState.skeleton.bones.map(b => b.name).filter(Boolean)
        setBoneNames(n => n.length === names.length ? n : names)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current!)
  }, [])

  // ── Preview tab handlers ──────────────────────────────────────────────────
  const takeControl  = useCallback(() => { animEditorState.controlled = true;  setControlled(true)  }, [])
  const releaseCtrl  = useCallback(() => {
    animEditorState.controlled = false; animEditorState.paused = false; animEditorState.speed = 1
    setControlled(false); setPaused(false); setSpeed(1)
  }, [])
  const playClip = useCallback((name: string) => {
    if (!animEditorState.controlled) takeControl()
    animEditorState.playRequest = name
    animEditorState.paused      = false
    setPaused(false)
  }, [takeControl])
  const togglePause  = useCallback(() => {
    const n = !paused; setPaused(n); animEditorState.paused = n
  }, [paused])
  const changeSpeed  = useCallback((v: number) => { setSpeed(v); animEditorState.speed = v }, [])

  // ── Create tab handlers ───────────────────────────────────────────────────
  const enterCreate = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock()
    animEditorState.createMode   = true
    animEditorState.controlled   = true
    setCreateMode(true); setControlled(true)
  }, [])

  const exitCreate = useCallback(() => {
    animEditorState.createMode        = false
    animEditorState.controlled        = false
    animEditorState.selectedBoneName  = null
    setCreateMode(false); setControlled(false); setSelBone(null)
  }, [])

  // Directly set one rotation axis on the selected bone (degrees → radians)
  const setRotAxis = useCallback((axis: "x" | "y" | "z", deg: number) => {
    const sk = animEditorState.skeleton
    const sb = animEditorState.selectedBoneName
    if (!sk || !sb) return
    const bone = sk.bones.find(b => b.name === sb)
    if (!bone) return
    // Three.js Euler ↔ Quaternion auto-syncs when you reassign via set()
    const e = bone.rotation
    const nx = axis === "x" ? D2R(deg) : e.x
    const ny = axis === "y" ? D2R(deg) : e.y
    const nz = axis === "z" ? D2R(deg) : e.z
    bone.rotation.set(nx, ny, nz, e.order)
    bone.updateMatrixWorld(true)
    setBoneRot(prev => ({ ...prev, [axis]: deg }))
  }, [])

  const captureKeyframe = useCallback(() => {
    const sk = animEditorState.skeleton
    if (!sk) return
    const bones: PoseKeyframe["bones"] = {}
    for (const bone of sk.bones) {
      if (bone.name) {
        const q = bone.quaternion
        bones[bone.name] = [q.x, q.y, q.z, q.w]
      }
    }
    const kf: PoseKeyframe = { time: cursorTime, bones }
    setKeyframes(prev => {
      const filtered = prev.filter(k => Math.abs(k.time - cursorTime) > 0.001)
      return [...filtered, kf].sort((a, b) => a.time - b.time)
    })
  }, [cursorTime])

  const deleteKeyframe = useCallback((t: number) => {
    setKeyframes(prev => prev.filter(k => Math.abs(k.time - t) > 0.001))
  }, [])

  const previewCreated = useCallback(() => {
    const sk = animEditorState.skeleton
    if (!sk || keyframes.length < 1) return
    const clip = buildClip(animName, animDur, keyframes, sk)
    animEditorState.addClipRequest = clip
  }, [keyframes, animName, animDur])

  const exportJSON = useCallback(() => {
    const sk = animEditorState.skeleton
    if (!sk || keyframes.length < 1) return
    const clip = buildClip(animName, animDur, keyframes, sk)
    const json = JSON.stringify(clip.toJSON(), null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url; a.download = `${animName}.json`; a.click()
    URL.revokeObjectURL(url)
  }, [keyframes, animName, animDur])

  const pct = duration > 0 ? (time / duration) * 100 : 0

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 2000,
          background:   open ? "rgba(160,120,255,0.2)" : "rgba(0,0,0,0.6)",
          border:       open ? "1px solid #a078ff" : "1px solid rgba(255,255,255,0.2)",
          color:        open ? "#c8aaff" : "rgba(255,255,255,0.7)",
          borderRadius: 6, fontFamily: "monospace", fontSize: 12,
          padding: "6px 12px", cursor: "pointer",
        }}
      >
        🎞 Anims
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 46, right: 10,
          width: 280, maxHeight: "calc(100vh - 70px)",
          zIndex: 2000,
          background:    "rgba(10,10,18,0.93)",
          border:        "1px solid rgba(160,120,255,0.3)",
          borderRadius:  8, fontFamily: "monospace", color: "white",
          fontSize: 12, display: "flex", flexDirection: "column",
          overflow: "hidden", backdropFilter: "blur(6px)",
        }}>

          {/* Header */}
          <div style={{
            padding: "10px 14px 0", borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontWeight: 700, letterSpacing: 1, color: "#c8aaff", fontSize: 11, marginBottom: 8 }}>
              🎞 ANIMATION EDITOR
            </div>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 0 }}>
              {(["preview", "create"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    flex: 1, padding: "5px 0",
                    background:    tab === t ? "rgba(160,120,255,0.2)" : "transparent",
                    border:        "none",
                    borderBottom:  tab === t ? "2px solid #a078ff" : "2px solid transparent",
                    color:         tab === t ? "#c8aaff" : "rgba(255,255,255,0.4)",
                    fontFamily:    "monospace", fontSize: 11, cursor: "pointer",
                    textTransform: "uppercase", letterSpacing: 1,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ── PREVIEW TAB ──────────────────────────────────────────────── */}
          {tab === "preview" && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ opacity: 0.5, fontSize: 10, marginBottom: 4 }}>NOW PLAYING</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#e0d0ff",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {active || "—"}
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "#a078ff", borderRadius: 2, transition: "width 0.05s linear" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.5, fontSize: 10, marginBottom: 10 }}>
                  <span>{fmt(time)}</span><span>{fmt(duration)}</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {btn(paused ? "▶ Play" : "⏸ Pause", togglePause, { active: paused, style: { flex: 1 } })}
                  {controlled
                    ? btn("✕ Release", releaseCtrl, { color: "#ff8888", borderColor: "rgba(255,80,80,0.4)", style: { flex: 1 } })
                    : btn("⚡ Take ctrl", takeControl, { color: "#88ffcc", borderColor: "rgba(80,255,160,0.4)", style: { flex: 1 } })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.5, fontSize: 10 }}>Speed</span>
                  <input type="range" min={0.1} max={2} step={0.05} value={speed}
                    onChange={e => changeSpeed(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: "#a078ff" }} />
                  <span style={{ opacity: 0.7, fontSize: 10, width: 30, textAlign: "right" }}>{speed.toFixed(2)}×</span>
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
                {clips.length === 0
                  ? <div style={{ padding: "16px 14px", opacity: 0.4, textAlign: "center" }}>Loading…</div>
                  : clips.map(name => (
                    <div key={name} onClick={() => playClip(name)}
                      style={{
                        padding: "6px 14px", cursor: "pointer",
                        background:  name === active ? "rgba(160,120,255,0.15)" : "transparent",
                        borderLeft:  name === active ? "2px solid #a078ff" : "2px solid transparent",
                        color:       name === active ? "#d8c4ff" : "rgba(255,255,255,0.7)",
                        fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{name}</div>
                  ))}
              </div>
            </div>
          )}

          {/* ── CREATE TAB ───────────────────────────────────────────────── */}
          {tab === "create" && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

              {/* Enter / exit create mode */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {!createMode
                  ? <div>
                      {btn("⚡ Enter Rig Edit Mode", enterCreate, {
                        color: "#88ffcc", borderColor: "rgba(80,255,160,0.4)",
                        style: { width: "100%", padding: "7px 0", fontSize: 12 },
                      })}
                      <div style={{ marginTop: 8, opacity: 0.45, fontSize: 10, lineHeight: 1.5 }}>
                        Freezes the animation mixer and shows<br />
                        bone handles you can grab to pose the rig.
                      </div>
                    </div>
                  : <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ flex: 1, color: "#88ffcc", fontSize: 10, lineHeight: 1.5 }}>
                        ⚡ Rig edit active<br />
                        <span style={{ opacity: 0.5 }}>ESC releases pointer lock</span>
                      </div>
                      {btn("✕ Exit", exitCreate, { color: "#ff8888", borderColor: "rgba(255,80,80,0.4)" })}
                    </div>
                }
              </div>

              {/* Bone list */}
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", maxHeight: 130, overflowY: "auto" }}>
                <div style={{ padding: "6px 14px 2px", opacity: 0.45, fontSize: 10, letterSpacing: 0.5 }}>BONES</div>
                {boneNames.length === 0
                  ? <div style={{ padding: "6px 14px", opacity: 0.4, fontSize: 10 }}>Model not loaded yet</div>
                  : boneNames.map(name => (
                    <div key={name}
                      onClick={() => { animEditorState.selectedBoneName = name; setSelBone(name) }}
                      style={{
                        padding: "4px 14px", cursor: "pointer", fontSize: 10,
                        background:  name === selBone ? "rgba(160,120,255,0.2)" : "transparent",
                        borderLeft:  name === selBone ? "2px solid #ff8800" : "2px solid transparent",
                        color:       name === selBone ? "#ffcc88" : "rgba(255,255,255,0.6)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{name}</div>
                  ))
                }
              </div>

              {/* ── Bone rotation sliders ─────────────────────────────────── */}
              <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ opacity: 0.45, fontSize: 10, marginBottom: 6, letterSpacing: 0.5 }}>
                  ROTATION {selBone ? `— ${selBone}` : "(select a bone)"}
                </div>
                {(["x", "y", "z"] as const).map(axis => {
                  const colors = { x: "#ff6b6b", y: "#6bff8e", z: "#6bb5ff" }
                  const val = boneRot[axis]
                  return (
                    <div key={axis} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ color: colors[axis], fontWeight: 700, fontSize: 11, width: 10 }}>
                        {axis.toUpperCase()}
                      </span>
                      <input
                        type="range" min={-180} max={180} step={0.5}
                        value={val}
                        disabled={!selBone || !createMode}
                        onChange={e => setRotAxis(axis, parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: colors[axis] }}
                      />
                      <input
                        type="number" min={-180} max={180} step={0.5}
                        value={val.toFixed(1)}
                        disabled={!selBone || !createMode}
                        onChange={e => setRotAxis(axis, parseFloat(e.target.value) || 0)}
                        style={{
                          width: 52, background: "rgba(255,255,255,0.07)",
                          border: `1px solid ${selBone ? colors[axis] + "66" : "rgba(255,255,255,0.1)"}`,
                          borderRadius: 4, color: colors[axis],
                          fontFamily: "monospace", fontSize: 10, padding: "2px 4px",
                          textAlign: "right",
                        }}
                      />
                      <span style={{ opacity: 0.4, fontSize: 9, width: 8 }}>°</span>
                    </div>
                  )
                })}
                {selBone && createMode && (
                  <button
                    onClick={() => { setRotAxis("x", 0); setRotAxis("y", 0); setRotAxis("z", 0) }}
                    style={{
                      marginTop: 2, background: "transparent",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.45)", borderRadius: 4,
                      fontFamily: "monospace", fontSize: 10, padding: "2px 8px", cursor: "pointer",
                    }}
                  >Reset</button>
                )}
              </div>

              {/* Keyframe timeline */}
              <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ opacity: 0.45, fontSize: 10 }}>TIMELINE ({keyframes.length} kf)</span>
                  {btn("+ Add Keyframe", captureKeyframe, {
                    color: "#88ffcc", borderColor: "rgba(80,255,160,0.35)",
                    style: { fontSize: 10, padding: "3px 8px" },
                  })}
                </div>

                {/* Time cursor */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ opacity: 0.4, fontSize: 10, whiteSpace: "nowrap" }}>Time</span>
                  <input type="range" min={0} max={animDur} step={0.05} value={cursorTime}
                    onChange={e => setCursorTime(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: "#ff8800" }} />
                  <span style={{ opacity: 0.7, fontSize: 10, width: 28, textAlign: "right" }}>{cursorTime.toFixed(2)}s</span>
                </div>

                {/* Visual timeline strip */}
                <div style={{
                  position: "relative", height: 20,
                  background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "visible", marginBottom: 4,
                }}>
                  {/* cursor */}
                  <div style={{
                    position: "absolute", top: 0, bottom: 0, width: 2,
                    background: "#ff8800", left: `${(cursorTime / animDur) * 100}%`,
                    borderRadius: 1,
                  }} />
                  {/* keyframe ticks */}
                  {keyframes.map(kf => (
                    <div key={kf.time} title={`${kf.time.toFixed(2)}s — click to delete`}
                      onClick={() => deleteKeyframe(kf.time)}
                      style={{
                        position: "absolute", top: 2, bottom: 2, width: 6, marginLeft: -3,
                        background: "#a078ff", borderRadius: 2, cursor: "pointer",
                        left: `${(kf.time / animDur) * 100}%`,
                      }} />
                  ))}
                </div>
                <div style={{ opacity: 0.35, fontSize: 9 }}>Click purple ticks to delete keyframes</div>
              </div>

              {/* Anim settings */}
              <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ opacity: 0.45, fontSize: 10, marginBottom: 3 }}>Name</div>
                    <input value={animName} onChange={e => setAnimName(e.target.value)}
                      style={{
                        width: "100%", background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4,
                        color: "white", fontFamily: "monospace", fontSize: 11, padding: "3px 6px",
                        boxSizing: "border-box",
                      }} />
                  </div>
                  <div style={{ width: 60 }}>
                    <div style={{ opacity: 0.45, fontSize: 10, marginBottom: 3 }}>Duration</div>
                    <input type="number" value={animDur} min={0.1} step={0.5}
                      onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setAnimDur(v) }}
                      style={{
                        width: "100%", background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4,
                        color: "white", fontFamily: "monospace", fontSize: 11, padding: "3px 6px",
                        boxSizing: "border-box",
                      }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  {btn("▶ Preview", previewCreated, {
                    active: false, color: "#c8aaff", borderColor: "rgba(160,120,255,0.4)",
                    style: { flex: 1, fontSize: 11 },
                  })}
                  {btn("⬇ Export JSON", exportJSON, {
                    style: { flex: 1, fontSize: 11 },
                  })}
                  {btn("🗑 Clear", () => setKeyframes([]), {
                    color: "#ff8888", borderColor: "rgba(255,80,80,0.3)",
                    style: { fontSize: 11 },
                  })}
                </div>
              </div>

              {/* Keyframe list */}
              <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
                {keyframes.length === 0
                  ? <div style={{ padding: "12px 14px", opacity: 0.35, fontSize: 10, textAlign: "center" }}>
                      No keyframes yet.<br />Pose the rig, set a time, then Add Keyframe.
                    </div>
                  : keyframes.map(kf => (
                    <div key={kf.time} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "4px 14px",
                    }}>
                      <span style={{ fontSize: 10, opacity: 0.7 }}>
                        🔷 {kf.time.toFixed(3)}s — {Object.keys(kf.bones).length} bones
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {btn("Go", () => setCursorTime(kf.time), { style: { fontSize: 9, padding: "2px 6px" } })}
                        {btn("✕", () => deleteKeyframe(kf.time), { color: "#ff8888", style: { fontSize: 9, padding: "2px 6px" } })}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
