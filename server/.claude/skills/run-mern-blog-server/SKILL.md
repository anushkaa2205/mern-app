---
name: run-mern-blog-server
description: Build, run, and drive the mern-blog-server Express/MongoDB API. Use when asked to start the server, run it, test its endpoints, or verify the blog API (posts CRUD) is working.
---

Express + Mongoose REST API for blog posts (`GET/POST /api/posts`,
`GET/PUT/DELETE /api/posts/:id`). No build step — plain Node. Drive it via
`.claude/skills/run-mern-blog-server/smoke.sh` under Git Bash (this is a
Windows environment; the script shells out to PowerShell for process/service
queries but runs as a normal bash script).

All paths below are relative to `server/` (this directory).

## Prerequisites

- Node.js (already on PATH — confirmed working: `node` v-whatever is installed).
- MongoDB Community Server, installed **as a Windows service** named
  `MongoDB` (StartType: Automatic). Confirmed present at
  `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`, config at
  `C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg` (dbPath
  `C:\Program Files\MongoDB\Server\8.3\data`, port 27017, bindIp 127.0.0.1).
  If it's ever missing on a fresh machine, install with:
  ```powershell
  winget install MongoDB.Server
  ```
  (installs and registers the service automatically).
- `npm install` in this directory (already done; `node_modules/` present).

## Setup

`.env` already exists with:
```
MONGODB_URI=mongodb://localhost:27017/mern-blog
PORT=5000
```
No changes needed for local runs.

## Run (agent path)

Use the driver script — it knows to reuse the MongoDB **service** rather
than spawning a second `mongod` (see Gotchas):

```bash
bash .claude/skills/run-mern-blog-server/smoke.sh full
# equivalent: npm run start-server
```

This starts (or confirms) the MongoDB service, launches `node server.js`
in the background, runs a full CRUD smoke test against `/api/posts`
(create → get → update → delete → confirm 404), then stops the node
server (leaving the MongoDB service running, since it's a system
service, not something this project owns).

Verified output of a real run:
```
MongoDB service already running
starting node server...
ready: http://localhost:5000
--- create ---
{"title":"Smoke Test", ... "_id":"6a5fc208015c926018f18570", ...}
...
--- get after delete (expect 404) ---
404 (as expected)
PASS
stopped node server (port 5000 freed); MongoDB service left running
```

Individual steps (useful if you want the server left running to poke at
manually, e.g. from a browser or Postman):

```bash
bash .claude/skills/run-mern-blog-server/smoke.sh start   # start + wait for ready
bash .claude/skills/run-mern-blog-server/smoke.sh verify  # run the CRUD checks
bash .claude/skills/run-mern-blog-server/smoke.sh stop    # stop node only
```

Server logs land at `/tmp/mern-blog-server-logs/server.log`.

| command | what it does |
|---|---|
| `smoke.sh start` | ensures MongoDB service is running, starts `node server.js` in background, polls until `/` responds |
| `smoke.sh verify` | full CRUD smoke test against a running server, prints `PASS` and exits 0, or fails loudly |
| `smoke.sh stop` (or `npm run stop-server`) | kills whatever owns port 5000; leaves the MongoDB service alone |
| `smoke.sh full` (default) | start → verify → stop, single command, exit code tells you if it's healthy |

## Run (human path)

```bash
node server.js       # or: npm run dev  (nodemon, auto-restart)
```
Blocks the terminal. Ctrl-C to stop. Requires the MongoDB service to
already be running (`Get-Service MongoDB` should show `Running`).

## Test

No test suite in this project (no `test` script in `package.json`,
no test files present). `smoke.sh verify` is the closest equivalent —
it exercises every route.

## Gotchas

- **Do not manually spawn a second `mongod`.** MongoDB here is
  installed as a genuine Windows service (`Get-Service MongoDB`,
  StartType Automatic) already bound to 127.0.0.1:27017. A manually
  launched `mongod --port 27017` loses the port race silently (exits
  without obviously erroring in a way you'll notice from a background
  job) — and worse, if it *does* win the race (e.g. service not yet
  started), the app ends up writing data to a throwaway directory
  instead of the service's real dbpath, and that data vanishes the
  next time the service takes over the port. Confirmed this exact
  failure mode during development: a test post written this way
  disappeared once the service resumed ownership of the port. Always
  check `Get-Service MongoDB` / `Get-NetTCPConnection -LocalPort 27017`
  first — `smoke.sh start` already does this.
- **`Get-Service -Name MongoDB` can appear to return nothing even when
  the service exists**, if run as part of a chained/combined command
  in some shells — if in doubt, run it alone: `Get-Service MongoDB`.
- **`$!` after a background launch inside `( subshell & disown )`
  isn't reliably capturable from outside the subshell** — the driver
  finds the node process via `Get-NetTCPConnection -LocalPort 5000`
  instead of tracking a PID.

## Troubleshooting

- **`MongoDB connection error: connect ECONNREFUSED`** at server
  startup: the MongoDB service isn't running. Fix: `Start-Service
  MongoDB` (or `smoke.sh start`, which does this automatically).
- **`smoke.sh verify` fails at the create step**: check
  `/tmp/mern-blog-server-logs/server.log` for a Mongoose error — most
  likely the service stopped mid-session or `MONGODB_URI` in `.env`
  doesn't match `mongodb://localhost:27017/mern-blog`.
