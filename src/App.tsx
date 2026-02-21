/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { SingleFileUpload, FolderUpload } from './components/FileUpload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from './components/ui/card';
import { Button } from './components/ui/button';
import { FileSpreadsheet, FileText, Download, Loader2, AlertCircle, CheckCircle, Github } from 'lucide-react';
import { parseExcel, parseMsgContent, processFiles, type ProcessedResult, type MsgTransaction } from './utils/parser';
import * as XLSX from 'xlsx';
import { motion } from 'motion/react';

function App() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [msgFiles, setMsgFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!excelFile || msgFiles.length === 0) {
      setError("Please upload both the Excel file and the MSG folder.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      // 1. Parse Excel
      const excelData = await parseExcel(excelFile);

      // 2. Parse MSG Files
      const msgTransactions: MsgTransaction[] = [];
      
      // Process files in chunks to avoid blocking UI too much
      for (const file of msgFiles) {
        // Simple filter: Check if filename looks relevant or just try to parse all text files
        // User said "Check files which as that SAMPATH... pattern"
        // We will read content and check for "SAMPATH" inside parseMsgContent logic or here.
        // Let's read content first.
        
        if (file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.msg')) {
           const text = await file.text();
           // Basic check if it's the right type of file before deep parsing
           if (text.includes('SAMPATH') || file.name.toUpperCase().includes('SAMPATH')) {
             const transactions = parseMsgContent(text);
             msgTransactions.push(...transactions);
           }
        }
      }

      if (msgTransactions.length === 0) {
        setError("No valid transactions found in the uploaded text files.");
        setIsProcessing(false);
        return;
      }

      // 3. Process and Match
      const processed = processFiles(excelData, msgTransactions);
      setResult(processed);

    } catch (err) {
      console.error(err);
      setError("An error occurred during processing. Please check your files.");
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
  };

  const handleReset = () => {
    setExcelFile(null);
    setMsgFiles([]);
    setResult(null);
    setError(null);
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
