import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Sidebar from "../components/Sidebar";
import ProfileEditModal from "../components/ProfileEditModal";
import JSZip from "jszip";
import { saveAs } from "file-saver-es";

import { joinUrl, prettyBytes } from "../utils/uploadHelpers";
import {
  getMyProfile,
  getMyDocuments,
  getMyCategories,
  listDocComments,
  createDocComment,
  deleteDocComment,
  deleteDocument,
} from "../utils/mypageApi";

import { mapItemToCatPath, extractJoinedCats } from "../utils/categoryUtils";

const CLIENT_PAGING_THRESHOLD = 2000;
const SERVER_MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const SEARCH_PAGE_VIEW_SIZE = 3;

export default function Search() {
  // 사이드바 & 프로필
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState(null);

  // 검색 / 결과
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [allMode, setAllMode] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0);

  // 카테고리
  const [catsMaster, setCatsMaster] = useState([]);
  const [catsRaw, setCatsRaw] = useState([]);
  const [mainSel, setMainSel] = useState(new Set());    
  const [subSel, setSubSel] = useState(new Map());
  const [baseMainList, setBaseMainList] = useState([]);

  // 댓글
  const [commentsByDoc, setCommentsByDoc] = useState({});
  const [commentInput, setCommentInput] = useState({});
  const loadingDocIdsRef = useRef(new Set());

  // 사용자
  const me = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem("user") || sessionStorage.getItem("user") || "{}"
      );
    } catch {
      return {};
    }
  }, []);
  const isAdmin = !!(me?.IS_ADMIN ?? me?.is_admin ?? me?.isAdmin);

  // 버튼/칩 스타일 토큰
  const btn = {
    base:
      "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-[12px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    primary:
      "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm hover:opacity-95 active:opacity-90 focus-visible:ring-violet-300",
    secondary:
      "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-gray-300",
    danger:
      "bg-white text-rose-600 border border-rose-300 hover:bg-rose-50 active:bg-rose-100 focus-visible:ring-rose-300",
    subtle:
      "bg-white text-gray-700 border border-blue-500 hover:bg-gradient-to-r hover:from-pink-500 hover:to-purple-500 hover:text-white focus-visible:ring-purple-300",
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
    "ml-2 inline-flex items-center rounded-full border border-violet-200 bg-violet-50/80 px-2 py-0.5 text-[10px] font-medium text-violet-700 shadow-sm";

  // ===== 데이터 로드 =====
  useEffect(() => {
    (async () => {
      try {
        const res = await getMyProfile();
        setUser(res?.user || res || null);
      } catch {
        setUser(null);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMyCategories();
        setCatsMaster(res?.joined || []);
      } catch (e) {
        console.warn("카테고리 로드 실패(검색 결과 기반으로 대체)", e);
      }
    })();
  }, []);

  // 카테고리 트리 데이터
  const catSource = catsMaster.length > 0 ? catsMaster : catsRaw;
  const catTree = useMemo(() => {
    const m = new Map();
    (catSource || []).forEach((joined) => {
      const [main, sub] = String(joined).split("/").map((s) => s?.trim());
      if (!main) return;
      if (!m.has(main)) m.set(main, new Set());
      if (sub) m.get(main).add(sub);
      else m.get(main).add("전체");
    });
    return m;
  }, [catSource]);

  // 현재 결과 집합(개수 계산용)
  const datasetForCounts = useMemo(
    () => (allMode ? allItems : items),
    [allMode, allItems, items]
  );

  // 서버 쿼리용 카테고리 배열
  const categoriesToSend = useMemo(() => {
    if (!mainSel || mainSel.size === 0) return [];
    const out = [];
    for (const m of mainSel) {
      const subs = subSel.get(m);
      if (!subs || subs.size === 0) {
        const allSubs = catTree.get(m);
        if (!allSubs || allSubs.size === 0) out.push(m);
        else for (const s of allSubs) out.push(s === "전체" ? m : `${m}/${s}`);
      } else {
        for (const s of subs) out.push(s === "전체" ? m : `${m}/${s}`);
      }
    }
    return out;
  }, [mainSel, subSel, catTree]);

  // 화면 표시 아이템
  const visibleItems = useMemo(() => {
    if (!allMode) return items;
    const start = (page - 1) * pageSize;
    return allItems.slice(start, start + pageSize);
  }, [allMode, items, allItems, page, pageSize]);

  // UI 페이지(카드 3개씩 보기)
  const [uiPage, setUiPage] = useState(1);
  const uiPageCount = useMemo(
    () => Math.max(1, Math.ceil(visibleItems.length / SEARCH_PAGE_VIEW_SIZE)),
    [visibleItems.length]
  );
  const pagedVisibleItems = useMemo(() => {
    const start = (uiPage - 1) * SEARCH_PAGE_VIEW_SIZE;
    return visibleItems.slice(start, start + SEARCH_PAGE_VIEW_SIZE);
  }, [visibleItems, uiPage]);

  // 검색
  const doSearch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const head = await getMyDocuments({
        q: appliedQ,
        categories: categoriesToSend,
        page: 1,
        pageSize: 1,
      });
      const totalCount = head?.total ?? 0;

      if (totalCount > 0 && totalCount <= CLIENT_PAGING_THRESHOLD) {
        const pages = Math.max(1, Math.ceil(totalCount / SERVER_MAX_PAGE_SIZE));
        let acc = [];
        let catsSet = new Set();

        for (let p = 1; p <= pages; p++) {
          const chunk = await getMyDocuments({
            q: appliedQ,
            categories: categoriesToSend,
            page: p,
            pageSize: SERVER_MAX_PAGE_SIZE,
          });
          const mappedChunk = (chunk?.items || []).map(mapItemToCatPath);
          acc = acc.concat(mappedChunk);
          extractJoinedCats(chunk, mappedChunk).forEach((c) => catsSet.add(c));
        }

        setAllItems(acc);
        setItems([]);
        setAllMode(true);
        setTotal(acc.length);

        if (catsMaster.length === 0) setCatsRaw(Array.from(catsSet).sort());
      } else {
        const pageRes = await getMyDocuments({
          q: appliedQ,
          categories: categoriesToSend,
          page,
          pageSize: SERVER_MAX_PAGE_SIZE,
        });
        const mapped = (pageRes.items || []).map(mapItemToCatPath);

        setItems(mapped);
        setAllItems([]);
        setAllMode(false);
        setTotal(pageRes.total ?? mapped.length);

        if (catsMaster.length === 0)
          setCatsRaw(extractJoinedCats(pageRes, mapped));
      }
    } catch (e) {
      setError(e?.message || "검색 중 오류");
      setItems([]);
      setAllItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [appliedQ, categoriesToSend, page, catsMaster.length]);

  useEffect(() => setSearchTrigger((n) => n + 1), []);
  useEffect(() => {
    if (!searchTrigger) return;
    setUiPage(1);
    doSearch();
  }, [searchTrigger, doSearch]);
  useEffect(() => {
    if (!searchTrigger || allMode) return;
    setUiPage(1);
    doSearch();
  }, [page, allMode, searchTrigger, doSearch]);

  // 댓글 로딩
  const ensureComments = useCallback(
    async (docId) => {
      if (!docId) return;
      if (commentsByDoc[docId]) return;
      if (loadingDocIdsRef.current.has(docId)) return;

      loadingDocIdsRef.current.add(docId);
      try {
        const res = await listDocComments(docId);
        setCommentsByDoc((p) => ({ ...p, [docId]: res?.items || [] }));
      } catch (e) {
        console.error("댓글 로드 실패:", e);
      } finally {
        loadingDocIdsRef.current.delete(docId);
      }
    },
    [commentsByDoc]
  );

  useEffect(() => {
    const ids = (pagedVisibleItems || [])
      .map((it) => it.id ?? it.documentId ?? it.DOCUMENT_ID ?? it.docId)
      .filter(Boolean);
    ids.forEach((id) => ensureComments(id));
  }, [pagedVisibleItems, ensureComments]);

  // 댓글 CRUD
  const submitComment = async (doc) => {
    const docId = doc.id ?? doc.DOCUMENT_ID ?? doc.documentId;
    const text = (commentInput[docId] || "").trim();
    if (!docId || !text) return;
    try {
      const created = await createDocComment(docId, text);
      setCommentsByDoc((prev) => ({
        ...prev,
        [docId]: [created, ...(prev[docId] || [])],
      }));
      setCommentInput((prev) => ({ ...prev, [docId]: "" }));
    } catch (e) {
      alert(e?.message || "댓글 등록 실패");
    }
  };

  const removeComment = async (docId, c) => {
    const commentId = c.id ?? c.COMMENT_ID;
    if (!commentId) return;
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    try {
      await deleteDocComment(commentId);
      setCommentsByDoc((prev) => ({
        ...prev,
        [docId]: (prev[docId] || []).filter(
          (x) => (x.id ?? x.COMMENT_ID) !== commentId
        ),
      }));
    } catch (e) {
      alert(e?.message || "댓글 삭제 실패");
    }
  };

  // 문서 삭제
  const onDeleteDoc = async (docId) => {
    if (!docId) return;
    if (!confirm("이 문서를 삭제하시겠습니까?")) return;
    try {
      await deleteDocument(docId);
      setItems((prev) => prev.filter((d) => (d.id ?? d.DOCUMENT_ID) !== docId));
      setAllItems((prev) =>
        prev.filter((d) => (d.id ?? d.DOCUMENT_ID) !== docId)
      );
      setTotal((t) => Math.max(0, t - 1));
      setCommentsByDoc((prev) => {
        const n = { ...prev };
        delete n[docId];
        return n;
      });
    } catch (e) {
      alert(e?.message || "문서 삭제 실패");
    }
  };

  // 표시용 유틸
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

  const sanitize = (s = "") =>
    String(s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() ||
    "파일";

  // 카테고리 ZIP 다운로드
  const onDownloadCatsZip = async () => {
    const dataset = allMode ? allItems : items;
    if (!dataset?.length) {
      alert("다운로드할 문서가 없습니다.");
      return;
    }
    setZipLoading(true);
    try {
      const zip = new JSZip();

      for (const it of dataset) {
        const serverFileId =
          it.serverFileId ?? it.SERVER_FILE_ID ?? it.file_id ?? null;
        if (!serverFileId) continue;

        const fname = sanitize(displayNameOf(it));
        const ext = extOf(fname);
        const finalName = ext ? fname : `${fname}.bin`;
        const cat = sanitize(it.catPath || "(미분류)");
        const folder = zip.folder(cat);

        const res = await fetch(joinUrl(`/download/${serverFileId}/original`));
        if (!res.ok) continue;
        const blob = await res.blob();

        folder.file(finalName, blob);
      }

      const out = await zip.generateAsync({ type: "blob" });
      const zipName = `documents_by_category_${Date.now()}.zip`;
      saveAs(out, zipName);
    } catch (e) {
      console.error(e);
      alert("ZIP 생성 중 오류가 발생했습니다.");
    } finally {
      setZipLoading(false);
    }
  };
  // 결과 집합 기준 카테고리 개수 계산
  const { mainCounts, subCounts } = useMemo(() => {
    const m = new Map(); // main -> count
    const s = new Map(); // main -> Map(sub -> count)
    for (const it of datasetForCounts || []) {
      const cat = String(it.catPath || "").trim();
      if (!cat) continue;
      const [main, subRaw] = cat.split("/").map((v) => v?.trim()).filter(Boolean);
      if (!main) continue;
      m.set(main, (m.get(main) || 0) + 1);
      if (!s.has(main)) s.set(main, new Map());
      const sub = subRaw || "전체";
      const subMap = s.get(main);
      subMap.set(sub, (subMap.get(sub) || 0) + 1);
    }
    return { mainCounts: m, subCounts: s };
  }, [datasetForCounts]);

  useEffect(() => {
    if (mainSel.size > 0) return;
    const data = allMode ? allItems : items;
    const all = Array.from(catTree.keys()).sort();
    const counts = new Map();
    for (const it of data) {
      const [m] = String(it.catPath || "").split("/").map(v => v?.trim());
      if (m) counts.set(m, (counts.get(m) || 0) + 1);
    }
    const currentVisible = all.filter(m => (counts.get(m) || 0) > 0);
    setBaseMainList(currentVisible);
  }, [mainSel.size, catTree, allMode, allItems, items]);
  // 0건 카테고리 숨김용 목록
   const mainListFiltered = useMemo(() => {
    if (mainSel.size > 0 && baseMainList.length > 0) {
      return baseMainList;
    }
    const data = allMode ? allItems : items;
    const all = Array.from(catTree.keys()).sort();
    const counts = new Map();
    for (const it of data) {
      const [m] = String(it.catPath || "").split("/").map(v => v?.trim());
      if (m) counts.set(m, (counts.get(m) || 0) + 1);
    }
    return all.filter(m => (counts.get(m) || 0) > 0);
  }, [baseMainList, mainSel.size, catTree, allMode, allItems, items]);
  // 서브 목록 생성기
  const subListFiltered = useCallback((m) => {
    if (mainSel.size > 0) {
      return Array.from(catTree.get(m) || new Set()).sort();
    }
    const set = catTree.get(m) || new Set();
    const subs = Array.from(set).sort();
    const map = new Map();
    for (const it of (allMode ? allItems : items)) {
      const [mm, ssRaw] = String(it.catPath || "").split("/").map((v) => v?.trim());
      if (mm !== m) continue;
      const ss = ssRaw || "전체";
      map.set(ss, (map.get(ss) || 0) + 1);
    }
    return subs.filter((s) => (map.get(s) || 0) > 0);
  }, [catTree, allMode, allItems, items, mainSel.size]);
  // 선택된 메인이 0건이면 자동 해제
  useEffect(() => {
    setMainSel(prev => {
      const kept = new Set([...prev].filter(m => (mainCounts.get(m) || 0) > 0));
      if (kept.size === prev.size) return prev;
      setSubSel(prevMap => {
        const mm = new Map(prevMap);
        for (const m of prevMap.keys()) if (!kept.has(m)) mm.delete(m);
        return mm;
      });
      return kept;
    });
  }, [mainCounts]);
  // 카테고리 토글
  const toggleMain = (m) => {
    setMainSel((prev) => {
      const n = new Set(prev);
      if (n.has(m)) {
        n.delete(m);
        setSubSel((prevMap) => {
          const mm = new Map(prevMap);
          mm.delete(m);
          return mm;
        });
      } else {
        n.add(m);
      }
      setPage(1);
      setAppliedQ(q);
      setSearchTrigger((x) => x + 1);
      return n;
    });
  };
  const toggleSub = (m, s) => {
    setSubSel((prev) => {
      const mm = new Map(prev);
      const set = new Set(mm.get(m) || []);
      set.has(s) ? set.delete(s) : set.add(s);
      if (set.size === 0) mm.delete(m);
      else mm.set(m, set);
      return mm;
    });
    setPage(1);
    setAppliedQ(q);
    setSearchTrigger((x) => x + 1);
  };
  // ===== 렌더링 =====
  return (
    <div className="flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onProfileClick={() => setProfileOpen(true)}
      />
      <main className="flex-1 min-h-screen bg-[#f8fafc] p-10">
        <section className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
          {/* 검색/필터 */}
          <div className="flex flex-col gap-4 border-b border-gray-200 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                    setAppliedQ(q);
                    setSearchTrigger((n) => n + 1);
                  }
                }}
                placeholder="제목 또는 카테고리로 검색…"
                className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
              />
              <button
                onClick={() => {
                  setPage(1);
                  setAppliedQ(q);
                  setSearchTrigger((n) => n + 1);
                }}
                className={`${btn.base} ${btn.primary} ${btn.md}`}
              >
                검색
              </button>
              <button
                onClick={() => {
                  setQ("");
                  setAppliedQ("");
                  setMainSel(new Set());
                  setSubSel(new Map());
                  setPage(1);
                  setItems([]);
                  setAllItems([]);
                  setTotal(0);
                  setSearchTrigger((n) => n + 1);
                }}
                className={`${btn.base} ${btn.secondary} ${btn.md}`}
              >
                필터 초기화
              </button>
            </div>

            {/* 카테고리: 메인 */}
            {mainListFiltered.length > 0 && (
              <div className="flex flex-wrap items-start gap-2">
                <button
                  className={`${chip.base} ${mainSel.size === 0 ? chip.on : chip.off}`}
                  onClick={() => {
                    setMainSel(new Set());
                    setSubSel(new Map());
                    setPage(1);
                    setAppliedQ(q);
                    setSearchTrigger((n) => n + 1);
                  }}
                >
                  전체
                </button>
                {mainListFiltered.map((m) => (
                  <button
                    key={`main-${m}`}
                    className={`${chip.base} ${mainSel.has(m) ? chip.on : chip.off}`}
                    onClick={() => {
                      toggleMain(m); 
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            {/* 카테고리: 서브 */}
            {mainSel.size > 0 && (
              <div className="flex flex-col gap-2">
                {Array.from(mainSel).map((m) => {
                  const subs = subListFiltered(m);
                  if (subs.length === 0) return null;
                  const chosen = subSel.get(m) || new Set();
                  return (
                    <div key={`subgroup-${m}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-gray-500 mr-1">{m}</span>
                      {subs.map((s) => (
                        <button
                          key={`sub-${m}-${s}`}
                          className={`${chip.base} ${chosen.has(s) ? chip.on : chip.off}`}
                          onClick={() => toggleSub(m, s)}
                          title={`${m}/${s}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 요약 바 + 페이지네이션 + ZIP */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px] text-gray-600">
              <div className="flex flex-wrap items-center gap-2 leading-none">
                <span className="text-gray-800 font-semibold">
                  {loading ? "검색 중…" : `총 ${total}건`}
                </span>
                {mainSel.size > 0 && (
                  <span className="text-gray-500">· 주 {Array.from(mainSel).join(", ")}</span>
                )}
                {subSel.size > 0 && (
                  <span className="text-gray-500">
                    · 부 {Array.from(subSel.entries())
                            .map(([m, set]) => `${m}:${Array.from(set || []).join(",")}`)
                            .join(" / ")}
                  </span>
                )}
                {appliedQ && <span className="text-gray-500">· “{appliedQ}”</span>}
              </div>

              <div className="flex items-center gap-2">
                <button
                  className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                  disabled={uiPage <= 1 || loading}
                  onClick={() => setUiPage((p) => Math.max(1, p - 1))}
                >
                  이전
                </button>
                <span className="text-gray-500">
                  {uiPage} / {uiPageCount}
                </span>
                <button
                  className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                  disabled={uiPage >= uiPageCount || loading}
                  onClick={() => setUiPage((p) => Math.min(uiPageCount, p + 1))}
                >
                  다음
                </button>

                {/* 카테고리 ZIP */}
                <button
                  className={`${btn.base} ${btn.primary} ${btn.sm}`}
                  onClick={onDownloadCatsZip}
                  disabled={zipLoading || loading || total === 0}
                  title="현재 필터 결과를 카테고리별 폴더로 묶어 ZIP 다운로드"
                >
                  {zipLoading ? "ZIP 준비 중…" : "카테고리 ZIP"}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-[12px] px-3 py-2">
                ⚠ {error}
              </div>
            )}
          </div>

          {/* 검색 결과 리스트 */}
          <div className="flex flex-col gap-4 pt-4">
            {loading && (
              <div className="text-[13px] text-gray-400 text-center py-6">
                🔍 검색 중입니다...
              </div>
            )}
            {!loading && pagedVisibleItems.length === 0 && !error && (
              <div className="text-[13px] text-gray-400 text-center py-6">
                조건에 맞는 문서가 없습니다.
              </div>
            )}

            {pagedVisibleItems.map((it) => {
              const docId = it.id ?? it.documentId ?? it.DOCUMENT_ID ?? null;
              const serverFileId =
                it.serverFileId ?? it.SERVER_FILE_ID ?? it.file_id ?? null;
              const fname = displayNameOf(it);
              const ext = extOf(fname);
              const sizeBytes = it.size ?? it.fileSize ?? it.FILE_SIZE ?? 0;
              const createdAt =
                it.createdAt ?? it.CREATED_AT ?? it.created_at ?? null;
              const cLoading = loadingDocIdsRef.current.has(docId);
              const comments = commentsByDoc?.[docId] ?? [];
              const myId = me?.USER_ID ?? me?.user_id ?? me?.id ?? null;
              const isMine = (uid) => uid && myId && String(uid) === String(myId);

              return (
                <div
                  key={docId || `file-${fname}`}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-[28px] h-[28px] flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-base leading-none select-none shrink-0">
                      {ext === "pdf" ? "📕" : "📄"}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* 제목 + 카테고리 배지 */}
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-gray-900">
                            {fname}
                            {it.catPath && <span className={badge}>{it.catPath}</span>}
                          </div>
                        </div>
                        {ext && (
                          <span className="shrink-0 inline-flex items-center rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                            {ext.toUpperCase()}
                          </span>
                        )}
                      </div>

                      {/* 메타 */}
                      <div className="mt-1 text-[11px] text-gray-500">
                        {prettyBytes(sizeBytes)} ·{" "}
                        {createdAt ? new Date(createdAt).toLocaleString() : ""}
                      </div>

                      {/* 액션 버튼 */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                          className={`${btn.base} ${btn.secondary} ${btn.sm}`}
                          disabled={!serverFileId}
                          onClick={() => {
                            if (!serverFileId) return;
                            window.open(
                              joinUrl(`/download/${serverFileId}/original`),
                              "_blank",
                              "noopener,noreferrer"
                            );
                          }}
                        >
                          원본
                        </button>
                        <button
                          className={`${btn.base} ${btn.subtle} ${btn.sm}`}
                          disabled={!serverFileId}
                          onClick={() => {
                            if (!serverFileId) return;
                            window.open(
                              joinUrl(`/download/${serverFileId}/text`),
                              "_blank",
                              "noopener,noreferrer"
                            );
                          }}
                        >
                          요약 TXT
                        </button>
                        <button
                          className={`${btn.base} ${btn.danger} ${btn.sm}`}
                          onClick={() => onDeleteDoc(docId)}
                        >
                          문서 삭제
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 구분선 */}
                  <div className="my-3 h-px bg-gray-100" />

                  {/* 댓글 */}
                  <div className="border-t-0 pt-0">
                    <div className="text-[12px] text-gray-800 font-medium mb-1">
                      댓글
                    </div>
                    <div className="flex flex-col gap-2 max-h-28 overflow-y-auto">
                      {cLoading && (
                        <div className="text-[11px] text-gray-400">
                          댓글 불러오는 중…
                        </div>
                      )}
                      {!cLoading && comments.length === 0 && (
                        <div className="text-[11px] text-gray-400">
                          아직 댓글이 없습니다.
                        </div>
                      )}
                      {comments.map((c, idx) => {
                        const cid = c.id ?? c.COMMENT_ID ?? `${docId}-c-${idx}`;
                        const body = c.body ?? c.BODY ?? "";
                        const authorId =
                          c.userId ?? c.USER_ID ?? c.authorUserId ?? c.AUTHOR_USER_ID;
                        const createdAtC = c.createdAt ?? c.CREATED_AT ?? "";
                        const canDelete = isAdmin || isMine(authorId);
                        return (
                          <div
                            key={cid}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1"
                          >
                            <div className="text-[11px] text-gray-800 leading-snug break-words">
                              {body}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between gap-2">
                              <span>{createdAtC ? String(createdAtC) : ""}</span>
                              {canDelete && (
                                <button
                                  className={`${btn.base} ${btn.danger} ${btn.sm}`}
                                  onClick={() => removeComment(docId, c)}
                                  title="댓글 삭제"
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex items-start gap-2">
                      <input
                        type="text"
                        placeholder="댓글을 입력하세요…"
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-800 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                        value={commentInput[docId] || ""}
                        onChange={(e) =>
                          setCommentInput((prev) => ({
                            ...prev,
                            [docId]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitComment(it);
                        }}
                      />
                      <button
                        className={`${btn.base} ${btn.primary} ${btn.sm}`}
                        onClick={() => submitComment(it)}
                      >
                        등록
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {profileOpen && (
        <ProfileEditModal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={user}
          onSave={(updated) =>
            setUser((prev) => ({ ...(prev || {}), ...(updated || {}) }))
          }
        />
      )}
    </div>
  );
}