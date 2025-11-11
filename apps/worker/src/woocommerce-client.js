// apps/worker/src/woocommerce-client.js
import axios from 'axios';

export default class WooCommerceClient {
  constructor(store) {
    this.store = store;
    this.baseURL = (store.wooBaseUrl || '').replace(/\/$/, '');
    this.ck = store.wooKey;
    this.cs = store.wooSecret;
    // prefer query-string auth; many hosts block Basic for Woo endpoints
    this.authMode = process.env.WC_AUTH_MODE || 'qs'; // 'qs' | 'basic'
  }

  // attach auth as query params if in 'qs' mode
  paramsAuth(extra = {}) {
    return this.authMode === 'qs'
      ? { consumer_key: this.ck, consumer_secret: this.cs, ...extra }
      : extra;
  }

  // attach Basic auth only when explicitly requested
  basicAuth() {
    return this.authMode === 'basic'
      ? { username: this.ck, password: this.cs }
      : undefined;
  }

  async requestWithRetry(config, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await axios({ timeout: 60000, ...config });
        return res;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async paginate(path, params = {}) {
    const all = [];
    let page = 1;
    const per_page = params.per_page ?? 50;
    while (true) {
      const res = await this.requestWithRetry({
        method: 'GET',
        url: `${this.baseURL}/wp-json/${path}`,
        auth: this.basicAuth(),
        params: this.paramsAuth({ per_page, page, orderby: 'date', order: 'desc', ...params }),
        headers: { 'User-Agent': 'WooAnalyticsWorker/1.0' },
      });
      const batch = Array.isArray(res.data) ? res.data : [];
      all.push(...batch);
      if (batch.length < per_page) break;
      page++;
    }
    return all;
  }

  // helpers to shape errors
  errMsg(error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    if (status) {
      const brief = typeof data === 'string' ? data.slice(0, 240) : JSON.stringify(data).slice(0, 240);
      return `HTTP ${status} ${brief}`;
    }
    return error?.message || 'Unknown error';
  }

  async testConnection() {
    try {
      const res = await this.requestWithRetry({
        method: 'GET',
        url: `${this.baseURL}/wp-json/wc/v3/system_status`,
        auth: this.basicAuth(),
        params: this.paramsAuth(),
      });
      return { success: true, data: res.data };
    } catch (error) {
      return { success: false, error: this.errMsg(error) };
    }
  }

  async getProducts(params = {}) {
    try {
      const data = await this.paginate('wc/v3/products', params);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.errMsg(error) };
    }
  }

  async getOrders(params = {}) {
    try {
      const data = await this.paginate('wc/v3/orders', params);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.errMsg(error) };
    }
  }

  async getCustomers(params = {}) {
    try {
        const all = [];
        let page = 1;
        const per_page = params.per_page ?? 50;
        while (true) {
        const res = await this.requestWithRetry({
            method: 'GET',
            url: `${this.baseURL}/wp-json/wc/v3/customers`,
            auth: this.basicAuth(),
            // 🚫 do NOT force orderby here
            params: this.paramsAuth({ per_page, page, ...params }),
            headers: { 'User-Agent': 'WooAnalyticsWorker/1.0' },
        });
        const batch = Array.isArray(res.data) ? res.data : [];
        all.push(...batch);
        if (batch.length < per_page) break;
        page++;
        }
        return { success: true, data: all };
    } catch (error) {
        const status = error?.response?.status;
        const data   = error?.response?.data;
        const msg = status ? `HTTP ${status} ${JSON.stringify(data).slice(0,240)}` : error.message;
        return { success: false, error: msg };
    }
    }

  async getCoupons(params = {}) {
    try {
      const data = await this.paginate('wc/v3/coupons', params);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.errMsg(error) };
    }
  }

  // Woo Subscriptions plugin routes vary; try several in order
  async getSubscriptions(params = {}) {
    const paths = [
        'wc/v3/subscriptions',
        'wc/v2/subscriptions',
        'wc/v1/subscriptions',
        'wcs/v1/subscriptions',
    ];
    for (const p of paths) {
        try {
        const data = await this.paginate(p, params);
        if (Array.isArray(data)) return { success: true, data };
        } catch { /* try next */ }
    }
    return { success: false, error: 'Subscriptions API not available (tried wc/v1|v2|v3 and wcs/v1).' };
    }

}
