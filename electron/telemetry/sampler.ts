import crypto from 'node:crypto'
import type { FlowKey } from './types'

export type PacketSample = FlowKey & {
  bytes: number
}

export type SamplerMode = 'live' | 'simulate'

export type SamplerOptions = {
  mode: SamplerMode
  adapterName?: string
  onPacket: (p: PacketSample) => void
  onStatus?: (status: { mode: SamplerMode; using: 'cap' | 'simulate'; message?: string }) => void
}

export class NetworkSampler {
  private options: SamplerOptions
  private stopFn: (() => void) | undefined

  constructor(options: SamplerOptions) {
    this.options = options
  }

  update(options: Partial<Pick<SamplerOptions, 'mode' | 'adapterName'>>) {
    this.options = { ...this.options, ...options }
    this.restart().catch(() => {
      // swallowed; status handler gets message
    })
  }

  async start() {
    await this.restart()
  }

  stop() {
    this.stopFn?.()
    this.stopFn = undefined
  }

  private async restart() {
    this.stop()

    if (this.options.mode === 'simulate') {
      this.stopFn = startSimulatedTraffic(this.options)
      return
    }

    const started = await tryStartCapTraffic(this.options)
    if (!started) {
      this.stopFn = startSimulatedTraffic({
        ...this.options,
        mode: 'simulate',
        onStatus: (s) => this.options.onStatus?.({ ...s, message: s.message }),
      })
    }
  }
}

function startSimulatedTraffic(options: SamplerOptions): () => void {
  options.onStatus?.({ mode: options.mode, using: 'simulate', message: 'Simulated traffic mode' })

  let running = true
  const localTalkers = ['10.0.0.10', '10.0.0.12', '10.0.0.20', '192.168.0.8']
  const remoteHosts = ['1.1.1.1', '8.8.8.8', '104.16.123.96', '151.101.1.69', '13.107.42.12']
  const ports = [53, 80, 443, 22, 3389, 445, 8080, 1194]

  function randInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  function tick() {
    if (!running) return

    const burst = randInt(50, 180)
    for (let i = 0; i < burst; i++) {
      const srcIp = localTalkers[randInt(0, localTalkers.length - 1)]
      const dstIp = remoteHosts[randInt(0, remoteHosts.length - 1)]
      const dstPort = ports[randInt(0, ports.length - 1)]
      const srcPort = randInt(20000, 65000)
      const protocol = dstPort === 53 ? 'UDP' : 'TCP'
      const bytes = randInt(60, 1400)

      options.onPacket({ srcIp, srcPort, dstIp, dstPort, protocol, bytes })
    }

    setTimeout(tick, randInt(120, 260))
  }

  tick()

  return () => {
    running = false
  }
}

async function tryStartCapTraffic(options: SamplerOptions): Promise<boolean> {
  try {
    const capModule: any = await import('cap')

    const Cap = capModule?.Cap ?? capModule
    const decoders = capModule?.decoders

    if (!Cap || !decoders) {
      options.onStatus?.({
        mode: options.mode,
        using: 'simulate',
        message: 'cap module loaded but missing decoders; falling back to simulation',
      })
      return false
    }

    const cap = new Cap()
    const buffer = Buffer.alloc(10 * 1024 * 1024)

    // Best-effort device selection. If we can't find a matching device, we still try to open "" which will fail.
    let device: string | undefined

    if (typeof capModule?.findDevice === 'function' && options.adapterName) {
      // Attempt to pick a device using the adapter's IPv4.
      const ipMatch = options.adapterName.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)
      if (ipMatch) device = capModule.findDevice(ipMatch[1])
    }

    if (!device && typeof Cap?.deviceList === 'function') {
      // If available, pick the first device.
      const list = Cap.deviceList() as Array<{ name?: string }>
      device = list?.[0]?.name
    }

    const filter = ''
    const bufSize = 10 * 1024 * 1024

    const linkType = cap.open(device ?? '', filter, bufSize, buffer)

    options.onStatus?.({ mode: options.mode, using: 'cap', message: 'Live capture using libpcap/Npcap' })

    const onPacket = (nbytes: number) => {
      if (nbytes <= 0) return

      try {
        if (linkType !== 'ETHERNET') return

        let ret = decoders.Ethernet(buffer)
        if (ret.info.type !== decoders.PROTOCOL.ETHERNET.IPV4) return

        ret = decoders.IPV4(buffer, ret.offset)

        const srcIp = ret.info.srcaddr
        const dstIp = ret.info.dstaddr

        if (ret.info.protocol === decoders.PROTOCOL.IP.TCP) {
          const tcp = decoders.TCP(buffer, ret.offset)
          options.onPacket({
            srcIp,
            srcPort: tcp.info.srcport,
            dstIp,
            dstPort: tcp.info.dstport,
            protocol: 'TCP',
            bytes: nbytes,
          })
        } else if (ret.info.protocol === decoders.PROTOCOL.IP.UDP) {
          const udp = decoders.UDP(buffer, ret.offset)
          options.onPacket({
            srcIp,
            srcPort: udp.info.srcport,
            dstIp,
            dstPort: udp.info.dstport,
            protocol: 'UDP',
            bytes: nbytes,
          })
        } else {
          options.onPacket({
            srcIp,
            srcPort: 0,
            dstIp,
            dstPort: 0,
            protocol: 'OTHER',
            bytes: nbytes,
          })
        }
      } catch {
        // ignore decoder errors
      }
    }

    cap.on('packet', onPacket)

    return true
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : String(err)
    options.onStatus?.({ mode: options.mode, using: 'simulate', message: `Live capture unavailable; ${msg}` })
    return false
  }
}

export function stableFlowId(flow: FlowKey): string {
  return crypto
    .createHash('sha1')
    .update(`${flow.protocol}|${flow.srcIp}:${flow.srcPort}|${flow.dstIp}:${flow.dstPort}`)
    .digest('hex')
    .slice(0, 16)
}
