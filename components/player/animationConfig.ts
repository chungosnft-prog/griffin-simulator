// Animation system configuration
export const ANIMATION_CONFIG = {
  // Animation names to look for (in order of priority)
  IDLE:      ["Idle"],
  RUN:       ["WalkingGriffin"],
  // Fallbacks only — Player.tsx replaces these with clips derived by makeJumpClips
  JUMP_UP:   ["WalkingGriffin"],
  JUMP_DOWN: ["WalkingGriffin"],

  // Blend durations for non-IDLE transitions
  // All transitions crossfade — keep every one of these ≤ 0.5 s
  BLEND_DURATION: 0.3,
  IDLE_BLEND_DURATION: 0.25,
  JUMP_BLEND_DURATION: 0.15,

  // Animation speeds
  SPEEDS: {
    IDLE: 1.0,
    RUN:    1.3,   // walk clip, sped up to match WALK_SPEED without foot sliding
    SPRINT: 1.55,  // derived run clip (makeRunClip) at RUN_SPEED
    JUMP_UP:   1.0,
    JUMP_DOWN: 1.0,
  },

  // Special blending rules
  NEVER_BLEND_IDLE: false, // idle now crossfades like everything else (see crossTo in Player.tsx)
}
