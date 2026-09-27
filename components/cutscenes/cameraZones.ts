// Hardcoded camera zones exported from the editor.
// To update: open browser console → localStorage.getItem('griffin_camera_zones')

export interface CameraZoneData {
  id:              string
  name:            string
  triggerPosition: [number, number, number]
  radius:          number
  cameraPosition:  [number, number, number]
  cameraLookAt:    [number, number, number]
  blendTime:       number
  priority:        number
  enabled:         boolean
  /** Optional box trigger [x0, x1, z0, z1] (any height) — used instead of the sphere */
  bounds?:         [number, number, number, number]
  /** Optional aim in the cutscene editor's readout convention (degrees) — overrides cameraLookAt */
  pitchDeg?:       number
  yawDeg?:         number
  /** Optional vertical FOV in degrees while the zone is active (12mm full-frame ≈ 90°) */
  fov?:            number
}

export const CAMERA_ZONES: CameraZoneData[] = [
  {
    // Fixed wide shot from the corner by the bathroom door, looking at the mirror + toilet
    id:              "zone_1778121116774",
    name:            "Zone 2 (Bathroom)",
    triggerPosition: [-8.8, 1.0, -2.64],
    radius:          1,
    bounds:          [-10.01, -7.61, -3.66, -1.62],   // bathroom interior
    cameraPosition:  [-9.795, 1.669, -2.068],
    cameraLookAt:    [-9.08, 1.417, -2.72],          // fallback; pitch/yaw below take precedence
    pitchDeg:        14.6,
    yawDeg:          132.4,
    fov:             90,                              // 12mm lens
    blendTime:       0.25,
    priority:        0,
    enabled:         true,
  },
]
