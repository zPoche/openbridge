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
    const res = await this.http.get('/projects');
    return res.data._embedded.elements;
  }

  async getWorkPackageForm(projectId) {
    const res = await this.http.post(`/projects/${projectId}/work_packages/form`, {});
    return res.data;
  }

  async createWorkPackage(projectId, payload) {
    const res = await this.http.post(`/projects/${projectId}/work_packages`, payload);
    return res.data;
  }

  async updateWorkPackage(id, payload) {
    const current = await this.http.get(`/work_packages/${id}`);
    const lockVersion = current.data.lockVersion;
    const res = await this.http.patch(`/work_packages/${id}`, {
      ...payload,
      lockVersion,
    });
    return res.data;
  }

  async getTypes(projectId) {
    const res = await this.http.get(`/projects/${projectId}/types`);
    return res.data._embedded.elements;
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
