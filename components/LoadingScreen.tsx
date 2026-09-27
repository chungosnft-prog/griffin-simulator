"use client"
import { useProgress } from "@react-three/drei"
import { useEffect, useState } from "react"

/** Fired by GameScene once the scene has actually rendered a few frames. */
export const SCENE_READY_EVENT = "griffin-scene-ready"

export default function LoadingScreen() {
  const { progress } = useProgress()
  const [fadeOut, setFadeOut]   = useState(false)
  const [visible, setVisible]   = useState(true)

  // Stay up until the scene is really on screen. Download progress alone isn't
  // enough: the 181 MB house still has to decode and compile shaders, and the
  // old "hide after 4 s" fallback exposed a black canvas while that happened.
  useEffect(() => {
    const hide = () => {
      setFadeOut(true)
      setTimeout(() => setVisible(false), 900)
    }
    window.addEventListener(SCENE_READY_EVENT, hide)
    // Last-resort safety net so a failed load can't trap the player behind the overlay
    const t = setTimeout(hide, 90_000)
    return () => { window.removeEventListener(SCENE_READY_EVENT, hide); clearTimeout(t) }
  }, [])

  if (!visible) return null

  // Downloads finish before the scene is ready — hold at 99% until it is
  const pct = Math.min(99, Math.round(progress))

  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        background:     "#0d0d0f",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         99999,
        opacity:        fadeOut ? 0 : 1,
        transition:     "opacity 0.9s ease",
        fontFamily:     "monospace",
        color:          "white",
        userSelect:     "none",
        pointerEvents:  fadeOut ? "none" : "all",
      }}
    >
      {/* Title */}
      <div style={{
        fontSize:      22,
        fontWeight:    700,
        letterSpacing: 6,
        marginBottom:  40,
        opacity:       0.9,
        textTransform: "uppercase",
      }}>
        Loading
      </div>

      {/* Progress bar track */}
      <div style={{
        width:        260,
        height:       3,
        background:   "rgba(255,255,255,0.1)",
        borderRadius: 2,
        overflow:     "hidden",
      }}>
        <div style={{
          height:           "100%",
          width:            `${pct}%`,
          background:       "rgba(255,255,255,0.75)",
          borderRadius:     2,
          transition:       "width 0.3s ease",
        }} />
      </div>

      {/* Percentage */}
      <div style={{
        marginTop: 14,
        fontSize:  12,
        opacity:   0.4,
        letterSpacing: 2,
      }}>
        {pct}%
      </div>
    </div>
  )
}
