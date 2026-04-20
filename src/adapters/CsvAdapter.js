const fs = require('fs');
const { parse } = require('csv-parse/sync');
const BaseAdapter = require('./BaseAdapter');

/**
 * Reads CSV files and returns raw row objects (keys = header names).
 */
function detectCsvDelimiter(content) {
  const line = content.split(/\r?\n/).find((l) => String(l).trim() !== '');
  if (!line) return ',';
  const semi = line.split(';').length;
  const comma = line.split(',').length;
  return semi > comma ? ';' : ',';
}

class CsvAdapter extends BaseAdapter {
  async parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const delimiter = detectCsvDelimiter(content);
    return parse(content, { columns: true, skip_empty_lines: true, trim: true, delimiter });
  }
}

module.exports = CsvAdapter;
