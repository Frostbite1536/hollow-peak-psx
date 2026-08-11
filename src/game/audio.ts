export class AudioManager {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  wind: GainNode | null = null
  droneOsc: OscillatorNode | null = null
  noiseBuffer: AudioBuffer | null = null
  enabled = false

  init() {
    if (this.enabled) return
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.0
      this.master.connect(this.ctx.destination)

      // Generate noise buffer for wind
      const len = this.ctx.sampleRate * 2
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuffer.getChannelData(0)
      for (let i=0;i<len;i++) d[i] = (Math.random()*2-1) * 0.5

      this.enabled = true
      this.startAmbient()
      // fade in
      this.master.gain.linearRampToValueAtTime(0.45, this.ctx.currentTime + 1.5)
    } catch {}
  }

  startAmbient() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return
    // Wind - filtered noise
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 420
    filter.Q.value = 0.7
    const windGain = this.ctx.createGain()
    windGain.gain.value = 0.18
    src.connect(filter).connect(windGain).connect(this.master!)
    src.start()
    this.wind = windGain

    // Drone - detuned saws very low
    const o1 = this.ctx.createOscillator()
    o1.type = 'sawtooth'
    o1.frequency.value = 48
    const o2 = this.ctx.createOscillator()
    o2.type = 'sawtooth'
    o2.frequency.value = 49.2
    const droneGain = this.ctx.createGain()
    droneGain.gain.value = 0.06
    const droneFilter = this.ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 520
    o1.connect(droneFilter)
    o2.connect(droneFilter)
    droneFilter.connect(droneGain).connect(this.master!)
    o1.start(); o2.start()
    this.droneOsc = o1

    // LFO on wind
    setInterval(() => {
      if (!this.wind || !this.ctx) return
      const t = this.ctx.currentTime
      this.wind.gain.linearRampToValueAtTime(0.12 + Math.random()*0.08, t + 0.8)
      filter.frequency.linearRampToValueAtTime(380 + Math.random()*120, t + 0.8)
    }, 900)
  }

  setProximity(v:number){
    // v 0-1 how close to entity
    if(!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.linearRampToValueAtTime(0.45 + v*0.35, t+0.2)
    if(this.wind) this.wind.gain.linearRampToValueAtTime(0.18 + v*0.25, t+0.2)
  }

  playTone(freq:number, dur:number, type: OscillatorType='square', vol=0.25){
    if(!this.ctx || !this.master) return
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.value = vol
    o.connect(g).connect(this.master)
    o.start()
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur)
    o.stop(this.ctx.currentTime + dur + 0.02)
  }

  playPickup(){
    this.playTone(880, 0.18, 'square', 0.3)
    setTimeout(()=> this.playTone(1320,0.22,'square',0.28), 120)
  }
  playStatic(){
    if(!this.ctx || !this.master) return
    const len = this.ctx.sampleRate * 0.35
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 2)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const f = this.ctx.createBiquadFilter()
    f.type='highpass'; f.frequency.value=900
    const g = this.ctx.createGain(); g.gain.value=0.28
    src.connect(f).connect(g).connect(this.master)
    src.start()
  }
  playFootstep(isRun:boolean, onSnow=true){
    const base = onSnow ? 90 + Math.random()*15 : 140
    this.playTone(base, isRun?0.07:0.09, 'square', isRun?0.14:0.09)
  }
  playHurt(){
    this.playTone(120,0.5,'sawtooth',0.4)
    setTimeout(()=>this.playTone(60,0.6,'sawtooth',0.35), 120)
  }
}
