# Ticko: Setup on your laptop (Windows CMD)

Two ways to run it. **Way A (Docker) is the easiest.** Use Way B only if you want to edit code with hot-reload.

## 0. Install once (prerequisites)
| Tool | Version | Download | Check in CMD |
|---|---|---|---|
| Node.js (LTS) | 20 or newer | https://nodejs.org | `node -v` |
| Git | any | https://git-scm.com | `git --version` |
| Docker Desktop | any (WSL2 on) | https://www.docker.com/products/docker-desktop | `docker --version` |

After installing Docker Desktop, **open it and wait until it says "Engine running"**.

## 1. Unzip into a SIMPLE path
Extract `tixoryops.zip` to a folder whose full path has **no `&` character** (and ideally no spaces), for example `C:\projects\tixoryops`.

> ⚠️ A path like `F:\CLOUD ENGINEERING & DEVOPS\...` breaks npm on Windows: CMD reads `&` as "run another command", so every `npm run ...` fails with
> `'...\node_modules\.bin\' is not recognized`. Docker builds are fine, but move the folder before using npm.

Then:
```bat
cd C:\projects\tixoryops
```

---

## WAY A: Docker (one command)

### A1. (Optional) fast demo mode
Make human time run 60x faster (1 real second = 1 simulated minute) so overruns and SLA warnings show up in minutes:
```bat
echo DEMO_TIME_SCALE=60> .env
```
(Skip this for normal real-time speed.)

### A2. Build and start everything
```bat
docker compose up --build
```
The first build takes 3-8 minutes (downloads Node, Postgres, nginx). Wait until you see `Ticko backend listening`.

### A3. Open the app
* Web app: http://localhost:5173
* Backend health: http://localhost:4000/healthz

### A4. Log in (password for every account: `Passw0rd!`)
| Role | E-mail |
|---|---|
| Supervisor | `supervisor@tixory.test` |
| Operator | `operator1@tixory.test` |
| Technician | `nusrat@tixory.test` |
| Admin | `admin@tixory.test` |

The login page also has quick-fill buttons.

### A5. Stop / start again
```bat
:: stop (keeps data)
Ctrl + C         (in the window running compose)
docker compose down

:: start again later (no rebuild needed)
docker compose up

:: wipe everything including the database
docker compose down -v
```

---

## WAY B: Local development (hot reload)

You need **3 CMD windows**.

### B1. Window 1: database only
```bat
cd C:\projects\tixoryops
docker compose up -d db
```

### B2. Window 2: backend
```bat
cd C:\projects\tixoryops\backend
copy ..\.env.example .env
npm install
npx prisma generate
npm run db:deploy
npm run db:seed
npm run dev
```
You should see `Ticko backend listening` on port 4000.
(For fast demo time, open `backend\.env` and change `DEMO_TIME_SCALE=1` to `DEMO_TIME_SCALE=60`, then restart.)

### B3. Window 3: frontend
```bat
cd C:\projects\tixoryops\frontend
npm install
npm run dev
```
Open http://localhost:5173

---

## Make the dashboard come alive (field simulator)

With the app running (Way A or B), open **another CMD window**:
```bat
cd C:\projects\tixoryops\backend
npm install
npm run demo:traffic -- --interval=8 --max-open=8
```
Then log in as **supervisor** in the browser and watch: tickets appear, diagnostics progress rings fill, cards glide between columns, steps overrun, SLA rings turn amber/red, workers show in the Worker pool panel.
Stop the simulator with `Ctrl + C`.

## Try the main features by hand (2-minute tour)
1. Log in as **operator1** → **New ticket** → pick a customer → fill title/details → Create. Watch the *diagnostics* progress live.
2. Log in as **supervisor** (second browser window or Incognito) → the new card moves to **Needs assignment** → **Assign** → pick the "Best match" technician.
3. Log in as **nusrat** (technician, third window) → **My work** → **Start** a step. Stay on a 20-minute step and watch **OVERRUN** appear (use `DEMO_TIME_SCALE=60`). The next step stays 🔒 locked until the first is done.
4. Finish all steps → **Request speed verification** (choose *force PASS* in demo mode) → ticket becomes **Resolved**.
5. In the supervisor's ticket page click **Tracking link** and open it in a private window: the customer sees live progress and can press **Yes, fixed** or **Still broken**.

## New admin features: quick tour
| I want to… | Do this |
|---|---|
| **Create a technician account** (own e-mail + password) | Log in as **admin** → left menu **Users** → **New user** → role *Technician* → give skills + max active tickets → *Generate* a password → **Create account** → copy the credentials and give them to the technician |
| **Change someone's e-mail or password** | Users → **Edit** next to the person → change e-mail and/or type a *new password* → Save. They are signed out immediately. |
| **Disable an account** | Users → Edit → untick *Account active* (a technician must have no active tickets) |
| **Add a new ticket category** | **Settings** → *Add a new category* (name + which work plan to generate), **or** in *New ticket* click **Add a new category** under the category box |
| **Say which step comes after which** | Open a ticket → **Add step** → choose *Right away*, *After specific step(s)* or *Insert into the chain after a step*; the box *What will happen* previews the order. Use the pencil ✎ on a step to change what it waits for. |
| **See what a technician did today** | Supervisor/admin: **Day reports** → click the technician (use the date arrows for other days; CSV/Print buttons). Technician: **My day**. |
| **Change my own password** | Key icon (top right / sidebar) → Change password |

## Run the automated tests
```bat
:: backend tests need PostgreSQL (Way B step B1 is enough) and a test database:
docker exec -it ticko-db psql -U tixory -c "CREATE DATABASE tixoryops_test;"
cd C:\projects\tixoryops\backend
npm test

:: frontend tests
cd C:\projects\tixoryops\frontend
npm test
```
Expected: backend **60 passed**, frontend **52 passed**.

## Troubleshooting
| Problem | Fix |
|---|---|
| `docker: command not found` / "cannot connect to the Docker daemon" | Start **Docker Desktop** and wait for "Engine running". |
| `port is already allocated` (5432) | A local PostgreSQL is running. Stop it (Services → postgresql → Stop) or change `5432:5432` to `5433:5432` in `docker-compose.yml` (and use port 5433 in `backend\.env`). |
| Port 4000 or 5173 in use | `netstat -ano \| findstr :5173` then `taskkill /PID <pid> /F`. |
| Database error after updating to a newer zip | `docker compose down -v` then `docker compose up --build` (a fresh database applies all migrations). |
| Login says "Invalid e-mail or password" | The seed did not run. Way A: `docker compose down -v` then `docker compose up --build`. Way B: `npm run db:seed`. |
| `npx prisma generate` fails / hangs | Check internet access (it downloads small tooling on first run), then retry. |
| `'...node_modules\.bin\' is not recognized` or `Cannot find module 'F:\tsx\dist\cli.mjs'` | Your folder path contains `&` (or odd characters). Move the project to e.g. `C:\projects\tixoryops`. Quick workaround without moving: `node node_modules\tsx\dist\cli.mjs scripts\demo-traffic.ts --interval=8` (run inside `backend`). |
| Docker build error `Cannot find module '/app/scripts/copy-assets.js'` | You have an old zip. Use the latest zip, or add the line `COPY scripts ./scripts` before `COPY src ./src` in `backend\Dockerfile`. |
| Page loads but the badge says **Reconnecting…** | Backend is not running or crashed. Look at the backend window / `docker compose logs backend`. |
| Everything is slow to react | Run `docker compose logs -f backend` to see errors. |
| Want to see real SLA warnings fast | Use `DEMO_TIME_SCALE=60` (see A1/B2) and a **Critical** ticket (4-hour SLA = 4 real minutes). |

## Useful commands
```bat
docker compose logs -f backend        :: live backend log
docker compose ps                     :: what is running
docker compose down -v                :: reset database completely
```
