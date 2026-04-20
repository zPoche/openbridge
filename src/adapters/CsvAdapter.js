const fs = require('fs');
const { parse } = require('csv-parse/sync');
const BaseAdapter = require('./BaseAdapter');

class CsvAdapter extends BaseAdapter {
  constructor(columnMapping = {}) {
    super();
    this.mapping = columnMapping;
  }

  async parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

    return rows
      .filter(row => row[this.mapping.title || 'Thema'])
      .map(row => this.buildWorkPackage({
        local_id:        row[this.mapping.local_id]        || null,
        parent_local_id: row[this.mapping.parent_local_id] || null,
        openproject_id:  row[this.mapping.openproject_id]  || null,
        title:           row[this.mapping.title]           || '',
        type:            row[this.mapping.type]            || 'Task',
        status:          row[this.mapping.status]          || null,
        start_date:      row[this.mapping.start_date]      || null,
        end_date:        row[this.mapping.end_date]        || null,
        duration:        row[this.mapping.duration]        || null,
        description:     row[this.mapping.description]     || '',
        assignee:        row[this.mapping.assignee]        || null,
      }));
  }
}

module.exports = CsvAdapter;
