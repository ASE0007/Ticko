# Ticko — Real-Time ISP Service Request Management

Ticko is a web application for managing ISP service requests from the first customer report to the final confirmation. Operators create tickets, supervisors assign work, technicians complete work steps, and customers can check the status through a tracking link.

> **Scope note:** Network diagnosis and speed verification are simulated in this coursework version. Ticko does not connect to or repair real routers.

## Main features

- Create, assign, search, filter, update, cancel, reopen, and close tickets.
- Store customers, technicians, work steps, job records, SLA policies, and ticket history in PostgreSQL.
- Recommend technicians using skills, availability, and workload.
- Track work-step dependencies, progress, and estimated time.
- Show SLA deadlines, warnings, and dashboard/report data.
- Push ticket, step, job, and SLA updates to connected browsers through WebSockets.
- Run long jobs in the background with a priority queue, concurrency limit, retries, and cancellation.
- Support Admin, Supervisor, Operator, Technician, and limited customer tracking access.
- Export reports to CSV and view technician/team reports.

## Technology stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Zustand
- **Backend:** Node.js, TypeScript, Express, Zod
- **Database:** PostgreSQL with Prisma
- **Real-time:** WebSocket (`ws`)
- **Background work:** Async job queue and Node.js worker threads for report export
- **Testing:** Vitest, Supertest, Testing Library
- **Local runtime:** Docker Compose and Nginx

## Quick start (Windows + Docker)

1. Install Docker Desktop and wait until its engine is running.
2. Extract the project and open CMD in the folder that contains `docker-compose.yml`.
3. Create the local environment file if it does not exist:

   ```bat
   if not exist .env copy .env.example .env
   ```

4. Check the Compose configuration and start the application:

   ```bat
   docker compose config
   docker compose up --build
   ```

5. Open the web app at **http://localhost:5173**.

Keep the terminal running while using Ticko. To stop the services, press `Ctrl+C`, then run `docker compose down` in the project folder. This keeps the database volume.

For the full Windows guide, see [SETUP-WINDOWS.md](SETUP-WINDOWS.md).

## Demo accounts

The seed script creates demo users and supporting data. Seeded accounts use the demo password `Passw0rd!`.

| Role | Email |
|---|---|
| Admin | `admin@tixory.test` |
| Supervisor | `supervisor@tixory.test` |
| Operator | `operator1@tixory.test` or `operator2@tixory.test` |
| Technician | `rafi@tixory.test`, `nusrat@tixory.test`, `imran@tixory.test`, or `sadia@tixory.test` |

Demo accounts are for local coursework only. Change or remove them before any public deployment. Do not use the sample secrets or database credentials in a public environment.

## Repository guide

- `backend/` — REST API, business logic, database access, job queue, WebSocket server, and tests.
- `frontend/` — React pages, UI components, API client, state, WebSocket client, and tests.
- `backend/prisma/` — database schema, migrations, and seed script.
- [System Analysis](docs/01-system-analysis.md) — problem, objectives, users, scope, assumptions, and functional/non-functional requirements.
- [System Design](docs/02-system-design.md) — architecture, component design, ERD, API design, WebSocket flow, concurrency model, and technology choices.
- [Technical Documentation](docs/03-technical-documentation.md) — setup, environment variables, database, REST API reference, WebSocket events, background jobs, testing, security, and troubleshooting.
- [Windows Setup Guide](SETUP-WINDOWS.md) — Windows CMD setup and troubleshooting.

The architecture, component, ERD, workflow, WebSocket, and concurrency diagrams are included as Mermaid diagrams in [docs/02-system-design.md](docs/02-system-design.md). There is no separate `docs/diagrams/` image folder in this repository.

## Database and environment

Docker Compose starts PostgreSQL and configures the application to connect to the database service named `db`. For container-to-container connections, use the service hostname rather than `localhost`.

The root `.env` file is used by Docker Compose. It is local configuration and must not be committed. Keep `.env.example` with placeholder/sample values so another developer can set up their own environment.

The main database models are `User`, `Technician`, `Customer`, `Category`, `Ticket`, `TicketAssignment`, `WorkStep`, `StepDependency`, `StatusHistory`, `Job`, `ProbeResult`, and `SlaPolicy`. Schema, migration and seed files are stored under `backend/prisma/`. See the [System Design](docs/02-system-design.md) and [Technical Documentation](docs/03-technical-documentation.md) for schema relationships and database setup steps.

## API documentation

The REST API base path is `/api`. Requests use JSON unless an export endpoint returns CSV. Authenticated endpoints use `Authorization: Bearer <JWT>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Sign in and receive a JWT. |
| `GET` | `/api/auth/me` | Get the signed-in user's profile. |
| `POST` | `/api/tickets` | Create a ticket and queue diagnostics. |
| `GET` | `/api/tickets` | List and filter tickets. |
| `GET` | `/api/tickets/:id` | Read ticket details. |
| `POST` | `/api/tickets/:id/assign` | Assign a technician. |
| `POST` | `/api/tickets/:id/request-verification` | Queue speed verification. |
| `GET` | `/api/jobs` | View background jobs (manager roles). |
| `GET` | `/api/reports/summary` | Read report summary (manager roles). |
| `GET` | `/api/public/track/:token` | Read a customer-safe tracking view. |
| `GET` | `/healthz` | Backend liveness check. |
| `GET` | `/readyz` | Backend/database readiness check. |

For the full endpoint inventory, permissions, request validation notes, response/error shapes, and status codes, see [Technical Documentation §8](docs/03-technical-documentation.md#8-rest-api-reference) and `backend/src/routes/index.ts`.

## WebSocket events

The browser connects to `/ws` through the same host as the frontend. With the local Docker Compose setup, the browser uses `ws://localhost:5173/ws`. Staff sockets authenticate with a JWT; customer tracking sockets use the ticket's tracking token.

Main event families include:

- Tickets: `ticket.created`, `ticket.updated`, `ticket.status_changed`, `ticket.assigned`, `ticket.cancelled`, `ticket.closed`, `ticket.reopened`.
- Work steps and forecasts: `step.updated`, `step.unlocked`, `step.overrun`, `forecast.updated`.
- Jobs: `job.queued`, `job.started`, `job.progress`, `job.retrying`, `job.completed`, `job.failed`, `job.cancelled`, `job.alert`.
- SLA and dashboard: `sla.at_risk`, `sla.warning`, `sla.breached`, `technician.updated`, `metrics.updated`, `presence.updated`.
- Connection control: `system.hello`, `system.resumed`, `system.resync_required`, `system.error`, and `pong`.

The client reconnects and requests replay of missed events. The backend stores the replay buffer in memory only; after a large event gap or backend restart, the client may need to reload current state through REST. See [Technical Documentation §9](docs/03-technical-documentation.md#9-websocket-protocol) for message examples, authentication, rooms, event envelopes, and reconnect behavior.

## Build, tests, and CI

Backend tests require a dedicated PostgreSQL test database named `tixoryops_test`. The test setup recreates that database's `public` schema. **Never point test configuration at a database containing data you need to preserve.**

Backend commands:

```bat
cd /d "C:\projects\Ticko\backend"
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
```

Frontend commands:

```bat
cd /d "C:\projects\Ticko\frontend"
npm ci
npm run typecheck
npm test
npm run build
```

The GitHub Actions workflow is [.github/workflows/ci.yml](.github/workflows/ci.yml). It runs backend and frontend type checks, automated tests and builds, then builds the Docker Compose images. Use the actual test output and CI status when reporting results; the presence of test files alone does not prove every test passed.

## Important limitations and security

- ISP line diagnostics and speed checks use a simulated probe; no real router, SNMP, TR-069, or ISP monitoring integration is included.
- The event bus, WebSocket replay buffer, SLA scheduler, and job dispatcher run inside one backend process. Multiple backend instances would require shared event/replay infrastructure and safe distributed job claiming.
- The Compose defaults are intended for local coursework. Before any public exposure, use a strong secret, turn demo overrides off, enable rate limiting, restrict CORS origins, replace demo credentials, and do not expose PostgreSQL publicly.
- Do not commit `.env`, passwords, tokens, real customer details, `node_modules/`, build output, or database files.
- Cloud hosting is separate from local Docker Compose. Running this project locally does not automatically create a public website.

## Assignment documents

The assignment documentation is organised as follows:

1. [System Analysis](docs/01-system-analysis.md)
2. [System Design](docs/02-system-design.md)
3. [Technical Documentation](docs/03-technical-documentation.md)

Do not include `.env`, real secrets, `node_modules/`, `dist/`, coverage reports, database dumps, or generated build output in a source submission.
