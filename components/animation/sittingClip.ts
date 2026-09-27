import * as THREE from "three"
import poseJSON from "./sittingPose.json"

/**
 * Parse the sitting pose JSON into a reusable THREE.AnimationClip.
 * Single keyframe at t=0 → static held pose when played with LoopOnce + clampWhenFinished.
 */
let _clip: THREE.AnimationClip | null = null

export function getSittingClip(): THREE.AnimationClip {
  if (_clip) return _clip
  _clip = THREE.AnimationClip.parse(poseJSON as any)
  _clip.name = "SITTING"
  return _clip
}
