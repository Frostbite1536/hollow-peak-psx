import * as THREE from 'three'

export const PSX_WIDTH = 320
export const PSX_HEIGHT = 240

// Dither matrix 4x4 Bayer
const BAYER_4x4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
]

export function psxifyMaterial(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial) {
  // Enable flat shading for PS1 faceted look
  mat.flatShading = true
  // Nearest filtering is set on textures, not material
  // Inject vertex snap + affine UV warp
  mat.onBeforeCompile = (shader: any) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uJitter;
       uniform float uTime;
       varying vec2 vAffineUv;`
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       vAffineUv = uv;`
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      // PSX GTE: fixed-point snap — authentic jitter WITHOUT triangle cracks.
      // PS1 lacked subpixel precision, so vertices snap to screen pixels. The original
      // per-vertex hash created cracks/tearing at triangle edges. Fix: uniform per-frame
      // wobble only, no per-vertex divergence.
      vec4 mvPosition = vec4(transformed, 1.0);
      mvPosition = modelViewMatrix * mvPosition;
      vec4 projPos = projectionMatrix * mvPosition;
      projPos.xyz /= projPos.w;
      float snapX = 1.0 / 320.0;
      float snapY = 1.0 / 240.0;
      // Uniform polygon swim — global only, zero per-vertex bias → no cracks
      float globalWob = sin(uTime * 0.88 + dot(mvPosition.xy, vec2(0.11,0.07))) * 0.00105 * uJitter;
      // Secondary low-freq swim for larger polygons (adds life without tearing)
      float swim2 = sin(uTime * 0.31 + mvPosition.x * 0.04) * 0.00038 * uJitter;
      float wob = globalWob + swim2;
      projPos.x = floor(projPos.x / snapX + 0.5) * snapX + wob;
      projPos.y = floor(projPos.y / snapY + 0.5) * snapY + wob * 0.72;
      // Z quantization — 192 levels: enough depth sorting, no Z-fighting grid
      projPos.z = floor(projPos.z * 192.0) / 192.0;
      vAffineUv *= projPos.w;
      gl_Position = vec4(projPos.xy * projPos.w, projPos.z * projPos.w, projPos.w);
      `
    )
    // Fragment: affine correction + dither + banding
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec2 vAffineUv;
       uniform float uDither;
       uniform float uTime;
       // 4x4 bayer
       float bayer(vec2 p) {
         int x = int(mod(p.x, 4.0));
         int y = int(mod(p.y, 4.0));
         int idx = y * 4 + x;
         // unrolled
         if (idx==0) return 0.0/16.0;
         if (idx==1) return 8.0/16.0;
         if (idx==2) return 2.0/16.0;
         if (idx==3) return 10.0/16.0;
         if (idx==4) return 12.0/16.0;
         if (idx==5) return 4.0/16.0;
         if (idx==6) return 14.0/16.0;
         if (idx==7) return 6.0/16.0;
         if (idx==8) return 3.0/16.0;
         if (idx==9) return 11.0/16.0;
         if (idx==10) return 1.0/16.0;
         if (idx==11) return 9.0/16.0;
         if (idx==12) return 15.0/16.0;
         if (idx==13) return 7.0/16.0;
         if (idx==14) return 13.0/16.0;
         return 5.0/16.0;
       }`
    )
    // Fix UV usage: proper affine (no perspective correction) with stable texel snap
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        // PS1 affine: UV should NOT be perspective-correct. We encoded w in vAffineUv = uv * projW
        // To get affine, we should divide by w? But we want affine, so we keep vAffineUv without w correction.
        // Use vAffineUv directly as affine UV, and mix lightly with perspective for stability
        // vAffineUv already contains w-weighted UV, so dividing by small constant approximates screen-space
        // Use correct approach: affineUv = vAffineUv / (projW approx). Since we don't have projW here,
        // we use vMapUv as perspective-correct reference and lerp 35% affine for visible swim without tearing
        // Affine strength 0.32 keeps visible swim on ground/wood but avoids stripe tearing
        vec2 affineUv = vAffineUv * 0.85;
        affineUv = clamp(affineUv, 0.0, 1.0);
        vec2 finalUv = mix(vMapUv, affineUv, 0.32);
        finalUv = floor(finalUv * 88.0) / 88.0;
        vec4 sampledDiffuseColor = texture2D(map, finalUv);
        diffuseColor *= sampledDiffuseColor;
      #endif
      `
    )
    // Add dithering before output
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      // PSX 15-bit dither + Bayer
      vec3 col = diffuseColor.rgb;
      // quantize to 5 bits per channel (32 levels) like PSX 15-bit
      float levels = 32.0;
      vec3 q = floor(col * levels) / levels;
      float d = bayer(gl_FragCoord.xy) - 0.5;
      col = q + d / (levels * 1.2) * uDither;
      // subtle scan jitter
      diffuseColor.rgb = col;
      `
    )
    shader.uniforms.uJitter = { value: 1.0 }
    shader.uniforms.uDither = { value: 1.0 }
    shader.uniforms.uTime = { value: 0 }
    // store ref for updates
    ;(mat as any).__psxShader = shader
  }
  mat.needsUpdate = true
}

export function updatePsxMaterials(materials: THREE.Material[], time: number, jitter: number) {
  for (const m of materials) {
    const s = (m as any).__psxShader
    if (s) {
      s.uniforms.uTime.value = time
      s.uniforms.uJitter.value = jitter
    }
  }
}

// CRT composite shader for final blit
export const CRTVertex = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`

export const CRTFragment = `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uDistortion;
  uniform float uScanline;
  uniform float uChroma;
  varying vec2 vUv;

  float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }

  void main(){
    vec2 uv = vUv;
    // CRT curvature - barrel
    vec2 c = uv * 2.0 - 1.0;
    float dist = dot(c,c) * uDistortion;
    uv -= c * dist * 0.085;
    // edge stretch
    uv = 0.5 + (uv-0.5) * (1.0 + dist*0.04);

    // chromatic aberration - composite bleed
    float chr = uChroma * (1.0 + dist*1.8);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + vec2(chr,0.0)).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - vec2(chr,0.0)).b;

    // luma-dependent bleed
    float l = dot(col, vec3(0.299,0.587,0.114));
    col.r += l * 0.04 * chr * 160.0;
    col.b += l * 0.02 * chr * 160.0;

    // scanlines - not uniform, with phosphor mask
    float sl = sin(uv.y * 240.0 * 3.14159) * 0.5 + 0.5;
    float mask = mod(gl_FragCoord.x, 3.0);
    vec3 phosphor = mask < 1.0 ? vec3(1.0,0.6,0.6) : mask < 2.0 ? vec3(0.6,1.0,0.6) : vec3(0.6,0.6,1.0);
    col *= 0.88 + sl * 0.12 * uScanline;
    col *= mix(vec3(1.0), phosphor, 0.035);

    // VHS tracking line occasionally
    float track = step(0.98, sin(uTime*0.7 + uv.y*14.0)*0.5+0.5) * step(0.85, rnd(vec2(floor(uTime*2.0),0.0)));
    col += track * vec3(0.12,0.14,0.16) * rnd(uv + uTime);

    // vignette + corner darken like consumer Trinitron
    float vig = 1.0 - dot(c,c) * 0.20;
    vig = pow(vig, 1.15);
    col *= vig;
    // corner highlight
    col *= 1.0 - smoothstep(0.82, 1.45, dot(c,c))*0.55;

    // flicker + hum bar
    float flick = 0.985 + sin(uTime* 60.0)*0.015 + sin(uTime* 9.0 + uv.y*2.0)*0.008;
    col *= flick;
    float hum = sin(uv.y * 3.0 - uTime*4.0)*0.015 + 1.0;
    col *= hum;

    // composite banding + 15-bit crush + dither hint
    col = floor(col * 32.0) / 32.0;
    // subtle noise
    col += (rnd(uv*uTime) - 0.5) * 0.018;

    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
      col = vec3(0.0);
    }

    gl_FragColor = vec4(col,1.0);
  }
`

export function createDitherTexture() {
  // Create 64x64 low-res palette noise texture for extra grit
  const size = 64
  const data = new Uint8Array(size*size*4)
  for(let i=0;i<size*size;i++){
    const v = Math.random() > 0.5 ? 10 : 0
    data[i*4]=v
    data[i*4+1]=v
    data[i*4+2]=v
    data[i*4+3]=255
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

export function makeNearestTexture(tex: THREE.Texture){
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  return tex
}
