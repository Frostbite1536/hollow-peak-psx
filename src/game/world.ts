import * as THREE from 'three'
import { psxifyMaterial, makeNearestTexture } from '../engine/psx'

export interface Tape { mesh: THREE.Group; collected: boolean; pos: THREE.Vector3 }

function makeCanvasTexture(w:number,h:number, draw:(ctx:CanvasRenderingContext2D)=>void){
  const c = document.createElement('canvas')
  c.width=w; c.height=h
  const ctx=c.getContext('2d')!
  draw(ctx)
  const tex=new THREE.CanvasTexture(c)
  tex.magFilter=THREE.NearestFilter
  tex.minFilter=THREE.NearestFilter
  tex.generateMipmaps=false
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping
  tex.colorSpace=THREE.SRGBColorSpace
  return tex
}

export function createWorld(scene: THREE.Scene, psxMaterials: THREE.Material[]) {
  const groundSize = 160
  // Snow ground with low subdiv for wobble
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 20, 20)
  // Add slight displacement for snow banks
  const pos = groundGeo.attributes.position
  for (let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i)
    const d = Math.hypot(x,y)
    let h = Math.sin(x*0.07)*0.6 + Math.cos(y*0.08)*0.6
    if(d>55) h += (d-55)*0.12
    if(Math.abs(x)>60 || Math.abs(y)>60) h += 1.2
    // footpath groove toward observatory
    const pathDist = Math.abs(y) < 3 && x > -10 && x < 40 ? -0.35 : 0
    pos.setZ(i, h + pathDist + (Math.random()-0.5)*0.12)
  }
  groundGeo.computeVertexNormals()
  // Create mottled snow texture for affine swim
  const snowTex = makeCanvasTexture(64,64, ctx=>{
    ctx.fillStyle='#e8eef2'; ctx.fillRect(0,0,64,64)
    for(let i=0;i<220;i++){
      const x=(Math.random()*64)|0, y=(Math.random()*64)|0
      const v= 210 + (Math.random()*22)|0
      ctx.fillStyle=`rgb(${v},${v},${v+2})`
      ctx.fillRect(x,y,2,2)
      if(Math.random()>0.85){ ctx.fillStyle='rgba(180,190,205,0.55)'; ctx.fillRect(x,y,1,1) }
    }
    // faint tracks
    ctx.strokeStyle='rgba(160,175,190,0.22)'; ctx.lineWidth=1
    for(let i=0;i<6;i++){ ctx.beginPath(); ctx.moveTo((Math.random()*64)|0,0); ctx.lineTo((Math.random()*64)|0,64); ctx.stroke() }
  })
  snowTex.repeat.set(10,10)
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: snowTex })
  psxifyMaterial(groundMat)
  psxMaterials.push(groundMat)
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI/2
  ground.receiveShadow = false
  scene.add(ground)

  // Building wall texture - low-res repeating
  const wallTex = makeCanvasTexture(32,32, ctx=>{
    ctx.fillStyle='#8a9aa8'; ctx.fillRect(0,0,32,32)
    ctx.fillStyle='#7d8e9e'; ctx.fillRect(0,0,32,2); ctx.fillRect(0,15,32,2); ctx.fillRect(0,30,32,2)
    ctx.fillStyle='#9aabb8'; for(let i=0;i<18;i++){ const x=(Math.random()*32)|0, y=(Math.random()*32)|0; ctx.fillRect(x,y,1,1) }
    // panel line
    ctx.fillStyle='rgba(0,0,0,0.12)'; ctx.fillRect(15,0,2,32)
  })
  wallTex.repeat.set(1,1)
  const metalTex = makeCanvasTexture(32,32, ctx=>{
    ctx.fillStyle='#6a7682'; ctx.fillRect(0,0,32,32)
    for(let i=0;i<60;i++){ const x=(Math.random()*32)|0, y=(Math.random()*32)|0; ctx.fillStyle=Math.random()>0.5?'#7a8692':'#5a6672'; ctx.fillRect(x,y,2,1) }
  })
  // Helper to make low-poly building
  function makeBuilding(w:number,h:number,d:number,color:number, pos:THREE.Vector3){
    const g = new THREE.BoxGeometry(w,h,d)
    // bevel by moving vertices slightly for PS1 chipped look
    const p = g.attributes.position
    for(let i=0;i<p.count;i++){
      p.setX(i, p.getX(i)+(Math.random()-0.5)*0.04)
      p.setY(i, p.getY(i)+(Math.random()-0.5)*0.04)
      p.setZ(i, p.getZ(i)+(Math.random()-0.5)*0.04)
    }
    g.computeVertexNormals()
    let tex: THREE.Texture | null = null
    if(color===0x8a9aa8) tex = wallTex
    else if(color===0x6a7682) tex = metalTex
    const m = new THREE.MeshLambertMaterial({ color, map: tex })
    psxifyMaterial(m); psxMaterials.push(m)
    const mesh = new THREE.Mesh(g,m)
    mesh.position.copy(pos)
    mesh.position.y += h/2
    // add edges as black lines? Use outline via second mesh slightly larger with backface
    scene.add(mesh)
    // Add roof snow cap
    const roofGeo = new THREE.BoxGeometry(w+0.3,0.35,d+0.3)
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xf2f6f8 })
    psxifyMaterial(roofMat); psxMaterials.push(roofMat)
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.set(pos.x, pos.y + h + 0.18, pos.z)
    scene.add(roof)
    // windows glowing
    const winGeo = new THREE.PlaneGeometry(w*0.22, h*0.28)
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffc66a, transparent:true, opacity: 0.0 })
    // flicker via userData
    for(let s of [-1,1]){
      const win = new THREE.Mesh(winGeo, winMat.clone())
      win.position.set(pos.x + s*w*0.28, pos.y + h*0.45, pos.z + d/2+0.02)
      win.userData = { flicker: Math.random()*Math.PI*2, baseOpacity: 0.68 }
      scene.add(win)
    }
    return mesh
  }

  // Observatory - main
  const obs = makeBuilding(14, 7, 10, 0x8a9aa8, new THREE.Vector3(22,0,0))
  // Dish on top
  const dishGroup = new THREE.Group()
  dishGroup.position.set(22,7.7,0)
  const dishGeo = new THREE.CylinderGeometry(4.2, 3.0, 1.2, 10, 1, true)
  const dishMat = new THREE.MeshLambertMaterial({ color: 0xd0d6dc, side: THREE.DoubleSide })
  psxifyMaterial(dishMat); psxMaterials.push(dishMat)
  const dish = new THREE.Mesh(dishGeo, dishMat)
  dish.rotation.x = Math.PI*0.12
  dishGroup.add(dish)
  // dish stand
  const standGeo = new THREE.CylinderGeometry(0.5,0.6,2.2,6)
  const standMat = new THREE.MeshLambertMaterial({ color: 0x6a7682 })
  psxifyMaterial(standMat); psxMaterials.push(standMat)
  const stand = new THREE.Mesh(standGeo, standMat)
  stand.position.y = -1.1
  dishGroup.add(stand)
  scene.add(dishGroup)

  // Generator shed
  makeBuilding(6,3.2,5, 0x7a8a7a, new THREE.Vector3(18,0,-16))
  // Comms tower base
  makeBuilding(4,9,4, 0x6e7e8e, new THREE.Vector3(-6,0,22))
  // Garage / wreck
  makeBuilding(7,3,6, 0x8e7a6a, new THREE.Vector3(-14,0,-8))
  // Small bunker
  makeBuilding(5,2.4,5, 0x7a7a86, new THREE.Vector3(2,0,-24))

  // Tower antenna - skeletal
  const tower = new THREE.Group()
  tower.position.set(-6,9,22)
  const poleGeo = new THREE.CylinderGeometry(0.12,0.18,14,5)
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x33363a })
  psxifyMaterial(poleMat); psxMaterials.push(poleMat)
  const pole = new THREE.Mesh(poleGeo, poleMat)
  pole.position.y = 7
  tower.add(pole)
  // red light
  const lightGeo = new THREE.SphereGeometry(0.35,6,6)
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 })
  const light = new THREE.Mesh(lightGeo, lightMat)
  light.position.y = 14.2
  tower.add(light)
  scene.add(tower)

  // Trees - low poly cones + trunks
  function addTree(x:number,z:number, scale=1){
    const trunkGeo = new THREE.CylinderGeometry(0.18*scale,0.24*scale,1.6*scale,5)
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1f })
    psxifyMaterial(trunkMat); psxMaterials.push(trunkMat)
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.position.set(x,0.8*scale,z)
    scene.add(trunk)
    const foliageGeo = new THREE.ConeGeometry(1.1*scale,3.2*scale,6)
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x1e3a24 })
    // vary hue slightly
    foliageMat.color.offsetHSL((Math.random()-0.5)*0.04,0,0)
    psxifyMaterial(foliageMat); psxMaterials.push(foliageMat)
    const foliage = new THREE.Mesh(foliageGeo, foliageMat)
    foliage.position.set(x,1.6*scale+1.2*scale,z)
    // random rotation
    foliage.rotation.y = Math.random()*Math.PI
    scene.add(foliage)
    // snow cap on foliage
    const capGeo = new THREE.ConeGeometry(0.55*scale,0.7*scale,6)
    const capMat = new THREE.MeshLambertMaterial({ color: 0xe6eef0 })
    psxifyMaterial(capMat); psxMaterials.push(capMat)
    const cap = new THREE.Mesh(capGeo, capMat)
    cap.position.set(x,1.6*scale+2.6*scale,z)
    cap.rotation.y = foliage.rotation.y
    scene.add(cap)
  }

  // Forest perimeter
  for(let i=0;i<70;i++){
    const ang = Math.random()*Math.PI*2
    const rad = 38 + Math.random()*32
    const x = Math.cos(ang)*rad + (Math.random()-0.5)*8
    const z = Math.sin(ang)*rad + (Math.random()-0.5)*8
    // avoid center compound
    if(Math.hypot(x-10, z) < 18) continue
    if(Math.hypot(x, z) < 8) continue
    addTree(x,z, 0.85 + Math.random()*0.55)
  }
  // Closer sparse trees
  const closeTrees = [[12,10],[18,8],[28,4],[24,-10],[10,-18],[ -2,-12],[ -10,6],[6,14],[0,18]]
  closeTrees.forEach(([x,z])=> addTree(x,z,0.9))

  // Fence posts around compound
  for(let i=0;i< 18;i++){
    const t = i/18
    const ang = t*Math.PI*2
    const rad = 26
    const x = Math.cos(ang)*rad + 10
    const z = Math.sin(ang)*rad
    if(Math.abs(x-10)<6 && z>-4 && z<4) continue // gate gap
    const postGeo = new THREE.BoxGeometry(0.16,1.2,0.16)
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4a3a })
    psxifyMaterial(postMat); psxMaterials.push(postMat)
    const post = new THREE.Mesh(postGeo, postMat)
    post.position.set(x,0.6,z)
    scene.add(post)
    if(i%3===0){
      const wireGeo = new THREE.BoxGeometry(0.02,0.02,3.8)
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x222222 })
      const wire = new THREE.Mesh(wireGeo, wireMat)
      wire.position.set(x,0.9,z+1.9)
      wire.rotation.y = ang + Math.PI/2
      scene.add(wire)
    }
  }

  // Snowdrifts as low boxes
  for(let i=0;i<12;i++){
    const x = (Math.random()-0.5)*90
    const z = (Math.random()-0.5)*90
    if(Math.hypot(x-10,z)<14) continue
    const h = 0.3 + Math.random()*0.7
    const w = 2 + Math.random()*4
    const d = 1.5 + Math.random()*3
    const driftGeo = new THREE.BoxGeometry(w,h,d)
    const driftMat = new THREE.MeshLambertMaterial({ color: 0xeef4f6 })
    psxifyMaterial(driftMat); psxMaterials.push(driftMat)
    const drift = new THREE.Mesh(driftGeo, driftMat)
    drift.position.set(x,h/2-0.05,z)
    drift.rotation.y = Math.random()*Math.PI
    scene.add(drift)
  }

  // Tapes - collectibles
  const tapePositions = [
    new THREE.Vector3(22,0.35,-4), // inside obs - but we place outside for accessibility
    new THREE.Vector3(18,0.35,-16), // generator shed
    new THREE.Vector3(-6,0.35,22), // tower base
    new THREE.Vector3(-14,0.35,-8), // garage
  ]
  // Adjust to be reachable outside buildings
  tapePositions[0].set(26.5,0.42,3.2)
  tapePositions[1].set(18.8,0.42,-12.5)
  tapePositions[2].set(-3.2,0.42,18.8)
  tapePositions[3].set(-11.2,0.42,-5.2)

  const tapes: Tape[] = []
  tapePositions.forEach((p, idx)=>{
    const g = new THREE.Group()
    g.position.copy(p)

    // Tape deck - small black rectangle with label
    const bodyGeo = new THREE.BoxGeometry(0.85,0.12,0.55)
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 })
    psxifyMaterial(bodyMat); psxMaterials.push(bodyMat)
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 0.18
    g.add(body)
    // reels
    const reelGeo = new THREE.CylinderGeometry(0.13,0.13,0.02,8)
    const reelMat = new THREE.MeshBasicMaterial({ color: 0x222222 })
    for(let s of [-0.2,0.2]){
      const reel = new THREE.Mesh(reelGeo, reelMat)
      reel.rotation.x = Math.PI/2
      reel.position.set(s,0.25,0)
      g.add(reel)
    }
    // label
    const labelGeo = new THREE.PlaneGeometry(0.55,0.22)
    const labelMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent:true, opacity:0.92 })
    // color per tape
    const colors = [0xe85d5d, 0x5da6e8, 0x7ad67a, 0xe8c55d]
    ;(labelMat.color as THREE.Color).setHex(colors[idx])
    const label = new THREE.Mesh(labelGeo, labelMat)
    label.rotation.x = -Math.PI/2
    label.position.y = 0.251
    g.add(label)

    // glow ring
    const ringGeo = new THREE.RingGeometry(0.65,0.75,12)
    const ringMat = new THREE.MeshBasicMaterial({ color: colors[idx], transparent:true, opacity:0.22, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI/2
    ring.position.y = 0.02
    ring.userData = { base: idx, phase: Math.random()*Math.PI*2 }
    g.add(ring)

    // floating arrow
    const arrowGeo = new THREE.ConeGeometry(0.18,0.36,4)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.78 })
    const arrow = new THREE.Mesh(arrowGeo, arrowMat)
    arrow.position.y = 1.05
    arrow.rotation.x = Math.PI
    arrow.userData = { isArrow: true }
    g.add(arrow)

    g.userData = { tapeIndex: idx }
    scene.add(g)
    tapes.push({ mesh: g, collected:false, pos: p.clone() })
  })

  // --- NEW GAMEPLAY OBJECTS ---
  // Locked observatory door (blocks transmitter until key found)
  const doorGroup = new THREE.Group()
  doorGroup.position.set(22,0,5.05)
  const doorGeo = new THREE.BoxGeometry(2.2,2.8,0.18)
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a })
  psxifyMaterial(doorMat); psxMaterials.push(doorMat)
  const doorMesh = new THREE.Mesh(doorGeo, doorMat)
  doorMesh.position.y = 1.4
  doorGroup.add(doorMesh)
  // door frame
  const frameGeo = new THREE.BoxGeometry(2.6,3.0,0.12)
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
  const frame = new THREE.Mesh(frameGeo, frameMat)
  frame.position.set(0,1.45,-0.08)
  doorGroup.add(frame)
  // padlock
  const lockGeo = new THREE.BoxGeometry(0.28,0.32,0.12)
  const lockMat = new THREE.MeshLambertMaterial({ color: 0xd4b024 })
  psxifyMaterial(lockMat); psxMaterials.push(lockMat)
  const lockMesh = new THREE.Mesh(lockGeo, lockMat)
  lockMesh.position.set(0.52,1.35,0.14)
  doorGroup.add(lockMesh)
  doorGroup.userData = { isDoor:true, mesh: doorMesh, lock: lockMesh }
  scene.add(doorGroup)

  // Generator at shed
  const genGroup = new THREE.Group()
  genGroup.position.set(18,0,-16)
  const genBoxGeo = new THREE.BoxGeometry(1.8,1.0,1.2)
  const genBoxMat = new THREE.MeshLambertMaterial({ color: 0x3a4a3a })
  psxifyMaterial(genBoxMat); psxMaterials.push(genBoxMat)
  const genBox = new THREE.Mesh(genBoxGeo, genBoxMat)
  genBox.position.set(0,0.62,0)
  genGroup.add(genBox)
  const genLightGeo = new THREE.SphereGeometry(0.14,6,6)
  const genLightMat = new THREE.MeshBasicMaterial({ color: 0x442222 })
  const genLight = new THREE.Mesh(genLightGeo, genLightMat)
  genLight.position.set(0,1.22,0)
  genGroup.add(genLight)
  // lever
  const leverGeo = new THREE.CylinderGeometry(0.04,0.04,0.5,4)
  const leverMat = new THREE.MeshLambertMaterial({ color: 0xaa2222 })
  psxifyMaterial(leverMat); psxMaterials.push(leverMat)
  const lever = new THREE.Mesh(leverGeo, leverMat)
  lever.position.set(0.45,0.78,0.62)
  lever.rotation.x = Math.PI*0.35
  genGroup.add(lever)
  genGroup.userData = { isGenerator:true, light: genLight, lever }
  scene.add(genGroup)

  // Key - in garage
  const keyGroup = new THREE.Group()
  keyGroup.position.set(-16.2,0.42,-8.8)
  const keyRingGeo = new THREE.TorusGeometry(0.14,0.02,6,10)
  const keyMat = new THREE.MeshLambertMaterial({ color: 0xd4b024 })
  psxifyMaterial(keyMat); psxMaterials.push(keyMat)
  const ring = new THREE.Mesh(keyRingGeo, keyMat)
  ring.position.y = 0.18
  ring.rotation.x = Math.PI/2
  keyGroup.add(ring)
  const keyBladeGeo = new THREE.BoxGeometry(0.04,0.02,0.38)
  const blade = new THREE.Mesh(keyBladeGeo, keyMat)
  blade.position.set(0,0.18,0.24)
  keyGroup.add(blade)
  const keyGlow = new THREE.Mesh(new THREE.RingGeometry(0.5,0.6,10), new THREE.MeshBasicMaterial({ color: 0xd4b024, transparent:true, opacity:0.18, side:THREE.DoubleSide }))
  keyGlow.rotation.x = -Math.PI/2; keyGlow.position.y=0.02
  keyGroup.add(keyGlow)
  const keyArrow = new THREE.Mesh(new THREE.ConeGeometry(0.16,0.32,4), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent:true, opacity:0.75 }))
  keyArrow.position.y=0.95; keyArrow.rotation.x=Math.PI; keyArrow.userData={isArrow:true}
  keyGroup.add(keyArrow)
  keyGroup.userData={ isKey:true, pos: keyGroup.position.clone() }
  scene.add(keyGroup)

  // Fuse - at tower
  const fuseGroup = new THREE.Group()
  fuseGroup.position.set(-7.6,0.42,21.2)
  const fuseGeo = new THREE.CylinderGeometry(0.12,0.12,0.5,6)
  const fuseMat = new THREE.MeshLambertMaterial({ color: 0x4a8ac8 })
  psxifyMaterial(fuseMat); psxMaterials.push(fuseMat)
  const fuseMesh = new THREE.Mesh(fuseGeo, fuseMat)
  fuseMesh.position.y=0.18
  fuseMesh.rotation.z=Math.PI/2
  fuseGroup.add(fuseMesh)
  // fuse caps
  const capGeo = new THREE.CylinderGeometry(0.14,0.14,0.08,6)
  const capMat = new THREE.MeshLambertMaterial({ color: 0x888888 })
  psxifyMaterial(capMat); psxMaterials.push(capMat)
  for(let s of [-0.28,0.28]){ const c=new THREE.Mesh(capGeo, capMat); c.position.set(0,0.18,s); c.rotation.z=Math.PI/2; fuseGroup.add(c) }
  const fuseGlow = new THREE.Mesh(new THREE.RingGeometry(0.48,0.58,10), new THREE.MeshBasicMaterial({ color: 0x4a8ac8, transparent:true, opacity:0.18, side:THREE.DoubleSide }))
  fuseGlow.rotation.x=-Math.PI/2; fuseGlow.position.y=0.02
  fuseGroup.add(fuseGlow)
  const fuseArrow = keyArrow.clone(); fuseArrow.material = new THREE.MeshBasicMaterial({ color: 0x6ab8ff, transparent:true, opacity:0.75 }); fuseGroup.add(fuseArrow)
  fuseGroup.userData={ isFuse:true, pos: fuseGroup.position.clone() }
  scene.add(fuseGroup)

  // Fuel can - at bunker
  const fuelGroup = new THREE.Group()
  fuelGroup.position.set(3.8,0.42,-24.6)
  const fuelGeo = new THREE.BoxGeometry(0.5,0.62,0.32)
  const fuelMat = new THREE.MeshLambertMaterial({ color: 0xc0392b })
  psxifyMaterial(fuelMat); psxMaterials.push(fuelMat)
  const fuelMesh = new THREE.Mesh(fuelGeo, fuelMat)
  fuelMesh.position.y=0.32
  fuelGroup.add(fuelMesh)
  // handle
  const handleGeo = new THREE.TorusGeometry(0.12,0.02,4,8, Math.PI)
  const handle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0x222222 }))
  handle.position.set(0,0.64,0); handle.rotation.y=Math.PI/2
  fuelGroup.add(handle)
  const fuelGlow = new THREE.Mesh(new THREE.RingGeometry(0.5,0.6,10), new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent:true, opacity:0.16, side:THREE.DoubleSide }))
  fuelGlow.rotation.x=-Math.PI/2; fuelGlow.position.y=0.02
  fuelGroup.add(fuelGlow)
  const fuelArrow = keyArrow.clone(); fuelArrow.material = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent:true, opacity:0.75 }); fuelGroup.add(fuelArrow)
  fuelGroup.userData={ isFuel:true, pos: fuelGroup.position.clone() }
  scene.add(fuelGroup)

  // Batteries (3) - scattered
  const batteryPositions = [
    new THREE.Vector3(24.2,0.32, -1.2),
    new THREE.Vector3(6.2,0.32, 8.4),
    new THREE.Vector3(-2.2,0.32, -16.4),
  ]
  const batteries: THREE.Group[] = []
  batteryPositions.forEach(p=>{
    const bg = new THREE.Group(); bg.position.copy(p)
    const bGeo = new THREE.CylinderGeometry(0.1,0.1,0.32,6)
    const bMat = new THREE.MeshLambertMaterial({ color: 0x2ecc71 })
    psxifyMaterial(bMat); psxMaterials.push(bMat)
    const b = new THREE.Mesh(bGeo, bMat); b.position.y=0.18; b.rotation.z=Math.PI/2; bg.add(b)
    const bGlow = new THREE.Mesh(new THREE.RingGeometry(0.35,0.42,8), new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent:true, opacity:0.14, side:THREE.DoubleSide }))
    bGlow.rotation.x=-Math.PI/2; bGlow.position.y=0.02; bg.add(bGlow)
    const bArrow = keyArrow.clone(); bArrow.scale.set(0.7,0.7,0.7); bArrow.material = new THREE.MeshBasicMaterial({ color: 0x7aff8a, transparent:true, opacity:0.7 }); bg.add(bArrow)
    bg.userData={ isBattery:true, pos: p.clone() }
    scene.add(bg); batteries.push(bg)
  })

  // Transmitter - goal after tapes
  const txGroup = new THREE.Group()
  txGroup.position.set(22,0,6.5)
  const txGeo = new THREE.BoxGeometry(1.6,1.1,1.0)
  const txMat = new THREE.MeshLambertMaterial({ color: 0x2a3a4a })
  psxifyMaterial(txMat); psxMaterials.push(txMat)
  const tx = new THREE.Mesh(txGeo, txMat)
  tx.position.y = 0.65
  txGroup.add(tx)
  const txLightGeo = new THREE.SphereGeometry(0.18,6,6)
  const txLightMat = new THREE.MeshBasicMaterial({ color: 0x30ff30 })
  const txLight = new THREE.Mesh(txLightGeo, txLightMat)
  txLight.position.set(0,1.25,0)
  txGroup.add(txLight)
  txGroup.userData = { isTransmitter: true, light: txLight }
  scene.add(txGroup)

  // Fog + moon
  scene.fog = new THREE.Fog(0x9aa8b8, 18, 72)

  // Simple sky dome gradient via background + low dome
  scene.background = new THREE.Color(0x0f141e)
  const skyGeo = new THREE.SphereGeometry(90,12,8,0,Math.PI*2,0,Math.PI*0.52)
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1a2332, side: THREE.BackSide, transparent:true, opacity:0.92 })
  const sky = new THREE.Mesh(skyGeo, skyMat)
  scene.add(sky)

  // Moon
  const moonGeo = new THREE.SphereGeometry(3.2,8,8)
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xe8e8d0, transparent:true, opacity:0.85 })
  const moon = new THREE.Mesh(moonGeo, moonMat)
  moon.position.set(-42,38,-48)
  scene.add(moon)
  // moon halo
  const haloGeo = new THREE.RingGeometry(4.2,5.0,12)
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xaab4c0, transparent:true, opacity:0.12, side: THREE.DoubleSide })
  const halo = new THREE.Mesh(haloGeo, haloMat)
  halo.position.copy(moon.position)
  halo.lookAt(0,0,0)
  scene.add(halo)

  // Colliders - simple boxes for buildings (AABB)
  const colliders: THREE.Box3[] = []
  const addCollider = (center:THREE.Vector3, size:THREE.Vector3)=>{
    const box = new THREE.Box3(
      new THREE.Vector3(center.x - size.x/2, 0, center.z - size.z/2),
      new THREE.Vector3(center.x + size.x/2, size.y, center.z + size.z/2)
    )
    colliders.push(box)
  }
  addCollider(new THREE.Vector3(22,0,0), new THREE.Vector3(14,7,10))
  addCollider(new THREE.Vector3(18,0,-16), new THREE.Vector3(6,3.2,5))
  addCollider(new THREE.Vector3(-6,0,22), new THREE.Vector3(4,9,4))
  addCollider(new THREE.Vector3(-14,0,-8), new THREE.Vector3(7,3,6))
  addCollider(new THREE.Vector3(2,0,-24), new THREE.Vector3(5,2.4,5))
  // cliff walls at far edges via extra colliders
  // forest walls considered soft colliders - we handle via distance

  return { tapes, colliders, moon, dishGroup, towerLight: light, txGroup, doorGroup, genGroup, keyGroup, fuseGroup, fuelGroup, batteries, psxMaterials }
}
