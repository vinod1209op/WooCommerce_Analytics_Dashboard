import axios from 'axios';

export default class WooCommerceClient {
  constructor(store) {
    this.store = store;
    this.baseURL = store.wooBaseUrl;
  }

  async testConnection() {
    try {
      console.log('Testing WooCommerce connection to:', this.baseURL);
      
      const response = await axios.get(`${this.baseURL}/wp-json/wc/v3/system_status`, {
        auth: {
          username: this.store.wooKey,
          password: this.store.wooSecret
        },
        timeout: 15000
      });

      console.log('✅ WooCommerce connection successful!');
      return { 
        success: true, 
        data: response.data,
        store: response.data.environment
      };
    } catch (error) {
      console.log('❌ WooCommerce connection failed:', error.message);
      return { 
        success: false, 
        error: error.message
      };
    }
  }

  async getOrders(params = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/wp-json/wc/v3/orders`, {
        auth: {
          username: this.store.wooKey,
          password: this.store.wooSecret
        },
        params: {
          per_page: 100,
          orderby: 'date',
          order: 'desc',
          ...params
        },
        timeout: 15000
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getProducts(params = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/wp-json/wc/v3/products`, {
        auth: {
          username: this.store.wooKey,
          password: this.store.wooSecret
        },
        params: {
          per_page: 100,
          ...params
        },
        timeout: 15000
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getCustomers(params = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/wp-json/wc/v3/customers`, {
        auth: {
          username: this.store.wooKey,
          password: this.store.wooSecret
        },
        params: {
          per_page: 100,
          ...params
        },
        timeout: 15000
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}