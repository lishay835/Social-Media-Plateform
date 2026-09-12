/**
 * API & Utility Client
 */

const API = {
  async get(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
    return res.json();
  },

  async post(endpoint, data = {}) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`POST ${endpoint} failed: ${res.status}`);
    return res.json();
  },

  async put(endpoint, data = {}) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`PUT ${endpoint} failed: ${res.status}`);
    return res.json();
  },

  async delete(endpoint) {
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${endpoint} failed: ${res.status}`);
    return res.json();
  },

  debounce(func, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => func.apply(this, args), delay);
    };
  }
};
