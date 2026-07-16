import { describe, it, expect } from 'vitest';
import { autoName } from '../account';

const PEOPLE = [
  { id: 'p1', name: 'Avery S' },
  { id: 'p2', name: 'Jordan S' },
];

describe('autoName', () => {
  it('joins a single owner with institution and account type', () => {
    expect(autoName(['p1'], 'Blueleaf', 'TFSA', PEOPLE)).toBe('Avery S Blueleaf TFSA');
  });

  it('comma-joins owners sorted by id, regardless of selection order', () => {
    // Matches the backend, which reads owners in sorted-id order — the preview
    // must show exactly what will be persisted.
    const expected = 'Avery S, Jordan S Blueleaf TFSA'; // p1 < p2
    expect(autoName(['p1', 'p2'], 'Blueleaf', 'TFSA', PEOPLE)).toBe(expected);
    expect(autoName(['p2', 'p1'], 'Blueleaf', 'TFSA', PEOPLE)).toBe(expected);
  });

  it('drops missing institution and type without leaving stray spaces', () => {
    expect(autoName(['p1'], '', '', PEOPLE)).toBe('Avery S');
    expect(autoName(['p1'], '', 'RRSP', PEOPLE)).toBe('Avery S RRSP');
  });

  it('ignores owner ids that do not resolve to a person', () => {
    expect(autoName(['nope'], 'TD', 'RESP', PEOPLE)).toBe('TD RESP');
    expect(autoName([], '', '', PEOPLE)).toBe('');
  });
});
