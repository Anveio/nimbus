import { Client } from 'ssh2'
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', (ws) => {
  console.log('Client connected')
  const conn = new Client()
  conn
    .on('ready', () => {
      console.log('SSH connection ready')
      conn.shell((err, stream) => {
        if (err) {
          console.error('Error starting shell:', err)
          ws.close()
          return
        }

        // Pipe WebSocket messages to the SSH stream
        ws.on('message', (message) => {
          stream.write(message.toString())
        })

        // Pipe SSH stream data to the WebSocket
        // biome-ignore lint/suspicious/noExplicitAny: todo
        stream.on('data', (data: any) => {
          ws.send(data)
        })

        stream.on('close', () => {
          console.log('SSH stream closed')
          conn.end()
        })
      })
    })
    .on('error', (err) => {
      console.error('SSH connection error:', err)
      ws.close()
    })
    .on('close', () => {
      console.log('SSH connection closed')
      ws.close()
    })
    .connect({
      // IMPORTANT: Replace with your SSH server details
      host: 'your_ssh_host',
      port: 22,
      username: 'your_ssh_username',
      password: 'your_ssh_password',
      // or use privateKey: require('fs').readFileSync('/path/to/private/key')
    })

  ws.on('close', () => {
    console.log('Client disconnected')
    conn.end()
  })
})

console.log('WebSocket server started on port 8080')
