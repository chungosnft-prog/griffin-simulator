"use client"
/**
 * HTML overlay UI for the cutscene editor.
 * Lives OUTSIDE the Canvas. Reads/writes the shared CutsceneContext.
 */
import {
  useState, useRef, useEffect, useCallback,
  type ChangeEvent, type CSSProperties,
} from "react"
import { useCutsceneContext } from "./CutsceneContext"
import type { Keyframe, EasingType, CameraZone } from "./types"

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       "rgba(7, 7, 14, 0.97)",
  bgCard:   "#0f0f1c",
  bgInput:  "#0a0a16",
  bgHover:  "#181828",
  border:   "#252540",
  borderHi: "#4a3a88",
  accent:   "#6644dd",
  accentHi: "#8866ff",
  danger:   "#cc3344",
  ok:       "#33cc77",
  text:     "#e0e0f8",
  muted:    "#7070a0",
  heading:  "#b0a0ff",
  red:      "#ff4455",
}

const FONT = "13px/1.4 'SF Mono', 'Fira Code', monospace"

// ── Style helpers ─────────────────────────────────────────────────────────────
function btn(variant: "accent" | "ghost" | "danger" | "ok" | "warn" = "ghost"): CSSProperties {
  const bg = variant === "accent" ? C.accent
           : variant === "danger" ? C.danger
           : variant === "ok"     ? C.ok
           : variant === "warn"   ? "#aa6600"
           : "transparent"
  return {
    background:   bg,
    color:        variant === "ghost" ? C.muted : "#fff",
    border:       variant === "ghost" ? `1px solid ${C.border}` : "none",
    borderRadius: 4,
    cursor:       "pointer",
    font:         FONT,
    fontSize:     11,
    fontWeight:   600,
    padding:      "3px 9px",
    whiteSpace:   "nowrap",
    flexShrink:   0,
  }
}

function inputStyle(): CSSProperties {
  return {
    background:  C.bgInput,
    border:      `1px solid ${C.border}`,
    borderRadius: 3,
    color:        C.text,
    font:         FONT,
    fontSize:     11,
    padding:      "2px 5px",
    outline:      "none",
    width:        "100%",
    boxSizing:    "border-box",
  }
}

function sectionLabel(text: string) {
  return (
    <div style={{
      color: C.muted, fontSize: 9, textTransform: "uppercase",
      letterSpacing: 1.2, fontWeight: 700, marginBottom: 6,
    }}>
      {text}
    </div>
  )
}

function trapKeys(e: React.KeyboardEvent) { e.stopPropagation() }

// ── Helpers ───────────────────────────────────────────────────────────────────
function getKeyframeTimes(keyframes: Keyframe[]): number[] {
  const times: number[] = [0]
  for (let i = 1; i < keyframes.length; i++) {
    times.push(times[i - 1] + keyframes[i].duration)
  }
  return times
}

function fmtNum(n: number, decimals = 3) {
  return n.toFixed(decimals)
}

// ── Export modal ──────────────────────────────────────────────────────────────
function ExportModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
    }}>
      <div style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
        width: 680, maxWidth: "90vw", padding: 20,
        display: "flex", flexDirection: "column", gap: 12,
        font: FONT,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: C.heading, fontWeight: 700, fontSize: 13 }}>Export Cutscene Code</span>
          <button style={btn("ghost")} onClick={onClose}>✕</button>
        </div>
        <textarea
          readOnly
          value={code}
          rows={18}
          style={{
            background: C.bgInput, border: `1px solid ${C.border}`, borderRadius: 4,
            color: "#c8c0ff", font: "12px/1.6 'SF Mono', monospace",
            padding: 12, resize: "vertical", outline: "none", width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn("accent")} onClick={copy}>
            {copied ? "✓ Copied!" : "Copy to clipboard"}
          </button>
          <button style={btn()} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Timeline component ────────────────────────────────────────────────────────
function Timeline({
  keyframes,
  selectedId,
  scrubTime,
  totalDuration,
  onSelectKf,
  onUpdateKf,
  onScrub,
}: {
  keyframes:     Keyframe[]
  selectedId:    string | null
  scrubTime:     number
  totalDuration: number
  onSelectKf:    (id: string) => void
  onUpdateKf:    (id: string, patch: Partial<Keyframe>) => void
  onScrub:       (t: number) => void
}) {
  const trackRef    = useRef<HTMLDivElement>(null)
  const dragState   = useRef<{
    kfId: string
    startClientX: number
    startDuration: number
  } | null>(null)

  const kfTimes = getKeyframeTimes(keyframes)

  const timeToPercent = (t: number) =>
    totalDuration > 0 ? (t / totalDuration) * 100 : 0

  // Tick marks
  const tickInterval = totalDuration < 3 ? 0.5 : 1
  const ticks: number[] = []
  if (totalDuration > 0) {
    for (let t = 0; t <= totalDuration + 0.001; t += tickInterval) {
      ticks.push(parseFloat(t.toFixed(2)))
    }
  }

  // Keyframe drag handlers
  const onMarkerMouseDown = useCallback((e: React.MouseEvent, kfId: string, dur: number, index: number) => {
    if (index === 0) return // first keyframe not draggable
    e.stopPropagation()
    e.preventDefault()
    dragState.current = { kfId, startClientX: e.clientX, startDuration: dur }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current || !trackRef.current) return
      const trackWidth = trackRef.current.getBoundingClientRect().width
      const deltaX = e.clientX - dragState.current.startClientX
      const deltaTime = (deltaX / trackWidth) * totalDuration
      const newDuration = Math.max(0.1, dragState.current.startDuration + deltaTime)
      onUpdateKf(dragState.current.kfId, { duration: newDuration })
    }
    const onUp = () => { dragState.current = null }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [totalDuration, onUpdateKf])

  const onTrackClick = (e: React.MouseEvent) => {
    if (!trackRef.current || totalDuration <= 0) return
    const rect = trackRef.current.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onScrub(frac * totalDuration)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Track area */}
      <div
        ref={trackRef}
        onClick={onTrackClick}
        style={{
          position: "relative",
          height: 72,
          background: "#0a0a18",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          cursor: "crosshair",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {/* Tick marks + labels */}
        {ticks.map(t => (
          <div key={t} style={{
            position: "absolute",
            left: `${timeToPercent(t)}%`,
            top: 0,
            height: "100%",
            borderLeft: `1px solid ${C.border}`,
            pointerEvents: "none",
          }}>
            <span style={{
              position: "absolute",
              top: 2,
              left: 2,
              color: C.muted,
              fontSize: 8,
              whiteSpace: "nowrap",
            }}>
              {t.toFixed(1)}s
            </span>
          </div>
        ))}

        {/* Horizontal track line */}
        <div style={{
          position: "absolute",
          left: 0, right: 0,
          top: "50%",
          height: 2,
          background: C.border,
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }} />

        {/* Keyframe diamonds */}
        {keyframes.map((kf, i) => {
          const pct = timeToPercent(kfTimes[i])
          const isSelected = kf.id === selectedId
          const isDraggable = i > 0
          return (
            <div
              key={kf.id}
              title={kf.label || `Frame ${i + 1}`}
              onMouseDown={e => onMarkerMouseDown(e, kf.id, kf.duration, i)}
              onClick={e => { e.stopPropagation(); onSelectKf(kf.id) }}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: "50%",
                transform: "translate(-50%, -50%) rotate(45deg)",
                width:  isSelected ? 14 : 10,
                height: isSelected ? 14 : 10,
                background: isSelected ? C.accentHi : C.accent,
                border:     `2px solid ${isSelected ? "#fff" : C.borderHi}`,
                borderRadius: 2,
                cursor: isDraggable ? "ew-resize" : "pointer",
                zIndex: 2,
                boxShadow: isSelected ? `0 0 8px ${C.accentHi}` : "none",
                transition: "width 0.1s, height 0.1s",
              }}
            />
          )
        })}

        {/* Index labels below diamonds */}
        {keyframes.map((kf, i) => {
          const pct = timeToPercent(kfTimes[i])
          return (
            <div
              key={`lbl_${kf.id}`}
              style={{
                position: "absolute",
                left: `${pct}%`,
                bottom: 4,
                transform: "translateX(-50%)",
                color: kf.id === selectedId ? C.accentHi : C.muted,
                fontSize: 8,
                pointerEvents: "none",
              }}
            >
              {i + 1}
            </div>
          )
        })}

        {/* Playhead */}
        {scrubTime >= 0 && totalDuration > 0 && (
          <div style={{
            position: "absolute",
            left: `${timeToPercent(scrubTime)}%`,
            top: 0,
            height: "100%",
            width: 2,
            background: C.red,
            pointerEvents: "none",
            zIndex: 3,
          }}>
            <div style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: `6px solid ${C.red}`,
            }} />
          </div>
        )}
      </div>

      {/* Scrub slider */}
      {totalDuration > 0 && (
        <input
          type="range"
          min={0}
          max={totalDuration}
          step={0.01}
          value={scrubTime >= 0 ? scrubTime : 0}
          style={{ width: "100%", accentColor: C.red, cursor: "pointer" }}
          onChange={e => onScrub(parseFloat(e.target.value))}
        />
      )}

      {/* Time display */}
      <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 10 }}>
        <span>{scrubTime >= 0 ? scrubTime.toFixed(1) : "0.0"}s</span>
        <span>{totalDuration.toFixed(1)}s total</span>
      </div>
    </div>
  )
}

// ── Selected keyframe detail panel ────────────────────────────────────────────
function KfDetailPanel({
  kf,
  index,
  total,
  onUpdate,
  onDelete,
  onMove,
  onGoto,
}: {
  kf:       Keyframe
  index:    number
  total:    number
  onUpdate: (patch: Partial<Keyframe>) => void
  onDelete: () => void
  onMove:   (dir: "up" | "down") => void
  onGoto:   () => void
}) {
  const [copiedPos, setCopiedPos] = useState(false)
  const [labelVal, setLabelVal]   = useState(kf.label)

  useEffect(() => { setLabelVal(kf.label) }, [kf.label])

  const copyPos = () => {
    const code = `initialCameraPosition={[${kf.position.join(", ")}]}`
    navigator.clipboard.writeText(code).then(() => {
      setCopiedPos(true); setTimeout(() => setCopiedPos(false), 1500)
    })
  }

  const vec3Row = (
    label: string,
    value: [number, number, number],
    key: "position" | "lookAt"
  ) => (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
      <span style={{ color: C.muted, width: 32, flexShrink: 0, fontSize: 10 }}>{label}</span>
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <div key={axis} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ color: C.muted, fontSize: 8, textAlign: "center" }}>{axis}</span>
          <input
            type="number"
            step="0.1"
            value={value[i]}
            style={{ ...inputStyle(), textAlign: "center", fontSize: 10 }}
            onKeyDown={trapKeys}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const next = [...value] as [number, number, number]
              next[i] = parseFloat(e.target.value) || 0
              onUpdate({ [key]: next })
            }}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.borderHi}`,
      borderRadius: 5,
      padding: "10px 10px",
    }}>
      {/* Label row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: C.muted, fontSize: 10, width: 32, flexShrink: 0 }}>
          #{index + 1}
        </span>
        <input
          type="text"
          value={labelVal}
          placeholder={`Frame ${index + 1}`}
          style={{ ...inputStyle(), flex: 1 }}
          onKeyDown={trapKeys}
          onChange={e => setLabelVal(e.target.value)}
          onBlur={() => onUpdate({ label: labelVal })}
        />
      </div>

      {vec3Row("pos",  kf.position, "position")}
      {vec3Row("look", kf.lookAt,   "lookAt")}

      {/* Duration */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: C.muted, fontSize: 10, width: 52, flexShrink: 0 }}>duration</span>
        <input
          type="range" min={0} max={15} step={0.1}
          value={kf.duration}
          style={{ flex: 1, accentColor: C.accent }}
          onChange={e => onUpdate({ duration: parseFloat(e.target.value) })}
        />
        <span style={{ color: C.text, fontSize: 11, width: 36, textAlign: "right" }}>
          {kf.duration.toFixed(1)}s
        </span>
      </div>

      {/* Easing */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: C.muted, fontSize: 10, width: 52, flexShrink: 0 }}>easing</span>
        <select
          value={kf.easing}
          style={{ ...inputStyle(), flex: 1, cursor: "pointer" }}
          onKeyDown={trapKeys}
          onChange={e => onUpdate({ easing: e.target.value as EasingType })}
        >
          <option value="linear">Linear</option>
          <option value="easeIn">Ease In</option>
          <option value="easeOut">Ease Out</option>
          <option value="easeInOut">Ease In-Out</option>
        </select>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button style={{ ...btn("accent"), flex: 1 }} onClick={onGoto}>
          ▶ Fly Here
        </button>
        <button style={btn()} disabled={index === 0}         onClick={() => onMove("up")}>↑</button>
        <button style={btn()} disabled={index === total - 1} onClick={() => onMove("down")}>↓</button>
        <button style={btn("danger")} onClick={onDelete} title="Delete keyframe">🗑</button>
      </div>

      <button
        style={{ ...btn("ghost"), marginTop: 6, fontSize: 10, width: "100%", textAlign: "left" }}
        onClick={copyPos}
      >
        {copiedPos ? "✓ Copied!" : "📋 Copy pos as initialCameraPosition"}
      </button>
    </div>
  )
}

// ── Live camera display ───────────────────────────────────────────────────────
function LiveCamDisplay({
  liveCamRef,
  livePlayerRef,
  isFreeCam,
}: {
  liveCamRef:    React.MutableRefObject<{ x: number; y: number; z: number; pitch: number; yaw: number }>
  livePlayerRef: React.MutableRefObject<{ x: number; y: number; z: number } | null>
  isFreeCam:     boolean
}) {
  const [cam, setCam]       = useState({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0 })
  const [player, setPlayer] = useState<{ x: number; y: number; z: number } | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const tick = () => {
      setCam({ ...liveCamRef.current })
      setPlayer(livePlayerRef.current ? { ...livePlayerRef.current } : null)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [liveCamRef, livePlayerRef])

  const toDeg = (r: number) => ((r * 180) / Math.PI).toFixed(1)

  return (
    <div style={{
      background: isFreeCam ? "#0a1220" : C.bgCard,
      border: `1px solid ${isFreeCam ? "#2244aa" : C.border}`,
      borderRadius: 4,
      padding: "7px 10px",
      fontSize: 10,
      fontFamily: "'SF Mono', 'Fira Code', monospace",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Camera row */}
      <div>
        <div style={{ color: isFreeCam ? "#6699ff" : C.muted, fontWeight: 700, marginBottom: 3, fontSize: 9, letterSpacing: 1 }}>
          CAMERA {isFreeCam ? "· FREE CAM ACTIVE" : "· LIVE"}
        </div>
        <div style={{ display: "flex", gap: 12, color: C.text }}>
          <span><span style={{ color: C.muted }}>X </span>{cam.x.toFixed(3)}</span>
          <span><span style={{ color: C.muted }}>Y </span>{cam.y.toFixed(3)}</span>
          <span><span style={{ color: C.muted }}>Z </span>{cam.z.toFixed(3)}</span>
        </div>
        <div style={{ display: "flex", gap: 12, color: C.text, marginTop: 2 }}>
          <span><span style={{ color: C.muted }}>Pitch </span>{toDeg(cam.pitch)}°</span>
          <span><span style={{ color: C.muted }}>Yaw </span>{toDeg(cam.yaw)}°</span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${C.border}` }} />

      {/* Player row */}
      <div>
        <div style={{ color: "#77cc88", fontWeight: 700, marginBottom: 3, fontSize: 9, letterSpacing: 1 }}>
          CHARACTER · LIVE
        </div>
        {player ? (
          <div style={{ display: "flex", gap: 12, color: C.text }}>
            <span><span style={{ color: C.muted }}>X </span>{player.x.toFixed(3)}</span>
            <span><span style={{ color: C.muted }}>Y </span>{player.y.toFixed(3)}</span>
            <span><span style={{ color: C.muted }}>Z </span>{player.z.toFixed(3)}</span>
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 10 }}>waiting…</div>
        )}
      </div>
    </div>
  )
}

// ── Camera Zones section ──────────────────────────────────────────────────────
function ZonesSection({ ctx }: { ctx: ReturnType<typeof useCutsceneContext> }) {
  const [collapsed, setCollapsed] = useState(false)
  const sel = ctx.zones.find(z => z.id === ctx.selectedZoneId) ?? null

  const captureZone = () => {
    const player = ctx.livePlayerRef.current
    const cam    = ctx.liveCamRef.current
    if (!player) { alert("Character position not available yet — start the game first."); return }
    if (!ctx.isFreeCameraMode) { alert("Enable Free Camera first, position the camera, then capture."); return }

    // Compute a lookAt point 20 units along the camera's forward direction
    const fwdX = Math.sin(cam.yaw) * Math.cos(cam.pitch)
    const fwdY = Math.sin(-cam.pitch)
    const fwdZ = Math.cos(cam.yaw) * Math.cos(cam.pitch)
    const lookAt: [number, number, number] = [
      parseFloat((cam.x + fwdX * 20).toFixed(3)),
      parseFloat((cam.y + fwdY * 20).toFixed(3)),
      parseFloat((cam.z + fwdZ * 20).toFixed(3)),
    ]

    const zone: CameraZone = {
      id:              `zone_${Date.now()}`,
      name:            `Zone ${ctx.zones.length + 1}`,
      triggerPosition: [
        parseFloat(player.x.toFixed(3)),
        parseFloat(player.y.toFixed(3)),
        parseFloat(player.z.toFixed(3)),
      ],
      radius:          3,
      cameraPosition:  [
        parseFloat(cam.x.toFixed(3)),
        parseFloat(cam.y.toFixed(3)),
        parseFloat(cam.z.toFixed(3)),
      ],
      cameraLookAt:    lookAt,
      blendTime:       0.5,
      priority:        0,
      enabled:         true,
    }
    ctx.createZone(zone)
  }

  return (
    <div>
      {/* Section header */}
      <div
        onClick={() => setCollapsed(p => !p)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", marginBottom: collapsed ? 0 : 6,
        }}
      >
        <div style={{ color: C.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 }}>
          📷 Camera Zones · {ctx.zones.length}
          {ctx.activeZoneId && (
            <span style={{ color: "#33ff88", marginLeft: 6 }}>● ACTIVE</span>
          )}
        </div>
        <span style={{ color: C.muted, fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Capture button */}
          <button
            style={{ ...btn("ok"), width: "100%", padding: "5px 0", fontSize: 11 }}
            onClick={captureZone}
            title="Capture character position + current free-cam angle as a new zone"
          >
            + Capture Zone Here
          </button>
          {!ctx.isFreeCameraMode && (
            <div style={{ color: C.muted, fontSize: 10, textAlign: "center" }}>
              Enable Free Camera first, aim the shot, then capture.
            </div>
          )}

          {/* Zone list */}
          {ctx.zones.length === 0 && (
            <div style={{ color: C.muted, fontSize: 10, textAlign: "center", padding: "8px 0" }}>
              No zones yet.
            </div>
          )}

          {ctx.zones.map(z => (
            <div
              key={z.id}
              onClick={() => ctx.selectZone(z.id)}
              style={{
                background:   z.id === ctx.selectedZoneId ? "#0f0f24" : C.bgCard,
                border:       `1px solid ${z.id === ctx.activeZoneId ? "#33ff88" : z.id === ctx.selectedZoneId ? C.borderHi : C.border}`,
                borderRadius: 4,
                padding:      "6px 8px",
                cursor:       "pointer",
                display:      "flex",
                alignItems:   "center",
                gap:          6,
              }}
            >
              {/* Enable toggle */}
              <input
                type="checkbox"
                checked={z.enabled}
                onChange={e => { e.stopPropagation(); ctx.updateZone(z.id, { enabled: e.target.checked }) }}
                style={{ cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ flex: 1, color: z.id === ctx.activeZoneId ? "#33ff88" : C.text, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {z.name}
              </span>
              <span style={{ color: C.muted, fontSize: 9 }}>r={z.radius}m</span>
              <button
                style={{ ...btn("danger"), padding: "1px 5px", fontSize: 10 }}
                onClick={e => { e.stopPropagation(); ctx.deleteZone(z.id) }}
              >✕</button>
            </div>
          ))}

          {/* Selected zone detail */}
          {sel && (
            <ZoneDetail
              key={sel.id}
              zone={sel}
              onUpdate={patch => ctx.updateZone(sel.id, patch)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ZoneDetail({ zone, onUpdate }: {
  zone:     CameraZone
  onUpdate: (patch: Partial<CameraZone>) => void
}) {
  const [nameVal, setNameVal] = useState(zone.name)
  useEffect(() => setNameVal(zone.name), [zone.name])

  const vec3Row = (label: string, value: [number, number, number], key: "triggerPosition" | "cameraPosition" | "cameraLookAt") => (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
      <span style={{ color: C.muted, width: 36, flexShrink: 0, fontSize: 10 }}>{label}</span>
      {(["X","Y","Z"] as const).map((axis, i) => (
        <div key={axis} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ color: C.muted, fontSize: 8, textAlign: "center" }}>{axis}</span>
          <input
            type="number" step="0.1"
            value={value[i]}
            style={{ ...inputStyle(), textAlign: "center", fontSize: 10 }}
            onKeyDown={trapKeys}
            onChange={e => {
              const next = [...value] as [number, number, number]
              next[i] = parseFloat(e.target.value) || 0
              onUpdate({ [key]: next })
            }}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.borderHi}`, borderRadius: 4, padding: "8px 10px" }}>
      {/* Name */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="text" value={nameVal}
          style={{ ...inputStyle(), width: "100%" }}
          onKeyDown={trapKeys}
          onChange={e => setNameVal(e.target.value)}
          onBlur={() => onUpdate({ name: nameVal })}
        />
      </div>

      {vec3Row("trigger", zone.triggerPosition, "triggerPosition")}
      {vec3Row("cam pos", zone.cameraPosition,  "cameraPosition")}
      {vec3Row("look at", zone.cameraLookAt,    "cameraLookAt")}

      {/* Radius */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: C.muted, fontSize: 10, width: 52, flexShrink: 0 }}>radius</span>
        <input type="range" min={0.5} max={20} step={0.5}
          value={zone.radius}
          style={{ flex: 1, accentColor: C.accent }}
          onChange={e => onUpdate({ radius: parseFloat(e.target.value) })}
        />
        <span style={{ color: C.text, fontSize: 11, width: 36, textAlign: "right" }}>{zone.radius}m</span>
      </div>

      {/* Blend time */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: C.muted, fontSize: 10, width: 52, flexShrink: 0 }}>blend</span>
        <input type="range" min={0} max={3} step={0.1}
          value={zone.blendTime}
          style={{ flex: 1, accentColor: C.accent }}
          onChange={e => onUpdate({ blendTime: parseFloat(e.target.value) })}
        />
        <span style={{ color: C.text, fontSize: 11, width: 36, textAlign: "right" }}>{zone.blendTime.toFixed(1)}s</span>
      </div>

      {/* Priority */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: C.muted, fontSize: 10, width: 52, flexShrink: 0 }}>priority</span>
        <input type="number" min={0} max={99} step={1}
          value={zone.priority}
          style={{ ...inputStyle(), width: 50, textAlign: "center" }}
          onKeyDown={trapKeys}
          onChange={e => onUpdate({ priority: parseInt(e.target.value) || 0 })}
        />
        <span style={{ color: C.muted, fontSize: 10 }}>higher wins when zones overlap</span>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function CutsceneEditorPanel() {
  const ctx = useCutsceneContext()

  // Panel drag
  const [pos, setPos] = useState({ x: 20, y: 20 })
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") setPos({ x: window.innerWidth - 460, y: 20 })
  }, [])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }
    e.preventDefault()
  }, [pos])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return
      setPos({ x: drag.current.px + e.clientX - drag.current.sx,
               y: drag.current.py + e.clientY - drag.current.sy })
    }
    const onUp = () => { drag.current = null }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup",   onUp)
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
  }, [])

  // New cutscene input
  const [newName, setNewName] = useState("")
  const [showNewInput, setShowNewInput] = useState(false)

  // Rename state
  const [renameVal, setRenameVal] = useState("")
  useEffect(() => {
    if (ctx.activeCutscene) setRenameVal(ctx.activeCutscene.name)
  }, [ctx.activeCutscene?.id])

  // Export state
  const [exportCode, setExportCode] = useState("")

  // Scrub time (local display, also writes ctx.scrubTimeRef)
  const [scrubTime, setScrubTime] = useState(-1)
  const handleScrub = useCallback((t: number) => {
    setScrubTime(t)
    ctx.setScrubTime(t)
  }, [ctx])

  // Clear scrub when playback starts
  useEffect(() => {
    if (ctx.isPlaying) {
      setScrubTime(-1)
      ctx.setScrubTime(-1)
    }
  }, [ctx.isPlaying])

  const kfs          = ctx.activeCutscene?.keyframes ?? []
  const totalDuration = kfs.reduce((sum, kf, i) => i === 0 ? sum : sum + kf.duration, 0)
  const selectedKf    = kfs.find(kf => kf.id === ctx.selectedKeyframeId) ?? null
  const selectedIdx   = kfs.findIndex(kf => kf.id === ctx.selectedKeyframeId)

  const handleExport = () => setExportCode(ctx.exportCode())

  // ── Toggle button (always visible when closed) ────────────────────────────
  if (!ctx.isEditorOpen) {
    return (
      <button
        onClick={ctx.toggleEditor}
        style={{
          position: "fixed", bottom: 20, right: 20,
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 8, color: C.text, cursor: "pointer",
          font: FONT, padding: "8px 14px", zIndex: 9000,
          display: "flex", alignItems: "center", gap: 6,
        }}
        title="Open Cutscene Editor"
      >
        🎬 <span style={{ fontSize: 11 }}>Cutscene Editor</span>
      </button>
    )
  }

  // ── Full panel ─────────────────────────────────────────────────────────────
  return (
    <>
      <div
        style={{
          position:   "fixed",
          left:       pos.x,
          top:        pos.y,
          width:      440,
          maxHeight:  "calc(100vh - 40px)",
          background: C.bg,
          border:     `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow:  "0 8px 32px rgba(0,0,0,0.7)",
          display:    "flex",
          flexDirection: "column",
          zIndex:     9000,
          font:       FONT,
          color:      C.text,
          overflow:   "hidden",
        }}
      >
        {/* ── HEADER (drag handle) ── */}
        <div
          onMouseDown={onHeaderMouseDown}
          style={{
            background:  "#0a0a18",
            borderBottom: `1px solid ${C.border}`,
            cursor:      "grab",
            display:     "flex",
            alignItems:  "center",
            justifyContent: "space-between",
            padding:     "8px 12px",
            flexShrink:  0,
          }}
        >
          <span style={{ color: C.heading, fontWeight: 700, fontSize: 13 }}>
            🎬 Cutscene Editor
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Free cam works without a cutscene selected — handy for just looking around */}
            <button
              style={btn(ctx.isFreeCameraMode ? "accent" : "ghost")}
              onClick={() => ctx.setFreeCameraMode(!ctx.isFreeCameraMode)}
              title="Fly the camera freely: WASD to move, E/Q up/down, drag to look, scroll for speed"
            >
              {ctx.isFreeCameraMode ? "🎥 Exit Free Cam" : "🎥 Free Cam"}
            </button>
            <button style={btn("ghost")} onClick={ctx.toggleEditor}>✕</button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* ── SECTION 1: Scene Selector ── */}
          <div>
            {sectionLabel("Cutscene")}

            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select
                value={ctx.activeCutsceneId ?? ""}
                style={{ ...inputStyle(), flex: 1 }}
                onKeyDown={trapKeys}
                onChange={e => ctx.selectCutscene(e.target.value || null)}
              >
                <option value="">— select —</option>
                {ctx.cutscenes.map(cs => (
                  <option key={cs.id} value={cs.id}>{cs.name}</option>
                ))}
              </select>

              <button
                style={btn("accent")}
                onClick={() => setShowNewInput(p => !p)}
                title="Create new cutscene"
              >
                + New
              </button>

              {ctx.activeCutscene && (
                <button
                  style={btn("danger")}
                  title="Delete cutscene"
                  onClick={() => { if (confirm("Delete this cutscene?")) ctx.deleteCutscene(ctx.activeCutsceneId!) }}
                >
                  🗑
                </button>
              )}
            </div>

            {/* New cutscene inline input */}
            {showNewInput && (
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  style={{ ...inputStyle(), flex: 1 }}
                  placeholder="New cutscene name…"
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter" && newName.trim()) {
                      ctx.createCutscene(newName.trim())
                      setNewName("")
                      setShowNewInput(false)
                    }
                    if (e.key === "Escape") setShowNewInput(false)
                  }}
                  onChange={e => setNewName(e.target.value)}
                />
                <button
                  style={btn("ok")}
                  onClick={() => {
                    if (newName.trim()) {
                      ctx.createCutscene(newName.trim())
                      setNewName("")
                      setShowNewInput(false)
                    }
                  }}
                >
                  ✓
                </button>
                <button style={btn()} onClick={() => setShowNewInput(false)}>✕</button>
              </div>
            )}

            {/* Rename active cutscene */}
            {ctx.activeCutscene && (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={renameVal}
                  style={{ ...inputStyle(), flex: 1 }}
                  placeholder="Rename cutscene…"
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") ctx.renameCutscene(ctx.activeCutsceneId!, renameVal)
                  }}
                  onChange={e => setRenameVal(e.target.value)}
                  onBlur={() => ctx.renameCutscene(ctx.activeCutsceneId!, renameVal)}
                />
              </div>
            )}
          </div>

          {/* ── SECTION 2: Camera + character status ── */}
          <LiveCamDisplay
            liveCamRef={ctx.liveCamRef}
            livePlayerRef={ctx.livePlayerRef}
            isFreeCam={ctx.isFreeCameraMode}
          />

          {/* ── SECTION 3: Capture controls ── */}
          {ctx.activeCutscene && (
            <div>
              {sectionLabel("Capture")}

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ ...btn(ctx.isFreeCameraMode ? "accent" : "ghost"), flex: 1 }}
                  onClick={() => ctx.setFreeCameraMode(!ctx.isFreeCameraMode)}
                >
                  {ctx.isFreeCameraMode ? "🎥 Free Cam ON" : "🎥 Free Cam"}
                </button>

                <button
                  style={{ ...btn("ok"), flex: 1 }}
                  disabled={!ctx.isFreeCameraMode}
                  title={ctx.isFreeCameraMode ? "Capture current view as a keyframe" : "Enable Free Camera first"}
                  onClick={ctx.requestCapture}
                >
                  📷 Capture Frame
                </button>
              </div>

              {ctx.isFreeCameraMode && (
                <div style={{
                  marginTop: 6, padding: "6px 8px",
                  background: "#0a1020", borderRadius: 4,
                  fontSize: 10, color: C.muted, lineHeight: 1.6,
                  border: `1px solid #1a2a50`,
                }}>
                  <strong style={{ color: "#6699ff" }}>Free Cam active</strong>
                  {" — "}WASD fly · E/Q up-down · LMB drag look · Scroll speed
                </div>
              )}
            </div>
          )}

          {/* ── SECTION 4: Timeline ── */}
          {ctx.activeCutscene && kfs.length > 0 && (
            <div>
              {sectionLabel(`Timeline · ${kfs.length} frames`)}

              <Timeline
                keyframes={kfs}
                selectedId={ctx.selectedKeyframeId}
                scrubTime={scrubTime}
                totalDuration={totalDuration}
                onSelectKf={id => ctx.selectKeyframe(id)}
                onUpdateKf={(id, patch) => ctx.updateKeyframe(id, patch)}
                onScrub={handleScrub}
              />
            </div>
          )}

          {/* ── SECTION 5: Selected keyframe detail ── */}
          {ctx.activeCutscene && kfs.length > 0 && (
            <div>
              {sectionLabel("Keyframe Detail")}

              {selectedKf ? (
                <KfDetailPanel
                  key={selectedKf.id}
                  kf={selectedKf}
                  index={selectedIdx}
                  total={kfs.length}
                  onUpdate={patch => ctx.updateKeyframe(selectedKf.id, patch)}
                  onDelete={() => ctx.deleteKeyframe(selectedKf.id)}
                  onMove={dir => ctx.moveKeyframe(selectedKf.id, dir)}
                  onGoto={() => ctx.gotoKeyframe(selectedKf)}
                />
              ) : (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 11, padding: "12px 0" }}>
                  Click a keyframe diamond to edit it.
                </div>
              )}
            </div>
          )}

          {/* ── SECTION 6: Camera Zones ── */}
          <ZonesSection ctx={ctx} />

          {/* Empty / no selection states */}
          {ctx.activeCutscene && kfs.length === 0 && (
            <div style={{ textAlign: "center", color: C.muted, fontSize: 11, padding: "16px 0" }}>
              No keyframes yet.<br />
              Enable Free Camera, position the view, then hit Capture.
            </div>
          )}

          {!ctx.activeCutscene && (
            <div style={{ textAlign: "center", color: C.muted, fontSize: 11, padding: "16px 0" }}>
              Create or select a cutscene to get started.
            </div>
          )}

        </div>

        {/* ── FOOTER ── */}
        {ctx.activeCutscene && (
          <div style={{
            borderTop: `1px solid ${C.border}`,
            padding: "8px 12px",
            display: "flex", gap: 6, alignItems: "center",
            flexShrink: 0, background: "#0a0a18",
          }}>
            <button
              style={{ ...btn(ctx.isPlaying ? "danger" : "accent"), flex: 1 }}
              disabled={kfs.length < 2}
              onClick={ctx.isPlaying ? ctx.stopPlayback : ctx.startPlayback}
            >
              {ctx.isPlaying ? "⏹ Stop" : "▶ Preview"}
            </button>

            <button style={{ ...btn("ghost"), flex: 1 }} onClick={handleExport}>
              📋 Export
            </button>

            <span style={{ color: C.muted, fontSize: 10, whiteSpace: "nowrap" }}>
              {totalDuration.toFixed(1)}s
            </span>
          </div>
        )}
      </div>

      {/* Export modal */}
      {exportCode && (
        <ExportModal code={exportCode} onClose={() => setExportCode("")} />
      )}
    </>
  )
}
