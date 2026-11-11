import type { Request } from 'express';

type RoutedRequest = Pick<Request, 'baseUrl'> & {
  route?: { path?: unknown };
  routeOptions?: { url?: unknown };
};

const SAFE_ROUTE = /^\/[A-Za-z0-9_./:-]*$/;
const KNOWN_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_CODE_SEGMENT = /^[A-Z2-9]{6}$/;
const UNMATCHED = 'unmatched';

function candidate(request: RoutedRequest): string | undefined {
  const routePath = request.route?.path;
  if (typeof routePath === 'string') return routePath;
  const routeUrl = request.routeOptions?.url;
  return typeof routeUrl === 'string' ? routeUrl : undefined;
}

function safe(path: string): boolean {
  if (!SAFE_ROUTE.test(path) || path.includes('*')) return false;
  return !path
    .split('/')
    .some(
      (segment) =>
        segment &&
        (UUID_SEGMENT.test(segment) || ROOM_CODE_SEGMENT.test(segment)),
    );
}

/**
 * Express exposes the registered route pattern, never the concrete URL. Use
 * only that pattern (plus the mount path); never originalUrl/url. If it is
 * missing or untrusted, export the bounded fallback "unmatched".
 */
export function normalizeHttpRoute(request: RoutedRequest): string {
  const routePath = candidate(request);
  if (!routePath) return UNMATCHED;

  const baseUrl =
    typeof request.baseUrl === 'string'
      ? request.baseUrl.replace(/\/+$/, '')
      : '';
  let path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (baseUrl && !path.startsWith(`${baseUrl}/`) && path !== baseUrl)
    path = `${baseUrl}${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');

  return safe(path) ? path : UNMATCHED;
}

export function normalizeHttpMethod(method: string | undefined): string {
  const normalized = method?.toUpperCase() ?? '';
  return KNOWN_METHODS.has(normalized) ? normalized : 'OTHER';
}

export function isSocketIoPath(path: string | undefined): boolean {
  return path === '/socket.io' || path?.startsWith('/socket.io/') === true;
}
