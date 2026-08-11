import './style.css'
import * as THREE from 'three'
import { PSX_WIDTH, PSX_HEIGHT, psxifyMaterial, CRTFragment, CRTVertex, updatePsxMaterials } from './engine/psx'
import { Input } from './game/input'
import { AudioManager } from './game/audio'
import { createWorld } from './game/world'

// Types
type GameState = 'bios'|'title'|'playing'|'paused'|'tape'|'won'|'lost'

const app = document.getElementById('app')!
const container = document.createElement('div')
container.id = 'game-container'
app.appendChild(container)

// Renderer + low-res target
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x000000, 1)
renderer.outputColorSpace = THREE.SRGBColorSpace
container.appendChild(renderer.domElement)
renderer.domElement.id = 'game-canvas'

// CRT overlay DOM
const overlay = document.createElement('div'); overlay.className='crt-overlay'; container.appendChild(overlay)
const vignette = document.createElement('div'); vignette.className='crt-vignette'; container.appendChild(vignette)
const flicker = document.createElement('div'); flicker.className='crt-flicker'; container.appendChild(flicker)
const noise = document.createElement('div'); noise.className='noise'; container.appendChild(noise)

const uiLayer = document.createElement('div'); uiLayer.className='ui-layer'; container.appendChild(uiLayer)

// Scene
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(58, PSX_WIDTH/PSX_HEIGHT, 0.1, 100)
camera.position.set(0, 3.5, 8)

// Lights - PS1 style: no shadows, simple lambert
const ambient = new THREE.AmbientLight(0x6a7a8e, 0.92)
scene.add(ambient)
const moonLight = new THREE.DirectionalLight(0xc8d6e8, 1.15)
moonLight.position.set(-42,38,-48)
scene.add(moonLight)
const fill = new THREE.DirectionalLight(0x8a9ab0, 0.32)
fill.position.set(20,10,20)
scene.add(fill)

// Low-res render target
const rt = new THREE.WebGLRenderTarget(PSX_WIDTH, PSX_HEIGHT, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true,
  stencilBuffer: false
})

// CRT composite quad
const crtScene = new THREE.Scene()
const crtCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1)
const crtGeo = new THREE.PlaneGeometry(2,2)
const crtMat = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: rt.texture },
    uTime: { value: 0 },
    uDistortion: { value: 0.32 },
    uScanline: { value: 0.85 },
    uChroma: { value: 0.0022 }
  },
  vertexShader: CRTVertex,
  fragmentShader: CRTFragment,
  depthWrite: false,
  depthTest: false
})
const crtQuad = new THREE.Mesh(crtGeo, crtMat)
crtScene.add(crtQuad)

// PSX materials collection
const psxMaterials: THREE.Material[] = []
const { tapes, colliders, dishGroup, towerLight, txGroup } = createWorld(scene, psxMaterials)

// Player
const player = {
  pos: new THREE.Vector3(-2, 0, 10),
  yaw: -0.18,
  pitch: 0,
  vel: new THREE.Vector3(),
  stamina: 1,
  healthPulse: 0,
}
const playerMeshGroup = new THREE.Group()
scene.add(playerMeshGroup)
// Low-poly player avatar - only visible in third-person shadow? We'll make a simple capsule for shadow/visual
const shadowGeo = new THREE.CircleGeometry(0.42, 8)
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent:true, opacity:0.32 })
const shadow = new THREE.Mesh(shadowGeo, shadowMat)
shadow.rotation.x = -Math.PI/2
shadow.position.y = 0.02
scene.add(shadow)

// Entity - the Listener
const entityPos = new THREE.Vector3(38,0, -8)
let entityYaw = Math.PI
const entityGroup = new THREE.Group()
scene.add(entityGroup)
{
  const bodyGeo = new THREE.CylinderGeometry(0.38,0.42,1.9,6)
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a })
  psxifyMaterial(bodyMat); psxMaterials.push(bodyMat)
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = 0.95
  entityGroup.add(body)
  const headGeo = new THREE.SphereGeometry(0.32,6,6)
  const headMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
  const head = new THREE.Mesh(headGeo, headMat)
  head.position.y = 1.95
  // stretch head
  head.scale.set(1,1.35,1)
  entityGroup.add(head)
  // antenna
  const antGeo = new THREE.CylinderGeometry(0.02,0.02,0.7,4)
  const antMat = new THREE.MeshBasicMaterial({ color: 0x333333 })
  const ant1 = new THREE.Mesh(antGeo, antMat); ant1.position.set(-0.14,2.28,0); ant1.rotation.z=0.28; entityGroup.add(ant1)
  const ant2 = ant1.clone(); ant2.position.x=0.14; ant2.rotation.z=-0.28; entityGroup.add(ant2)
  // eyes - two red dots
  const eyeGeo = new THREE.SphereGeometry(0.05,4,4)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 })
  const eye1 = new THREE.Mesh(eyeGeo, eyeMat); eye1.position.set(-0.11,1.98,0.22); entityGroup.add(eye1)
  const eye2 = eye1.clone(); eye2.position.x=0.11; entityGroup.add(eye2)
  entityGroup.position.copy(entityPos)
}
let entityState: 'patrol'|'chase'|'stun' = 'patrol'
let entityStun = 0
let entityPatrolTarget = new THREE.Vector3(12,0,6)
let entitySpeed = 1.2
let hearTimer = 0

// Audio
const audio = new AudioManager()
const input = new Input()

// Game state
let state: GameState = 'bios'
let biosTimer = 0
let titleSelect = 0
let dialogueQueue: {title:string, text:string}[] = []
let dialogueIndex = 0
let tapesCollected = 0
let flashlightOn = true
let footstepTimer = 0
let proximity = 0
let invuln = 0
let wonTimer = 0

// Flashlight
const flash = new THREE.SpotLight(0xfff4c8, 4.2, 22, Math.PI*0.31, 0.5, 1.8)
flash.position.set(0,1.2,0)
scene.add(flash)
scene.add(flash.target)

// Foot path helper
function checkCollision(next: THREE.Vector3, radius=0.45){
  for(const b of colliders){
    const clamped = new THREE.Vector3(
      Math.max(b.min.x, Math.min(b.max.x, next.x)),
      0,
      Math.max(b.min.z, Math.min(b.max.z, next.z))
    )
    const dx = next.x - clamped.x
    const dz = next.z - clamped.z
    if(dx*dx+dz*dz < radius*radius) return true
  }
  // world bounds soft wall
  if(next.length() > 78) return true
  return false
}

// UI Build
function renderUI(){
  uiLayer.innerHTML = ''
  uiLayer.className = 'ui-layer' + (state==='bios'||state==='title'||state==='paused'||state==='won'||state==='lost'||state==='tape' ? ' interactive' : '')
  if(state==='bios'){
    const bios = document.createElement('div'); bios.className='bios-screen'
    bios.innerHTML = `
      <div class="bios-logo">SONY</div>
      <div class="bios-sub">COMPUTER ENTERTAINMENT</div>
      <div class="bios-diamond"><span>◆</span></div>
      <div class="bios-text">
        HOLLOW PEAK OBSERVATORY — WINTER 1998<br>
        BIOS VER 2.1 &nbsp;•&nbsp; NTSC / 60Hz &nbsp;•&nbsp; MEMORY CARD: 1 BLOCK FREE<br><br>
        PRESS START TO CONTINUE<br>
        <span style="color:#444">© 1998 NORTHLIGHT SYSTEMS • ALL RIGHTS RESERVED</span>
      </div>
      <div class="bios-prompt">PRESS [ENTER] / [SPACE] / [START]</div>
    `
    bios.addEventListener('click', ()=> { if(state==='bios'){ audio.init(); state='title' } })
    uiLayer.appendChild(bios)
    return
  }
  if(state==='title'){
    const menu = document.createElement('div'); menu.className='menu-screen'
    const title = tapesCollected>0 ? 'HOLLOW PEAK' : 'HOLLOW PEAK'
    menu.innerHTML = `
      <div class="menu-title">${title}</div>
      <div class="menu-subtitle">WINTER 1998 — THE SIGNAL WENT DARK</div>
      <div class="menu-options" id="menu-opts"></div>
      <div class="menu-footer">
        TANK CONTROLS: W/S MOVE • A/D TURN • SHIFT RUN • E INTERACT • F FLASHLIGHT • ESC PAUSE<br>
        COLLECT 4 LOST TAPES • RESTORE THE TRANSMITTER • AVOID THE LISTENER<br>
        <span style="color:#c44">PSX RENDER: 320×240 • VERTEX SNAP • DITHER • CRT</span>
      </div>
    `
    uiLayer.appendChild(menu)
    const opts = menu.querySelector('#menu-opts')!
    const options = [
      {label:'NEW GAME', action:()=> startGame()},
      {label:'CONTINUE', action:()=> startGame()},
      {label:'OPTIONS', action:()=> { flashlightOn=!flashlightOn; renderUI() }},
    ]
    options.forEach((o,i)=>{
      const b = document.createElement('button')
      b.className='menu-btn' + (i===titleSelect?' active':'')
      b.innerHTML=`<span>${o.label}</span><span style="font-size:9px;color:#666">${i===0?'▶':''}</span>`
      b.onclick = o.action
      b.onmouseenter = ()=>{ titleSelect=i; renderUI() }
      opts.appendChild(b)
    })
    return
  }
  if(state==='playing' || state==='paused'){
    // HUD
    const hud = document.createElement('div'); hud.className='hud'
    hud.innerHTML = `
      <div class="hud-top">
        <div>
          <div style="font-size:9px;color:#666;letter-spacing:0.2em;margin-bottom:4px">HOLLOW PEAK // TAPE RECOVERY</div>
          <div class="hud-tapes" id="hud-tapes"></div>
        </div>
        <div class="hud-signal">
          <div>SIGNAL: <span style="color:${proximity>0.6?'#e55':'#888'}">${tapesCollected}/4 TAPES</span></div>
          <div class="signal-bar"><div class="signal-fill" id="sig-fill"></div></div>
          <div style="font-size:9px;color:#555;margin-top:2px">${flashlightOn?'FLASHLIGHT ON':'FLASHLIGHT OFF'} • ${Math.floor(player.stamina*100)}% STAM</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-controls">
          <div><b>W/S</b> MOVE &nbsp; <b>A/D</b> TURN &nbsp; <b>SHIFT</b> RUN &nbsp; <b>E</b> INTERACT</div>
          <div><b>F</b> FLASHLIGHT &nbsp; <b>ESC</b> PAUSE &nbsp; <b>M</b> MUTE</div>
          <div class="stamina-bar"><div class="stamina-fill" id="stam-fill"></div></div>
        </div>
        <div class="compass" id="compass">N • E • S • W</div>
      </div>
    `
    uiLayer.appendChild(hud)
    const tapeRow = hud.querySelector('#hud-tapes')!
    for(let i=0;i<4;i++){
      const d = document.createElement('div'); d.className='tape-icon' + (i < tapesCollected ? ' collected' : '')
      d.textContent = `0${i+1}`
      tapeRow.appendChild(d)
    }
    const sig = hud.querySelector('#sig-fill') as HTMLElement
    if(sig) sig.style.width = `${Math.min(100, tapesCollected*25 + proximity*30)}%`
    const stam = hud.querySelector('#stam-fill') as HTMLElement
    if(stam) { stam.style.width = `${player.stamina*100}%`; stam.style.background = player.stamina<0.2 ? '#c44' : player.stamina<0.5 ? '#c8a53a' : '#6a6' }
    const comp = hud.querySelector('#compass') as HTMLElement
    if(comp){
      const deg = ((player.yaw*180/Math.PI)%360+360)%360
      const dirs=['N','NE','E','SE','S','SW','W','NW']
      const idx = Math.round(deg/45)%8
      comp.textContent = `◀ ${dirs[idx]} ${Math.round(deg)}° ▶`
    }

    if(state==='paused'){
      const pm = document.createElement('div'); pm.className='menu-screen'
      pm.style.background='rgba(5,5,7,0.88)'
      pm.innerHTML=`
        <div class="menu-title" style="font-size:32px">PAUSED</div>
        <div class="menu-subtitle">SIGNAL LOST IN FOG • PRESS ESC TO RESUME</div>
        <div class="menu-options">
          <button class="menu-btn active" id="resume"><span>RESUME</span><span>ESC</span></button>
          <button class="menu-btn" id="restart"><span>RESTART</span><span></span></button>
          <button class="menu-btn" id="titleBtn"><span>RETURN TO TITLE</span><span></span></button>
        </div>
      `
      uiLayer.appendChild(pm)
      pm.querySelector('#resume')!.addEventListener('click', ()=> state='playing')
      pm.querySelector('#restart')!.addEventListener('click', ()=> startGame())
      pm.querySelector('#titleBtn')!.addEventListener('click', ()=> {state='title'; renderUI()})
    }
    return
  }
  if(state==='tape'){
    const d = dialogueQueue[dialogueIndex]
    if(!d){ state='playing'; renderUI(); return }
    const box = document.createElement('div'); box.className='dialogue-box'
    box.innerHTML=`
      <div class="dialogue-header"><span>${d.title}</span><span>${dialogueIndex+1}/${dialogueQueue.length}</span></div>
      <div class="dialogue-text">${d.text}</div>
      <div class="dialogue-prompt">PRESS [E] / [ENTER] TO CONTINUE ▶</div>
    `
    box.addEventListener('click', advanceDialogue)
    uiLayer.appendChild(box)
    return
  }
  if(state==='won'){
    const w = document.createElement('div'); w.className='menu-screen'
    w.innerHTML=`
      <div class="gameover-title" style="color:#6fcf6f">SIGNAL RESTORED</div>
      <div class="menu-subtitle" style="color:#8a8">TRANSMITTER ONLINE — RESCUE INBOUND — WINTER 1998</div>
      <div class="bios-text" style="margin:18px 0; color:#aaa">
        YOU RECOVERED ${tapesCollected}/4 TAPES<br>
        THE HOLLOW PEAK INCIDENT WILL BE CLASSIFIED.<br>
        THANK YOU FOR PLAYING.
      </div>
      <div class="menu-options">
        <button class="menu-btn active" id="again"><span>PLAY AGAIN</span><span></span></button>
        <button class="menu-btn" id="toTitle"><span>TITLE SCREEN</span><span></span></button>
      </div>
      <div class="menu-footer">HOLLOW PEAK — A PSX TRIBUTE • BUILT WITH THREE.JS • 320×240 • MADE FOR THE DEMO DISC</div>
    `
    uiLayer.appendChild(w)
    w.querySelector('#again')!.addEventListener('click', ()=> startGame())
    w.querySelector('#toTitle')!.addEventListener('click', ()=> { state='title'; renderUI() })
    return
  }
  if(state==='lost'){
    const l = document.createElement('div'); l.className='menu-screen'
    l.innerHTML=`
      <div class="gameover-title">SIGNAL LOST</div>
      <div class="menu-subtitle">THE LISTENER FOUND YOU • WINTER 1998</div>
      <div class="bios-text" style="margin:18px 0; color:#888">
        YOUR FOOTSTEPS STOPPED. THE SNOW SETTLED.<br>
        ANOTHER TAPE FOR THE ARCHIVE.<br>
        TAPES RECOVERED: ${tapesCollected}/4
      </div>
      <div class="menu-options">
        <button class="menu-btn active" id="retry"><span>RETRY</span><span></span></button>
        <button class="menu-btn" id="title2"><span>TITLE SCREEN</span><span></span></button>
      </div>
      <div class="menu-footer" style="color:#533">HINT: RUN ONLY WHEN YOU MUST — IT HEARS YOU. KEEP THE LIGHT OFF NEAR THE DISH.</div>
    `
    uiLayer.appendChild(l)
    l.querySelector('#retry')!.addEventListener('click', ()=> startGame())
    l.querySelector('#title2')!.addEventListener('click', ()=> { state='title'; renderUI() })
    return
  }
}

function advanceDialogue(){
  dialogueIndex++
  if(dialogueIndex >= dialogueQueue.length){
    dialogueQueue=[]; dialogueIndex=0; state='playing'
  }
  renderUI()
}

function showTapeDialogue(idx:number){
  const texts = [
    {title:'TAPE 01 — DR. KELLER — 02.14.98', text:'“We picked up the pattern again at 03:17. Same interval. 7.4 seconds. It’s not a pulsar. It repeats our own callsign back at us, delayed. Whoever’s listening… learned our voice.”<br><br><span style="color:#666">— snow crunches under boots, wind cuts the mic —</span>'},
    {title:'TAPE 02 — TECH CHEN — 02.15.98', text:'“Generator’s failing. Temperature inside the dome dropped to -9. The dish is moving on its own. Not the motor — the whole assembly. Like something’s pulling it. Don’t look at the tree line after 22:00.”'},
    {title:'TAPE 03 — OPERATOR VOSS — 02.16.98', text:'“I saw it between the pines. Tall. Too thin. It stands where the signal is strongest. If you shine a light on it, it knows. If you run, it hears. Keep walking. Steady. Don’t—”<br><br><span style="color:#c44">[TAPE CUTS TO STATIC]</span>'},
    {title:'TAPE 04 — FINAL ENTRY — 02.17.98', text:'“We tuned the transmitter to 147.7 to block it. The last one. If you’re hearing this, set the dish to north, restore power at the shed, and broadcast. It can’t stay where there’s noise. Good luck.”<br><br><span style="color:#6a6">→ OBJECTIVE UPDATED: ACTIVATE THE TRANSMITTER AT THE DISH (E)</span>'},
  ]
  dialogueQueue = [texts[idx]]
  dialogueIndex=0
  state='tape'
  audio.playPickup()
  audio.playStatic()
  renderUI()
}

function startGame(){
  player.pos.set(-2,0,10)
  player.yaw = -0.18
  player.stamina = 1
  invuln=0
  tapes.forEach(t=>{ t.collected=false; t.mesh.visible=true; t.mesh.scale.set(1,1,1) })
  tapesCollected=0
  entityPos.set(38,0,-8)
  entityGroup.position.copy(entityPos)
  entityState='patrol'
  entityStun=0
  proximity=0
  wonTimer=0
  txGroup.userData.activated=false
  ;(txGroup.userData.light.material as THREE.MeshBasicMaterial).color.setHex(0x30ff30)
  state='playing'
  // reset fog intensity
  scene.fog = new THREE.Fog(0x9aa8b8, 18, 72)
  renderUI()
  // focus
  renderer.domElement.focus()
}

// Input handling for game states
window.addEventListener('keydown', e=>{
  const k = e.code.toLowerCase()
  if(state==='bios' && (k==='enter'||k==='space'||k==='keyx')){
    audio.init()
    state='title'; renderUI()
  } else if(state==='title'){
    if(k==='arrowup'||k==='keyw'){ titleSelect = Math.max(0, titleSelect-1); renderUI() }
    if(k==='arrowdown'||k==='keys'){ titleSelect = Math.min(2, titleSelect+1); renderUI() }
    if(k==='enter'||k==='space'){
      if(titleSelect===0) startGame()
      else if(titleSelect===1) startGame()
      else if(titleSelect===2){ flashlightOn=!flashlightOn; renderUI() }
    }
  } else if(state==='tape'){
    if(k==='keye'||k==='enter'||k==='space') advanceDialogue()
  } else if(state==='playing'){
    if(k==='escape'||k==='keyp'){ state='paused'; renderUI() }
    if(k==='keyf'){ flashlightOn=!flashlightOn; audio.playTone(420,0.08,'square',0.18); renderUI() }
    if(k==='keym'){ if(audio.master) audio.master.gain.value = audio.master.gain.value>0?0:0.45 }
    if(k==='keye'){
      // interact: tape or transmitter
      // check tapes
      for(let i=0;i<tapes.length;i++){
        const t = tapes[i]
        if(t.collected) continue
        if(player.pos.distanceTo(t.pos) < 2.1){
          t.collected=true; t.mesh.visible=false; tapesCollected++
          showTapeDialogue(i)
          return
        }
      }
      // transmitter
      const txPos = txGroup.position
      if(tapesCollected>=4 && player.pos.distanceTo(txPos) < 2.6){
        txGroup.userData.activated=true
        audio.playTone(660,1.2,'sine',0.32)
        setTimeout(()=> audio.playTone(880,1.5,'sine',0.32), 300)
        wonTimer=0.1
      } else if(tapesCollected<4 && player.pos.distanceTo(txPos) < 2.6){
        dialogueQueue=[{title:'TRANSMITTER — OFFLINE', text:`NEED ${4-tapesCollected} MORE TAPE(S) TO RECALIBRATE FREQUENCY. CHECK THE SHEDS AND TOWER.`}]
        dialogueIndex=0; state='tape'; renderUI()
      }
    }
  } else if(state==='paused'){
    if(k==='escape'){ state='playing'; renderUI() }
  } else if(state==='won'||state==='lost'){
    if(k==='enter'||k==='space'||k==='keyr'){ startGame() }
    if(k==='escape'){ state='title'; renderUI() }
  }
})

// Resize
function onResize(){
  renderer.setSize(window.innerWidth, window.innerHeight)
  // keep low-res target
  rt.setSize(PSX_WIDTH, PSX_HEIGHT)
  // update crt quad texture
}
window.addEventListener('resize', onResize)

// Game loop
const clock = new THREE.Clock()
let frameAcc=0

function animate(){
  requestAnimationFrame(animate)
  const dt = Math.min(0.033, clock.getDelta())
  const time = clock.elapsedTime
  frameAcc+=dt

  // Update PSX jitter
  const jitter = state==='playing' ? (proximity*0.6 + 0.4) : 1.0
  updatePsxMaterials(psxMaterials, time, jitter)
  crtMat.uniforms.uTime.value = time

  // Bios auto timer
  if(state==='bios'){
    biosTimer+=dt
    // subtle dish rotation even in bios? world still renders behind? we render scene anyway
  }

  // Dish slowly tracks player when not won
  if(dishGroup){
    const targetYaw = Math.atan2(player.pos.x - dishGroup.position.x, player.pos.z - dishGroup.position.z)
    dishGroup.rotation.y += (targetYaw - dishGroup.rotation.y)*dt*0.25
    dishGroup.rotation.y += Math.sin(time*0.3)*0.002
  }
  // Tower light blink
  if(towerLight){
    const on = Math.floor(time*1.8)%2===0
    ;(towerLight.material as THREE.MeshBasicMaterial).color.setHex(on?0xff2222:0x440000)
    towerLight.scale.setScalar(on?1:0.72)
  }
  // Tape hover + ring pulse
  tapes.forEach(t=>{
    if(t.collected) return
    const g = t.mesh
    g.position.y = t.pos.y + Math.sin(time*1.6 + g.userData.tapeIndex)*0.10
    g.rotation.y += dt*0.75
    // ring pulse
    g.children.forEach((c: any)=>{
      if(c.userData.phase!==undefined){
        const s = 1 + Math.sin(time*2.2 + c.userData.phase)*0.08
        c.scale.set(s,s,1)
        const m = c as THREE.Mesh; const mat = m.material as THREE.MeshBasicMaterial
        mat.opacity = 0.18 + Math.sin(time*2.8 + c.userData.phase)*0.08
      }
      if(c.userData.isArrow){
        c.position.y = 1.05 + Math.sin(time*2.4)*0.07
      }
    })
    // proximity glow intensity
    const dist = player.pos.distanceTo(t.pos)
    const glow = g.children.find((c: any)=>c.userData.base!==undefined) as THREE.Mesh
    if(glow){
      const gm = glow.material as THREE.MeshBasicMaterial
      gm.opacity = THREE.MathUtils.clamp(0.32 - dist*0.04, 0.08, 0.32)
    }
  })

  if(state==='playing'){
    // Player movement - tank controls
    const axis = input.getAxis() // x = turn, y = forward
    const isRun = input.isDown('shiftleft') || input.isDown('shiftright') || input.isDown('gamepad')
    let turn = axis.x
    // Also Q/E for strafe? No, keep tank
    // Keyboard A/D already mapped to x, so that works as turn
    // But W/S is forward/back via y
    let forward = axis.y

    // If using mouse, allow free look? Keep tank only
    // Apply deadzone
    if(Math.abs(turn)<0.08) turn=0
    if(Math.abs(forward)<0.08) forward=0

    const turnSpeed = isRun ? 2.2 : 1.65
    const moveSpeed = isRun ? 5.2 : 2.9
    if(player.stamina <= 0.02 && isRun) {
      // exhausted - slow
    }
    const actualMoveSpeed = (player.stamina<=0.02 && isRun) ? 1.7 : moveSpeed
    player.yaw += turn * turnSpeed * dt

    // stamina
    if(isRun && (Math.abs(forward)>0.1 || Math.abs(turn)>0.3)){
      player.stamina = Math.max(0, player.stamina - dt*0.22)
    } else {
      player.stamina = Math.min(1, player.stamina + dt*0.38)
    }

    // movement vector in yaw direction
    if(Math.abs(forward) > 0.01){
      const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw))
      const move = dir.multiplyScalar(forward * actualMoveSpeed * dt)
      const next = player.pos.clone().add(move)
      // simple slide - try x then z
      if(!checkCollision(new THREE.Vector3(next.x,0,player.pos.z))) player.pos.x = next.x
      if(!checkCollision(new THREE.Vector3(player.pos.x,0,next.z))) player.pos.z = next.z
      // footstep
      if(forward!==0){
        footstepTimer -= dt * (isRun? 2.1 : 1.0) * (Math.abs(forward)>0.5?1:0.6)
        if(footstepTimer<=0){
          footstepTimer = isRun ? 0.28 : 0.42
          audio.playFootstep(isRun, true)
          // emit sound for entity
          hearTimer = isRun ? 1.6 : 0.7
        }
      }
    } else {
      footstepTimer = Math.max(0, footstepTimer - dt)
      hearTimer = Math.max(0, hearTimer - dt)
    }

    // Entity AI
    const distToPlayer = entityGroup.position.distanceTo(player.pos)
    proximity = THREE.MathUtils.clamp(1 - distToPlayer/22, 0, 1)
    // Flashlight proximity penalty - light makes you more visible
    const lightPenalty = flashlightOn ? 0.12 : 0
    const visibleDist = 16 + lightPenalty*10 + (isRun?4:0)
    const canSee = distToPlayer < visibleDist && distToPlayer > 1.0

    // State transitions
    if(entityStun>0){
      entityStun-=dt
      entityState='stun'
      if(entityStun<=0) entityState='patrol'
    } else if(canSee && (proximity>0.32 || hearTimer>0)){
      entityState='chase'
    } else if(entityState==='chase' && distToPlayer>24){
      entityState='patrol'
      entityPatrolTarget.set((Math.random()-0.5)*30+8,0,(Math.random()-0.5)*30)
    }

    let eSpeed = entityState==='chase' ? 3.45 : entityState==='stun' ? 0 : 1.45
    // Near transmitter when won, entity slows
    if(wonTimer>0) eSpeed*=0.35

    if(entityState!=='stun'){
      // Move toward target
      let target: THREE.Vector3
      if(entityState==='chase') target = player.pos
      else target = entityPatrolTarget
      const dir = target.clone().sub(entityGroup.position)
      dir.y=0
      const dist = dir.length()
      if(dist>0.12){
        dir.normalize()
        // desired yaw
        const desiredYaw = Math.atan2(dir.x, dir.z)
        let diff = desiredYaw - entityYaw
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        entityYaw += diff * dt * 4.2
        const move = dir.multiplyScalar(eSpeed*dt)
        const nextE = entityGroup.position.clone().add(move)
        // simple obstacle avoid: if collider, rotate
        if(!checkCollision(nextE, 0.5)){
          entityGroup.position.copy(nextE)
        } else {
          entityYaw += Math.PI*0.22
          entityPatrolTarget.set((Math.random()-0.5)*40,0,(Math.random()-0.5)*40)
        }
        entityGroup.rotation.y = entityYaw
        // bob
        entityGroup.position.y = Math.sin(time* (entityState==='chase'? 9:4.2))*0.06
      } else if(entityState==='patrol'){
        entityPatrolTarget.set((Math.random()-0.5)*34+6,0,(Math.random()-0.5)*34)
      }
    }

    // Flashlight as weapon - stun if close and facing (adversarial balance: reduced range)
    if(flashlightOn && distToPlayer < 4.2){
      const toEntity = entityGroup.position.clone().sub(player.pos).normalize()
      const forwardVec = new THREE.Vector3(Math.sin(player.yaw),0,Math.cos(player.yaw))
      const dot = forwardVec.dot(toEntity)
      if(dot>0.82 && entityStun<=0){
        entityStun = 1.1
        entityState='stun'
        // knockback
        entityGroup.position.add(toEntity.multiplyScalar(0.9))
        audio.playStatic()
      }
    }

    // Collision with entity = lose
    if(invuln<=0 && distToPlayer < 1.05){
      audio.playHurt()
      state='lost'
      renderUI()
    }
    invuln = Math.max(0, invuln - dt)

    // Audio proximity
    audio.setProximity(proximity)

    // Win condition
    if(wonTimer>0){
      wonTimer+=dt
      // transmitter light fast blink
      const m = txGroup.userData.light.material as THREE.MeshBasicMaterial
      const on = Math.floor(wonTimer*8)%2===0
      m.color.setHex(on?0xffffff:0x30ff30)
      // screen shake
      camera.position.x += (Math.random()-0.5)*0.04
      camera.position.y += (Math.random()-0.5)*0.04
      scene.fog = new THREE.Fog(0x9aa8b8, 14 + Math.sin(wonTimer*6)*2, 62)
      if(wonTimer>3.2){
        state='won'; renderUI()
      }
    }

    // Out of bounds soft return
    if(player.pos.length()>74){
      player.pos.multiplyScalar(0.985)
    }

  } else if(state==='won' || state==='lost'){
    // keep entity moving slightly
  }

  // Camera - PSX style: third-person follow with slight lag + fixed height, wobble
  const camDist = 5.2
  const camHeight = 2.15
  const targetCamPos = new THREE.Vector3(
    player.pos.x - Math.sin(player.yaw)*camDist,
    camHeight + Math.sin(time*0.6)*0.03,
    player.pos.z - Math.cos(player.yaw)*camDist
  )
  // Ray-like collision for camera - if inside collider, pull closer
  // simple check: if targetCamPos inside collider, lerp closer to player
  let camPos = targetCamPos
  for(const b of colliders){
    if(camPos.x > b.min.x && camPos.x < b.max.x && camPos.z > b.min.z && camPos.z < b.max.z){
      camPos = player.pos.clone().lerp(camPos, 0.38)
      camPos.y = camHeight
    }
  }
  camera.position.lerp(camPos, state==='playing' ? 0.14 : 0.04)
  const lookAt = player.pos.clone().add(new THREE.Vector3(0,1.02,0))
  camera.lookAt(lookAt)
  // Subtle PS1 camera jitter (quantized)
  camera.position.x = Math.round(camera.position.x*64)/64
  camera.position.y = Math.round(camera.position.y*64)/64
  camera.position.z = Math.round(camera.position.z*64)/64

  // Flashlight follows camera/player
  flash.position.copy(player.pos).add(new THREE.Vector3(0,1.18,0))
  flash.position.add(new THREE.Vector3(Math.sin(player.yaw)*0.22,0,Math.cos(player.yaw)*0.22))
  const flashTarget = player.pos.clone().add(new THREE.Vector3(Math.sin(player.yaw)*12, -0.35, Math.cos(player.yaw)*12))
  flash.target.position.copy(flashTarget)
  flash.intensity = flashlightOn ? (state==='playing'? 4.6:1.2) : 0
  // flicker when low tapes?
  if(flashlightOn && proximity>0.5){
    flash.intensity *= 0.86 + Math.random()*0.28
  }

  // Shadow under player
  shadow.position.set(player.pos.x,0.02,player.pos.z)

  // Fog pulsate with entity proximity for horror
  if(state==='playing'){
    const fogNear = 16 - proximity*6
    const fogFar = 68 - proximity*18
    ;(scene.fog as THREE.Fog).near = THREE.MathUtils.lerp((scene.fog as THREE.Fog).near, fogNear, dt*1.2)
    ;(scene.fog as THREE.Fog).far = THREE.MathUtils.lerp((scene.fog as THREE.Fog).far, fogFar, dt*1.2)
  }

  // Render to low-res target
  renderer.setRenderTarget(rt)
  renderer.setClearColor(scene.background as THREE.Color, 1)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  // Composite CRT
  renderer.setClearColor(0x000000,1)
  renderer.render(crtScene, crtCam)

  // Static interference overlay intensity based on proximity
  const staticIntensity = proximity*0.55 + (wonTimer>0?0.3:0)
  overlay.style.opacity = `${0.18 + staticIntensity*0.32}`
  flicker.style.opacity = `${proximity*0.08}`

  // Kick UI updates for stamina/signal without full rerender? we just update DOM directly for perf
  if(state==='playing' && frameAcc>0.18){
    frameAcc=0
    // update HUD numbers directly
    const sig = document.getElementById('sig-fill') as HTMLElement | null
    if(sig) sig.style.width = `${Math.min(100, tapesCollected*25 + proximity*30)}%`
    const stam = document.getElementById('stam-fill') as HTMLElement | null
    if(stam){ stam.style.width = `${player.stamina*100}%` }
  }
}

// Initial UI
renderUI()
animate()

// Click to lock pointer for mouse look (optional)
renderer.domElement.addEventListener('click', ()=>{
  if(state==='playing' && document.pointerLockElement!==renderer.domElement){
    // only lock if user wants FPS-style turn; we still support but not required
    // renderer.domElement.requestPointerLock()
    if(audio.ctx?.state==='suspended') audio.ctx.resume()
    if(!audio.enabled) audio.init()
  }
})

// Handle visibility
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden && state==='playing'){ state='paused'; renderUI() }
})

// Expose for debug
;(window as any).GAME = { player, entityGroup, tapes, state: ()=>state, audio, psxMaterials }
