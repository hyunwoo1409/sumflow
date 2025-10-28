// ============================================
//  API 기본 설정 & 공통 유틸
// ============================================

// 환경변수로 API base URL을 받되, 없으면 로컬 default
const API_BASE =
  import.meta.env?.VITE_API_URL || "http://127.0.0.1:4000";

// 상대 경로("/search/...")든 절대 경로든 받아서 완전한 URL로 바꿔주는 헬퍼
const absUrl = (p) => (p.startsWith("http") ? p : API_BASE + p);

// 로컬스토리지에 저장된 JWT 토큰 반환
function getToken() {
  return localStorage.getItem("token");
}

// Authorization 헤더 + Accept 헤더 구성
function authHeaders(extra = {}) {
  const token = getToken();
  const headers = {
    Accept: "application/json",
    ...extra,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

// fetch 결과를 JSON으로 파싱하되, 실패하면 text로 대체
async function parseSmart(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.toLowerCase().includes("application/json")) {
    return res.json();
  }
  return res.text();
}

// 공통 GET/POST 등 단일 요청 래퍼 (Authorization 자동 부착)
async function jsonFetch(path, { method = "GET", body, headers = {}, cache = "no-store", credentials } = {}) {
  const finalHeaders = { ...authHeaders(headers) };

  let finalBody = body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  const res = await fetch(absUrl(path), {
    method,
    headers: finalHeaders,
    body: finalBody,
    cache,
    credentials, // 필요 시 "include" 등 전달 가능
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
  }

  return parseSmart(res);
}

// "토큰 없이도 가능"하거나, 커스텀 헤더 세팅 없이 날것으로 부르고 싶은 경우에 쓸 수 있는 버전
async function plainFetch(fullPath, options = {}) {
  const res = await fetch(absUrl(fullPath), options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
  }
  return parseSmart(res);
}

// 안전하게 JSON 파싱 (문자열 → 객체)
function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return fallback ?? {};
  }
}

// ============================================
//  업로드 / OCR 관련 (XHR 사용)
//  - 이유: fetch로는 업로드 진행률(onprogress) 추적 불가
// ============================================

// content-type이 JSON인지 판별 (XHR 응답용)
function contentTypeIsJson(xhr) {
  const ct = xhr.getResponseHeader?.("content-type") || "";
  return ct.toLowerCase().includes("application/json");
}

// 요청 시작 전 XHR 공통 설정
function setupXhr({ xhr, onProgress, signal, timeoutMs }) {
  xhr.setRequestHeader("Accept", "application/json");

  // 업로드 진행률 이벤트
  xhr.upload.onprogress = (evt) => {
    if (evt.lengthComputable && typeof onProgress === "function") {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      onProgress(pct);
    }
  };

  // AbortController와 연동
  if (signal) {
    if (signal.aborted) {
      xhr.abort();
    } else {
      signal.addEventListener("abort", () => xhr.abort());
    }
  }

  // 타임아웃 설정 (선택)
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    xhr.timeout = timeoutMs;
  }
}

// XHR 완료 시 공통 처리
function handleXhrDone(xhr, resolve, reject) {
  const ok = xhr.status >= 200 && xhr.status < 300;
  const data = contentTypeIsJson(xhr)
    ? safeJsonParse(xhr.responseText, { raw: xhr.responseText })
    : { raw: xhr.responseText };

  if (ok) {
    resolve(data);
  } else {
    const msg =
      data?.detail ||
      data?.error ||
      data?.message ||
      `HTTP ${xhr.status}${xhr.statusText ? " " + xhr.statusText : ""}`;
    reject(new Error(msg));
  }
}

// 파일 1개 업로드용 (상대경로 포함 전송 가능)
export function uploadFile({
  file,
  url,
  onProgress,
  signal,
  extraForm = {},
  relpath,
  timeoutMs,
  withCredentials,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();

    // 파일 자체
    form.append("file", file);

    // 상대경로 보존 (폴더 업로드 시)
    const rp = relpath || file?.webkitRelativePath || file?._relPath || "";
    if (rp) {
      form.append("relpath", rp);
    }

    // 추가 파라미터들
    for (const [k, v] of Object.entries(extraForm || {})) {
      form.append(k, String(v));
    }

    xhr.open("POST", absUrl(url), true);

    // JWT 자동 부착
    const token = getToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (withCredentials) xhr.withCredentials = true;

    setupXhr({ xhr, onProgress, signal, timeoutMs });

    xhr.onload = () => handleXhrDone(xhr, resolve, reject);
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("사용자 취소"));
    xhr.ontimeout = () => reject(new Error("요청이 시간 초과되었습니다."));

    xhr.send(form);
  });
}

// 여러 파일을 한 번에 업로드 (서버가 files[], relpaths[] 받는 경우)
export function uploadFiles({
  files,
  url = "/ingest",
  onProgress,
  signal,
  extraForm = {},
  timeoutMs,
  withCredentials,
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();

    // 파일들 + 상대경로 배열
    const relpaths = [];
    for (const file of files) {
      form.append("files", file);
      const rp = file?.webkitRelativePath || file?._relPath || "";
      relpaths.push(rp);
    }
    // 서버에서 인덱스 매칭 가능하도록 relpaths[] 같이 전송
    relpaths.forEach((rp) => form.append("relpaths", rp));

    // 추가 필드들
    for (const [k, v] of Object.entries(extraForm || {})) {
      form.append(k, String(v));
    }

    xhr.open("POST", absUrl(url), true);

    // JWT
    const token = getToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (withCredentials) xhr.withCredentials = true;

    setupXhr({ xhr, onProgress, signal, timeoutMs });

    xhr.onload = () => handleXhrDone(xhr, resolve, reject);
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("사용자 취소"));
    xhr.ontimeout = () => reject(new Error("요청이 시간 초과되었습니다."));

    xhr.send(form);
  });
}

// (Deprecated) convertFile: 서버가 /convert 유지중이면 임시로 사용
export function convertFile({
  file,
  onProgress,
  signal,
  timeoutMs,
  withCredentials,
}) {
  console.warn(
    "[convertFile] Deprecated: /ocr/tesseract 등 단일화된 OCR 엔드포인트를 쓰는 게 권장됩니다."
  );
  return uploadFile({
    file,
    url: "/convert",
    onProgress,
    signal,
    timeoutMs,
    withCredentials,
  });
}

// OCR 업로드 & 처리 (/ocr/tesseract)
export function ocrFile({
  file,
  pdfPath,
  onProgress,
  signal,
  params = {
    dpi: 300,
    prep: "adaptive",
    langs: "kor+eng",
    psm: 6,
    keepExtra: false,
  },
  relpath,
  timeoutMs,
  withCredentials,
}) {
  return new Promise((resolve, reject) => {
    if (!file && !pdfPath) {
      reject(new Error("file 또는 pdfPath 중 하나는 필요합니다."));
      return;
    }

    const xhr = new XMLHttpRequest();
    const form = new FormData();

    if (file) {
      form.append("file", file);
      const rp = relpath || file?.webkitRelativePath || file?._relPath || "";
      if (rp) {
        form.append("relpath", rp);
      }
    }
    if (pdfPath) {
      form.append("pdf_path", pdfPath);
    }

    // OCR 파라미터들
    for (const [k, v] of Object.entries(params || {})) {
      form.append(k, String(v));
    }

    xhr.open("POST", absUrl("/ocr/tesseract"), true);

    // JWT
    const token = getToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (withCredentials) xhr.withCredentials = true;

    setupXhr({ xhr, onProgress, signal, timeoutMs });

    xhr.onload = () => handleXhrDone(xhr, resolve, reject);
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("사용자 취소"));
    xhr.ontimeout = () => reject(new Error("요청이 시간 초과되었습니다."));

    xhr.send(form);
  });
}

// 서버 경로만 주고 OCR 시키는 헬퍼
export function ocrByPath({
  pdfPath,
  params,
  signal,
  timeoutMs,
  withCredentials,
}) {
  return ocrFile({
    pdfPath,
    params,
    signal,
    timeoutMs,
    withCredentials,
  });
}

// 결과 파일 다운로드 URL 생성
export function downloadUrl(serverFileId, kind /* 'pdf'|'text'|'json' */) {
  if (!serverFileId) return "";
  return absUrl(`/download/${serverFileId}/${kind}`);
}

// ============================================
//  LLM / 텍스트 관련 유틸
// ============================================

// 스트리밍 요약
export async function streamLLM({
  text,
  model = "gemma3-summarizer",
  onChunk,
  signal,
}) {
  const res = await fetch(absUrl("/llm/summarize_stream"), {
    method: "POST",
    headers: {
      ...authHeaders({ "Content-Type": "application/json" }),
    },
    body: JSON.stringify({ text, model }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error("스트리밍 연결 실패");
  }

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

// OCR 결과 원문 텍스트 불러오기
export async function fetchOcrText(fileId) {
  const res = await fetch(absUrl(`/download/${fileId}/text`), {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error("원문 텍스트 조회 실패");
  }
  return res.text();
}

// OCR 요청을 fetch 기반으로 보내고 결과만 받고 싶을 때 (XHR 대신)
export async function uploadPdfToOCR({
  file,
  pdfPath,
  dpi = 300,
  prep = "adaptive",
  langs = "kor+eng",
  psm = 6,
  doLLMSummary = false,
  llmModel = "gemma3-summarizer",
  categoryName,
  titleOverride,
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
    headers: authHeaders(), // Authorization만 넣고, Content-Type은 FormData가 직접 세팅
    body: fd,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ============================================
//  검색 / 카테고리
// ============================================

export async function searchDocuments({
  q = "",
  categories = [],
  page = 1,
  pageSize = 20,
}) {
  const u = new URL(absUrl("/search/documents"));

  if (q) u.searchParams.set("q", q);
  u.searchParams.set("page", String(page));
  u.searchParams.set("pageSize", String(pageSize));
  (categories || []).forEach((c) => u.searchParams.append("category", c));

  const res = await fetch(u.toString(), {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`검색 실패 (${res.status}) ${msg}`);
  }
  return res.json();
}

export async function getCategories() {
  const res = await fetch(absUrl("/search/categories"), {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`카테고리 조회 실패 (${res.status}) ${msg}`);
  }

  const data = await res.json();

  const pairs = Array.isArray(data?.categories) ? data.categories : [];
  const mains = Array.isArray(data?.mains) ? data.mains : [];

  // "주카테고리/부카테고리" 문자열 (칩 라벨로 쓰기 쉬움)
  const joined = pairs
    .map(
      (p) =>
        p?.catPath || [p?.main, p?.sub].filter(Boolean).join("/")
    )
    .filter(Boolean);

  // { "교육": ["법률제도", "행정"], ... } 이런 형태로 트리 구성
  const tree = pairs.reduce((acc, p) => {
    const m = p?.main;
    const s = p?.sub;
    if (!m || !s) return acc;
    if (!acc[m]) acc[m] = new Set();
    acc[m].add(s);
    return acc;
  }, {});
  // Set → Array(+정렬)
  Object.keys(tree).forEach((m) => {
    tree[m] = Array.from(tree[m]).sort();
  });

  return {
    raw: data, // 서버 원본 응답
    categories: pairs,
    mains,
    joined,
    tree,
  };
}

// ============================================
//  관리자(Admin)
// ============================================

// 관리자 대시보드 통계 (최근7일 업로드/방문, 최근30일 가입/탈퇴 등)
export async function getAdminStatsSummary() {
  return jsonFetch("/admin/stats/summary", {
    method: "GET",
    cache: "no-store",
    // credentials 옵션이 필요하다면 여기서 넣을 수 있음:
    // credentials: "include",
  });
}

// 회원 관리 목록
export async function getAdminUsers({
  nickname = "",
  email = "",
  page = 1,
  pageSize = 20,
}) {
  const u = new URL(absUrl("/admin/users"));
  if (nickname) u.searchParams.set("nickname", nickname);
  if (email) u.searchParams.set("email", email);
  u.searchParams.set("page", page);
  u.searchParams.set("pageSize", pageSize);

  const res = await fetch(u.toString(), {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`회원 목록 조회 실패 (${res.status})`);
  }
  return res.json(); // { total, items:[...] }
}

// 파일 관리 목록
export async function getAdminFiles({
  nickname = "",
  filename = "",
  ocrStatus = "",
  page = 1,
  pageSize = 20,
}) {
  const u = new URL(absUrl("/admin/files"));
  if (nickname) u.searchParams.set("nickname", nickname);
  if (filename) u.searchParams.set("filename", filename);
  if (ocrStatus) u.searchParams.set("ocrStatus", ocrStatus); // "done" | "error"
  u.searchParams.set("page", page);
  u.searchParams.set("pageSize", pageSize);

  const res = await fetch(u.toString(), {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`파일 목록 조회 실패 (${res.status})`);
  }
  return res.json(); // { total, items:[...] }
}