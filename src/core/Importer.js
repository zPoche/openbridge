const IdRegistry = require('./IdRegistry');
const Validator = require('./Validator');

/**
 * Importer
 * Orchestrates the multi-pass import into OpenProject.
 */
class Importer {
  constructor(client, { dryRun = false } = {}) {
    this.client = client;
    this.dryRun = dryRun;
    this.registry = new IdRegistry();
    this.log = [];
  }

  async run(workPackages, projectId) {
    const validator = new Validator();
    const validation = validator.validate(workPackages);

    if (!validation.valid) {
      return { success: false, errors: validation.errors, warnings: validation.warnings, log: this.log };
    }

    // Pass 1: top-level (no parent)
    const topLevel = workPackages.filter(wp => !wp.parent_local_id && !wp.openproject_id);
    await this._importPass(topLevel, projectId);

    // Pass 2: children
    const children = workPackages.filter(wp => wp.parent_local_id && !wp.openproject_id);
    await this._importPass(children, projectId);

    // Pass 3: updates (openproject_id already set)
    const updates = workPackages.filter(wp => wp.openproject_id);
    await this._updatePass(updates);

    return { success: true, errors: [], warnings: validation.warnings, log: this.log };
  }

  async _importPass(workPackages, projectId) {
    for (const wp of workPackages) {
      const parentId = this.registry.resolve(wp.parent_local_id);

      const payload = this._buildPayload(wp, projectId, parentId);

      if (this.dryRun) {
        this.log.push({ action: 'CREATE (dry-run)', title: wp.title, payload });
        continue;
      }

      try {
        const created = await this.client.createWorkPackage(projectId, payload);
        this.registry.register(wp.local_id, created.id);
        this.log.push({ action: 'CREATED', title: wp.title, id: created.id });
      } catch (err) {
        this.log.push({ action: 'ERROR', title: wp.title, error: err.message });
      }
    }
  }

  async _updatePass(workPackages) {
    for (const wp of workPackages) {
      const payload = this._buildPayload(wp, null, null);

      if (this.dryRun) {
        this.log.push({ action: 'UPDATE (dry-run)', title: wp.title, id: wp.openproject_id, payload });
        continue;
      }

      try {
        await this.client.updateWorkPackage(wp.openproject_id, payload);
        this.log.push({ action: 'UPDATED', title: wp.title, id: wp.openproject_id });
      } catch (err) {
        this.log.push({ action: 'ERROR', title: wp.title, error: err.message });
      }
    }
  }

  _buildPayload(wp, projectId, parentId) {
    const payload = {
      subject: wp.title,
      description: { raw: wp.description || '' },
    };

    // Only send dates when available
    if (wp.start_date) payload.startDate = wp.start_date;
    if (wp.end_date)   payload.dueDate   = wp.end_date;

    // Only send duration when NO start+end date
    if (wp.duration && !wp.start_date && !wp.end_date) {
      payload.duration = `P${wp.duration}D`; // ISO 8601 duration
    }

    if (parentId) {
      payload._links = { parent: { href: `/api/v3/work_packages/${parentId}` } };
    }

    if (wp.type) {
      payload._links = { ...payload._links, type: { href: `/api/v3/types/...` } }; // resolved by client
    }

    return payload;
  }
}

module.exports = Importer;
