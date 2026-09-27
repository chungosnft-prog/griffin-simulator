"use client"
import {
  createContext, useContext, useState, useRef,
  useCallback, useEffect, type MutableRefObject, type ReactNode,
} from "react"
import type { Cutscene, Keyframe, CameraZone } from "./types"

// ── Context shape ────────────────────────────────────────────────────────────

export interface CutsceneContextValue {
  // React state (drives UI re-renders)
  isEditorOpen:       boolean
  cutscenes:          Cutscene[]
  activeCutsceneId:   string | null
  activeCutscene:     Cutscene | null
  isFreeCameraMode:   boolean
  isPlaying:          boolean
  selectedKeyframeId: string | null

  // Camera zones
  zones:            CameraZone[]
  activeZoneId:     string | null          // which zone the character is currently in
  selectedZoneId:   string | null          // which zone is selected in the editor
  zonesRef:         MutableRefObject<CameraZone[]>
  activeZoneIdRef:  MutableRefObject<string | null>

  // Mutable refs — safe to read inside useFrame without causing re-renders
  freeCamRef:        MutableRefObject<boolean>
  playingRef:        MutableRefObject<boolean>
  keyframesRef:      MutableRefObject<Keyframe[]>
  pendingCaptureRef: MutableRefObject<boolean>
  gotoTargetRef:     MutableRefObject<Keyframe | null>
  liveCamRef:        MutableRefObject<{ x: number; y: number; z: number; pitch: number; yaw: number }>
  livePlayerRef:     MutableRefObject<{ x: number; y: number; z: number } | null>
  scrubTimeRef:      MutableRefObject<number>

  // Actions
  toggleEditor():                                       void
  setFreeCameraMode(on: boolean):                       void

  createCutscene(name: string):                         void
  selectCutscene(id: string | null):                    void
  renameCutscene(id: string, name: string):             void
  deleteCutscene(id: string):                           void

  appendKeyframe(kf: Keyframe):                         void
  updateKeyframe(id: string, patch: Partial<Keyframe>): void
  deleteKeyframe(id: string):                           void
  moveKeyframe(id: string, dir: "up" | "down"):         void
  selectKeyframe(id: string | null):                    void

  requestCapture():                                     void
  deliverCapture(kf: Keyframe):                         void

  gotoKeyframe(kf: Keyframe):                           void
  clearGoto():                                          void

  startPlayback():                                      void
  stopPlayback():                                       void

  setScrubTime(t: number):                              void

  // Zone actions
  createZone(zone: CameraZone):                         void
  updateZone(id: string, patch: Partial<CameraZone>):   void
  deleteZone(id: string):                               void
  selectZone(id: string | null):                        void
  setActiveZoneId(id: string | null):                   void

  exportCode(id?: string): string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LS_KEY       = "griffin_cutscenes"
const LS_ZONES_KEY = "griffin_camera_zones"

function load(): Cutscene[] {
  try {
    if (typeof window === "undefined") return []
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Cutscene[]) : []
  } catch { return [] }
}

function save(cs: Cutscene[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cs)) } catch {}
}

function loadZones(): CameraZone[] {
  try {
    if (typeof window === "undefined") return []
    const raw = localStorage.getItem(LS_ZONES_KEY)
    return raw ? (JSON.parse(raw) as CameraZone[]) : []
  } catch { return [] }
}

function saveZones(zones: CameraZone[]) {
  try { localStorage.setItem(LS_ZONES_KEY, JSON.stringify(zones)) } catch {}
}

// ── Context + Provider ───────────────────────────────────────────────────────

const Ctx = createContext<CutsceneContextValue | null>(null)

export function useCutsceneContext() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useCutsceneContext: must be inside <CutsceneProvider>")
  return c
}

export function CutsceneProvider({ children }: { children: ReactNode }) {
  const [isEditorOpen,      setEditorOpen]  = useState(false)
  const [cutscenes,         setCutscenes]   = useState<Cutscene[]>([])
  const [activeCutsceneId,  setActiveCsId]  = useState<string | null>(null)
  const [isFreeCameraMode,  setFreeCamera]  = useState(false)
  const [isPlaying,         setPlaying]     = useState(false)
  const [selectedKeyframeId,setSelKf]       = useState<string | null>(null)

  const [zones,         setZones]        = useState<CameraZone[]>([])
  const [activeZoneId,  setActiveZoneId_] = useState<string | null>(null)
  const [selectedZoneId,setSelZone]       = useState<string | null>(null)

  // Hot-path refs
  const freeCamRef        = useRef(false)
  const playingRef        = useRef(false)
  const keyframesRef      = useRef<Keyframe[]>([])
  const pendingCaptureRef = useRef(false)
  const gotoTargetRef     = useRef<Keyframe | null>(null)
  const liveCamRef        = useRef({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0 })
  const livePlayerRef     = useRef<{ x: number; y: number; z: number } | null>(null)
  const scrubTimeRef      = useRef(-1)
  const zonesRef          = useRef<CameraZone[]>([])
  const activeZoneIdRef   = useRef<string | null>(null)

  // Keep refs in sync
  useEffect(() => { freeCamRef.current   = isFreeCameraMode }, [isFreeCameraMode])
  useEffect(() => { playingRef.current   = isPlaying        }, [isPlaying])
  useEffect(() => {
    const cs = cutscenes.find(c => c.id === activeCutsceneId)
    keyframesRef.current = cs?.keyframes ?? []
  }, [cutscenes, activeCutsceneId])
  useEffect(() => { zonesRef.current = zones }, [zones])
  useEffect(() => { activeZoneIdRef.current = activeZoneId }, [activeZoneId])

  const activeCutscene = cutscenes.find(c => c.id === activeCutsceneId) ?? null

  // Load persisted data on mount
  useEffect(() => {
    const saved = load()
    if (saved.length) { setCutscenes(saved); setActiveCsId(saved[0].id) }
    const savedZones = loadZones()
    if (savedZones.length) setZones(savedZones)
  }, [])

  useEffect(() => { if (cutscenes.length) save(cutscenes) }, [cutscenes])
  useEffect(() => { saveZones(zones) }, [zones])

  // ── Cutscene actions ────────────────────────────────────────────────────────

  const toggleEditor      = useCallback(() => setEditorOpen(p => !p), [])
  const setFreeCameraMode = useCallback((on: boolean) => {
    setFreeCamera(on); freeCamRef.current = on
    // Free cam steers by dragging, so give the cursor back
    if (on && typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock()
    if (!on) pendingCaptureRef.current = false
  }, [])

  const createCutscene = useCallback((name: string) => {
    const id = `cs_${Date.now()}`
    setCutscenes(p => { const n = [...p, { id, name, keyframes: [] }]; save(n); return n })
    setActiveCsId(id)
  }, [])
  const selectCutscene  = useCallback((id: string | null) => { setActiveCsId(id); setSelKf(null) }, [])
  const renameCutscene  = useCallback((id: string, name: string) => {
    setCutscenes(p => { const n = p.map(c => c.id === id ? { ...c, name } : c); save(n); return n })
  }, [])
  const deleteCutscene  = useCallback((id: string) => {
    setCutscenes(p => { const n = p.filter(c => c.id !== id); save(n); return n })
    setActiveCsId(p => p === id ? null : p)
  }, [])

  const appendKeyframe = useCallback((kf: Keyframe) => {
    if (!activeCutsceneId) return
    setCutscenes(p => {
      const n = p.map(c => c.id === activeCutsceneId ? { ...c, keyframes: [...c.keyframes, kf] } : c)
      save(n); return n
    })
    setSelKf(kf.id)
  }, [activeCutsceneId])

  const updateKeyframe = useCallback((id: string, patch: Partial<Keyframe>) => {
    if (!activeCutsceneId) return
    setCutscenes(p => {
      const n = p.map(c => c.id !== activeCutsceneId ? c : {
        ...c, keyframes: c.keyframes.map(kf => kf.id === id ? { ...kf, ...patch } : kf)
      })
      save(n); return n
    })
  }, [activeCutsceneId])

  const deleteKeyframe = useCallback((id: string) => {
    if (!activeCutsceneId) return
    setCutscenes(p => {
      const n = p.map(c => c.id !== activeCutsceneId ? c : {
        ...c, keyframes: c.keyframes.filter(kf => kf.id !== id)
      })
      save(n); return n
    })
    setSelKf(p => p === id ? null : p)
  }, [activeCutsceneId])

  const moveKeyframe = useCallback((id: string, dir: "up" | "down") => {
    if (!activeCutsceneId) return
    setCutscenes(p => {
      const n = p.map(c => {
        if (c.id !== activeCutsceneId) return c
        const arr = [...c.keyframes]
        const i   = arr.findIndex(kf => kf.id === id)
        const j   = dir === "up" ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= arr.length) return c
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        return { ...c, keyframes: arr }
      })
      save(n); return n
    })
  }, [activeCutsceneId])

  const selectKeyframe  = useCallback((id: string | null) => setSelKf(id), [])
  const requestCapture  = useCallback(() => { pendingCaptureRef.current = true }, [])
  const deliverCapture  = useCallback((kf: Keyframe) => {
    pendingCaptureRef.current = false; appendKeyframe(kf)
  }, [appendKeyframe])

  const gotoKeyframe = useCallback((kf: Keyframe) => {
    gotoTargetRef.current = kf; setFreeCamera(true); freeCamRef.current = true
  }, [])
  const clearGoto = useCallback(() => { gotoTargetRef.current = null }, [])

  const startPlayback = useCallback(() => {
    if (!activeCutscene || activeCutscene.keyframes.length < 2) return
    setPlaying(true);    playingRef.current  = true
    setFreeCamera(false); freeCamRef.current = false
  }, [activeCutscene])
  const stopPlayback = useCallback(() => { setPlaying(false); playingRef.current = false }, [])
  const setScrubTime = useCallback((t: number) => { scrubTimeRef.current = t }, [])

  // ── Zone actions ─────────────────────────────────────────────────────────────

  const createZone = useCallback((zone: CameraZone) => {
    setZones(p => { const n = [...p, zone]; saveZones(n); return n })
    setSelZone(zone.id)
  }, [])

  const updateZone = useCallback((id: string, patch: Partial<CameraZone>) => {
    setZones(p => { const n = p.map(z => z.id === id ? { ...z, ...patch } : z); saveZones(n); return n })
  }, [])

  const deleteZone = useCallback((id: string) => {
    setZones(p => { const n = p.filter(z => z.id !== id); saveZones(n); return n })
    setSelZone(p => p === id ? null : p)
  }, [])

  const selectZone     = useCallback((id: string | null) => setSelZone(id), [])
  const setActiveZoneId = useCallback((id: string | null) => {
    setActiveZoneId_(id); activeZoneIdRef.current = id
  }, [])

  const exportCode = useCallback((id?: string) => {
    const cs = id ? cutscenes.find(c => c.id === id) : activeCutscene
    if (!cs) return "// No cutscene selected"
    const varName = (cs.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/, "") || "cutscene")
    return [
      `import type { Cutscene } from "@/components/cutscene/types"`,
      `import { CutscenePlayback } from "@/components/cutscene/CutscenePlayback"`,
      ``,
      `export const ${varName}: Cutscene = ${JSON.stringify(cs, null, 2)}`,
      ``,
      `// ── Drop into your GameScene: ─────────────────────────────────────────────`,
      `// const [playing, setPlaying] = useState(false)`,
      `// <CutscenePlayback cutscene={${varName}} playing={playing} onComplete={() => setPlaying(false)} />`,
    ].join("\n")
  }, [cutscenes, activeCutscene])

  const value: CutsceneContextValue = {
    isEditorOpen, cutscenes, activeCutsceneId, activeCutscene,
    isFreeCameraMode, isPlaying, selectedKeyframeId,
    zones, activeZoneId, selectedZoneId, zonesRef, activeZoneIdRef,
    freeCamRef, playingRef, keyframesRef, pendingCaptureRef, gotoTargetRef,
    liveCamRef, livePlayerRef, scrubTimeRef,
    toggleEditor, setFreeCameraMode,
    createCutscene, selectCutscene, renameCutscene, deleteCutscene,
    appendKeyframe, updateKeyframe, deleteKeyframe, moveKeyframe, selectKeyframe,
    requestCapture, deliverCapture,
    gotoKeyframe, clearGoto,
    startPlayback, stopPlayback,
    setScrubTime,
    createZone, updateZone, deleteZone, selectZone, setActiveZoneId,
    exportCode,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
