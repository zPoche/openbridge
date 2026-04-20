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
    this._currentProjectId = null;
    this._dryRunSeq = 900000;
  }

  async run(workPackages, projectId) {
    this.log = [];
    this.registry = new IdRegistry();
    this._currentProjectId = projectId != null && projectId !== '' ? String(projectId) : null;
    this._dryRunSeq = 900000;

    const validator = new Validator();
    const validation = validator.validate(workPackages);

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
        log: this.log,
      };
    }

    const topLevel = workPackages.filter((wp) => !wp.parent_local_id && !wp.openproject_id);
    await this._importPass(topLevel, projectId);

    const children = workPackages.filter((wp) => wp.parent_local_id && !wp.openproject_id);
    await this._importPass(children, projectId);

    const updates = workPackages.filter((wp) => wp.openproject_id);
    await this._updatePass(updates);

    const hadErrors = this.log.some((e) => e.action === 'ERROR');
    return {
      success: !hadErrors,
      errors: hadErrors
        ? [
            {
              ref: 'Import',
              message:
                'Mindestens ein Arbeitspaket wurde nicht erfolgreich verarbeitet. Details im Log.',
            },
          ]
        : [],
      warnings: validation.warnings,
      log: this.log,
    };
  }

  async _importPass(workPackages, projectId) {
    for (const wp of workPackages) {
      const parentId = this.registry.resolve(wp.parent_local_id);
      let typeHref = null;
      if (wp.type && this.client && !this.dryRun && projectId) {
        try {
          typeHref = await this.client.resolveTypeHref(String(projectId), wp.type);
        } catch (err) {
          this.log.push({
            action: 'ERROR',
            title: wp.title,
            sourceRow: wp._sourceRow,
            error: `Typ konnte nicht aufgelöst werden: ${err.message}`,
          });
          continue;
        }
      }

      const payload = this._buildPayload(wp, projectId, parentId, typeHref);

      if (this.dryRun) {
        this._dryRunSeq += 1;
        const syntheticId = this._dryRunSeq;
        if (wp.local_id != null && String(wp.local_id).trim() !== '') {
          this.registry.register(wp.local_id, syntheticId);
        }
        this.log.push({
          action: 'CREATE (dry-run)',
          title: wp.title,
          id: syntheticId,
          sourceRow: wp._sourceRow,
          payload,
        });
        continue;
      }

      try {
        const created = await this.client.createWorkPackage(String(projectId), payload);
        if (wp.local_id != null && String(wp.local_id).trim() !== '') {
          this.registry.register(wp.local_id, created.id);
        }
        this.log.push({
          action: 'CREATED',
          title: wp.title,
          id: created.id,
          sourceRow: wp._sourceRow,
        });
      } catch (err) {
        this.log.push({
          action: 'ERROR',
          title: wp.title,
          sourceRow: wp._sourceRow,
          error: err.message,
        });
      }
    }
  }

  async _updatePass(workPackages) {
    for (const wp of workPackages) {
      let typeHref = null;
      if (wp.type && this.client && !this.dryRun && this._currentProjectId) {
        try {
          typeHref = await this.client.resolveTypeHref(this._currentProjectId, wp.type);
        } catch (err) {
          this.log.push({
            action: 'ERROR',
            title: wp.title,
            id: wp.openproject_id,
            sourceRow: wp._sourceRow,
            error: `Typ konnte nicht aufgelöst werden: ${err.message}`,
          });
          continue;
        }
      }

      const payload = this._buildPayload(wp, null, null, typeHref);

      if (this.dryRun) {
        this.log.push({
          action: 'UPDATE (dry-run)',
          title: wp.title,
          id: wp.openproject_id,
          sourceRow: wp._sourceRow,
          payload,
        });
        continue;
      }

      try {
        await this.client.updateWorkPackage(wp.openproject_id, payload);
        this.log.push({
          action: 'UPDATED',
          title: wp.title,
          id: wp.openproject_id,
          sourceRow: wp._sourceRow,
        });
      } catch (err) {
        this.log.push({
          action: 'ERROR',
          title: wp.title,
          id: wp.openproject_id,
          sourceRow: wp._sourceRow,
          error: err.message,
        });
      }
    }
  }

  _buildPayload(wp, _projectId, parentId, typeHref) {
    const payload = {
      subject: wp.title,
      description: { raw: wp.description != null ? String(wp.description) : '' },
    };

    if (wp.start_date) payload.startDate = wp.start_date;
    if (wp.end_date) payload.dueDate = wp.end_date;

    const dur = wp.duration === null || wp.duration === undefined || wp.duration === ''
      ? null
      : Number(wp.duration);
    if (dur !== null && Number.isFinite(dur) && dur > 0 && !wp.start_date && !wp.end_date) {
      payload.duration = `P${dur}D`;
    }

    const links = {};
    if (parentId != null && parentId !== '') {
      links.parent = { href: `/api/v3/work_packages/${parentId}` };
    }
    if (typeHref) {
      links.type = { href: typeHref };
    }
    if (Object.keys(links).length) payload._links = links;

    return payload;
  }
}

module.exports = Importer;
