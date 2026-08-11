export class Input {
  keys = new Set<string>()
  mouseDown = false
  mouseDelta = { x: 0, y: 0 }
  gamepadIndex: number | null = null

  constructor() {
    window.addEventListener('keydown', e => {
      this.keys.add(e.code.toLowerCase())
      this.keys.add(e.key.toLowerCase())
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault()
    })
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code.toLowerCase())
      this.keys.delete(e.key.toLowerCase())
    })
    window.addEventListener('blur', () => this.keys.clear())
    window.addEventListener('mousedown', () => this.mouseDown = true)
    window.addEventListener('mouseup', () => this.mouseDown = false)
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement) {
        this.mouseDelta.x += e.movementX
        this.mouseDelta.y += e.movementY
      }
    })
    window.addEventListener('gamepadconnected', (e: any) => this.gamepadIndex = e.gamepad.index)
    window.addEventListener('gamepaddisconnected', () => this.gamepadIndex = null)
  }

  isDown(code: string) { return this.keys.has(code.toLowerCase()) }
  any(...codes: string[]) { return codes.some(c => this.isDown(c)) }

  touch: any = null
  setTouch(t:any){ this.touch=t }

  getAxis() {
    let x = 0, y = 0
    if (this.isDown('arrowleft') || this.isDown('keya')) x -= 1
    if (this.isDown('arrowright') || this.isDown('keyd')) x += 1
    if (this.isDown('arrowup') || this.isDown('keyw')) y += 1
    if (this.isDown('arrowdown') || this.isDown('keys')) y -= 1
    // touch
    if(this.touch){
      if(this.touch.l) x -= 1
      if(this.touch.r) x += 1
      if(this.touch.f) y += 1
      if(this.touch.b) y -= 1
    }

    // gamepad
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this.gamepadIndex]
      if (gp) {
        x += Math.abs(gp.axes[0]) > 0.2 ? gp.axes[0] : 0
        y += Math.abs(gp.axes[1]) > 0.2 ? -gp.axes[1] : 0
      }
    }
    // mouse delta as turn
    if (Math.abs(this.mouseDelta.x) > 1) {
      x += Math.sign(this.mouseDelta.x) * 0.8
    }
    this.mouseDelta.x *= 0.85
    this.mouseDelta.y *= 0.85
    if (Math.abs(this.mouseDelta.x) < 0.1) this.mouseDelta.x = 0

    // normalize
    const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    return { x, y }
  }

  consume(key: string) {
    const k = key.toLowerCase()
    if (this.keys.has(k)) { this.keys.delete(k); return true }
    return false
  }
}
