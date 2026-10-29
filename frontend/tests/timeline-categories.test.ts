import { describe, expect, it } from 'vitest';
import { humanizeTimeline } from '../src/lib/timeline';
import { findSimilarCategory } from '../src/lib/format';

const item = (message: string | null, actor = 'Rafi Ahmed', from: string | null = null, to = 'X') => ({ message, actor, from, to });

describe('audit timeline sentences', () => {
  it('explains a finished step in plain words, with the time difference', () => {
    expect(humanizeTimeline(item('Completed: Re-test optical signal levels - estimated 10 min, actual 1 min')))
      .toBe('Rafi Ahmed finished the step “Re-test optical signal levels”. It took 1 minute, faster than the 10 minutes planned.');
    expect(humanizeTimeline(item('Completed: Fix - estimated 20 min, actual 50 min (+30 min over). Note: cable was cut')))
      .toBe('Rafi Ahmed finished the step “Fix”. It took 50 minutes, which is 30 minutes more than the 20 minutes planned. Note: cable was cut');
  });
  it('covers the common events and falls back to the original text', () => {
    expect(humanizeTimeline(item('Ticket created', 'Operator Mim'))).toBe('Operator Mim created this ticket.');
    expect(humanizeTimeline(item('Started: Run speed test'))).toBe('Rafi Ahmed started the step “Run speed test”.');
    expect(humanizeTimeline(item('Assigned to Nusrat Jahan', 'Supervisor Sabbir'))).toBe('Supervisor Sabbir gave this ticket to Nusrat Jahan.');
    expect(humanizeTimeline(item('Speed verified: 48 Mbps of 50 Mbps plan. Waiting for customer confirmation.', 'System'))).toContain('Speed test passed: 48 Mbps out of 50 Mbps');
    expect(humanizeTimeline(item('Diagnosis: LINE FAULT. Work plan generated (5 steps).', 'System'))).toContain('line fault');
    expect(humanizeTimeline(item('Something new the server says'))).toBe('Something new the server says');
    expect(humanizeTimeline(item(null, 'System', 'OPEN', 'DIAGNOSING'))).toBe('The system changed the status from open to diagnosing.');
  });
});

describe('category duplicate check', () => {
  const cats = [{ code: 'FIBER_CUT', name: 'Fiber cut' }, { code: 'OTHER', name: 'Other' }];
  it('finds the same category ignoring case, spaces and punctuation', () => {
    expect(findSimilarCategory('  fiber CUT ', cats)?.code).toBe('FIBER_CUT');
    expect(findSimilarCategory('Fiber-cut', cats)?.code).toBe('FIBER_CUT');
    expect(findSimilarCategory('Static IP', cats)).toBeUndefined();
    expect(findSimilarCategory('a', cats)).toBeUndefined();
  });
});
