import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { joinUrl, prettyBytes } from "../utils/uploadHelpers";
import {
  getMyDocuments,
  listDocComments as listDocMemos,
  createDocComment as createDocMemo,
  deleteDocComment as deleteDocMemo,
  deleteDocument,
  deleteAllMyDocuments,
} from "../utils/mypageApi";
import DocPreviewPane from "../components/DocPreviewPane";

const DEFAULT_PAGE_SIZE = 8;

export default function UploadFilesPage({ pageSize = DEFAULT_PAGE_SIZE }) {
  // ===== 스타일 토큰 (Search 컴포넌트와 통일) =====
  const btn = {
    base:
      "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-[12px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 cursor-pointer",
    primary:
      "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm hover:opacity-95 active:opacity-90 focus-visible:ring-violet-300",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-gray-300",
    danger:
      "bg-white text-rose-600 border border-rose-300 hover:bg-rose-50 active:bg-rose-100 focus-visible:ring-rose-300",
    subtle:
      "bg-white text-gray-700 border border-blue-500 hover:bg-gradient-to-r hover:from-pink-500 hover:to-purple-500 hover:text-white focus-visible:ring-purple-300",
    dark:
      "bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-300",
    sm: "px-2 py-1",
    md: "px-3 py-2",
  };

  const chip = {
    base:
      "px-2 py-1 rounded-full text-[12px] transition-all duration-200 border",
    on:
      "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-transparent shadow-sm hover:opacity-95",
    off:
      "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400",
  };

  const badge =
    "shrink-0 inline-flex items-center rounded-full border border-violet-200 bg-violet-50/80 px-2 py-0.5 text-[10px] font-medium text-violet-700 shadow-sm";

  // ===== 사이드바 / 상태 =====
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // ===== 메모 상태 =====
  const [memosByDoc, setMemosByDoc] = useState({});
  const [memoInput, setMemoInput] = useState({});
  const loadingDocIdsRef = useRef(new Set());

  // ===== pdf 미리보기 =====
  const [selectedDoc, setSelectedDoc] = useState(null);

  // ===== 표시 유틸 =====
  const displayNameOf = (doc = {}) =>
    doc.changed_filename ??
    doc.CHANGED_FILENAME ??
    doc.filename ??
    doc.title ??
    doc.originalFilename ??
    doc.ORIGINAL_FILENAME ??
    `문서 ${doc.id ?? doc.DOCUMENT_ID ?? ""}`.trim();

  const extOf = (name = "") => {
    const i = name.lastIndexOf(".");
    return i > -1 ? name.slice(i + 1).toLowerCase() : "";
  };
  const catPathOf = (doc = {}) => {
    const joined =
      doc.catPath ??
      doc.category_path ??
      doc.CATEGORY_PATH ??
      doc.categoryName ??
      doc.category_name ??
      doc.CATEGORY_NAME ??
      "";
    if (joined) return String(joined).trim();
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
    if (main && sub) return `${main}/${sub}`;
    if (main) return String(main);
    return "(미분류)";
  };

  const iconByExt = (ext = "") => {
    switch (ext) {
      case "pdf":
        return "📕";
      case "hwp":
      case "hwpx":
        return "📝";
      case "doc":
      case "docx":
        return "📘";
      case "xls":
      case "xlsx":
        return "📗";
      case "ppt":
      case "pptx":
        return "📙";
      case "txt":
        return "📄";
      default:
        return "📄";
    }
  };

  // ===== 목록 로드 =====
  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyDocuments({
        q: "",
        categories: [],
        page: 1,
        pageSize: 100,
      });
      const raw = res.items || res.data || res.documents || [];
      setDocs((raw || []).filter(isActiveDoc));
    } catch (err) {
      console.error("내 업로드 문서 로드 실패:", err);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // ===== 페이징 =====
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return (docs || []).slice(start, start + pageSize);
  }, [docs, page, pageSize]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((docs || []).length / pageSize)),
    [docs, pageSize]
  );

  // ===== 메모 로딩 =====
  const ensureMemos = useCallback(
    async (docId) => {
      if (!docId) return;
      if (memosByDoc[docId]) return;
      if (loadingDocIdsRef.current.has(docId)) return;
      loadingDocIdsRef.current.add(docId);
      try {
        const res = await listDocMemos(docId);
        const arr = Array.isArray(res)
          ? res
          : (res?.items || res?.data || res?.list || []);
        setMemosByDoc((p) => ({ ...p, [docId]: arr }));
      } catch (e) {
        console.error("메모 로드 실패:", e);
      } finally {
        loadingDocIdsRef.current.delete(docId);
      }
    },
    [memosByDoc]
  );

  useEffect(() => {
    const ids = (paged || [])
      .map((it) => it.id ?? it.documentId ?? it.DOCUMENT_ID ?? it.docId)
      .filter(Boolean);
    ids.forEach((id) => ensureMemos(id));
  }, [paged, ensureMemos]);

  // ===== 메모 CRUD =====
  const submitMemo = async (doc) => {
    const docId = doc.id ?? doc.DOCUMENT_ID ?? doc.documentId;
    const text = (memoInput[docId] || "").trim();
    if (!docId || !text) return;
    if (loadingDocIdsRef.current.has(`POST:${docId}`)) return;
    try {
      loadingDocIdsRef.current.add(`POST:${docId}`);
      const created = await createDocMemo(docId, text);
      setMemosByDoc((prev) => ({
        ...prev,
        [docId]: [created, ...(prev[docId] || [])],
      }));
      setMemoInput((prev) => ({ ...prev, [docId]: "" }));
    } catch (e) {
      alert(e?.message || "메모 등록 실패");
    } finally {
      loadingDocIdsRef.current.delete(`POST:${docId}`);
    }
  };

  const removeMemo = async (docId, memo) => {
    const memoId = memo.id ?? memo.COMMENT_ID;
    if (!memoId) return;
    if (!confirm("메모를 삭제하시겠습니까?")) return;
    try {
      await deleteDocMemo(memoId);
      setMemosByDoc((prev) => ({
        ...prev,
        [docId]: (prev[docId] || []).filter(
          (x) => (x.id ?? x.COMMENT_ID) !== memoId
        ),
      }));
    } catch (e) {
      alert(e?.message || "메모 삭제 실패");
    }
  };

  // ===== 문서 삭제 =====
  const onDeleteDoc = async (docId) => {
    if (!docId) return;
    if (!confirm("이 문서를 삭제하시겠습니까?")) return;
    try {
      await deleteDocument(docId);
      setDocs((prev) => {
        const next = prev.filter((d) => (d.id ?? d.DOCUMENT_ID) !== docId);
        const maxPage = Math.max(1, Math.ceil(next.length / pageSize));
        if (page > maxPage) setPage(maxPage);
        return next;
      });
      setMemosByDoc((prev) => {
        const n = { ...prev };
        delete n[docId];
        return n;
      });
    } catch (e) {
      alert(e?.message || "문서 삭제 실패");
    }
  };

  const onDeleteAll = async () => {
    if (!docs.length) return;
    if (!confirm("내가 업로드한 모든 문서를 삭제하시겠습니까?")) return;
    try {
      await deleteAllMyDocuments().catch(async () => {
        for (const d of docs) {
          const id = d.id ?? d.DOCUMENT_ID;
          if (id) await deleteDocument(id);
        }
      });
      setDocs([]);
      setMemosByDoc({});
      setPage(1);
    } catch (e) {
      alert(e?.message || "전체 삭제 중 오류");
    }
  };

  // 삭제 제외 헬퍼
  function isActiveDoc(d = {}) {
    const ps = String(d.proc_status ?? d.PROC_STATUS ?? "").trim().toUpperCase();
    const statusIsDeleted = ps === "DELETE" || ps === "DELETED";
    const delFlag = d.is_deleted ?? d.IS_DELETED ?? 0;
    const flagIsDeleted = delFlag === true || String(delFlag) === "1";
    return !(statusIsDeleted || flagIsDeleted);
  }

  const previewOpen = !!selectedDoc;

  return (
    <div className="flex">
      {/* 사이드바 */}
      <Sidebar
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* 메인 + 미리보기 2열 */}
      <main className="flex-1 min-h-screen bg-[#f8fafc] p-6">
        <div className="flex gap-4">
          {/* 왼쪽: 리스트 영역 — 폭 전환 */}
          <section
            className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 transition-[width] duration-300 ease-in-out"
            style={{ width: previewOpen ? "58%" : "100%" }}
          >
            {/* 헤더 */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-[13px] font-semibold text-gray-800">
                  내가 업로드한 문서
                </div>

                {/* 상단 페이지네이션 */}
                {pageCount > 1 && (
                  <div className="flex items-center gap-2 text-[11px] text-gray-600">
                    <button
                      className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      이전
                    </button>
                    <span className="text-gray-500">
                      {page} / {pageCount}
                    </span>
                    <button
                      className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      다음
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                onClick={onDeleteAll}
              >
                전체 삭제
              </button>
            </div>

            {/* 리스트 */}
            {loading && (
              <div className="text-center text-gray-400 text-sm py-8">
                불러오는 중…
              </div>
            )}

            {!loading && paged.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">
                업로드한 문서가 없습니다.
              </div>
            )}

            <ul className="space-y-3">
              {paged.map((doc) => {
                const fname = displayNameOf(doc);
                const ext = extOf(fname);
                const icon = iconByExt(ext);
                const size = doc.size ?? doc.fileSize ?? doc.FILE_SIZE ?? 0;
                const createdAt =
                  doc.createdAt ?? doc.CREATED_AT ?? doc.created_at ?? Date.now();
                const serverFileId =
                  doc.serverFileId ?? doc.SERVER_FILE_ID ?? doc.file_id ?? null;

                const docId =
                  doc.id ?? doc.documentId ?? doc.DOCUMENT_ID ?? null;
                const memos = memosByDoc?.[docId] || [];
                const mLoading = loadingDocIdsRef.current.has(docId);
                const cat = catPathOf(doc);

                // 버튼 클릭 시 리스트 선택으로 버블링 방지
                const stop = (e) => e.stopPropagation();

                return (
                  <li
                    key={docId ?? fname}
                    className={`rounded-2xl border border-gray-200 bg-white p-3 shadow-sm hover:bg-gray-50 transition cursor-pointer ${
                      (selectedDoc?.id ?? selectedDoc?.DOCUMENT_ID) === docId ? "ring-2 ring-violet-200" : ""
                    }`}
                    onClick={() => setSelectedDoc(doc)}
                    title="미리보기 열기"
                  >
                    {/* 상단: 아이콘/제목 + 확장자 배지 */}
                    <div className="flex items-start gap-2">
                      <div className="w-[28px] h-[28px] flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-base leading-none select-none shrink-0">
                        {icon}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate text-[13px] font-semibold text-gray-900">
                            {fname}
                            {cat && <span className={`ml-2 ${badge}`}>{cat}</span>}
                          </div>
                          {ext && <span className={badge}>{ext.toUpperCase()}</span>}
                        </div>

                        {/* 용량/시간 */}
                        <div className="mt-1 text-[11px] text-gray-500">
                          {prettyBytes(size)} ·{" "}
                          {new Date(createdAt).toLocaleString()}
                        </div>

                        {/* 버튼들 */}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <button
                            className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                            disabled={!serverFileId}
                            onClick={(e) => {
                              stop(e);
                              if (!serverFileId) return;
                              window.open(
                                joinUrl(`/download/${serverFileId}/original`),
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }}
                            title="원본 파일 다운로드"
                          >
                            원본
                          </button>

                          <button
                            className={`${btn.base} ${btn.subtle} ${btn.sm}`}
                            disabled={!serverFileId}
                            onClick={(e) => {
                              stop(e);
                              if (!serverFileId) return;
                              window.open(
                                joinUrl(`/download/${serverFileId}/text`),
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }}
                            title="요약 텍스트 다운로드"
                          >
                            요약 TXT
                          </button>

                          <button
                            className={`${btn.base} ${btn.danger} ${btn.sm}`}
                            onClick={(e) => {
                              stop(e);
                              onDeleteDoc(docId);
                            }}
                            title="문서 삭제"
                          >
                            문서 삭제
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div className="my-3 h-px bg-gray-100" />

                    {/* 메모 */}
                    <div onClick={stop}>
                      <div className="text-[12px] text-gray-800 font-medium mb-1">
                        메모
                      </div>

                      <div className="flex flex-col gap-2 max-h-28 overflow-y-auto">
                        {mLoading && (
                          <div className="text-[11px] text-gray-400">
                            메모 불러오는 중…
                          </div>
                        )}
                        {!mLoading && memos.length === 0 && (
                          <div className="text-[11px] text-gray-400">
                            아직 메모가 없습니다.
                          </div>
                        )}
                        {memos.map((m) => {
                          const mid = m.id ?? m.COMMENT_ID;
                          const body = m.body ?? m.BODY ?? "";
                          const createdAtMemo = m.createdAt ?? m.CREATED_AT ?? "";

                          return (
                            <div
                              key={mid}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1"
                            >
                              <div className="text-[11px] text-gray-800 leading-snug break-words">
                                {body}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between gap-2">
                                <span>{createdAtMemo ? String(createdAtMemo) : ""}</span>
                                <button
                                  className={`${btn.base} ${btn.danger} ${btn.sm}`}
                                  onClick={() => removeMemo(docId, m)}
                                  title="메모 삭제"
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-2 flex items-start gap-2">
                        <input
                          type="text"
                          placeholder="메모를 입력하세요…"
                          className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-800 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                          value={memoInput[docId] || ""}
                          onChange={(e) =>
                            setMemoInput((prev) => ({
                              ...prev,
                              [docId]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitMemo(doc);
                          }}
                        />
                        <button
                          className={`${btn.base} ${btn.primary} ${btn.sm}`}
                          onClick={() => submitMemo(doc)}
                        >
                          등록
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 오른쪽: 미리보기 패널 — 항상 존재하되 폭만 0→보이기 */}
          <aside
            className="hidden lg:block border-l border-dashed border-gray-200 bg-white overflow-hidden transition-[width] duration-300 ease-in-out"
            style={{
              width: previewOpen ? "42%" : "0px",
              padding: previewOpen ? "1rem" : "0px",
            }}
            aria-hidden={!previewOpen}
            aria-expanded={previewOpen}
          >
            {previewOpen && (
              <DocPreviewPane
                doc={selectedDoc}
                onClose={() => setSelectedDoc(null)}
              />
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}