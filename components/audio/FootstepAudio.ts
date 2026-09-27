// Footstep audio system for the player
export class FootstepAudio {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private isInitialized = false
  private lastStepTime = 0
  private stepInterval = 0.2
  private walkStepInterval = 0.3
  private volume = 0.3
  private footstepBuffer: AudioBuffer | null = null
  private isMobile = false
  private initializationAttempted = false

  constructor() {
    this.detectMobile()
    // Don't initialize immediately - wait for user interaction
  }

  private detectMobile() {
    if (typeof window !== "undefined") {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
      this.isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
    }
  }

  private async initializeAudio() {
    if (this.initializationAttempted) return
    this.initializationAttempted = true

    try {
      // Create audio context with better browser support
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        console.warn("Web Audio API not supported")
        return
      }

      this.audioContext = new AudioContextClass()

      // Create gain node
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime)
      this.gainNode.connect(this.audioContext.destination)

      // Load audio with better error handling
      await this.loadFootstepAudio()

      this.isInitialized = true
      console.log("🔊 Footstep audio system initialized successfully")
    } catch (error) {
      console.warn("Failed to initialize footstep audio:", error)
      this.isInitialized = false
    }
  }

  private async loadFootstepAudio(): Promise<void> {
    if (!this.audioContext) return

    try {
      // Try multiple audio formats for better compatibility
      const audioSources = ["https://jsvoa5caghxrdhvw.public.blob.vercel-storage.com/Footsteps%20Grass%20Sound%20Effect%20%28HD%29-6YBjjTrbZ5UNJp4DyI5yo1YsFonnAB.mp3", "/footsteps-grass.wav", "/footsteps-grass.ogg"]

      let response: Response | null = null
      let workingSource = ""

      // Try each audio source until one works
      for (const source of audioSources) {
        try {
          response = await fetch(source)
          if (response.ok) {
            workingSource = source
            break
          }
        } catch (e) {
          continue
        }
      }

      if (!response || !response.ok) {
        throw new Error("No audio file could be loaded")
      }

      const arrayBuffer = await response.arrayBuffer()
      this.footstepBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
      console.log(`🎵 Footstep audio loaded from: ${workingSource}`)
    } catch (error) {
      console.warn("Failed to load footstep audio file:", error)
      // Create a silent buffer as fallback
      if (this.audioContext) {
        this.footstepBuffer = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate)
      }
    }
  }

  private async playFootstepSound(isRunning = false): Promise<void> {
    try {
      // Initialize on first play if needed
      if (!this.isInitialized) {
        await this.initializeAudio()
      }

      if (!this.audioContext || !this.gainNode || !this.isInitialized || !this.footstepBuffer) {
        return
      }

      // Resume audio context if suspended (required for user interaction)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume()
      }

      const now = this.audioContext.currentTime

      // Create buffer source
      const source = this.audioContext.createBufferSource()
      const sourceGain = this.audioContext.createGain()

      source.buffer = this.footstepBuffer

      // Adjust playback rate and volume
      source.playbackRate.setValueAtTime(isRunning ? 1.2 : 1.0, now)

      const baseVolume = this.isMobile ? this.volume * 0.6 : this.volume
      const targetVolume = isRunning ? baseVolume * 1.2 : baseVolume * 0.8
      sourceGain.gain.setValueAtTime(targetVolume, now)

      // Add pitch variation
      const pitchVariation = 0.9 + Math.random() * 0.2
      source.playbackRate.setValueAtTime(source.playbackRate.value * pitchVariation, now)

      // Connect and play
      source.connect(sourceGain)
      sourceGain.connect(this.gainNode)

      source.start(now)
      source.stop(now + (isRunning ? 0.3 : 0.4))
    } catch (error) {
      console.warn("Failed to play footstep sound:", error)
    }
  }

  // Play footstep with automatic initialization
  public async playFootstep(isRunning = false, currentTime: number): Promise<void> {
    const interval = isRunning ? this.stepInterval : this.walkStepInterval

    if (currentTime - this.lastStepTime >= interval) {
      await this.playFootstepSound(isRunning)
      this.lastStepTime = currentTime
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.gainNode && this.audioContext) {
      try {
        this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime)
      } catch (error) {
        console.warn("Failed to set volume:", error)
      }
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.gainNode && this.audioContext) {
      try {
        const targetVolume = enabled ? this.volume : 0
        this.gainNode.gain.setValueAtTime(targetVolume, this.audioContext.currentTime)
      } catch (error) {
        console.warn("Failed to set enabled state:", error)
      }
    }
  }

  public dispose(): void {
    try {
      if (this.audioContext && this.audioContext.state !== "closed") {
        this.audioContext.close()
      }
      this.audioContext = null
      this.gainNode = null
      this.footstepBuffer = null
      this.isInitialized = false
      this.initializationAttempted = false
    } catch (error) {
      console.warn("Error disposing footstep audio:", error)
    }
  }
}
