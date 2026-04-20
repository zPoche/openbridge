const axios = require('axios');

class OpenProjectClient {
  constructor(baseUrlOrOpts, apiKeyMaybe) {
    let baseUrl;
    let apiKey;
    if (typeof baseUrlOrOpts === 'object' && baseUrlOrOpts !== null && !Array.isArray(baseUrlOrOpts)) {
      baseUrl = baseUrlOrOpts.baseUrl;
      apiKey = baseUrlOrOpts.apiKey;
    } else {
      baseUrl = baseUrlOrOpts;
      apiKey = apiKeyMaybe;
    }
    if (!baseUrl || !apiKey) {
      throw new Error('OpenProjectClient: baseUrl und apiKey sind erforderlich.');
    }
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.http = axios.create({
      baseURL: `${this.baseUrl}/api/v3`,
      auth: { username: 'apikey', password: apiKey },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getProjects() {
    try {
      const res = await this.http.get('/projects', { params: { pageSize: 500 } });
      const status = res.status;
      if (typeof status === 'number' && status >= 400) {
        throw new Error(`Projekte konnten nicht geladen werden (Status ${status})`);
      }
      const elements = (res.data && res.data._embedded && res.data._embedded.elements) || [];
      return elements.map((p) => ({ id: p.id, name: p.name }));
    } catch (err) {
      if (err.response && typeof err.response.status === 'number') {
        throw new Error(`Projekte konnten nicht geladen werden (Status ${err.response.status})`);
      }
      if (
        err.code === 'ECONNABORTED'
        || err.code === 'ENOTFOUND'
        || err.code === 'ECONNREFUSED'
        || err.code === 'ETIMEDOUT'
        || err.message === 'Network Error'
      ) {
        throw new Error('Netzwerkfehler beim Laden der Projekte');
      }
      throw err;
    }
  }

  async getWorkPackageForm(projectId) {
    const res = await this.http.post(`/projects/${projectId}/work_packages/form`, {});
    return res.data;
  }

  async createWorkPackage(projectId, payload) {
    try {
      const res = await this.http.post(`/projects/${projectId}/work_packages`, payload);
      if (typeof res.status === 'number' && res.status >= 400) {
        const msg = (res.data && res.data.message) || '';
        throw new Error(`Work package konnte nicht erstellt werden (HTTP ${res.status}): ${msg}`);
      }
      return res.data;
    } catch (err) {
      if (err.response && typeof err.response.status === 'number') {
        const s = err.response.status;
        const body = err.response.data;
        const msg = (body && body.message) ? body.message : err.message;
        throw new Error(`Work package konnte nicht erstellt werden (HTTP ${s}): ${msg}`);
      }
      throw err;
    }
  }

  async updateWorkPackage(id, payload) {
    try {
      const current = await this.http.get(`/work_packages/${id}`);
      if (current.data.lockVersion === undefined) {
        throw new Error('Antwort vom Server ohne lockVersion – Update nicht möglich.');
      }
      const lockVersion = current.data.lockVersion;
      const res = await this.http.patch(`/work_packages/${id}`, {
        ...payload,
        lockVersion,
      });
      if (typeof res.status === 'number' && res.status >= 400) {
        const msg = (res.data && res.data.message) || '';
        throw new Error(`Work package konnte nicht aktualisiert werden (HTTP ${res.status}): ${msg}`);
      }
      return res.data;
    } catch (err) {
      if (err.response && typeof err.response.status === 'number') {
        const s = err.response.status;
        const body = err.response.data;
        const msg = (body && body.message) ? body.message : err.message;
        throw new Error(`Work package konnte nicht aktualisiert werden (HTTP ${s}): ${msg}`);
      }
      throw err;
    }
  }

  async getTypes(projectId) {
    const res = await this.http.get(`/projects/${projectId}/types`);
    const embedded = res.data && res.data._embedded;
    if (!embedded || !Array.isArray(embedded.elements)) {
      return [];
    }
    return embedded.elements;
  }

  async getStatuses() {
    const res = await this.http.get('/statuses');
    return res.data._embedded.elements;
  }

  /**
   * Resolves a type name or numeric id to an API href, or null if not found.
   */
  async resolveTypeHref(projectId, type) {
    if (type === null || type === undefined || type === '') return null;
    const types = await this.getTypes(projectId);
    const raw = String(type).trim();
    if (/^\d+$/.test(raw)) {
      const id = Number.parseInt(raw, 10);
      const found = types.find((t) => t.id === id);
      if (found) return `/api/v3/types/${found.id}`;
      return `/api/v3/types/${id}`;
    }
    const lower = raw.toLowerCase();
    const byName = types.find((t) => String(t.name).toLowerCase() === lower);
    if (byName) return `/api/v3/types/${byName.id}`;
    return null;
  }
}

module.exports = OpenProjectClient;
