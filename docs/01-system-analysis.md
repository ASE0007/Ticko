# Ticko: System Analysis

> **Real-Time ISP Service Operations Command Center**
> Version 1.0 · Step 1 of the build (analysis comes before design and code)

---

## 1. Problem Statement

A growing Internet Service Provider (ISP) handles customer complaints (slow internet, no connection, router problems, new-connection faults) **manually**: phone calls, spreadsheets, chat messages. This causes:

| Pain point | Consequence |
|---|---|
| No single place to see who is working on what | Duplicate work, forgotten tickets |
| Technician workload invisible | One technician overloaded, another idle |
| Estimates vs. reality never recorded | Plans are wrong every time, no learning |
| Delays discovered only when the customer calls again | SLA breaches, churn |
| Customer is never told what is happening | More "any update?" calls |
| Closing a ticket = technician says "done" | Problem often not really fixed, repeat complaints |

**Ticko** is a web-based platform that manages the *entire service delivery lifecycle*:
complaint → automatic diagnostics → technician assignment → step-by-step work → automatic speed verification → customer confirmation → closure, while supervisors watch everything **live**.

### What the software does and does not do

- ❌ It does **not** repair routers or raise internet speed by itself.
- ✅ It **orchestrates** the people and automated checks that do: it tracks work, predicts delays, runs background diagnostics/verification jobs, and pushes every change to all connected screens instantly.

> **"Resolved" is not "Closed".** A ticket is *Resolved* when the technician has finished **and** an automated speed test passes. It is *Closed* only after the **customer confirms** the internet is fine. If not, the ticket is **Reopened**.

---

## 2. Business Objectives (measurable)

| # | Objective | Target |
|---|---|---|
| BO-1 | Give supervisors real-time visibility of all tickets and technicians | Updates visible < 1 s after the event |
| BO-2 | Reduce SLA breaches by warning *before* they happen | Predictive "At Risk" flag, not only "Breached" |
| BO-3 | Balance technician workload | Hard cap of active tickets per technician (default 2) |
| BO-4 | Make estimates realistic over time | Record estimated vs. actual minutes for every step |
| BO-5 | Reduce false "resolved" tickets | Automated verification + customer confirmation before closure |
| BO-6 | Keep the system responsive under load | Long jobs never block API calls |
| BO-7 | Keep full accountability | Immutable audit trail of every change |

---

## 3. Users and Roles

| Role | Who | Main goals | Key permissions |
|---|---|---|---|
| **Operator** | Call-centre agent | Log complaints fast, answer "what is the status?" | Create/view tickets, cancel own tickets, record customer confirmation |
| **Supervisor** | Operations lead | Watch live board, assign work, react to delays | Everything an operator can + assign/reassign, edit work plans, cancel any ticket, view jobs & reports |
| **Technician** | Field/NOC engineer | See own tickets, run work steps | View own tickets, start/complete own steps, request verification |
| **Admin** | System owner | Configure the platform | All permissions + users, SLA policies, capacity limit |
| **Customer** *(no login)* | ISP subscriber | Know status, confirm fix | Private tracking link: view status, **Confirm fixed** / **Still broken** |

---

## 4. Core Business Concept: the Ticket Lifecycle

```
 1 Complaint        2 Auto-diagnostics     3 Assignment       4 Work steps
 (Operator)         (background job)       (Supervisor)       (Technician)
 ┌──────────┐       ┌───────────────┐      ┌────────────┐     ┌──────────────┐
 │  OPEN    │──────▶│  DIAGNOSING   │─────▶│ AWAITING   │────▶│  ASSIGNED    │
 └──────────┘       │ progress 0-100│      │ ASSIGNMENT │     │      │       │
                    └───────────────┘      └────────────┘     │      ▼       │
                                                              │ IN_PROGRESS  │
                                                              └──────┬───────┘
 7 Closure            6 Resolution            5 Auto-verify          │
 (Customer)           (System)                (background job)       │
 ┌──────────┐       ┌───────────────┐      ┌────────────────┐       │
 │  CLOSED  │◀──────│   RESOLVED    │◀─────│   VERIFYING    │◀──────┘
 └────▲─────┘       └───────────────┘ pass └───────┬────────┘
      │ confirm          │ customer says           │ fail → back to IN_PROGRESS
      │                  ▼ "still broken"
      │             ┌──────────┐
      └─────────────│ REOPENED │ → re-assigned
                    └──────────┘
```

Cancellation is allowed from any non-terminal state (`CANCELLED`).

### Why automated diagnostics and verification? (the background-processing story)

Real technicians do real work; software cannot replace that. But ISPs also run **automated remote checks** (line sync, optical signal, packet loss, speed test). Those checks take 10–60 seconds each, which is a *genuine long-running operation*. Ticko runs them as **background jobs** with live progress:

| Job | Trigger | What it does | Output |
|---|---|---|---|
| `DIAGNOSE_LINE` | Ticket created | Runs 5 check stages; classifies fault; suggests skill + work plan | Diagnosis, auto-generated work steps |
| `VERIFY_SPEED` | Technician requests verification | Runs a speed test; compares measured vs. subscribed speed | Pass → `RESOLVED`; Fail → back to `IN_PROGRESS` |
| `EXPORT_REPORT` | Supervisor requests export | CPU-heavy aggregation in a **worker thread** | Downloadable CSV |

> Network probing is **simulated** behind a `NetworkProbe` interface so a real TR-069/SNMP adapter can replace it later without touching business logic. This is stated openly as an assumption.

---

## 5. Business Rules

| ID | Rule |
|---|---|
| BR-01 | Every ticket has exactly **one primary owner** (technician). Others may be **helpers**. |
| BR-02 | A technician may have at most **N active tickets** (default `2`, configurable). Not an industry standard; our own policy. |
| BR-03 | Assigning one ticket to two owners at the same time must be impossible (transaction + optimistic locking). |
| BR-04 | A work step may depend on other steps. A step becomes **READY only when all its dependencies are DONE**. |
| BR-05 | **Estimates never auto-complete or auto-start work.** If a step exceeds its estimate it is flagged **OVERRUN**, and the technician continues. The system never kills human work. |
| BR-06 | Steps with no dependency between them may run **in parallel**, possibly by different technicians. |
| BR-07 | Overrun is **never hidden**: estimated total and actual total are always shown side by side. |
| BR-08 | SLA deadline = created time + policy minutes for the ticket priority. SLA has states `ON_TRACK → AT_RISK → WARNING → BREACHED`. |
| BR-09 | `AT_RISK` is **predictive**: forecast finish time (from remaining estimates) is later than the SLA deadline. |
| BR-10 | Priority is auto-escalated one level when SLA is `WARNING` (once per ticket). |
| BR-11 | A ticket moves to `RESOLVED` only after a **passing verification job**. |
| BR-12 | A ticket moves to `CLOSED` only by **customer confirmation** (via tracking link or operator on a call) or auto-close after a configurable silence period. |
| BR-13 | A closed/resolved ticket can be **reopened** (counter increments, priority is bumped). |
| BR-14 | Cancelling a ticket cancels its running background job (cooperative cancellation) and frees the technician's capacity. |
| BR-15 | Every status/assignment/step change creates an **audit record** (who, when, from → to, message). |
| BR-16 | Concurrent edits to the same ticket are detected via a `version` column; the losing writer receives **409 Conflict**. |

---

## 6. Assumptions

1. One ISP organisation (single tenant). Multi-tenancy is out of scope.
2. Network diagnostics/speed tests are **simulated** (see §4).
3. Customers have no accounts; they use a signed, unguessable tracking link.
4. SMS/email delivery is represented by an in-app notification log (no real gateway).
5. Technician capacity limit, SLA policies and thresholds are **configuration**, not law.
6. Working hours/shift calendars are ignored in v1 (SLA runs 24×7).
7. A **demo time-scale** setting can accelerate simulated time so SLA/overrun behaviour can be shown in minutes.
8. Single backend instance for v1. The design notes how to scale horizontally (see design doc).
9. All timestamps stored in UTC.

---

## 7. Scope

### In scope
Authentication & RBAC · ticket lifecycle · technician assignment & workload · work steps with dependencies · estimated vs. actual tracking · forecast & SLA engine · priority queue + worker pool · cancellation & crash recovery · WebSocket live updates · live dashboard (Kanban, timeline, worker panel) · customer tracking page · search/filter · audit trail · reports/export · Docker · tests · CI · structured logging.

### Out of scope (v1)
Real network integration · billing · real SMS/email · mobile native apps · multi-tenant · shift scheduling · geo-routing of technicians.

---

## 8. Functional Requirements

Priority: **M** = Must (assignment-mandatory or core), **S** = Should, **C** = Could (bonus).

### 8.1 Authentication & Authorization
| ID | Requirement | P |
|---|---|---|
| FR-01 | Users log in with email + password and receive a JWT | M |
| FR-02 | Role-based access control (Operator, Supervisor, Technician, Admin) enforced on every endpoint | M |
| FR-03 | Passwords stored as salted hashes; login attempts rate-limited | S |
| FR-04 | Admin can create/disable users | S |

### 8.2 Ticket Management
| ID | Requirement | P |
|---|---|---|
| FR-05 | Create ticket (customer, contact, address, category, description, priority, subscribed speed) with server-side validation | M |
| FR-06 | View ticket list with pagination | M |
| FR-07 | View ticket detail: info, steps, assignment, jobs, timeline, forecast | M |
| FR-08 | Edit ticket details with optimistic-lock conflict detection | M |
| FR-09 | Cancel ticket (with reason); cancels running job | M |
| FR-10 | Search by text (customer, phone, ticket no., description) | M |
| FR-11 | Filter by status, priority, category, technician, SLA state, date range; sort | M |
| FR-12 | Reopen a resolved/closed ticket with reason | S |
| FR-13 | Customer confirmation closes ticket (operator or tracking link) | S |

### 8.3 Technician Assignment
| ID | Requirement | P |
|---|---|---|
| FR-14 | Supervisor assigns a primary technician manually | M |
| FR-15 | System **suggests** technicians ranked by skill match, current load, availability | S |
| FR-16 | Assignment rejected if technician is at capacity or unavailable (409) | M |
| FR-17 | Double assignment impossible under concurrent requests | M |
| FR-18 | Supervisor can reassign; old owner's capacity is released | S |
| FR-19 | Helper technicians can be attached to a ticket | C |
| FR-20 | Technician availability toggle (Available / Busy / Off-duty) | S |

### 8.4 Work Steps (estimated vs. actual)
| ID | Requirement | P |
|---|---|---|
| FR-21 | A ticket has an ordered set of work steps with `estimated_minutes`, `actual_minutes`, `started_at`, `completed_at`, status | M |
| FR-22 | Steps can depend on other steps; locked steps cannot start | M |
| FR-23 | Independent steps can run in parallel, each with its own assignee | S |
| FR-24 | Step exceeding its estimate is flagged **OVERRUN** live (and again at 1.5× and 2×) | M |
| FR-25 | Ticket shows estimated total vs. actual total | M |
| FR-26 | Forecast engine recalculates projected finish time on every step event | S |
| FR-27 | Work plan auto-generated from diagnosis result (template) | S |
| FR-28 | Supervisor can add, edit, skip steps | S |

### 8.5 Background Processing
| ID | Requirement | P |
|---|---|---|
| FR-29 | Diagnostics and verification run as background jobs; API returns immediately | M |
| FR-30 | Jobs are processed by a **worker pool** with configurable concurrency | M |
| FR-31 | Jobs are ordered by priority (critical first), FIFO within a priority | M |
| FR-32 | Job progress (0–100 % + stage name) is pushed live | M |
| FR-33 | Running jobs can be cancelled cooperatively | M |
| FR-34 | Failed jobs retry with back-off, then become FAILED and alert supervisors | S |
| FR-35 | After a server restart, unfinished jobs are recovered from the database | S |
| FR-36 | Report export runs in a **worker thread** | C |

### 8.6 Real-Time
| ID | Requirement | P |
|---|---|---|
| FR-37 | All state changes are pushed via **WebSocket**; polling is not used for updates | M |
| FR-38 | WebSocket connections are authenticated; events are routed to the right audience (staff / technician / customer) | M |
| FR-39 | Client auto-reconnects with back-off and **resyncs missed events** | S |
| FR-40 | Connection status and online-user presence are shown | C |

### 8.7 SLA
| ID | Requirement | P |
|---|---|---|
| FR-41 | SLA policy per priority (configurable by Admin) | M |
| FR-42 | Live SLA countdown on every open ticket | M |
| FR-43 | SLA states ON_TRACK / AT_RISK / WARNING / BREACHED pushed live | M |
| FR-44 | Auto-escalation of priority on WARNING | S |

### 8.8 Dashboard, Customer View, Reports
| ID | Requirement | P |
|---|---|---|
| FR-45 | Live Kanban board of tickets by status with animated transitions | M |
| FR-46 | Technician panel: load meter, current tickets, status | M |
| FR-47 | System panel: queue length, active workers, jobs/min, SLA breaches | S |
| FR-48 | Ticket timeline (audit) and step Gantt (planned vs. actual) | S |
| FR-49 | Public customer tracking page (live) with Confirm / Still broken | S |
| FR-50 | Summary report (avg resolution time, SLA compliance, estimate accuracy) + CSV export | C |

### 8.9 Administration, accounts and reporting (added in iteration 2)
| ID | Requirement | P |
|---|---|---|
| FR-51 | Every technician/operator/supervisor/admin has an **individual e-mail + password** | M |
| FR-52 | Admin can create users (incl. technicians with skills and capacity), edit name/e-mail/role, **set a new password**, and disable accounts | M |
| FR-53 | Password reset / disable ends the person's sessions **immediately** (REST and WebSocket) | S |
| FR-54 | Protection rules: no self-lockout, at least one active admin, no disabling a technician with active tickets | S |
| FR-55 | Any user can change their own password | S |
| FR-56 | Ticket **categories are configurable data**: managers add/rename/disable categories, each with a default priority and a work-plan template | M |
| FR-57 | New-ticket form lists current categories and lets managers add one inline | S |
| FR-58 | When adding/editing a step the user chooses **when it may start**: in parallel, after chosen steps, or inserted into the chain after step N (waiting steps are re-routed); cycles refused | M |
| FR-59 | **Technician day report**: every step done with start/finish time, estimated vs actual, overrun, note; tickets assigned/resolved; active vs idle time; timeline; CSV/print | M |
| FR-60 | Supervisor/admin **team day report**; technician sees only their own | M |
| FR-61 | Command Center shows live field-team status, a ranked "needs attention" list, throughput and workers | S |

---

## 9. Non-Functional Requirements

| ID | Category | Requirement | Target / justification |
|---|---|---|---|
| NFR-01 | **Performance** | Typical API response (non-job) | p95 < 200 ms at 50 rps; supervisors need a snappy UI |
| NFR-02 | **Performance** | WebSocket event delivery | < 1 s end-to-end (real-time requirement) |
| NFR-03 | **Concurrency** | Long jobs must not block API | Worker pool is separate from the HTTP request cycle |
| NFR-04 | **Scalability** | Support ≥ 500 open tickets, 100 concurrent WS clients | Indexes on hot filters; in-memory room routing; design allows Redis Pub/Sub later |
| NFR-05 | **Reliability** | No lost work after crash/restart | Jobs persisted before enqueue; startup recovery |
| NFR-06 | **Data integrity** | No double assignment, no lost update | DB transactions, conditional updates, optimistic locking |
| NFR-07 | **Security** | AuthN/AuthZ, hashed passwords, input validation, rate-limit, CORS, security headers | Protects customer personal data (phone, address) |
| NFR-08 | **Security** | Customer tracking token unguessable (≥ 128-bit random) and revocable | No customer login but still private |
| NFR-09 | **Availability** | Health & readiness endpoints; graceful shutdown | Container orchestration friendly |
| NFR-10 | **Maintainability** | Layered architecture, strict typing, lint, tests | Controllers → services → repositories |
| NFR-11 | **Observability** | Structured JSON logs with request IDs; metrics endpoint | Faster debugging |
| NFR-12 | **Usability** | Clear status colours, inline validation, keyboard-friendly, helpful empty states | Operators work under pressure |
| NFR-13 | **Responsiveness** | Works at 360 px → 1920 px | Supervisors may use tablets |
| NFR-14 | **Accessibility** | Contrast-safe colours, ARIA labels, `prefers-reduced-motion` respected | Animations must not harm usability |
| NFR-15 | **Portability** | One command start (`docker compose up`) | Easy evaluation |
| NFR-16 | **Testability** | Clock abstraction + probe interface | Deterministic tests of time-based logic |

---

## 10. Worked Scenario (answers "what if Task 1 takes 50 min instead of 20?")

Ticket **TX-1042**: *"Internet very slow"*, plan speed 50 Mbps.

| Step | Depends on | Estimate | Actual | Notes |
|---|---|---|---|---|
| S1 Check router & connection | none | 20 min | **50 min** | Unexpected router config issue |
| S2 Run speed test | S1 | 5 min | 5 min | Locked until S1 is DONE |
| S3 Verify result & update customer | S2 | 5 min | 5 min | |

**Timeline of system behaviour**

| Time | What the system does |
|---|---|
| 0:00 | S1 starts. S2, S3 are `LOCKED`. Forecast finish = 0:30 |
| 0:20 | Estimate reached → S1 flagged **OVERRUN** (amber). Technician keeps working. S2 does **not** start. |
| 0:20 | Forecast re-calculated: finish = 0:20 + minimum remaining for S1 + 5 + 5 → pushed live |
| 0:30 | Forecast finish passes the planned finish; if it passes the SLA deadline, ticket becomes **AT_RISK** |
| 0:30 (1.5×) | Supervisor alert: *"S1 is 50 % over estimate"* |
| 0:40 (2×) | Suggestion: *add helper / reassign* |
| 0:50 | Technician completes S1 → `actual_minutes = 50`. S2 becomes `READY`, then runs. |
| 1:00 | S3 done. **Estimated total 30 min, Actual total 60 min**, +100 %. Stored for estimate-accuracy report. |

**Key principle:** the *dependency* (S1 DONE) starts S2, never the *clock*. The clock only decides **warnings and forecasts**.

**If S2 and a new step "Check Wi-Fi interference" were independent**, they could run **in parallel** with different technicians, and S3 would wait for both.

---

## 11. Multiple People Serving at the Same Time

Two different things are involved:

| Concern | Who/what | How Ticko handles it |
|---|---|---|
| **Many humans** serving many customers | Technicians A, B, C | One primary owner per ticket, capacity cap, live workload board, parallel steps |
| **Many requests processed by software at once** | Worker pool in backend | Priority queue + N async workers + worker thread; API never blocked |

Safety under simultaneous actions:
- Two supervisors click "assign" on the same ticket → a database transaction with a conditional update lets **one** win; the other gets **409 Conflict** with a clear message.
- Two users edit the same ticket → `version` mismatch → **409**.
- Technician at capacity → atomic `UPDATE … WHERE active_tickets < max` fails → **409**.

---

## 12. Traceability to the Assignment

| Assignment requirement | Where it is satisfied |
|---|---|
| RESTful API | §FR-05…FR-50, design doc §7 |
| Database design & integration | Design doc §6 |
| Input validation / error handling | NFR-07, Zod schemas, central error handler |
| Layered architecture / configuration | NFR-10, env config module |
| Responsive UI, API integration, form validation, state management | FR-45…49, NFR-12/13 |
| **WebSockets (mandatory)** | FR-37…40 |
| **Concurrency (mandatory)** | FR-29…36, FR-17 |
| Git, structure, docs | Build plan, README |
| Bonus: tests, auth, RBAC, Docker, CI/CD, logging, caching, advanced search | NFR-11/15/16, FR-02, FR-11 |

---

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Scope too large | MoSCoW priorities; Musts first, then Shoulds, Coulds last |
| Real-time bugs (missed events) | Sequence numbers + resync on reconnect |
| Time-based logic hard to test/demo | Injectable `Clock` + `DEMO_TIME_SCALE` |
| In-process queue lost on crash | Jobs persisted in DB, recovered at boot |
| Evaluator confusion about "simulated" diagnostics | Documented upfront; adapter interface |
