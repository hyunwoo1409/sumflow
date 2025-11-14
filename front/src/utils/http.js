// ============================================
//  기본 설정 / 공통 유틸 (http.js)
// ============================================

import { getToken } from "./authStorage"; // <-- 세션/로컬 정책 반영된 토큰

// 환경변수로 API base URL을 받되, 없으면 로컬 default
export const API_BASE =
  import.meta.env?.VITE_API_URL || "http://127.0.0.1:4000";

// 상대 경로("/search/...")든 절대 경로든 받아서 완전한 URL로 바꿔주는 헬퍼
export function absUrl(p) {
  return /^https?:\/\//i.test(p) ? p : API_BASE + p;
}

// Authorization 헤더 + Accept 헤더 구성
export function authHeaders(extra = {}) {
  const token = getToken();
  const headers = { Accept: "application/json", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// fetch 결과를 JSON으로 파싱하되, 실패하면 text로 대체
export async function parseSmart(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// 안전하게 JSON 파싱 (문자열 → 객체)
export function safeJsonParse(text, fallback = {}) {
  try { return JSON.parse(text || "{}"); } catch { return fallback ?? {}; }
}

/**
 * 공통 요청 헬퍼
 */
export async function request(path, options = {}) {
  const url = /^https?:\/\//i.test(path) ? path : API_BASE + path;
  const headers = { ...(options.headers || {}) };

  // JWT 자동 부착
  const token = getToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  // body JSON 자동화(FormData는 그대로)
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const res = await fetch(url, { ...options, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

/**
 * 간단 JSON 호출 래퍼
 */
export async function jsonFetch(
  path,
  { method = "GET", body, headers = {}, cache = "no-store", credentials } = {}
) {
  const finalHeaders = { ...authHeaders(headers) };
  let finalBody = body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }
  const res = await fetch(absUrl(path), {
    method, headers: finalHeaders, body: finalBody, cache, credentials,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
  }
  return parseSmart(res);
}

export async function plainFetch(fullPath, options = {}) {
  const res = await fetch(absUrl(fullPath), options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
  }
  return parseSmart(res);
}

// ============================================
//  업로드 / OCR (XHR 기반 - 진행률 트래킹 지원)
// ============================================

function contentTypeIsJson(xhr) {
  const ct = xhr.getResponseHeader?.("content-type") || "";
  return ct.toLowerCase().includes("application/json");
}

function setupXhr({ xhr, onProgress, signal, timeoutMs }) {
  xhr.setRequestHeader("Accept", "application/json");

  xhr.upload.onprogress = (evt) => {
    if (evt.lengthComputable && typeof onProgress === "function") {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      onProgress(pct, { loaded: evt.loaded, total: evt.total, ts: Date.now() });
    }
  };

  if (signal) {
    if (signal.aborted) xhr.abort();
    else signal.addEventListener("abort", () => xhr.abort());
  }

  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    xhr.timeout = timeoutMs;
  }
}

function handleXhrDone(xhr, resolve, reject) {
  const ok = xhr.status >= 200 && xhr.status < 300;
  const data = contentTypeIsJson(xhr)
    ? safeJsonParse(xhr.responseText, { raw: xhr.responseText })
    : { raw: xhr.responseText };

  if (ok) resolve(data);
  else {
    const msg =
      data?.detail ||
      data?.error ||
      data?.message ||
      `HTTP ${xhr.status}${xhr.statusText ? " " + xhr.statusText : ""}`;
    reject(new Error(msg));
  }
}

export function uploadFile({
  file, url, onProgress, signal, extraForm = {}, relpath, timeoutMs, withCredentials,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();

    form.append("file", file);

    const rp = relpath || file?.webkitRelativePath || file?._relPath || "";
    if (rp) form.append("relpath", rp);

    for (const [k, v] of Object.entries(extraForm || {})) {
      if (v == null) continue;
      // File/Blob은 그대로
      if (v instanceof File || v instanceof Blob) {
        form.append(k, v);
        continue;
      }
      // 배열은 펼쳐서 append
      if (Array.isArray(v)) {
        for (const x of v) {
          if (x instanceof File || x instanceof Blob) form.append(k, x);
          else form.append(k, String(x));
        }
        continue;
      }
      // boolean/number/object -> 문자열
      form.append(k, String(v));
    }

    xhr.open("POST", absUrl(url), true);

    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (withCredentials) xhr.withCredentials = true;

    setupXhr({ xhr, onProgress, signal, timeoutMs });

    xhr.onload = () => handleXhrDone(xhr, resolve, reject);
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("사용자 취소"));
    xhr.ontimeout = () => reject(new Error("요청이 시간 초과되었습니다."));

    xhr.send(form);
  });
}

export function uploadFiles({
  files, url = "/ingest", onProgress, signal, extraForm = {}, timeoutMs, withCredentials,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();

    const relpaths = [];
    for (const file of files) {
      form.append("files", file);
      const rp = file?.webkitRelativePath || file?._relPath || "";
      relpaths.push(rp);
    }
    relpaths.forEach((rp) => form.append("relpaths", rp));

    for (const [k, v] of Object.entries(extraForm || {})) {
      form.append(k, String(v));
    }

    xhr.open("POST", absUrl(url), true);

    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (withCredentials) xhr.withCredentials = true;

    setupXhr({ xhr, onProgress, signal, timeoutMs });

    xhr.onload = () => handleXhrDone(xhr, resolve, reject);
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("사용자 취소"));
    xhr.ontimeout = () => reject(new Error("요청이 시간 초과되었습니다."));

    xhr.send(form);
  });
}

export function convertFile({ file, onProgress, signal, timeoutMs, withCredentials }) {
  console.warn("[convertFile] Deprecated: /ocr/tesseract 등 단일화된 OCR 엔드포인트를 쓰는 게 권장됩니다.");
  return uploadFile({ file, url: "/convert", onProgress, signal, timeoutMs, withCredentials });
}

// === OCR 파이프라인 (폴링 + 자동 커밋) ===
export function ocrFile({
  file,
  pdfPath,
  onProgress,
  signal,
  params = { dpi: 300, prep: "adaptive", langs: "kor+eng", psm: 6, keepExtra: false },
  relpath,
  timeoutMs = 5 * 60 * 1000,
  withCredentials,
  autoCommit = true, // 기본 자동 커밋
}) {
  return (async () => {
    if (!file && !pdfPath) throw new Error("file 또는 pdfPath 중 하나는 필요합니다.");

    const fd = new FormData();
    if (file) {
      fd.append("file", file);
      fd.append("files", file);
      const rp = relpath || file.webkitRelativePath || file._relPath || "";
      if (rp) fd.append("relpath", rp);
    }
    if (pdfPath) fd.append("pdf_path", pdfPath);
    for (const [k, v] of Object.entries(params || {})) fd.append(k, String(v));

    const token = typeof getToken === "function" ? getToken() : null;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // 1) 업로드
    onProgress?.(5);
    const upRes = await fetch(absUrl("/api/v1/ocr/upload"), {
      method: "POST",
      headers,
      body: fd,
      signal,
      credentials: withCredentials ? "include" : "same-origin",
      cache: "no-store",
    });
    if (!upRes.ok) throw new Error((await upRes.text().catch(() => "")) || `Upload HTTP ${upRes.status}`);
    const upJson = await upRes.json().catch(() => ({}));
    const batchId = upJson?.batch_id || upJson?.batchId || upJson?.data?.batch_id;
    const taskId =
      upJson?.task_id || upJson?.taskId || upJson?.data?.task_id ||
      upJson?.tasks?.[0]?.task_id || upJson?.tasks?.[0]?.id;
    if (!batchId || !taskId) throw new Error("업로드 응답에 batch_id / task_id가 없습니다.");

    // 2) 폴링
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let lastPct = 10;
    onProgress?.(lastPct);

    async function poll() {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const r = await fetch(absUrl(`/api/v1/task/status/${taskId}`), {
        headers,
        signal,
        credentials: withCredentials ? "include" : "same-origin",
        cache: "no-store",
      });
      if (!r.ok) throw new Error((await r.text().catch(() => "")) || `Status HTTP ${r.status}`);
      const s = await r.json().catch(() => ({}));

      const st = String(s?.state ?? s?.status ?? s?.task_state ?? s?.celery_state ?? "").toUpperCase();

      if (st === "PENDING") lastPct = Math.max(lastPct, 15);
      else if (st === "RECEIVED" || st === "STARTED") lastPct = Math.max(lastPct, 45);
      else if (st === "RETRY") lastPct = Math.max(lastPct, 60);
      else if (st === "SUCCESS") lastPct = 98;
      else if (st === "FAILURE" || st === "REVOKED") lastPct = 100;
      onProgress?.(lastPct);

      const resultObj = s?.result ?? s?.data ?? s?.info ?? s?.payload ?? null;
      const hasMeaningfulResult = !!(
        resultObj &&
        (resultObj.summary || resultObj.llm_summary || resultObj.category || resultObj.category_name)
      );

      if (st === "SUCCESS" || s?.ready === true || hasMeaningfulResult) {
        return { state: st || "SUCCESS", result: s?.result ?? (hasMeaningfulResult ? resultObj : null) };
      }
      if (st === "FAILURE" || st === "REVOKED") {
        const det = resultObj ? JSON.stringify(resultObj) : "작업 실패";
        throw new Error(det);
      }
      if (Date.now() > deadline) throw new Error("OCR 작업 시간 초과");

      await new Promise((res) => setTimeout(res, 1200));
      return poll();
    }

    const status = await poll();

    // 3) 결과 매핑
    const result = status?.result ?? {};
    const summary = (result?.summary || result?.llm_summary || "").trim();
    const category = result?.category || result?.category_name || null;

    // 4) 자동 커밋 (로그인 토큰이 있을 때)
    let commitData = null;
    if (autoCommit && token) {
      const originalFilename =
        file?.name ||
        (typeof pdfPath === "string" ? pdfPath.split(/[\\/]/).pop() : null) ||
        "uploaded.pdf";
      const fileSizeBytes = file?.size ?? 0;

      try {
        commitData = await commitOcrResult({
          batchId,
          taskId,
          originalFilename,
          fileSizeBytes,
          withCredentials,
        });
      } catch (e) {
        console.warn("auto-commit failed:", e);
      }
    }

    onProgress?.(100);

    return {
      id: taskId,
      outDir: `${batchId}/${taskId}`,
      llmSummary: summary,
      category,
      batchId,
      taskId,
      documentId: commitData?.document_id ?? null,
      committed: !!commitData?.ok,
    };
  })();
}

// === DB 커밋 API ===
export async function commitOcrResult({
  batchId,
  taskId,
  originalFilename,
  changedFilename,      
  fileSizeBytes,
  ownerUserId,          
  title,
  withCredentials,
}) {
  const token = typeof getToken === "function" ? getToken() : null;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const body = {
    batch_id: batchId,
    task_id: taskId,
    original_filename: originalFilename,
    changed_filename: changedFilename,   
    file_size_bytes: fileSizeBytes ?? 0,
    owner_user_id: ownerUserId ?? null,
    title: title ?? null,
  };

  const res = await fetch(absUrl("/api/v1/ocr/commit"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: withCredentials ? "include" : "same-origin",
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data; // { ok, document_id, changed_filename, original_filename, ... }
}

// 서버에 있는 파일 경로만 넘겨 OCR 시키고 싶을 때
export function ocrByPath({ pdfPath, params, signal, timeoutMs, withCredentials }) {
  return ocrFile({ pdfPath, params, signal, timeoutMs, withCredentials });
}

// (선택) 구 API
export async function uploadPdfToOCR({
  file, pdfPath, dpi = 300, prep = "adaptive", langs = "kor+eng", psm = 6,
  doLLMSummary = false, llmModel = "gemma3-summarizer", categoryName, titleOverride,
}) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  if (pdfPath) fd.append("pdf_path", pdfPath);
  fd.append("dpi", String(dpi));
  fd.append("prep", prep);
  fd.append("langs", langs);
  fd.append("psm", String(psm));
  fd.append("do_llm_summary", String(!!doLLMSummary));
  fd.append("llm_model", llmModel);
  if (categoryName) fd.append("category_name", categoryName);
  if (titleOverride) fd.append("title_override", titleOverride);

  const res = await fetch(absUrl("/ocr/tesseract"), {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================
//  LLM / 다운로드
// ============================================

export async function streamLLM({ text, model = "gemma3-summarizer", onChunk, signal }) {
  const res = await fetch(absUrl("/llm/summarize_stream"), {
    method: "POST",
    headers: { ...authHeaders({ "Content-Type": "application/json" }) },
    body: JSON.stringify({ text, model }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error("스트리밍 연결 실패");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    if (onChunk) onChunk(chunk, full);
  }
  return full;
}

export async function fetchOcrText(fileId) {
  const res = await fetch(absUrl(`/download/${fileId}/text`), { headers: authHeaders() });
  if (!res.ok) throw new Error("원문 텍스트 조회 실패");
  return res.text();
}

export function downloadUrl(serverFileId, kind /* 'pdf'|'text'|'json' */) {
  if (!serverFileId) return "";
  return absUrl(`/download/${serverFileId}/${kind}`);
}

export async function apiPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const detail = data?.detail || data?.message || res.statusText || "요청에 실패했습니다.";
    const err = new Error(detail);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}


//  업로드만 하고 task_id 받기(큐잉 전용)
//  - UI가 배치 폴링으로 진행도 추적할 때 사용
export async function enqueueOcr({
  file,
  pdfPath,
  params = { dpi: 300, prep: "adaptive", langs: "kor+eng", psm: 6, keepExtra: false },
  relpath,
  withCredentials,
}) {
  if (!file && !pdfPath) throw new Error("file 또는 pdfPath 중 하나는 필요합니다.");

  const fd = new FormData();
  if (file) {
    fd.append("file", file);
    fd.append("files", file);
    const rp = relpath || file.webkitRelativePath || file._relPath || "";
    if (rp) fd.append("relpath", rp);
  }
  if (pdfPath) fd.append("pdf_path", pdfPath);
  for (const [k, v] of Object.entries(params || {})) fd.append(k, String(v));

  const token = typeof getToken === "function" ? getToken() : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const upRes = await fetch(absUrl("/api/v1/ocr/upload"), {
    method: "POST",
    headers,
    body: fd,
    credentials: withCredentials ? "include" : "same-origin",
    cache: "no-store",
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok) throw new Error(upJson?.detail || `Upload HTTP ${upRes.status}`);

  const batchId = upJson?.batch_id || upJson?.batchId || upJson?.data?.batch_id;
  const taskId =
    upJson?.task_id || upJson?.taskId || upJson?.data?.task_id ||
    upJson?.tasks?.[0]?.task_id || upJson?.tasks?.[0]?.id;

  if (!batchId || !taskId) throw new Error("업로드 응답에 batch_id / task_id가 없습니다.");

  return { batchId, taskId };
}

//  진행도 배치 조회 API 래퍼
export async function getProgressBatch(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return {};
  const data = await jsonFetch("/api/v1/progress/batch", {
    method: "POST",
    body: { ids },
    headers: {},
    cache: "no-store",
  });
  return data?.results || {};
}

//  배치 폴링 매니저
//      - watch(taskId)로 등록하면 1초마다 묶어서 조회
//      - onUpdate(results)로 { [taskId]: {percent, eta_seconds, ...} } 전달
export function createBatchProgressManager({ intervalMs = 1000 } = {}) {
  let ids = new Set();
  let timer = null;

  async function tick(onUpdate) {
    if (ids.size === 0) return;
    try {
      const results = await getProgressBatch(Array.from(ids));
      onUpdate?.(results);
      // 완료/실패는 자동 제거
      for (const [tid, v] of Object.entries(results)) {
        if (v.state === "SUCCESS" || v.state === "FAILURE" || v.percent === 100) {
          ids.delete(tid);
        }
      }
    } catch (e) {
      console.error("batch progress error", e);
    }
  }

  function start(onUpdate) {
    if (timer) return;
    timer = setInterval(() => tick(onUpdate), intervalMs);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function watch(tid) { if (tid) ids.add(tid); }
  function unwatch(tid) { ids.delete(tid); }
  function reset() { ids = new Set(); }

  return { start, stop, watch, unwatch, reset };
}