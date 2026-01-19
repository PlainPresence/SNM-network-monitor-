import os from 'node:os'
import type { AdapterInfo } from './types'

export function getAdapters(): AdapterInfo[] {
  const interfaces = os.networkInterfaces()
  const adapters: AdapterInfo[] = []

  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || infos.length === 0) continue

    const addresses = infos
      .filter((info) => info.address && (info.family === 'IPv4' || info.family === 'IPv6'))
      .map((info) => ({ family: info.family as 'IPv4' | 'IPv6', address: info.address }))

    if (addresses.length === 0) continue

    adapters.push({ name, addresses })
  }

  adapters.sort((a, b) => a.name.localeCompare(b.name))
  return adapters
}
