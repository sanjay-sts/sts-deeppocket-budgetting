// Pure helpers for the investment-account editor.

/**
 * Auto-generated display name for an account: owner name(s) comma-joined
 * alphabetically, then institution, then account type — each part dropped if
 * blank so there are no stray spaces. Mirrors the backend's computed `name`
 * used when no custom name override is set, including echoing an owner id
 * that no longer resolves to a person.
 */
export function autoName(
  ownerIds: string[],
  institution: string,
  accountType: string,
  people: { id: string; name: string }[],
): string {
  const ownerNames = ownerIds
    .map((id) => people.find((p) => p.id === id)?.name ?? id)
    .sort()
    .join(', ');
  return [ownerNames, institution, accountType].filter(Boolean).join(' ');
}
