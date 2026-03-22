/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { SingleFileUpload, FolderUpload } from './components/FileUpload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from './components/ui/card';
import { Button } from './components/ui/button';
import { FileSpreadsheet, FileText, Download, Loader2, AlertCircle, CheckCircle, Github } from 'lucide-react';
import {
  buildNtbPdfPassword,
  extractNtbMessageMetadata,
  extractPdfAttachmentFromMsg,
  extractPdfTextWithPassword,
  isNtbStatementContent,
  normalizeMessageContent,
  parseExcel,
  parseCommercialStatementFile,
  parseMsgContent,
  parseNtbPdfContent,
  processFiles,
  type ProcessedResult,
  type MsgTransaction
} from './utils/parser';
import * as XLSX from 'xlsx';
import { motion } from 'motion/react';
import { trackEvent } from './utils/analytics';

function App() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [msgFiles, setMsgFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileIssues, setFileIssues] = useState<string[]>([]);
  
  const issueReason = (issue: string): string => {
    const normalized = issue.toLowerCase();
    if (normalized.includes('merchant id not found')) return 'merchant_id_not_found';
    if (normalized.includes('password')) return 'password_failed';
    if (normalized.includes('not a valid pdf')) return 'invalid_pdf';
    if (normalized.includes('pdf attachment not found')) return 'pdf_attachment_missing';
    if (normalized.includes('commercial bank workbook')) return 'commercial_parse_failed';
    if (normalized.includes('no transactions found')) return 'no_transactions_found';
    if (normalized.includes('unable to parse')) return 'parse_failed';
    return 'other';
  };

  const handleProcess = async () => {
    if (!excelFile || msgFiles.length === 0) {
      setError("Please upload both the Excel file and the MSG folder.");
      return;
    }

    const startedAt = performance.now();
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setFileIssues([]);
    trackEvent('process_started', {
      excel_extension: excelFile.name.split('.').pop()?.toLowerCase() || 'unknown',
      log_file_count: msgFiles.length
    });

    try {
      // 1. Parse Excel
      const excelData = await parseExcel(excelFile);

      // 2. Parse MSG Files
      const msgTransactions: MsgTransaction[] = [];
      const issues: string[] = [];
      const pdfFiles = msgFiles.filter(file => file.name.toLowerCase().endsWith('.pdf'));
      const pdfFilesByName = new Map<string, File>(pdfFiles.map(file => [file.name.toLowerCase(), file] as [string, File]));
      const consumedPdfNames = new Set<string>();
      let commercialRecords = 0;
      let ntbRecords = 0;
      let sampathRecords = 0;

      const findNtbPdfFile = (attachmentName: string | null, merchantId: string | null): File | null => {
        if (attachmentName) {
          const matchedByAttachmentName = pdfFilesByName.get(attachmentName.toLowerCase());
          if (matchedByAttachmentName) return matchedByAttachmentName;
        }

        if (merchantId) {
          const matchedByMerchantId = pdfFiles.find(file =>
            file.name.toLowerCase().includes(merchantId.toLowerCase()) && file.name.toLowerCase().endsWith('statement.pdf')
          );
          if (matchedByMerchantId) return matchedByMerchantId;
        }

        return null;
      };
      
      // Process files in chunks to avoid blocking UI too much
      for (const file of msgFiles) {
        // Simple filter: Check if filename looks relevant or just try to parse all text files
        // User said "Check files which as that SAMPATH... pattern"
        // We will read content and check for "SAMPATH" inside parseMsgContent logic or here.
        // Let's read content first.
        
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
          try {
            const commercialTransactions = await parseCommercialStatementFile(file);
            if (commercialTransactions.length > 0) {
              msgTransactions.push(...commercialTransactions);
              commercialRecords += commercialTransactions.length;
              trackEvent('bank_parser_used', {
                bank: 'commercial',
                transactions: commercialTransactions.length
              });
            }
          } catch {
            issues.push(`Skipped ${file.name}: unable to parse Commercial Bank workbook.`);
          }
          continue;
        }

        if (lowerName.endsWith('.txt') || lowerName.endsWith('.msg')) {
          const rawText = await file.text();
          const normalizedText = normalizeMessageContent(rawText);
          const isNtbFile = isNtbStatementContent(normalizedText) || file.name.toUpperCase().includes('NATIONS');

          if (isNtbFile) {
            const metadata = extractNtbMessageMetadata(normalizedText, file.name);

            if (!metadata.merchantId) {
              issues.push(`Skipped ${file.name}: NTB merchant ID not found.`);
              continue;
            }

            let pdfFile = findNtbPdfFile(metadata.attachmentName, metadata.merchantId);
            if (!pdfFile) {
              pdfFile = await extractPdfAttachmentFromMsg(file, metadata.attachmentName);
            }

            if (!pdfFile) {
              issues.push(`Skipped ${file.name}: PDF attachment not found in selected folder.`);
              continue;
            }

            const password = buildNtbPdfPassword(metadata.merchantId);

            try {
              const pdfText = await extractPdfTextWithPassword(pdfFile, password);
              const transactions = parseNtbPdfContent(pdfText, metadata.merchantId);
              if (transactions.length === 0) {
                issues.push(`Skipped ${file.name}: No transactions found in ${pdfFile.name}.`);
                continue;
              }

              consumedPdfNames.add(pdfFile.name.toLowerCase());
              msgTransactions.push(...transactions);
              ntbRecords += transactions.length;
              trackEvent('bank_parser_used', {
                bank: 'ntb',
                transactions: transactions.length
              });
            } catch (pdfError: any) {
              if (pdfError?.message === 'NTB_PDF_PASSWORD_FAILED') {
                issues.push(`Skipped ${file.name}: failed to open ${pdfFile.name} with password ${password}.`);
              } else if (pdfError?.message === 'NTB_PDF_INVALID') {
                issues.push(`Skipped ${file.name}: ${pdfFile.name} is not a valid PDF.`);
              } else {
                issues.push(`Skipped ${file.name}: unable to parse ${pdfFile.name} (${pdfError?.message || 'unknown error'}).`);
              }
              continue;
            }
          }

          // Existing Sampath text format parser
          if (normalizedText.includes('SAMPATH') || file.name.toUpperCase().includes('SAMPATH')) {
            const transactions = parseMsgContent(normalizedText);
            msgTransactions.push(...transactions);
            sampathRecords += transactions.length;
            if (transactions.length > 0) {
              trackEvent('bank_parser_used', {
                bank: 'sampath',
                transactions: transactions.length
              });
            }
          }
        }
      }

      // Optional fallback: process directly uploaded NTB PDFs too.
      for (const pdfFile of pdfFiles) {
        if (consumedPdfNames.has(pdfFile.name.toLowerCase())) continue;

        const metadata = extractNtbMessageMetadata('', pdfFile.name);
        if (!metadata.merchantId) continue;

        try {
          const pdfText = await extractPdfTextWithPassword(pdfFile, buildNtbPdfPassword(metadata.merchantId));
          const transactions = parseNtbPdfContent(pdfText, metadata.merchantId);
          if (transactions.length > 0) {
            msgTransactions.push(...transactions);
            ntbRecords += transactions.length;
            trackEvent('bank_parser_used', {
              bank: 'ntb',
              transactions: transactions.length
            });
          }
        } catch {
          issues.push(`Skipped ${pdfFile.name}: failed to open with password pattern ntb<Merchant ID>.`);
        }
      }

      for (const issue of issues) {
        trackEvent('file_skipped', { reason: issueReason(issue) });
      }
      setFileIssues(issues);

      if (msgTransactions.length === 0) {
        setError("No valid transactions found in the uploaded text files.");
        setIsProcessing(false);
        return;
      }

      // 3. Process and Match
      const processed = processFiles(excelData, msgTransactions);
      setResult(processed);
      trackEvent('process_completed', {
        matched_count: processed.summary.matchedCount,
        total_existing: Number(processed.summary.totalExisting.toFixed(2)),
        total_trx: Number(processed.summary.totalTrx.toFixed(2)),
        total_commission: Number(processed.summary.totalCommission.toFixed(2)),
        total_net: Number(processed.summary.totalNet.toFixed(2)),
        skipped_files: issues.length,
        parser_records_commercial: commercialRecords,
        parser_records_ntb: ntbRecords,
        parser_records_sampath: sampathRecords,
        duration_ms: Math.round(performance.now() - startedAt)
      });

    } catch (err) {
      console.error(err);
      setError("An error occurred during processing. Please check your files.");
      trackEvent('session_error', { step: 'handle_process', category: 'processing_failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    const ws = XLSX.utils.json_to_sheet(result.updatedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Processed Data");
    
    // Generate filename with timestamp
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toLocaleTimeString();
    XLSX.writeFile(wb, `processed_payment_data_${date}_${time}.xlsx`);
    trackEvent('download_excel', {
      rows_exported: result.updatedData.length
    });
  };

  const handleReset = () => {
    setExcelFile(null);
    setMsgFiles([]);
    setResult(null);
    setError(null);
    setFileIssues([]);
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans text-zinc-900">
      <div className="max-w-3xl mx-auto space-y-8">
        
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Payment Reconciliation</h1>
          <p className="text-zinc-500">Upload your payment schedule and transaction logs to reconcile records.</p>
          <a
            href="https://github.com/sithumonline/payment-reconciler.git"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900"
          >
            <Github className="w-4 h-4" />
            View on GitHub
          </a>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  Excel Data
                </CardTitle>
                <CardDescription>Upload the .xlsx or .csv file</CardDescription>
              </CardHeader>
              <CardContent>
                <SingleFileUpload 
                  label="Excel or CSV file" 
                  accept={{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'] }}
                  onFileSelect={setExcelFile}
                  selectedFile={excelFile}
                />
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Transaction Logs
                </CardTitle>
                <CardDescription>Upload folder containing MSG/TXT files</CardDescription>
              </CardHeader>
              <CardContent>
                <FolderUpload 
                  label="Transaction logs folder" 
                  onFilesSelect={(files) => setMsgFiles(prev => [...prev, ...files])}
                  fileCount={msgFiles.length}
                />
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="flex justify-center">
          <Button 
            size="lg" 
            onClick={handleProcess} 
            disabled={isProcessing || !excelFile || msgFiles.length === 0}
            className="w-full md:w-auto min-w-[200px] text-base"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              "Process Files"
            )}
          </Button>
        </div>

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-lg bg-red-50 border border-red-100 text-red-600 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </motion.div>
        )}

        {fileIssues.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-lg bg-amber-50 border border-amber-100 text-amber-700">
            <p className="font-semibold mb-2">Skipped files</p>
            <div className="space-y-1 text-sm">
              {fileIssues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          </motion.div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="border-emerald-100 bg-emerald-50/50">
              <CardHeader>
                <CardTitle className="text-emerald-900 flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                  Processing Complete
                </CardTitle>
                <CardDescription className="text-emerald-700">
                  Successfully matched {result.summary.matchedCount} records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white p-4 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-xs text-zinc-500 uppercase font-semibold">Total Existing</p>
                    <p className="text-xl font-mono font-medium text-zinc-900">
                      {result.summary.totalExisting.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-xs text-zinc-500 uppercase font-semibold">Total Trx Amount</p>
                    <p className="text-xl font-mono font-medium text-zinc-900">
                      {result.summary.totalTrx.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-xs text-zinc-500 uppercase font-semibold">Total Com Amount</p>
                    <p className="text-xl font-mono font-medium text-zinc-900">
                      {result.summary.totalCommission.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-xs text-zinc-500 uppercase font-semibold">Total Net Amount</p>
                    <p className="text-xl font-mono font-medium text-zinc-900">
                      {result.summary.totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex gap-3 justify-end">
                <Button variant="outline" onClick={handleReset} className="bg-white hover:bg-zinc-50 text-zinc-700 border-zinc-200">
                  Start Over
                </Button>
                <Button onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent">
                  <Download className="w-4 h-4 mr-2" />
                  Download Updated Excel
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default App;
