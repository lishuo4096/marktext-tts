/** Manual navigation suspends following until the user has been idle for delayMs. */
export class ReadingFollow {
  private suspendedUntil = 0
  dragging = false
  enabled = true
  constructor(public delayMs = 8000) {}
  interrupt(now = Date.now()): void { this.suspendedUntil = now + this.delayMs }
  resume(): void { this.dragging = false; this.suspendedUntil = 0; this.enabled = true }
  canFollow(now = Date.now()): boolean { return this.enabled && !this.dragging && now >= this.suspendedUntil }
}
