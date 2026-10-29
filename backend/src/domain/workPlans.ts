import type { Diagnosis, Skill } from '@prisma/client';

export interface PlanStep {
  title: string;
  estimatedMinutes: number;
  skill: Skill;
  /** zero-based indexes of steps (in this plan) that must finish first */
  dependsOn: number[];
}

/**
 * Work plan templates generated from the automatic diagnosis (FR-27).
 * Independent steps (no shared dependency) can run in parallel by different technicians.
 */
export const WORK_PLANS: Record<Diagnosis, PlanStep[]> = {
  ROUTER_CONFIG: [
    { title: 'Check router & connection', estimatedMinutes: 20, skill: 'ROUTER', dependsOn: [] },
    { title: 'Check Wi-Fi interference', estimatedMinutes: 15, skill: 'WIFI', dependsOn: [] },
    { title: 'Apply configuration fix', estimatedMinutes: 15, skill: 'ROUTER', dependsOn: [0, 1] },
    { title: 'Run speed test', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [2] },
    { title: 'Verify result & update customer', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [3] },
  ],
  LINE_FAULT: [
    { title: 'Inspect fiber line & ONT', estimatedMinutes: 25, skill: 'FIBER', dependsOn: [] },
    { title: 'Repair or replace faulty segment', estimatedMinutes: 40, skill: 'FIBER', dependsOn: [0] },
    { title: 'Re-test optical signal levels', estimatedMinutes: 10, skill: 'NETWORK', dependsOn: [1] },
    { title: 'Run speed test', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [2] },
    { title: 'Verify result & update customer', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [3] },
  ],
  CONGESTION: [
    { title: 'Check node utilisation', estimatedMinutes: 15, skill: 'NETWORK', dependsOn: [] },
    { title: 'Rebalance traffic / QoS profile', estimatedMinutes: 20, skill: 'NETWORK', dependsOn: [0] },
    { title: 'Run speed test', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [1] },
    { title: 'Verify result & update customer', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [2] },
  ],
  PROVISIONING: [
    { title: 'Verify account provisioning', estimatedMinutes: 10, skill: 'GENERAL', dependsOn: [] },
    { title: 'Re-provision service profile', estimatedMinutes: 15, skill: 'NETWORK', dependsOn: [0] },
    { title: 'Test connection', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [1] },
    { title: 'Verify result & update customer', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [2] },
  ],
  UNKNOWN: [
    { title: 'Initial on-site inspection', estimatedMinutes: 30, skill: 'GENERAL', dependsOn: [] },
    { title: 'Isolate the fault', estimatedMinutes: 20, skill: 'NETWORK', dependsOn: [0] },
    { title: 'Run speed test', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [1] },
    { title: 'Verify result & update customer', estimatedMinutes: 5, skill: 'GENERAL', dependsOn: [2] },
  ],
};

/** Skills worth preferring when suggesting a technician for a diagnosis. */
export const DIAGNOSIS_SKILLS: Record<Diagnosis, Skill[]> = {
  ROUTER_CONFIG: ['ROUTER', 'WIFI'],
  LINE_FAULT: ['FIBER', 'NETWORK'],
  CONGESTION: ['NETWORK'],
  PROVISIONING: ['NETWORK', 'GENERAL'],
  UNKNOWN: ['GENERAL', 'NETWORK'],
};
