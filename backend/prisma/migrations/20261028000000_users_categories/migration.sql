-- 1) Session invalidation: bump token_version to log a user out everywhere (password reset)
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 1;

-- 2) Categories become DATA (admin can add new ones) instead of a fixed enum
CREATE TABLE "categories" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "plan_template" "Diagnosis" NOT NULL DEFAULT 'UNKNOWN',
    "default_priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("code")
);
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

INSERT INTO "categories" ("code","name","description","plan_template","default_priority","builtin","sort_order") VALUES
 ('SLOW_SPEED',     'Slow speed',     'Internet works but is much slower than the plan', 'UNKNOWN',      'MEDIUM', true, 1),
 ('NO_CONNECTION',  'No connection',  'No internet at all (LOS, link down)',             'LINE_FAULT',   'HIGH',   true, 2),
 ('ROUTER_ISSUE',   'Router issue',   'Router reboots, Wi-Fi drops, configuration',      'ROUTER_CONFIG','MEDIUM', true, 3),
 ('NEW_CONNECTION', 'New connection', 'Newly installed service not working',             'PROVISIONING', 'MEDIUM', true, 4),
 ('BILLING_LINK',   'Billing link',   'Service blocked or limited because of billing',   'PROVISIONING', 'LOW',    true, 5),
 ('OTHER',          'Other',          'Anything else',                                   'UNKNOWN',      'LOW',    true, 6);

ALTER TABLE "tickets" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_fkey" FOREIGN KEY ("category") REFERENCES "categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tickets_category_idx" ON "tickets"("category");
DROP TYPE "Category";
