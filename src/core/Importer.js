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
    /** @type {Map<number, number>} source row index → OpenProject ID (fallback if local_id missing) */
    this._opIdBySourceRow = new Map();

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
        finalPackages: [],
      };
    }

    await this._pulse('validating', totalWp, Math.max(1, totalWp));

    const hasParentRef = (wp) => {
      const pl = wp.parent_local_id != null && String(wp.parent_local_id).trim() !== '';
      const po = wp.parent_openproject_id != null && String(wp.parent_openproject_id).trim() !== '';
      return pl || po;
    };

    const topLevel = workPackages.filter((wp) => !wp.openproject_id && !hasParentRef(wp));
    await this._importPass(topLevel, projectId, 'pass-1-parents');

    const children = workPackages.filter((wp) => !wp.openproject_id && hasParentRef(wp));
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
    const finalPackages = this.dryRun ? [] : this._buildFinalPackages(workPackages);
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
      finalPackages,
    };
  }

  /**
   * Nach echtem Import: eine Zeile pro Eingabe-Arbeitspaket mit aufgelösten OpenProject-IDs
   * (keine local_ids). Zeilen ohne ermittelbare OP-ID (fehlgeschlagenes Create) fehlen.
   */
  _buildFinalPackages(workPackages) {
    const out = [];
    for (const wp of workPackages) {
      let opId = null;
      if (wp.openproject_id != null && wp.openproject_id !== '') {
        const n = Number(wp.openproject_id);
        if (Number.isFinite(n)) opId = n;
      }
      if (!Number.isFinite(opId) && wp.local_id != null && String(wp.local_id).trim() !== '') {
        const r = this.registry.resolve(wp.local_id);
        if (Number.isFinite(Number(r))) opId = Number(r);
      }
      if (!Number.isFinite(opId) && wp._sourceRow != null && this._opIdBySourceRow.has(wp._sourceRow)) {
        opId = this._opIdBySourceRow.get(wp._sourceRow);
      }
      if (!Number.isFinite(opId)) continue;

      let parentOp = null;
      if (wp.parent_local_id != null && String(wp.parent_local_id).trim() !== '') {
        const pr = this.registry.resolve(wp.parent_local_id);
        if (Number.isFinite(Number(pr))) parentOp = Number(pr);
      }
      if (parentOp == null && wp.parent_openproject_id != null && wp.parent_openproject_id !== '') {
        const po = Number(wp.parent_openproject_id);
        if (Number.isFinite(po)) parentOp = po;
      }

      const preds = Array.isArray(wp.predecessors) ? wp.predecessors : [];
      const predOps = [];
      for (const pl of preds) {
        const x = this.registry.resolve(pl);
        if (Number.isFinite(Number(x))) predOps.push(Number(x));
      }

      out.push({
        openproject_id: opId,
        parent_openproject_id: parentOp,
        predecessor_openproject_ids: predOps,
        title: wp.title != null ? String(wp.title) : '',
        type: wp.type != null ? String(wp.type) : '',
        status: wp.status != null ? String(wp.status) : '',
        start_date: wp.start_date != null ? String(wp.start_date) : '',
        end_date: wp.end_date != null ? String(wp.end_date) : '',
        duration: wp.duration != null && wp.duration !== '' ? String(wp.duration) : '',
        description: wp.description != null ? String(wp.description) : '',
        assignee: wp.assignee != null ? String(wp.assignee) : '',
      });
    }
    return out;
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
      let parentId = this.registry.resolve(wp.parent_local_id);
      if (parentId == null && wp.parent_openproject_id != null && wp.parent_openproject_id !== '') {
        const po = Number(wp.parent_openproject_id);
        if (Number.isFinite(po)) parentId = po;
      }
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
        if (wp._sourceRow != null) {
          this._opIdBySourceRow.set(wp._sourceRow, created.id);
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
      if (!this.dryRun && wp.openproject_id != null && wp.openproject_id !== '') {
        const nid = Number(wp.openproject_id);
        if (Number.isFinite(nid)) {
          if (wp.local_id != null && String(wp.local_id).trim() !== '') {
            this.registry.register(wp.local_id, nid);
          }
          if (wp._sourceRow != null) {
            this._opIdBySourceRow.set(wp._sourceRow, nid);
          }
        }
      }

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
