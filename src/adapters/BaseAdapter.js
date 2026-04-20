/**
 * BaseAdapter
 * All adapters must extend this and implement parse().
 */
class BaseAdapter {
  /**
   * @param {string} filePath
   * @returns {Array<WorkPackage>} Unified intermediate format
   */
  async parse(filePath) {
    throw new Error('parse() must be implemented by adapter');
  }

  /**
   * Build a unified work package object from raw row data.
   */
  buildWorkPackage({
    local_id = null,
    parent_local_id = null,
    openproject_id = null,
    title = '',
    type = null,
    status = null,
    start_date = null,
    end_date = null,
    duration = null,
    description = '',
    assignee = null,
    predecessors = [],
  } = {}) {
    // Duration rule: never send duration when start+end are both set
    const resolvedDuration =
      start_date && end_date ? null : duration;

    return {
      local_id,
      parent_local_id,
      openproject_id,
      title,
      type,
      status,
      start_date,
      end_date,
      duration: resolvedDuration,
      description,
      assignee,
      predecessors,
    };
  }
}

module.exports = BaseAdapter;
