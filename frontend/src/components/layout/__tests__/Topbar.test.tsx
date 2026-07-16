import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Topbar } from '../Topbar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('Topbar', () => {
  it('shows the month selector on month-scoped screens', () => {
    render(<Topbar title="Dashboard" showMonthSelector />);
    expect(container!.querySelector('select')).not.toBeNull();
    expect(container!.textContent).toContain('Month');
  });

  it('hides the month selector on screens the month does not affect (issue #9)', () => {
    render(<Topbar title="Settings" showMonthSelector={false} />);
    expect(container!.querySelector('select')).toBeNull();
    expect(container!.textContent).not.toContain('Month');
  });

  it('always renders the screen title', () => {
    render(<Topbar title="Net Worth" showMonthSelector={false} />);
    expect(container!.querySelector('h1')?.textContent).toBe('Net Worth');
  });
});
