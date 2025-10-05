import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { sessionManager } from './session-manager'

app.on('web-contents-created', (_, contents) => {
  contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    console.error('did-fail-load', { code, desc, url, isMainFrame })
  })
  contents.on('render-process-gone', (_e, details) => {
    console.error('render-process-gone', details)
  })
  contents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log('[renderer]', { level, message, sourceId, line })
  })
})

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  await win.loadFile(join(__dirname, 'index.html')) // same-origin (file://)
  sessionManager.registerWebContents(win.webContents)
}

app.whenReady().then(() => {
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
