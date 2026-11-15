/** The message from anything that was thrown, for notes, toasts, and reports. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
