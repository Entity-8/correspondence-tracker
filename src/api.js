import { API_BASE, getToken, setToken } from './config.js';

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function api(path, options = {}) {
  try {
    const response = await fetch(`${API_BASE}/api${path}`, {
      credentials: 'include',
      ...options,
      headers: authHeaders({
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      }),
      body:
        options.body && typeof options.body !== 'string'
          ? JSON.stringify(options.body)
          : options.body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login' && path !== '/auth/change-password') {
        setToken('');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new Error(data.error || 'تعذر تنفيذ الطلب');
    }

    if (path === '/auth/login' && data.token) setToken(data.token);
    if (path === '/auth/logout') setToken('');
    return data;
  } catch (error) {
    if (error.message === 'Failed to fetch') {
      throw new Error('تعذر الاتصال بالخادم');
    }
    throw error;
  }
}

/**
 * Fetch a protected binary resource (image or Excel export) using Authorization headers
 * rather than passing session tokens in URL query strings.
 */
export async function apiBlob(path, options = {}) {
  try {
    const response = await fetch(`${API_BASE}/api${path}`, {
      credentials: 'include',
      ...options,
      headers: authHeaders(options.headers || {}),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setToken('');
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw new Error(data.error || 'تعذر تحميل الملف');
    }

    return await response.blob();
  } catch (error) {
    if (error.message === 'Failed to fetch') {
      throw new Error('تعذر الاتصال بالخادم');
    }
    throw error;
  }
}
