export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut"

export interface Keyframe {
  id: string
  label: string
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
  duration: number   // seconds to reach this frame FROM the previous one
  easing: EasingType
}

export interface Cutscene {
  id: string
  name: string
  keyframes: Keyframe[]
}

export interface CameraZone {
  id:              string
  name:            string
  triggerPosition: [number, number, number]  // character must be within radius
  radius:          number                    // metres
  cameraPosition:  [number, number, number]
  cameraLookAt:    [number, number, number]
  blendTime:       number                    // seconds to transition in
  priority:        number                    // highest wins when zones overlap
  enabled:         boolean
}
