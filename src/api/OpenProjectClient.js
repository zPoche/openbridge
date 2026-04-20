const axios = require('axios');

class OpenProjectClient {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
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
    // Fetch current lockVersion first
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
}

module.exports = OpenProjectClient;
