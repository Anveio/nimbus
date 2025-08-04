import { WebSocketServer } from 'ws';
import * as net from 'net';

const WEB_SOCKET_PORT = 8080;
const SSH_SERVER_PORT = 2222;
const SSH_SERVER_HOST = '127.0.0.1';

const wss = new WebSocketServer({ port: WEB_SOCKET_PORT });

console.log(`WebSocket proxy server listening on port ${WEB_SOCKET_PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket proxy');

  // Create a TCP client socket to connect to the SSH server
  const tcpSocket = net.createConnection({
    host: SSH_SERVER_HOST,
    port: SSH_SERVER_PORT,
  });

  // --- Data Piping ---

  // 1. When data is received from the web client, forward it to the SSH server
  ws.on('message', (message) => {
    tcpSocket.write(message as Buffer);
  });

  // 2. When data is received from the SSH server, forward it to the web client
  tcpSocket.on('data', (data) => {
    ws.send(data);
  });

  // --- Connection Closing ---

  ws.on('close', () => {
    console.log('WebSocket client disconnected.');
    // Close the TCP socket when the WebSocket connection closes
    tcpSocket.end();
  });

  tcpSocket.on('close', () => {
    console.log('TCP connection to SSH server closed.');
    // Close the WebSocket when the TCP connection closes
    ws.close();
  });

  // --- Error Handling ---

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    tcpSocket.end();
  });

  tcpSocket.on('error', (error) => {
    console.error('TCP socket error:', error);
    ws.close();
  });
});