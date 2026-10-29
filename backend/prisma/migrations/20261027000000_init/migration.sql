-- ============================================================================
-- Ticko initial migration
-- Part A: tables, enums, indexes, foreign keys (equivalent to prisma schema)
-- Part B: hand-written integrity layer Prisma cannot express
--         (CHECK constraints, partial unique indexes, trigram search, sequence)
-- ============================================================================

-- ─────────────────────────── Part A ───────────────────────────

CREATE TYPE "Role" AS ENUM ('OPERATOR', 'SUPERVISOR', 'TECHNICIAN', 'ADMIN');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'DIAGNOSING', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'VERIFYING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED');
CREATE TYPE "Category" AS ENUM ('SLOW_SPEED', 'NO_CONNECTION', 'ROUTER_ISSUE', 'NEW_CONNECTION', 'BILLING_LINK', 'OTHER');
CREATE TYPE "Diagnosis" AS ENUM ('LINE_FAULT', 'ROUTER_CONFIG', 'CONGESTION', 'PROVISIONING', 'UNKNOWN');
CREATE TYPE "Skill" AS ENUM ('NETWORK', 'ROUTER', 'FIBER', 'WIFI', 'GENERAL');
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'BUSY', 'OFF_DUTY');
CREATE TYPE "SlaState" AS ENUM ('ON_TRACK', 'AT_RISK', 'WARNING', 'BREACHED');
CREATE TYPE "StepStatus" AS ENUM ('LOCKED', 'READY', 'IN_PROGRESS', 'DONE', 'SKIPPED');
CREATE TYPE "AssignmentRole" AS ENUM ('PRIMARY', 'HELPER');
CREATE TYPE "JobType" AS ENUM ('DIAGNOSE_LINE', 'VERIFY_SPEED', 'EXPORT_REPORT');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "HistoryEntity" AS ENUM ('TICKET', 'STEP', 'ASSIGNMENT', 'JOB', 'SYSTEM');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "technicians" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "skills" "Skill"[],
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "active_tickets" INTEGER NOT NULL DEFAULT 0,
    "max_active" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "account_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "area" TEXT,
    "plan_mbps" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "technician_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "priority" "Priority" NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "diagnosis" "Diagnosis",
    "sla_state" "SlaState" NOT NULL DEFAULT 'ON_TRACK',
    "sla_deadline" TIMESTAMP(3) NOT NULL,
    "forecast_finish" TIMESTAMP(3),
    "estimated_total_min" INTEGER NOT NULL DEFAULT 0,
    "actual_total_min" INTEGER NOT NULL DEFAULT 0,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "track_token" TEXT NOT NULL,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_assignments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "role" "AssignmentRole" NOT NULL DEFAULT 'PRIMARY',
    "assigned_by" UUID NOT NULL,
    "note" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_steps" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required_skill" "Skill",
    "status" "StepStatus" NOT NULL DEFAULT 'READY',
    "estimated_minutes" INTEGER NOT NULL,
    "actual_minutes" INTEGER,
    "assignee_id" UUID,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_overrun_level" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "step_dependencies" (
    "step_id" UUID NOT NULL,
    "depends_on_id" UUID NOT NULL,
    CONSTRAINT "step_dependencies_pkey" PRIMARY KEY ("step_id", "depends_on_id")
);

CREATE TABLE "status_history" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "entity" "HistoryEntity" NOT NULL,
    "entity_id" UUID,
    "from_value" TEXT,
    "to_value" TEXT NOT NULL,
    "message" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "ticket_id" UUID,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority_rank" INTEGER NOT NULL DEFAULT 2,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "requested_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "probe_results" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "check_name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "probe_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_policies" (
    "priority" "Priority" NOT NULL,
    "resolution_minutes" INTEGER NOT NULL,
    "warning_pct" INTEGER NOT NULL DEFAULT 75,
    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("priority")
);

-- Indexes
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "technicians_user_id_key" ON "technicians"("user_id");
CREATE UNIQUE INDEX "customers_account_no_key" ON "customers"("account_no");
CREATE INDEX "customers_phone_idx" ON "customers"("phone");
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");
CREATE UNIQUE INDEX "tickets_track_token_key" ON "tickets"("track_token");
CREATE INDEX "tickets_status_idx" ON "tickets"("status");
CREATE INDEX "tickets_priority_created_at_idx" ON "tickets"("priority", "created_at");
CREATE INDEX "tickets_technician_id_idx" ON "tickets"("technician_id");
CREATE INDEX "tickets_customer_id_idx" ON "tickets"("customer_id");
CREATE INDEX "tickets_sla_state_idx" ON "tickets"("sla_state");
CREATE INDEX "ticket_assignments_ticket_id_idx" ON "ticket_assignments"("ticket_id");
CREATE INDEX "ticket_assignments_technician_id_idx" ON "ticket_assignments"("technician_id");
CREATE UNIQUE INDEX "work_steps_ticket_id_seq_key" ON "work_steps"("ticket_id", "seq");
CREATE INDEX "work_steps_status_idx" ON "work_steps"("status");
CREATE INDEX "work_steps_assignee_id_idx" ON "work_steps"("assignee_id");
CREATE INDEX "step_dependencies_depends_on_id_idx" ON "step_dependencies"("depends_on_id");
CREATE INDEX "status_history_ticket_id_created_at_idx" ON "status_history"("ticket_id", "created_at");
CREATE INDEX "jobs_status_priority_rank_created_at_idx" ON "jobs"("status", "priority_rank", "created_at");
CREATE INDEX "jobs_ticket_id_idx" ON "jobs"("ticket_id");
CREATE INDEX "probe_results_job_id_idx" ON "probe_results"("job_id");

-- Foreign keys (RESTRICT protects the audit trail; CASCADE only for owned child rows)
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_steps" ADD CONSTRAINT "work_steps_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_steps" ADD CONSTRAINT "work_steps_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "work_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "work_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "probe_results" ADD CONSTRAINT "probe_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Part B ───────────────────────────
-- Integrity rules enforced by the database itself (last line of defence).

-- Human-friendly ticket numbers start at TX-1001
ALTER SEQUENCE "tickets_number_seq" RESTART WITH 1001;

-- BR-02: capacity can never go negative or exceed the cap, even if app code has a bug
ALTER TABLE "technicians" ADD CONSTRAINT "chk_technicians_capacity"
  CHECK ("max_active" >= 1 AND "active_tickets" >= 0 AND "active_tickets" <= "max_active");

ALTER TABLE "customers" ADD CONSTRAINT "chk_customers_plan" CHECK ("plan_mbps" > 0);

ALTER TABLE "tickets" ADD CONSTRAINT "chk_tickets_progress" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "tickets" ADD CONSTRAINT "chk_tickets_counters"
  CHECK ("estimated_total_min" >= 0 AND "actual_total_min" >= 0 AND "reopen_count" >= 0 AND "version" >= 1);

ALTER TABLE "work_steps" ADD CONSTRAINT "chk_steps_estimate" CHECK ("estimated_minutes" > 0);
ALTER TABLE "work_steps" ADD CONSTRAINT "chk_steps_actual" CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0);
ALTER TABLE "work_steps" ADD CONSTRAINT "chk_steps_overrun_level" CHECK ("last_overrun_level" BETWEEN 0 AND 3);
-- A step cannot be running without a start time, nor done without completion data
ALTER TABLE "work_steps" ADD CONSTRAINT "chk_steps_state_data" CHECK (
  ("status" <> 'IN_PROGRESS' OR "started_at" IS NOT NULL) AND
  ("status" <> 'DONE' OR ("completed_at" IS NOT NULL AND "actual_minutes" IS NOT NULL))
);

ALTER TABLE "step_dependencies" ADD CONSTRAINT "chk_step_not_self_dependent" CHECK ("step_id" <> "depends_on_id");

ALTER TABLE "jobs" ADD CONSTRAINT "chk_jobs_progress" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "jobs" ADD CONSTRAINT "chk_jobs_rank" CHECK ("priority_rank" BETWEEN 0 AND 3);
ALTER TABLE "jobs" ADD CONSTRAINT "chk_jobs_attempts" CHECK ("attempts" >= 0 AND "max_attempts" >= 1);

ALTER TABLE "sla_policies" ADD CONSTRAINT "chk_sla_policy"
  CHECK ("resolution_minutes" > 0 AND "warning_pct" BETWEEN 1 AND 99);

-- BR-01 / BR-03: at most ONE active primary owner per ticket (double-assign guard)
CREATE UNIQUE INDEX "ux_assignments_one_active_primary"
  ON "ticket_assignments"("ticket_id")
  WHERE "role" = 'PRIMARY' AND "released_at" IS NULL;

-- Idempotency: only one queued/running job of a type per ticket
CREATE UNIQUE INDEX "ux_jobs_one_active_per_ticket_type"
  ON "jobs"("ticket_id", "type")
  WHERE "status" IN ('QUEUED', 'RUNNING') AND "ticket_id" IS NOT NULL;

-- SLA scanner only looks at open tickets
CREATE INDEX "ix_tickets_open_sla_deadline"
  ON "tickets"("sla_deadline")
  WHERE "status" NOT IN ('CLOSED', 'CANCELLED');

-- Fast substring search (FR-10)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "ix_tickets_title_trgm" ON "tickets" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ix_tickets_description_trgm" ON "tickets" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "ix_customers_name_trgm" ON "customers" USING GIN ("name" gin_trgm_ops);
