import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import { getAdapters } from './adapters'
import { makeAlert, RollingStats } from './anomaly'
import { NetworkSampler, stableFlowId } from './sampler'
import type {
  Alert,
  ClientToServerMessage,
  Flow,
  FlowKey,
  ServerToClientMessage,
  Snapshot,
  StatsPoint,
} from './types'

function now() {
  return Date.now()
}

function flowKeyToString(f: FlowKey) {
  return `${f.protocol} ${f.srcIp}:${f.srcPort} → ${f.dstIp}:${f.dstPort}`
}

export class TelemetryServer {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()

  private mode: 'live' | 'simulate' = 'simulate'
  private selectedAdapterName: string | undefined

  private flows = new Map<string, Flow>()
  private alerts: Alert[] = []
  private series: StatsPoint[] = []
  private bytesRolling = new RollingStats(60)

  private lastTickAt = now()
  private tickBytes = 0
  private tickPackets = 0

  private seenDstPorts = new Set<number>()
  private lastPortsAlertAt = 0

  private sampler: NetworkSampler
  private ticker: NodeJS.Timeout | undefined

  constructor(port: number) {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port })

    this.sampler = new NetworkSampler({
      mode: this.mode,
      onPacket: (p) => this.onPacket(p),
      onStatus: (s) => {
        if (s.message) {
          this.pushAlert(
            makeAlert('info', 'Capture status', `${s.using.toUpperCase()}: ${s.message}`),
          )
        }
      },
    })

    this.wss.on('connection', (ws: WebSocket) => this.onConnection(ws))

    this.sampler.start().catch(() => {
      /* handled via onStatus */
    })

    this.ticker = setInterval(() => this.onTick(), 1000)
  }

  close() {
    this.ticker && clearInterval(this.ticker)
    this.ticker = undefined

    this.sampler.stop()

    for (const ws of this.clients) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    this.clients.clear()

    this.wss.close()
  }

  private onConnection(ws: WebSocket) {
    this.clients.add(ws)

    ws.on('message', (data: RawData) => {
      this.onClientMessage(ws, data.toString())
    })

    ws.on('close', () => {
      this.clients.delete(ws)
    })

    this.send(ws, { type: 'snapshot', data: this.getSnapshot() })
  }

  private onClientMessage(ws: WebSocket, raw: string) {
    let msg: ClientToServerMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.type === 'ping') {
      return
    }

    if (msg.type === 'setMode') {
      this.mode = msg.data.mode
      this.sampler.update({ mode: this.mode })
      this.broadcast({ type: 'mode', data: { mode: this.mode } })
      return
    }

    if (msg.type === 'setAdapter') {
      this.selectedAdapterName = msg.data.adapterName
      this.sampler.update({ adapterName: this.selectedAdapterName })
      this.broadcast({
        type: 'selectedAdapter',
        data: { selectedAdapterName: this.selectedAdapterName },
      })
      return
    }

    // ignore unknown
    void ws
  }

  private onPacket(p: { bytes: number } & FlowKey) {
    const id = stableFlowId(p)
    const ts = now()

    const existing = this.flows.get(id)

    if (existing) {
      existing.bytes += p.bytes
      existing.packets += 1
      existing.lastSeen = ts
    } else {
      this.flows.set(id, {
        ...p,
        bytes: p.bytes,
        packets: 1,
        firstSeen: ts,
        lastSeen: ts,
      })

      if (!this.seenDstPorts.has(p.dstPort) && p.dstPort !== 0) {
        this.seenDstPorts.add(p.dstPort)
        if (ts - this.lastPortsAlertAt > 10_000) {
          this.lastPortsAlertAt = ts
          this.pushAlert(
            makeAlert(
              'info',
              'New destination port observed',
              `Port ${p.dstPort} seen in ${flowKeyToString(p)}`,
              ts,
            ),
          )
        }
      }
    }

    this.tickBytes += p.bytes
    this.tickPackets += 1
  }

  private onTick() {
    const ts = now()
    const dtSec = Math.max(1, Math.round((ts - this.lastTickAt) / 1000))
    this.lastTickAt = ts

    const bytesPerSec = Math.round(this.tickBytes / dtSec)
    const packetsPerSec = Math.round(this.tickPackets / dtSec)

    this.bytesRolling.push(bytesPerSec)

    const activeFlows = this.pruneAndCountActiveFlows(ts)

    const { uniqueDstIps, uniqueDstPorts, topTalkers, flows } = this.computeAggregates()

    const stats: StatsPoint = {
      ts,
      bytesPerSec,
      packetsPerSec,
      activeFlows,
      uniqueDstIps,
      uniqueDstPorts,
    }

    this.series.push(stats)
    if (this.series.length > 120) this.series.shift()

    // Spike alert (simple z-score)
    const mean = this.bytesRolling.mean
    const std = this.bytesRolling.stdDev
    if (this.series.length > 10 && std > 0) {
      const z = (bytesPerSec - mean) / std
      if (z >= 3.5) {
        this.pushAlert(
          makeAlert(
            'warning',
            'Traffic spike detected',
            `Bytes/sec ${bytesPerSec} (z=${z.toFixed(2)}, mean=${mean.toFixed(0)})`,
            ts,
          ),
        )
      }
    }

    this.broadcast({ type: 'stats', data: stats })
    this.broadcast({ type: 'series', data: this.series })
    this.broadcast({ type: 'topTalkers', data: topTalkers })
    this.broadcast({ type: 'flows', data: flows })

    this.tickBytes = 0
    this.tickPackets = 0

    // Periodically send adapters (in case network changes)
    if (ts % 10_000 < 1000) {
      this.broadcast({ type: 'adapters', data: getAdapters() })
    }
  }

  private pruneAndCountActiveFlows(ts: number): number {
    // Drop flows idle > 60s
    let active = 0
    for (const [id, f] of this.flows) {
      if (ts - f.lastSeen > 60_000) {
        this.flows.delete(id)
      } else {
        active++
      }
    }
    return active
  }

  private computeAggregates(): {
    uniqueDstIps: number
    uniqueDstPorts: number
    topTalkers: Array<{ ip: string; bytes: number }>
    flows: Flow[]
  } {
    const dstIps = new Set<string>()
    const dstPorts = new Set<number>()

    const talkerBytes = new Map<string, number>()

    for (const f of this.flows.values()) {
      dstIps.add(f.dstIp)
      if (f.dstPort) dstPorts.add(f.dstPort)

      talkerBytes.set(f.srcIp, (talkerBytes.get(f.srcIp) ?? 0) + f.bytes)
    }

    const topTalkers = [...talkerBytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ip, bytes]) => ({ ip, bytes }))

    const flows = [...this.flows.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 200)

    return {
      uniqueDstIps: dstIps.size,
      uniqueDstPorts: dstPorts.size,
      topTalkers,
      flows,
    }
  }

  private pushAlert(alert: Alert) {
    // Deduplicate by id
    if (this.alerts.find((a) => a.id === alert.id)) return

    this.alerts.unshift(alert)
    if (this.alerts.length > 100) this.alerts.pop()

    this.broadcast({ type: 'alerts', data: this.alerts })
  }

  private getSnapshot(): Snapshot {
    const ts = now()
    const { uniqueDstIps, uniqueDstPorts, topTalkers, flows } = this.computeAggregates()

    const stats: StatsPoint =
      this.series[this.series.length - 1] ??
      ({
        ts,
        bytesPerSec: 0,
        packetsPerSec: 0,
        activeFlows: 0,
        uniqueDstIps,
        uniqueDstPorts,
      } satisfies StatsPoint)

    return {
      ts,
      adapters: getAdapters(),
      selectedAdapterName: this.selectedAdapterName,
      mode: this.mode,
      stats,
      series: this.series,
      topTalkers,
      flows,
      alerts: this.alerts,
    }
  }

  private send(ws: WebSocket, msg: ServerToClientMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // ignore
    }
  }

  private broadcast(msg: ServerToClientMessage) {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        ws.send(payload)
      } catch {
        // ignore
      }
    }
  }
}
