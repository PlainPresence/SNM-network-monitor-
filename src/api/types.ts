export type AdapterInfo = {
  name: string
  addresses: Array<{ family: 'IPv4' | 'IPv6'; address: string }>
}

export type Flow = {
  srcIp: string
  srcPort: number
  dstIp: string
  dstPort: number
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'OTHER'
  bytes: number
  packets: number
  firstSeen: number
  lastSeen: number
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type Alert = {
  id: string
  ts: number
  severity: AlertSeverity
  title: string
  detail?: string
}

export type StatsPoint = {
  ts: number
  bytesPerSec: number
  packetsPerSec: number
  activeFlows: number
  uniqueDstIps: number
  uniqueDstPorts: number
}

export type Snapshot = {
  ts: number
  adapters: AdapterInfo[]
  selectedAdapterName?: string
  mode: 'live' | 'simulate'
  stats: StatsPoint
  series: StatsPoint[]
  topTalkers: Array<{ ip: string; bytes: number }>
  flows: Flow[]
  alerts: Alert[]
}

export type ServerToClientMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'stats'; data: StatsPoint }
  | { type: 'series'; data: StatsPoint[] }
  | { type: 'topTalkers'; data: Array<{ ip: string; bytes: number }> }
  | { type: 'flows'; data: Flow[] }
  | { type: 'alerts'; data: Alert[] }
  | { type: 'adapters'; data: AdapterInfo[] }
  | { type: 'mode'; data: { mode: 'live' | 'simulate' } }
  | { type: 'selectedAdapter'; data: { selectedAdapterName?: string } }

export type ClientToServerMessage =
  | { type: 'setMode'; data: { mode: 'live' | 'simulate' } }
  | { type: 'setAdapter'; data: { adapterName?: string } }
  | { type: 'ping' }
