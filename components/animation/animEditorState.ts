import * as THREE from "three"

export interface PoseKeyframe {
  time:  number
  bones: Record<string, [number, number, number, number]>  // name → [x,y,z,w]
}

/**
 * Module-level shared state between Player (Canvas) and
 * AnimationEditorPanel (HTML overlay).
 */
export const animEditorState = {
  // ── written by Player on init ────────────────────────────────────────────
  clips:    [] as string[],
  skeleton: null as THREE.Skeleton | null,

  // ── written by Player every frame ───────────────────────────────────────
  activeClip: "",
  time:       0,
  duration:   0,

  // ── preview tab: panel → Player ─────────────────────────────────────────
  playRequest: null as string | null,
  speed:       1,
  paused:      false,
  controlled:  false,        // panel owns preview animation

  // ── create tab ──────────────────────────────────────────────────────────
  createMode:        false,  // true = mixer frozen, bone gizmos visible
  selectedBoneName:  null as string | null,
  poseKeyframes:     [] as PoseKeyframe[],
  animName:          "MyAnimation",
  animDuration:      3,
  // set by panel after buildClip(); consumed + played by Player
  addClipRequest:    null as THREE.AnimationClip | null,
}
