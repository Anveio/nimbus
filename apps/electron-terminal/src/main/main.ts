import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { sessionManager } from './session-manager'

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  const rendererEntry = join(__dirname, 'renderer/index.js').replace(/\\/g, '/')
  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Mana Electron Terminal</title>
      <style>
        html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; background: #0c0c0c; color: #f5f5f5; font-family: system-ui, sans-serif; }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="file://${rendererEntry}"></script>
    </body>
  </html>`

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
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
