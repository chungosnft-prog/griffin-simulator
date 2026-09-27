import * as THREE from 'three'

// Feature layout (20 floats):
// [0-5]   trajectory XZ positions at t+0.2s, t+0.4s, t+0.6s (relative to hips, in world XZ)
// [6-11]  trajectory XZ velocities at those same times
// [12-14] left foot position (XYZ) relative to hips
// [15-17] right foot position (XYZ) relative to hips
// [18-19] current hips velocity (XZ)
export const MM_N_FEATURES = 20

export const MM_WEIGHTS = new Float32Array([
  2, 2,  2, 2,  2, 2,     // trajectory positions (high — direction most important)
  1, 1,  1, 1,  1, 1,     // trajectory velocities
  1, 1, 1,                // left foot pos
  1, 1, 1,                // right foot pos
  0.5, 0.5,               // hips velocity
])

export interface MMFrame {
  clipName: string
  time:     number   // time within clip (seconds)
  duration: number   // clip duration (for looping)
  features: Float32Array
}

export class MotionMatcher {
  frames: MMFrame[] = []
  private built = false

  // Called once after animations load. Uses mixer setTime() to sample each clip.
  // Saves + restores all bone states so the game is unaffected.
  build(
    targetClipNames: string[],   // e.g. ["Idle", "WalkingGriffin"]
    actions: Record<string, THREE.AnimationAction>,
    mixer: THREE.AnimationMixer,
    skeleton: THREE.Skeleton,
    scene: THREE.Object3D,       // root of the GLB
  ) {
    if (this.built) return
    this.frames = []

    const HIPS  = 'mixamorigHips'
    const LFOOT = 'mixamorigLeftFoot'
    const RFOOT = 'mixamorigRightFoot'
    const hipsBone  = skeleton.getBoneByName(HIPS)
    const lFootBone = skeleton.getBoneByName(LFOOT)
    const rFootBone = skeleton.getBoneByName(RFOOT)
    if (!hipsBone || !lFootBone || !rFootBone) {
      console.warn('[MM] key bones not found')
      return
    }

    // Save ALL bone local transforms so we can restore after sampling
    const savedBones = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>()
    skeleton.bones.forEach(b => {
      savedBones.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() })
    })

    // Save mixer clock + all action times (setTime advances them all, even disabled ones)
    const savedMixerTime = (mixer as any)._time ?? 0
    const savedActionTimes = new Map<any, { time: number; weight: number; enabled: boolean }>()
    ;(mixer as any)._actions?.forEach((a: any) => {
      savedActionTimes.set(a, { time: a.time, weight: a.getEffectiveWeight(), enabled: a.enabled })
    })

    // Disable all active game actions during sampling
    const disabledActions: THREE.AnimationAction[] = []
    ;(mixer as any)._actions?.forEach((a: THREE.AnimationAction) => {
      if (a.isRunning()) { a.setEffectiveWeight(0); disabledActions.push(a) }
    })

    const SAMPLE_FPS = 15
    const SAMPLE_DT  = 1 / SAMPLE_FPS
    const TRAJ_DT    = [0.2, 0.4, 0.6]

    for (const clipName of targetClipNames) {
      const action = actions[clipName]
      if (!action) { console.warn(`[MM] clip not found: ${clipName}`); continue }
      const clip = action.getClip()

      // Reset and play just this action for sampling
      action.reset().setEffectiveWeight(1).play()

      const nSamples = Math.ceil(clip.duration / SAMPLE_DT)

      // Pass 1: collect all hips world positions for trajectory computation
      const hipsTrajectory: THREE.Vector3[] = []
      for (let fi = 0; fi < nSamples; fi++) {
        const t = fi * SAMPLE_DT
        mixer.setTime(t)
        scene.updateMatrixWorld(true)
        const p = new THREE.Vector3()
        hipsBone.getWorldPosition(p)
        hipsTrajectory.push(p.clone())
      }

      // Pass 2: build feature vectors
      for (let fi = 0; fi < nSamples; fi++) {
        const t = fi * SAMPLE_DT

        mixer.setTime(t)
        scene.updateMatrixWorld(true)

        const hipsPos  = new THREE.Vector3(); hipsBone.getWorldPosition(hipsPos)
        const lFootPos = new THREE.Vector3(); lFootBone.getWorldPosition(lFootPos)
        const rFootPos = new THREE.Vector3(); rFootBone.getWorldPosition(rFootPos)

        // Hips velocity (backward difference)
        const prevIdx  = Math.max(fi - 1, 0)
        const hipsVelX = (hipsPos.x - hipsTrajectory[prevIdx].x) / SAMPLE_DT
        const hipsVelZ = (hipsPos.z - hipsTrajectory[prevIdx].z) / SAMPLE_DT

        const features = new Float32Array(MM_N_FEATURES)

        for (let i = 0; i < 3; i++) {
          const dt = TRAJ_DT[i]
          const futureIdx = Math.round(fi + dt / SAMPLE_DT) % nSamples
          const futurePos = hipsTrajectory[futureIdx]

          // Position relative to current hips (XZ only)
          features[i * 2 + 0] = futurePos.x - hipsPos.x
          features[i * 2 + 1] = futurePos.z - hipsPos.z

          // Velocity at future point
          const prevFIdx  = Math.max(futureIdx - 1, 0)
          features[6 + i * 2 + 0] = (futurePos.x - hipsTrajectory[prevFIdx].x) / SAMPLE_DT
          features[6 + i * 2 + 1] = (futurePos.z - hipsTrajectory[prevFIdx].z) / SAMPLE_DT
        }

        // Foot positions relative to hips
        features[12] = lFootPos.x - hipsPos.x
        features[13] = lFootPos.y - hipsPos.y
        features[14] = lFootPos.z - hipsPos.z
        features[15] = rFootPos.x - hipsPos.x
        features[16] = rFootPos.y - hipsPos.y
        features[17] = rFootPos.z - hipsPos.z

        features[18] = hipsVelX
        features[19] = hipsVelZ

        this.frames.push({ clipName, time: t, duration: clip.duration, features })
      }

      action.setEffectiveWeight(0).stop()
    }

    // Restore all bone transforms
    skeleton.bones.forEach(b => {
      const s = savedBones.get(b)!
      b.position.copy(s.p); b.quaternion.copy(s.q); b.scale.copy(s.s)
    })
    scene.updateMatrixWorld(true)

    // Restore mixer clock and all action times exactly as they were
    ;(mixer as any)._time = savedMixerTime
    ;(mixer as any)._actions?.forEach((a: any) => {
      const saved = savedActionTimes.get(a)
      if (saved) {
        a.time    = saved.time
        a.enabled = saved.enabled
        a.setEffectiveWeight(saved.weight)
      }
    })

    // Re-enable game actions (belt-and-suspenders on top of the map restore)
    disabledActions.forEach(a => a.setEffectiveWeight(1))

    this.built = true
    console.log(`[MM] database built: ${this.frames.length} frames from [${targetClipNames.join(', ')}]`)
  }

  // Find best matching frame for a query feature vector.
  // Returns null if database is empty or no significantly better match exists.
  query(
    q: Float32Array,
    currentClipName: string,
    currentTime: number,
    currentCost: number,   // cost of the current frame (pass Infinity on first call)
    MIN_IMPROVEMENT = 0.75, // must be this much better than current to switch
  ): { frame: MMFrame; cost: number } | null {
    if (this.frames.length === 0) return null

    let bestCost = Infinity
    let bestFrame: MMFrame | null = null

    for (const frame of this.frames) {
      // Don't suggest nearby frames in the same clip (let it play through naturally)
      if (frame.clipName === currentClipName) {
        const dt = Math.abs(frame.time - currentTime)
        const wrap = frame.duration - dt
        if (Math.min(dt, wrap) < 0.25) continue
      }

      let cost = 0
      for (let i = 0; i < MM_N_FEATURES; i++) {
        const d = q[i] - frame.features[i]
        cost += d * d * MM_WEIGHTS[i]
      }
      if (cost < bestCost) { bestCost = cost; bestFrame = frame }
    }

    if (!bestFrame) return null
    // Only recommend if meaningfully better than current trajectory
    if (bestCost >= currentCost * MIN_IMPROVEMENT) return null
    return { frame: bestFrame, cost: bestCost }
  }

  // Build query features from current game state.
  // desiredVel = where the player WANTS to go (from input), currentVel = actual physics velocity
  buildQuery(
    currentVelX: number, currentVelZ: number,
    desiredVelX: number, desiredVelZ: number,
    lfRelX: number, lfRelY: number, lfRelZ: number,
    rfRelX: number, rfRelY: number, rfRelZ: number,
  ): Float32Array {
    const q = new Float32Array(MM_N_FEATURES)
    const TRAJ_DT = [0.2, 0.4, 0.6]

    for (let i = 0; i < 3; i++) {
      const alpha = (i + 1) / 3
      const t = TRAJ_DT[i]
      // Linearly interpolate current→desired velocity
      const vx = currentVelX + (desiredVelX - currentVelX) * alpha
      const vz = currentVelZ + (desiredVelZ - currentVelZ) * alpha
      // Predicted XZ displacement at time t (trapezoidal)
      q[i * 2 + 0] = (currentVelX + vx) * 0.5 * t
      q[i * 2 + 1] = (currentVelZ + vz) * 0.5 * t
      q[6 + i * 2 + 0] = vx
      q[6 + i * 2 + 1] = vz
    }

    q[12] = lfRelX; q[13] = lfRelY; q[14] = lfRelZ
    q[15] = rfRelX; q[16] = rfRelY; q[17] = rfRelZ
    q[18] = currentVelX
    q[19] = currentVelZ
    return q
  }

  // Compute cost of a specific frame against a query (to track "current frame cost")
  frameCost(q: Float32Array, frame: MMFrame): number {
    let cost = 0
    for (let i = 0; i < MM_N_FEATURES; i++) {
      const d = q[i] - frame.features[i]
      cost += d * d * MM_WEIGHTS[i]
    }
    return cost
  }
}
