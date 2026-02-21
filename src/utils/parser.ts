import * as XLSX from 'xlsx';

export interface ExcelRow {
  '#'?: string | number;
  'Voucher No.'?: string;
  'Total'?: number | string;
  [key: string]: any;
}

export interface MsgTransaction {
  merchantNumber: string;
  cardNumber: string;
  tranAmount: number;
  commission: number;
  netAmount: number;
  authId: string;
}

export interface ProcessedResult {
  updatedData: any[];
  summary: {
    totalExisting: number;
    totalTrx: number;
    totalNet: number;
    matchedCount: number;
  };
}

export const parseExcel = async (file: File): Promise<ExcelRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<ExcelRow>(sheet);
        resolve(json);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const parseMsgContent = (content: string): MsgTransaction[] => {
  const transactions: MsgTransaction[] = [];
  const lines = content.split('\n');
  
  let merchantNumber = '';
  let inTable = false;

  // Regex to find Merchant Number
  // "MERCHANT NUMBER      :3010147"
  const merchantRegex = /MERCHANT NUMBER\s*:\s*(\d+)/i;

  // Regex for table row
  // It's fixed width or space separated. 
  // Example:
  // 532016XXXXXX3032         EDC                  144      49,900.00      49,900.00         898.20      49,001.80  02/02/2026  074680  37012252                         OTHERBANK  MASTERCARD
  // We need: Card Number (1), Tran Amount (4), Commission (6), Net Amount (7), Auth ID (9)
  // Let's try to match by structure.
  
  for (const line of lines) {
    // Extract Merchant Number
    const merchantMatch = line.match(merchantRegex);
    if (merchantMatch) {
      merchantNumber = merchantMatch[1];
    }

    // Check for table start
    if (line.includes('Visa / Master Transactions')) {
      // The next lines might be headers, then data.
      // We can look for the separator line or just start looking for data patterns.
      continue;
    }
    
    if (line.includes('=====')) {
      inTable = !inTable; // Toggle table state if we encounter separators
      // Actually, usually there's a separator before and after data. 
      // But let's just look for data lines that match our pattern.
      continue;
    }

    // Data line pattern
    // Card number starts with digits and X
    if (line.trim().match(/^\d{6}[X\d]+\d{4}/)) {
      // Split by multiple spaces
      const parts = line.trim().split(/\s{2,}/);
      
      // parts[0] = Card Number
      // parts[1] = Type (EDC)
      // parts[2] = Currency (144)
      // parts[3] = Tran Amount
      // parts[4] = Gross Amount
      // parts[5] = Commission
      // parts[6] = Net Amount
      // parts[7] = Date
      // parts[8] = Auth ID
      // ...
      
      if (parts.length >= 9) {
        const cardNumber = parts[0];
        const tranAmount = parseFloat(parts[3].replace(/,/g, ''));
        const commission = parseFloat(parts[5].replace(/,/g, ''));
        const netAmount = parseFloat(parts[6].replace(/,/g, ''));
        const authId = parts[8];

        transactions.push({
          merchantNumber,
          cardNumber,
          tranAmount,
          commission,
          netAmount,
          authId
        });
      }
    }
  }

  return transactions;
};

export const processFiles = (excelData: ExcelRow[], msgTransactions: MsgTransaction[]): ProcessedResult => {
  // Remove duplicate transactions (common when same source file is added twice).
  const seenTransactions = new Set<string>();
  const uniqueMsgTransactions = msgTransactions.filter(t => {
    const key = [
      t.authId,
      t.merchantNumber,
      t.cardNumber,
      t.tranAmount,
      t.commission,
      t.netAmount
    ].join('|');

    if (seenTransactions.has(key)) {
      return false;
    }

    seenTransactions.add(key);
    return true;
  });

  // Create a map for fast lookup
  const msgMap = new Map<string, MsgTransaction>();
  uniqueMsgTransactions.forEach(t => {
    // Normalize Auth ID (remove leading zeros if necessary, or keep as string)
    // CSV Voucher No might be "074680" or "74680". 
    // Let's try to match exactly first, maybe handle loose matching if needed.
    msgMap.set(t.authId, t);
  });

  let totalExisting = 0;
  let totalTrx = 0;
  let totalNet = 0;
  let matchedCount = 0;
  const matchedAuthIds = new Set<string>();

  const updatedData = excelData.map(row => {
    const voucherNo = row['Voucher No.'];
    let match: MsgTransaction | undefined;

    if (voucherNo) {
      match = msgMap.get(voucherNo.toString());
      // Fallback: try removing leading zeros from voucherNo if not found
      if (!match && typeof voucherNo === 'string' && voucherNo.startsWith('0')) {
         match = msgMap.get(voucherNo.replace(/^0+/, ''));
      }
    }

    // Accumulate existing total
    const existingTotal = typeof row['Total'] === 'number' ? row['Total'] : parseFloat((row['Total'] || '0').toString().replace(/,/g, ''));
    if (!isNaN(existingTotal)) {
      totalExisting += existingTotal;
    }

    if (match) {
      matchedCount++;
      totalTrx += match.tranAmount;
      totalNet += match.netAmount;
      matchedAuthIds.add(match.authId);

      return {
        ...row,
        AUTH: match.authId,
        'MERCHANT NUMBER': match.merchantNumber,
        'TRX.AMT': match.tranAmount,
        'CARD NUMBER': match.cardNumber,
        'COM. AMOUNT': match.commission,
        'NET. AMT': match.netAmount
      };
    } else {
      return {
        ...row,
        AUTH: '',
        'MERCHANT NUMBER': '',
        'TRX.AMT': '',
        'CARD NUMBER': '',
        'COM. AMOUNT': '',
        'NET. AMT': ''
      };
    }
  });

  const unmatchedRows = uniqueMsgTransactions
    .filter(t => !matchedAuthIds.has(t.authId))
    .map(t => ({
      '#': '',
      'Voucher No.': '',
      Total: '',
      AUTH: t.authId,
      'MERCHANT NUMBER': t.merchantNumber,
      'TRX.AMT': t.tranAmount,
      'CARD NUMBER': t.cardNumber,
      'COM. AMOUNT': t.commission,
      'NET. AMT': t.netAmount
    }));

  const summary = {
    totalExisting,
    totalTrx,
    totalNet,
    matchedCount
  };

  const totalsRow = {
    '#': '',
    'Voucher No.': 'TOTAL',
    Total: summary.totalExisting,
    AUTH: '',
    'MERCHANT NUMBER': '',
    'TRX.AMT': summary.totalTrx,
    'CARD NUMBER': '',
    'COM. AMOUNT': '',
    'NET. AMT': summary.totalNet
  };

  const spacerRows = Array.from({ length: 5 }, () => ({
    '#': '',
    'Voucher No.': '',
    Total: '',
    AUTH: '',
    'MERCHANT NUMBER': '',
    'TRX.AMT': '',
    'CARD NUMBER': '',
    'COM. AMOUNT': '',
    'NET. AMT': ''
  }));

  const unmatchedHeaderRow = {
    '#': '#',
    'Voucher No.': 'Voucher No.',
    Total: 'Total',
    AUTH: 'AUTH',
    'MERCHANT NUMBER': 'MERCHANT NUMBER',
    'TRX.AMT': 'TRX.AMT',
    'CARD NUMBER': 'CARD NUMBER',
    'COM. AMOUNT': 'COM. AMOUNT',
    'NET. AMT': 'NET. AMT'
  };

  return {
    updatedData: [...updatedData, totalsRow, ...spacerRows, unmatchedHeaderRow, ...unmatchedRows],
    summary
  };
};
