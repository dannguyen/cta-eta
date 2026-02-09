export async function fetchText(url, fetchFn = fetch) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }
  return response.text();
}
