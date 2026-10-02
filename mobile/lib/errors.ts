/**
 * A readable message from whatever was thrown. Supabase/PostgREST errors are plain objects with a `message`,
 * not Error instances, so `e instanceof Error` alone would throw their text away.
 */
export function errorMessage(e: unknown, fallback = "Something went wrong — please try again."): string {
  if (e instanceof Error && e.message) return e.message;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : fallback;
}
