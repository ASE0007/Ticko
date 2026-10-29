# Ticko Technical Documentation

**Project:** Ticko - Real-Time ISP Service Request Management  
**Document purpose:** Explain how to install, configure, run, and understand the application.  
**Audience:** Students, reviewers, developers, and anyone running the project locally.

> **Important scope note:** The current version simulates line diagnostics and speed verification. It demonstrates how a service request is managed, but it does not connect to real ISP devices or repair routers.

## Contents

1. [System Overview](#1-system-overview)
2. [Requirements and Scope Notes](#2-requirements-and-scope-notes)
3. [Prerequisites](#3-prerequisites)
4. [Installation and Run Instructions](#4-installation-and-run-instructions)
5. [Environment Configuration](#5-environment-configuration)
6. [Architecture Overview](#6-architecture-overview)
7. [Database Design and Setup](#7-database-design-and-setup)
8. [REST API Reference](#8-rest-api-reference)
9. [WebSocket Protocol](#9-websocket-protocol)
10. [Background Jobs and Concurrency](#10-background-jobs-and-concurrency)
11. [Build, Type Check, Tests, and CI](#11-build-type-check-tests-and-ci)
12. [Security and Privacy Notes](#12-security-and-privacy-notes)
13. [Common Problems](#13-common-problems)
14. [Source Files to Know](#14-source-files-to-know)
15. [Further Reading](#15-further-reading)

## 1. System Overview

Ticko manages an ISP service request from the first complaint to customer confirmation. An operator creates a ticket. The backend stores the ticket and queues a diagnostic job. After the simulated diagnostic finishes, the ticket receives a work plan. A supervisor assigns a technician. Technicians complete the steps in the correct order. The system then runs simulated speed verification. The customer can confirm the resolution or report that the problem remains.

The supervisor dashboard receives real-time ticket, job, SLA, and technician updates through WebSockets.

### 1.1 Main capabilities

- Ticket and customer management.
- Technician assignment based on skill, availability, and workload.
- Work plans with step dependencies and estimated/actual durations.
- SLA countdowns, warning states, overrun alerts, and priority escalation.
- Background line-diagnosis, speed-verification, and CSV-export jobs.
- Real-time ticket and job updates, with reconnect and limited event replay.
- Role-based access for Admin, Supervisor, Operator, and Technician.
- Customer-safe tracking links, reports, metrics, and audit history.

### 1.2 User roles

| Role | Typical tasks |
|---|---|
| Admin | Manage users, account status, categories, SLA policies, and all operational work. |
| Supervisor | Assign or reassign technicians, edit work plans, inspect jobs, and view reports. |
| Operator | Create and update service tickets, manage customer information, and record customer confirmation. |
| Technician | See assigned work, change availability, start/complete permitted steps, and request verification. |
| Customer with tracking link | View limited ticket progress and confirm or report a problem. |

The API enforces these roles. Some routes also check access to a particular ticket or technician record.

## 2. Requirements and Scope Notes

Ticko was designed to demonstrate REST API development, persistent database integration, validation, error handling, role-based access, WebSocket updates, and concurrent background work.

### 2.1 Important implementation boundaries

- Diagnostics and speed testing are simulated through the probe interface. There is no live TR-069, SNMP, router, or ISP monitoring integration in this version.
- The event bus, WebSocket sequence counter and replay buffer, worker queue, and SLA scheduler live inside one backend process. The current deployment is intended for one backend instance.
- The replay buffer is held in memory. If a client misses more events than the buffer can cover, or the server restarts, the client must fetch the current state again.
- There is no SMS or email provider. Customers receive a private tracking link.
- Docker Compose defaults are intended for local coursework. They must be tightened before public deployment.

## 3. Prerequisites

### Recommended: Docker Compose

- Docker Desktop installed and running with the Linux container engine.
- Windows CMD, PowerShell, macOS terminal, or Linux shell.
- Internet access for the first image and package downloads.

Node.js 20 or newer is only required on the host if you want local hot reload, to run the demo-traffic script, or to run tests outside containers.

## 4. Installation and Run Instructions

### 4.1 Extract and open the project

Extract the ZIP into a folder such as `C:\projects\Ticko`. In Windows CMD:

```bat
cd /d "C:\projects\Ticko"
dir
```

The project root should contain `docker-compose.yml`, `.env.example`, `backend`, `frontend`, and `README.md`. Use quotation marks when the path contains spaces.

### 4.2 Configure the project-root environment file

Create `.env` if it does not already exist:

```bat
if not exist .env copy .env.example .env
notepad .env
```

The Docker Compose file reads values from the project-root `.env` file only for variables referenced in `docker-compose.yml`. The backend container receives the database URL from Compose. The `backend\.env` file is used when the backend is run directly with Node.js.

For local coursework, the sample configuration can be used. Before public deployment, replace `JWT_SECRET` with a long random secret, set `DEMO_MODE=false`, set `RATE_LIMIT_ENABLED=true`, and change `CORS_ORIGIN` to the real frontend origin. Do not commit `.env` or share its contents.

### 4.3 Validate and start with Docker

```bat
docker compose config
docker compose up --build
```

The startup process is:

1. PostgreSQL starts and passes its health check.
2. The backend applies Prisma migrations.
3. The backend runs the idempotent seed script for users and reference data.
4. The backend connects to PostgreSQL, recovers unfinished jobs, starts the worker pool and SLA scheduler, and starts the HTTP/WebSocket server.
5. Nginx serves the frontend and forwards `/api` and `/ws` requests to the backend.

The first build may take several minutes. Keep the terminal open while using the application.

### 4.4 Local URLs

| Service | URL | Meaning |
|---|---|---|
| Frontend | `http://localhost:5173` | Main React application served by Nginx. |
| Backend liveness | `http://localhost:4000/healthz` | Confirms that the backend process is responding. |
| Backend readiness | `http://localhost:4000/readyz` | Runs a database query and reports whether the API is ready. |
| WebSocket via frontend proxy | `ws://localhost:5173/ws` | Real-time channel used by the browser. |
| WebSocket direct to backend | `ws://localhost:4000/ws` | Direct backend WebSocket endpoint for local tests. |

The frontend does not use a generated Swagger page. This document is the endpoint reference, and the routes are defined in `backend/src/routes/index.ts`.

### 4.5 Seeded demo accounts

The seed script creates these accounts with the same local-demo password, `Passw0rd!`:

| Role | Email |
|---|---|
| Admin | `admin@tixory.test` |
| Supervisor | `supervisor@tixory.test` |
| Operator | `operator1@tixory.test`, `operator2@tixory.test` |
| Technician | `rafi@tixory.test`, `nusrat@tixory.test`, `imran@tixory.test`, `sadia@tixory.test` |

These are demo credentials, not safe public credentials. Change or remove all demo accounts before public deployment. The seed script creates reference data; it does not create a large set of demo tickets.

### 4.6 Local development with hot reload

Start PostgreSQL in one terminal:

```bat
cd /d "C:\projects\Ticko"
docker compose up -d db
```

Start the backend in a second terminal:

```bat
cd /d "C:\projects\Ticko\backend"
copy ..\.env.example .env
npm ci
npx prisma generate
npm run db:deploy
npm run db:seed
npm run dev
```

If `backend\.env` already exists, do not overwrite it unless you intend to replace its settings. Confirm that `DATABASE_URL` uses `localhost:5432` when the backend runs on the host.

Start the frontend in a third terminal:

```bat
cd /d "C:\projects\Ticko\frontend"
npm ci
npm run dev
```

Open `http://localhost:5173`. The Vite configuration proxies `/api` and `/ws` to `localhost:4000`.

### 4.7 Stop, restart, or reset

To stop the foreground process, press `Ctrl+C`. Then stop the Compose containers while keeping the database:

```bat
docker compose down
```

Restart without rebuilding:

```bat
docker compose up
```

Rebuild after code or image changes:

```bat
docker compose up --build
```

To remove this project's database volume and recreate an empty database:

```bat
docker compose down --volumes --remove-orphans
docker compose up --build
```

**Warning:** `--volumes` deletes all data in this Ticko Compose project's PostgreSQL volume. Do not use it if you need the existing data.

### 4.8 Run the demo-traffic simulator

The simulator runs on the host and requires Node.js 20 or newer. With the application already running:

```bat
cd /d "C:\projects\Ticko\backend"
npm ci
npm run demo:traffic -- --interval=8 --max-open=8
```

Add `--duration=120` if you want the script to stop after about two minutes. Press `Ctrl+C` to stop it. The simulator uses the REST API to create and work through demo tickets.

For a quicker class demonstration, set `DEMO_TIME_SCALE=60` in the project-root `.env` for Docker, or `backend\.env` for local development, and restart the backend. This speeds up human work and SLA timing; it is not a performance benchmark.

## 5. Environment Configuration

The backend validates its environment with Zod when it starts. Invalid required values stop startup and print a clear configuration error.

### 5.1 Environment variable reference

| Variable | Purpose | Sample/default in this project |
|---|---|---|
| `NODE_ENV` | Runtime mode | `development` for local Node; Compose sets `production`. |
| `PORT` | Backend HTTP/WebSocket port | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | Local host: `postgresql://tixory:tixory@localhost:5432/tixoryops?schema=public`; backend container uses host `db`. |
| `JWT_SECRET` | Signs and verifies login tokens | Required, at least 32 characters; use a long random value. |
| `JWT_EXPIRES_IN` | JWT lifetime | `8h` |
| `BCRYPT_COST` | Password-hashing cost | `.env.example` uses `12`. |
| `CORS_ORIGIN` | Allowed browser origin(s) | `http://localhost:5173`; separate multiple origins with commas. |
| `LOG_LEVEL` | Structured log level | `info` |
| `RATE_LIMIT_ENABLED` | Enables HTTP rate limiting | Backend default `true`; Compose fallback `false` for demo traffic. Use `true` for public use. |
| `MAX_ACTIVE_TICKETS` | Default active-ticket capacity per technician | `2` (valid range 1-20). |
| `VERIFY_PASS_THRESHOLD` | Required measured/plan speed ratio | `0.8` (80%). |
| `AUTO_CLOSE_HOURS` | Inactivity time before a resolved ticket is auto-closed | `48` simulated hours, according to the configured clock scale. |
| `PROBE_STAGE_MS` | Duration of each simulated probe stage | `2500` milliseconds. |
| `SCHEDULER_TICK_MS` | SLA/overrun scheduler interval | `1000` milliseconds. |
| `DEMO_MODE` | Allows demo PASS/FAIL verification overrides in production mode | Backend parser default `false`; Compose fallback `true` for local demo. Set `false` for public deployment. |
| `WORKER_CONCURRENCY` | Maximum async job handlers running in the process | `3` (valid range 1-32). |
| `DEMO_TIME_SCALE` | Speeds up human work and SLA time for demonstrations | `1`; `60` means one real second counts as one simulated minute for the scaled timers. |
| `TEST_DATABASE_URL` | Optional separate database URL for tests | `postgresql://tixory:tixory@localhost:5432/tixoryops_test?schema=public` |

The Compose defaults for `DEMO_MODE` and `RATE_LIMIT_ENABLED` differ from the backend configuration parser defaults. Review the root `.env` and `docker-compose.yml` together so you know which values are active.

### 5.2 Docker database settings

The current local Compose file uses:

| Setting | Value |
|---|---|
| Compose service name / host from backend | `db` |
| Internal PostgreSQL port | `5432` |
| Database | `tixoryops` |
| Username | `tixory` |
| Password | `tixory` |
| Persistent volume | `pgdata` (Compose normally names it `ticko_pgdata` in this project) |

These are local demo credentials only. Do not expose the database port publicly or reuse these credentials in production.

## 6. Architecture Overview

**Architecture diagram:** See [System Design — High-Level Architecture](02-system-design.md#1-high-level-architecture).

### 6.1 Request and event flow

1. The React frontend sends a REST request to Express.
2. Middleware checks JWT/session validity, role permissions, request schema, rate limits, and errors.
3. The route calls a service. The service applies business rules and uses Prisma to read or update PostgreSQL.
4. For long tasks, the service persists a `Job` record and then enqueues it. The API response does not wait for the full job.
5. After database changes commit, the service publishes a domain event to the in-process event bus.
6. The WebSocket hub sends the event to the rooms allowed to receive it.
7. Zustand stores apply events to the frontend state, and components update the visible board.

### 6.2 Main source folders

```text
backend/src/
  config/       Environment parsing and constants
  domain/       Ticket state machine, SLA, forecast, work plans, progress
  middleware/   JWT/session auth, role checks, validation, rate limit, errors
  repositories/ Prisma client and database access
  routes/       REST endpoints
  schemas/      Zod request schemas
  services/     Ticket, assignment, steps, users, reports, SLA and tracking logic
  queue/        Priority queue, worker pool and job handlers
  realtime/     In-process event bus and WebSocket hub
  probe/        Network-probe interface and simulated checks
  workers/      CSV worker-thread code

frontend/src/
  api/          REST client and API types
  store/        Zustand state stores
  ws/           WebSocket connection and event router
  components/   Reusable cards, dialogs, timelines, charts and forms
  pages/        Dashboard, tickets, jobs, reports, settings and role pages
```

### 6.3 Technology choices

| Technology | Reason in Ticko |
|---|---|
| Node.js 20 and TypeScript | One typed language for backend code and asynchronous I/O. |
| Express | Simple routing and middleware for the REST API. |
| React, Vite, TypeScript | Component-based UI with a fast development build. |
| Zustand | Small shared state stores for login, tickets, jobs and UI state. |
| PostgreSQL | Reliable relational storage and transaction support for concurrent assignments and ticket changes. |
| Prisma | Typed models and migrations that match the TypeScript backend. |
| Zod | Request and form validation with clear error messages. |
| `ws` | Direct WebSocket communication with an explicit message protocol. |
| Docker Compose and Nginx | A repeatable local environment; Nginx serves the SPA and proxies API/WebSocket traffic. |
| Vitest, Supertest, Testing Library | Tests for business rules, API endpoints, WebSocket behavior and UI components. |

## 7. Database Design and Setup

The database schema is defined in `backend/prisma/schema.prisma`. SQL migrations are in `backend/prisma/migrations/`. Prisma generates the typed database client during the image build or with `npx prisma generate`.

### 7.1 Main data models

| Model/table | Purpose |
|---|---|
| `User` / `users` | Login identity, password hash, role, active flag, and token version. |
| `Technician` / `technicians` | Technician skills, availability, current load, and capacity limit. |
| `Customer` / `customers` | Customer account, contact details, area, and subscribed speed plan. |
| `Category` / `categories` | Ticket category, default priority, active state, and work-plan template. |
| `Ticket` / `tickets` | Ticket number, customer, title, category, status, priority, SLA, progress, and tracking token. |
| `TicketAssignment` / `ticket_assignments` | Primary owner and helper assignment history. |
| `WorkStep` / `work_steps` | Work-step status, estimated/actual duration, skill, and assignee. |
| `StepDependency` / `step_dependencies` | Links one step to the steps it must wait for. |
| `StatusHistory` / `status_history` | Audit history for ticket and work activity. |
| `Job` / `jobs` | Background job type, status, priority, attempts, progress, result, and error. |
| `ProbeResult` / `probe_results` | Results and metrics from simulated diagnostic/verification checks. |
| `SlaPolicy` / `sla_policies` | Resolution target and warning percentage for each priority. |

**Core database ERD:** See [System Design — Database Design](02-system-design.md#6-database-design), especially Section 6.1.

**Operational database ERD:** See [System Design — Database Design](02-system-design.md#6-database-design), especially Sections 6.1–6.4.

### 7.2 Relationships and integrity

- A customer can have many tickets; a ticket belongs to one customer.
- A ticket is created by a user and can have a primary technician and multiple assignment records.
- A ticket can have many work steps, status-history records, and background jobs.
- Work-step dependencies connect steps in a directed dependency graph.
- Jobs can have multiple probe-result records.
- A technician is linked to a user account.
- Database constraints and transactions protect unique values, valid ranges, assignment capacity, and critical state changes.

The migrations also add database constraints and indexes that are not fully represented by the Prisma model declarations, including partial unique indexes and search indexes. Review the migration SQL before editing the schema.

### 7.3 Migration and seed commands

Docker performs migrations and seeds reference data when the backend container starts. For local Node development, run these from the `backend` folder:

```bat
npx prisma generate
npm run db:deploy
npm run db:seed
```

`npm run db:reset` is destructive and should only be used in development when the database can be discarded. The seed script is idempotent and creates users, technicians, customers, categories, and SLA policies. It does not create a large stream of demo tickets.

### 7.4 Test database safety

Backend tests default to `tixoryops_test`. Their global setup drops and recreates that test database's `public` schema before applying migrations. Create a dedicated test database before running backend tests, and never set `TEST_DATABASE_URL` to the normal `tixoryops` database if its data must be preserved.

With the Compose database running, create the test database once:

```bat
docker compose exec db psql -U tixory -d postgres -c "CREATE DATABASE tixoryops_test;"
```

Then, in the CMD window used for tests:

```bat
set TEST_DATABASE_URL=postgresql://tixory:tixory@localhost:5432/tixoryops_test?schema=public
cd /d "C:\projects\Ticko\backend"
npm ci
npx prisma generate
npm test
```

If the database already exists, do not run the `CREATE DATABASE` command again. Keep test data separate from application data.

## 8. REST API Reference

### 8.1 Base URL and authentication

With the default Docker setup:

- Direct backend base: `http://localhost:4000`
- REST base path: `http://localhost:4000/api`
- Frontend proxy path: `http://localhost:5173/api`

Most API endpoints require a JWT in the `Authorization` header:

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

Sign in with `POST /api/auth/login` and use the `token` returned in its response. Public tracking endpoints use a private tracking token in the path and do not need a staff JWT.

### 8.2 Role abbreviations in the endpoint list

- **Public:** no staff JWT; the route uses login or tracking-token protection and may be rate-limited.
- **Any signed-in role:** Admin, Supervisor, Operator, or Technician, subject to ticket-level checks.
- **Staff:** Admin, Supervisor, or Operator.
- **Manager:** Admin or Supervisor.
- **Technician + Manager:** a Technician, Supervisor, or Admin; service code applies extra ownership checks where needed.

### 8.3 Health and authentication endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/healthz` | Public | Backend liveness and uptime. |
| GET | `/readyz` | Public | Checks database readiness; returns `503` when the database is unavailable. |
| POST | `/api/auth/login` | Public | Validates email/password and returns a JWT and user summary. |
| GET | `/api/auth/me` | Any signed-in role | Returns the current user's profile. |
| POST | `/api/auth/change-password` | Any signed-in role | Changes the current user's password and returns a fresh token. |
| GET | `/api/config` | Any signed-in role | Returns demo time scale, demo mode, technician capacity, verification threshold, and auto-close setting. |

Login request example:

```json
{
  "email": "admin@tixory.test",
  "password": "Passw0rd!"
}
```

A successful response includes `token` and `user`. Use a new password for any real account; the example is a local demo credential only.

### 8.4 Public customer tracking endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/public/track/:token` | Public tracking token | Returns customer-safe ticket details and status history. |
| POST | `/api/public/track/:token/confirm` | Public tracking token | Confirms a resolved ticket and closes it. |
| POST | `/api/public/track/:token/report-issue` | Public tracking token | Reports that a resolved/closed issue remains and requests reopening. |

The matching frontend page is `/track/:token`. The tracking response intentionally excludes private staff-only customer details.

### 8.5 Tickets and work steps

| Method | Path | Access | Purpose / notes |
|---|---|---|---|
| POST | `/api/tickets` | Staff | Creates a ticket. Provide either `customerId` or inline `customer`, plus title, description, category, and priority. Queues simulated diagnostics. Returns `201`. |
| GET | `/api/tickets` | Any signed-in role | Lists tickets. Query filters include status, priority, category, SLA state, technician, unassigned, mine, free-text query, date range, sort, order, page, and limit. Technician results are scoped. |
| GET | `/api/tickets/:id` | Any signed-in role | Gets ticket detail, including related workflow information. Access is checked. |
| PATCH | `/api/tickets/:id` | Staff | Updates ticket fields. `version` is required for optimistic concurrency control. |
| GET | `/api/tickets/:id/timeline` | Any signed-in role | Reads the ticket audit timeline. |
| GET | `/api/tickets/:id/suggestions` | Manager | Returns ranked technician suggestions. |
| POST | `/api/tickets/:id/assign` | Manager | Assigns or reassigns a technician. Body includes `technicianId` and `version`; optional `note`. |
| POST | `/api/tickets/:id/helpers` | Manager | Adds a helper technician. Body includes `technicianId`. |
| POST | `/api/tickets/:id/request-verification` | Technician + Manager | Starts simulated speed verification. Optional body `{ "simulate": "PASS" }` or `{ "simulate": "FAIL" }` is a demo override when enabled. Returns `202`. |
| POST | `/api/tickets/:id/confirm` | Staff | Records customer confirmation and closes a resolved ticket. Optional `note`. |
| POST | `/api/tickets/:id/reopen` | Staff | Reopens a ticket. Body requires `reason`. |
| POST | `/api/tickets/:id/cancel` | Staff | Cancels a ticket. Body requires `reason`; active jobs are cancelled cooperatively. |
| GET | `/api/tickets/:id/steps` | Any signed-in role | Lists work steps, after checking ticket access. |
| POST | `/api/tickets/:id/steps` | Manager | Adds a step. Body includes `title`, `estimatedMinutes`, optional `dependsOn`, `insertAfter`, `requiredSkill`, and `assigneeId`. |
| PATCH | `/api/steps/:id` | Manager | Edits step title, estimate, dependencies, or assignee. `version` is required. |
| POST | `/api/steps/:id/start` | Technician + Manager | Starts a permitted step. Dependencies must be satisfied. |
| POST | `/api/steps/:id/complete` | Technician + Manager | Completes a step. Optional body `{ "note": "..." }`. |
| POST | `/api/steps/:id/skip` | Manager | Skips a step where business rules allow it. |

Ticket statuses include `OPEN`, `DIAGNOSING`, `AWAITING_ASSIGNMENT`, `ASSIGNED`, `IN_PROGRESS`, `VERIFYING`, `RESOLVED`, `CLOSED`, `REOPENED`, and `CANCELLED`. Valid transitions are enforced by the backend state machine.

Ticket list query example:

```text
GET /api/tickets?status=OPEN,IN_PROGRESS&priority=HIGH,CRITICAL&page=1&limit=25&sort=createdAt&order=desc
```

### 8.6 Customers, technicians, and jobs

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/customers` | Staff | Search customer records using `q` and `limit`. |
| POST | `/api/customers` | Staff | Creates a customer. Required fields include name, phone, address, and plan speed. |
| PATCH | `/api/customers/:id` | Staff | Updates customer information. |
| GET | `/api/technicians` | Any signed-in role | Lists technicians and workload data. |
| PATCH | `/api/technicians/:id/availability` | Technician + Manager | Sets availability to `AVAILABLE`, `BUSY`, or `OFF_DUTY`, subject to ownership rules. |
| GET | `/api/jobs` | Manager | Lists jobs and queue statistics; supports status filtering and a result limit. |
| POST | `/api/jobs/:id/cancel` | Manager | Cancels a queued/running job where possible. |
| POST | `/api/jobs/:id/retry` | Manager | Re-queues a failed or cancelled job. |
| GET | `/api/metrics` | Any signed-in role | Reads live metrics about jobs, SLA, and workload. |

### 8.7 Reports, SLA policies, users, and categories

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/reports/summary` | Manager | Reads summary KPIs for a date range. |
| POST | `/api/reports/export` | Manager | Queues CSV report generation and returns `202` with `jobId`. |
| GET | `/api/reports/export/:id` | Manager | Returns job status while pending; downloads CSV when complete. |
| GET | `/api/reports/throughput?hours=12` | Staff | Returns tickets filed/resolved per hour for the requested period. |
| GET | `/api/reports/technicians/day?from=...&to=...` | Manager | Returns the team technician-day report for a date range. |
| GET | `/api/reports/technicians/:id/day?from=...&to=...` | Manager; technician may view own report; operator forbidden | Returns an itemised technician-day report. |
| GET | `/api/sla-policies` | Staff | Lists SLA targets. |
| PUT | `/api/sla-policies` | Admin | Creates or updates SLA policies. Body contains a `policies` array. |
| GET | `/api/users` | Admin | Lists users and technician account information. |
| POST | `/api/users` | Admin | Creates a user. A technician account may include skills and capacity. |
| PATCH | `/api/users/:id` | Admin | Updates user profile, role-related fields, password, active state, or technician details where allowed. |
| GET | `/api/categories` | Any signed-in role | Lists active categories. Managers/admins may use `?all=true` to include inactive categories; technicians do not get inactive categories. |
| POST | `/api/categories` | Manager | Creates a category and work-plan settings. |
| PATCH | `/api/categories/:code` | Manager | Updates a category. |
| DELETE | `/api/categories/:code` | Admin | Deletes an unused custom category where allowed. |

Date query values should be ISO 8601 dates/timestamps. Check `backend/src/schemas/index.ts` for accepted body fields, string lengths, enum values, and validation rules before writing a client.

### 8.8 Error format and status codes

Errors use a common JSON shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "title", "message": "Title must be at least 5 characters" }],
    "requestId": "request-id"
  }
}
```

`details` may be absent when there are no field-level details.

| HTTP status | Meaning | Common example |
|---|---|---|
| `400` | The request is invalid | Invalid JSON or Zod validation failure. |
| `401` | Authentication is missing or invalid | Missing/expired JWT or invalid login. |
| `403` | The user does not have permission | Wrong role or access to another user's ticket. |
| `404` | The requested route or record does not exist | Unknown ticket ID or tracking token. |
| `409` | The request conflicts with current data | Duplicate value, version conflict, technician at capacity, or invalid concurrent assignment. |
| `422` | The request violates a business rule | Invalid status transition, locked step, or dependency cycle. |
| `429` | Rate limit exceeded | Too many requests when rate limiting is enabled. |
| `500` | Unexpected server error | An unhandled failure; use `requestId` to locate the log. |

## 9. WebSocket Protocol

### 9.1 Endpoint and connection

- With Docker Compose, the browser connects to `ws://localhost:5173/ws` through Nginx.
- The backend WebSocket path is `/ws` on port `4000`.
- The first client message must authenticate. A connection that does not authenticate within five seconds is closed.
- The server supports a maximum message payload of 16 KB and up to five simultaneous sockets per signed-in user.
- The server sends ping frames every 25 seconds. The frontend client sends an application-level `ping` about every 20 seconds and reconnects with backoff when disconnected.

### 9.2 Authentication messages

Staff and technicians authenticate with a JWT:

```json
{ "type": "auth", "token": "<JWT>" }
```

Customer tracking pages authenticate with the ticket tracking token:

```json
{ "type": "auth", "trackToken": "<tracking-token>" }
```

A successful connection receives a `system.hello` message. Staff roles join the `staff` room; technicians join their `tech:<technicianId>` room; customers join `track:<ticketId>`.

### 9.3 Client-to-server messages

| Message | Example | Purpose |
|---|---|---|
| Authenticate | `{ "type": "auth", "token": "<JWT>" }` | Authenticates a staff/technician socket. Use `trackToken` for a customer tracking socket. |
| Subscribe | `{ "type": "subscribe", "room": "ticket:<UUID>" }` | Subscribes an authenticated user to a ticket room, subject to access checks. |
| Unsubscribe | `{ "type": "unsubscribe", "room": "ticket:<UUID>" }` | Leaves a ticket room. |
| Resume | `{ "type": "resume", "lastSeq": 1842 }` | Requests replay of events after the last sequence number received. |
| Ping | `{ "type": "ping" }` | Requests an application-level `pong`. |

Technicians can only subscribe to tickets related to their assignment or steps. Customer tracking sockets cannot subscribe to arbitrary staff/ticket rooms.

### 9.4 Server event envelope

Published events use this general format:

```json
{
  "seq": 1843,
  "type": "ticket.status_changed",
  "ts": "2026-10-29T08:50:00.000Z",
  "room": "staff",
  "payload": {
    "ticket": { "id": "<ticket-id>", "status": "IN_PROGRESS" },
    "from": "ASSIGNED",
    "to": "IN_PROGRESS"
  }
}
```

This is an example only; the actual payload fields depend on the event. System messages use sequence number `0`. Published events have an increasing sequence number for the current backend process.

### 9.5 Server event types

| Event | Meaning |
|---|---|
| `ticket.created` | A ticket was created. |
| `ticket.updated` | Ticket fields or derived information changed. |
| `ticket.status_changed` | Ticket status changed. |
| `ticket.assigned` | A technician was assigned or changed. |
| `ticket.cancelled` | A ticket was cancelled. |
| `ticket.closed` | A ticket was closed. |
| `ticket.reopened` | A ticket was reopened. |
| `forecast.updated` | Estimated completion time or step totals changed. |
| `step.updated` | Work-step data and forecast changed. |
| `step.unlocked` | A step dependency was satisfied and one or more steps became ready. |
| `step.overrun` | A running step passed an overrun threshold. |
| `job.queued` | A background job entered the queue. |
| `job.started` | A worker started a job. |
| `job.progress` | A job reported progress. |
| `job.retrying` | A failed attempt will be retried. |
| `job.completed` | A job completed successfully. |
| `job.failed` | A job failed after its available attempts. |
| `job.cancelled` | A job was cancelled. |
| `job.alert` | A background failure needs supervisor attention. |
| `sla.at_risk` | A ticket is predicted to miss its SLA. |
| `sla.warning` | The ticket has reached its SLA warning threshold. |
| `sla.breached` | The ticket has missed its SLA deadline. |
| `technician.updated` | Technician availability or workload data changed. |
| `metrics.updated` | Dashboard metrics changed. |
| `presence.updated` | The set of connected staff users changed. |
| `system.hello` | Authentication succeeded and connection details were returned. |
| `system.subscribed` | A ticket-room subscription succeeded. |
| `system.resumed` | Event replay completed. |
| `system.resync_required` | The gap is too large; fetch fresh state through REST. |
| `system.error` | The WebSocket request was invalid or could not be accepted. |
| `pong` | Reply to a client application-level ping. |

Events are sent to specific rooms. Customer tracking events use a reduced, customer-safe ticket representation.

### 9.6 Reconnect and replay

The frontend reconnects with exponential backoff and jitter. After it reconnects, it sends `resume` with the last sequence it received. The backend keeps the latest 1,000 published events in an in-memory buffer. If the requested gap is older than the available buffer or the sequence is invalid, the server sends `system.resync_required`. The client then refetches the current data through REST.

The buffer is not stored in PostgreSQL. A backend restart clears the event sequence and replay buffer, so clients should treat REST as the source of truth for a full refresh.

## 10. Background Jobs and Concurrency

**Concurrency model diagram:** See [System Design — Concurrency Model](02-system-design.md#9-concurrency-model).

### 10.1 Job types

| Job | Trigger | Work |
|---|---|---|
| `DIAGNOSE_LINE` | A ticket is created | Runs simulated check stages, stores probe results, classifies a fault, and creates a work plan. |
| `VERIFY_SPEED` | A technician or manager requests verification | Runs simulated checks, compares measured speed to the customer plan, then resolves the ticket or returns it to work. |
| `EXPORT_REPORT` | A manager requests a CSV report | Builds the CSV in a worker thread and stores its result on the job record. |

### 10.2 Queue behavior

- Job data is written to PostgreSQL before the job is enqueued.
- A priority queue processes critical work before lower-priority work. Queue aging helps prevent old lower-priority jobs from waiting forever.
- `WORKER_CONCURRENCY` controls how many asynchronous job handlers can run in parallel in this backend process.
- Each running job uses an `AbortController`, allowing cancellation at supported checkpoints.
- Failed jobs are retried with increasing delays. After the configured attempts, the job is marked failed and a fallback or supervisor alert may be generated.
- On startup, jobs left in `RUNNING` are returned to the queue for recovery.
- On shutdown, running jobs are given an opportunity to return to the queue so a later start can recover them.

### 10.3 Ticket integrity during concurrent updates

Ticket transitions use database transactions and row locks. Tickets also have a `version` field used for optimistic concurrency checks when a client updates a ticket or assigns a technician. Technician capacity is checked within the assignment transaction. These controls help prevent two supervisors from assigning work based on the same stale state.

### 10.4 SLA scheduler

The scheduler regularly checks work-step overruns, ticket forecasts, SLA warnings and breaches, escalation, automatic closure of stale resolved tickets, and dashboard metrics. `SCHEDULER_TICK_MS` controls the interval. The scheduler avoids overlapping ticks within one backend process.

## 11. Build, Type Check, Tests, and CI

### 11.1 Backend commands

The backend tests require PostgreSQL and the separate `tixoryops_test` database. The global test setup drops and recreates the test database's `public` schema before applying migration SQL. Do not aim the test configuration at your normal development database.

```bat
cd /d "C:\projects\Ticko\backend"
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
```

### 11.2 Frontend commands

```bat
cd /d "C:\projects\Ticko\frontend"
npm ci
npm run typecheck
npm test
npm run build
```

### 11.3 CI workflow

The workflow in `.github/workflows/ci.yml` runs backend type checking, backend tests and build against PostgreSQL, then runs frontend type checking, tests and build. A Docker job builds the Compose images after the backend and frontend jobs succeed.

Run these checks locally before submission and keep the real command output. Do not claim tests passed until the commands finish successfully.

## 12. Security and Privacy Notes

- Passwords are hashed with bcrypt; the database stores password hashes, not plain passwords.
- API requests use JWT authentication and role checks. Account deactivation or password changes update the token version so old sessions become invalid.
- Zod schemas validate request bodies, path parameters, and supported query fields.
- Helmet sets standard HTTP security headers. Request logs are structured and redact the `Authorization` header.
- JSON bodies are limited to 100 KB.
- Rate limits are available for login, normal API calls, and public tracking routes. The Compose fallback disables rate limiting for demo traffic, so enable it before public deployment.
- Customer tracking output is reduced and should not expose private staff or full customer records.
- Never commit `.env`, JWTs, real customer information, database credentials, or other secrets.
- Do not use the seeded demo password for any public account.

## 13. Common Problems

| Problem | Likely cause and action |
|---|---|
| Docker engine is unavailable | Start Docker Desktop, wait for the engine, then run `docker info`. |
| `docker compose config` reports an invalid value | Check YAML indentation and any variables in the root `.env`. |
| Backend cannot connect to PostgreSQL | Check `docker compose ps`, database logs, and the `DATABASE_URL` passed to the backend. In Docker the hostname is `db`, not `localhost`. |
| `role does not exist` or password authentication fails | The database volume may have been initialized with different credentials. Changing environment variables does not modify existing PostgreSQL roles. If you can discard all Ticko database data, stop Compose and reset only this project with `docker compose down --volumes --remove-orphans`, then rebuild. |
| Frontend says it is reconnecting | Check backend logs and confirm `/readyz` responds with `{"status":"ready","db":"up"}`. |
| A port is busy | Find the process using port 5432, 4000, or 5173 before changing the mapping or stopping the process. |
| Demo login fails | Confirm the seed script completed. Check backend logs; for local development run `npm run db:seed` in `backend`. |
| Backend test setup fails | Confirm the test URL points to `tixoryops_test` and that the database exists. Remember that test setup recreates its public schema. |
| A request returns `409` or `422` | Read the error `code` and `message`; the action may conflict with a newer version or violate the ticket/work-step state rules. |

## 14. Source Files to Know

| File or folder | Why it matters |
|---|---|
| `docker-compose.yml` | Local services, ports, database credentials, and container environment. |
| `.env.example` | Example environment values. Copy to `.env` for Compose settings or to `backend/.env` for local backend development, as described above. |
| `backend/src/routes/index.ts` | REST endpoint definitions and route-level access rules. |
| `backend/src/schemas/index.ts` | Allowed request fields and validation rules. |
| `backend/src/services/` | Main business logic for tickets, assignments, steps, authentication, reports, SLA, and tracking. |
| `backend/src/domain/` | State-machine and other business rules. |
| `backend/src/queue/` | Background queue, concurrency, retries, and job handlers. |
| `backend/src/realtime/` | Event bus and WebSocket protocol. |
| `backend/prisma/schema.prisma` | Database models and relationships. |
| `backend/prisma/migrations/` | SQL migrations and additional database constraints. |
| `backend/prisma/seed.ts` | Idempotent demo/reference-data seed. |
| `frontend/src/api/` | REST client and shared API types. |
| `frontend/src/ws/` | WebSocket client and event handling. |
| `frontend/src/store/` | Shared frontend state. |
| `.github/workflows/ci.yml` | Automated checks for backend, frontend, and Docker build. |

## 15. Further Reading

- [`01-system-analysis.md`](01-system-analysis.md) - problem statement, objectives, users, scope, assumptions, and requirements.
- [`02-system-design.md`](02-system-design.md) - architecture, component diagrams, ERD, REST API design, WebSocket flow, concurrency model, and technology choices.
- [System Design diagrams](02-system-design.md) - the architecture, component, ERD, lifecycle, WebSocket, and concurrency diagrams are included in the System Design document as Mermaid diagrams; this repository does not need a separate `docs/diagrams/` image folder.
- [`../README.md`](../README.md) - project entry point and quick start.
- [`../SETUP-WINDOWS.md`](../SETUP-WINDOWS.md) - Windows-specific setup and troubleshooting.