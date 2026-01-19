import crypto from 'node:crypto'
import type { Alert, AlertSeverity } from './types'

export class RollingStats {
  private readonly windowSize: number
  private values: number[] = []

  constructor(windowSize: number) {
    this.windowSize = Math.max(5, windowSize)
  }

  push(value: number) {
    this.values.push(value)
    if (this.values.length > this.windowSize) this.values.shift()
  }

  get mean(): number {
    if (this.values.length === 0) return 0
    return this.values.reduce((a, b) => a + b, 0) / this.values.length
  }

  get stdDev(): number {
    if (this.values.length < 2) return 0
    const m = this.mean
    const variance = this.values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (this.values.length - 1)
    return Math.sqrt(variance)
  }
}

export function makeAlert(
  severity: AlertSeverity,
  title: string,
  detail?: string,
  ts: number = Date.now(),
): Alert {
  const id = crypto
    .createHash('sha1')
    .update(`${ts}|${severity}|${title}|${detail ?? ''}`)
    .digest('hex')
    .slice(0, 12)

  return { id, ts, severity, title, detail }
}
