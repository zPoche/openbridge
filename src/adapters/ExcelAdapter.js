const XLSX = require('xlsx');
const BaseAdapter = require('./BaseAdapter');

class ExcelAdapter extends BaseAdapter {
  constructor(columnMapping = {}) {
    super();
    // Default column mapping — can be overridden by saved profile
    this.mapping = {
      local_id:        columnMapping.local_id        || 'ID',
      parent_local_id: columnMapping.parent_local_id || 'Parent',
      openproject_id:  columnMapping.openproject_id  || 'OpenProject ID',
      title:           columnMapping.title           || 'Thema',
      type:            columnMapping.type            || 'Typ',
      status:          columnMapping.status          || 'Status',
      start_date:      columnMapping.start_date      || 'Anfangstermin',
      end_date:        columnMapping.end_date        || 'Endtermin',
      duration:        columnMapping.duration        || 'Dauer',
      description:     columnMapping.description     || 'Beschreibung',
      assignee:        columnMapping.assignee        || 'Zuständig',
    };
  }

  async parse(filePath) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    return rows
      .filter(row => row[this.mapping.title]) // skip empty rows
      .map(row => this.buildWorkPackage({
        local_id:        this._val(row, 'local_id'),
        parent_local_id: this._val(row, 'parent_local_id'),
        openproject_id:  this._val(row, 'openproject_id'),
        title:           this._val(row, 'title'),
        type:            this._val(row, 'type'),
        status:          this._val(row, 'status'),
        start_date:      this._formatDate(this._val(row, 'start_date')),
        end_date:        this._formatDate(this._val(row, 'end_date')),
        duration:        this._val(row, 'duration'),
        description:     this._val(row, 'description'),
        assignee:        this._val(row, 'assignee'),
      }));
  }

  _val(row, field) {
    const col = this.mapping[field];
    return col ? (row[col] ?? null) : null;
  }

  _formatDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    // Handle Excel serial numbers
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value);
      return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
    }
    return value;
  }
}

module.exports = ExcelAdapter;
