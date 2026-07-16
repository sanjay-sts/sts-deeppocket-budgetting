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

  it('comma-joins owners sorted by name, regardless of selection order', () => {
    // Matches the backend, which sorts owner names alphabetically — the preview
    // must show exactly what will be persisted.
    const expected = 'Jordan S, Avery S Blueleaf TFSA';
    expect(autoName(['p1', 'p2'], 'Blueleaf', 'TFSA', PEOPLE)).toBe(expected);
    expect(autoName(['p2', 'p1'], 'Blueleaf', 'TFSA', PEOPLE)).toBe(expected);
  });

  it('drops missing institution and type without leaving stray spaces', () => {
    expect(autoName(['p1'], '', '', PEOPLE)).toBe('Avery S');
    expect(autoName(['p1'], '', 'RRSP', PEOPLE)).toBe('Avery S RRSP');
  });

  it('echoes owner ids that do not resolve to a person, like the backend', () => {
    expect(autoName(['nope'], 'TD', 'RESP', PEOPLE)).toBe('nope TD RESP');
    expect(autoName([], '', '', PEOPLE)).toBe('');
  });
});
