import ExcelJS from 'exceljs';

/**
 * Generate a styled RTL Arabic .xlsx Buffer from tabular report data.
 */
export async function buildExcelBuffer({ sheetTitle, headings, rows }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Correspondence Tracker';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetTitle || 'التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.addRow(headings);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Cairo', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  rows.forEach((rowValues, idx) => {
    const row = sheet.addRow(rowValues);
    row.eachCell(cell => {
      cell.font = { name: 'Cairo', size: 10.5, color: { argb: 'FF0F172A' } };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  sheet.columns = headings.map((h, i) => {
    const maxLen = Math.max(
      String(h).length,
      ...rows.map(r => String(r[i] ?? '').length),
    );
    return { width: Math.min(Math.max(maxLen + 6, 16), 44) };
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

