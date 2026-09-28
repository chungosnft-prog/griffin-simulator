"use client"

import { useRef, useState, forwardRef, useImperativeHandle, useEffect } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { RigidBody, CapsuleCollider, useRapier } from "@react-three/rapier"
import { useGLTF, useAnimations, useKeyboardControls, Html } from "@react-three/drei"
import { ANIMATION_CONFIG } from "./player/animationConfig"
import { makeRunClip, makeJumpClips } from "./player/makeRunClip"
import { MotionMatcher, type MMFrame } from "./player/MotionMatcher"
import { FootstepAudio } from "./audio/FootstepAudio"
import { useCutsceneContext } from "./cutscene/CutsceneContext"
import { playerState } from "./playerState"
import { animEditorState } from "./animation/animEditorState"
import { OFFICE_CHAIR_SEAT } from "./decor/OfficeChair"
import { asset } from "./assetPath"

// Griffin character model
const MODEL_URL = asset("/griffin.glb")

// Clips whose hips facing was already corrected (they're cached across remounts)
const FACING_FIXED = new WeakSet<THREE.AnimationClip>()

// Preload models outside component to avoid re-loading - with error handling
if (typeof window !== "undefined") {
  try {
    useGLTF.preload(MODEL_URL)
    useGLTF.preload(asset("/beer_can.glb"))
  } catch (error) {
    console.warn("Failed to preload model:", error)
  }
}

// Define the Player component props
interface PlayerProps {
  position?: [number, number, number]
  debug?: boolean
  isPointerLocked?: boolean
}

const Player = forwardRef<any, PlayerProps>(function Player(
  { position = [-50.26, -1.9, -26.32], debug = false, isPointerLocked = false }: PlayerProps,
  ref,
) {
  // Physics reference
  const rigidBodyRef = useRef<any>(null)

  // Model group reference
  const modelGroupRef = useRef<any>(null)

  // ✅ STABLE CAR EXIT STATE - Only these two lines changed
  const [isVisible, setIsVisible] = useState(true)
  const [isPhysicsActive, setIsPhysicsActive] = useState(true)

  // Animation system refs
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({})
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const sittingActionRef = useRef<THREE.AnimationAction | null>(null)
  const lastAnimationTime = useRef<number>(0)

  // Motion matching
  const motionMatcherRef = useRef(new MotionMatcher())
  const mmFrameCountRef  = useRef(0)
  const mmCurrentCost    = useRef(Infinity)
  const mmLastSwitch     = useRef(0)
  const mmCurrentFrame   = useRef<MMFrame | null>(null)

  // ── Beer can ─────────────────────────────────────────────────────────────
  const beerCanRef    = useRef<THREE.Object3D | null>(null)
  // Array of every can that has been thrown — they persist in the scene forever
  const thrownCansRef = useRef<Array<{
    obj: THREE.Object3D
    startPos: THREE.Vector3
    startTime: number
    done: boolean
    landPos: THREE.Vector3
  }>>([])
  const canThrownRef   = useRef(false)   // has THIS session's throw happened?
  const canKeysRef    = useRef<Set<string>>(new Set())
  const canLastLog    = useRef(0)

  const THROW_FRAME_TIME = 270 / 30   // ~9.0 s into the animation clip
  const THROW_DURATION   = 1.2        // seconds for the arc
  const CARPET_LAND_POS  = new THREE.Vector3(-7.434, 0.1, 0.726)

  // ── Wall flip ────────────────────────────────────────────────────────────
  const wallFlip    = useRef({ active: false, startTime: 0, duration: 1.6 })
  const lastMoveDir = useRef(new THREE.Vector3(0, 0, 1))

  // ── Ragdoll (PBD — pure Three.js, no Rapier bodies) ──────────────────────
  const ragdollActive    = useRef(false)
  const ragdollStartTime = useRef(0)
  const rWasDown         = useRef(false)
  // Capsule frozen while ragdoll is active (stays dynamic body — no setBodyType)
  const ragdollFrozenCapsulePos = useRef<{ x: number; y: number; z: number } | null>(null)

  // PBD particles: one per key joint in world space
  const ragParticles = useRef<Array<{ pos: THREE.Vector3; prevPos: THREE.Vector3; radius: number }>>([])
  const ragRestPos   = useRef<THREE.Vector3[]>([])                  // particle world positions at rest
  const ragRestBoneQ = useRef<Map<string, THREE.Quaternion>>(new Map()) // bone world-Q at rest
  const ragRestLens  = useRef<number[]>([])                         // constraint rest lengths
  const ragDragIdx   = useRef(-1)                                   // index of particle being dragged

  // Mouse drag
  const ragGrabActive  = useRef(false)
  const ragDragPlane   = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const ragDragTarget  = useRef<THREE.Vector3 | null>(null)
  const ragDragHistory = useRef<Array<{ x: number; y: number; z: number; t: number }>>([])
  const ragCameraRef   = useRef<THREE.Camera | null>(null)

  // ── Talking jaw (mixamorig:Jaw, added by scripts/rig_jaw.py) ──────────────
  const jawRestQ    = useRef<THREE.Quaternion | null>(null)   // bind rotation, from the GLB
  const talkAmt     = useRef(0)                                // 0..1, eased
  const _jawQ       = useRef(new THREE.Quaternion())
  const JAW_AXIS    = new THREE.Vector3(1, 0, 0)               // bone-local hinge (+ = open)
  const JAW_OPEN    = 0.3                                      // max opening, radians (~17°)

  const ragMinLens = useRef<number[]>([])   // anti-fold minimum lengths (RAG_MIN_DEF)
  const ragAccum   = useRef(0)              // fixed-step time accumulator
  const RAG_H       = 1 / 120               // physics substep (s) — independent of frame rate
  const RAG_GRAVITY = 0                     // weightless: he floats/tumbles and can be dragged around
  const RAG_THRUST  = 7                     // m/s² from WASD/SPACE/SHIFT while floating (drag caps it ≈ 6 m/s)

  // ── PBD ragdoll definitions ──────────────────────────────────────────────
  // Particles: bone name + collision radius (world-space units after model scale)
  const RAG_P_DEF = [
    { bone: 'mixamorigHips',         r: 0.16 },  // 0  hips
    { bone: 'mixamorigSpine2',       r: 0.16 },  // 1  chest
    { bone: 'mixamorigHead',         r: 0.13 },  // 2  head
    { bone: 'mixamorigRightArm',     r: 0.09 },  // 3  R shoulder
    { bone: 'mixamorigRightForeArm', r: 0.07 },  // 4  R elbow
    { bone: 'mixamorigRightHand',    r: 0.06 },  // 5  R hand
    { bone: 'mixamorigLeftArm',      r: 0.09 },  // 6  L shoulder
    { bone: 'mixamorigLeftForeArm',  r: 0.07 },  // 7  L elbow
    { bone: 'mixamorigLeftHand',     r: 0.06 },  // 8  L hand
    { bone: 'mixamorigRightUpLeg',   r: 0.11 },  // 9  R hip
    { bone: 'mixamorigRightLeg',     r: 0.08 },  // 10 R knee
    { bone: 'mixamorigRightFoot',    r: 0.08 },  // 11 R foot
    { bone: 'mixamorigLeftUpLeg',    r: 0.11 },  // 12 L hip
    { bone: 'mixamorigLeftLeg',      r: 0.08 },  // 13 L knee
    { bone: 'mixamorigLeftFoot',     r: 0.08 },  // 14 L foot
  ]
  // Distance constraints: [particleA, particleB]
  const RAG_C_DEF = [
    [0,1],[1,2],                     // spine
    [1,3],[3,4],[4,5],               // R arm
    [1,6],[6,7],[7,8],               // L arm
    [0,9],[9,10],[10,11],            // R leg
    [0,12],[12,13],[13,14],          // L leg
    [3,6],[9,12],                    // shoulder-shoulder, hip-hip (lateral stability)
    [0,3],[0,6],                     // hips → shoulders (torso rigidity)
    [2,3],[2,6],                     // head ↔ shoulders (neck doesn't flop)
    [1,9],[1,12],[3,9],[6,12],       // torso box: chest/shoulders ↔ hips
    [3,12],[6,9],                    // torso diagonals (no shearing)
  ] as [number,number][]
  // Anti-fold constraints: [a, b, min fraction of rest length]. Only push apart,
  // so knees/elbows/spine can bend but never collapse flat into a heap.
  const RAG_MIN_DEF = [
    [9,11,0.55],[12,14,0.55],        // hip ↔ foot (knee bend limit)
    [3,5,0.45],[6,8,0.45],           // shoulder ↔ hand (elbow bend limit)
    [0,2,0.8],                       // hips ↔ head (spine can't fold in half)
    [1,10,0.55],[1,13,0.55],         // chest ↔ knees (no jack-knifing)
  ] as [number,number,number][]
  // Bone driving: [boneName, fromParticleIdx, toParticleIdx, isRoot?]
  // Each bone is oriented so it points from 'from' particle toward 'to' particle
  const RAG_BONE_DRIVE = [
    { bone: 'mixamorigHips',         from: 0,  to: 1,  isRoot: true  },
    { bone: 'mixamorigSpine',        from: 0,  to: 1  },
    { bone: 'mixamorigSpine1',       from: 0,  to: 1  },
    { bone: 'mixamorigSpine2',       from: 0,  to: 1  },
    { bone: 'mixamorigNeck',         from: 1,  to: 2  },
    { bone: 'mixamorigHead',         from: 1,  to: 2  },
    { bone: 'mixamorigRightArm',     from: 3,  to: 4  },
    { bone: 'mixamorigRightForeArm', from: 4,  to: 5  },
    { bone: 'mixamorigLeftArm',      from: 6,  to: 7  },
    { bone: 'mixamorigLeftForeArm',  from: 7,  to: 8  },
    { bone: 'mixamorigRightUpLeg',   from: 9,  to: 10 },
    { bone: 'mixamorigRightLeg',     from: 10, to: 11 },
    { bone: 'mixamorigLeftUpLeg',    from: 12, to: 13 },
    { bone: 'mixamorigLeftLeg',      from: 13, to: 14 },
  ]

  // ✅ NEW: Audio system
  const footstepAudioRef = useRef<FootstepAudio | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)

  // Animation state
  const [currentAnimation, setCurrentAnimation] = useState<string>("IDLE")
  const [isGrounded, setIsGrounded] = useState<boolean>(true)

  // Camera-related state
  const [cameraDirection, setCameraDirection] = useState(new THREE.Vector3(0, 0, -1))
  const [cameraQuaternion, setCameraQuaternion] = useState(new THREE.Quaternion())

  // Ground normal for slope-based jumping
  const groundNormalRef = useRef(new THREE.Vector3(0, 1, 0))

  // Collision counter to track ground contacts
  const collisionCountRef = useRef(0)

  // Performance optimization: Frame throttling
  const frameCount = useRef(0)
  const lastGroundCheck = useRef(0)

  // ✅ NEW: Debug logging state
  const debugState = useRef({
    lastLogTime: 0,
    logInterval: 0.5, // Log every 0.5 seconds
  })

  // ✅ IMPROVED: Enhanced ground detection state
  const groundDetection = useRef({
    // Collision-based detection
    collisionGrounded: false,
    collisionHistory: [] as boolean[],

    // Velocity-based detection
    velocityHistory: [] as number[],
    stableVelocityFrames: 0,

    // Position-based detection
    positionHistory: [] as { y: number; time: number }[],
    lastSignificantHeightChange: 0,

    // Combined state
    confidenceScore: 0,
    lastGroundedConfirmation: 0,

    // Thresholds
    STABLE_VELOCITY_THRESHOLD: 0.5,
    SIGNIFICANT_HEIGHT_THRESHOLD: 0.3,
    CONFIDENCE_THRESHOLD: 0.7,
    HISTORY_SIZE: 10,
  })

  // ✅ IMPROVED: Terrain traversal state with better detection
  const terrainState = useRef({
    lastYPosition: 0,
    yVelocityHistory: [] as number[],
    isTraversingTerrain: false,
    terrainChangeThreshold: 0.2, // Reduced threshold for more sensitive detection
    consecutiveTerrainFrames: 0,
    TERRAIN_CONFIRMATION_FRAMES: 3, // Need multiple frames to confirm terrain traversal
  })

  // Jump state tracking - CRITICAL FOR JUMP FUNCTIONALITY
  const jumpState = useRef({
    canJump: true,
    lastGroundedTime: 0,
    isInJumpProcess: false,
    jumpPeakReached: false,
    previousVelocityY: 0,
    spaceWasReleased: true,
    lastJumpTime: 0,
    jumpCount: 0,
    maxJumps: 2,
    framesOnGround: 0,
    airtimeStart: null as number | null, // NEW: Track when character became airborne
    forcedJumpAnimation: false, // NEW: Track if we forced a jump animation
  })

  // ── Sitting ──────────────────────────────────────────────────────────────
  // Every sittable spot. `pos` is where the capsule is pinned while seated,
  // `stand` is where it's placed on standing up.
  const SEATS = {
    couch: {
      pos:    { x: -4.546, y: 1.065, z: 0.349 },
      radius: 1.4,   // metres — just slightly larger than the couch model
      facing: 0,     // capsule faces the TV (+Z) — all clips now face the capsule's forward
      stand:  { x: -4.959, y: 0.627, z: 1.088 },
    },
    chair: {
      pos:    { x: OFFICE_CHAIR_SEAT.x, y: 1.065, z: OFFICE_CHAIR_SEAT.z + 0.08 },   // nudged forward off the backrest
      radius: 0.85,
      facing: 0,     // faces the desk (+Z)
      stand:  { x: OFFICE_CHAIR_SEAT.x, y: 0.627, z: OFFICE_CHAIR_SEAT.z - 0.8 },
    },
  } as const
  type SeatId = keyof typeof SEATS

  // Bathroom mirror: stand on the bath mat, press E → taunt at the reflection
  const MIRROR_SPOT   = { x: -8.785, z: -2.72 }
  const MIRROR_RADIUS = 0.8
  const MIRROR_FACING = Math.PI            // face -Z, towards the mirror over the sink
  const nearMirrorRef = useRef(false)
  const tauntRef      = useRef({ active: false, step: 0 })
  // Both mirror taunts back to back, the pair looped 3 times
  const TAUNT_SEQUENCE = ["TAUNT_1", "TAUNT_2", "TAUNT_1", "TAUNT_2", "TAUNT_1", "TAUNT_2"]
  const TAUNT_BLEND    = 0.3
  // Keep him out of the mirror (plane at z≈-3.585) and the sink (front edge z≈-3.02).
  // Upper body may lean over the basin; hips/feet stay clear of the pedestal.
  const MIRROR_KEEPOUT: [string, number][] = [
    ["mixamorigHead", -3.45], ["mixamorigLeftHand", -3.45], ["mixamorigRightHand", -3.45], ["mixamorigSpine2", -3.3],
    ["mixamorigHips", -2.9], ["mixamorigLeftFoot", -2.85], ["mixamorigRightFoot", -2.85],
  ]
  const TAUNT_START_Z  = -2.5   // start each taunt at least this far back from the sink
  const _keepoutV      = useRef(new THREE.Vector3())
  const activeSeatRef = useRef<SeatId>("couch")   // game starts on the couch
  const nearSeatRef   = useRef<SeatId | null>(null)

  const [isSitting, setIsSitting] = useState(true)
  const sittingRef                = useRef(true)
  const nearCouchRef              = useRef(false)
  const eWasDown                  = useRef(false)
  const fWasDown                  = useRef(false)
  const drinkingRef               = useRef(false)

  // Y offsets so both seated animations line up on the couch
  const SIT_Y = -1.0   // model group Y offset while seated
  const STAND_Y = -0.6 // model group Y offset while standing
  const MODEL_EASE = 12 // 1/s — model offsets settle in ~0.25 s
  // Visual-only offset applied to the model group in drinking state (rigid body stays at COUCH_POS)
  const DRINK_OFFSET = { x: 0, y: 0, z: -0.3 }   // back into the cushions (frame of the corrected drink clip)

  useEffect(() => { sittingRef.current = isSitting }, [isSitting])

  // Stand up automatically on the first pointer lock (game start click)
  const hasStoodUpOnStart = useRef(false)
  useEffect(() => {
    if (!isPointerLocked || hasStoodUpOnStart.current) return
    if (!sittingRef.current) { hasStoodUpOnStart.current = true; return }
    hasStoodUpOnStart.current = true

    sittingRef.current = false
    setIsSitting(false)
    drinkingRef.current  = false
    playerState.drinking = false
    canThrownRef.current = false

    teleportSmooth(SEATS[activeSeatRef.current].stand)
    if (beerCanRef.current)    beerCanRef.current.visible = false
    const idleAction = actionsRef.current["IDLE"]
    if (idleAction) {
      crossTo(idleAction, 0.3)   // blends out of sit/drink too
      setCurrentAnimation("IDLE")
      lastAnimationTime.current = Date.now() / 1000
    }
  }, [isPointerLocked])

  // Constants - FIXED VALUES
  const WALK_SPEED = 2.2
  const RUN_SPEED = 4.6
  const JUMP_FORCE = 15
  const COYOTE_TIME = 0.15
  const MIN_ANIMATION_INTERVAL = 0.1
  const ROTATION_LERP_FACTOR = 0.2 // Moderate rotation smoothing

  // Keyboard controls
  const [, getKeys] = useKeyboardControls()

  // Load character model with error handling
  const [modelLoaded, setModelLoaded] = useState(false)

  // Use a state to track which model is loaded - with better error handling
  const { scene, animations, parser } = useGLTF(MODEL_URL, true) as any
  const { actions, mixer } = useAnimations(animations, scene)
  const { scene: beerCanScene } = useGLTF(asset("/beer_can.glb"))
  const { livePlayerRef, isPlaying, isFreeCameraMode } = useCutsceneContext()
  const { scene: threeScene, gl } = useThree()
  const { world: rapierWorld, rapier } = useRapier()   // ragdoll collision queries
  const cutsceneActive = isPlaying || isFreeCameraMode

  // ✅ NEW: Initialize audio system
  useEffect(() => {
    if (typeof window !== "undefined") {
      footstepAudioRef.current = new FootstepAudio()

      // Enable audio after ANY user interaction
      const enableAudio = () => {
        if (footstepAudioRef.current) {
          footstepAudioRef.current.setEnabled(true)
          console.log("🔊 Footstep audio enabled after user interaction")
        }
      }

      // Listen for multiple types of user interaction
      const events = ["click", "keydown", "touchstart", "pointerdown"]
      events.forEach((event) => {
        document.addEventListener(event, enableAudio, { once: true })
      })

      return () => {
        if (footstepAudioRef.current) {
          footstepAudioRef.current.dispose()
        }
        events.forEach((event) => {
          document.removeEventListener(event, enableAudio)
        })
      }
    }
  }, [])

  // Track model loading state
  useEffect(() => {
    if (scene) {
      setModelLoaded(true)
    }
  }, [scene])

  // Initialize animation system
  useEffect(() => {
    if (!actions || !mixer || !modelLoaded) return

    // Store mixer reference
    mixerRef.current = mixer

    // Initialize animation map
    const normalizedActions: Record<string, THREE.AnimationAction> = {}

    // Function to find the first available animation from a list of possible names
    const findAnimation = (possibleNames: string[]): THREE.AnimationAction | null => {
      for (const name of possibleNames) {
        if (actions[name]) {
          return actions[name]
        }
      }
      return null
    }

    // Find and map each animation type
    const idleAction = findAnimation(ANIMATION_CONFIG.IDLE) || Object.values(actions)[0]
    const runAction = findAnimation(ANIMATION_CONFIG.RUN) || idleAction
    const jumpUpAction = findAnimation(ANIMATION_CONFIG.JUMP_UP) || idleAction
    const jumpDownAction = findAnimation(ANIMATION_CONFIG.JUMP_DOWN) || idleAction

    // Map found animations to normalized names
    if (idleAction) {
      normalizedActions["IDLE"] = idleAction
      idleAction.setEffectiveWeight(1.0)
      idleAction.reset().play()
      currentActionRef.current = idleAction
      setCurrentAnimation("IDLE")
    }

    if (runAction) {
      normalizedActions["RUN"] = runAction
      runAction.setLoop(THREE.LoopRepeat, Infinity)
    }

    // Jaw bind rotation (the clips key it at rest; we add the talking motion on top)
    const jawNode = parser?.json?.nodes?.find((n: any) => n.name === "mixamorig:Jaw")
    jawRestQ.current = jawNode ? new THREE.Quaternion().fromArray(jawNode.rotation ?? [0, 0, 0, 1]) : null

    // Sprint: griffin.glb has no run clip, so derive one from the walk cycle
    const walkClip = animations.find((c: THREE.AnimationClip) => ANIMATION_CONFIG.RUN.includes(c.name))
    if (walkClip && parser?.json?.nodes) {
      const rest: Record<string, THREE.Quaternion> = {}
      for (const n of parser.json.nodes) {
        if (n.name && n.rotation) {
          rest[THREE.PropertyBinding.sanitizeNodeName(n.name)] = new THREE.Quaternion().fromArray(n.rotation)
        }
      }
      const sprintAction = mixer.clipAction(makeRunClip(walkClip, rest), scene)
      sprintAction.setLoop(THREE.LoopRepeat, Infinity)
      normalizedActions["SPRINT"] = sprintAction

      // Jump + fall poses (also derived — the only flip clip is reserved for wall flips)
      const jumpClips = makeJumpClips(walkClip, rest)
      const upAction = mixer.clipAction(jumpClips.up, scene)
      upAction.setLoop(THREE.LoopOnce, 1); upAction.clampWhenFinished = true
      const fallAction = mixer.clipAction(jumpClips.fall, scene)
      fallAction.setLoop(THREE.LoopOnce, 1); fallAction.clampWhenFinished = true
      normalizedActions["JUMP_UP"] = upAction
      normalizedActions["JUMP_DOWN"] = fallAction
    }

    // Fallbacks — only if the derived jump clips above weren't built
    if (jumpUpAction && !normalizedActions["JUMP_UP"]) {
      normalizedActions["JUMP_UP"] = jumpUpAction
    }

    if (jumpDownAction && !normalizedActions["JUMP_DOWN"]) {
      normalizedActions["JUMP_DOWN"] = jumpDownAction
      jumpDownAction.setLoop(THREE.LoopOnce, 1)
      jumpDownAction.clampWhenFinished = true
    }

    // Store the normalized actions
    actionsRef.current = normalizedActions

    // Mirror taunts (bathroom) — play once, then Player returns to idle
    ;([["TAUNT_1", "Tauntmirror"], ["TAUNT_2", "TauntMirror2"]] as const).forEach(([key, clip]) => {
      const a = actions[clip]
      if (!a) return
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
      normalizedActions[key] = a
    })

    // Register Run To Flip
    const flipAction = actions["Run To Flip"]
    if (flipAction) {
      flipAction.setLoop(THREE.LoopOnce, 1)
      flipAction.clampWhenFinished = true
      normalizedActions["WALL_FLIP"] = flipAction
    }

    // Register Sitting Drinking — plays once then auto-returns to sit
    const drinkActionSrc = actions["Sitting Drinking"]
    if (drinkActionSrc) {
      drinkActionSrc.setLoop(THREE.LoopOnce, 1)
      drinkActionSrc.clampWhenFinished = false
      drinkActionSrc.timeScale = 0.9
      drinkActionSrc.setEffectiveWeight(0)
      normalizedActions["SITTING_DRINKING"] = drinkActionSrc
    }

    // Set up SittingGriffin from the GLB as a held pose
    const sitAction = actions["SittingGriffin"]
    // "Sitting Drinking" was authored facing backwards relative to every other
    // clip, and the old code spun the whole model 180° between sit and drink
    // (and seats faced the capsule backwards to match). Those spins are instant
    // while the bones crossfade, so blends turned the body through itself.
    // Turn that clip's hips 180° about the rig's up axis instead, so all clips
    // face the capsule's forward and nothing ever needs flipping.
    const sitClip = actions["Sitting Drinking"]?.getClip()
    if (sitClip && !FACING_FIXED.has(sitClip)) {
      const hips = scene.getObjectByName("mixamorigHips")
      const armature = hips?.parent
      if (armature) {
        // Up axis expressed in the armature's local frame (relative to the model root)
        const armQ = new THREE.Quaternion()
        for (let o: THREE.Object3D | null = armature; o && o !== scene.parent; o = o.parent) armQ.premultiply(o.quaternion)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(armQ.clone().invert()).normalize()
        const turn = new THREE.Quaternion().setFromAxisAngle(up, Math.PI)
        const q = new THREE.Quaternion(), v = new THREE.Vector3()
        for (const track of sitClip.tracks) {
          if (!track.name.startsWith(hips!.name + ".")) continue
          const vals = track.values
          if (track.name.endsWith(".quaternion")) {
            for (let i = 0; i < vals.length; i += 4) { q.fromArray(vals, i).premultiply(turn).toArray(vals, i) }
          } else if (track.name.endsWith(".position")) {
            for (let i = 0; i < vals.length; i += 3) { v.fromArray(vals, i).applyQuaternion(turn).toArray(vals, i) }
          }
        }
        FACING_FIXED.add(sitClip)
      }
    }
    if (sitAction) {
      sitAction.setLoop(THREE.LoopRepeat, Infinity)
      sitAction.clampWhenFinished = false
      sitAction.timeScale = 0.4
      sitAction.setEffectiveWeight(0)
      sittingActionRef.current = sitAction
    }

    // Expose ALL clip names to the animation editor
    animEditorState.clips = Object.keys(actions)


    // When the drink animation finishes, auto-return to the sitting pose
    const onFinished = (e: any) => {
      if (e.action !== actionsRef.current["SITTING_DRINKING"]) return
      if (!drinkingRef.current || !sittingRef.current) return
      drinkingRef.current  = false
      playerState.drinking = false
      const sitAct = sittingActionRef.current
      if (sitAct) {
        crossTo(sitAct, 0.4)
        setCurrentAnimation("SITTING")
      }
    }
    mixer.addEventListener("finished", onFinished)
    return () => { mixer.removeEventListener("finished", onFinished) }
  }, [actions, mixer, modelLoaded])

  // Expose skeleton so BoneGizmos / animation editor can read & manipulate it
  useEffect(() => {
    if (!scene || !modelLoaded) return
    scene.traverse((child: any) => {
      if (child.isSkinnedMesh && child.skeleton) {
        animEditorState.skeleton = child.skeleton
      }
    })
    return () => { animEditorState.skeleton = null }
  }, [scene, modelLoaded])

  // ── Attach beer can to right hand bone ───────────────────────────────────
  useEffect(() => {
    if (!scene || !modelLoaded || !beerCanScene) return

    let handBone: THREE.Object3D | null = null
    scene.traverse((child: any) => {
      if (child.isBone && child.name === "mixamorigRightHandIndex3") handBone = child
    })
    if (!handBone) return

    const can = beerCanScene.clone()
    can.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true
        child.material   = child.material.clone()
        child.material.toneMapped = false  // bypass scene's low exposure
        child.material.color.set(0xC0C0C0) // silver
        child.material.metalness  = 0.9
        child.material.roughness  = 0.15
        child.material.needsUpdate = true
      }
    })
    can.visible = false
    can.position.set(5.95, 0.7, 2.4)
    can.rotation.set(0, 0, Math.PI / 2)
    can.scale.setScalar(1.875)
    ;(handBone as THREE.Object3D).add(can)
    beerCanRef.current = can

    const onKeyDown = (e: KeyboardEvent) => canKeysRef.current.add(e.code)
    const onKeyUp   = (e: KeyboardEvent) => canKeysRef.current.delete(e.code)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup",   onKeyUp)

    return () => {
      ;(handBone as THREE.Object3D).remove(can)
      beerCanRef.current = null
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup",   onKeyUp)
    }
  }, [scene, modelLoaded, beerCanScene])

  // Remove all thrown cans from the scene on unmount
  useEffect(() => {
    return () => {
      for (const entry of thrownCansRef.current) {
        threeScene.remove(entry.obj)
      }
      thrownCansRef.current = []
    }
  }, [])

  // ── Ragdoll grab-and-throw mouse interaction ──────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement
    const raycaster = new THREE.Raycaster()

    const onMouseDown = (e: MouseEvent) => {
      if (!ragdollActive.current || !ragCameraRef.current || !scene) return
      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        -((e.clientY - rect.top)  / rect.height) *  2 + 1,
      )
      raycaster.setFromCamera(mouse, ragCameraRef.current)

      const meshes: THREE.Object3D[] = []
      scene.traverse((child: any) => { if (child.isMesh) meshes.push(child) })
      const hits = raycaster.intersectObjects(meshes, true)
      if (hits.length === 0) return

      e.stopPropagation()
      ragGrabActive.current = true

      // Find the PBD particle closest to the hit point
      const hp = hits[0].point
      let closestIdx  = -1
      let closestDist = Infinity
      for (let i = 0; i < ragParticles.current.length; i++) {
        const d = hp.distanceTo(ragParticles.current[i].pos)
        if (d < closestDist) { closestDist = d; closestIdx = i }
      }
      ragDragIdx.current = closestIdx

      // Drag plane faces camera, anchored at hit point
      const camDir = new THREE.Vector3()
      ragCameraRef.current.getWorldDirection(camDir)
      ragDragPlane.current.setFromNormalAndCoplanarPoint(camDir, hp)

      ragDragTarget.current  = hp.clone()
      ragDragHistory.current = []
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!ragGrabActive.current || !ragCameraRef.current) return
      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        -((e.clientY - rect.top)  / rect.height) *  2 + 1,
      )
      raycaster.setFromCamera(mouse, ragCameraRef.current)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(ragDragPlane.current, hit)) return
      // Near-parallel drag planes put the hit point kilometres away and flung the body off —
      // keep the target within reach of the camera
      const camPos = ragCameraRef.current.position
      if (hit.distanceTo(camPos) > 12) hit.sub(camPos).setLength(12).add(camPos)

      ragDragTarget.current = hit
      ragDragHistory.current.push({ x: hit.x, y: hit.y, z: hit.z, t: performance.now() })
      if (ragDragHistory.current.length > 6) ragDragHistory.current.shift()
    }

    const onMouseUp = () => {
      if (!ragGrabActive.current) return
      ragGrabActive.current = false

      // Apply throw velocity to the grabbed particle via Verlet prevPos offset
      const idx = ragDragIdx.current
      if (idx >= 0 && idx < ragParticles.current.length) {
        const hist = ragDragHistory.current
        if (hist.length >= 2) {
          const a  = hist[0]
          const b  = hist[hist.length - 1]
          const dt = Math.max((b.t - a.t) / 1000, 0.016)
          const THROW_SCALE = 0.06
          const p = ragParticles.current[idx]
          p.prevPos.x = p.pos.x - ((b.x - a.x) / dt) * THROW_SCALE
          p.prevPos.y = p.pos.y - ((b.y - a.y) / dt) * THROW_SCALE
          p.prevPos.z = p.pos.z - ((b.z - a.z) / dt) * THROW_SCALE
        }
      }
      ragDragIdx.current    = -1
      ragDragTarget.current = null
    }

    canvas.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove",  onMouseMove)
    window.addEventListener("mouseup",    onMouseUp)
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove",  onMouseMove)
      window.removeEventListener("mouseup",    onMouseUp)
    }
  }, [gl, scene])

  // Ensure model supports proper lighting and shadows
  useEffect(() => {
    if (!scene || !modelLoaded) return

    scene.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        // Skinned-mesh bounds don't follow the bones — once the ragdoll was dragged
        // away from the parked capsule, three culled the body as "off screen".
        child.frustumCulled = false

        // Convert basic material to standard if needed for proper lighting
        if (child.material && child.material.type === "MeshBasicMaterial") {
          const oldMat = child.material
          child.material = new THREE.MeshStandardMaterial({
            map:         oldMat.map,
            color:       oldMat.color,
            roughness:   0.8,
            metalness:   0.1,
            transparent: false,
            depthWrite:  true,
            side:        THREE.FrontSide,
          })
          child.material.needsUpdate = true
        }

        // Ensure standard materials have proper settings + no unwanted transparency
        if (child.material && child.material.type === "MeshStandardMaterial") {
          child.material.roughness   = child.material.roughness || 0.8
          child.material.metalness   = child.material.metalness || 0.1
          child.material.transparent = false
          child.material.alphaTest   = 0
          child.material.depthWrite  = true
          child.material.side        = THREE.FrontSide
          child.material.needsUpdate = true
        }
      }
    })
  }, [scene, modelLoaded])

  // ✅ STABLE EFFECTS for car exit
  useEffect(() => {
    if (modelGroupRef.current) {
      modelGroupRef.current.visible = isVisible
    }
  }, [isVisible])

  useEffect(() => {
    if (rigidBodyRef.current) {
      rigidBodyRef.current.setEnabled(isPhysicsActive)
    }
  }, [isPhysicsActive])

  // ── Model offset easing ───────────────────────────────────────────────
  // The model group carries per-state offsets (seated height, drink lean).
  // Ease towards them instead of snapping, so they blend with the animation.
  const easeModelGroup = (dt: number) => {
    const g = modelGroupRef.current
    if (!g) return
    const seated = sittingRef.current
    const tx = seated && drinkingRef.current ? DRINK_OFFSET.x : 0
    const ty = seated ? SIT_Y + (drinkingRef.current ? DRINK_OFFSET.y : 0) : STAND_Y
    const tz = seated && drinkingRef.current ? DRINK_OFFSET.z : 0
    const k = 1 - Math.exp(-MODEL_EASE * dt)
    g.position.x += (tx - g.position.x) * k
    g.position.y += (ty - g.position.y) * k
    g.position.z += (tz - g.position.z) * k
    let ry = g.rotation.y
    ry = Math.atan2(Math.sin(ry), Math.cos(ry))   // shortest way back to 0
    g.rotation.y = ry - ry * k
  }

  /**
   * Teleport the capsule (sit/stand) without the model popping: keep the model
   * where it was on screen by offsetting the model group, then easeModelGroup
   * glides it into place.
   */
  const teleportSmooth = (pos: { x: number; y: number; z: number }, yaw?: number) => {
    const rb = rigidBodyRef.current, g = modelGroupRef.current
    if (!rb) return
    const oldP = rb.translation(), oldR = rb.rotation()
    const oldQ = new THREE.Quaternion(oldR.x, oldR.y, oldR.z, oldR.w)
    const oldYaw = 2 * Math.atan2(oldQ.y, oldQ.w)
    rb.setTranslation(pos, true)
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true)
    let newQ = oldQ, newYaw = oldYaw
    if (yaw !== undefined) {
      newQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0))
      rb.setRotation({ x: newQ.x, y: newQ.y, z: newQ.z, w: newQ.w }, true)
      newYaw = yaw
    }
    if (!g) return
    // Move the body's visual object now too — Rapier only syncs it on its next
    // step, and for that one frame the offset below would be applied twice (a flash)
    const body = g.parent
    if (body) {
      body.position.set(pos.x, pos.y, pos.z)
      body.quaternion.copy(newQ)
      body.updateMatrixWorld()
    }
    // world position the model group had → local offset under the new capsule transform
    const world = g.position.clone().applyQuaternion(oldQ).add(new THREE.Vector3(oldP.x, oldP.y, oldP.z))
    g.position.copy(world.sub(new THREE.Vector3(pos.x, pos.y, pos.z)).applyQuaternion(newQ.clone().invert()))
    g.rotation.y += oldYaw - newYaw
  }

  // ── Crossfade helper: every animation change goes through here ─────────
  // Fades `next` in from 0 while fading out everything else that's still
  // contributing, so the pose always blends (≤ 0.5 s) instead of snapping.
  const crossTo = (next: THREE.AnimationAction, duration: number = ANIMATION_CONFIG.BLEND_DURATION, syncFrom?: THREE.AnimationAction | null) => {
    const d = Math.min(0.5, Math.max(0.05, duration))
    const all = new Set<THREE.AnimationAction>([
      ...Object.values(actions ?? {}).filter(Boolean) as THREE.AnimationAction[],
      ...Object.values(actionsRef.current),
    ])
    if (sittingActionRef.current) all.add(sittingActionRef.current)
    next.reset()
    // Same-cycle clips (walk ↔ run) continue at the same point in the stride
    // instead of restarting, so switching speed doesn't hitch the legs
    if (syncFrom && syncFrom !== next) {
      const phase = (syncFrom.time % syncFrom.getClip().duration) / syncFrom.getClip().duration
      next.time = phase * next.getClip().duration
    }
    next.enabled = true
    next.setEffectiveWeight(1)
    next.play()
    next.fadeIn(d)
    all.forEach((a) => {
      if (a !== next && a.isRunning() && a.getEffectiveWeight() > 0.001) a.fadeOut(d)
    })
    currentActionRef.current = next
  }

  // Animation playback — always crossfaded (idle included) via crossTo
  const playAnimation = (animName: string, speedFactor?: number, loop = true, blendDuration?: number) => {
    if (!mixerRef.current || !actionsRef.current || !modelLoaded) return

    // Rate limit animation changes
    const now = Date.now() / 1000
    if (now - lastAnimationTime.current < MIN_ANIMATION_INTERVAL) {
      return
    }

    // Don't interrupt if same animation is requested
    if (currentAnimation === animName && currentActionRef.current?.isRunning()) {
      return
    }

    // Default settings
    if (speedFactor === undefined) {
      speedFactor = (ANIMATION_CONFIG.SPEEDS as Record<string, number>)[animName] || 1.0
    }

    // CRITICAL FIX: Set JUMP_DOWN to not loop
    if (animName === "JUMP_DOWN") {
      loop = false
    }

    const newAction = actionsRef.current[animName]
    if (!newAction) {
      return
    }

    // Set loop mode + repetitions explicitly
    if (loop) {
      newAction.setLoop(THREE.LoopRepeat, Infinity)
      newAction.clampWhenFinished = false
    } else {
      newAction.setLoop(THREE.LoopOnce, 1)
      newAction.clampWhenFinished = true
    }
    newAction.timeScale = speedFactor!

    // Idle transitions get a short blend; jumps a snappier one
    const isIdleTransition = animName === "IDLE" || currentAnimation === "IDLE"
    if (blendDuration === undefined) {
      blendDuration = animName.includes("JUMP")
        ? ANIMATION_CONFIG.JUMP_BLEND_DURATION
        : isIdleTransition ? ANIMATION_CONFIG.IDLE_BLEND_DURATION : ANIMATION_CONFIG.BLEND_DURATION
    }
    const LOCOMOTION = ["RUN", "SPRINT"]
    const sync = LOCOMOTION.includes(animName) && LOCOMOTION.includes(currentAnimation) ? currentActionRef.current : null
    crossTo(newAction, blendDuration, sync)

    currentActionRef.current = newAction
    setCurrentAnimation(animName)
    lastAnimationTime.current = now
  }

  // Expose methods to parent components
  // NEW: Add a new ref to store the player's respawn position.
  const respawnPosition = useRef<THREE.Vector3 | null>(null)

  useImperativeHandle(ref, () => ({
    getRigidBody:  () => rigidBodyRef.current,
    // While ragdolled the camera follows the floating body (hips), not the parked capsule
    translation:   () => (ragdollActive.current && ragParticles.current[0])
      ? { x: ragParticles.current[0].pos.x, y: ragParticles.current[0].pos.y - 0.4, z: ragParticles.current[0].pos.z }
      : rigidBodyRef.current?.translation() || { x: 0, y: 0, z: 0 },
    nearCouch:     () => nearCouchRef.current,
    sitting:       () => sittingRef.current,
    rotation: () => rigidBodyRef.current?.rotation() || { x: 0, y: 0, z: 0, w: 1 },
    updateCameraInfo: (direction: THREE.Vector3, quaternion: THREE.Quaternion) => {
      setCameraDirection(direction.clone())
      setCameraQuaternion(quaternion.clone())
    },
    // ✅ NEW: Audio controls
    setFootstepVolume: (volume: number) => {
      if (footstepAudioRef.current) {
        footstepAudioRef.current.setVolume(volume)
      }
    },
    toggleFootsteps: () => {
      setAudioEnabled((prev) => {
        const newState = !prev
        if (footstepAudioRef.current) {
          footstepAudioRef.current.setEnabled(newState)
        }
        return newState
      })
    },
    // ✅ STABLE CAR EXIT - Only this function changed
    toggleVisibility: (visible: boolean, position?: THREE.Vector3) => {
      console.log("🎭 Player toggleVisibility:", visible, position)
      setIsVisible(visible)
      setIsPhysicsActive(visible)
      if (visible && position) {
        respawnPosition.current = new THREE.Vector3(position.x, position.y, position.z)
      }
    },
  }))

  // ✅ COMPLETELY REWRITTEN: Advanced ground detection system
  const checkGrounded = (currentPos: any, currentVel: any, currentTime: number) => {
    const gd = groundDetection.current

    // 1. COLLISION-BASED DETECTION (Primary)
    const collisionGrounded = collisionCountRef.current > 0
    gd.collisionGrounded = collisionGrounded

    // Track collision history
    gd.collisionHistory.push(collisionGrounded)
    if (gd.collisionHistory.length > gd.HISTORY_SIZE) {
      gd.collisionHistory.shift()
    }

    // 2. VELOCITY-BASED DETECTION (Secondary)
    gd.velocityHistory.push(currentVel.y)
    if (gd.velocityHistory.length > gd.HISTORY_SIZE) {
      gd.velocityHistory.shift()
    }

    // Check for stable velocity (indicates ground contact)
    const avgVelocity = gd.velocityHistory.reduce((sum, vel) => sum + Math.abs(vel), 0) / gd.velocityHistory.length
    const isStableVelocity = avgVelocity < gd.STABLE_VELOCITY_THRESHOLD

    if (isStableVelocity) {
      gd.stableVelocityFrames++
    } else {
      gd.stableVelocityFrames = 0
    }

    // 3. POSITION-BASED DETECTION (Tertiary)
    gd.positionHistory.push({ y: currentPos.y, time: currentTime })
    if (gd.positionHistory.length > gd.HISTORY_SIZE) {
      gd.positionHistory.shift()
    }

    // Check for significant height changes
    if (gd.positionHistory.length >= 2) {
      const heightChange = Math.abs(currentPos.y - gd.positionHistory[gd.positionHistory.length - 2].y)
      if (heightChange > gd.SIGNIFICANT_HEIGHT_THRESHOLD) {
        gd.lastSignificantHeightChange = currentTime
      }
    }

    // 4. CONFIDENCE SCORING SYSTEM
    let confidence = 0

    // Collision confidence (highest weight)
    if (collisionGrounded) {
      confidence += 0.6
    }

    // Stable velocity confidence
    if (gd.stableVelocityFrames >= 3) {
      confidence += 0.3
    }

    // No recent height changes confidence
    if (currentTime - gd.lastSignificantHeightChange > 0.1) {
      confidence += 0.1
    }

    // Velocity direction confidence (not falling fast)
    if (currentVel.y > -2.0) {
      confidence += 0.1
    }

    // Historical collision confidence
    const recentCollisions = gd.collisionHistory.slice(-5).filter(Boolean).length
    if (recentCollisions >= 3) {
      confidence += 0.2
    }

    gd.confidenceScore = confidence

    // 5. FINAL DETERMINATION
    const isGroundedByConfidence = confidence >= gd.CONFIDENCE_THRESHOLD

    // 6. SPECIAL CASES - OVERRIDE SYSTEM
    // If we're clearly falling fast, definitely not grounded
    if (currentVel.y < -5.0 && !collisionGrounded) {
      return false
    }

    // If we just jumped and are moving upward, definitely not grounded
    if (jumpState.current.isInJumpProcess && currentVel.y > 1.0) {
      return false
    }

    // If we have collision contact, we're probably grounded
    if (collisionGrounded && Math.abs(currentVel.y) < 3.0) {
      gd.lastGroundedConfirmation = currentTime
      return true
    }

    // Use confidence-based determination
    if (isGroundedByConfidence) {
      gd.lastGroundedConfirmation = currentTime
    }

    return isGroundedByConfidence
  }

  // ✅ IMPROVED: Better terrain traversal detection
  const checkTerrainTraversal = (currentPos: any, currentVel: any) => {
    const ts = terrainState.current

    // Track Y position changes
    const heightChange = Math.abs(currentPos.y - ts.lastYPosition)
    ts.lastYPosition = currentPos.y

    // Track Y velocity for terrain traversal detection
    ts.yVelocityHistory.push(currentVel.y)
    if (ts.yVelocityHistory.length > 5) {
      ts.yVelocityHistory.shift()
    }

    // Calculate average Y velocity change
    const avgYVelocityChange =
      ts.yVelocityHistory.length > 1
        ? Math.abs(
            ts.yVelocityHistory.reduce((sum, val, i, arr) => {
              if (i === 0) return 0
              return sum + Math.abs(val - arr[i - 1])
            }, 0) /
              (ts.yVelocityHistory.length - 1),
          )
        : 0

    // Determine if we're traversing terrain
    const isTraversingNow =
      heightChange < ts.terrainChangeThreshold &&
      avgYVelocityChange < 0.3 &&
      Math.abs(currentVel.y) < 1.5 &&
      currentVel.y > -2.0 // Not falling too fast

    // Require multiple consecutive frames to confirm terrain traversal
    if (isTraversingNow) {
      ts.consecutiveTerrainFrames++
    } else {
      ts.consecutiveTerrainFrames = 0
    }

    ts.isTraversingTerrain = ts.consecutiveTerrainFrames >= ts.TERRAIN_CONFIRMATION_FRAMES

    return ts.isTraversingTerrain
  }

  // ── Create PBD ragdoll — sample bone world positions into particles ─────────
  const createRagdoll = () => {
    const sk = animEditorState.skeleton
    if (!sk) return

    // Force world-matrix update so getWorldPosition() returns the CURRENT animated pose,
    // not stale data (useFrame runs before Three.js renderer calls updateMatrixWorld).
    scene.updateMatrixWorld(true)

    ragParticles.current = []
    ragRestPos.current   = []
    ragRestBoneQ.current.clear()
    ragRestLens.current  = []

    ragMinLens.current = []
    ragAccum.current   = 0

    const wp = new THREE.Vector3()
    for (const def of RAG_P_DEF) {
      const bone = sk.getBoneByName(def.bone)
      if (bone) bone.getWorldPosition(wp)
      else wp.set(0, 0, 0)
      ragParticles.current.push({ pos: wp.clone(), prevPos: wp.clone(), radius: def.r })
      ragRestPos.current.push(wp.clone())
    }

    for (const drive of RAG_BONE_DRIVE) {
      const bone = sk.getBoneByName(drive.bone)
      if (bone) {
        const q = new THREE.Quaternion()
        bone.getWorldQuaternion(q)
        ragRestBoneQ.current.set(drive.bone, q.clone())
      }
    }

    for (const [a, b] of RAG_C_DEF) {
      ragRestLens.current.push(
        ragParticles.current[a].pos.distanceTo(ragParticles.current[b].pos)
      )
    }
    for (const [a, b, frac] of RAG_MIN_DEF) {
      ragMinLens.current.push(ragParticles.current[a].pos.distanceTo(ragParticles.current[b].pos) * frac)
    }

    // Gentle topple: push the upper body (m/s), feet stay planted so he tips over
    const angle = Math.random() * Math.PI * 2
    const push  = [1.3, 1.5, 1.6, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 0.3, 0.1, 0, 0.3, 0.1, 0]
    ragParticles.current.forEach((p, i) => {
      const v = push[i] ?? 0
      p.prevPos.x -= Math.cos(angle) * v * RAG_H
      p.prevPos.z -= Math.sin(angle) * v * RAG_H
    })
  }

  // ── Destroy PBD ragdoll — clear particles + reset pose ──────────────────
  const destroyRagdoll = () => {
    ragParticles.current  = []
    ragRestPos.current    = []
    ragRestBoneQ.current.clear()
    ragRestLens.current   = []
    ragDragIdx.current    = -1
    ragGrabActive.current = false
    ragDragTarget.current = null

    // No setBodyType — capsule stays dynamic throughout
    if (rigidBodyRef.current) {
      rigidBodyRef.current.setEnabledRotations(false, true, false, true)
      rigidBodyRef.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    if (modelGroupRef.current) {
      modelGroupRef.current.rotation.set(0, 0, 0)
      modelGroupRef.current.position.set(0, -0.6, 0)
    }
  }

  // Handle player movement and physics
  useFrame((state, delta) => {
    ragCameraRef.current = state.camera   // keep camera ref fresh for drag handler

    // ✅ STABLE TELEPORT LOGIC - Only this section changed
    if (respawnPosition.current) {
      rigidBodyRef.current.setTranslation(respawnPosition.current, true)
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      respawnPosition.current = null
      return
    }

    // ✅ GUARD for inactive physics - Only this guard added
    if (!isPhysicsActive || !rigidBodyRef.current || !modelLoaded) return

    // Always write position so debug overlay and zone system stay up to date
    const _p = rigidBodyRef.current.translation()
    playerState.position.x = _p.x
    playerState.position.y = _p.y
    playerState.position.z = _p.z

    // drei's useAnimations already advances the mixer every frame — updating it
    // here too made every animation play at double speed. Just freeze it via
    // timeScale in rig-edit mode / during ragdoll (the bones are driven manually).
    if (mixerRef.current) {
      mixerRef.current.timeScale = animEditorState.createMode || ragdollActive.current ? 0 : 1
    }
    if (!ragdollActive.current && !animEditorState.createMode) easeModelGroup(delta)

    // ── Talking: hold T (and he trash-talks while taunting at the mirror) ──
    // Runs after drei's mixer update, so it layers on top of whatever clip is playing.
    {
      const jaw = animEditorState.skeleton?.getBoneByName("mixamorigJaw")
      if (jaw && jawRestQ.current && !ragdollActive.current && !animEditorState.createMode) {
        const talking = (isPointerLocked && !!(getKeys() as any).talk) || tauntRef.current.active
        talkAmt.current = THREE.MathUtils.damp(talkAmt.current, talking ? 1 : 0, 10, delta)
        // Syllable rhythm: two detuned oscillators, rectified so the mouth rests shut between them
        const t = state.clock.elapsedTime
        const flap = Math.max(0, 0.6 * Math.sin(t * 13) + 0.45 * Math.sin(t * 7.3 + 1.7))
        const open = Math.min(1, flap) * talkAmt.current * JAW_OPEN
        jaw.quaternion.copy(jawRestQ.current).multiply(_jawQ.current.setFromAxisAngle(JAW_AXIS, open))
      }
    }

    // ── Animation editor: write playback state, handle requests ──────────
    if (currentActionRef.current) {
      animEditorState.activeClip = currentActionRef.current.getClip().name
      animEditorState.time       = currentActionRef.current.time
      animEditorState.duration   = currentActionRef.current.getClip().duration
    }
    if (animEditorState.controlled) {
      // Handle a new clip request from the panel
      if (animEditorState.playRequest) {
        const raw = actions[animEditorState.playRequest]
        if (raw) {
          if (currentActionRef.current && currentActionRef.current !== raw) {
            currentActionRef.current.fadeOut(0.2)
          }
          raw.reset().setEffectiveWeight(1).setEffectiveTimeScale(animEditorState.speed).fadeIn(0.2).play()
          currentActionRef.current = raw
        }
        animEditorState.playRequest = null
      }
      // Speed / pause changes
      if (currentActionRef.current) {
        currentActionRef.current.setEffectiveTimeScale(
          animEditorState.paused ? 0 : animEditorState.speed
        )
      }
      // Hand control back to game if editor released
      return
    }

    // ── Add a freshly-built animation clip from the create tab ────────────
    if (animEditorState.addClipRequest) {
      const clip = animEditorState.addClipRequest
      animEditorState.addClipRequest = null
      if (mixerRef.current) {
        const action = mixerRef.current.clipAction(clip)
        if (currentActionRef.current) currentActionRef.current.fadeOut(0.2)
        action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(0.2).play()
        currentActionRef.current = action
        // Make available in the preview clip list
        if (!animEditorState.clips.includes(clip.name))
          animEditorState.clips = [...animEditorState.clips, clip.name]
      }
    }

    // Get keyboard input - only process if pointer is locked
    const keys = getKeys()
    const { forward, backward, left, right, jump, sprint } = keys as any
    const interactDown = !!(keys as any).interact
    const rDown        = isPointerLocked && !!(keys as any).ragdoll

    // ── Ragdoll (R toggles) ───────────────────────────────────────────────
    const rPressed   = rDown && !rWasDown.current
    const endRagdoll = ragdollActive.current && (rPressed || playerState.ragdollEndRequest)
    playerState.ragdollEndRequest = false
    if (rPressed && !ragdollActive.current) {
      ragdollActive.current    = true
      playerState.ragdoll      = true   // set before unlocking so Game.tsx keeps playing (no "Click to play")
      ragdollStartTime.current = state.clock.elapsedTime
      document.exitPointerLock()   // free the cursor so the user can grab

      // Stand up from couch if sitting
      if (sittingRef.current) { sittingRef.current = false; setIsSitting(false) }
      drinkingRef.current  = false
      playerState.drinking = false

      // ── ISOLATE: stop every animation so nothing overwrites bone poses ──
      // Stopping actions makes three restore the bind (T) pose, which the
      // ragdoll then sampled — the visible snap. Snapshot the live pose first
      // and put it straight back, so he goes limp exactly as he was.
      const sk0 = animEditorState.skeleton
      const pose = sk0?.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const)
      if (mixerRef.current) mixerRef.current.stopAllAction()
      for (const action of Object.values(actionsRef.current)) action.setEffectiveWeight(0)
      if (sittingActionRef.current) sittingActionRef.current.setEffectiveWeight(0)
      if (sk0 && pose) sk0.bones.forEach((b, i) => { b.position.copy(pose[i][0]); b.quaternion.copy(pose[i][1]); b.scale.copy(pose[i][2]) })

      // Snapshot capsule position so we can pin it each frame (stays dynamic, no setBodyType)
      const cp = rigidBodyRef.current?.translation()
      ragdollFrozenCapsulePos.current = cp ? { x: cp.x, y: cp.y, z: cp.z } : null

      // PBD ragdoll: safe to initialise immediately (no Rapier bodies created)
      createRagdoll()
    }
    rWasDown.current = rDown

    if (ragdollActive.current) {
      const sk        = animEditorState.skeleton
      const particles = ragParticles.current

      // ── Pin capsule in place (dynamic body — gravity would drift it without this) ──
      if (rigidBodyRef.current && ragdollFrozenCapsulePos.current) {
        const fp = ragdollFrozenCapsulePos.current
        rigidBodyRef.current.setTranslation(fp, true)
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }

      if (particles.length > 0) {
        // Collision queries go against Rapier (the same colliders the player walks
        // on), not the render meshes — far cheaper, and furniture/walls count too.
        const rb       = rigidBodyRef.current
        const floorY   = new Array<number>(particles.length)
        const ceilY    = new Array<number>(particles.length)
        const _ray     = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
        const _rayUp   = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
        // Rays start a little inside the particle's own radius. A hit at distance
        // ~0 means the ray began inside a solid (e.g. the ground box) — ignore it,
        // otherwise it reads as a floor/ceiling right at the origin and flings the particle.
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]
          const lift = p.radius * 0.5
          _ray.origin = { x: p.pos.x, y: p.pos.y + lift, z: p.pos.z }
          const hit = rapierWorld.castRay(_ray, 3, true, undefined, undefined, undefined, rb)
          floorY[i] = hit && hit.toi > 1e-3 ? p.pos.y + lift - hit.toi : -Infinity
          _rayUp.origin = { x: p.pos.x, y: p.pos.y - lift, z: p.pos.z }
          const up = rapierWorld.castRay(_rayUp, 3, true, undefined, undefined, undefined, rb)
          ceilY[i] = up && up.toi > 1e-3 ? p.pos.y - lift + up.toi : Infinity
        }

        // Zero-g thrusters: WASD (camera-relative), SPACE up, SHIFT down
        const thrust = new THREE.Vector3()
        {
          const fwd = new THREE.Vector3(); state.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
          const rightV = new THREE.Vector3(-fwd.z, 0, fwd.x)
          if (forward)  thrust.add(fwd)
          if (backward) thrust.sub(fwd)
          if (right)    thrust.add(rightV)
          if (left)     thrust.sub(rightV)
          if (jump)     thrust.y += 1
          if (sprint)   thrust.y -= 1
          if (thrust.lengthSq() > 0) thrust.normalize().multiplyScalar(RAG_THRUST)
        }

        // Fixed substeps so the fall speed doesn't depend on frame rate
        ragAccum.current = Math.min(ragAccum.current + delta, 0.1)
        const h = RAG_H
        while (ragAccum.current >= h) {
          ragAccum.current -= h

          // ── Verlet integration ──────────────────────────────────────────
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i]
            // If being dragged, ease towards the mouse target and zero velocity
            if (ragDragIdx.current === i && ragDragTarget.current) {
              p.pos.lerp(ragDragTarget.current, 0.12)
              p.prevPos.copy(p.pos)
              continue
            }
            // Air drag so he drifts to a stop instead of floating away forever
            const vx = (p.pos.x - p.prevPos.x) * 0.99
            const vy = (p.pos.y - p.prevPos.y) * 0.99
            const vz = (p.pos.z - p.prevPos.z) * 0.99
            p.prevPos.copy(p.pos)
            p.pos.x += vx + thrust.x * h * h
            p.pos.y += vy + (RAG_GRAVITY + thrust.y) * h * h
            p.pos.z += vz + thrust.z * h * h
          }

          // ── Constraints + floor, solved together each iteration ─────────
          for (let iter = 0; iter < 6; iter++) {
            for (let c = 0; c < RAG_C_DEF.length; c++) {
              const [ai, bi] = RAG_C_DEF[c]
              const pa = particles[ai], pb = particles[bi]
              const dx = pa.pos.x - pb.pos.x, dy = pa.pos.y - pb.pos.y, dz = pa.pos.z - pb.pos.z
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
              if (dist < 0.0001) continue
              const k = (dist - ragRestLens.current[c]) / dist * 0.5
              pa.pos.x -= dx * k; pa.pos.y -= dy * k; pa.pos.z -= dz * k
              pb.pos.x += dx * k; pb.pos.y += dy * k; pb.pos.z += dz * k
            }
            for (let c = 0; c < RAG_MIN_DEF.length; c++) {
              const [ai, bi] = RAG_MIN_DEF[c]
              const pa = particles[ai], pb = particles[bi]
              const dx = pa.pos.x - pb.pos.x, dy = pa.pos.y - pb.pos.y, dz = pa.pos.z - pb.pos.z
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
              const min = ragMinLens.current[c]
              if (dist >= min || dist < 0.0001) continue
              const k = (dist - min) / dist * 0.5
              pa.pos.x -= dx * k; pa.pos.y -= dy * k; pa.pos.z -= dz * k
              pb.pos.x += dx * k; pb.pos.y += dy * k; pb.pos.z += dz * k
            }
            for (let i = 0; i < particles.length; i++) {
              const p = particles[i]
              if (p.pos.y - p.radius < floorY[i]) p.pos.y = floorY[i] + p.radius
              if (p.pos.y + p.radius > ceilY[i])  p.pos.y = ceilY[i] - p.radius
            }
          }

          // ── Ground contact: no bounce, friction on sliding ──────────────
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i]
            if (p.pos.y - p.radius > floorY[i] + 0.005) continue
            if (p.prevPos.y < p.pos.y) p.prevPos.y = p.pos.y
            p.prevPos.x = p.pos.x - (p.pos.x - p.prevPos.x) * 0.8
            p.prevPos.z = p.pos.z - (p.pos.z - p.prevPos.z) * 0.8
          }
        }

        // Safety: if anything ever goes non-finite, pull that particle back to the hips
        for (const p of particles) {
          if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) {
            const anchor = Number.isFinite(particles[0].pos.x + particles[0].pos.y + particles[0].pos.z)
              ? particles[0].pos : new THREE.Vector3(playerState.position.x, playerState.position.y + 0.5, playerState.position.z)
            p.pos.copy(anchor); p.prevPos.copy(anchor)
          }
        }

        // ── Walls / furniture sides: push particles out sideways ─────────
        const _pt = { x: 0, y: 0, z: 0 }
        for (const p of particles) {
          _pt.x = p.pos.x; _pt.y = p.pos.y; _pt.z = p.pos.z
          const proj = rapierWorld.projectPoint(_pt, false, undefined, undefined, undefined, rb)
          if (!proj) continue
          let nx = p.pos.x - proj.point.x, ny = p.pos.y - proj.point.y, nz = p.pos.z - proj.point.z
          let d = Math.sqrt(nx * nx + ny * ny + nz * nz)
          if (proj.isInside) { nx = -nx; ny = -ny; nz = -nz }   // inside a box: exit via nearest face
          else if (d >= p.radius) continue
          if (d < 0.0001) continue
          nx /= d; ny /= d; nz /= d
          if (Math.abs(ny) > 0.7) continue          // floors/ceilings are handled above
          const pushOut = proj.isInside ? d + p.radius : p.radius - d
          p.pos.x += nx * pushOut; p.pos.z += nz * pushOut
          p.prevPos.x = p.pos.x; p.prevPos.z = p.pos.z   // stop sliding into the wall
        }

        // ── Drive bones from PBD particles (delta-rotation method) ──────────
        if (sk) {
          const _tmpDir     = new THREE.Vector3()
          const _tmpRestDir = new THREE.Vector3()
          const _tmpDeltaQ  = new THREE.Quaternion()
          const _tmpPWQ     = new THREE.Quaternion()
          const _tmpNewWQ   = new THREE.Quaternion()

          for (const drive of RAG_BONE_DRIVE) {
            const bone      = sk.getBoneByName(drive.bone)
            const restBoneQ = ragRestBoneQ.current.get(drive.bone)
            if (!bone || !restBoneQ) continue

            const fromPos = particles[drive.from]?.pos
            const toPos   = particles[drive.to]?.pos
            if (!fromPos || !toPos) continue

            // Current segment direction
            _tmpDir.subVectors(toPos, fromPos)
            if (_tmpDir.length() < 0.0001) continue
            _tmpDir.normalize()

            // Rest segment direction
            const restFrom = ragRestPos.current[drive.from]
            const restTo   = ragRestPos.current[drive.to]
            if (!restFrom || !restTo) continue
            _tmpRestDir.subVectors(restTo, restFrom)
            if (_tmpRestDir.length() < 0.0001) continue
            _tmpRestDir.normalize()

            // Delta: how much the segment has rotated vs rest
            _tmpDeltaQ.setFromUnitVectors(_tmpRestDir, _tmpDir)

            // New world quaternion for the bone
            _tmpNewWQ.copy(_tmpDeltaQ).multiply(restBoneQ)

            // Convert to local quaternion
            if (bone.parent) {
              bone.parent.getWorldQuaternion(_tmpPWQ)
              bone.quaternion.copy(_tmpPWQ.clone().invert().multiply(_tmpNewWQ))
            } else {
              bone.quaternion.copy(_tmpNewWQ)
            }

            // Root bone: also translate to follow hips particle
            if (drive.isRoot) {
              // Full inverse world matrix — the armature is scaled (Mixamo cm × model
              // scale), and ignoring that scale threw the whole body ~1 m off at start
              if (bone.parent) {
                bone.parent.updateWorldMatrix(true, false)
                bone.position.copy(bone.parent.worldToLocal(particles[0].pos.clone()))
              }
            }

            bone.updateMatrixWorld(true)
          }
        }
      }

      // Camera zones / outdoor light / debug readout track the floating body
      if (particles[0]) {
        playerState.position.x = particles[0].pos.x
        playerState.position.y = particles[0].pos.y
        playerState.position.z = particles[0].pos.z
      }

      // ── Press R again to stand back up where the body is ────────────────
      if (endRagdoll) {
        ragdollActive.current           = false
        playerState.ragdoll             = false
        ragdollFrozenCapsulePos.current = null   // unpin capsule

        // Teleport capsule to where the hips particle landed
        const hipPos = ragParticles.current[0]?.pos
        if (hipPos && rigidBodyRef.current) {
          rigidBodyRef.current.setTranslation({ x: hipPos.x, y: hipPos.y + 0.6, z: hipPos.z }, true)
          rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
          rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)
        }

        destroyRagdoll()

        // Restart idle (animation system takes over bones again)
        const idleAction = actionsRef.current["IDLE"]
        if (idleAction) {
          idleAction.reset().setEffectiveWeight(1).play()
          currentActionRef.current = idleAction
          setCurrentAnimation("IDLE")
          lastAnimationTime.current = Date.now() / 1000
        }
      }
      return
    }

    // ── Wall flip: if active, lock controls until animation finishes ─────
    if (wallFlip.current.active) {
      const elapsed = state.clock.elapsedTime - wallFlip.current.startTime

      // Prevent any forward (wall-ward) velocity while flipping
      const vel = rigidBodyRef.current.linvel()
      const fwd = lastMoveDir.current
      const forwardSpeed = vel.x * fwd.x + vel.z * fwd.z
      if (forwardSpeed > 0) {
        rigidBodyRef.current.setLinvel(
          { x: vel.x - fwd.x * forwardSpeed, y: vel.y, z: vel.z - fwd.z * forwardSpeed },
          true
        )
      }

      if (elapsed >= wallFlip.current.duration) {
        wallFlip.current.active = false
        playAnimation("IDLE")
      }
      return
    }

    // ── Proximity check ───────────────────────────────────────────────────
    const pos = rigidBodyRef.current.translation()
    nearSeatRef.current = null
    for (const id of Object.keys(SEATS) as SeatId[]) {
      const dx = pos.x - SEATS[id].pos.x
      const dz = pos.z - SEATS[id].pos.z
      if (Math.sqrt(dx * dx + dz * dz) < SEATS[id].radius) { nearSeatRef.current = id; break }
    }
    nearCouchRef.current       = nearSeatRef.current !== null
    playerState.nearCouch      = nearCouchRef.current
    playerState.nearSeat       = nearSeatRef.current
    playerState.sitting        = sittingRef.current
    playerState.seat           = sittingRef.current ? activeSeatRef.current : null
    {
      const mx = pos.x - MIRROR_SPOT.x, mz = pos.z - MIRROR_SPOT.z
      nearMirrorRef.current = !sittingRef.current && Math.sqrt(mx * mx + mz * mz) < MIRROR_RADIUS
    }
    playerState.nearMirror     = nearMirrorRef.current
    playerState.taunting       = tauntRef.current.active

    // ── Animate all in-flight thrown cans (runs regardless of sit state) ──
    for (const entry of thrownCansRef.current) {
      if (entry.done) continue
      const t  = Math.min((state.clock.elapsedTime - entry.startTime) / THROW_DURATION, 1)
      const sp = entry.startPos
      const lp = entry.landPos
      entry.obj.position.x = sp.x + (lp.x - sp.x) * t
      entry.obj.position.z = sp.z + (lp.z - sp.z) * t
      entry.obj.position.y = sp.y + (lp.y - sp.y) * t + 1.8 * Math.sin(Math.PI * t)
      if (t < 1) entry.obj.rotation.x += delta * 12
      if (t >= 1) entry.done = true
    }

    // ── E key toggle sit / stand ──────────────────────────────────────────
    if (interactDown && !eWasDown.current) {
      if (sittingRef.current) {
        // Stand up — teleport to the stand-up spot beside the couch
        sittingRef.current = false
        setIsSitting(false)
        // Capsule is always dynamic — no setBodyType needed
        teleportSmooth(SEATS[activeSeatRef.current].stand)
        drinkingRef.current  = false
        playerState.drinking = false
        canThrownRef.current = false
        if (beerCanRef.current) beerCanRef.current.visible = false
        // thrown cans stay on the carpet — don't remove them

        const idleAction = actionsRef.current["IDLE"]
        if (idleAction) {
          crossTo(idleAction, 0.3)   // blends out of sit/drink too
          setCurrentAnimation("IDLE")
          lastAnimationTime.current = Date.now() / 1000
        }
      } else if (nearSeatRef.current) {
        // Only sit when near a seat
        activeSeatRef.current = nearSeatRef.current
        const seat = SEATS[activeSeatRef.current]
        sittingRef.current = true
        setIsSitting(true)
        // Capsule stays dynamic; the while-seated loop pins position/velocity every frame
        teleportSmooth(seat.pos, seat.facing)
      } else if (nearMirrorRef.current && !tauntRef.current.active) {
        // Taunt at the mirror: both clips in turn, looped 3 times
        const action = actionsRef.current[TAUNT_SEQUENCE[0]]
        if (action) {
          tauntRef.current = { active: true, step: 0 }
          rigidBodyRef.current.setLinvel({ x: 0, y: rigidBodyRef.current.linvel().y, z: 0 }, true)
          const sp = rigidBodyRef.current.translation()
          if (sp.z < TAUNT_START_Z) rigidBodyRef.current.setTranslation({ x: sp.x, y: sp.y, z: TAUNT_START_Z }, true)
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, MIRROR_FACING, 0))
          rigidBodyRef.current.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
          action.setEffectiveTimeScale(1)
          crossTo(action, TAUNT_BLEND)
          setCurrentAnimation("TAUNT")
        }
      }
    }
    eWasDown.current = interactDown

    // ── Mirror taunt: hold still facing the mirror until the clip ends (or the player moves) ──
    if (tauntRef.current.active) {
      const action = currentActionRef.current
      // Start the next clip TAUNT_BLEND before this one ends so they overlap smoothly
      const ending = !action || !action.isRunning() || action.time >= action.getClip().duration - TAUNT_BLEND
      if (ending && !(forward || backward || left || right)) {
        tauntRef.current.step++
        const nextKey = TAUNT_SEQUENCE[tauntRef.current.step]
        const next = nextKey ? actionsRef.current[nextKey] : null
        if (next) crossTo(next, TAUNT_BLEND)
      }
      const finished = tauntRef.current.step >= TAUNT_SEQUENCE.length
      if (finished || forward || backward || left || right) {
        tauntRef.current.active = false
        playerState.taunting = false
        playAnimation("IDLE", undefined, true, TAUNT_BLEND)   // moving? the state machine blends to walk instead
      } else {
        const v = rigidBodyRef.current.linvel()
        rigidBodyRef.current.setLinvel({ x: 0, y: v.y, z: 0 }, true)

        // Push him back if the taunt's motion carries any part into the mirror/sink
        const sk = animEditorState.skeleton
        if (sk) {
          let overshoot = 0
          for (const [name, limitZ] of MIRROR_KEEPOUT) {
            const bone = sk.getBoneByName(name)
            if (!bone) continue
            bone.getWorldPosition(_keepoutV.current)
            overshoot = Math.max(overshoot, limitZ - _keepoutV.current.z)
          }
          if (overshoot > 0) {
            const p = rigidBodyRef.current.translation()
            rigidBodyRef.current.setTranslation({ x: p.x, y: p.y, z: p.z + overshoot }, true)
          }
        }
        return
      }
    }

    // ── While seated — hold position, handle sit/drink animations ────────
    if (sittingRef.current) {
      const seat = SEATS[activeSeatRef.current]
      rigidBodyRef.current.setTranslation(seat.pos, true)
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // Face the TV (Y rotation) — skip during cutscene so camera isn't jarred
      if (!cutsceneActive) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, seat.facing, 0))
        rigidBodyRef.current.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
      }

      // (Seated/drinking model offsets are eased in easeModelGroup — no snapping here)

      // Show beer can only while drinking (and not yet thrown)
      if (beerCanRef.current) {
        beerCanRef.current.visible = drinkingRef.current && !canThrownRef.current

        // ── Real-time can positioning (J/L = X, I/K = Y, U/O = Z) ─────────
        const STEP = 0.1
        const keys = canKeysRef.current
        if (keys.has("KeyJ")) beerCanRef.current.position.x -= STEP
        if (keys.has("KeyL")) beerCanRef.current.position.x += STEP
        if (keys.has("KeyI")) beerCanRef.current.position.y += STEP
        if (keys.has("KeyK")) beerCanRef.current.position.y -= STEP
        if (keys.has("KeyU")) beerCanRef.current.position.z -= STEP
        if (keys.has("KeyO")) beerCanRef.current.position.z += STEP

        // Log position every second
        if (state.clock.elapsedTime - canLastLog.current > 1) {
          canLastLog.current = state.clock.elapsedTime
          const p = beerCanRef.current.position
          const r = beerCanRef.current.rotation
          console.log(`[Can] pos(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)}) rot(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)})`)
        }
      }

      // ── Can throw at frame 270 ────────────────────────────────────────────
      const drinkAct = actionsRef.current["SITTING_DRINKING"]
      if (drinkingRef.current && beerCanRef.current && !canThrownRef.current
          && drinkAct && drinkAct.time >= THROW_FRAME_TIME) {
        // Snapshot world position & scale directly from hand bone
        const startPos   = new THREE.Vector3()
        const worldScale = new THREE.Vector3()
        beerCanRef.current.getWorldPosition(startPos)
        beerCanRef.current.getWorldScale(worldScale)
        canThrownRef.current = true

        // Each can lands in a small random cluster
        const landPos = new THREE.Vector3(
          CARPET_LAND_POS.x + (Math.random() - 0.5) * 0.35,
          CARPET_LAND_POS.y,
          CARPET_LAND_POS.z + (Math.random() - 0.5) * 0.35,
        )

        // Spawn a fresh world-space clone for this throw
        const thrown = beerCanScene.clone()
        thrown.traverse((child: any) => {
          if (child.isMesh) {
            child.material = child.material.clone()
            child.material.toneMapped = false
            child.material.color.set(0xC0C0C0)
            child.material.metalness  = 0.9
            child.material.roughness  = 0.15
            child.material.needsUpdate = true
          }
        })
        thrown.scale.copy(worldScale)
        thrown.position.copy(startPos)
        thrown.rotation.set(0, 0, Math.PI / 2)
        threeScene.add(thrown)

        thrownCansRef.current.push({
          obj: thrown,
          startPos: startPos.clone(),
          startTime: state.clock.elapsedTime,
          done: false,
          landPos,
        })

        beerCanRef.current.visible = false
      }

      // F key: start a new drinking session
      const fDown = isPointerLocked && !!(keys as any).drink && activeSeatRef.current === "couch"
      if (fDown && !fWasDown.current) {
        // Only allow starting a new session (not toggling off — the animation handles that now)
        if (!drinkingRef.current) {
          drinkingRef.current  = true
          playerState.drinking = true
          canThrownRef.current = false   // reset so this session can throw

          const drinkAction = actionsRef.current["SITTING_DRINKING"]
          if (drinkAction) {
            crossTo(drinkAction, 0.4)   // blends out of the sit pose
          }
        }
      }
      fWasDown.current = fDown

      // If no animation is running yet, start the default sit pose — new first, then kill old
      const sit = sittingActionRef.current
      if (sit && !sit.isRunning() && !drinkingRef.current) {
        crossTo(sit, 0.4)
        setCurrentAnimation("SITTING")
      }
      return
    }

    // Reset drinking state when standing up (the stand-up crossfade already blended the pose out)
    if (drinkingRef.current) {
      drinkingRef.current  = false
      playerState.drinking = false
    }

    // Check if any movement key is pressed
    const moving = forward || backward || left || right

    // Get current position and velocity
    const currentPos = rigidBodyRef.current.translation()
    const currentVel = rigidBodyRef.current.linvel()
    const currentTime = state.clock.elapsedTime

    // Keep cutscene editor's player position display up to date
    livePlayerRef.current = { x: currentPos.x, y: currentPos.y, z: currentPos.z }

    // ✅ NEW: Handle footstep audio with better debugging
    if (footstepAudioRef.current && audioEnabled && isGrounded && moving) {
      // Play footsteps for both walking and running
      const isRunning = sprint
      footstepAudioRef.current.playFootstep(isRunning, currentTime)
    }

    // ✅ IMPROVED: Use new ground detection system
    const newGroundedState = checkGrounded(currentPos, currentVel, currentTime)

    // ✅ IMPROVED: Use new terrain traversal detection
    const isTraversingTerrain = checkTerrainTraversal(currentPos, currentVel)

    // Update grounded state with less delay for better responsiveness
    if (newGroundedState !== isGrounded) {
      // Immediate update for losing ground contact (jumping/falling)
      if (!newGroundedState && isGrounded) {
        setIsGrounded(false)
      }
      // Small delay for gaining ground contact (landing)
      else if (newGroundedState && !isGrounded) {
        setTimeout(() => {
          setIsGrounded(newGroundedState)
        }, 25) // Reduced delay
      }
    }

    // This tracks stable ground frames for landing transitions
    if (isGrounded) {
      jumpState.current.framesOnGround++
      jumpState.current.lastGroundedTime = currentTime
    } else {
      jumpState.current.framesOnGround = 0
    }

    // Track the moment the character reaches the top of the jump
    if (
      jumpState.current.isInJumpProcess &&
      !jumpState.current.jumpPeakReached &&
      jumpState.current.previousVelocityY > 0 &&
      currentVel.y <= 0
    ) {
      jumpState.current.jumpPeakReached = true
    }

    // This ensures we force JUMP_DOWN when velocity changes direction
    if (currentAnimation === "JUMP_UP" && (currentVel.y <= 0 || jumpState.current.jumpPeakReached)) {
      playAnimation("JUMP_DOWN", ANIMATION_CONFIG.SPEEDS.JUMP_DOWN, false, 0.05)
    }

    jumpState.current.previousVelocityY = currentVel.y

    // ✅ IMPROVED: More aggressive airtime tracking with better logic
    const AIRTIME_THRESHOLD = 0.001 // 1 millisecond in seconds
    if (!isGrounded) {
      if (!jumpState.current.airtimeStart) {
        jumpState.current.airtimeStart = currentTime
      }

      const airtime = currentTime - jumpState.current.airtimeStart

      // ✅ CRITICAL: Force jump animation if airborne and not in terrain traversal
      if (airtime > AIRTIME_THRESHOLD && !currentAnimation.includes("JUMP") && !isTraversingTerrain) {
        jumpState.current.forcedJumpAnimation = true

        if (currentVel.y > 0) {
          playAnimation("JUMP_UP", ANIMATION_CONFIG.SPEEDS.JUMP_UP, false)
        } else {
          playAnimation("JUMP_DOWN", ANIMATION_CONFIG.SPEEDS.JUMP_DOWN, false)
        }
      }
    } else {
      // Reset airtime when grounded
      jumpState.current.airtimeStart = null
      jumpState.current.forcedJumpAnimation = false
    }

    // ✅ FIXED: Only transition from JUMP_DOWN when animation is complete and player is stable
    if (
      isGrounded &&
      currentAnimation === "JUMP_DOWN" &&
      (currentActionRef.current?.time ?? 0) >= (currentActionRef.current?.getClip().duration || 1) - 0.01 && // freeze reached
      Math.abs(currentVel.y) < 0.1 && // stable Y velocity
      jumpState.current.framesOnGround >= 3 // stable on ground for multiple frames
    ) {
      const next = moving ? (sprint ? "SPRINT" : "RUN") : "IDLE"
      playAnimation(next, (ANIMATION_CONFIG.SPEEDS as Record<string, number>)[next], true)
      setCurrentAnimation(next)
      jumpState.current.isInJumpProcess = false
      jumpState.current.jumpPeakReached = false
      jumpState.current.jumpCount = 0
      jumpState.current.forcedJumpAnimation = false
    }

    // Coyote time
    const coyoteTimeAvailable = currentTime - jumpState.current.lastGroundedTime < COYOTE_TIME

    // ✅ CAMERA-RELATIVE MOVEMENT
    // Calculate movement direction based on camera
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion)
    cameraForward.y = 0
    cameraForward.normalize()

    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion)
    cameraRight.y = 0
    cameraRight.normalize()

    const moveDirection = new THREE.Vector3(0, 0, 0)
    if (forward) moveDirection.add(cameraForward)
    if (backward) moveDirection.sub(cameraForward)
    if (right) moveDirection.add(cameraRight)
    if (left) moveDirection.sub(cameraRight)

    if (moveDirection.length() > 0) {
      moveDirection.normalize()
      lastMoveDir.current.copy(moveDirection)
    }

    // ── Wall flip: SPACE while up against a wall ─────────────────────────
    // Only on a fresh space press, grounded, with a collider right in front of
    // the player (capsule radius 0.4 + a little slack). Otherwise SPACE jumps.
    const facing = moveDirection.lengthSq() > 0.01 ? moveDirection : lastMoveDir.current
    if (jump && jumpState.current.spaceWasReleased && isGrounded && !wallFlip.current.active) {
      const wallRay = new rapier.Ray({ x: pos.x, y: pos.y + 0.5, z: pos.z }, { x: facing.x, y: 0, z: facing.z })
      const wallHit = rapierWorld.castRay(wallRay, 0.75, true, undefined, undefined, undefined, rigidBodyRef.current)
      if (wallHit) {
        jumpState.current.spaceWasReleased = false
        const moveDirection = facing.clone()
        // Trigger the wall flip
        wallFlip.current.active    = true
        wallFlip.current.startTime = state.clock.elapsedTime

        // Step 1: zero current velocity so there's no residual wall-ward momentum
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)

        // Step 2: nudge player back from the wall so the collider isn't inside it
        const nudge = moveDirection.clone().negate().multiplyScalar(0.5)
        rigidBodyRef.current.setTranslation(
          { x: pos.x + nudge.x, y: pos.y, z: pos.z + nudge.z }, true
        )

        // Step 3: launch backward + upward
        const bounce = moveDirection.clone().negate().multiplyScalar(6)
        rigidBodyRef.current.applyImpulse(
          { x: bounce.x, y: 10, z: bounce.z }, true
        )

        playAnimation("WALL_FLIP", 1.0, false)
        return
      }
    }

    // Apply movement
    const speed = sprint ? RUN_SPEED : WALK_SPEED

    // ✅ DIRECT: No lerping on velocity
    const targetVelocity = {
      x: moveDirection.x * speed,
      y: currentVel.y, // Keep current y velocity for physics
      z: moveDirection.z * speed,
    }

    // Apply velocity directly
    rigidBodyRef.current.setLinvel(targetVelocity, true)

    // ✅ ROTATION: Direct rotation - NO SMOOTHING
    if (moveDirection.length() > 0) {
      const angle = Math.atan2(moveDirection.x, moveDirection.z)
      const targetQuaternion = new THREE.Quaternion()
      targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)

      // DIRECT rotation - NO SLERP
      rigidBodyRef.current.setRotation(targetQuaternion, true)
    }

    // ✅ FIXED: Jump input detection - only when pointer is locked
    if (jump) {
      // Only jump if space was just pressed (not held down)
      if (jumpState.current.spaceWasReleased) {
        // Prevent infinite jumping when already at max jumps
        if (jumpState.current.jumpCount < jumpState.current.maxJumps) {
          // Check if we can jump (grounded or in coyote time for first jump, or airborne for second jump)
          const canJumpFromGround = (isGrounded || coyoteTimeAvailable) && jumpState.current.jumpCount === 0
          const canDoubleJump = !isGrounded && jumpState.current.jumpCount === 1

          // Only allow jumping if we haven't exceeded the maximum number of jumps
          if (canJumpFromGround || canDoubleJump) {
            // Apply jump force - SIMPLE AND DIRECT
            rigidBodyRef.current.setLinvel(
              {
                x: currentVel.x,
                y: JUMP_FORCE, // Direct upward force
                z: currentVel.z,
              },
              true,
            )

            // Increment jump count
            jumpState.current.jumpCount++

            // Update jump state
            jumpState.current.canJump = false
            jumpState.current.isInJumpProcess = true
            jumpState.current.jumpPeakReached = false
            jumpState.current.spaceWasReleased = false // Mark space as used

            // Play jump animation
            playAnimation("JUMP_UP", ANIMATION_CONFIG.SPEEDS.JUMP_UP, false)
          }
        }
      }
    } else {
      // Space key is not pressed - mark as released for next jump
      jumpState.current.spaceWasReleased = true
    }

    // ✅ COMPLETELY REWRITTEN: Animation state machine with priority system

    // PRIORITY 1: Forced jump animations (highest priority)
    if (jumpState.current.forcedJumpAnimation && !isGrounded && !isTraversingTerrain) {
      // Don't override - let the forced animation play
      return
    }

    // PRIORITY 2: Active jump process animations
    if (jumpState.current.isInJumpProcess && !isGrounded) {
      // If we're rising and not in JUMP_UP, play JUMP_UP
      if (currentVel.y > 0.5 && currentAnimation !== "JUMP_UP" && !jumpState.current.jumpPeakReached) {
        playAnimation("JUMP_UP", ANIMATION_CONFIG.SPEEDS.JUMP_UP, false)
      }
      // If we've reached peak OR are falling, ensure JUMP_DOWN is playing
      else if ((jumpState.current.jumpPeakReached || currentVel.y < -0.5) && currentAnimation !== "JUMP_DOWN") {
        playAnimation("JUMP_DOWN", ANIMATION_CONFIG.SPEEDS.JUMP_DOWN, false)
      }
      return
    }

    // PRIORITY 3: Ground animations (only when definitely grounded and not in jump process)
    if (isGrounded && !jumpState.current.isInJumpProcess) {
      // Force ground animation if we're stuck in jump animation while grounded
      if (currentAnimation.includes("JUMP") && !isTraversingTerrain) {
        const next = moving ? (sprint ? "SPRINT" : "RUN") : "IDLE"
        playAnimation(next, (ANIMATION_CONFIG.SPEEDS as Record<string, number>)[next], true)
        jumpState.current.isInJumpProcess = false
        jumpState.current.jumpPeakReached = false
        jumpState.current.forcedJumpAnimation = false
        return
      }

      // Normal ground animations
      const next = moving ? (sprint ? "SPRINT" : "RUN") : "IDLE"
      if (currentAnimation !== next && !currentAnimation.includes("JUMP")) {
        playAnimation(next, (ANIMATION_CONFIG.SPEEDS as Record<string, number>)[next], true)
      }
    }

    // PRIORITY 4: Airborne animations (when not grounded and not terrain traversal)
    else if (!isGrounded && !isTraversingTerrain) {
      // If we're clearly airborne but not in jump animation, force it
      if (!currentAnimation.includes("JUMP")) {
        if (currentVel.y > 0) {
          playAnimation("JUMP_UP", ANIMATION_CONFIG.SPEEDS.JUMP_UP, false)
          jumpState.current.isInJumpProcess = true
        } else {
          playAnimation("JUMP_DOWN", ANIMATION_CONFIG.SPEEDS.JUMP_DOWN, false)
          jumpState.current.isInJumpProcess = true
          jumpState.current.jumpPeakReached = true
        }
      }
    }
  })

  // Show loading state if model isn't ready
  if (!modelLoaded) {
    return (
      <Html position={position} center>
        <div
          style={{
            backgroundColor: "rgba(0,0,0,0.8)",
            color: "white",
            padding: "20px",
            borderRadius: "10px",
            fontFamily: "monospace",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          <div>Loading Player Model...</div>
          <div style={{ fontSize: "12px", marginTop: "10px", opacity: 0.7 }}>🔊 Audio system initializing...</div>
        </div>
      </Html>
    )
  }

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      enabledRotations={[false, true, false]}
      mass={1}
      type="dynamic"
      colliders={false}
      ccd={true}
      linearDamping={0.5}
      angularDamping={5.0}
      friction={0.1}
      restitution={0.0}
      name="player"
      onCollisionEnter={(e) => {
        if (e.other) {
          collisionCountRef.current++

          // Only reset grounded state if we were actually falling
          if (jumpState.current.isInJumpProcess || currentAnimation === "JUMP_DOWN") {
            setIsGrounded(true)
            jumpState.current.canJump = true
            jumpState.current.jumpCount = 0
            jumpState.current.jumpPeakReached = false
            jumpState.current.isInJumpProcess = false // This will trigger ground animation transition
            jumpState.current.forcedJumpAnimation = false
          } else {
            setIsGrounded(true)
            jumpState.current.canJump = true
          }
        }
      }}
      onCollisionExit={(e) => {
        if (e.other && collisionCountRef.current > 0) {
          collisionCountRef.current--

          if (collisionCountRef.current === 0) {
            setTimeout(() => {
              if (collisionCountRef.current === 0) {
                setIsGrounded(false)
              }
            }, 50) // Reduced delay for faster response
          }
        }
      }}
    >
      {/* Invisible Capsule collider for physics */}
      <CapsuleCollider args={[0.6, 0.4]} position={[0, 0.4, 0]} friction={0.1} restitution={0.0} />

      {/* GLB model - back to static positioning to avoid misalignment */}
      <group ref={modelGroupRef} position={[0, SIT_Y, 0]} scale={1.5}>
        {scene && <primitive object={scene} castShadow receiveShadow />}
      </group>
    </RigidBody>
  )
})

export default Player
