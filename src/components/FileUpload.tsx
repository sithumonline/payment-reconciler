import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FolderInput, CheckCircle2 } from 'lucide-react';
import { cn } from './ui/card';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: Record<string, string[]>;
  label: string;
  icon?: React.ReactNode;
  selectedFile?: File | null;
}

export function SingleFileUpload({ onFileSelect, accept, label, icon, selectedFile }: FileUploadProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    multiple: false
  } as any);

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl transition-colors cursor-pointer",
        isDragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50",
        selectedFile ? "border-emerald-500 bg-emerald-50/30" : ""
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
        {selectedFile ? (
          <>
            <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-500" />
            <p className="mb-1 text-sm font-medium text-zinc-900 truncate max-w-[200px]">
              {selectedFile.name}
            </p>
            <p className="text-xs text-zinc-500">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </>
        ) : (
          <>
            {icon || <Upload className="w-10 h-10 mb-3 text-zinc-400" />}
            <p className="mb-2 text-sm text-zinc-500">
              <span className="font-semibold text-zinc-900">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-zinc-400">{label}</p>
          </>
        )}
      </div>
    </div>
  );
}

interface FolderUploadProps {
  onFilesSelect: (files: File[]) => void;
  label: string;
  fileCount: number;
}

export function FolderUpload({ onFilesSelect, label, fileCount }: FolderUploadProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFilesSelect(acceptedFiles);
    }
  }, [onFilesSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true
  } as any);

  // Handler for the manual folder selection input
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelect(Array.from(e.target.files));
    }
  };

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl transition-colors cursor-pointer",
          isDragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50",
          fileCount > 0 ? "border-emerald-500 bg-emerald-50/30" : ""
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
          {fileCount > 0 ? (
            <>
              <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-500" />
              <p className="mb-1 text-sm font-medium text-zinc-900">
                {fileCount} files selected
              </p>
              <p className="text-xs text-zinc-500">
                Ready to process
              </p>
            </>
          ) : (
            <>
              <FolderInput className="w-10 h-10 mb-3 text-zinc-400" />
              <p className="mb-2 text-sm text-zinc-500">
                Drag & drop a <span className="font-semibold text-zinc-900">folder</span> here
              </p>
              <p className="text-xs text-zinc-400">{label}</p>
            </>
          )}
        </div>
      </div>
      
      {/* Fallback for clicking to select a folder specifically if drag/drop isn't preferred */}
      <div className="mt-2 text-center">
        <label className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer underline">
          Or click here to browse folder
          <input
            type="file"
            className="hidden"
            {...({ webkitdirectory: "", directory: "" } as any)}
            onChange={handleFolderSelect}
            multiple
          />
        </label>
      </div>
    </div>
  );
}
