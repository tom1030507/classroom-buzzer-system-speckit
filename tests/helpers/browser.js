/** Independent cookie jar and CSRF token for one role in HTTP integration tests. */
export function browser(app, role) {
  const cookies = new Map();
  let csrfToken;
  return {
    cookies,
    async request(path, { method = 'GET', body, headers = {}, signal } = {}) {
      const requestHeaders = {
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...headers,
      };
      if (method !== 'GET') {
        requestHeaders.Origin ??= app.baseUrl;
        requestHeaders['X-CSRF-Token'] ??= csrfToken ?? '';
      }
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const response = await app.request(`/api/${role}/${path}`, {
        method, headers: requestHeaders, body: JSON.stringify(body), signal,
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(';', 1)[0].split('=');
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json();
        if (data.csrfToken) csrfToken = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      }
      return response;
    },
  };
}
