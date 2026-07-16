import type { Category } from '../../types';

const groupColors: Record<Category['group'], string> = {
  essentials: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  lifestyle: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  family: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
  financial: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  transfers: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  income: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
};

export function CategoryBadge({ category }: { category: Category }) {
  const cls = groupColors[category.group];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${cls}`}>
      {category.name}
    </span>
  );
}
