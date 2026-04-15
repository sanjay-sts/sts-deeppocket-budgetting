// Single seam between the UI and the data source.
// M1 reads the bundled fixtures.json; M2 swaps this to fetch from FastAPI.

import type { Fixtures } from '../types';
import fixturesJson from './fixtures.json';

export async function loadFixtures(): Promise<Fixtures> {
  return fixturesJson as unknown as Fixtures;
}
