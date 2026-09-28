/**
 * Lightweight shared state written by Player.tsx each frame,
 * read by Game.tsx for UI overlays. Avoids prop-drilling through the Canvas.
 */
export const playerState = {
  nearCouch:    false,  // near any seat (couch or office chair)
  nearSeat:     null as "couch" | "chair" | null,
  sitting:      true,   // matches Player's initial isSitting = true
  seat:         "couch" as "couch" | "chair" | null,
  drinking:     false,
  position:     { x: 0, y: 0, z: 0 },
  activeZoneId: null as string | null,
  freeMouse:    false,
  ragdoll:      false,
  ragdollEndRequest: false,  // set by Game.tsx on ESC → Player stands up to idle
  nearMirror:   false,  // standing at the bathroom sink (E → taunt)
  taunting:     false,  // ragdoll active (cursor released for grabbing, but the game keeps running)  // playing without pointer lock (lock refused) — see Game.tsx
}
