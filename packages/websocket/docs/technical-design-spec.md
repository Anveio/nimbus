@nimbus/websocket — Technical Design Spec (v1)

Audience: engineers building a browser/desktop Terminal UI + SSH over WebSockets; backend engineers building compatible WS servers.

Status: Phase 2 planning (browser-focused hardening in progress)

Scope (Phase 2):

client/web (WHATWG WebSocket; progressive WebSocketStream when available)

client/node (ws-backed harness for integration tests; not a shipping runtime)

server/node (reference WS server atop @nimbus/ssh; Deno/Bun adapters next)

protocol/ shared types + WireProfile (pluggable encoding/decoding)

Flow control, backpressure, reconnect/resume, security & policy, observability

BYO‑server compatibility via a small, stable semantic contract

Non‑goals (Phase 2): SFTP helpers, file transfer UI, QUIC/HTTP3 transports, production-ready Node/Bun/Deno clients (will follow once browser story is solid).

1) Goals & Tenets

DX first. One import, one connect, one session for the happy path. Progressive disclosure for power users.

Runtime honesty. Web and Node have different constraints—treat them as separate clients.

Interoperability. Separate semantics (handshake, channels, credit) from representation (frames). Plug different wire profiles without changing app code.

Safety. No unbounded buffers. Proactive backpressure (credit), conservative defaults (no compression), and strict limits.

Spec > impl. The spec below is normative. Code MUST follow the “MUST/SHOULD/MAY” language.

2) Packages & Entry Points

```bash
packages/websocket/
  src/
    protocol/               # semantic types + WireProfile interfaces + default profiles
    client/
      web/                  # browser/Electron renderer; WHATWG WebSocket (+ WebSocketStream)
      node/                 # Node/Electron main; 'ws'
    server/
      node/                 # Node reference server (HTTP upgrade + ws)
      deno/                 # (next) adapter around Deno.upgradeWebSocket
      bun/                  # (next) adapter around Bun.serve({ websocket })
  README.md
  PROTOCOL.md               # wire contract for BYO servers
  TECHNICAL_SPEC.md         # (this file)
```
Public exports
* @nimbus/websocket/client/web
* @nimbus/websocket/client/node
* @nimbus/websocket/server/node
* @nimbus/websocket/protocol

3) Public Client API (stable surface)
```typescript
// @nimbus/websocket/client/web | @nimbus/websocket/client/node

export type ConnectOptions = {
  url: string;                       // wss:// strongly recommended
  profile?: string | WireProfile;    // default: 'nimbus.v1'
  auth?: () => Promise<{ scheme: 'bearer'; token: string } | { scheme: 'none' }>;
  retry?: { strategy: 'exponential'; maxRetries?: number; baseMs?: number; jitter?: boolean };
  highWaterMark?: number;            // default: 8 MiB (web)
  lowWaterMark?: number;             // default: 2 MiB (web)
  resume?: { storage: 'session' | 'memory' | 'none'; ttlMs?: number }; // default: session, 60s
  transport?: 'auto' | 'websocket' | 'websocketstream'; // web only; default 'auto'
  clientInfo?: { app?: string; version?: string };      // non-sensitive diagnostics
  // node-only extras:
  node?: { perMessageDeflate?: false | { serverNoContextTakeover?: boolean; clientNoContextTakeover?: boolean; serverMaxWindowBits?: number; clientMaxWindowBits?: number } };
};

export type Connection = {
  readonly protocol: string; // negotiated subprotocol, e.g. 'nimbus.ssh.v1'
  readonly state: 'connecting' | 'authenticating' | 'ready' | 'reconnecting' | 'closed';
  on(evt: 'statechange' | 'diagnostic' | 'policy', fn: (...args: any[]) => void): () => void;

  openSession(init: {
    target: { host: string; port: number };
    user: { username: string; auth: any };  // opaque to allow different server auth models
    term?: { cols: number; rows: number; env?: Record<string, string> };
  }): Promise<Channel>;

  close(code?: number, reason?: string): Promise<void>;
};

export type Channel = {
  id: number;
  on(
    evt: 'data' | 'stderr' | 'exit' | 'error',
    fn: (arg: Uint8Array | { code?: number; sig?: string } | Error) => void
  ): () => void;

  send(data: Uint8Array): Promise<void>;
  resize(size: { cols: number; rows: number }): void;
  signal(sig: string): Promise<void>;
  close(reason?: string): Promise<void>;
};

export async function connect(opts: ConnectOptions): Promise<Connection>;
```
Defaults (web):

highWaterMark = 8 MiB, lowWaterMark = 2 MiB

resume = { storage: 'session', ttlMs: 60_000 }

retry = { strategy: 'exponential', baseMs: 300, jitter: true, maxRetries: 10 }

transport = 'auto' (uses WebSocketStream if available; otherwise classic WebSocket)

Runtime stance: browsers are the only first-class client environment in Phase 2. Node/Bun/Deno adopters MUST provide a WebSocket implementation compatible with the WHATWG API and SHOULD expect degraded behaviour (no WebSocketStream, differing buffered-amount semantics) until dedicated adapters ship.

Defaults (node):

node.perMessageDeflate = false (data is SSH ciphertext; compression off by default)

Other defaults same as web, minus transport.

4) Semantic Protocol (runtime‑independent)

The semantic layer is the fixed contract all wire profiles must implement.

4.1 Control messages (Ctl)
```typescript
export type Ctl =
  | { t:'hello';    proto: 1; auth?: { scheme:'bearer'|'none'; token?: string };
      caps?: Record<string, unknown>; resume?: { token: string } }
  | { t:'hello_ok'; server: string; caps: { flow:'credit'; maxFrame?: number; profileAccepted: string; [k: string]: unknown } }
  | { t:'open';     id:number; target:{host:string; port:number}; user:{username:string; auth:any};
      term?:{cols:number; rows:number; env?:Record<string,string>} }
  | { t:'open_ok';  id:number; resumeKey?: string }
  | { t:'open_err'; id:number; code:string; msg:string }
  | { t:'resize';   id:number; cols:number; rows:number }
  | { t:'signal';   id:number; sig:string }
  | { t:'close';    id:number; reason?:string }
  | { t:'exit';     id:number; code?:number; sig?:string }
  | { t:'flow';     id:number; credit:number }      // add credit (bytes) for stdout+stderr
  | { t:'ping';     ts:number }
  | { t:'pong';     ts:number };

Handshake timeline (normative):

1. Client MUST send `hello` immediately after the WebSocket `open` event. Include `resume.token` whenever a stored token exists and is not expired.
2. Server MUST respond with `hello_ok` (or close with an explicit error) before emitting any other control/data frame. Invalid handshakes MUST close with 4002 (BAD_HELLO) or 4003 (AUTH_FAILED).
3. Client MUST treat the session as unauthenticated until `hello_ok` arrives and SHOULD not attempt channel opens prior to that event.

Heartbeats:

- Client MUST send `ping` every 20 seconds while in phase `ready`.
- Client MUST count missed `pong`s; after three misses, transition to `reconnecting`, emit `diagnostic` code `heartbeat_timeout`, and begin retry logic.
- Server SHOULD send `ping` (20 second cadence) when idle; clients MUST respond with `pong` immediately.

Resume semantics:

- Clients MAY include `resume.token` in the initial `hello`. Tokens are opaque to the transport and originate from the SSH subsystem.
- Server that accepts resume MUST return `open_ok.resumeKey` for new channels; clients MUST persist the token before processing subsequent data frames.
- Server that rejects a resume attempt SHOULD close with app code 4011 (RESUME_FAILED) or 4409, allowing clients to clear stored state and retry cold.
```
4.2 Data frames (semantic)
```ts
export type DataFrame = { stream:'stdout'|'stderr'; id:number; payload: Uint8Array };
```
Flow semantics (normative):

The server MUST NOT send any data for channel id unless its available credit > 0.

Data delivery decrements credit by the number of payload bytes (stdout and stderr share the same credit bucket per channel).

The client SHOULD replenish credit opportunistically up to a target window (windowTarget, default 256 KiB) and MUST stop replenishing credit when its transport is backpressured (see §6).

The server SHOULD coalesce small writes when practical but MUST NOT exceed caps.maxFrame when framing messages.

Diagnostics & telemetry requirements (Phase 2):

- Client MUST emit `diagnostic` events for:
  - handshake transitions (`hello_sent`, `hello_ok`, resume accept/reject),
  - backpressure changes (buffered amount crossing HWM/LWM thresholds),
  - heartbeat misses and reconnect attempts,
  - resume persistence operations (load/persist/clear success or failure).
- Diagnostic payloads MUST include `timestamp`, `phase`, and a stable `code` string. Additional fields SHOULD be serialisable JSON values.
- Browser client MUST capture current `bufferedAmount` and RTT (derived from ping/pong) so higher layers (`@nimbus/react`, terminal web app) can render health indicators.

5) Wire Profiles (customizable on‑the‑wire format)

We separate what is sent (semantics) from how it is framed (profile). A profile controls subprotocols, message encodings (text vs binary), and frame splitting.
```ts
export interface WireProfile {
  readonly id: string;                         // e.g. 'nimbus.v1'
  readonly subprotocols?: readonly string[];   // e.g. ['nimbus.ssh.v1']
  encodeCtl(msg: Ctl): ArrayBuffer | string;
  decodeCtl(frame: ArrayBuffer | string): Ctl | null;
  encodeData(df: DataFrame, caps: { maxFrame?: number }): (ArrayBuffer | string)[];
  decodeData(frame: ArrayBuffer | string): DataFrame | null;
  onNegotiated?(clientCaps: any, serverCaps: any): void;
}

// Register & resolve
export function registerProfile(p: WireProfile): void;
export function getProfile(id: string): WireProfile | undefined;
```
5.1 Profiles we ship in v1

nimbus.v1 (default)

Subprotocol: nimbus.ssh.v1

Control: JSON as WS text frames (UTF‑8)

Data: binary frames [(1 byte stream)|(4 bytes u32be channelId)|(n bytes payload)]

stream: 0x01=stdout, 0x02=stderr (others reserved)

Client MUST split outbound payloads to caps.maxFrame (default 1 MiB)

Server MUST enforce 1009 “Message Too Big” or app close 4008 if exceeded

json-base64.v1 (legacy interop)

All frames are text JSON

Data payload base64 encoded (adds ~33% overhead)

No binary requirement on the server; simplest to integrate with existing WS stacks

lenpfx.v1 (length‑prefixed binary)

Binary envelope: [4 bytes u32be length][1 byte kind][4 bytes id][n payload]

kind: 0x10=ctl-json, 0x01=stdout, 0x02=stderr

Useful for bridging WS↔TCP relays that already do length‑prefixing

Selecting a profile
```ts
const conn = await connect({
  url: 'wss://example/ws/ssh',
  profile: 'nimbus.v1', // or 'json-base64.v1' | 'lenpfx.v1' | a custom WireProfile
});
```
Negotiation

During WS upgrade, the client requests profile.subprotocols (if any).

Client hello.caps.profile = '<id>'.

Server replies hello_ok.caps.profileAccepted. If unsupported, server SHOULD close with app code 4001 (UNSUPPORTED_PROFILE).

6) Backpressure & Flow Control (memory‑safety)
6.1 Web (WHATWG WebSocket)

Outbound: Use WebSocket.bufferedAmount.

Pause sending when bufferedAmount > highWaterMark (default 8 MiB).

Resume when bufferedAmount < lowWaterMark (default 2 MiB).

Inbound: Classic WebSocket has no pull‑based backpressure. We enforce safety by not topping up credit while outbound is backpressured, the page is hidden, or the network is offline. This stops the server from sending more data.

6.2 Web (progressive WebSocketStream)

When available and transport: 'auto', the web client uses streams for true backpressure. Credit is still used to ensure fairness across channels.

6.3 Node (ws)

socket.bufferedAmount mirrors the web behavior; apply the same HWM/LWM.

Optional perMessageDeflate (default off) may be enabled with bounded params (see §9.2).

6.4 Credit algorithm (client)

Parameters:

windowTarget: initial per‑channel credit target (default 256 KiB; grows to 2 MiB with good RTT)

maxFrame: from hello_ok.caps (default 1 MiB)

HWM, LWM: from options

Pseudocode (client side):
```ts
function replenishCredit(ch: ChannelState) {
  if (transportBackpressured() || pageHidden() || offline()) return;
  const need = windowTarget - ch.creditOutstanding;
  if (need <= 0) return;
  const grant = clamp(need, 0, windowTarget); // bytes
  sendCtl({ t:'flow', id: ch.id, credit: grant });
  ch.creditOutstanding += grant;
}
on('dataConsumed', (ch, bytes) => { ch.creditOutstanding -= bytes; maybeReplenish(); });
```
Transport backpressured?
```ts
function transportBackpressured(): boolean {
  return getBufferedAmount() > highWaterMark;
}
```
Resize coalescing: apply requestAnimationFrame (web) or a 16ms debounce (node) to send at most ~60 resize/sec.

7) Connection & Channel Lifecycle
7.1 Connection state machine
```arduino
idle → connecting → authenticating → ready → closed
                   ↘ (auth failed)   ↘ (network drop) 
                            closed     reconnecting → authenticating → ready
```
Handshake (normative):

WS upgrade with subprotocols from profile (e.g., nimbus.ssh.v1).

Client sends hello (includes auth, caps.profile, optional resume).

Server replies hello_ok with negotiated caps (must include flow:'credit' and profileAccepted).

Heartbeats: client sends ping every 20s; if 3 pings miss, transition to reconnecting.

Reconnect/Resume:

Client MAY include hello.resume with a token saved earlier (sessionStorage by default).

Server MAY accept within a retention window (default 60s) and rebind channel IDs.

If resume fails, client SHOULD present a typed error and require manual reconnect.

SSH bridge:

- Once a channel is confirmed (`open_ok`), the client spins up an `@nimbus/ssh` session using the channel as its transport. The websocket layer remains owner of resume tokens; the SSH runtime sees only raw octets.
- Browser and Node adapters expose helpers that bridge a `Connection` + channel init payload into `{ session, dispose }`, mirroring `connectSSH`. The bridge forwards channel `data` into `session.receive`, flushes `outbound-data` events back through `channel.send`, and propagates channel `exit`/`error` to the disposer.

7.2 Channel lifecycle
```lua
(open) → open_ok → (data/resize/signal)* → exit → close
                                   ↘ error → close
```
8) Security & Policy (server‑enforced; client‑aware)

TLS: Use wss:// for browsers; plain ws:// allowed only for localhost during development.

Authentication: Tokens are sent in‑band in hello.auth. Do not rely on cookies (CSRF risk).

Origin checks: Server MUST verify Origin against an allow‑list.

Target policy: Server SHOULD enforce allow‑lists per tenant/user {host,port} and quotas.

Limits:

maxFrame enforced; reject with WS 1009 or app 4008.

maxSessionsPerConn (default 4).

Control‑message rate‑limit (default 50/second/conn).

Idle timeout (default 60s; keepalive pings reset it).

Compression: Default off for nimbus.v1. See §9 for rationale/knobs.

9) Compression (permessage‑deflate) — stance & knobs

Default: Disabled for nimbus.v1 because SSH data is high‑entropy (post‑KEX) and compression adds CPU/memory without meaningful win.

Control frames: Small JSON control frames compress well, but most stacks cannot “compress only control.” Prefer disabling globally for this protocol.

Node server: If enabled, bound memory/CPU:

serverNoContextTakeover: true, clientNoContextTakeover: true

serverMaxWindowBits, clientMaxWindowBits small (e.g., 10–12)

Web client: Cannot force compression off; server decides during upgrade.

Profiles: MAY declare a preference but server remains source of truth.

10) Integration with @nimbus/ssh (server/node)

The reference server adapts channels to @nimbus/ssh/client/node.

Adapter responsibilities:

On open: create SSH client/session → wire bytes and control:

WebSocket → session.receive(bytes)

session.nextEvent() / stream callbacks → data frames out

Map control:

resize → SSH window/pty resize

signal → SSH signal

close → session close

Honor credit:

Decrement per‑channel credit as bytes are written to the socket

Stop reading from SSH when credit is 0; resume on flow

Threading/concurrency: One WS connection = one Mux managing channels; each channel owns an SSH session.

11) Errors, Close Codes, and Taxonomy

WebSocket close codes we use

1000 Normal closure

1001 Going away

1008 Policy violation (e.g., origin/auth/policy)

1009 Message too big

1011 Internal error

Application close codes (4000–4099)

4000 CANCELLED

4001 UNSUPPORTED_PROFILE

4002 BAD_HELLO

4003 AUTH_FAILED

4004 POLICY_DENIED

4005 TARGET_UNREACHABLE

4006 CHANNEL_LIMIT

4007 FLOW_VIOLATION

4008 FRAME_TOO_LARGE

4009 UNSUPPORTED_MESSAGE

4010 SERVER_OVERLOAD

4011 RESUME_FAILED

4012 TIMEOUT

4013 DUPLICATE_CHANNEL_ID

4014 MALFORMED_FRAME

4015 INTERNAL_ERROR

12) Integration with @nimbus/react & terminal web app

- Browser client MUST expose bridge helpers (`connect`, `openSshSession`, `connectAndOpenSsh`) that return both the websocket connection and the underlying SSH session so `@nimbus/react` can bind lifecycle hooks.
- Bridge helpers MUST forward diagnostic events (handshake, buffer_state, resume outcomes) so React components can surface status to users.
- Terminal web app MUST treat `Connection.state` as the authoritative source for UI transitions (connecting/authenticating/ready/reconnecting/closed).
- React integration MUST cleanly dispose SSH sessions/channels when the component tree unmounts to avoid leaking resume tokens or buffered data.
- Phase 2 exit criteria include Playwright coverage that routes real SSH traffic through the websocket client, the React bridge, and the canvas renderer to validate connect → shell → resize → resume → teardown flows.

Client error surface: throw a typed CloseError with { wsCode?: number; appCode?: number; code: string; message: string }.

12) Observability

Client events

* `statechange → 'connecting'|'authenticating'|'ready'|'reconnecting'|'closed'`

* `policy → { type: 'flow_pause'|'flow_resume'|'resize_coalesced'|'credit_grant', ... }`

* `diagnostic → { handshake:{...}, ping:{rttMs}, close:{wsCode, appCode, reason} }`

Server metrics (reference impl)

Counters: bytes in/out, frames in/out (ctl/data), credit grants, backpressure time, reconnects, session lifetimes

Logs (structured): connect, auth, open, flow pause/resume, exit, error, close

Sampling: redact payload bytes; log only metadata & control summaries

13) Testing & Conformance

Unit (Vitest)

Protocol codecs: round‑trip and fuzz for each profile

State machine: handshake, retries, heartbeats

Flow control: credit accounting, HWM/LWM pause/resume

Integration

Client/web ↔ server/node: open/resize/signal/stream/close

Client/node ↔ server/node with perMessageDeflate toggled

Frame splitting at maxFrame, large outbound writes

E2E (Playwright)

Browser large stream (e.g., dump a 100MB file), keep memory bounded

Background tab throttling (visibility hidden) pauses credit and resumes on focus

Reload within resume TTL: channel resumes, tail continues

Conformance kit (for BYO servers)

Scripted servers for json-base64.v1 and lenpfx.v1

Test matrix: handshake, open, flow, data echo, exit, close, error codes

14) Examples

Browser
```ts
import { connect } from '@nimbus/websocket/client/web';

const conn = await connect({
  url: 'wss://example.com/ws/ssh',
  auth: async () => ({ scheme: 'bearer', token: await getJWT() }),
  resume: { storage: 'session', ttlMs: 60_000 },
});

const ch = await conn.openSession({
  target: { host: 'demo.example', port: 22 },
  user: { username: 'alice', auth: { type: 'agent' } },
  term: { cols: 120, rows: 36, env: { TERM: 'xterm-256color' } },
});

ch.on('data', (buf) => terminal.write(buf));
ch.on('exit', ({ code, sig }) => console.log('exit', code, sig));
```
Node/Electron main
```ts
import { connect } from '@nimbus/websocket/client/node';

const conn = await connect({
  url: 'wss://example.com/ws/ssh',
  auth: async () => ({ scheme: 'bearer', token: process.env.JWT! }),
  node: { perMessageDeflate: false }, // default; can enable with bounded params
});

const ch = await conn.openSession({
  target: { host: 'demo.example', port: 22 },
  user: { username: 'alice', auth: { type: 'password', password: '...' } },
});
process.stdin.on('data', (d) => ch.send(d));
ch.on('data', (d) => process.stdout.write(d));
```

#### Identity wiring

Browser and Node clients forward the SSH identity configuration to `@nimbus/ssh`. Consumers may:

- omit `ssh.identity` to let the runtime generate a Ed25519 key.
- provide `ssh.identity = { mode: 'provided', algorithm: 'ed25519', material: … }` with one of:
  - `kind: 'raw'` (public + private `Uint8Array` seeds),
  - `kind: 'signer'` (public key plus signing callback for HSM/web-authn scenarios),
  - `kind: 'openssh'` (OpenSSH-formatted strings, optionally with a signing callback when the private blob is not disclosed).

If neither a usable private key nor a signer is present, the websocket adapter raises a configuration error before attempting USERAUTH. Future algorithms (RSA/ECDSA) will follow the same discriminated shape.
15) Runtime Notes

Web: cannot add arbitrary headers to the WS upgrade; place auth in hello. You also cannot programmatically disable compression; the server decides during upgrade.

Node: full control of extensions via ws. Default compression off; enable only with bounded settings after profiling with real traffic.

Electron: renderer uses client/web; main uses client/node.

16) Versioning & Compatibility

Subprotocol: nimbus.ssh.v1 (advertised by nimbus.v1 profile).

proto: 1 in hello identifies the semantic schema version.

New optional fields MAY be added to caps and messages; breaking changes require a new subprotocol/profile id (e.g., nimbus.ssh.v2, nimbus.v2).

17) Implementation Checklist (v1)

>Tracked as separate tickets; summarized here so contributors see the whole picture.

- Profiles: implement nimbus.v1, json-base64.v1, lenpfx.v1; register + tests
- client/web: classic WS + progressive WebSocketStream; HWM/LWM; credit logic; resume store
- client/node: ws transport; same API; compression options; parity tests
- server/node: HTTP upgrade + ws; origin/policy/limits; credit; @nimbus/ssh adapter
- Docs: README.md (quick start), PROTOCOL.md (interop), this spec
- Tests: unit, integration, E2E; conformance matrix; memory/leak sentinels

18) Appendix A — Default Limits (v1)

maxFrame (server‑advertised): 1 MiB

Per‑channel windowTarget: 256 KiB (adaptive up to 2 MiB with good RTT)

Connection HWM/LWM (web/node defaults): 8 MiB / 2 MiB

Heartbeat interval/miss threshold: 20s / 3

Idle timeout: 60s

maxSessionsPerConn: 4

Control rate limit: 50 messages/sec/connection

19) Appendix B — Security Posture (summary)

TLS everywhere (wss://) except localhost dev

In‑band token auth (hello.auth)

No cookies; CSRF minimized

Origin allow‑list enforced server‑side

Compression disabled by default for this protocol

Strict frame limits; aggressive close on violations

20) Appendix C — ASCII topology

```swift
Browser/Electron (renderer)        Node/Electron (main)         Server (node)
┌───────────────────────────┐      ┌───────────────────────┐    ┌────────────────────────┐
│ @nimbus/websocket/client/web│      │@nimbus/websocket/client│    │@nimbus/websocket/server  │
│  - WS / WSStream          │      │  - ws (node)         │    │  - ws + HTTP upgrade   │
│  - credit mgr + mux       │      │  - credit mgr + mux  │    │  - mux + policies      │
└───────────┬───────────────┘      └─────────┬────────────┘    └──────────┬─────────────┘
            │  WS (one conn; subprotocol; profile)                      │
            └────────────────────────────────────────────────────────────┘
                                              SSH adapter
                                              (per channel)
                                                                  @nimbus/ssh/client/node
```
