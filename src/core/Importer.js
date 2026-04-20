const IdRegistry = require('./IdRegistry');
const Validator = require('./Validator');

/**
 * Importer
 * Orchestrates the multi-pass import into OpenProject.
 */
class Importer {
  constructor(client, { dryRun = false, onProgress = null } = {}) {
    this.client = client;
    this.dryRun = dryRun;
    this.onProgress = typeof onProgress === 'function' ? onProgress : null;
    this.registry = new IdRegistry();
    this.log = [];
    this._currentProjectId = null;
    this._dryRunSeq = 900000;
  }

  async _pulse(phase, current, total, message) {
    if (this.onProgress) {
      try {
        const payload = { phase, current, total };
        if (message != null && message !== '') payload.message = message;
        this.onProgress(payload);
      } catch (_) {
        /* ignore */
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  async run(workPackages, projectId) {
    this.log = [];
    this.registry = new IdRegistry();
    this._currentProjectId = projectId != null && projectId !== '' ? String(projectId) : null;
    this._dryRunSeq = 900000;

    const totalWp = workPackages.length;
    await this._pulse('validating', 0, Math.max(1, totalWp));

    const validator = new Validator();
    const validation = validator.validate(workPackages);

    if (!validation.valid) {
      const firstMsg =
        validation.errors && validation.errors[0] && validation.errors[0].message
          ? String(validation.errors[0].message)
          : 'Validierung fehlgeschlagen';
      await this._pulse('error', 0, 0, firstMsg);
      return {
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
        log: this.log,
      };
    }

    await this._pulse('validating', totalWp, Math.max(1, totalWp));

    const topLevel = workPackages.filter((wp) => !wp.parent_local_id && !wp.openproject_id);
    await this._importPass(topLevel, projectId, 'pass-1-parents');

    const children = workPackages.filter((wp) => wp.parent_local_id && !wp.openproject_id);
    for (const wp of children) {
      const pid = wp.parent_local_id;
      if (pid != null && String(pid).trim() !== '' && !this.registry.has(pid)) {
        this.log.push({
          action: 'WARN',
          title: wp.title,
          sourceRow: wp._sourceRow,
          message: `Parent-ID „${String(pid)}“ nicht gefunden – Paket wird ohne Parent erstellt.`,
        });
      }
    }
    await this._importPass(children, projectId, 'pass-2-children');

    const updates = workPackages.filter((wp) => wp.openproject_id);
    await this._updatePass(updates, 'pass-3-patch');

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

  /**
   * Legt Arbeitspakete in der Reihenfolge von workPackages an (oder Dry-Run-Log).
   * Voraussetzung für korrekte Parent-Links: Zeilen mit parent_local_id sollten nach der
   * Zeile ihres Elternteils stehen, wenn beide noch keine openproject_id haben; sonst fehlt
   * der Parent-Link bis der Eltern-Datensatz verarbeitet wurde (siehe WARN-Log vor dem Children-Pass).
   */
  async _importPass(workPackages, projectId, phase) {
    const total = workPackages.length;
    for (let i = 0; i < workPackages.length; i += 1) {
      await this._pulse(phase, i, Math.max(1, total));
      const wp = workPackages[i];
      const parentId = this.registry.resolve(wp.parent_local_id);
      let typeHref = null;
      if (wp.type && this.client && !this.dryRun && projectId) {
        try {
          typeHref = await this.client.resolveTypeHref(String(projectId), wp.type);
        } catch (err) {
          const entry = {
            action: 'ERROR',
            title: wp.title,
            sourceRow: wp._sourceRow,
            error: `Typ konnte nicht aufgelöst werden: ${err.message}`,
          };
          if (wp._debugDate) entry.debug = wp._debugDate;
          this.log.push(entry);
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
        const entry = {
          action: 'ERROR',
          title: wp.title,
          sourceRow: wp._sourceRow,
          error: err.message,
        };
        if (wp._debugDate) entry.debug = wp._debugDate;
        this.log.push(entry);
      }
    }
    await this._pulse(phase, total, Math.max(1, total));
  }

  async _updatePass(workPackages, phase) {
    const total = workPackages.length;
    for (let i = 0; i < workPackages.length; i += 1) {
      await this._pulse(phase, i, Math.max(1, total));
      const wp = workPackages[i];
      let typeHref = null;
      if (wp.type && this.client && !this.dryRun && this._currentProjectId) {
        try {
          typeHref = await this.client.resolveTypeHref(this._currentProjectId, wp.type);
        } catch (err) {
          const entry = {
            action: 'ERROR',
            title: wp.title,
            id: wp.openproject_id,
            sourceRow: wp._sourceRow,
            error: `Typ konnte nicht aufgelöst werden: ${err.message}`,
          };
          if (wp._debugDate) entry.debug = wp._debugDate;
          this.log.push(entry);
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
        const entry = {
          action: 'ERROR',
          title: wp.title,
          id: wp.openproject_id,
          sourceRow: wp._sourceRow,
          error: err.message,
        };
        if (wp._debugDate) entry.debug = wp._debugDate;
        this.log.push(entry);
      }
    }
    await this._pulse(phase, total, Math.max(1, total));
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
