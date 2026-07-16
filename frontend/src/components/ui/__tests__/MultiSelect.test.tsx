import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MultiSelect } from '../MultiSelect';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = [
  { id: 'p1', label: 'Anumol' },
  { id: 'p2', label: 'Sanjay' },
];

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

function trigger() {
  return container!.querySelector('button') as HTMLButtonElement;
}

describe('MultiSelect', () => {
  it('renders the placeholder when nothing is selected', () => {
    render(<MultiSelect options={options} selected={[]} onChange={() => {}} placeholder="Pick people" />);
    expect(trigger().textContent).toBe('Pick people');
  });

  it('renders the joined labels when ids are selected', () => {
    render(<MultiSelect options={options} selected={['p1', 'p2']} onChange={() => {}} />);
    expect(trigger().textContent).toBe('Anumol, Sanjay');
  });

  it('sorts the joined labels alphabetically regardless of options order', () => {
    // Keeps the trigger label consistent with the sorted computed account name.
    const unsorted = [
      { id: 'p2', label: 'Sanjay' },
      { id: 'p1', label: 'Anumol' },
    ];
    render(<MultiSelect options={unsorted} selected={['p2', 'p1']} onChange={() => {}} />);
    expect(trigger().textContent).toBe('Anumol, Sanjay');
  });

  it('opening the popover and clicking an unchecked option fires onChange with the id ADDED', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} selected={['p1']} onChange={onChange} />);
    // popover is closed initially
    expect(container!.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    act(() => trigger().click());
    const boxes = container!.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    // click the unchecked "Sanjay" (p2)
    act(() => (boxes[1] as HTMLInputElement).click());
    expect(onChange).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('clicking a checked option fires onChange with the id REMOVED', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} selected={['p1', 'p2']} onChange={onChange} />);
    act(() => trigger().click());
    const boxes = container!.querySelectorAll('input[type="checkbox"]');
    // click the checked "Anumol" (p1)
    act(() => (boxes[0] as HTMLInputElement).click());
    expect(onChange).toHaveBeenCalledWith(['p2']);
  });
});
