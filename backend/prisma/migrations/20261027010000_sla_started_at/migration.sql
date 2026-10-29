-- SLA window start (reset on reopen so a reopened ticket gets a fresh SLA window)
ALTER TABLE "tickets" ADD COLUMN "sla_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
