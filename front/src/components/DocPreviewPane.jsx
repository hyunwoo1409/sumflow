import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { joinUrl } from "../utils/uploadHelpers";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const btn =
  "inline-flex items-center justify-center px-2 py-1 rounded-md text-[12px] font-medium border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed";
const badge =
  "shrink-0 inline-flex items-center rounded-full border border-violet-200 bg-violet-50/80 px-2 py-0.5 text-[10px] font-medium text-violet-700 shadow-sm";

function getExt(name = "") {
  const i = name.lastIndexOf(".");
  return i > -1 ? name.slice(i + 1).toLowerCase() : "";
}

function displayNameOf(doc = {}) {
  // 화면 표시용 이름: 변경된(ASCII) 파일명 우선
  return (
    doc.changed_filename ??
    doc.CHANGED_FILENAME ??
    doc.filename ??
    doc.title ??
    doc.originalFilename ??
    doc.ORIGINAL_FILENAME ??
    `문서 ${doc.id ?? doc.DOCUMENT_ID ?? ""}`.trim()
  );
}

export default function DocPreviewPane({ doc, onClose }) {
  // ---------------- state/refs ----------------
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [summary, setSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const lastRenderRef = useRef({ page: 0, width: 0 });
  const pdfDocRef = useRef(null);
  const lastFetchedSummaryUrlRef = useRef(null);

  // ---------------- keys/urls ----------------
  const downloadKey = useMemo(() => {
    return (
      doc?.id ??
      doc?.DOCUMENT_ID ??
      doc?.documentId ??
      doc?.RESULT_FOLDER_ID ??
      doc?.result_folder_id ??
      doc?.BATCH_ID ??
      doc?.batch_id ??
      doc?.serverFileId ??
      null
    );
  }, [doc]);

  const fname = useMemo(() => displayNameOf(doc), [doc]);

  const ext = useMemo(
    () => getExt(fname) || getExt(String(downloadKey || "")),
    [fname, downloadKey]
  );

  const isPDF = ext === "pdf";
  const isImage = ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext);
  const canIframe = ["txt", "md", "html"].includes(ext);

  const originalUrl = useMemo(
    () => (downloadKey ? joinUrl(`/download/${downloadKey}/original`) : null),
    [downloadKey]
  );
  const summaryUrl = useMemo(
    () => (downloadKey ? joinUrl(`/download/${downloadKey}/text`) : null),
    [downloadKey]
  );

  // ---------------- 요약 로딩 ----------------
  useEffect(() => {
    let abort = false;
    (async () => {
      if (!summaryUrl) {
        setSummary("");
        lastFetchedSummaryUrlRef.current = null;
        return;
      }
      if (lastFetchedSummaryUrlRef.current === summaryUrl) return;
      lastFetchedSummaryUrlRef.current = summaryUrl;

      setLoadingSummary(true);
      try {
        const res = await fetch(summaryUrl, { cache: "no-store" });
        if (!res.ok) {
          if (!abort) setSummary("요약 파일이 없습니다.");
        } else {
          const text = await res.text();
          if (!abort) setSummary(text || "");
        }
      } catch {
        if (!abort) setSummary("(요약 텍스트를 불러오지 못했습니다)");
      } finally {
        if (!abort) setLoadingSummary(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [summaryUrl]);

  // ---------------- PDF 로딩 ----------------
  useEffect(() => {
    let cancelled = false;
    pdfDocRef.current = null;
    setPdfError("");
    setPageNum(1);
    setPageCount(1);

    if (!isPDF || !originalUrl) return;

    setPdfLoading(true);
    const task = pdfjsLib.getDocument(originalUrl);
    task.promise
      .then((pdf) => {
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPageCount(pdf.numPages);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setPdfError("PDF 미리보기에 실패했습니다.");
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });

    return () => {
      cancelled = true;
      try {
        task?.destroy?.();
      } catch {}
    };
  }, [isPDF, originalUrl]);

  // ---------------- PDF 렌더 ----------------
  const renderPdfPage = useCallback(async (pageNo) => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container) return;

    const cs = getComputedStyle(container);
    const padding =
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const containerWidth = (container.clientWidth || 800) - padding;

    if (
      lastRenderRef.current.page === pageNo &&
      Math.abs(lastRenderRef.current.width - containerWidth) < 1
    )
      return;

    try {
      setPdfLoading(true);
      const page = await pdf.getPage(
        Math.min(Math.max(1, pageNo), pdf.numPages)
      );

      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.max(0.5, containerWidth / baseViewport.width);
      const vp = page.getViewport({ scale: fitScale });

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = canvas.getContext("2d");

      canvas.style.width = `${Math.ceil(vp.width)}px`;
      canvas.style.height = `${Math.ceil(vp.height)}px`;
      canvas.width = Math.ceil(vp.width * dpr);
      canvas.height = Math.ceil(vp.height * dpr);

      await page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;

      lastRenderRef.current = { page: pageNo, width: containerWidth };
    } catch (e) {
      console.error(e);
      setPdfError("PDF 렌더링 중 오류가 발생했습니다.");
    } finally {
      setPdfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isPDF || !originalUrl) return;
    renderPdfPage(pageNum);
  }, [isPDF, originalUrl, pageNum, renderPdfPage]);

  // 리사이즈 디바운스
  useEffect(() => {
    if (!isPDF || !originalUrl) return;
    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        renderPdfPage(pageNum);
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [isPDF, originalUrl, pageNum, renderPdfPage]);

  const goPrev = () => setPageNum((p) => Math.max(1, p - 1));
  const goNext = () => setPageNum((p) => Math.min(pageCount, p + 1));

  return (
    <aside className="w-full border-l border-gray-200 bg-white p-4 sticky top-0 h-[100dvh] flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 truncate">
            {fname} {ext && <span className={badge}>{ext.toUpperCase()}</span>}
          </div>
          <div className="text-[11px] text-gray-500">
            {downloadKey ? `Key: ${downloadKey}` : "미연결 파일"}
          </div>
        </div>
        <button className={btn} onClick={onClose}>
          닫기
        </button>
      </div>

      {/* 페이지네이션 */}
      {isPDF && (
        <div className="mb-2 flex items-center gap-2">
          <button className={btn} onClick={goPrev} disabled={pageNum <= 1 || pdfLoading}>
            이전
          </button>
          <span className="text-[12px] text-gray-700">
            {pageNum} / {pageCount}
          </span>
          <button className={btn} onClick={goNext} disabled={pageNum >= pageCount || pdfLoading}>
            다음
          </button>
        </div>
      )}

      {/* 미리보기 */}
      <div className="flex-1 min-h-0 rounded-lg border border-gray-200 overflow-hidden">
        {/* PDF */}
        {isPDF && (
          <div ref={containerRef} className="p-2 h-full overflow-auto">
            {pdfError && <div className="text-[12px] text-rose-600">{pdfError}</div>}
            {!pdfError && (
              <>
                {pdfLoading && (
                  <div className="text-[12px] text-gray-400 mb-2">
                    PDF 불러오는 중…
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  className="block w-full h-auto rounded bg-white"
                />
              </>
            )}
          </div>
        )}

        {/* 이미지 */}
        {isImage && originalUrl && (
          <div className="h-full overflow-auto p-2">
            <img
              src={originalUrl}
              alt={fname}
              className="block w-full h-auto bg-white"
              loading="lazy"
            />
          </div>
        )}

        {/* 텍스트/HTML */}
        {canIframe && originalUrl && (
          <iframe
            title="original-preview"
            src={originalUrl}
            className="w-full h-full bg-white"
          />
        )}

        {/* 기타 */}
        {!isPDF && !isImage && !canIframe && (
          <div className="p-4 text-[12px] text-gray-600 h-full overflow-auto">
            이 형식은 브라우저 미리보기를 지원하지 않습니다.
            {originalUrl && (
              <div className="mt-2">
                <a
                  href={originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-blue-600"
                >
                  원본 파일 열기/다운로드
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 요약 */}
      <div className="mt-4">
        <div className="text-[12px] text-gray-800 font-medium mb-1">요약</div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 h-40 overflow-auto text-[12px] text-gray-800 whitespace-pre-wrap">
          {loadingSummary ? "요약 불러오는 중…" : summary || "요약이 없습니다."}
        </div>
      </div>
    </aside>
  );
}