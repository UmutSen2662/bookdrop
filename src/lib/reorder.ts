/**
 * Move `draggedId` relative to `targetId`. Moving right lands after the target;
 * moving left lands before it, which matches what the pointer is doing.
 */
export function moveId(
  ids: number[],
  draggedId: number,
  targetId: number,
): number[] {
  const from = ids.indexOf(draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (from < 0 || targetIndex < 0 || from === targetIndex) return ids;

  const next = [...ids];
  next.splice(from, 1);
  const anchor = next.indexOf(targetId);
  next.splice(from < targetIndex ? anchor + 1 : anchor, 0, draggedId);
  return next;
}
