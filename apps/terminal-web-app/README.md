# Terminal Web App

## Purpose

This application is the frontend client for the ManaSSHWeb demonstration. It provides a browser-based terminal interface that uses the `mana-ssh-web` library to connect to the backend SSH environment.

## Role in the Architecture

`[This Terminal Web App]` <--(WebSocket)--> `[Proxy Server]` <--(TCP)--> `[Simulated SSH Instance]`

This app serves as the primary user interface for the demo. It integrates `xterm.js` to create a fully functional terminal emulator in the browser. It then uses `mana-ssh-web` to establish a connection to the WebSocket proxy, send user input (keystrokes), and display the incoming data from the SSH server.
