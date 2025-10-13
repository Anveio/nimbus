# Nimbus Web Demo

The web demo is now a Next.js application that discovers EC2 instances and
launches the Nimbus terminal experience directly in the browser. Instead of a
local-echo sandbox, the landing page queries AWS for EC2 inventory and guides
users through credential setup before connecting via EC2 Instance Connect.

## What’s new

- **Host discovery.** The `/` route calls EC2’s `DescribeInstances` API (across
  `NIMBUS_WEB_DEMO_REGIONS` or `AWS_REGION`) and renders a roster with connect
  CTAs. Authentication failures are surfaced explicitly so developers know when
  to configure AWS credentials.
- **Per-instance terminal route.** Selecting a host navigates to
  `/ec2-instance-connect/{instanceId}`, where we display instance metadata and a
  live Nimbus terminal canvas. The preview runtime is ready to wire into the
  websocket bridge deployed by the infra scripts.
- **Instructions-first UX.** When we can’t find hosts, we present actionable
  guidance on provisioning EC2 instances with EC2 Instance Connect, opening port
  22, and attaching IAM roles.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start Next.js locally (`http://localhost:3000`). |
| `npm run dev:https` | Start the dev server over HTTPS (requires locally trusted certs). |
| `npm run build` | Generate a production build. |
| `npm run start` | Serve the production build. |
| `npm run test` | Execute Playwright E2E tests. |
| `npm run test:e2e:headed` | Run the Playwright suite in a headed browser. |
| `npm run test:e2e:ui` | Launch the Playwright interactive UI. |
| `npm run typecheck` | Run `tsc --noEmit` against the app. |

The infra helper commands (`npm run infra:*`) remain unchanged and deploy the
AWS side of the demo (signer Lambda, websocket bridge, testing stacks).

## AWS configuration

The EC2 roster relies on standard AWS credential resolution (env vars, shared
credentials file, IMDS, etc.). To scan specific regions set:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...        # if using temporary credentials
export NIMBUS_WEB_DEMO_REGIONS="us-west-2,us-east-1"
```

If `NIMBUS_WEB_DEMO_REGIONS` is omitted we fall back to `AWS_REGION`.

Expected IAM permissions:

- `ec2:DescribeInstances` (for discovery)
- Optional: permissions required by the websocket bridge if you plan to
  extend the UI with mutation flows.

## Development flow

1. Start the Next.js dev server with `npm run dev` (or `npm run dev:https` if you
   need HTTPS locally).
2. Visit `http://localhost:3000` (or `https://localhost:3000`) to view the EC2 roster. Authentication issues
   are rendered inline with setup instructions.
3. Click **Connect** to open the instance-specific route. Use the terminal
   preview alongside the `POST /api/sign` endpoint to generate SigV4 websocket
   URLs that target your deployed bridge.

Playwright tests assume the dev server runs on `localhost:3000`; adjust
`PORT/HOST` env vars if you need a different binding.

### Enabling HTTPS locally

Browsers disallow `wss://` connections from an `http://` origin, so when
bridging EC2 Instance Connect you should run the dev server over HTTPS:

Run `npm run dev:https:setup` once to generate trusted certificates (it wraps
`mkcert -install` and writes the files to `apps/web-demo/certs/`). If you prefer
manual control, follow the same steps yourself and then run `npm run dev:https`.

The `dev:https` script reads `NIMBUS_DEV_CERT` / `NIMBUS_DEV_KEY` or defaults to
`apps/web-demo/certs/localhost-{cert,key}.pem`. Any additional flags passed to
the script are forwarded to `next dev`.

## Cleaning up demo infrastructure

If you deploy the supporting AWS stacks, remember to tear them down when done:

```bash
npm run infra:testing-destroy               # remove the testing stack
npm run infra:destroy                       # remove the dev stack
npm run infra:cleanup-tagged -- --wait      # sweep any remaining tagged stacks
```

Run `npm run infra:cleanup-tagged -- --dry-run` first for a preview. The helper
scripts tag resources with `nimbus:*` for deterministic cleanup (legacy
`mana:*` tags are still recognised).

## Folder layout

- `app/` – Next.js routes (landing page + instance connect view).
- `components/` – Shared React components (tables, instruction panels, terminal preview).
- `app/api/sign/` – SigV4 signer route invoked by the UI to presign EC2 Instance Connect websockets.
- `lib/` – Server utilities (EC2 discovery helpers).
- `test/e2e/` – Playwright specs.
- `public/` – Static assets.

This app serves as the canonical example of how a host can discover infrastructure,
communicate status to the user, and drop them into the Nimbus terminal with a
single click.
