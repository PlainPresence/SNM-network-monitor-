import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMemo } from 'react'
import { useTelemetryWs } from '../api/wsClient'
import type { Alert, Flow } from '../api/types'
import { KpiCard } from '../components/KpiCard'
import { StatusPill } from '../components/StatusPill'

function formatBytesPerSec(n: number) {
  if (n < 1024) return `${n} B/s`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(2)} MB/s`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB/s`
}

function formatTs(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

function severityTone(sev: Alert['severity']): 'ok' | 'warn' | 'bad' {
  if (sev === 'info') return 'ok'
  if (sev === 'warning') return 'warn'
  return 'bad'
}

export function DashboardPage() {
  const { connection, snapshot, send } = useTelemetryWs('ws://127.0.0.1:7071')

  const stats = snapshot?.stats

  const series = useMemo(() => {
    const s = snapshot?.series ?? []
    return s.map((p) => ({
      ...p,
      t: formatTs(p.ts),
    }))
  }, [snapshot?.series])

  const topTalkers = useMemo(() => {
    return (snapshot?.topTalkers ?? []).map((t) => ({
      ...t,
      bytes: Math.round(t.bytes),
    }))
  }, [snapshot?.topTalkers])

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="title">Network Monitor</div>
          <div className="subtitle">Real-time traffic, anomalies, and flows</div>
        </div>

        <div className="topbar-right">
          <StatusPill
            tone={connection === 'open' ? 'ok' : connection === 'connecting' ? 'warn' : 'bad'}
            text={connection === 'open' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Disconnected'}
          />

          <div className="row">
            <label className="label">Mode</label>
            <select
              className="select"
              value={snapshot?.mode ?? 'simulate'}
              onChange={(e) => send({ type: 'setMode', data: { mode: e.target.value as 'live' | 'simulate' } })}
            >
              <option value="live">Live</option>
              <option value="simulate">Simulate</option>
            </select>
          </div>

          <div className="row">
            <label className="label">Adapter</label>
            <select
              className="select"
              value={snapshot?.selectedAdapterName ?? ''}
              onChange={(e) => send({ type: 'setAdapter', data: { adapterName: e.target.value || undefined } })}
            >
              <option value="">Auto</option>
              {(snapshot?.adapters ?? []).map((a) => {
                const addr = a.addresses.find((x) => x.family === 'IPv4')?.address
                const display = addr ? `${a.name} (${addr})` : a.name
                // Include IPv4 in value to help cap.findDevice best-effort.
                const value = addr ? `${a.name} ${addr}` : a.name
                return (
                  <option key={value} value={value}>
                    {display}
                  </option>
                )
              })}
            </select>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="kpis">
          <KpiCard
            label="Throughput"
            value={stats ? formatBytesPerSec(stats.bytesPerSec) : '—'}
            hint="Bytes per second"
          />
          <KpiCard label="Packets/sec" value={stats ? String(stats.packetsPerSec) : '—'} />
          <KpiCard label="Active flows" value={stats ? String(stats.activeFlows) : '—'} />
          <KpiCard label="Unique dst IPs" value={stats ? String(stats.uniqueDstIps) : '—'} />
          <KpiCard label="Unique dst ports" value={stats ? String(stats.uniqueDstPorts) : '—'} />
          <KpiCard label="Alerts" value={snapshot ? String(snapshot.alerts.length) : '—'} />
        </section>

        <section className="panel">
          <div className="panel-title">Traffic (bytes/sec)</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#9fb2d6', fontSize: 12 }} minTickGap={30} />
                <YAxis tick={{ fill: '#9fb2d6', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#0f1a2e', border: '1px solid #22304a', color: '#d6e2ff' }}
                  labelStyle={{ color: '#d6e2ff' }}
                  formatter={(v) => [formatBytesPerSec(Number(v)), 'Throughput']}
                />
                <Line type="monotone" dataKey="bytesPerSec" stroke="#66e3ff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">Top talkers (total bytes)</div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topTalkers} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
                <XAxis dataKey="ip" tick={{ fill: '#9fb2d6', fontSize: 12 }} interval={0} angle={-10} height={50} />
                <YAxis tick={{ fill: '#9fb2d6', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#0f1a2e', border: '1px solid #22304a', color: '#d6e2ff' }}
                  labelStyle={{ color: '#d6e2ff' }}
                />
                <Bar dataKey="bytes" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel span2">
          <div className="panel-title">Alerts</div>
          <div className="list">
            {(snapshot?.alerts ?? []).slice(0, 20).map((a) => (
              <div key={a.id} className="alert">
                <StatusPill tone={severityTone(a.severity)} text={a.severity.toUpperCase()} />
                <div className="alert-main">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-detail">{a.detail ?? ''}</div>
                </div>
                <div className="alert-time">{formatTs(a.ts)}</div>
              </div>
            ))}
            {snapshot && snapshot.alerts.length === 0 ? (
              <div className="empty">No alerts yet.</div>
            ) : null}
          </div>
        </section>

        <section className="panel span2">
          <div className="panel-title">Flows (top 200 by bytes)</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Proto</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Bytes</th>
                  <th>Packets</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.flows ?? []).map((f: Flow) => (
                  <tr key={`${f.protocol}|${f.srcIp}:${f.srcPort}|${f.dstIp}:${f.dstPort}`}>
                    <td>{f.protocol}</td>
                    <td>
                      {f.srcIp}:{f.srcPort}
                    </td>
                    <td>
                      {f.dstIp}:{f.dstPort}
                    </td>
                    <td>{f.bytes.toLocaleString()}</td>
                    <td>{f.packets.toLocaleString()}</td>
                    <td>{formatTs(f.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {snapshot && snapshot.flows.length === 0 ? <div className="empty">No flow data yet.</div> : null}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span className="muted">
          Tip: If Live capture isn’t available, install Npcap (Windows) / libpcap (Linux) and run with appropriate
          permissions.
        </span>
      </footer>
    </div>
  )
}
