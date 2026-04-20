/**
 * IdRegistry
 * Maps local IDs (from import file) to real OpenProject IDs.
 * Used to resolve parent references in multi-pass imports.
 */
class IdRegistry {
  constructor() {
    this.map = new Map(); // local_id → openproject_id
  }

  register(local_id, openproject_id) {
    if (local_id) this.map.set(String(local_id), openproject_id);
  }

  resolve(local_id) {
    if (!local_id) return null;
    return this.map.get(String(local_id)) || null;
  }

  has(local_id) {
    return this.map.has(String(local_id));
  }
}

module.exports = IdRegistry;
