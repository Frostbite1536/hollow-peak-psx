import './style.css'
import * as THREE from 'three'
import { PSX_WIDTH, PSX_HEIGHT, psxifyMaterial, CRTFragment, CRTVertex, updatePsxMaterials } from './engine/psx'
import { Input } from './game/input'
import { AudioManager } from './game/audio'
import { createWorld } from './game/world'
import { SonicAdventureLevel } from './game/sonicAdventure'

// Types
type GameState = 'bios'|'title'|'playing'|'paused'|'tape'|'tuning'|'won'|'lost'|'sonic'

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

// Touch controls for mobile
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints||0)>0
const touch = { f:0, b:0, l:0, r:0, run:0, interact:0, light:0, map:0 }
let touchLayer: HTMLDivElement | null = null
if(isTouch){
  touchLayer = document.createElement('div')
  touchLayer.id='touch-controls'
  touchLayer.innerHTML=`
    <div class="touch-stick" id="touch-move">
      <div class="touch-btn" data-k="f">▲</div>
      <div style="display:flex;gap:8px"><div class="touch-btn" data-k="l">◀</div><div class="touch-btn" data-k="b">▼</div><div class="touch-btn" data-k="r">▶</div></div>
    </div>
    <div class="touch-actions">
      <div class="touch-btn touch-run" data-k="run">RUN</div>
      <div class="touch-btn touch-act" data-k="interact">E</div>
      <div class="touch-btn" data-k="light">☀</div>
      <div class="touch-btn" data-k="map">MAP</div>
    </div>
  `
  container.appendChild(touchLayer)
  const bind = (el: Element, k:string, v: number)=>{
    const set = (on:boolean)=>{ (touch as any)[k]= on?1:0 }
    el.addEventListener('touchstart', e=>{ e.preventDefault(); set(true) }, {passive:false})
    el.addEventListener('touchend', e=>{ e.preventDefault(); set(false) }, {passive:false})
    el.addEventListener('touchcancel', e=>{ e.preventDefault(); set(false) }, {passive:false})
    el.addEventListener('mousedown', ()=> set(true))
    el.addEventListener('mouseup', ()=> set(false))
    el.addEventListener('mouseleave', ()=> set(false))
  }
  touchLayer.querySelectorAll('[data-k]').forEach(el=> bind(el, el.getAttribute('data-k')!, 1))
  // map light to actual actions via polling
}

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
    uDistortion: { value: 0.12 },
    uScanline: { value: 0.38 },
    uChroma: { value: 0.0010 }
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
const { tapes, colliders, dishGroup, towerLight, txGroup, doorGroup, genGroup, keyGroup, fuseGroup, fuelGroup, batteries, interiorGroup, interiorSwitches, snowfall, snowGeo, snowPos, snowVel } = createWorld(scene, psxMaterials)

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
let sonicLevel: SonicAdventureLevel | null = null
let activeLevel: 'hollow'|'sonic' = 'hollow'

// Game state
let state: GameState = 'bios'
let biosTimer = 0
let titleSelect = 0
let dialogueQueue: {title:string, text:string}[] = []
let dialogueIndex = 0
let tapesCollected = 0
let flashlightOn = true
let flashlightBattery = 1.0 // 0-1, drains when on, batteries restore
let batteriesCollected = 0
let hasKey = false
let hasFuse = false
let hasFuel = false
let generatorRepaired = false
let doorUnlocked = false
let radioFreq = 100.0 // MHz, need 147.7
let tuning = false
let tuningHold = 0
let footstepTimer = 0
let proximity = 0
let invuln = 0
let wonTimer = 0
let showMap = false
let objectivePulse = 0
let switchesOn = [false,false,false]
let lastHeardPos: THREE.Vector3 | null = null
let stillTimer = 0 // hiding mechanic
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let difficulty: 'easy'|'normal'|'hard' = (localStorage.getItem('hp_difficulty') as any) || 'normal'
let autoSaveTimer = 0

function saveGame(){
  try{
    const data = { tapesCollected, hasKey, hasFuse, hasFuel, generatorRepaired, doorUnlocked, batteriesCollected, flashlightBattery, radioFreq, switchesOn, playerPos: player.pos.toArray(), playerYaw: player.yaw, tapes: tapes.map(t=>t.collected), batteries: batteries.map(b=>!b.visible) }
    localStorage.setItem('hp_save_v3', JSON.stringify(data))
    localStorage.setItem('hp_save_v2', JSON.stringify(data))
  }catch{}
}
function loadGame():boolean{
  try{
    const raw = localStorage.getItem('hp_save_v3') || localStorage.getItem('hp_save_v2')
    if(!raw) return false
    const d = JSON.parse(raw)
    tapesCollected = d.tapesCollected||0; hasKey=!!d.hasKey; hasFuse=!!d.hasFuse; hasFuel=!!d.hasFuel; generatorRepaired=!!d.generatorRepaired; doorUnlocked=!!d.doorUnlocked; batteriesCollected=d.batteriesCollected||0; flashlightBattery=d.flashlightBattery||1; radioFreq=d.radioFreq||100
    if(d.switchesOn) switchesOn = d.switchesOn.slice(0,3)
    if(d.playerPos) player.pos.fromArray(d.playerPos); if(d.playerYaw) player.yaw=d.playerYaw
    if(d.tapes) tapes.forEach((t,i)=>{ t.collected=!!d.tapes[i]; t.mesh.visible=!t.collected; if(t.collected) tapesCollected++ })
    tapesCollected = tapes.filter(t=>t.collected).length
    if(d.batteries) batteries.forEach((b,i)=>{ if(d.batteries[i]) b.visible=false })
    keyGroup.visible=!hasKey; fuseGroup.visible=!hasFuse; fuelGroup.visible=!hasFuel
    if(doorUnlocked) doorGroup.visible=false
    if(generatorRepaired){ const gl = genGroup.userData.light as THREE.Mesh; (gl.material as THREE.MeshBasicMaterial).color.setHex(0x2ecc71) }
    interiorSwitches.forEach((sg,i)=>{
      const on = !!switchesOn[i]
      sg.userData.on = on
      const lever = sg.userData.lever as THREE.Mesh; lever.rotation.x = on ? -Math.PI*0.28 : Math.PI*0.38
      const light = sg.userData.light as THREE.Mesh; (light.material as THREE.MeshBasicMaterial).color.setHex(on?0x2ecc71:0x442222)
    })
    return true
  }catch{ return false }
}
function clearSave(){ localStorage.removeItem('hp_save_v3'); localStorage.removeItem('hp_save_v2') }

// Flashlight
const flash = new THREE.SpotLight(0xfff4c8, 4.2, 22, Math.PI*0.31, 0.5, 1.8)
flash.position.set(0,1.2,0)
scene.add(flash)
scene.add(flash.target)

// Door-aware collision: allow passage through door opening when unlocked
function checkCollision(next: THREE.Vector3, radius=0.45){
  for(let i=0;i<colliders.length;i++){
    const b = colliders[i]
    // observatory is index 0 - make doorway passable when unlocked
    if(i===0 && doorUnlocked){
      const doorX = 22, doorZ = 5.05
      const doorHalfW = 1.35
      const isAtDoor = Math.abs(next.x - doorX) < doorHalfW + radius && Math.abs(next.z - doorZ) < 0.9
      if(isAtDoor) continue
    }
    const clamped = new THREE.Vector3(
      Math.max(b.min.x, Math.min(b.max.x, next.x)),
      0,
      Math.max(b.min.z, Math.min(b.max.z, next.z))
    )
    const dx = next.x - clamped.x
    const dz = next.z - clamped.z
    if(dx*dx+dz*dz < radius*radius) return true
  }
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
    const hasSave = !!localStorage.getItem('hp_save_v2')
    const menu = document.createElement('div'); menu.className='menu-screen'
    const title = 'HOLLOW PEAK'
    menu.innerHTML = `
      <div class="menu-title">${title}</div>
      <div class="menu-subtitle">WINTER 1998 — THE SIGNAL WENT DARK</div>
      <div class="menu-options" id="menu-opts"></div>
      <div class="menu-footer">
        TANK CONTROLS: W/S MOVE • A/D TURN • SHIFT RUN • E INTERACT • TAB MAP • F FLASHLIGHT<br>
        KEY→FUSE→FUEL→GEN→TAPES→DOOR→ALIGN 3×INSIDE→TUNE 147.7MHz • BAT DRAINS • HOLD STILL+DARK TO HIDE<br>
        <span style="color:#6ab0ff">PSX: 320×240 • GTE SNAP • AFFINE 0.32 • 192-DEPTH • CRT 0.12 • SNOW 450/f • 126KB GZIP</span> &nbsp; <span style="color:#2ecc71">● MAP: TAB/Q</span> ${prefersReducedMotion?'<span style="color:#ffaa44">[REDUCED MOTION]</span>':''}
      </div>
    `
    uiLayer.appendChild(menu)
    const opts = menu.querySelector('#menu-opts')!
    const options = [
      {label:'HOLLOW PEAK — NEW GAME', action:()=> { clearSave(); startGame() }},
      {label:'SONIC ADVENTURE — DREAMCAST TEST', action:()=> startSonicLevel()},
      {label: hasSave ? 'CONTINUE ●' : 'CONTINUE', action:()=> { if(hasSave && loadGame()){ state='playing'; renderUI(); } else startGame() }},
      {label:`DIFFICULTY: ${difficulty.toUpperCase()}`, action:()=> { difficulty = difficulty==='easy'?'normal':difficulty==='normal'?'hard':'easy'; localStorage.setItem('hp_difficulty', difficulty); renderUI() }},
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
    // HUD with inventory + objectives — extended chain with interior alignment
    const switchesDone = switchesOn.every(Boolean)
    const objText = !hasKey ? 'FIND KEY [GARAGE]' : !hasFuse ? 'FIND FUSE [TOWER]' : !hasFuel ? 'FIND FUEL [BUNKER]' : !generatorRepaired ? 'REPAIR GENERATOR [SHED] E' : tapesCollected<4 ? `TAPES ${tapesCollected}/4` : !doorUnlocked ? 'UNLOCK OBSERVATORY [KEY] E' : !switchesDone ? `ALIGN DISH [INSIDE ${switchesOn.filter(Boolean).length}/3]` : 'TUNE TRANSMITTER 147.7 MHz [E]'
    const objColor = objectivePulse>0 ? '#ff6b6b' : '#6ab0ff'
    const hud = document.createElement('div'); hud.className='hud'
    hud.innerHTML = `
      <div class="hud-top">
        <div>
          <div style="font-size:9px;color:#666;letter-spacing:0.2em;margin-bottom:4px">HOLLOW PEAK // ${generatorRepaired?'POWER ON':'POWER OFF'} • ${objText}</div>
          <div class="hud-tapes" id="hud-tapes"></div>
          <div style="display:flex;gap:6px;margin-top:6px;font-size:9px">
            <span style="padding:2px 6px;border:1px solid ${hasKey?'#d4b024':'#333'};background:${hasKey?'#2a2210':'#111'};color:${hasKey?'#ffd84d':'#444'}">KEY ${hasKey?'●':''}</span>
            <span style="padding:2px 6px;border:1px solid ${hasFuse?'#4a8ac8':'#333'};background:${hasFuse?'#102030':'#111'};color:${hasFuse?'#6ab8ff':'#444'}">FUSE ${hasFuse?'●':''}</span>
            <span style="padding:2px 6px;border:1px solid ${hasFuel?'#c0392b':'#333'};background:${hasFuel?'#2a1010':'#111'};color:${hasFuel?'#ff6b6b':'#444'}">FUEL ${hasFuel?'●':''}</span>
            <span style="padding:2px 6px;border:1px solid ${generatorRepaired?'#2ecc71':'#333'};background:${generatorRepaired?'#0f2a14':'#111'};color:${generatorRepaired?'#2ecc71':'#444'}">GEN ${generatorRepaired?'ON':'OFF'}</span>
            <span style="padding:2px 6px;border:1px solid #333;background:#111;color:${flashlightBattery<0.25?'#ff4444':'#aaa'}">BAT ${Math.floor(flashlightBattery*100)}% ${flashlightBattery<0.15?'⚠':''}</span>
          </div>
        </div>
        <div class="hud-signal">
          <div>SIGNAL: <span style="color:${proximity>0.6?'#e55':'#888'}">${tapesCollected}/4 TAPES</span> <span style="font-size:9px;color:${objColor}">▶ ${objText}</span></div>
          <div class="signal-bar"><div class="signal-fill" id="sig-fill"></div></div>
          <div style="font-size:9px;color:#555;margin-top:2px">${flashlightOn && flashlightBattery>0?'FLASHLIGHT ON':'FLASHLIGHT OFF'} • FREQ ${radioFreq.toFixed(1)} • ${Math.floor(player.stamina*100)}% STAM ${showMap?'• MAP [M] ON':''}</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-controls">
          <div><b>W/S</b> MOVE &nbsp; <b>A/D</b> TURN &nbsp; <b>SHIFT</b> RUN &nbsp; <b>E</b> INTERACT &nbsp; <b>TAB</b> MAP</div>
          <div><b>F</b> FLASHLIGHT &nbsp; <b>ESC</b> PAUSE &nbsp; <b>M</b> MUTE</div>
          <div class="stamina-bar"><div class="stamina-fill" id="stam-fill"></div></div>
          <div style="width:100px;height:4px;background:#111;border:1px solid #222;margin-top:4px"><div id="bat-fill" style="height:100%;background:${flashlightBattery<0.2?'#c44':'#2ecc71'};width:${flashlightBattery*100}%"></div></div>
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
    // @ts-ignore
    // Map overlay (TAB)
    if(showMap && state==='playing'){
      const mapEl = document.createElement('div')
      mapEl.style.cssText='position:absolute;right:14px;top:68px;width:190px;height:190px;background:rgba(8,12,16,0.92);border:1px solid #333;border-top:2px solid #6ab0ff;padding:8px;pointer-events:none'
      mapEl.innerHTML=`
        <div style="font-size:9px;letter-spacing:0.18em;color:#6ab0ff;margin-bottom:6px">SITE MAP — HOLLOW PEAK</div>
        <div style="position:relative;width:172px;height:132px;background:#0d141e;border:1px solid #222;overflow:hidden">
          <div style="position:absolute;left:50%;top:50%;width:2px;height:2px;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 4px #fff"></div>
          <div id="map-player" style="position:absolute;width:6px;height:6px;background:#ffd84d;border:1px solid #000;transform:translate(-50%,-50%) rotate(${player.yaw}rad);left:${50 + player.pos.x*0.9}%;top:${50 - player.pos.z*0.9}%"><div style="width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:5px solid #ffd84d;position:absolute;left:50%;top:-3px;transform:translateX(-50%)"></div></div>
          <div style="position:absolute;left:${50+22*0.9}%;top:${50-0*0.9}%;width:10px;height:10px;background:#8a9aa8;border:1px solid #fff;transform:translate(-50%,-50%)" title="OBS"></div>
          <div style="position:absolute;left:${50+18*0.9}%;top:${50+16*0.9}%;width:7px;height:7px;background:#3a4a3a;border:1px solid #2ecc71;transform:translate(-50%,-50%);opacity:${generatorRepaired?1:0.5}"></div>
          <div style="position:absolute;left:${50-6*0.9}%;top:${50-22*0.9}%;width:6px;height:6px;background:#4a8ac8;transform:translate(-50%,-50%)"></div>
          <div style="position:absolute;left:${50+2*0.9}%;top:${50+24*0.9}%;width:6px;height:6px;background:#c0392b;transform:translate(-50%,-50%)"></div>
          <div style="position:absolute;left:${50-14*0.9}%;top:${50+8*0.9}%;width:6px;height:6px;background:#7a6a3a;transform:translate(-50%,-50%)"></div>
          ${tapes.map((t,i)=> t.collected?'':`<div style="position:absolute;left:${50+t.pos.x*0.9}%;top:${50-t.pos.z*0.9}%;width:5px;height:5px;background:${['#e85d5d','#5da6e8','#7ad67a','#e8c55d'][i]};border-radius:50%;box-shadow:0 0 4px currentColor;transform:translate(-50%,-50%)"></div>`).join('')}
          ${!hasKey?`<div style="position:absolute;left:${50-16.2*0.9}%;top:${50+8.8*0.9}%;width:5px;height:5px;background:#d4b024;transform:translate(-50%,-50%) rotate(45deg)"></div>`:''}
          ${!hasFuse?`<div style="position:absolute;left:${50-7.6*0.9}%;top:${50-21.2*0.9}%;width:5px;height:5px;background:#4a8ac8;transform:translate(-50%,-50%)"></div>`:''}
          ${!hasFuel?`<div style="position:absolute;left:${50+3.8*0.9}%;top:${50+24.6*0.9}%;width:5px;height:5px;background:#c0392b;transform:translate(-50%,-50%)"></div>`:''}
          ${batteries.map(b=> b.visible?`<div style="position:absolute;left:${50+b.position.x*0.9}%;top:${50-b.position.z*0.9}%;width:4px;height:4px;background:#2ecc71;border-radius:50%;transform:translate(-50%,-50%)"></div>`:'').join('')}
          <div style="position:absolute;left:${50+entityGroup.position.x*0.9}%;top:${50-entityGroup.position.z*0.9}%;width:4px;height:4px;background:#ff2222;border-radius:50%;opacity:${proximity>0.35?0.9:0.28};box-shadow:0 0 6px #ff2222;transform:translate(-50%,-50%)"></div>
        </div>
        <div style="font-size:7px;color:#555;margin-top:4px;line-height:1.4">YELLOW=KEY BLUE=FUSE RED=FUEL GREEN=BAT • TAPES=COLORED DOTS<br>▲ YOU • RED DOT=LISTENER ${proximity>0.5?'[NEAR!]':''}</div>
        <div style="font-size:7px;color:#6ab0ff;margin-top:2px">${hasKey?'[KEY]':''} ${hasFuse?'[FUSE]':''} ${hasFuel?'[FUEL]':''} ${generatorRepaired?'GEN-ON':'GEN-OFF'} ${doorUnlocked?'DOOR-OPEN':''}</div>
      `
      uiLayer.appendChild(mapEl)
    }
    return
  }
  if(state==='sonic'){
    // Dreamcast Sonic HUD - glossy, vibrant, no PSX dither
    const hudData = sonicLevel ? sonicLevel.getHUD() : { rings:0, time:'00:00', lives:3, speed:'0.0' }
    const hud = document.createElement('div'); hud.className='hud'
    // Dreamcast style: top bar with rings, time, lives, bottom with controls
    hud.innerHTML=`
      <div class="hud-top">
        <div>
          <div style="font-family:VT323,monospace;font-size:20px;letter-spacing:0.06em;color:#ffd800;text-shadow:0 1px 0 #8a6d00, 0 0 6px rgba(255,216,0,0.4)">RINGS <span style="color:#fff">${hudData.rings.toString().padStart(2,'0')}</span></div>
          <div style="font-size:10px;color:#fff;letter-spacing:0.12em;margin-top:2px">TIME ${hudData.time} • SPEED ${hudData.speed}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:VT323,monospace;font-size:18px;color:#ff3b30;text-shadow:0 1px 0 #7a0a00">LIVES <span style="color:#fff">${hudData.lives}</span></div>
          <div style="font-size:9px;color:#cce6ff;letter-spacing:0.16em;margin-top:2px">SONIC ADVENTURE • DREAMCAST</div>
          <div style="font-size:8px;color:#8ec8ff;margin-top:2px">EMERALD COAST TEST ZONE</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-controls" style="color:#b0d0ff">
          <div><b style="color:#fff">WASD</b> MOVE • <b style="color:#fff">SPACE</b> JUMP/HOMING • <b style="color:#fff">SHIFT</b> RUN</div>
          <div><b style="color:#fff">MOUSE</b> CAMERA • <b style="color:#fff">ESC</b> PAUSE • <b style="color:#fff">E</b> SPIN DASH</div>
        </div>
        <div class="compass" style="color:#ffd800">▲ ${Math.round((sonicLevel?.yaw||0)*180/Math.PI)}°</div>
      </div>
    `
    uiLayer.appendChild(hud)
    // Sonic-specific pause / win / lost overlays
    if(sonicLevel){
      if(sonicLevel.state==='won'){
        const w=document.createElement('div'); w.className='menu-screen'; w.style.background='rgba(8,18,32,0.88)'
        w.innerHTML=`
          <div class="gameover-title" style="color:#ffd800;text-shadow:0 0 12px rgba(255,216,0,0.5)">GOAL!</div>
          <div class="menu-subtitle" style="color:#8ec8ff">EMERALD COAST CLEAR • TIME ${hudData.time} • RINGS ${hudData.rings}</div>
          <div class="bios-text" style="margin:14px 0;color:#cce6ff">RANK: ${hudData.rings>=18?'S':hudData.rings>=12?'A':hudData.rings>=8?'B':'C'} • SPEED ${hudData.speed}</div>
          <div class="menu-options"><button class="menu-btn active" id="sAgain"><span>PLAY AGAIN</span></button><button class="menu-btn" id="sTitle"><span>TITLE SCREEN</span></button></div>
          <div class="menu-footer" style="color:#4a8ac8">DREAMCAST • 640×480 • 60FPS • SONIC ADVENTURE STYLE TEST</div>
        `
        uiLayer.appendChild(w)
        w.querySelector('#sAgain')!.addEventListener('click', ()=> startSonicLevel())
        w.querySelector('#sTitle')!.addEventListener('click', ()=> { activeLevel='hollow'; setDreamcastMode(false); location.reload() })
      } else if(sonicLevel.state==='lost'){
        const l=document.createElement('div'); l.className='menu-screen'; l.style.background='rgba(32,8,8,0.88)'
        l.innerHTML=`
          <div class="gameover-title">GAME OVER</div>
          <div class="menu-subtitle" style="color:#ff8a8a">YOU FELL • RINGS ${hudData.rings}</div>
          <div class="menu-options"><button class="menu-btn active" id="sRetry"><span>RETRY</span></button><button class="menu-btn" id="sTitle2"><span>TITLE SCREEN</span></button></div>
        `
        uiLayer.appendChild(l)
        l.querySelector('#sRetry')!.addEventListener('click', ()=> startSonicLevel())
        l.querySelector('#sTitle2')!.addEventListener('click', ()=> { activeLevel='hollow'; setDreamcastMode(false); location.reload() })
      }
    }
  // @ts-ignore
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
  // @ts-ignore
  if(state==='tuning'){
    const diff = Math.abs(radioFreq - 147.7)
    const close = diff < 0.6
    const perfect = diff < 0.15
    uiLayer.innerHTML = '' // clear HUD for tuning overlay
    const tune = document.createElement('div'); tune.className='menu-screen'
    tune.style.background='rgba(4,4,8,0.92)'
    tune.innerHTML=`
      <div style="width:520px;max-width:92vw;background:#0a0a0e;border:1px solid #333;border-top:2px solid ${perfect?'#2ecc71': close?'#d4b024':'#c44'};padding:18px">
        <div style="font-size:10px;letter-spacing:0.2em;color:${perfect?'#2ecc71':'#c44'}">TRANSMITTER // FREQUENCY CALIBRATION</div>
        <div style="font-family:VT323,monospace;font-size:44px;color:${perfect?'#7aff8a':close?'#ffe066':'#e8e8e8'};letter-spacing:0.08em;margin:10px 0">${radioFreq.toFixed(1)} <span style="font-size:18px;color:#888">MHz</span></div>
        <div style="height:18px;background:#111;border:1px solid #333;position:relative;overflow:hidden;margin:8px 0">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${((radioFreq-100)/60)*100}%;background:${perfect?'#2ecc71':close?'#d4b024':'#c44'};box-shadow:0 0 8px ${perfect?'rgba(46,204,113,0.4)':'rgba(196,68,68,0.3)'}"></div>
          <div style="position:absolute;left:${((147.7-100)/60)*100}%;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 4px #fff"></div>
          <div style="position:absolute;left:${((147.7-100)/60)*100 - 2}%;top:-2px;font-size:8px;color:#fff">▲ 147.7</div>
        </div>
        <div style="font-size:10px;color:#666;letter-spacing:0.1em">HOLD <b style="color:#aaa">A/D</b> TO TUNE • <b style="color:#aaa">ENTER</b> TO TRANSMIT ${perfect?'<span style="color:#2ecc71">● LOCKED</span>': close?'<span style="color:#d4b024">◐ CLOSE</span>':'<span style="color:#c44">○ SEARCHING</span>'} • <b style="color:#aaa">ESC</b> CANCEL</div>
        <div style="margin-top:12px;height:2px;background:${perfect?'#2ecc71':'#333'};box-shadow:0 0 6px ${perfect?'#2ecc71':'transparent'}"></div>
        <div style="font-size:9px;color:#555;margin-top:8px">STATIC: ${Math.floor((1 - Math.min(1, diff/30))*100)}% • SIGNAL: ${perfect?'STRONG':close?'WEAK':'NO LOCK'}</div>
      </div>
      <div style="margin-top:14px;font-size:9px;color:#444">TIP: THE LISTENER HUNTS WHILE YOU TUNE — KEEP TAPS SHORT</div>
    `
    uiLayer.appendChild(tune)
    uiLayer.className='ui-layer interactive'
    return
  }
  // @ts-ignore
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
  // @ts-ignore
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
    {title:'TAPE 04 — FINAL ENTRY — 02.17.98', text:'“We tuned the transmitter to 147.7 to block it. The last one. If you’re hearing this, set the dish to north, restore power at the shed, and broadcast. It can’t stay where there’s noise. Good luck.”<br><br><span style="color:#6a6">→ OBJECTIVE UPDATED: FIND KEY→FUSE→FUEL→GENERATOR (E)</span>'},
  ]
  dialogueQueue = [texts[idx]]
  dialogueIndex=0
  state='tape'
  audio.playPickup()
  audio.playStatic()
  renderUI()
}
function doInteract(){
  // same logic as E - extracted for touch
  for(let i=0;i<tapes.length;i++){
    const t = tapes[i]
    if(t.collected) continue
    if(player.pos.distanceTo(t.pos) < 2.1){
      t.collected=true; t.mesh.visible=false; tapesCollected++
      showTapeDialogue(i)
      objectivePulse=1.2; saveGame()
      return true
    }
  }
  if(!hasKey && player.pos.distanceTo(keyGroup.position) < 2.0){
    hasKey=true; keyGroup.visible=false; audio.playPickup()
    dialogueQueue=[{title:'ITEM — RUSTY KEY', text:'RUSTED OBSERVATORY KEY — STAMPED “NORTHLIGHT 1987”. OPENS THE FRONT DOOR.'}]
    dialogueIndex=0; state='tape'; objectivePulse=1.2; saveGame(); renderUI(); return true
  }
  if(!hasFuse && player.pos.distanceTo(fuseGroup.position) < 2.0){
    hasFuse=true; fuseGroup.visible=false; audio.playPickup()
    dialogueQueue=[{title:'ITEM — CERAMIC FUSE 30A', text:'BLOWN FUSE FOR THE GENERATOR. NEED THIS + FUEL TO RESTORE POWER.'}]
    dialogueIndex=0; state='tape'; objectivePulse=1.2; saveGame(); renderUI(); return true
  }
  if(!hasFuel && player.pos.distanceTo(fuelGroup.position) < 2.0){
    hasFuel=true; fuelGroup.visible=false; audio.playPickup()
    dialogueQueue=[{title:'ITEM — FUEL CAN', text:'HALF-FULL DIESEL CAN. HEAVY. FOR THE SHED GENERATOR.'}]
    dialogueIndex=0; state='tape'; objectivePulse=1.2; saveGame(); renderUI(); return true
  }
  for(let i=0;i<batteries.length;i++){
    const bg = batteries[i]
    if(!bg.visible) continue
    if(player.pos.distanceTo(bg.position) < 1.9){
      bg.visible=false; batteriesCollected++; flashlightBattery = Math.min(1, flashlightBattery + 0.42); audio.playPickup()
      dialogueQueue=[{title:'ITEM — BATTERY', text:`FLASHLIGHT BATTERY +42% → ${Math.floor(flashlightBattery*100)}%.`}]
      dialogueIndex=0; state='tape'; saveGame(); renderUI(); return true
    }
  }
  if(player.pos.distanceTo(genGroup.position) < 2.4){
    if(generatorRepaired){
      dialogueQueue=[{title:'GENERATOR — ONLINE', text:'ENGINE HUMS AT 60Hz. POWER RESTORED TO OBSERVATORY. LIGHTS ARE ON.'}]
      dialogueIndex=0; state='tape'; renderUI(); return true
    }
    if(hasFuse && hasFuel){
      generatorRepaired=true; hasFuse=false; hasFuel=false
      const gl = genGroup.userData.light as THREE.Mesh; (gl.material as THREE.MeshBasicMaterial).color.setHex(0x2ecc71)
      audio.playTone(180,0.6,'square',0.32); setTimeout(()=>audio.playTone(360,0.8,'square',0.28), 250)
      dialogueQueue=[{title:'GENERATOR — REPAIRED', text:'FUSE SEATED. FUEL PRIMED. THE GENERATOR ROARS TO LIFE. OBSERVATORY POWER IS RESTORED — DOOR AND TRANSMITTER NOW HAVE POWER.'}]
      dialogueIndex=0; state='tape'; objectivePulse=1.5; saveGame(); renderUI(); return true
    } else {
      let need=[]; if(!hasFuse) need.push('FUSE [TOWER]'); if(!hasFuel) need.push('FUEL [BUNKER]')
      dialogueQueue=[{title:'GENERATOR — OFFLINE', text:`GENERATOR DEAD. NEED: ${need.join(' + ')}. FIND THEM AND RETURN.`}]
      dialogueIndex=0; state='tape'; renderUI(); return true
    }
  }
  if(!doorUnlocked && player.pos.distanceTo(doorGroup.position) < 2.2){
    if(hasKey){
      doorUnlocked=true; doorGroup.visible=false; audio.playTone(540,0.35,'square',0.28)
      dialogueQueue=[{title:'DOOR — UNLOCKED', text:'KEY TURNS WITH A SCREECH. HEAVY DOOR CREAKS OPEN. TRANSMITTER IS INSIDE.'}]
      dialogueIndex=0; state='tape'; objectivePulse=1.2; saveGame(); renderUI(); return true
    } else {
      dialogueQueue=[{title:'DOOR — LOCKED', text:'OBSERVATORY DOOR PADLOCKED. NEED KEY FROM GARAGE.'}]
      dialogueIndex=0; state='tape'; renderUI(); return true
    }
  }
  // Interior console switches — only when inside unlocked observatory with power
  if(doorUnlocked && generatorRepaired){
    for(let i=0;i<interiorSwitches.length;i++){
      const sg = interiorSwitches[i]
      const wp = sg.userData.basePos as THREE.Vector3
      if(player.pos.distanceTo(wp) < 2.2){
        const on = !switchesOn[i]
        switchesOn[i] = on
        sg.userData.on = on
        const lever = sg.userData.lever as THREE.Mesh; lever.rotation.x = on ? -Math.PI*0.28 : Math.PI*0.38
        const light = sg.userData.light as THREE.Mesh; (light.material as THREE.MeshBasicMaterial).color.setHex(on?0x2ecc71:0x442222)
        audio.playTone(on?520:320,0.12,'square',0.2)
        const names = ['AZIMUTH','ELEVATION','PHASE']
        const allOn = switchesOn.every(Boolean)
        dialogueQueue=[{title:`CONSOLE — ${names[i]} ${on?'ON':'OFF'}`, text: allOn ? 'ALL THREE SERVOS ALIGNED. DISH IS TRACKING. READY TO TRANSMIT ON 147.7 MHz.' : `${names[i]} ${on?'ENGAGED':'DISENGAGED'} — ${switchesOn.filter(Boolean).length}/3 ALIGNED. ${on?'TWO MORE':'KEEP ALIGNING'}.`}]
        dialogueIndex=0; state='tape'; objectivePulse=1.0; saveGame(); renderUI(); return true
      }
    }
  }
  if(doorUnlocked && !generatorRepaired){
    for(let i=0;i<interiorSwitches.length;i++){
      const sg = interiorSwitches[i]
      const wp = sg.userData.basePos as THREE.Vector3
      if(player.pos.distanceTo(wp) < 2.2){
        dialogueQueue=[{title:'CONSOLE — NO POWER', text:'CONSOLE DEAD. RESTORE POWER AT THE GENERATOR SHED FIRST (FUSE + FUEL).'}]
        dialogueIndex=0; state='tape'; renderUI(); return true
      }
    }
  }
  const txPos = txGroup.position
  if(player.pos.distanceTo(txPos) < 2.6){
    if(!doorUnlocked){ dialogueQueue=[{title:'TRANSMITTER — BLOCKED', text:'TRANSMITTER INSIDE LOCKED OBSERVATORY. FIND KEY FIRST.'}]; dialogueIndex=0; state='tape'; renderUI(); return true }
    if(!generatorRepaired){ dialogueQueue=[{title:'TRANSMITTER — NO POWER', text:'NO POWER. REPAIR GENERATOR AT SHED FIRST (NEEDS FUSE + FUEL).'}]; dialogueIndex=0; state='tape'; renderUI(); return true }
    if(tapesCollected<4){ dialogueQueue=[{title:'TRANSMITTER — NEED TAPES', text:`NEED ${4-tapesCollected} MORE TAPE(S) TO RECALIBRATE. CHECK MAP MARKERS.`}]; dialogueIndex=0; state='tape'; renderUI(); return true }
    if(!switchesOn.every(Boolean)){ const n = 3 - switchesOn.filter(Boolean).length; dialogueQueue=[{title:'TRANSMITTER — DISH MISALIGNED', text:`DISH NEEDS ALIGNMENT. ${n} CONSOLE SWITCH(ES) INSIDE OBSERVATORY STILL OFF. ENTER AND FLIP THEM.`}]; dialogueIndex=0; state='tape'; renderUI(); return true }
    state='tuning'; tuning=true; renderUI(); return true
  }
  audio.playTone(100,0.08,'square',0.08)
  return false
}

function setDreamcastMode(on: boolean){
  if(on){
    // Dreamcast 640x480 VGA, bilinear, vibrant, no dither, subtle CRT
    rt.setSize(640,480)
    rt.texture.magFilter = THREE.LinearFilter
    rt.texture.minFilter = THREE.LinearFilter
    crtMat.uniforms.uDistortion.value = 0.06
    crtMat.uniforms.uScanline.value = 0.22
    crtMat.uniforms.uChroma.value = 0.0006
    ;(overlay as HTMLElement).style.opacity = '0.06'
    ;(vignette as HTMLElement).style.opacity = '0.22'
    ;(flicker as HTMLElement).style.display = 'none'
    ;(noise as HTMLElement).style.opacity = '0.012'
  } else {
    rt.setSize(PSX_WIDTH, PSX_HEIGHT)
    rt.texture.magFilter = THREE.NearestFilter
    rt.texture.minFilter = THREE.NearestFilter
    crtMat.uniforms.uDistortion.value = 0.12
    crtMat.uniforms.uScanline.value = 0.38
    crtMat.uniforms.uChroma.value = 0.0010
    ;(overlay as HTMLElement).style.opacity = ''
    ;(vignette as HTMLElement).style.opacity = ''
    ;(flicker as HTMLElement).style.display = ''
    ;(noise as HTMLElement).style.opacity = ''
  }
}

function startSonicLevel(){
  activeLevel='sonic'
  // clear hollow fog and set Dreamcast sky
  // hide hollow objects by clearing scene - but keep lights for Sonic to recreate
  // Easiest: remove all hollow meshes by traversing and removing those not needed for Sonic
  // We'll just clear scene and let Sonic level recreate its own lights/world
  // Save hollow state already
  // Clear scene
  const toRemove: THREE.Object3D[] = []
  scene.traverse(o=>{ if(o!==camera && o!==flash && o!==flash.target) toRemove.push(o) })
  // keep camera, but remove others - then Sonic will add back its own
  // Actually simpler: remove everything except camera
  while(scene.children.length>0) scene.remove(scene.children[0])
  scene.add(camera)
  scene.add(flash); scene.add(flash.target)
  flash.intensity=0
  // Dreamcast mode
  setDreamcastMode(true)
  // Create Sonic level
  sonicLevel = new SonicAdventureLevel(scene, camera, input)
  state='sonic' as GameState
  // Reset sonic camera
  camera.fov = 62; camera.updateProjectionMatrix()
  camera.position.set(0,3.2,9)
  renderUI()
  audio.init()
  // Dreamcast jingle
  audio.playTone(520,0.22,'square',0.22); setTimeout(()=>audio.playTone(660,0.24,'square',0.22),180); setTimeout(()=>audio.playTone(780,0.4,'square',0.24),360)
}

function returnToHollow(){
  activeLevel='hollow'
  setDreamcastMode(false)
  // clear Sonic scene
  if(sonicLevel){
    // dispose Sonic meshes - just clear scene
    while(scene.children.length>0) scene.remove(scene.children[0])
    // recreate Hollow Peak world - need to recreate from scratch or just reload page?
    // For simplicity, reload page to restore Hollow Peak cleanly
    location.reload()
    return
  }
  state='playing'
  renderUI()
}

function startGame(){
  activeLevel='hollow'
  setDreamcastMode(false)
  // if coming from Sonic, reload to get clean Hollow world
  if(sonicLevel){
    location.reload()
    return
  }
  player.pos.set(-2,0,10)
  player.yaw = -0.18
  player.stamina = 1
  invuln=0
  flashlightBattery=1.0
  batteriesCollected=0
  hasKey=false; hasFuse=false; hasFuel=false; generatorRepaired=false; doorUnlocked=false; radioFreq=100.0; tuning=false; tuningHold=0; showMap=false; objectivePulse=0
  switchesOn=[false,false,false]; lastHeardPos=null; stillTimer=0
  interiorSwitches.forEach((sg,i)=>{ sg.userData.on=false; (sg.userData.lever as THREE.Mesh).rotation.x=Math.PI*0.38; ((sg.userData.light as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0x442222) })
  tapes.forEach(t=>{ t.collected=false; t.mesh.visible=true; t.mesh.scale.set(1,1,1) })
  tapesCollected=0
  // reset world items
  keyGroup.visible=true; fuseGroup.visible=true; fuelGroup.visible=true
  batteries.forEach(b=> b.visible=true)
  doorGroup.visible=true
  // door mesh reset
  const dm = doorGroup.userData.mesh as THREE.Mesh; if(dm) dm.visible=true
  const lk = doorGroup.userData.lock as THREE.Mesh; if(lk) lk.visible=true
  // generator light
  const gl = genGroup.userData.light as THREE.Mesh; if(gl) (gl.material as THREE.MeshBasicMaterial).color.setHex(0x442222)
  entityPos.set(38,0,-8)
  entityGroup.position.copy(entityPos)
  entityState='patrol'
  entityStun=0
  proximity=0
  wonTimer=0
  txGroup.userData.activated=false
  ;(txGroup.userData.light.material as THREE.MeshBasicMaterial).color.setHex(0x30ff30)
  state='playing'
  scene.fog = new THREE.Fog(0x9aa8b8, 18, 72)
  camera.fov=58; camera.updateProjectionMatrix()
  renderUI()
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
    if(k==='arrowdown'||k==='keys'){ titleSelect = Math.min(3, titleSelect+1); renderUI() }
    if(k==='enter'||k==='space'){
      if(titleSelect===0){ clearSave(); startGame() }
      else if(titleSelect===1) startSonicLevel()
      else if(titleSelect===2){ const hasSave = !!localStorage.getItem('hp_save_v2'); if(hasSave && loadGame()){ state='playing'; renderUI(); } else startGame() }
      else if(titleSelect===3){ difficulty = difficulty==='easy'?'normal':difficulty==='normal'?'hard':'easy'; localStorage.setItem('hp_difficulty', difficulty); renderUI() }
    }
  } else if(state==='tape'){
    if(k==='keye'||k==='enter'||k==='space') advanceDialogue()
  } else if(state==='tuning'){
    if(k==='escape'){ state='playing'; tuning=false; renderUI() }
    if(k==='enter'||k==='space'){
      const diff = Math.abs(radioFreq - 147.7)
      if(diff < 0.25){
        // success
        txGroup.userData.activated=true
        audio.playTone(660,1.2,'sine',0.32)
        setTimeout(()=> audio.playTone(880,1.5,'sine',0.32), 300)
        wonTimer=0.1
        state='playing'; tuning=false; renderUI()
      } else {
        audio.playStatic()
        dialogueQueue=[{title:'TRANSMITTER — NO LOCK', text:`FREQUENCY ${radioFreq.toFixed(1)} MHz OUT OF TOLERANCE. TARGET IS 147.7 MHz. ADJUST AND RETRY.`}]
        dialogueIndex=0; state='tape'; tuning=false; renderUI()
      }
    }
    if(k==='keya'||k==='arrowleft') radioFreq = Math.max(100, radioFreq - 0.7)
    if(k==='keyd'||k==='arrowright') radioFreq = Math.min(160, radioFreq + 0.7)
  } else if(state==='sonic'){
    if(k==='escape'||k==='keyp'){
      if(sonicLevel && sonicLevel.state==='playing'){ sonicLevel.state='paused' as any; renderUI() }
      else if(sonicLevel && (sonicLevel.state as any)==='paused'){ sonicLevel.state='playing'; renderUI() }
    }
    if(k==='keyr'){ startSonicLevel() }
  } else if(state==='playing'){
    if(k==='escape'||k==='keyp'){ state='paused'; renderUI() }
    if(k==='keyf'){ 
      if(flashlightBattery<=0.02){ audio.playTone(120,0.12,'square',0.12); dialogueQueue=[{title:'FLASHLIGHT — BATTERY DEAD', text:'BATTERY DEPLETED. FIND GREEN BATTERIES SCATTERED AROUND THE COMPOUND.'}]; dialogueIndex=0; state='tape'; renderUI(); return }
      flashlightOn=!flashlightOn; audio.playTone(420,0.08,'square',0.18); renderUI() 
    }
    if(k==='keym' && !e.shiftKey){ if(audio.master) audio.master.gain.value = audio.master.gain.value>0?0:0.45 }
    if(k==='tab'){ e.preventDefault(); if(state==='playing'){ showMap=!showMap; renderUI() } }
    if(k==='keyq'){ if(state==='playing'){ showMap=!showMap; renderUI() } }
    if(k==='keye'){
      doInteract()
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
  // keep low-res target — respect Dreamcast mode
  if(activeLevel==='sonic') rt.setSize(640,480)
  else rt.setSize(PSX_WIDTH, PSX_HEIGHT)
}
window.addEventListener('resize', onResize)

// Wire touch to input
input.setTouch(touch)

// Game loop
const clock = new THREE.Clock()
let frameAcc=0

function animate(){
  requestAnimationFrame(animate)
  const dt = Math.min(0.033, clock.getDelta())
  const time = clock.elapsedTime
  frameAcc+=dt

  // Reduced motion: disable jitter/flicker if prefers
  const jitter = prefersReducedMotion ? 0.08 : (state==='playing' ? (proximity*0.45 + 0.32) : 0.55)
  updatePsxMaterials(psxMaterials, time, jitter)
  crtMat.uniforms.uTime.value = time
  if(prefersReducedMotion){ crtMat.uniforms.uDistortion.value = 0.06; crtMat.uniforms.uScanline.value = 0.25; } else { crtMat.uniforms.uDistortion.value = 0.12; crtMat.uniforms.uScanline.value = 0.38; }

  // Snowfall — throttled to 450 per frame (even indices) to halve CPU and avoid frame shimmer/tearing
  const posAttr = snowGeo.getAttribute('position') as THREE.BufferAttribute
  const snowStep = 2 // only update half each frame, alternating
  const snowOffset = (frameAcc*60)%2 <1 ? 0:1
  for(let i=snowOffset;i<900;i+=snowStep){
    let y = posAttr.getY(i)
    y -= snowVel[i] * dt * snowStep
    if(y < 0){
      y = 38 + Math.random()*8
      posAttr.setX(i, (Math.random()-0.5)*120 + player.pos.x*0.06)
      posAttr.setZ(i, (Math.random()-0.5)*120 + player.pos.z*0.06)
    }
    posAttr.setY(i, y)
    posAttr.setX(i, posAttr.getX(i) + Math.sin(time*0.35 + i*0.11)*0.012*dt*18)
  }
  posAttr.needsUpdate = true
  // Interior visibility - show when door unlocked and near
  if(interiorGroup){
    const nearDoor = player.pos.distanceTo(doorGroup.position) < 8 && doorUnlocked
    interiorGroup.visible = nearDoor
    // hide transmitter outside when interior visible to avoid double
    txGroup.visible = !(nearDoor && player.pos.distanceTo(txGroup.position)<4)
  }
  // Auto-save every 4s while playing
  if(state==='playing'){
    autoSaveTimer += dt
    if(autoSaveTimer>4){ autoSaveTimer=0; saveGame() }
  }

  // Bios auto timer
  if(state==='bios'){
    biosTimer+=dt
    // subtle dish rotation even in bios? world still renders behind? we render scene anyway
  }

  // Dish: tracks player only until servos aligned, then locks north (goal direction)
  if(dishGroup){
    const switchesDone = switchesOn.every(Boolean)
    const targetYaw = switchesDone ? 0 : Math.atan2(player.pos.x - dishGroup.position.x, player.pos.z - dishGroup.position.z)
    dishGroup.rotation.y += (targetYaw - dishGroup.rotation.y)*dt*0.32
    if(!switchesDone) dishGroup.rotation.y += Math.sin(time*0.3)*0.002
    // visual feedback: dish ticks when servos flip
    if(switchesDone) dishGroup.rotation.y += Math.sin(time*2.8)*0.001
  }
  // Animate interior switch levers lerp + dish-aligned glow
  interiorSwitches.forEach(sg=>{
    const on = !!sg.userData.on
    const lever = sg.userData.lever as THREE.Mesh
    const tgt = on ? -Math.PI*0.28 : Math.PI*0.38
    lever.rotation.x = THREE.MathUtils.lerp(lever.rotation.x, tgt, dt*8)
    const light = sg.userData.light as THREE.Mesh
    const pulse = on ? 0.18*Math.sin(time*4 + (sg.userData.idx as number)):0
    ;(light.material as THREE.MeshBasicMaterial).color.setHSL(on?0.33:0, on?0.9:0.4, on?0.48+pulse:0.22)
  })
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

  // Tuning state: radio dial moves with A/D, entity still hunts slowly (+touch)
  if(state==='tuning'){
    const turn = (input.isDown('keya')||input.isDown('arrowleft')||touch.l?-1:0) + (input.isDown('keyd')||input.isDown('arrowright')||touch.r?1:0)
    if(turn!==0){
      radioFreq = THREE.MathUtils.clamp(radioFreq + turn * dt * 6.5, 100, 160)
      // tune sound
      if(Math.random()<0.28) audio.playTone(200 + (radioFreq-100)*8, 0.06,'square',0.06)
    }
    // Entity still approaches slowly while tuning (tension)
    const distToPlayer = entityGroup.position.distanceTo(player.pos)
    proximity = THREE.MathUtils.clamp(1 - distToPlayer/22, 0, 1)
    if(entityStun<=0){
      const dir = player.pos.clone().sub(entityGroup.position); dir.y=0; dir.normalize()
      entityGroup.position.add(dir.multiplyScalar(0.9*dt))
      entityGroup.lookAt(player.pos.x, entityGroup.position.y, player.pos.z)
    } else entityStun-=dt
    if(distToPlayer < 1.15){ audio.playHurt(); state='lost'; tuning=false; renderUI() }
  }

  // Sonic Adventure Dreamcast level - update, camera, render and early return
  if(state==='sonic' && sonicLevel){
    if(sonicLevel.state==='playing'){
      // mouse camera orbit
      if(Math.abs(input.mouseDelta.x) > 0.5){
        sonicLevel.cameraYaw += input.mouseDelta.x * 0.004
        input.mouseDelta.x *= 0.82
      } else input.mouseDelta.x *= 0.9
      if(Math.abs(input.mouseDelta.y) > 0.5){
        sonicLevel.cameraPitch = THREE.MathUtils.clamp(sonicLevel.cameraPitch - input.mouseDelta.y*0.003, -0.45, 0.55)
        input.mouseDelta.y *= 0.82
      }
      sonicLevel.update(dt, time)
      // Dreamcast chase cam
      const target = sonicLevel.sonic.position.clone().add(new THREE.Vector3(0,0.55,0))
      const yaw = sonicLevel.yaw + sonicLevel.cameraYaw
      const pitch = sonicLevel.cameraPitch
      const dist = sonicLevel.cameraDist
      const camPos = new THREE.Vector3(
        target.x - Math.sin(yaw)*Math.cos(pitch)*dist,
        target.y + Math.sin(pitch)*dist + 1.4,
        target.z - Math.cos(yaw)*Math.cos(pitch)*dist
      )
      // simple wall clip - lerp
      camera.position.lerp(camPos, 0.14)
      camera.lookAt(target)
      // check win/lost to show UI
      // @ts-ignore
      if(sonicLevel.state==='won' || sonicLevel.state==='lost'){
        renderUI()
      }
    } else if(sonicLevel.state==='paused'){
      // paused - still render but not update
    }
    // HUD sync every 0.15s
    if(frameAcc>0.14){
      frameAcc=0
      // trigger HUD refresh for rings/time without full re-render sparingly
      const hudRings = document.querySelector('.hud') as HTMLElement | null
      if(hudRings && sonicLevel.state==='playing'){
        // quick update via renderUI if needed - but we do partial to avoid flicker
        // For now, just re-renderHUD sparingly
        // renderUI() // too heavy, skip
      }
    }
    // Render Sonic scene (same scene) - use Dreamcast clear color already set
    renderer.setRenderTarget(rt)
    renderer.setClearColor(sonicLevel.scene.background as THREE.Color, 1)
    renderer.render(sonicLevel.scene, camera)
    renderer.setRenderTarget(null)
    renderer.setClearColor(0x000000,1)
    renderer.render(crtScene, crtCam)
    overlay.style.opacity = '0.06'
    vignette.style.opacity = '0.22'
    // periodically refresh HUD for time
    if(Math.floor(time*4)%4===0 && Math.floor(time*10)%10===0){ /* throttled */ }
    return
  }

  if(state==='playing'){
    // Touch light/map edge triggers
    const tLight = !!(touch as any).light
    const tMap = !!(touch as any).map
    const tInteract = !!(touch as any).interact
    // simple edge detect via global
    ;(window as any)._prevTouch = (window as any)._prevTouch || { light:0, map:0, interact:0 }
    const prev = (window as any)._prevTouch
    if(tLight && !prev.light){
      if(flashlightBattery>0.02){ flashlightOn=!flashlightOn; audio.playTone(420,0.08,'square',0.18); renderUI() }
    }
    if(tMap && !prev.map){ showMap=!showMap; renderUI() }
    if(tInteract && !prev.interact){
      // simulate E press - will be handled by manual check below after movement
      ;(window as any)._touchInteractEdge = true
    }
    prev.light = tLight?1:0; prev.map = tMap?1:0; prev.interact = tInteract?1:0
    if((window as any)._touchInteractEdge && state==='playing'){
      ;(window as any)._touchInteractEdge=false
      doInteract()
    }

    // Battery drain while flashlight on
    if(flashlightOn && flashlightBattery>0){
      flashlightBattery = Math.max(0, flashlightBattery - dt * 0.028)
      if(flashlightBattery<=0){ flashlightOn=false; objectivePulse=1.0; renderUI() }
    }
    objectivePulse = Math.max(0, objectivePulse - dt)
    // Pulse HUD when objective changes
    // Animate world pickups (key, fuse, fuel, batteries) hover
    ;[keyGroup, fuseGroup, fuelGroup].forEach(g=>{
      if(!g.visible) return
      g.position.y = g.userData.pos.y + Math.sin(time*1.5 + g.position.x)*0.08
      g.rotation.y += dt*0.55
      g.children.forEach((c:any)=>{ if(c.userData.isArrow) c.position.y = 0.95 + Math.sin(time*2.4)*0.07 })
    })
    batteries.forEach(bg=>{
      if(!bg.visible) return
      bg.position.y = bg.userData.pos.y + Math.sin(time*1.7 + bg.position.x*0.5)*0.06
      bg.rotation.y += dt*0.6
      bg.children.forEach((c:any)=>{ if(c.userData.isArrow) c.position.y = 0.65 + Math.sin(time*2.6)*0.06 })
    })
    // Generator lever animation when repaired
    if(generatorRepaired){
      const lv = genGroup.userData.lever as THREE.Mesh
      if(lv) lv.rotation.x = THREE.MathUtils.lerp(lv.rotation.x, -Math.PI*0.15, dt*2.5)
      const gl = genGroup.userData.light as THREE.Mesh
      if(gl) (gl.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(time*6)%2===0?0x2ecc71:0x27ae60)
    }
    // Touch run
    const isTouchRun = !!(touch as any).run
    // Player movement - tank controls
    const axis = input.getAxis() // x = turn, y = forward
    const isRun = input.isDown('shiftleft') || input.isDown('shiftright') || input.isDown('gamepad') || isTouchRun
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

    // Entity AI — with investigate + hiding + lastHeardPos
    const distToPlayer = entityGroup.position.distanceTo(player.pos)
    proximity = THREE.MathUtils.clamp(1 - distToPlayer/22, 0, 1)
    // Hiding: standing still, no light, no run for 1.8s makes you harder to see
    const isMoving = Math.abs(forward)>0.06 || Math.abs(turn)>0.08
    if(!isMoving && !flashlightOn && !isRun){
      stillTimer += dt
    } else stillTimer = 0
    const hiding = stillTimer > 1.8 ? 0.22 : 0
    // Light + run make you visible further; hiding reduces
    const lightPenalty = flashlightOn ? 0.14 : 0
    const visibleDist = 16 + lightPenalty*10 + (isRun?5:0) - hiding*9
    const canSee = distToPlayer < visibleDist && distToPlayer > 1.0
    // remember last heard position for investigate state
    if(hearTimer>0.1) lastHeardPos = player.pos.clone()

    // State transitions: stun > chase > investigate > patrol
    if(entityStun>0){
      entityStun-=dt
      entityState='stun'
      if(entityStun<=0) entityState='patrol'
    } else if(canSee && (proximity>0.30 || hearTimer>0)){
      entityState='chase'
      lastHeardPos = player.pos.clone()
    } else if(entityState==='chase' && distToPlayer>26){
      // lose sight -> investigate last heard
      entityState='patrol'
      if(lastHeardPos) entityPatrolTarget.copy(lastHeardPos)
      else entityPatrolTarget.set((Math.random()-0.5)*30+8,0,(Math.random()-0.5)*30)
    } else if(!canSee && hearTimer>0 && lastHeardPos && entityState!=='chase'){
      // investigate sound without seeing — walk to sound source
      entityPatrolTarget.copy(lastHeardPos)
    }

    const diffMult = difficulty==='easy'?0.78 : difficulty==='hard'?1.32 : 1
    let eSpeed = (entityState==='chase' ? 3.35 : entityState==='stun' ? 0 : 1.35) * diffMult
    // Near transmitter when won, entity slows
    if(wonTimer>0) eSpeed*=0.38

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

    // Flashlight stun — shorter window, needs centre aim, costs battery burst
    if(flashlightOn && flashlightBattery>0.06 && distToPlayer < 4.6){
      const toEntity = entityGroup.position.clone().sub(player.pos).normalize()
      const forwardVec = new THREE.Vector3(Math.sin(player.yaw),0,Math.cos(player.yaw))
      const dot = forwardVec.dot(toEntity)
      if(dot>0.86 && entityStun<=0){
        entityStun = 1.25
        entityState='stun'
        entityGroup.position.add(toEntity.multiplyScalar(1.0))
        flashlightBattery = Math.max(0, flashlightBattery - 0.08)
        audio.playStatic()
        // feedback
        objectivePulse = 0.6
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
  // Smooth follow — no per-frame random jitter (was causing screen tearing). PSX wobble comes from
  // vertex snap in shader, not camera translate. Use damped spring lerp only.
  camera.position.lerp(camPos, state==='playing' ? 0.11 : 0.05)
  const lookAt = player.pos.clone().add(new THREE.Vector3(0,1.02,0))
  camera.lookAt(lookAt)

  // Flashlight follows camera/player - battery affects intensity
  flash.position.copy(player.pos).add(new THREE.Vector3(0,1.18,0))
  flash.position.add(new THREE.Vector3(Math.sin(player.yaw)*0.22,0,Math.cos(player.yaw)*0.22))
  const flashTarget = player.pos.clone().add(new THREE.Vector3(Math.sin(player.yaw)*12, -0.35, Math.cos(player.yaw)*12))
  flash.target.position.copy(flashTarget)
  const batFactor = THREE.MathUtils.clamp(flashlightBattery*1.35, 0, 1)
  flash.intensity = (flashlightOn && flashlightBattery>0) ? (state==='playing'? 4.8*batFactor : 1.2*batFactor) : 0
  if(flashlightOn && proximity>0.5){
    flash.intensity *= 0.86 + Math.random()*0.28
  }
  // Battery flicker when low
  if(flashlightOn && flashlightBattery<0.22){
    flash.intensity *= 0.55 + Math.random()*0.55
  }
  // Observatory windows glow when generator repaired
  if(generatorRepaired){
    // Find window meshes (basic material emissive via opacity)
    scene.traverse((obj:any)=>{
      if(obj.isMesh && obj.material && obj.userData.flicker!==undefined){
        obj.material.opacity = 0.72 + Math.sin(time*3.1 + obj.userData.flicker)*0.18
        obj.material.color.setHex(0xffd68a)
      }
    })
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
}