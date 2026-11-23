const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://uniweb-p7mz.onrender.com/api').replace(/\/+$/, '');

export function formatOrderCode(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

export type DriverAppTheme = { primary: string; secondary: string };

export async function getAppTheme(signal: AbortSignal): Promise<DriverAppTheme> {
  const result = await request('/app/theme', { signal }) as Partial<DriverAppTheme> | null;
  const hex = /^#[0-9a-f]{6}$/i;
  if (!result?.primary || !result.secondary || !hex.test(result.primary) || !hex.test(result.secondary)) {
    throw new Error('Tema do app inválido.');
  }
  return { primary: result.primary, secondary: result.secondary };
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface LoginResponse {
  token: string;
  user: { id: string; full_name?: string; user_type: string };
}

export interface DriverSession {
  token: string;
  name: string;
}

export interface Delivery {
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  pickup: { storeId: string; storeName: string; address: string | null };
  destinationArea: string | null;
  destinationAddress?: string | null;
  status?: 'in_progress' | 'delivered' | 'cancelled' | 'cancelled_by_store';
  deliveryFee: string | number | null;
}

export interface DeliveryPage {
  items: Delivery[];
  nextOffset: number | null;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timeout = setTimeout(abort, 60000);
  try {
    const response = await fetch(apiUrl + path, {
      ...init, signal: controller.signal, headers: { Accept: 'application/json', ...init.headers },
    });
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error : 'O servidor não conseguiu atender à solicitação.';
      throw new ApiError(response.status, message);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError || init.signal?.aborted) throw error;
    throw new Error(controller.signal.aborted ? 'O servidor demorou para responder. Tente novamente.' :
      'Não foi possível conectar ao Uniweb. Confira sua conexão.');
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

export async function loginDriver(email: string, password: string): Promise<DriverSession> {
  const result = await request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  }).catch((error) => {
    if (error instanceof ApiError && error.status === 401) throw new Error('E-mail ou senha incorretos.');
    throw error;
  }) as Partial<LoginResponse> | null;
  if (!result?.token || !result.user?.id) throw new Error('O Uniweb retornou uma sessão inválida.');
  if (result.user.user_type !== 'driver') throw new Error('Entre com uma conta de entregador do Uniweb.');
  return { token: result.token, name: result.user.full_name?.trim() || '' };
}

export async function getDriverName(token: string, signal: AbortSignal): Promise<string> {
  return (await getDriverProfile(token, signal)).fullName.trim();
}

export async function getDriverPushAlias(token: string, signal: AbortSignal): Promise<string> {
  const result = await request('/auth/me/push-identity', {
    signal, headers: { Authorization: 'Bearer ' + token },
  }) as { externalId?: string };
  if (!result?.externalId) throw new Error('Identidade de notificações indisponível.');
  return result.externalId;
}

export interface DriverProfile {
  fullName: string;
  email: string;
  phone: string;
  vehicleType: string;
  manufacturer: string;
  brand: string;
  color: string;
  plate: string;
}

function readDriverProfile(result: unknown): DriverProfile {
  const driver = result as Record<string, string | null>;
  return {
    fullName: driver.full_name ?? '', email: driver.email ?? '', phone: driver.phone ?? '',
    vehicleType: driver.vehicle_type ?? '', manufacturer: driver.vehicle_manufacturer ?? '',
    brand: driver.vehicle_brand ?? '', color: driver.vehicle_color ?? '', plate: driver.vehicle_plate ?? '',
  };
}

export async function getDriverProfile(token: string, signal: AbortSignal) {
  return readDriverProfile(await request('/auth/me/driver', {
    signal, headers: { Authorization: 'Bearer ' + token },
  }));
}

export async function saveDriverProfile(token: string, profile: DriverProfile) {
  return readDriverProfile(await request('/auth/me/driver', {
    method: 'PUT', body: JSON.stringify(profile),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  }));
}

export async function getDeliveries(token: string, section: 'available' | 'accepted', offset: number, signal: AbortSignal): Promise<DeliveryPage> {
  const result = await request('/orders/' + section + '-deliveries?limit=20&offset=' + offset, {
    signal, headers: { Authorization: 'Bearer ' + token },
  }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error('A lista de entregas ainda não está disponível no servidor do Uniweb.');
    }
    throw error;
  }) as Partial<DeliveryPage> | null;
  if (!result || !Array.isArray(result.items) ||
      (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || Number(result.nextOffset) <= offset))) {
    throw new Error('O Uniweb retornou uma lista de entregas inválida.');
  }
  return result as DeliveryPage;
}

export async function acceptDelivery(token: string, orderId: string, signal: AbortSignal): Promise<void> {
  await request('/orders/available-deliveries/' + encodeURIComponent(orderId) + '/accept', {
    method: 'POST', signal, headers: { Authorization: 'Bearer ' + token },
  });
}

export async function confirmDelivery(token: string, orderId: string, code: string, signal: AbortSignal): Promise<void> {
  await request('/orders/accepted-deliveries/' + encodeURIComponent(orderId) + '/confirm', {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export async function cancelDelivery(token: string, orderId: string, signal: AbortSignal): Promise<void> {
  await request('/orders/accepted-deliveries/' + encodeURIComponent(orderId) + '/cancel', {
    method: 'POST', signal, headers: { Authorization: 'Bearer ' + token },
  });
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DeliveryRoute {
  points: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
}

export async function publishDeliveryPosition(token: string, orderId: string, position: Coordinates, signal: AbortSignal) {
  await request('/orders/accepted-deliveries/' + encodeURIComponent(orderId) + '/tracking', {
    method: 'PUT', signal, body: JSON.stringify(position),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
}

export async function getDeliveryRoute(token: string, orderId: string, signal: AbortSignal) {
  return await request('/orders/accepted-deliveries/' + encodeURIComponent(orderId) + '/route', {
    method: 'POST', signal, headers: { Authorization: 'Bearer ' + token },
  }) as DeliveryRoute;
}

export async function clearDeliveryPosition(token: string, orderId: string) {
  await request('/orders/accepted-deliveries/' + encodeURIComponent(orderId) + '/tracking', {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
}
