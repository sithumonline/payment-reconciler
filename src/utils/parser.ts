import * as XLSX from 'xlsx';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import MsgReader from 'msgreader';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

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
    totalCommission: number;
    totalNet: number;
    matchedCount: number;
  };
}

export interface NtbMessageMetadata {
  attachmentName: string | null;
  merchantId: string | null;
}

export const normalizeMessageContent = (content: string): string => {
  return content.replace(/\u0000/g, '');
};

export const isNtbStatementContent = (content: string): boolean => {
  return /Nations Trust|Merchant E-\s*Statement|ntb<Merchant ID>/i.test(content);
};

export const extractNtbMessageMetadata = (content: string, fallbackName = ''): NtbMessageMetadata => {
  const normalized = normalizeMessageContent(content);

  const attachmentMatch = normalized.match(/X-FE-Attachment-Name:\s*([^\r\n]+\.pdf)/i);
  const attachmentName = attachmentMatch?.[1]?.trim() || null;

  const sourceForMerchantId = [attachmentName, fallbackName, normalized].filter(Boolean).join('\n');
  const merchantMatch =
    sourceForMerchantId.match(/\b(\d{8,})_\d{8,}Statement\.pdf\b/i) ||
    sourceForMerchantId.match(/Account\s*Number\s*:?\s*(\d{8,})/i);

  return {
    attachmentName,
    merchantId: merchantMatch?.[1] || null
  };
};

export const buildNtbPdfPassword = (merchantId: string): string => `ntb${merchantId}`;

const parseAmount = (value: string): number => parseFloat(value.replace(/,/g, '').trim());

export const extractPdfTextWithPassword = async (file: File, password: string): Promise<string> => {
  const data = new Uint8Array(await file.arrayBuffer());

  try {
    const loadingTask = getDocument({
      data,
      password,
      disableWorker: true
    } as any);

    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();

      pages.push(text);
    }

    return pages.join('\n');
  } catch (error: any) {
    const message = (error?.message || '').toLowerCase();
    if (
      error?.name === 'PasswordException' ||
      error?.code === 1 ||
      error?.code === 2 ||
      message.includes('password')
    ) {
      throw new Error('NTB_PDF_PASSWORD_FAILED');
    }
    if (error?.name === 'InvalidPDFException' || message.includes('invalid pdf')) {
      throw new Error('NTB_PDF_INVALID');
    }
    throw error;
  }
};

export const parseNtbPdfContent = (content: string, merchantIdFallback = ''): MsgTransaction[] => {
  const transactions: MsgTransaction[] = [];
  const merchantMatch = content.match(/Account\s*Number\s*:?\s*(\d{8,})/i);
  const merchantNumber = merchantMatch?.[1] || merchantIdFallback;

  const rowRegex =
    /(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+([0-9*Xx\-]+)\s+(\d{4,})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(content)) !== null) {
    const cardNumber = rowMatch[3];
    const authId = rowMatch[4];
    const tranAmount = parseAmount(rowMatch[5]);
    const commission = parseAmount(rowMatch[6]);
    const netAmount = tranAmount - commission;

    if (!isNaN(tranAmount) && !isNaN(commission)) {
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

  return transactions;
};

const toUint8Array = (value: any): Uint8Array | null => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

export const extractPdfAttachmentFromMsg = async (
  file: File,
  preferredAttachmentName: string | null
): Promise<File | null> => {
  try {
    const msgReader = new (MsgReader as any)(await file.arrayBuffer());
    const msgData = msgReader.getFileData();
    if (msgData?.error || !Array.isArray(msgData?.attachments)) return null;

    const preferredName = preferredAttachmentName?.toLowerCase() ?? '';
    const attachments = msgData.attachments as Array<{ fileName?: string }>;

    let selectedAttachment = attachments.find((attachment) =>
      (attachment?.fileName || '').toLowerCase() === preferredName
    );

    if (!selectedAttachment) {
      selectedAttachment = attachments.find((attachment) =>
        (attachment?.fileName || '').toLowerCase().endsWith('.pdf')
      );
    }

    if (!selectedAttachment) return null;

    const attachment = msgReader.getAttachment(selectedAttachment);
    const bytes = toUint8Array(attachment?.content);
    const fileName = attachment?.fileName || selectedAttachment.fileName || 'attachment.pdf';

    if (!bytes || bytes.byteLength === 0) return null;

    const safeBytes = new Uint8Array(bytes.byteLength);
    safeBytes.set(bytes);
    return new File([safeBytes], fileName, { type: 'application/pdf' });
  } catch {
    return null;
  }
};

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
  let totalCommission = 0;
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
      totalCommission += match.commission;
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

  const byMerchantNumber = (a: any, b: any) => {
    const merchantA = (a['MERCHANT NUMBER'] || '').toString().trim();
    const merchantB = (b['MERCHANT NUMBER'] || '').toString().trim();

    // Keep rows without merchant number at the end.
    if (!merchantA && merchantB) return 1;
    if (merchantA && !merchantB) return -1;

    const merchantCompare = merchantA.localeCompare(merchantB, undefined, { numeric: true });
    if (merchantCompare !== 0) return merchantCompare;

    const authA = (a.AUTH || '').toString().trim();
    const authB = (b.AUTH || '').toString().trim();
    return authA.localeCompare(authB, undefined, { numeric: true });
  };

  const groupedUpdatedData = [...updatedData].sort(byMerchantNumber);
  const groupedUnmatchedRows = [...unmatchedRows].sort(byMerchantNumber);

  const summary = {
    totalExisting,
    totalTrx,
    totalCommission,
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
    'COM. AMOUNT': summary.totalCommission,
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
    '#': '',
    'Voucher No.': '',
    Total: '',
    AUTH: 'AUTH',
    'MERCHANT NUMBER': 'MERCHANT NUMBER',
    'TRX.AMT': 'TRX.AMT',
    'CARD NUMBER': 'CARD NUMBER',
    'COM. AMOUNT': 'COM. AMOUNT',
    'NET. AMT': 'NET. AMT'
  };

  return {
    updatedData: [...groupedUpdatedData, totalsRow, ...spacerRows, unmatchedHeaderRow, ...groupedUnmatchedRows],
    summary
  };
};
