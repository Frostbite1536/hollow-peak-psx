import * as THREE from 'three'
import { Input } from './input'

// Dreamcast Sonic Adventure - Emerald Coast style test zone
// 640x480, 60fps, Gouraud + specular, no dither, vibrant, loops & springs

export class SonicAdventureLevel {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  input: Input
  sonic!: THREE.Group
  sonicMesh!: THREE.Group
  velocity = new THREE.Vector3()
  yaw = 0
  pitch = 0
  onGround = false
  coyote = 0
  jumpBuffer = 0
  speed = 0
  rings = 0
  lives = 3
  time = 0
  state: 'playing'|'paused'|'won'|'lost' = 'playing'
  checkpoints: THREE.Vector3[] = []
  ringsGroup = new THREE.Group()
  springs: { mesh: THREE.Group, pos: THREE.Vector3, power: number, dir: THREE.Vector3 }[] = []
  dashes: { mesh: THREE.Group, pos: THREE.Vector3, dir: THREE.Vector3 }[] = []
  enemies: { mesh: THREE.Group, pos: THREE.Vector3, alive: boolean }[] = []
  platforms: THREE.Mesh[] = []
  colliders: { box: THREE.Box3, mesh?: THREE.Mesh }[] = []
  goal!: THREE.Group
  cameraYaw = 0
  cameraPitch = -0.18
  cameraDist = 6.2
  spinTime = 0
  homingTarget: THREE.Vector3 | null = null
  invuln = 0
  // world bounds
  killY = -18

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, input: Input) {
    this.scene = scene; this.camera = camera; this.input = input
    // Sky - Dreamcast vibrant
    scene.background = new THREE.Color(0x4ca8ff)
    scene.fog = new THREE.Fog(0x8ec8ff, 38, 92)

    // Lighting - Dreamcast specular
    scene.clear()
    // Need to re-add lights for this level (caller clears scene)
    // We'll expect caller to clear; we add our own
    this.setupLights()
    this.createSonic()
    this.createWorld()
    this.createHUD()
  }

  setupLights(){
    const amb = new THREE.AmbientLight(0xffffff, 0.62)
    this.scene.add(amb)
    const sun = new THREE.DirectionalLight(0xffffff, 1.18)
    sun.position.set(24,32,-18)
    sun.castShadow = false
    this.scene.add(sun)
    const fill = new THREE.HemisphereLight(0x87ceeb, 0x334455, 0.42)
    this.scene.add(fill)
  }

  createSonic(){
    this.sonic = new THREE.Group()
    this.sonic.position.set(0,1.4,10)
    this.scene.add(this.sonic)
    this.sonicMesh = new THREE.Group()
    this.sonic.add(this.sonicMesh)

    // Body - chibi Sonic, Dreamcast era low-poly but smooth
    const bodyGeo = new THREE.SphereGeometry(0.42, 12, 10)
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x0066ff, shininess: 48, specular: 0x66aaff })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.22
    body.scale.set(1,1.08,0.92)
    this.sonicMesh.add(body)
    // belly
    const bellyGeo = new THREE.SphereGeometry(0.28, 10, 8)
    const bellyMat = new THREE.MeshPhongMaterial({ color: 0xffd6a0, shininess: 10 })
    const belly = new THREE.Mesh(bellyGeo, bellyMat)
    belly.position.set(0,0.08,0.28)
    belly.scale.set(1,1.12,0.5)
    this.sonicMesh.add(belly)
    // head
    const headGeo = new THREE.SphereGeometry(0.38, 12, 10)
    const head = new THREE.Mesh(headGeo, bodyMat)
    head.position.set(0,0.58,0.05)
    this.sonicMesh.add(head)
    // muzzle
    const muzGeo = new THREE.SphereGeometry(0.18, 8, 6)
    const muzMat = new THREE.MeshPhongMaterial({ color: 0xffd6a0 })
    const muz = new THREE.Mesh(muzGeo, muzMat)
    muz.position.set(0,0.48,0.32)
    muz.scale.set(1,0.8,0.9)
    this.sonicMesh.add(muz)
    // eyes
    const eyeGeo = new THREE.SphereGeometry(0.11, 8, 6)
    const eyeMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 })
    const eyeW = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 5 })
    for(let s of [-0.16,0.16]){
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(s,0.62,0.28)
      eye.scale.set(1,1.25,0.5)
      this.sonicMesh.add(eye)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055,6,6), new THREE.MeshBasicMaterial({color:0x0a2a5a}))
      pupil.position.set(s*0.92,0.60,0.34)
      this.sonicMesh.add(pupil)
      const hi = new THREE.Mesh(new THREE.SphereGeometry(0.028,4,4), new THREE.MeshBasicMaterial({color:0xffffff}))
      hi.position.set(s>0?0.10:-0.22,0.66,0.36)
      this.sonicMesh.add(hi)
    }
    // nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04,6,6), new THREE.MeshBasicMaterial({color:0x111111}))
    nose.position.set(0,0.48,0.48)
    this.sonicMesh.add(nose)
    // quills - 5 cones back
    const quillMat = bodyMat
    for(let i=0;i<5;i++){
      const qGeo = new THREE.ConeGeometry(0.18 - i*0.018, 0.62, 7)
      const q = new THREE.Mesh(qGeo, quillMat)
      const spread = (i-2)*0.28
      q.position.set(spread, 0.62 + Math.abs(spread)*0.12, -0.28 - Math.abs(spread)*0.08)
      q.rotation.x = -0.45
      q.rotation.z = spread*0.35
      q.rotation.y = spread*0.12
      this.sonicMesh.add(q)
    }
    // ears
    const earGeo = new THREE.ConeGeometry(0.09,0.22,6)
    for(let s of [-0.22,0.22]){
      const ear = new THREE.Mesh(earGeo, new THREE.MeshPhongMaterial({color: 0x0066ff}))
      ear.position.set(s,0.88, -0.02)
      ear.rotation.z = s>0?-0.28:0.28
      this.sonicMesh.add(ear)
      const inn = new THREE.Mesh(new THREE.ConeGeometry(0.05,0.12,6), new THREE.MeshBasicMaterial({color:0xffc8a0}))
      inn.position.set(s*0.92,0.86,-0.01)
      inn.rotation.z = s>0?-0.28:0.28
      this.sonicMesh.add(inn)
    }
    // arms
    const armGeo = new THREE.CylinderGeometry(0.07,0.06,0.38,6)
    const skinMat = new THREE.MeshPhongMaterial({ color: 0xffd6a0 })
    const gloveMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 22 })
    for(let s of [-1,1]){
      const arm = new THREE.Mesh(armGeo, skinMat)
      arm.position.set(s*0.38,0.22,0)
      arm.rotation.z = s*0.18
      this.sonicMesh.add(arm)
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13,8,6), gloveMat)
      glove.position.set(s*0.42, -0.02,0.04)
      this.sonicMesh.add(glove)
    }
    // legs
    const legGeo = new THREE.CylinderGeometry(0.09,0.08,0.42,6)
    const shoeMat = new THREE.MeshPhongMaterial({ color: 0xcc0000, shininess: 18, specular: 0xff6666 })
    for(let s of [-0.16,0.16]){
      const leg = new THREE.Mesh(legGeo, skinMat)
      leg.position.set(s, -0.28,0)
      this.sonicMesh.add(leg)
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.16,0.22,4,8), shoeMat)
      shoe.position.set(s, -0.62,0.08)
      shoe.rotation.x = 0.12
      this.sonicMesh.add(shoe)
      // buckle
      const buck = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.07,0.02), new THREE.MeshPhongMaterial({color:0xffffff}))
      buck.position.set(s, -0.55,0.22)
      this.sonicMesh.add(buck)
    }
    // shadow
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.38,12), new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.22 }))
    sh.rotation.x = -Math.PI/2
    sh.position.y = -1.38
    sh.userData.isSonicShadow=true
    this.sonic.add(sh)
  }

  createWorld(){
    // Helper textures
    const checkerTex = this.makeCheckerTexture()
    const grassTex = this.makeGrassTexture()

    const addPlatform = (pos: THREE.Vector3, size: THREE.Vector3, color=0x2ecc71, tex?: THREE.Texture)=>{
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z)
      const mat = new THREE.MeshPhongMaterial({ color, map: tex||null, shininess: 18 })
      if(tex){ mat.map!.wrapS=mat.map!.wrapT=THREE.RepeatWrapping; (mat.map as THREE.Texture).repeat.set(size.x/4, size.z/4) }
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pos)
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.platforms.push(mesh)
      this.colliders.push({ box: new THREE.Box3().setFromCenterAndSize(pos.clone(), size), mesh })
      return mesh
    }

    // Start platform (Emerald Coast style)
    addPlatform(new THREE.Vector3(0,0,10), new THREE.Vector3(14,1.2,14), 0x2ecc71, checkerTex)
    // Runway
    addPlatform(new THREE.Vector3(0,0,-2), new THREE.Vector3(7.5,0.7,22), 0xdddddd, checkerTex)
    // Jump gap - second platform higher
    addPlatform(new THREE.Vector3(0,1.2,-22), new THREE.Vector3(10,0.8,10), 0x2ecc71, checkerTex)
    // Stair up
    addPlatform(new THREE.Vector3(0,2.0,-30), new THREE.Vector3(6,0.6,6), 0x2ecc71, checkerTex)
    addPlatform(new THREE.Vector3(0,2.85,-36), new THREE.Vector3(6,0.6,6), 0x2ecc71, checkerTex)
    // Bridge with dash panels
    addPlatform(new THREE.Vector3(0,3.2,-48), new THREE.Vector3(5,0.5,18), 0x666666)
    // Loop approach
    addPlatform(new THREE.Vector3(0,3.2,-62), new THREE.Vector3(8,0.8,8), 0x2ecc71, checkerTex)
    // After loop platform
    addPlatform(new THREE.Vector3(0,3.2,-78), new THREE.Vector3(10,0.8,12), 0x2ecc71, checkerTex)
    // Final ascent
    addPlatform(new THREE.Vector3(8,4.2,-84), new THREE.Vector3(6,0.6,8), 0x2ecc71, checkerTex)
    addPlatform(new THREE.Vector3(16,5.0,-84), new THREE.Vector3(6,0.8,10), 0xffd700, checkerTex) // goal platform gold

    // Walls for loop visual - torus half
    const loopGroup = new THREE.Group()
    loopGroup.position.set(0,7.2,-70)
    const loopGeo = new THREE.TorusGeometry(4.0,0.42,10,24, Math.PI*2)
    const loopMat = new THREE.MeshPhongMaterial({ color: 0xff3b30, shininess: 32, specular: 0xffaaaa })
    const loop = new THREE.Mesh(loopGeo, loopMat)
    loop.rotation.y = Math.PI/2
    loopGroup.add(loop)
    // inner rail
    const railGeo = new THREE.TorusGeometry(4.0,0.08,6,24, Math.PI*2)
    const railMat = new THREE.MeshPhongMaterial({ color: 0x444444 })
    const rail1 = new THREE.Mesh(railGeo, railMat); rail1.rotation.y=Math.PI/2; rail1.position.y=0.18; loopGroup.add(rail1)
    const rail2 = rail1.clone(); rail2.position.y=-0.18; loopGroup.add(rail2)
    this.scene.add(loopGroup)

    // Palm trees - Dreamcast style
    const palmPos: [number,number,number][] = [[-7,-0,6],[7,-0,6],[-8,-0,-10],[8,-0,-10],[5,1.2,-22],[ -5,1.2,-22],[ -9,3.2,-62],[9,3.2,-62],[4,5.0,-84],[-4,5.0,-84]]
    palmPos.forEach(([x,y,z])=>{
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,3.2,6), new THREE.MeshPhongMaterial({color:0x6b4226}))
      trunk.position.set(x,y+1.6,z)
      this.scene.add(trunk)
      const leaves = new THREE.Group()
      leaves.position.set(x,y+3.4,z)
      for(let i=0;i<6;i++){
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.55,1.6,5), new THREE.MeshPhongMaterial({color:0x2ecc71, shininess:8}))
        leaf.position.y = 0
        leaf.rotation.z = 0.9
        leaf.rotation.y = i*(Math.PI*2/6)
        leaf.translateY(0.4)
        leaves.add(leaf)
      }
      this.scene.add(leaves)
    })

    // Water plane around level
    const water = new THREE.Mesh(new THREE.PlaneGeometry(160,160), new THREE.MeshPhongMaterial({ color:0x2a8de8, shininess: 88, specular: 0xaaddff, transparent:true, opacity:0.78 }))
    water.rotation.x = -Math.PI/2
    water.position.y = -1.2
    this.scene.add(water)

    // Rings - line and arcs
    const ringPositions = [
      [0,0.9,2],[1.2,0.9,0],[0,0.9,-2],[-1.2,0.9,-4],[0,0.9,-6],[1.0,0.9,-8],
      [0,2.1,-22],[1.8,2.1,-22],[0,2.1,-23.5],[-1.8,2.1,-22],
      [0,3.1,-30],[0,3.1,-31.5],[0,3.1,-33],
      [0,4.0,-48],[1.5,4.0,-50],[-1.5,4.0,-52],[0,4.0,-54],[0,4.0,-56],
      [0,4.1,-62],[0,5.5,-66],[0,6.8,-70],[0,5.5,-74],[0,4.1,-78],
      [8,5.0,-84],[10,5.8,-84],[12,5.8,-84],
    ]
    ringPositions.forEach(p=>{
      const g = new THREE.Group()
      g.position.set(p[0],p[1],p[2])
      const rg = new THREE.TorusGeometry(0.42,0.085,8,14)
      const rm = new THREE.MeshPhongMaterial({ color:0xffd800, shininess: 72, specular: 0xffffaa, emissive: 0x332200, emissiveIntensity: 0.12 })
      const m = new THREE.Mesh(rg, rm)
      m.rotation.y = Math.PI*0.18
      g.add(m)
      // inner shine
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.42,0.025,6,14), new THREE.MeshBasicMaterial({color:0xffffaa, transparent:true, opacity:0.38}))
      g.add(inner)
      g.userData = { isRing: true, collected:false, baseY: p[1] }
      this.ringsGroup.add(g)
      this.scene.add(g)
    })

    // Springs - red yellow
    const springPos: [number,number,number,number][] = [[0,0.35,-26,12],[0,3.55,-62,14],[16,5.45,-82,10]]
    springPos.forEach(([x,y,z,pwr])=>{
      const g = new THREE.Group()
      g.position.set(x,y,z)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.48,0.28,10), new THREE.MeshPhongMaterial({color:0xcc0000}))
      base.position.y=0.14
      g.add(base)
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.28,0.42,8,1,true), new THREE.MeshPhongMaterial({color:0xffdd00, wireframe:false}))
      spring.position.y=0.48
      g.add(spring)
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,0.08,10), new THREE.MeshPhongMaterial({color:0xff0000}))
      top.position.y=0.72
      g.add(top)
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18,0.32,4), new THREE.MeshBasicMaterial({color:0xffff00}))
      arrow.position.y=1.02; arrow.rotation.x = Math.PI
      g.add(arrow)
      g.userData = { power: pwr }
      this.scene.add(g)
      this.springs.push({ mesh:g, pos: new THREE.Vector3(x,y,z), power:pwr, dir: new THREE.Vector3(0,1,0) })
    })

    // Dash panels - blue arrows
    const dashPos = [[0,3.45,-44],[0,3.45,-47],[0,3.45,-50]]
    dashPos.forEach(([x,y,z])=>{
      const g = new THREE.Group()
      g.position.set(x as number,y as number,z as number)
      g.rotation.x = -Math.PI/2
      const base = new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.2), new THREE.MeshPhongMaterial({ color:0x0088ff, shininess: 30 }))
      base.position.y=0.02
      g.add(base)
      // arrows
      for(let i=0;i<3;i++){
        const a = new THREE.Mesh(new THREE.ConeGeometry(0.22,0.38,3), new THREE.MeshBasicMaterial({color:0xffff00}))
        a.position.set(0, -0.3 + i*0.32, 0.04)
        a.rotation.z = -Math.PI/2
        g.add(a)
      }
      this.scene.add(g)
      this.dashes.push({ mesh:g, pos: new THREE.Vector3(x as number,y as number,z as number), dir: new THREE.Vector3(0,0,-1) })
    })

    // Enemies - Egg Pawn style, simple
    const enemyPos = [[0,0.6,-14],[ -1.2,0.6,-38],[1.4,0.6,-58]]
    enemyPos.forEach(([x,y,z])=>{
      const g = new THREE.Group()
      g.position.set(x as number,y as number,z as number)
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42,10,8), new THREE.MeshPhongMaterial({color:0x888888, shininess:12}))
      body.scale.set(1,1.12,0.92)
      g.add(body)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09,6,6), new THREE.MeshBasicMaterial({color:0xff2222}))
      eye.position.set(0,0.18,0.32)
      g.add(eye)
      const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.6,4), new THREE.MeshBasicMaterial({color:0x444444}))
      prop.position.set(0,0.72,0)
      g.add(prop)
      g.userData = { isEnemy:true }
      this.scene.add(g)
      this.enemies.push({ mesh:g, pos: new THREE.Vector3(x as number,y as number,z as number), alive:true })
    })

    // Goal capsule - Dreamcast style
    this.goal = new THREE.Group()
    this.goal.position.set(16,5.9,-84)
    const capGeo = new THREE.CapsuleGeometry(0.7,1.4,4,12)
    const capMat = new THREE.MeshPhongMaterial({ color:0xff3333, shininess: 40, transparent:true, opacity:0.92 })
    const cap = new THREE.Mesh(capGeo, capMat)
    cap.rotation.y = 0
    this.goal.add(cap)
    const capRing = new THREE.Mesh(new THREE.TorusGeometry(0.92,0.08,8,16), new THREE.MeshBasicMaterial({color:0xffff00, transparent:true, opacity:0.42}))
    capRing.rotation.x = Math.PI/2
    capRing.position.y = -0.42
    this.goal.add(capRing)
    // star
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshPhongMaterial({color:0xffff00, shininess: 60}))
    star.position.y = 1.1
    this.goal.add(star)
    this.scene.add(this.goal)

    // Checkpoints
    this.checkpoints = [new THREE.Vector3(0,1.4,10), new THREE.Vector3(0,2.0,-22), new THREE.Vector3(0,3.9,-62)]
  }

  makeCheckerTexture(){
    const c = document.createElement('canvas'); c.width=64; c.height=64
    const ctx=c.getContext('2d')!
    ctx.fillStyle='#2ecc71'; ctx.fillRect(0,0,64,64)
    ctx.fillStyle='#27ae60'
    for(let y=0;y<64;y+=16) for(let x=0;x<64;x+=16) if(((x/16+y/16)%2)===0) ctx.fillRect(x,y,16,16)
    ctx.fillStyle='rgba(255,255,255,0.12)'
    for(let i=0;i<64;i+=8){ ctx.fillRect(i,0,1,64); ctx.fillRect(0,i,64,1) }
    const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; return t
  }
  makeGrassTexture(){
    const c=document.createElement('canvas'); c.width=32; c.height=32
    const ctx=c.getContext('2d')!
    ctx.fillStyle='#2ecc71'; ctx.fillRect(0,0,32,32)
    ctx.fillStyle='#27ae60'; for(let i=0;i<80;i++){ const x=(Math.random()*32)|0, y=(Math.random()*32)|0; ctx.fillRect(x,y,2,1) }
    const t=new THREE.CanvasTexture(c); t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearFilter; t.wrapS=t.wrapT=THREE.RepeatWrapping; return t
  }

  // HUD for Sonic
  hudEl: HTMLElement | null = null
  createHUD(){
    // created on demand in main
  }

  reset(){
    this.sonic.position.set(0,1.4,10)
    this.velocity.set(0,0,0)
    this.yaw=0; this.onGround=true; this.coyote=0; this.rings=0; this.time=0; this.state='playing'; this.invuln=0; this.spinTime=0
    this.checkpoints = [new THREE.Vector3(0,1.4,10), new THREE.Vector3(0,2.0,-22), new THREE.Vector3(0,3.9,-62)]
  }

  update(dt: number, time: number){
    if(this.state!=='playing') return
    this.time += dt
    this.invuln = Math.max(0, this.invuln - dt)
    // Rings spin + bob
    this.ringsGroup.children.forEach((c:any)=>{
      if(c.userData.collected) return
      c.rotation.y += dt*2.8
      c.position.y = c.userData.baseY + Math.sin(time*2.2 + c.position.x*0.5)*0.12
      // check collect
      if(c.position.distanceTo(this.sonic.position) < 1.05){
        c.userData.collected = true
        c.visible = false
        this.rings += 1
        // sparkle
      }
    })
    // Enemies patrol + homing
    this.enemies.forEach(e=>{
      if(!e.alive) return
      // simple hover
      e.mesh.position.y = e.pos.y + Math.sin(time*1.6 + e.pos.x)*0.12
      e.mesh.rotation.y += dt*0.9
      if(e.mesh.position.distanceTo(this.sonic.position) < 0.95 && this.velocity.y < -0.2){
        // bounce off enemy
        e.alive=false; e.mesh.visible=false; this.velocity.y = 8.5; this.rings += 2
      } else if(e.mesh.position.distanceTo(this.sonic.position) < 1.0 && this.invuln<=0){
        if(this.rings>0){ this.rings = Math.max(0, this.rings-8); this.invuln=1.4; this.velocity.y=4; this.velocity.x += (Math.random()-0.5)*6 } else { this.state='lost' }
      }
      // homing target when in air and close
      if(!this.onGround && this.velocity.y < 2 && e.alive && e.mesh.position.distanceTo(this.sonic.position) < 7 && Math.abs(e.mesh.position.y - this.sonic.position.y)<2.2){
        const dir = e.mesh.position.clone().sub(this.sonic.position).normalize()
        const dot = new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw)).dot(dir)
        if(dot>0.42) this.homingTarget = e.mesh.position.clone()
      }
    })
    // Springs
    this.springs.forEach(s=>{
      if(s.mesh.position.distanceTo(this.sonic.position) < 1.25){
        this.velocity.y = s.power
        this.velocity.x *= 0.72; this.velocity.z = -Math.abs(this.velocity.z)*0.6 - 2.2
        this.onGround=false; this.coyote=0
        s.mesh.scale.set(1.18,0.82,1.18); setTimeout(()=> s.mesh.scale.set(1,1,1), 140)
      }
    })
    // Dashes
    this.dashes.forEach(d=>{
      if(d.mesh.position.distanceTo(this.sonic.position) < 1.6 && Math.abs(d.mesh.position.y - this.sonic.position.y)<1.2){
        const fwd = new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw))
        const dot = fwd.dot(d.dir)
        if(dot > -0.5){
          this.velocity.add(d.dir.clone().multiplyScalar(11))
          this.yaw = Math.atan2(d.dir.x, d.dir.z)
        }
      }
    })
    // Goal
    if(this.goal.position.distanceTo(this.sonic.position) < 1.55){
      this.state='won'
    }

    // Input -> character relative to camera
    const camFwd = new THREE.Vector3(); this.camera.getWorldDirection(camFwd); camFwd.y=0; camFwd.normalize()
    const camRight = new THREE.Vector3(-camFwd.z,0,camFwd.x)
    let mx=0, mz=0
    if(this.input.isDown('keyw')||this.input.isDown('arrowup')) mz += 1
    if(this.input.isDown('keys')||this.input.isDown('arrowdown')) mz -= 1
    if(this.input.isDown('keya')||this.input.isDown('arrowleft')) mx -= 1
    if(this.input.isDown('keyd')||this.input.isDown('arrowright')) mx += 1
    // touch
    const t:any = (this.input as any).touch
    if(t){ if(t.f) mz+=1; if(t.b) mz-=1; if(t.l) mx-=1; if(t.r) mx+=1 }

    const move = new THREE.Vector3()
    move.addScaledVector(camRight, mx)
    move.addScaledVector(camFwd, mz)
    if(move.lengthSq()>0){
      move.normalize()
      // accelerate
      const targetYaw = Math.atan2(move.x, move.z)
      let diff = targetYaw - this.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      this.yaw += diff * Math.min(1, dt*9.5)
      const isRun = this.input.isDown('shiftleft')||this.input.isDown('shiftright')|| (t && t.run)
      const accel = isRun ? 38 : 26
      const maxSpeed = isRun ? 14.5 : 8.2
      // Dreamcast inertia - Sonic feels slippery but responsive
      const curSpeed = Math.hypot(this.velocity.x, this.velocity.z)
      if(curSpeed < maxSpeed || move.dot(new THREE.Vector3(this.velocity.x,0,this.velocity.z).normalize())<0.2){
        this.velocity.x += move.x * accel * dt
        this.velocity.z += move.z * accel * dt
      } else {
        // at max, allow turning
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, move.x*maxSpeed, dt*3.2)
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, move.z*maxSpeed, dt*3.2)
      }
      this.speed = THREE.MathUtils.lerp(this.speed, maxSpeed, dt*6)
    } else {
      // friction
      this.velocity.x *= Math.pow(0.12, dt)
      this.velocity.z *= Math.pow(0.12, dt)
      this.speed = THREE.MathUtils.lerp(this.speed, 0, dt*7)
    }

    // Jump
    const wantJump = this.input.isDown('space') || (t && t.interact)
    if(wantJump) this.jumpBuffer = 0.18
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    this.coyote = this.onGround ? 0.16 : Math.max(0, this.coyote - dt)

    // Homing attack
    if(!this.onGround && this.jumpBuffer>0 && this.homingTarget){
      const to = this.homingTarget.clone().sub(this.sonic.position).normalize()
      this.velocity.x = to.x * 13
      this.velocity.z = to.z * 13
      this.velocity.y = 5.5
      this.homingTarget=null
      this.jumpBuffer=0
      this.coyote=0
    } else if(this.jumpBuffer>0 && this.coyote>0){
      this.velocity.y = 9.2
      this.onGround=false; this.coyote=0; this.jumpBuffer=0
    }

    // Gravity
    this.velocity.y -= 28 * dt
    if(this.velocity.y < -24) this.velocity.y = -24

    // integrate
    const next = this.sonic.position.clone().add(this.velocity.clone().multiplyScalar(dt))

    // Ground check - raycast style: find highest platform below
    let groundY = -100
    let onPlat: THREE.Mesh | null = null
    for(const c of this.colliders){
      const b = c.box
      if(next.x >= b.min.x-0.45 && next.x <= b.max.x+0.45 && next.z >= b.min.z-0.45 && next.z <= b.max.z+0.45){
        const top = b.max.y
        if(top <= this.sonic.position.y + 0.3 && top > groundY && next.y -1.0 <= top + 0.45){
          groundY = top
          onPlat = c.mesh || null
        }
      }
    }
    // Loop logic - when inside loop torus, follow loop path
    const inLoop = next.z > -74 && next.z < -66 && Math.abs(next.x)<4.5
    if(inLoop && Math.abs(this.velocity.z)>4.5){
      // stick to loop - override y to loop height
      const loopT = (next.z + 74)/8 // 0..1
      const ang = loopT * Math.PI*2
      // simple: when speed enough, follow loop tube, else fall
      if(Math.hypot(this.velocity.x, this.velocity.z) > 8.5){
        next.y = 7.2 + Math.sin(ang)*4.0 + 1.0
        // keep velocity tangential
        const tangent = new THREE.Vector3(0, Math.cos(ang)*4.0, -Math.sin(ang)*4.0).normalize()
        // ignore, just keep y
      }
    }

    if(next.y - 1.0 <= groundY + 0.12 && this.velocity.y <= 0){
      next.y = groundY + 1.0
      this.velocity.y = 0
      if(!this.onGround){
        // landing
      }
      this.onGround = true
    } else {
      this.onGround = false
    }

    // wall slide simple
    let blocked = false
    for(const c of this.colliders){
      const b = c.box
      if(next.y < b.max.y -0.2) continue // only check side when roughly at same height
      if(next.y > b.max.y + 1.2) continue
      if(next.x >= b.min.x-0.35 && next.x <= b.max.x+0.35 && next.z >= b.min.z-0.35 && next.z <= b.max.z+0.35){
        // push out
        const cx = (b.min.x+b.max.x)/2, cz=(b.min.z+b.max.z)/2
        const dx = next.x - cx, dz = next.z - cz
        if(Math.abs(dx) > Math.abs(dz)){
          next.x = dx>0 ? b.max.x+0.36 : b.min.x-0.36
          this.velocity.x = 0
        } else {
          next.z = dz>0 ? b.max.z+0.36 : b.min.z-0.36
          this.velocity.z = 0
        }
        blocked = true
      }
    }

    this.sonic.position.copy(next)

    // Checkpoints
    for(let i=0;i<this.checkpoints.length;i++){
      if(this.sonic.position.distanceTo(this.checkpoints[i])<2.2){
        // update respawn? just keep last
      }
    }

    // Kill plane
    if(this.sonic.position.y < this.killY){
      if(this.rings>0){ this.rings=0; this.sonic.position.copy(this.checkpoints[1]); this.velocity.set(0,0,0) } else { this.state='lost' }
    }

    // Sonic mesh animation
    this.sonic.rotation.y = this.yaw
    const isMoving = Math.hypot(this.velocity.x, this.velocity.z) > 0.8
    if(!this.onGround){
      this.sonicMesh.rotation.x = THREE.MathUtils.lerp(this.sonicMesh.rotation.x, 0.9, dt*8)
      this.spinTime += dt*14
      this.sonicMesh.rotation.y = this.spinTime % (Math.PI*2)
    } else if(isMoving){
      this.sonicMesh.rotation.x = Math.sin(this.time*12)*0.12
      this.sonicMesh.rotation.z = Math.sin(this.time*9)*0.08
      this.sonicMesh.rotation.y = THREE.MathUtils.lerp(this.sonicMesh.rotation.y, 0, dt*10)
    } else {
      this.sonicMesh.rotation.x = THREE.MathUtils.lerp(this.sonicMesh.rotation.x, 0, dt*6)
      this.sonicMesh.rotation.y = THREE.MathUtils.lerp(this.sonicMesh.rotation.y, 0, dt*8)
    }
    // shadow
    this.sonic.children.forEach((c:any)=>{ if(c.userData.isSonicShadow){ c.position.set(this.sonic.position.x,0.02,this.sonic.position.z); c.material.opacity = this.onGround?0.22:0.08; c.scale.setScalar(this.onGround?1:0.62) } })

    // Goal spin
    this.goal.rotation.y += dt*1.4
    this.goal.position.y = 5.9 + Math.sin(time*1.6)*0.12

    // reset homing if far
    if(this.homingTarget && this.homingTarget.distanceTo(this.sonic.position)>9) this.homingTarget=null
  }

  getHUD(){
    const sec = Math.floor(this.time % 60).toString().padStart(2,'0')
    const min = Math.floor(this.time/60).toString().padStart(2,'0')
    return { rings:this.rings, time:`${min}:${sec}`, lives:this.lives, speed: Math.hypot(this.velocity.x,this.velocity.z).toFixed(1) }
  }
}
