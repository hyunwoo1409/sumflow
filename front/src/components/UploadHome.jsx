import React, { useMemo } from "react";
import ItemCard from "./ItemCard";

export default function UploadHome({
  items,
  dragOver,
  setDragOver,
  onDrop,
  onStartAll,
  onUpload,
  onCancel,
  onRemove,
  onDownloadSummaryTxt,
  onDownloadSummaryPdf,
  inputRef,
  dirInputRef,
  acceptAttr,
  onDownloadAllZip,
}) {
  // 전체 진행도 = 각 아이템 퍼센트의 평균(서버 우선, 없으면 업로드 퍼센트)
  const overallProgressPct = useMemo(() => {
    if (!items.length) return 0;
    const percents = items.map((it) => {
      const sp = it.serverProgress || {};
      const serverClient = Number.isFinite(sp.client_percent) ? sp.client_percent : null;
      const serverPct    = Number.isFinite(sp.percent)        ? sp.percent        : null;
      const uploadPct    = Number.isFinite(it.uploadPct)
        ? it.uploadPct
        : Number.isFinite(it.progress)
        ? it.progress
        : 0;
      const p = serverClient ?? serverPct ?? uploadPct ?? 0;
      return Math.max(0, Math.min(100, Math.round(p)));
    });
    const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
    return Math.round(avg);
  }, [items]);

  const totalCount     = items.length;
  const doneCount      = items.filter((it) => it.status === "done").length;
  const uploadingCount = items.filter((it) => it.status === "uploading").length;
  const errorCount     = items.filter((it) => it.status === "error").length;

  return (
    <section className="space-y-5 max-w-screen-xl mx-auto">
      {/* 상단 액션바 */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          className="px-3 py-2 rounded-lg text-white text-sm font-semibold bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 active:scale-[0.99]"
          onClick={onStartAll}
          disabled={items.every((it) => it.status !== "idle")}
        >
          전체 업로드 시작
        </button>

        {/* 전체 ZIP 다운로드 (완료 항목 있을 때만 활성) */}
        <button
          className="px-3 py-2 rounded-lg text-white text-sm font-semibold bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
          onClick={onDownloadAllZip}
          disabled={doneCount === 0}
        >
          결과 ZIP
        </button>

        <div className="hidden sm:block w-px h-5 bg-gray-200 mx-1" />

        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          <span className="inline-flex items-center gap-1">
            전체 <b className="text-gray-900">{totalCount}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            진행중 <b className="text-gray-900">{uploadingCount}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            완료 <b className="text-gray-900">{doneCount}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            오류 <b className="text-gray-900">{errorCount}</b>
          </span>
        </div>

        <div className="sm:ml-auto text-[11px] text-gray-500">
          선택/드래그한 파일은 아직 서버에 업로드되지 않습니다.{" "}
          <span className="hidden sm:inline">
            “전체 업로드 시작”을 누르면 변환·요약·분류가 실행되고, 완료된 문서는 ZIP으로 받을 수 있습니다.
          </span>
        </div>

        {/* 숨김 input들 */}
        <input
          type="file"
          multiple
          accept={acceptAttr}
          ref={inputRef}
          className="hidden"
          aria-hidden="true"
        />
        <input type="file" multiple ref={dirInputRef} className="hidden" aria-hidden="true" />
      </div>

      {/* 전체 진행도 바 (종료시각/남은시간 표시는 제거) */}
      {items.length > 0 && (
        <div className="w-full max-w-xl">
          <div className="flex justify-between items-center text-xs text-gray-600 mb-1">
            <span>전체 진행도</span>
            <span>{overallProgressPct}%</span>
          </div>
          <div
            className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={overallProgressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-gradient-to-r from-[#FF54A1] to-[#B862FF] transition-all"
              style={{ width: `${overallProgressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* 드롭존 */}
      <div
        className={[
          "border-2 border-dashed rounded-xl p-7 sm:p-8 text-center transition cursor-pointer focus:outline-none focus:ring-2",
          dragOver ? "border-[#B862FF] bg-purple-50/30 ring-[#B862FF]/40" : "border-gray-300 bg-white",
        ].join(" ")}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-gray-800 text-sm font-medium">여기에 문서/ZIP/폴더를 드래그해서 추가하세요</div>
        <div className="text-gray-400 text-xs mt-1 leading-relaxed">
          지원: PDF · HWP/HWPX · DOC/DOCX · PPT/PPTX · XLS/XLSX · ZIP
          <br />
          ZIP은 자동으로 풀어서 내부 문서들이 추가됩니다.
        </div>
        <div className="text-gray-400 text-[11px] mt-1">또는 아래 버튼으로 선택할 수 있습니다.</div>

        <div className="flex flex-wrap justify-center gap-3 mt-4 text-sm">
          <button
            className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            파일 선택
          </button>
          <button
            className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            onClick={(e) => {
              e.stopPropagation();
              dirInputRef.current?.click();
            }}
          >
            폴더 선택
          </button>
        </div>
      </div>

      {/* 아이템 리스트 */}
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-sm text-gray-400">아직 추가된 문서가 없습니다.</div>
        )}

        {items.map((it) => (
          <ItemCard
            key={it.id}
            it={it}
            onUpload={onUpload}
            onCancel={onCancel}
            onRemove={onRemove}
            onDownloadSummaryTxt={onDownloadSummaryTxt}
            onDownloadSummaryPdf={onDownloadSummaryPdf}
          />
        ))}
      </div>
    </section>
  );
}