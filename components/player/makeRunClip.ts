import * as THREE from "three"

/**
 * Builds a running clip from the in-place walk cycle — griffin.glb ships no run.
 *
 * Every rotation track is exaggerated around its cycle-average pose (bigger
 * leg/arm swing), then posture offsets are layered on: bent elbows for the arm
 * pump, extra knee lift, and a forward torso lean. Hip bounce is amplified.
 *
 * `restRotations` are the bind-pose local quaternions keyed by the same bone
 * names the clip's tracks use; they tell us which way each elbow/knee bends.
 */

// Swing multiplier per bone (matched by suffix of the bone name)
const SWING: [string, number][] = [
  ["UpLeg",    1.55],
  ["Leg",      1.7],   // knee
  ["Foot",     1.4],
  ["ForeArm",  1.3],
  ["Arm",      1.9],   // shoulder swing
  ["Shoulder", 1.3],
  ["Spine2",   1.5],
  ["Spine1",   1.5],
  ["Spine",    1.5],
  ["Hips",     1.4],
  ["Neck",     0.6],   // keep the head steady
  ["Head",     0.5],
]

// Extra bend (radians) added along each joint's natural bend direction
const EXTRA_BEND: [string, number][] = [
  ["ForeArm", 1.25],   // ~70° elbow bend for the arm pump
  ["Leg",     0.35],   // higher knee carry
]

const FORWARD_LEAN = 0.16  // radians, split across the spine
const HIP_BOUNCE   = 1.9

const _q    = new THREE.Quaternion()
const _qi   = new THREE.Quaternion()
const _axis = new THREE.Vector3()

function boneKey(trackName: string) {
  return trackName.slice(0, trackName.lastIndexOf("."))
}

function matchFactor(bone: string, table: [string, number][]) {
  // Strip the rig prefix ("mixamorigLeftUpLeg" -> "LeftUpLeg")
  const b = bone.replace(/^mixamorig:?/, "").replace(/^(Left|Right)/, "")
  for (const [suffix, f] of table) if (b === suffix) return f
  return null
}

/** Scale the rotation angle of q (in place) by k. */
function scaleRotation(q: THREE.Quaternion, k: number) {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const angle = 2 * Math.acos(Math.min(1, q.w))
  const s = Math.sqrt(1 - q.w * q.w)
  if (s < 1e-6) return q.identity()
  _axis.set(q.x / s, q.y / s, q.z / s)
  return q.setFromAxisAngle(_axis, angle * k)
}

function averageQuat(values: Float32Array | number[]) {
  const n = values.length / 4
  const ref = new THREE.Quaternion(values[0], values[1], values[2], values[3])
  const sum = new THREE.Vector4()
  for (let i = 0; i < n; i++) {
    _q.fromArray(values as any, i * 4)
    const sign = _q.dot(ref) < 0 ? -1 : 1   // keep samples in one hemisphere
    sum.x += _q.x * sign; sum.y += _q.y * sign; sum.z += _q.z * sign; sum.w += _q.w * sign
  }
  return new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize()
}

export function makeRunClip(
  walk: THREE.AnimationClip,
  restRotations: Record<string, THREE.Quaternion>,
  name = "RunningGriffin",
) {
  const tracks: THREE.KeyframeTrack[] = []

  for (const track of walk.tracks) {
    const bone = boneKey(track.name)

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = Float32Array.from(track.values)
      const mean   = averageQuat(values)
      const meanI  = mean.clone().invert()
      const swing  = matchFactor(bone, SWING) ?? 1

      // Posture offset applied on top of the (exaggerated) mean pose
      const offset = new THREE.Quaternion()
      const bend = matchFactor(bone, EXTRA_BEND)
      const rest = restRotations[bone]
      if (bend && rest) {
        // Direction the joint already bends in the walk relative to bind pose
        const dir = rest.clone().invert().multiply(mean)
        if (dir.w < 0) dir.set(-dir.x, -dir.y, -dir.z, -dir.w)
        const s = Math.sqrt(1 - Math.min(1, dir.w * dir.w))
        if (s > 1e-4) offset.setFromAxisAngle(_axis.set(dir.x / s, dir.y / s, dir.z / s), bend)
      }
      const plain = bone.replace(/^mixamorig:?/, "")
      if (plain === "Spine" || plain === "Spine1" || plain === "Spine2") {
        // Mixamo spine bones bend forward about their local +X
        offset.multiply(_q.setFromAxisAngle(_axis.set(1, 0, 0), FORWARD_LEAN / 3))
      }

      for (let i = 0; i < values.length; i += 4) {
        _q.fromArray(values, i)
        _qi.copy(meanI).multiply(_q)          // delta from the cycle average
        scaleRotation(_qi, swing)
        _q.copy(mean).multiply(offset).multiply(_qi).normalize()
        _q.toArray(values, i)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(track.name, Array.from(track.times), Array.from(values)))
      continue
    }

    if (track.name.endsWith(".position") && /Hips$/.test(bone)) {
      // Amplify the vertical/lateral bounce around the average hip position
      const v = Float32Array.from(track.values)
      const n = v.length / 3
      const avg = [0, 0, 0]
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) avg[a] += v[i * 3 + a] / n
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
        v[i * 3 + a] = avg[a] + (v[i * 3 + a] - avg[a]) * HIP_BOUNCE
      }
      tracks.push(new THREE.VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(v)))
      continue
    }

    tracks.push(track.clone())
  }

  return new THREE.AnimationClip(name, walk.duration, tracks)
}

/**
 * Jump + fall clips derived from the walk cycle (griffin.glb has no jump clip).
 *
 *   JumpGriffin: neutral → tuck (knees up, thighs forward, arms raised), held
 *   FallGriffin: tuck → legs reaching down for the landing, held
 *
 * Joint directions come from the data: a knee's bend axis is the direction the
 * walk already bends it relative to the bind pose; hip flexion is the opposite
 * sense about the same axis (the leg bones' rest frames are near-identical);
 * arms raise by blending back towards the T-pose bind rotation.
 */
export function makeJumpClips(walk: THREE.AnimationClip, restRotations: Record<string, THREE.Quaternion>) {
  const plain = (bone: string) => bone.replace(/^mixamorig:?/, "")
  const bendAxis = (bone: string, mean: THREE.Quaternion) => {
    const rest = restRotations[bone]
    if (!rest) return null
    const dir = rest.clone().invert().multiply(mean)
    if (dir.w < 0) dir.set(-dir.x, -dir.y, -dir.z, -dir.w)
    const s = Math.sqrt(1 - Math.min(1, dir.w * dir.w))
    return s > 1e-4 ? new THREE.Vector3(dir.x / s, dir.y / s, dir.z / s) : null
  }

  // Knee axes, reused (negated) for the hips
  const kneeAxis: Record<string, THREE.Vector3> = {}
  for (const t of walk.tracks) {
    if (!(t instanceof THREE.QuaternionKeyframeTrack)) continue
    const bone = boneKey(t.name), p = plain(bone)
    if (p === "LeftLeg" || p === "RightLeg") {
      const ax = bendAxis(bone, averageQuat(t.values))
      if (ax) kneeAxis[p.replace("Leg", "")] = ax
    }
  }

  type Pose = (bone: string, mean: THREE.Quaternion) => THREE.Quaternion
  const pose = (knee: number, hip: number, armUp: number, elbow: number, curl: number): Pose => (bone, mean) => {
    const p = plain(bone)
    const side = p.startsWith("Left") ? "Left" : p.startsWith("Right") ? "Right" : ""
    const q = mean.clone()
    if ((p === "LeftLeg" || p === "RightLeg") && kneeAxis[side]) q.multiply(_q.setFromAxisAngle(kneeAxis[side], knee))
    if ((p === "LeftUpLeg" || p === "RightUpLeg") && kneeAxis[side]) q.multiply(_q.setFromAxisAngle(kneeAxis[side], -hip))
    if ((p === "LeftArm" || p === "RightArm") && restRotations[bone]) q.slerp(restRotations[bone], armUp)
    if (p === "LeftForeArm" || p === "RightForeArm") {
      const ax = bendAxis(bone, mean)
      if (ax) q.multiply(_q.setFromAxisAngle(ax, elbow))
    }
    if (p === "Spine" || p === "Spine1" || p === "Spine2") q.multiply(_q.setFromAxisAngle(_axis.set(1, 0, 0), curl / 3))
    return q.normalize()
  }
  const neutral = pose(0, 0, 0, 0, 0)
  const tuck    = pose(1.5, 1.1, 0.75, 0.7, 0.25)
  const reach   = pose(0.35, 0.3, 0.45, 0.4, 0.08)

  const build = (name: string, keys: [number, Pose][]) => {
    const times = keys.map(([t]) => t)
    const tracks: THREE.KeyframeTrack[] = []
    for (const t of walk.tracks) {
      const bone = boneKey(t.name)
      if (t instanceof THREE.QuaternionKeyframeTrack) {
        const mean = averageQuat(t.values)
        const vals: number[] = []
        for (const [, p] of keys) vals.push(...p(bone, mean).toArray())
        tracks.push(new THREE.QuaternionKeyframeTrack(t.name, times, vals))
      } else {
        // Positions/scales: hold the cycle average
        const n = t.getValueSize(), avg = new Array(n).fill(0), count = t.values.length / n
        for (let i = 0; i < count; i++) for (let a = 0; a < n; a++) avg[a] += t.values[i * n + a] / count
        const vals: number[] = []
        for (let i = 0; i < times.length; i++) vals.push(...avg)
        tracks.push(new THREE.VectorKeyframeTrack(t.name, times, vals))
      }
    }
    return new THREE.AnimationClip(name, times[times.length - 1], tracks)
  }

  return {
    up:   build("JumpGriffin", [[0, neutral], [0.2, tuck], [0.5, tuck]]),
    fall: build("FallGriffin", [[0, tuck], [0.35, reach], [0.45, reach]]),
  }
}
