const fs = require('fs');
const { parse } = require('csv-parse/sync');
const BaseAdapter = require('./BaseAdapter');

/**
 * Reads CSV files and returns raw row objects (keys = header names).
 */
class CsvAdapter extends BaseAdapter {
  async parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return parse(content, { columns: true, skip_empty_lines: true, trim: true });
  }
}

module.exports = CsvAdapter;
