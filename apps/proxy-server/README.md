# WebSocket-to-TCP Proxy Server

## Purpose

This application is the middleware component in the ManaSSHWeb demonstration architecture. Its sole responsibility is to bridge the communication gap between the browser's WebSocket protocol and the standard TCP protocol used by SSH.

## Role in the Architecture

`[Web App with mana-ssh-web]` <--(WebSocket)--> `[This Proxy Server]` <--(TCP)--> `[Simulated SSH Instance]`

This server listens for incoming WebSocket connections from the demo web application. For each connection, it establishes a corresponding TCP socket connection to the `simulated-instance` SSH server. It then transparently pipes all data between the two connections, allowing the web client and the SSH server to communicate as if they were directly connected.
