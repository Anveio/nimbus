import { homedir, platform } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node-pty'
import { Server } from 'ssh2'

const CWD = process.cwd()
const PORT = 2222

// Determine the shell based on the operating system
const shell = platform() === 'win32' ? 'powershell.exe' : 'bash'

const sshServer = new Server(
  {
    hostKeys: [readFileSync(join(CWD, 'id_rsa'))],
  },
  (client) => {
    console.log('Client connected!')

    client
      .on('authentication', (ctx) => {
        // For demonstration, we accept a simple username/password combination.
        // In a real-world scenario, you would use more secure methods.
        if (
          ctx.method === 'password' &&
          ctx.username === 'testuser' &&
          ctx.password === 'testpass'
        ) {
          ctx.accept()
        } else {
          ctx.reject()
        }
      })
      .on('ready', () => {
        console.log('Client authenticated!')

        client.on('session', (accept, reject) => {
          const session = accept()

          session.on('pty', (accept, reject, info) => {
            // This indicates the client is requesting a pseudo-terminal.
            // We can accept it to proceed.
            accept()
          })

          session.on('shell', (accept, reject) => {
            console.log('Client requested a shell')
            const stream = accept()

            // Spawn a pseudo-terminal (pty)
            const ptyProcess = spawn(shell, [], {
              name: 'xterm-color',
              cols: 80,
              rows: 30,
              cwd: homedir(),
              env: process.env,
            })

            // Pipe the SSH stream to the pty's input
            stream.pipe(ptyProcess)

            // Pipe the pty's output back to the SSH stream
            ptyProcess.onData((data) => {
              stream.write(data)
            })

            client.on('close', () => {
              console.log('Client disconnected, killing pty.')
              ptyProcess.kill()
            })
          })
        })
      })
      .on('close', () => {
        console.log('Client disconnected')
      })
  },
)

sshServer.listen(PORT, '127.0.0.1', () => {
  console.log(`SSH server listening on port ${PORT}`)
})
