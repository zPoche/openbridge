/**
 * Validator
 * Checks work packages before import and returns errors/warnings.
 */
class Validator {
  validate(workPackages) {
    const errors = [];
    const warnings = [];

    workPackages.forEach((wp, index) => {
      const ref = wp.local_id || wp.title || `Row ${index + 1}`;
      const rowLabel = wp._sourceRow != null ? wp._sourceRow : index + 1;

      if (!wp.title || String(wp.title).trim() === '') {
        errors.push({ ref, rowIndex: rowLabel, message: 'Thema (title) ist erforderlich' });
      }

      if (wp.start_date && wp.end_date) {
        if (new Date(wp.start_date) > new Date(wp.end_date)) {
          errors.push({
            ref,
            rowIndex: rowLabel,
            message: `Startdatum (${wp.start_date}) liegt nach dem Enddatum (${wp.end_date})`,
          });
        }
      }

      const dur = this._parseDuration(wp.duration);
      if (dur !== null && wp.start_date && wp.end_date) {
        warnings.push({
          ref,
          rowIndex: rowLabel,
          message: 'Dauer wird ignoriert, da Start- und Enddatum gesetzt sind',
        });
      }

      if (dur !== null && dur <= 0) {
        errors.push({ ref, rowIndex: rowLabel, message: 'Dauer muss größer als 0 sein' });
      }
    });

    return { errors, warnings, valid: errors.length === 0 };
  }

  _parseDuration(duration) {
    if (duration === null || duration === undefined || duration === '') return null;
    const n = Number(duration);
    return Number.isFinite(n) ? n : null;
  }
}

module.exports = Validator;
