import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import UploadHome from "../components/UploadHome";

import {
  extractFilesFromDataTransfer,
  extractFromZip,
  ACCEPT_EXT,
  MAX_SIZE_MB,
  prettyBytes,
  extractServerFileId,
  downloadAllResultsAsZip,
  joinUrl,
} from "../utils/uploadHelpers";

import {
  uploadFile,                    // XHR 업로드 (onprogress 지원)
  createBatchProgressManager,    // 배치 폴링 매니저
  absUrl,
  authHeaders,
  commitOcrResult,               // ✅ SUCCESS 후 DB 커밋
} from "../utils/http.js";

// 파일명에서 확장자 제거
function stem(name = "") {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
// 상대경로에서 top 폴더 추출 → 기본 카테고리
function topFolderOf(relPath = "") {
  if (!relPath) return "";
  const parts = relPath.split("/").filter(Boolean);
  return parts.length ? parts[0] : "";
}
function inferDefaultCategoryFromRel(rel) {
  return topFolderOf(rel) || "Uncategorized";
}
function inferDefaultTitle(filename) {
  return stem(filename);
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

function extractCategoryFromSummary(twoLinesOrPlain = "") {
  if (!twoLinesOrPlain) return null;
  const cleaned = twoLinesOrPlain.replace(/<\|file_separator\|>/g, "");
  const m = cleaned.match(/카테고리\s*[:：]\s*([^\n\r]+)\s*$/m);
  if (!m) return null;
  let cat = m[1] || "";
  cat = cat.replace(/[`"'“”‘’»]+/g, "").trim().replace(/\s*\/\s*/g, "/");
  if (!cat.includes("/")) cat = `${cat}/일반`;
  return cat;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/admin")) return "admin";
    if (p.startsWith("/mypage")) return "mypage";
    return "home";
  }, [location.pathname]);
  const etaCacheRef = useRef(new Map()); // taskId -> [{ts,p},...]

  // Sidebar가 기대하는 setter 자리에 no-op 넣어서 에러 방지
  const setActiveTab = () => {};

  // 업로드 대상 파일 상태
  const [items, setItems] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const dirInputRef = useRef(null);

  // 마이페이지 쪽 필터링에서 쓰는 검색/카테고리 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState(() => new Set());

  // 사이드바 접힘 상태
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 업로드 성공(SUCCESS) 후 결과 JSON을 **중복 조회하지 않기 위한** ref
  const fetchedResultRef = useRef(new Set());

  const downloadURL = (url, filename) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 서버에서 제공하는 요약 다운로드 URL 추정/활용
  const getSummaryUrl = (it, kind /* 'txt' | 'pdf' */) => {
    const fid = it?.result?.serverFileId;
    const ocr = it?.result?.ocr || {};

    if (kind === "txt" && (ocr.summaryTxtUrl || ocr.summary_txt_url)) {
      return ocr.summaryTxtUrl || ocr.summary_txt_url;
    }
    if (kind === "pdf" && (ocr.summaryPdfUrl || ocr.summary_pdf_url)) {
      return ocr.summaryPdfUrl || ocr.summary_pdf_url;
    }
    if (fid) {
      return joinUrl("/api/download/summary", { file_id: fid, format: kind });
    }
    return null;
  };

  const handleDownloadSummaryTxt = (it) => {
    const url = getSummaryUrl(it, "txt");
    if (url) {
      const base = (it?.title || it?.file?.name || "summary").replace(/\.[^.]+$/, "");
      downloadURL(url, `${base}_summary.txt`);
      return;
    }
    const text = it?.result?.summary_two_lines || it?.result?.summary || "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const localUrl = URL.createObjectURL(blob);
    const base = (it?.title || it?.file?.name || "summary").replace(/\.[^.]+$/, "");
    downloadURL(localUrl, `${base}_summary.txt`);
    URL.revokeObjectURL(localUrl);
  };

  const handleDownloadSummaryPdf = (it) => {
    const url = getSummaryUrl(it, "pdf");
    if (url) {
      const base = (it?.title || it?.file?.name || "summary").replace(/\.[^.]+$/, "");
      downloadURL(url, `${base}_summary.pdf`);
      return;
    }
    alert("요약 PDF는 서버에서 생성된 파일이 필요합니다. 백엔드 다운로드 URL을 연결해 주세요.");
  };

  // ---------- 폴더 업로드 허용 (webkitdirectory 등) ----------
  useEffect(() => {
    const el = dirInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      el.setAttribute("mozdirectory", "");
      el.setAttribute("allowdirs", "");
      el.setAttribute("multiple", "");
    }
  }, []);

  // ---------- 허용 확장자 accept="" 문자열 ----------
  const acceptAttr = useMemo(
    () => [...ACCEPT_EXT, "application/pdf"].join(","),
    []
  );

  // ---------- 단일 파일 유효성 검사 ----------
  const validate = (file) => {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPT_EXT.includes(ext)) {
      return `허용되지 않은 확장자 (${ext})`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `파일이 너무 큽니다 (${prettyBytes(file.size)} > ${MAX_SIZE_MB} MB)`;
    }
    return null;
  };

  // ---------- 파일 목록에 추가 (zip 자동 풀기 포함) ----------
  const addFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const expanded = [];

    for (const file of arr) {
      const lowerName = (file.name || "").toLowerCase();
      const ext = "." + (lowerName.split(".").pop() || "").toLowerCase();

      if (ext === ".zip") {
        try {
          const innerFiles = await extractFromZip(file);
          expanded.push(...innerFiles);
        } catch (err) {
          console.error("zip 해제 실패:", err);
        }
      } else {
        expanded.push(file);
      }
    }

    setItems((prev) => {
      const seenPrev = new Set(
        prev.map((it) => {
          const f = it.file || {};
          const rel = f.webkitRelativePath || f._relPath || "";
          return `${rel}::${f.name}:${f.size}:${f.lastModified || 0}`;
        })
      );

      const toAdd = [];

      for (const file of expanded) {
        const rel = file.webkitRelativePath || file._relPath || "";
        const key = `${rel}::${file.name}:${file.size}:${file.lastModified || 0}`;
        if (seenPrev.has(key)) continue;

        const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
        if (!ACCEPT_EXT.includes(ext)) continue;

        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          toAdd.push({
            id: crypto.randomUUID(),
            file,
            status: "error",
            progress: 0,
            error: `파일이 너무 큽니다 (${prettyBytes(file.size)} > ${MAX_SIZE_MB} MB)`,
            controller: null,
            result: null,
            categoryName: inferDefaultCategoryFromRel(rel),
            title: inferDefaultTitle(file.name),
          });
          continue;
        }

        toAdd.push({
          id: crypto.randomUUID(),
          file,
          status: "idle",
          progress: 0,
          error: null,
          controller: null,
          result: null,
          categoryName: inferDefaultCategoryFromRel(rel),
          title: inferDefaultTitle(file.name),
        });
      }

      return toAdd.length ? [...toAdd, ...prev] : prev;
    });
  }, []);

  const itemsRef = useRef([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ---------- 드래그&드롭 ----------
  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files?.length) await addFiles(files);
    } catch (err) {
      console.error(err);
    }
  };

  // 퍼센트 목표(서버 퍼센트 없을 때 단계 기반 보정)
  const STAGE_TARGET = {
    PENDING: 5,
    QUEUED: 0,
    RECEIVED: 5,
    STARTED: 8,
    INGEST: 10,

    // OCR 진행/완료
    OCR: 30,
    OCR_DONE: 50,       // ← OCR 완료 시 50%
    OCR_TEXT_DONE: 50,  // ← 서버 이벤트명이 다를 때도 50%로 맞춤

    // 이후 단계
    LLM: 70,
    CATEGORY: 85,

    // 끝 상태
    SUCCESS: 100,
    DONE: 100,
    FAILED: 100,
  };
  const tweenRef = useRef(new Map()); // taskId -> { p, t }

  // ✅ 배치 폴링 매니저: 생성 & 시작
  const progressMgr = useMemo(() => createBatchProgressManager({ intervalMs: 1000 }), []);

  useEffect(() => {
    progressMgr.start(async (results) => {
      const now = Date.now();

      // 1) 각 task 결과에 client_percent / client_eta_seconds / client_finish_at 보정
      for (const [tid, v] of Object.entries(results || {})) {
        const stage = String(v?.stage || v?.state || "").toUpperCase();
        const srvPct = Number.isFinite(v?.percent) ? v.percent : null;

        // (1) 목표 퍼센트 (서버값 없으면 단계 기반 보간)
        const target = srvPct ?? (STAGE_TARGET[stage] ?? 20);

        // (2) 트윈 값 유지/업데이트 (지수 보간)
        const rec = tweenRef.current.get(tid) || { p: 0, t: now };
        const alpha = 0.25; // 부드러움 정도
        const next = rec.p + alpha * (target - rec.p);
        rec.p = Math.min(99.5, Math.max(0, next)); // SUCCESS 전까지 99.5% 캡
        rec.t = now;
        tweenRef.current.set(tid, rec);

        // (3) 결과 주입
        v.client_percent = srvPct ?? Math.round(rec.p);

        // === ETA: 서버가 안 줄 때 속도로 추정 ===
        const hist = etaCacheRef.current.get(tid) || [];
        hist.push({ ts: now, p: v.client_percent });
        while (hist.length && now - hist[0].ts > 5000) hist.shift();
        etaCacheRef.current.set(tid, hist);

        let speed = 0;
        if (hist.length >= 2) {
          const dt = (hist[hist.length - 1].ts - hist[0].ts) / 1000;
          const dp = hist[hist.length - 1].p - hist[0].p;
          if (dt > 0 && dp >= 0) speed = dp / dt; // %/sec
        }
        if ((v.eta_seconds == null || !Number.isFinite(v.eta_seconds)) && speed > 0) {
          v.client_eta_seconds = Math.max(0, Math.round((100 - v.client_percent) / speed));
        }

        // (4) 예상 종료시각(초) 계산
        if (!v.finish_at && Number.isFinite(v.client_eta_seconds)) {
          v.client_finish_at = Math.round((now + v.client_eta_seconds * 1000) / 1000);
        }
      }

      // 2) 진행도/ETA를 아이템에 반영 (finishAt/displayFinishAt 단조감소 보장)
      setItems((prev) =>
        prev.map((it) => {
          if (!it.taskId) return it;
          const v = results[it.taskId];
          if (!v) return it;

          const srvRaw = v.finish_at ?? v.client_finish_at ?? null;
          let nf = typeof srvRaw === "number" ? srvRaw : null;

          // now + 3s 미만이면 무시 → 0초 스타트 방지
          const nowSec = Math.round(now / 1000);
          if (nf != null && nf - nowSec < 3) nf = null;

          const finishAt =
            nf != null
              ? (it.finishAt ? Math.min(it.finishAt, nf) : nf)
              : it.finishAt ?? null;

          const displayFinishAt =
            finishAt != null
              ? (it.displayFinishAt ? Math.min(it.displayFinishAt, finishAt) : finishAt)
              : it.displayFinishAt ?? null;

          return {
            ...it,
            serverProgress: v,
            finishAt,
            displayFinishAt,
          };
        })
      );

      // 3) SUCCESS 항목 결과는 한 번만 수집 + ✅ DB 커밋
      for (const [taskId, v] of Object.entries(results || {})) {
        if ((v?.state === "SUCCESS" || v?.stage === "DONE") && !fetchedResultRef.current.has(taskId)) {
          fetchedResultRef.current.add(taskId); // ✅ 중복 방지 (가장 먼저)
          try {
            const url = absUrl(`/api/v1/task/status/${taskId}`);
            const res = await fetch(url, { method: "GET", headers: authHeaders(), cache: "no-store" });
            const s = await res.json().catch(() => ({}));
            const resultObj = s?.result ?? s?.data ?? s?.info ?? s ?? {};

            const summaryTwoLines = resultObj?.summary_two_lines ?? "";
            const summaryPlain    = resultObj?.summary ?? resultObj?.llm_summary ?? "";
            const backendCat      = resultObj?.category ?? resultObj?.category_name ?? null;

            // 상태 반영 (DONE)
            setItems(prev =>
              prev.map(it => {
                if (it.taskId !== taskId) return it;

                const relPath = it.file?.webkitRelativePath || it.file?._relPath || "";
                let finalCat =
                  backendCat ||
                  extractCategoryFromSummary(summaryTwoLines || summaryPlain) ||
                  it.categoryName ||
                  inferDefaultCategoryFromRel(relPath) ||
                  "Uncategorized";
                finalCat = normalizeTwoLevels(finalCat);

                const serverFileId = extractServerFileId(resultObj);

                return {
                  ...it,
                  status: "done",
                  progress: 100,
                  controller: null,
                  categoryName: finalCat,
                  result: {
                    ocr: resultObj,
                    serverFileId,
                    summary: summaryPlain || "",
                    summary_two_lines: summaryTwoLines || "",
                    category: finalCat,
                  },
                };
              })
            );

            // ✅ DB 커밋 (파일 메타 저장)
            try {
              // ref에서 현재 아이템 안전 조회
              const curIt = (itemsRef.current || []).find(x => x.taskId === taskId) || null;

              const originalFilename = curIt?.file?.name || resultObj?.original_filename || "uploaded";
              const fileSizeBytes    = curIt?.file?.size || 0;

              // 백엔드가 JSON에 넣어 준 값 활용
              const batchIdFromRes   = v?.batch_id || v?.batchId || resultObj?.batch_id || resultObj?.batchId;
              const batchIdFromItem  = curIt?.batchId;
              const changedFilename  = resultObj?.changed_filename || null;  

              const commitRes = await commitOcrResult({
                batchId: batchIdFromRes || batchIdFromItem || "",
                taskId,
                originalFilename,
                changedFilename,   
                fileSizeBytes,
                withCredentials: true,
              });

              if (commitRes?.ok) {
                setItems(prev =>
                  prev.map(it =>
                    it.taskId === taskId
                      ? { ...it, committed: true, documentId: commitRes?.document_id || null }
                      : it
                  )
                );
              }
            } catch (e) {
              console.warn("auto-commit failed:", e);
            }
          } catch (e) {
            console.warn("fetch task result failed:", e);
          }
        }
      }
    });

    return () => progressMgr.stop();
  }, [progressMgr]);

  // ---------- 단일 업로드 ----------
  const startUpload = useCallback(
    async (id) => {
      // 최신 스냅샷에서 찾기
      const cur = (() => {
        const snap = items;
        return snap.find((it) => it.id === id);
      })();
      if (!cur) return;
      if (cur.error) return;
      if (cur.status === "uploading" || cur.status === "done") return;

      const controller = new AbortController();
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                status: "uploading",
                progress: 0,
                controller,
                uploadPct: 0,
                uploadStartTs: Date.now(),
                uploadSpeedEma: 0,            // %/sec
                uploadEtaSeconds: null,       // 남은 초
                uploadFinishAt: null,         // epoch(sec)
                _lastUploadTs: Date.now(),
              }
            : it
        )
      );

      try {
        // 1) 업로드(진행도)
        const rel = cur.file?.webkitRelativePath || cur.file?._relPath || "";
        const data = await uploadFile({
          file: cur.file,
          url: "/api/v1/ocr/upload",
          signal: controller.signal,
          onProgress: (pct, meta) => {
            const now = meta?.ts || Date.now();
            setItems((prev) =>
              prev.map((it) => {
                if (it.id !== id) return it;

                const lastTs = it._lastUploadTs || it.uploadStartTs || now;
                const dt = Math.max(1e-3, (now - lastTs) / 1000);
                const dp = Math.max(0, pct - (it.uploadPct || 0));
                const inst = dp / dt; // %/sec
                const ema = it.uploadSpeedEma ? 0.5 * it.uploadSpeedEma + 0.5 * inst : inst;

                // --- ETA 안정화 조건 ---
                const elapsed = (now - (it.uploadStartTs || now)) / 1000;
                const minSamplesOk = (it._uploadSampleCount || 0) >= 2; // 최소 2샘플
                const minTimeOk = elapsed >= 1.5; // 최소 1.5초

                let newEta = null;
                let newFinishAt = null;
                if (ema > 0 && pct >= 1 && minSamplesOk && minTimeOk) {
                  newEta = Math.round((100 - pct) / ema);
                  const candidate = Math.round(now / 1000 + newEta);
                  // now + 3s 미만이면 무시 (0초로 보이는 현상 차단)
                  if (candidate - Math.round(now / 1000) >= 3) {
                    newFinishAt = candidate;
                  }
                }

                const next = {
                  ...it,
                  progress: pct,
                  uploadPct: pct,
                  uploadSpeedEma: ema,
                  uploadEtaSeconds: newEta ?? it.uploadEtaSeconds ?? null,
                  uploadFinishAt:
                    newFinishAt != null
                      ? (it.uploadFinishAt ? Math.min(it.uploadFinishAt, newFinishAt) : newFinishAt)
                      : it.uploadFinishAt ?? null,
                  displayFinishAt:
                    newFinishAt != null
                      ? (it.displayFinishAt ? Math.min(it.displayFinishAt, newFinishAt) : newFinishAt)
                      : it.displayFinishAt ?? null,
                  _lastUploadTs: now,
                  _uploadSampleCount: (it._uploadSampleCount || 0) + 1,
                };
                return next;
              })
            );
          },
          // ★ 백엔드가 기대하는 추가 필드들
          extraForm: {
            files: cur.file,              // 같은 파일 한 번 더 (백엔드 호환)
            relpath: rel,                 // 상대 경로
            dpi: 300,
            prep: "adaptive",
            langs: "kor+eng",
            psm: 6,
            do_llm_summary: true,
            llm_model: "gemma3-summarizer",
            category_name: cur.categoryName || "Uncategorized",
            title_override: cur.title || stem(cur.file?.name || ""),
          },
        });

        // 2) taskId/batchId 추출
        const taskId =
          data?.task_id || data?.taskId || data?.data?.task_id ||
          data?.tasks?.[0]?.task_id || data?.tasks?.[0]?.id;
        const batchId = data?.batch_id || data?.batchId || data?.data?.batch_id;

        if (!taskId) throw new Error("업로드 응답에 task_id가 없습니다.");

        // 3) 업로드 완료 표기 + 배치 폴링 등록
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: "processing", uploadPct: 100, taskId, batchId }
              : it
          )
        );
        progressMgr.watch(taskId);
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: "error",
                  controller: null,
                  error: err?.message || String(err),
                }
              : it
          )
        );
      }
    },
    [items, progressMgr]
  );

  // ---------- 일괄 업로드 ----------
  const onStartAll = useCallback(() => {
    const queue = items.filter((it) => it.status === "idle").map((it) => it.id);
    if (!queue.length) return;
    const MAX_CONCURRENCY = 10;
    let active = 0, idx = 0;
    const kick = () => {
      while (active < MAX_CONCURRENCY && idx < queue.length) {
        const id = queue[idx++];
        active++;
        Promise.resolve(startUpload(id)).finally(() => {
          active--; kick();
        });
      }
    };
    kick();
  }, [items, startUpload]);

  // ---------- 업로드 취소 / 삭제 ----------
  const onCancel = (id) => {
    const target = items.find((it) => it.id === id);
    if (target?.controller) try { target.controller.abort(); } catch {}
    if (target?.taskId) progressMgr.unwatch(target.taskId);
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, status: "idle", controller: null, uploadPct: 0, taskId: null, serverProgress: null }
          : it
      )
    );
  };

  const onRemove = (id) => {
    const t = items.find((it) => it.id === id);
    if (t?.taskId) progressMgr.unwatch(t.taskId);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // ---------- 통계 ----------
  const totalSizeStr = useMemo(
    () => prettyBytes(items.reduce((s, it) => s + (it.file?.size || 0), 0)),
    [items]
  );
  const totalFileCount = useMemo(() => items.length, [items]);
  const doneItems = useMemo(
    () => items.filter((it) => it.status === "done" && it.result),
    [items]
  );

  const handleDownloadAllZip = async () => {
    if (doneItems.length === 0) {
      alert("완료된 문서가 없습니다.");
      return;
    }
    await downloadAllResultsAsZip(doneItems);
  };

  // ---------- 카테고리 ----------
  const allCategories = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      if (it.status !== "done") continue;
      if (it.categoryName) s.add(it.categoryName);
    }
    return Array.from(s).sort();
  }, [items]);

  const toggleCat = (cat) => {
    setSelectedCats((prev) => {
      const n = new Set(prev);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  };

  const filteredItems = useMemo(() => {
    const q = String(searchQuery || "").toLowerCase();
    const need = Array.from(selectedCats);
    return items.filter((it) => {
      const tags = [it.categoryName].filter(Boolean);
      if (!need.every((c) => tags.includes(c))) return false;
      if (!q) return true;
      const hay = [
        it.file?.name || "",
        it?.result?.summary_two_lines || it?.result?.summary || "",
        tags.join(" "),
        it.title || "",
      ]
        .map((v) => String(v).toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [items, searchQuery, selectedCats]);

  // ---------- 파일 input change ----------
  useEffect(() => {
    const input = inputRef.current;
    const dir = dirInputRef.current;
    const handler = async (e) => {
      if (e.target.files?.length) {
        await addFiles(e.target.files);
        e.target.value = "";
      }
    };
    input?.addEventListener("change", handler);
    dir?.addEventListener("change", handler);
    return () => {
      input?.removeEventListener("change", handler);
      dir?.removeEventListener("change", handler);
    };
  }, [addFiles]);

  // ---------- 렌더 ----------
  return (
    <div className="flex">
      <Sidebar
        categories={allCategories}
        selectedCats={selectedCats}
        toggleCat={toggleCat}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <main className="flex-1 min-h-screen bg-[#f8fafc] px-6 lg:px-12 py-6">
        <div className="max-w-screen-xl mx-auto">
          <header className="mb-6 flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-gray-900">문서 업로드</h1>
            {activeTab === "home" && (
              <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
                <span className="text-gray-500">허용 확장자:</span>
                {["pdf", "hwp/hwpx", "doc/docx", "ppt/pptx", "xls/xlsx", "zip"].map(
                  (ext) => (
                    <span
                      key={ext}
                      className="inline-flex items-center rounded-md bg-gray-100 text-gray-800 text-[11px] font-medium px-2 py-0.5"
                    >
                      {ext}
                    </span>
                  )
                )}
                <span className="text-gray-400 text-[11px]">
                  총 {totalFileCount}개 · {totalSizeStr}
                </span>
              </div>
            )}
          </header>
        </div>

        {activeTab === "home" && (
          <UploadHome
            items={items}
            dragOver={dragOver}
            setDragOver={setDragOver}
            onDrop={onDrop}
            onStartAll={onStartAll}
            onUpload={startUpload}
            onCancel={onCancel}
            onRemove={onRemove}
            onDownloadSummaryTxt={handleDownloadSummaryTxt}
            onDownloadSummaryPdf={handleDownloadSummaryPdf}
            inputRef={inputRef}
            dirInputRef={dirInputRef}
            acceptAttr={acceptAttr}
            onDownloadAllZip={handleDownloadAllZip}
          />
        )}
      </main>
    </div>
  );
}