/**
 * Runs a loader's data fetch. Router writes a failed loader's error message into the page's hydration data, and a
 * database error message ("D1_ERROR: no such table…") must not reach the HTML. So the real error goes to the Worker
 * log and a generic one is thrown. Call it around the fetch only, never around `notFound()` or `redirect()`.
 */
export async function safeLoad<T>(what: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`${what} failed:`, error);
    throw new Error("The page could not be loaded");
  }
}
