"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { withAuthTokenUrl } from "@/lib/api";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfOriginalViewerProps {
  pdfUrl: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
}

export default function PdfOriginalViewer({
  pdfUrl,
  initialPage = 1,
  onPageChange,
}: PdfOriginalViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(Math.max(1, initialPage));
  const [scale, setScale] = useState<number>(1.15);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const authedUrl = withAuthTokenUrl(pdfUrl);

  const goPage = (nextPage: number) => {
    const clamped = Math.max(1, numPages > 0 ? Math.min(numPages, nextPage) : nextPage);
    setPageNumber(clamped);
    onPageChange?.(clamped);
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Original PDF Toolbar */}
      <div className="sticky top-14 z-20 w-full max-w-[880px] bg-[#f9f8f6] border border-[#1c1c1c]/15 px-4 py-2.5 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => goPage(pageNumber - 1)}
            aria-label="上一页"
            className="p-1.5 border border-[#1c1c1c]/20 disabled:opacity-35 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] tracking-[0.12em] px-2">
            第 {pageNumber} / {numPages || "?"} 页
          </span>
          <button
            type="button"
            disabled={numPages > 0 && pageNumber >= numPages}
            onClick={() => goPage(pageNumber + 1)}
            aria-label="下一页"
            className="p-1.5 border border-[#1c1c1c]/20 disabled:opacity-35 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}
            aria-label="缩小"
            className="p-1.5 border border-[#1c1c1c]/20 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[12px] w-14 text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.2, +(s + 0.15).toFixed(2)))}
            aria-label="放大"
            className="p-1.5 border border-[#1c1c1c]/20 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {errorMsg ? (
        <div className="w-full max-w-[760px] border border-[#816d70] p-6 text-[13px] text-[#816d70]">
          原版 PDF 加载失败：{errorMsg}
        </div>
      ) : (
        <div className="w-full overflow-x-auto flex justify-center pb-12">
          <Document
            file={authedUrl}
            onLoadSuccess={({ numPages: total }) => {
              setNumPages(total);
              setErrorMsg(null);
            }}
            onLoadError={(err) => setErrorMsg(err.message)}
            loading={
              <div className="py-16 text-[13px] text-[#6b7280] tracking-[0.15em] uppercase">
                正在加载原版 PDF...
              </div>
            }
          >
            <div className="border border-[#1c1c1c]/15 bg-white">
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </div>
          </Document>
        </div>
      )}
    </div>
  );
}
