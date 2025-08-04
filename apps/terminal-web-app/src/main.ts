import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// --- Placeholder for our library ---
// import { ManaSSHClient } from '@mana-ssh/web';

/**
 * A mock client to simulate the real library's behavior.
 * We will replace this with the actual library import later.
 */
class MockManaSSHClient {
  onData(callback: (data: string) => void) {
    // Simulate receiving data from the server
    setInterval(() => {
      callback(`\r\n[Simulated Server Message: ${new Date().toLocaleTimeString()}]`);
    }, 5000);
  }
  send(data: string) {
    // Simulate sending data to the server
    console.log(`Sending to server: ${data}`);
  }
  connect() {
    console.log('Connecting to ws://localhost:8080...');
  }
}
// --- End Placeholder ---


const terminalElement = document.getElementById('terminal');

if (terminalElement) {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'monospace',
    fontSize: 14,
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(terminalElement);
  fitAddon.fit();

  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  term.writeln('Welcome to the ManaSSHWeb Terminal!');
  term.writeln('Connecting to the simulated SSH server...');
  term.writeln('');

  // --- Integration Logic ---
  // const client = new ManaSSHClient(); // Real client
  const client = new MockManaSSHClient(); // Mock client for now

  // 1. When the user types, send the data to the server
  term.onData((data) => {
    client.send(data);
  });

  // 2. When the client receives data, write it to the terminal
  client.onData((data) => {
    term.write(data);
  });

  // 3. Initiate the connection
  client.connect();

} else {
  console.error('Terminal element not found in the DOM.');
}