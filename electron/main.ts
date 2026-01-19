import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { TelemetryServer } from './telemetry/telemetryServer'

let mainWindow: BrowserWindow | null = null
let telemetry: TelemetryServer | null = null

function getDevUrl() {
  const url = process.env.ELECTRON_DEV_URL
  return url && url.length > 0 ? url : undefined
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0b1220',
    webPreferences: {
      // We keep it simple: renderer connects directly to ws://127.0.0.1:7071
      // No preload required for this first version.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = getDevUrl()

  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  telemetry = new TelemetryServer(7071)
  createWindow()
})

app.on('before-quit', () => {
  telemetry?.close()
  telemetry = null
})
