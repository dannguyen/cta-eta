const DEFAULT_PROXY_BASE = String(import.meta.env.VITE_CTA_PROXY_BASE ?? '').trim();

export function withBasePath(path, basePath = '') {
  const normalizedPath = String(path).replace(/^\/+/, '');
  const normalizedBase = basePath
    ? (basePath.endsWith('/') ? basePath.slice(0, -1) : basePath)
    : '';

  return `${normalizedBase}/${normalizedPath}`;
}

export function apiEndpoint(path, proxyBase = DEFAULT_PROXY_BASE) {
  const normalizedPath = String(path).replace(/^\/+/, '');
  const normalizedProxyBase = String(proxyBase ?? '').trim();

  if (normalizedProxyBase) {
    const root = normalizedProxyBase.endsWith('/')
      ? normalizedProxyBase
      : `${normalizedProxyBase}/`;
    return new URL(normalizedPath, root).toString();
  }

  return `/${normalizedPath}`;
}

export async function fetchText(url, fetchFn = fetch) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }
  return response.text();
}
