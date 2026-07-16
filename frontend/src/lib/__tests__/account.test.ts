import { describe, it, expect } from 'vitest';
import { autoName } from '../account';

const PEOPLE = [
  { id: 'p1', name: 'Sanjay S' },
  { id: 'p2', name: 'Anumol S' },
];

describe('autoName', () => {
  it('joins a single owner with institution and account type', () => {
    expect(autoName(['p1'], 'WealthSimple', 'TFSA', PEOPLE)).toBe('Sanjay S WealthSimple TFSA');
  });

  it('comma-joins two owners in order', () => {
    expect(autoName(['p1', 'p2'], 'WealthSimple', 'TFSA', PEOPLE)).toBe(
      'Sanjay S, Anumol S WealthSimple TFSA',
    );
  });

  it('drops missing institution and type without leaving stray spaces', () => {
    expect(autoName(['p1'], '', '', PEOPLE)).toBe('Sanjay S');
    expect(autoName(['p1'], '', 'RRSP', PEOPLE)).toBe('Sanjay S RRSP');
  });

  it('ignores owner ids that do not resolve to a person', () => {
    expect(autoName(['nope'], 'TD', 'RESP', PEOPLE)).toBe('TD RESP');
    expect(autoName([], '', '', PEOPLE)).toBe('');
  });
});
