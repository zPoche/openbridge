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

      // Required: title
      if (!wp.title) {
        errors.push({ ref, message: 'Thema (title) is required' });
      }

      // Date logic: start must be before end
      if (wp.start_date && wp.end_date) {
        if (new Date(wp.start_date) > new Date(wp.end_date)) {
          errors.push({ ref, message: `Start date (${wp.start_date}) is after end date (${wp.end_date})` });
        }
      }

      // Duration conflict: duration + start + end = conflict
      if (wp.duration && wp.start_date && wp.end_date) {
        warnings.push({ ref, message: 'duration will be ignored because start and end date are both set' });
      }

      // Duration must be > 0 if set
      if (wp.duration !== null && wp.duration <= 0) {
        errors.push({ ref, message: 'duration must be greater than 0' });
      }
    });

    return { errors, warnings, valid: errors.length === 0 };
  }
}

module.exports = Validator;
