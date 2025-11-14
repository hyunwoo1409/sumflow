import React from "react";
import {
  prettyBytes,
  fileIcon,
  saveText,
  savePdf,
  sanitizeCategory,
} from "../utils/uploadHelpers";

/* ========= 카테고리 유틸 (그대로) ========= */
function deriveCatPath(doc = {}) {
  let joined =
    doc.catPath ??
    doc.category_path ??
    doc.CATEGORY_PATH ??
    doc.categoryName ??
    doc.category_name ??
    doc.CATEGORY_NAME ??
    "";

  if (Array.isArray(joined)) joined = joined.filter(Boolean).join("/");

  const main =
    doc.mainCategory ??
    doc.main_category ??
    doc.MAIN_CATEGORY ??
    doc.mainCat ??
    doc.main_cat ??
    "";
  const sub =
    doc.subCategory ??
    doc.sub_category ??
    doc.SUB_CATEGORY ??
    doc.subCat ??
    doc.sub_cat ??
    "";

  if (joined) joined = String(joined).trim();
  else if (main && sub) joined = `${main}/${sub}`;
  else if (main) joined = String(main);
  else {
    const relPath =
      doc.relPath ??
      doc.relativePath ??
      doc.path ??
      doc.dirPath ??
      doc.folderPath ??
      doc.REL_PATH ??
      doc.RELATIVE_PATH ??
      doc.PATH ??
      doc.DIR_PATH ??
      doc.FOLDER_PATH ??
      doc?.file?.webkitRelativePath ??
      doc?.file?._relPath ??
      "";

    const fname =
      doc?.file?.name ??
      doc.changed_filename ??
      doc.CHANGED_FILENAME ??
      doc.filename ??
      doc.title ??
      doc.originalFilename ??
      doc.ORIGINAL_FILENAME ??
      "";

    const fromRel = sanitizeCategory("", { relPath, fallback: "" });
    if (fromRel) joined = fromRel;
    else joined = sanitizeCategory(fname, { fallback: "Uncategorized" });
  }

  const parts = String(joined)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.length ? parts : ["Uncategorized"];
}

// 단계 → 한글 라벨
function stageToKr(sp) {
  const s = String(sp?.stage || sp?.state || "").toUpperCase();
  switch (s) {
    case "QUEUED":     return "대기 중";
    case "RECEIVED":
    case "STARTED":
    case "INGEST":
    case "OCR":        return "텍스트 추출 중";
    case "OCR_DONE":   return "요약 준비 중"; // ← 추가
    case "LLM":        return "요약 중";
    case "CATEGORY":   return "분류 중";
    case "SUCCESS":
    case "DONE":       return "완료";
    case "FAILURE":    return "실패";
    default:           return "처리 중";
  }
}

function displayNameOf(doc = {}) {
  return (
    doc?.file?.name ??
    doc.changed_filename ??
    doc.CHANGED_FILENAME ??
    doc.filename ??
    doc.title ??
    doc.originalFilename ??
    doc.ORIGINAL_FILENAME ??
    "Untitled"
  );
}

function extractCategoryFromSummary(summary = "") {
  if (!summary) return null;
  const cleaned = summary.replace(/<\|file_separator\|>/g, "");
  const m = cleaned.match(/카테고리\s*[:：]\s*([^\n\r]+)\s*$/m);
  if (!m) return null;
  let cat = (m[1] || "")
    .replace(/[`"'“”‘’»]+/g, "")
    .trim()
    .replace(/\s*\/\s*/g, "/");
  if (!cat.includes("/")) cat = `${cat}/일반`;
  return cat;
}

function normalizeTwoLevels(cat) {
  if (!cat) return "기타/일반";
  let s = String(cat).replace(/\s*\/\s*/g, "/").trim();
  if (!s) return "기타/일반";
  const parts = s.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `${parts[0]}/일반`;
  return "기타/일반";
}

function getBackendCategory(it) {
  const v =
    it?.result?.category ??
    it?.category ??
    it?.category_name ??
    it?.categoryName ??
    it?.llm_meta?.llm_data?.category_name ??
    it?.LLM_META?.LLM_DATA?.CATEGORY_NAME ??
    null;
  return v ? normalizeTwoLevels(v) : null;
}

/* ========= ETA/표시 유틸 ========= */
function fmtHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return m ? `${m}분 ${ss}초` : `${ss}초`;
}
function parseFinishAt(v) {
  if (v == null) return null;
  // epoch(초) 또는 ISO 문자열 모두 지원
  const ms =
    typeof v === "number"
      ? (v > 1e12 ? v : v * 1000)
      : Date.parse(v);
  if (!ms || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ItemCard({
  it,
  onUpload,
  onCancel,
  onRemove,
}) {
  const fileName = displayNameOf(it);
  const relPath = it?.file?.webkitRelativePath || it?.file?._relPath || "";
  const fileSize = prettyBytes(it?.file?.size || 0);

  // 진행도(업로드 → 서버 처리)
  const sp = it?.serverProgress || {};
  const serverPct = Number.isFinite(sp.client_percent)
    ? Math.round(sp.client_percent)
    : Number.isFinite(sp.percent)
    ? Math.round(sp.percent)
    : null;
  const uploadPct = Number.isFinite(it?.uploadPct)
    ? Math.round(it.uploadPct)
    : Number.isFinite(it?.progress)
    ? Math.round(it.progress)
    : 0;

  const isUploading = it.status === "uploading";
  const isProcessing = it.status === "processing";
  const isDone = it.status === "done" || serverPct === 100;
  const isError = it.status === "error";
  const isInProgress = (isUploading || isProcessing) && !isError;

  const displayPct = Math.max(
    0,
    Math.min(100, isProcessing ? (serverPct ?? 0) : uploadPct)
  );

  const stageLabel = isUploading ? "업로드 중" : (isProcessing ? stageToKr(sp) : "");

  // ===== ETA 계산/표시 (업로드/서버 공통) =====
  // 1) 종료시각은 displayFinishAt(단조감소 보장) → 없으면 업로드/서버 순으로 대체
  const finishAtEpoch =
    it.displayFinishAt ??
    (isUploading ? it.uploadFinishAt : (sp.finish_at ?? sp.client_finish_at));

  // 2) 우선 종료시각 기준으로 남은 초 계산(3초 미만은 숨김)
  let etaSeconds = null;
  if (Number.isFinite(finishAtEpoch)) {
    const remain = Math.round(finishAtEpoch - Date.now() / 1000);
    etaSeconds = remain >= 3 ? remain : null;
  } else {
    // 3) 종료시각이 없으면 남은 초 필드 사용(3초 미만은 숨김)
    const raw = isUploading ? it.uploadEtaSeconds : (sp.eta_seconds ?? sp.client_eta_seconds);
    etaSeconds = (Number.isFinite(raw) && raw >= 3) ? raw : null;
  }

  const finishAtLabel = parseFinishAt(finishAtEpoch);
  const etaText =
    Number.isFinite(etaSeconds)
      ? `약 ${fmtHMS(etaSeconds)} 남음`
      : finishAtLabel || null;

  // 결과 표시 준비
  const summaryTextRaw = it?.result?.summary ?? it?.summary ?? "";
  const summaryText = summaryTextRaw.replace(/<\|file_separator\|>/g, "").trim();
  const catBackend = getBackendCategory(it);
  const catFromSummary = catBackend ? null : extractCategoryFromSummary(summaryTextRaw);
  const finalCat = normalizeTwoLevels(catBackend ?? catFromSummary ?? "");
  const cats = deriveCatPath({ ...it, relPath });

  return (
    <article className="rounded-lg border border-gray-200 bg-white shadow-sm p-4 flex flex-col gap-3" aria-live="polite">
      {/* 상단: 파일 정보 + 상태 뱃지 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="text-[20px] leading-none select-none">{fileIcon(fileName)}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate" title={fileName}>{fileName}</div>
              {relPath && (
                <div className="text-[11px] text-gray-500 truncate" title={relPath}>{relPath}</div>
              )}
              <div className="text-[11px] text-gray-400">{fileSize}</div>
            </div>
          </div>
        </div>

        <div className="text-xs font-medium">
          {it.status === "idle" && (
            <span className="inline-flex items-center rounded-md bg-gray-100 text-gray-700 border border-gray-200 px-2 py-0.5">대기</span>
          )}
          {isUploading && (
            <span className="inline-flex items-center rounded-md bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5">업로드 중</span>
          )}
          {isProcessing && (
            <span className="inline-flex items-center rounded-md bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5">
              {stageToKr(sp)}
            </span>
          )}
          {isDone && (
            <span className="inline-flex items-center rounded-md bg-green-100 text-green-700 border border-green-200 px-2 py-0.5">
              완료
            </span>
          )}
          {isError && (
            <span className="inline-flex items-center rounded-md bg-red-100 text-red-700 border border-red-200 px-2 py-0.5">
              오류
            </span>
          )}
        </div>
      </div>

      {/* 진행도 (업로드/서버 처리 모두 표시) */}
      {(isUploading || isProcessing) && (
        <div className="mt-1">
          <div className="flex justify-between text-[11px] text-gray-600 mb-1">
            <span>진행도{stageLabel ? ` · ${stageLabel}` : ""}</span>
            <span>{Number.isFinite(displayPct) ? `${displayPct}%` : "- -"}</span>
          </div>
          <div
            className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Number.isFinite(displayPct) ? displayPct : 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-gradient-to-r from-[#FF54A1] to-[#B862FF] transition-[width] duration-300"
              style={{ width: `${Number.isFinite(displayPct) ? displayPct : 5}%` }}
            />
          </div>
          {/* 업로드/서버 처리 공통으로 표기 (3초 미만이면 숨김 처리됨) */}
          {(isUploading || isProcessing) && etaText && (
            <div className="text-[11px] text-gray-500 mt-1">예상 종료: {etaText}</div>
          )}
        </div>
      )}

      {it.error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">
          ⚠ {String(it.error)}
        </div>
      )}

      {/* 액션 버튼들 */}
      <div className="flex flex-wrap gap-2 text-xs">
        {it.status === "idle" && (
          <button
            className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            onClick={() => onUpload?.(it.id)}
          >
            업로드
          </button>
        )}
        {/* 업로드 중 + 서버 처리 중 모두 취소 허용 */}
        {(isUploading || isProcessing) && (
          <button
            className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            onClick={() => onCancel?.(it.id)}
          >
            취소
          </button>
        )}
      </div>

      {/* 완료 후 결과 */}
      {isDone && (
        <div className="mt-1 space-y-3">
          <div>
            <div className="text-xs font-semibold text-gray-800 mb-1">요약</div>
            <pre className="bg-gray-50 border border-gray-200 text-[12px] text-gray-800 rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-auto">
              {summaryText || "요약 내용이 없습니다."}
            </pre>
          </div>

          {finalCat && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">카테고리</span>
              <span
                className="inline-flex items-center rounded-md bg-violet-50 text-violet-700 text-xs font-medium px-2 py-0.5 border border-violet-200"
                title={catBackend ? "source: backend" : "source: summary / fallback"}
              >
                {finalCat}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
              onClick={() =>
                saveText(
                  `${fileName.replace(/\.[^.]+$/, "")}_summary.txt`,
                  summaryText || ""
                )
              }
              disabled={!summaryText}
            >
              요약 .txt
            </button>
            <button
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
              onClick={() =>
                savePdf(
                  `${fileName.replace(/\.[^.]+$/, "")}_summary.pdf`,
                  summaryText || ""
                )
              }
              disabled={!summaryText}
            >
              요약 .pdf
            </button>
          </div>
        </div>
      )}
    </article>
  );
}