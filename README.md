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
- `docs/01-system-analysis.md` — problem, scope, users, and requirements.
- `docs/02-system-design.md` — architecture, ERD, API, WebSocket, and concurrency design.
- `docs/03-technical-documentation.md` — setup, configuration, routes, events, testing, and troubleshooting.

The diagrams used by the Markdown documents are stored in `docs/diagrams/`.

## Database and environment

Docker Compose starts PostgreSQL and configures the application to connect to the database service named `db`. For container-to-container connections, use the service hostname rather than `localhost`.

The root `.env` file is used by Docker Compose. It is local configuration and must not be committed. Keep `.env.example` with placeholder/sample values so another developer can set up their own environment.

## Development and tests

For local development with hot reload, install Node.js 20 or newer and follow [SETUP-WINDOWS.md](SETUP-WINDOWS.md). Backend and frontend tests are located in their respective `tests/` folders. Run the test commands defined by each package's `package.json`.

## Important limitations

- ISP line diagnostics and speed checks use a simulated probe.
- The event bus and replay buffer are in the backend process; a multi-instance deployment would need shared messaging and replay storage.
- Free hosting services may sleep or have resource limits. Verify the deployed application and database before sharing a live link.

## Assignment documents

See the files under `docs/` for System Analysis, System Design, and Technical Documentation. If you prepare a submission ZIP, do not include `.env`, passwords, tokens, `node_modules/`, or generated build output.
