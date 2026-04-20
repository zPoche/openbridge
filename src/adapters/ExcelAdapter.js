const XLSX = require('xlsx');
const BaseAdapter = require('./BaseAdapter');

/**
 * Reads Excel files and returns raw row objects (keys = first-row headers).
 */
class ExcelAdapter extends BaseAdapter {
  async parse(filePath) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: null });
  }
}

module.exports = ExcelAdapter;
