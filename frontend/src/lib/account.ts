// Pure helpers for the investment-account editor.

/**
 * Auto-generated display name for an account: owner name(s) comma-joined, then
 * institution, then account type — each part dropped if blank so there are no
 * stray spaces. Mirrors the backend's computed `name` used when no custom name
 * override is set.
 */
export function autoName(
  ownerIds: string[],
  institution: string,
  accountType: string,
  people: { id: string; name: string }[],
): string {
  // Sorted by id to match the backend's read order (_account_owner_ids), so the
  // preview shows exactly the name that will be persisted.
  const ownerNames = [...ownerIds]
    .sort()
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  return [ownerNames, institution, accountType].filter(Boolean).join(' ');
}
