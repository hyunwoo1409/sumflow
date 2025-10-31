import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import ProfileEditModal from "../components/ProfileEditModal";

import { joinUrl, prettyBytes } from "../utils/uploadHelpers";
import {
  getMyProfile,
  getMyDocuments,
  getMyCategories,
  listDocComments,
  createDocComment,
  deleteDocComment,
} from "../utils/mypageApi";

import { mapItemToCatPath, extractJoinedCats } from "../utils/categoryUtils";
import { normalizeUser, normalizeMyDocList } from "../utils/normalizeApi";

const CLIENT_PAGING_THRESHOLD = 2000;
const SERVER_MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const MY_RECENT_PAGE_SIZE = 8;
const SEARCH_PAGE_VIEW_SIZE = 3;

export default function MyPage({ currentUser, myItemsFromState = [] }) {
  const navigate = useNavigate();

  // 사이드바/사용자
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [nickname, setNickname] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (token && (user?.name || user?.nickname)) {
      setIsLoggedIn(true);
      setNickname(user.nickname || user.name || "");
      const rawAdmin =
        user.isAdmin ?? user.IS_ADMIN ?? user.is_admin ?? user.admin ?? 0;
      const normalizedIsAdmin =
        rawAdmin === 1 || rawAdmin === "1" || rawAdmin === true || rawAdmin === "true";
      setIsAdmin(normalizedIsAdmin);
    } else {
      setIsLoggedIn(false);
      setNickname("");
      setIsAdmin(false);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setIsLoggedIn(false);
    setNickname("");
    alert("로그아웃 되었습니다.");
    navigate("/member/login");
  };

  // 프로필
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState(currentUser);

  // "내가 업로드한 문서"
  const [myRecentDocs, setMyRecentDocs] = useState([]);
  const [myRecentDocsPage, setMyRecentDocsPage] = useState(1);

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
  const [error, setError] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0);

  // 카테고리
  const [catsMaster, setCatsMaster] = useState([]);
  const [catsRaw, setCatsRaw] = useState([]);
  const [mainSel, setMainSel] = useState("");
  const [subSel, setSubSel] = useState(new Set());

  // 댓글
  const [commentsByDoc, setCommentsByDoc] = useState({});
  const [commentInput, setCommentInput] = useState({});
  const loadingDocIdsRef = useRef(new Set()); // 로딩 중 docId 집합

  // 파일명 표시용
  function displayNameOf(doc = {}) {
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
  function extOf(name = "") {
    const i = name.lastIndexOf(".");
    return i > -1 ? name.slice(i + 1).toLowerCase() : "";
  }
  function iconByExt(ext = "") {
    switch (ext) {
      case "pdf":  return "📕";
      case "hwp":  return "📝";
      case "hwpx": return "📝";
      case "doc":
      case "docx": return "📘";
      case "xls":
      case "xlsx": return "📗";
      case "ppt":
      case "pptx": return "📙";
      case "txt":  return "📄";
      default:     return "📄";
    }
  }

  const me = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);

  // ===== 프로필 로드: 마운트 1회만 =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const needFetch =
          !user?.phone || !user?.email || !user?.nickname;
        if (needFetch) {
          const { success, user: u } = await getMyProfile();
          if (success && !cancelled) {
            // 기존 값 유지 + 백엔드 값 merge
            setUser((prev) => normalizeUser(prev, u));
          }
        }
      } catch (e) {
        console.error("마이페이지 프로필 로드 실패:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // ✅ 의존성 제거 -> 무한 루프 방지

  // 내 문서 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await getMyDocuments({
          q: "",
          categories: [],
          page: 1,
          pageSize: 10,
        });
        setMyRecentDocs(normalizeMyDocList(res.items || []));
      } catch (err) {
        console.error("내 업로드 문서 로드 실패:", err);
        setMyRecentDocs([]);
      }
    })();
  }, []);

  // 카테고리 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await getMyCategories();
        setCatsMaster(res.joined || []);
      } catch (e) {
        console.warn("카테고리 로드 실패. 검색 결과 기반으로 대체 예정", e);
      }
    })();
  }, []);

  // 카테고리 트리/목록
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

  const mainList = useMemo(() => Array.from(catTree.keys()).sort(), [catTree]);

  const subList = useMemo(() => {
    if (!mainSel) return [];
    return Array.from(catTree.get(mainSel) || []).sort();
  }, [catTree, mainSel]);

  // 서버로 보낼 카테고리 필터
  const categoriesToSend = useMemo(() => {
    if (subSel.size > 0 && mainSel) {
      return Array.from(subSel).map((s) =>
        s === "전체" || s === "(전체)" ? mainSel : `${mainSel}/${s}`
      );
    }
    if (mainSel) {
      const subs = catTree.get(mainSel);
      if (!subs || subs.size === 0) return [mainSel];
      return Array.from(subs).map((s) => `${mainSel}/${s}`);
    }
    return [];
  }, [mainSel, subSel, catTree]);

  // 사이드바 카테고리 데이터
  const sidebarCategories = useMemo(() => {
    const s = new Set();
    (catSource || []).forEach((joined) => {
      const [m, sub] = String(joined).split("/").map((t) => t?.trim());
      if (m) s.add(m);
      if (m && sub) s.add(`${m}/${sub}`);
    });
    return Array.from(s).slice(0, 30);
  }, [catSource]);

  const selectedCatsForSidebar = useMemo(() => {
    const s = new Set();
    if (mainSel) s.add(mainSel);
    subSel.forEach((sub) => s.add(`${mainSel}/${sub}`));
    return s;
  }, [mainSel, subSel]);

  // 결과 가시 목록
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

  // 왼쪽 목록 페이지네이션
  const pagedMyRecentDocs = useMemo(() => {
    const start = (myRecentDocsPage - 1) * MY_RECENT_PAGE_SIZE;
    return myRecentDocs.slice(start, start + MY_RECENT_PAGE_SIZE);
  }, [myRecentDocs, myRecentDocsPage]);
  const myRecentPageCount = useMemo(
    () => Math.max(1, Math.ceil(myRecentDocs.length / MY_RECENT_PAGE_SIZE)),
    [myRecentDocs]
  );

  // 검색 실행
  const doSearch = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const head = await getMyDocuments({ q: appliedQ, categories: categoriesToSend, page: 1, pageSize: 1 });
      const totalCount = head?.total ?? 0;

      if (totalCount > 0 && totalCount <= CLIENT_PAGING_THRESHOLD) {
        const pages = Math.max(1, Math.ceil(totalCount / SERVER_MAX_PAGE_SIZE));
        let acc = [];
        let catsSet = new Set();

        for (let p = 1; p <= pages; p++) {
          const chunk = await getMyDocuments({ q: appliedQ, categories: categoriesToSend, page: p, pageSize: SERVER_MAX_PAGE_SIZE });
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
        const pageRes = await getMyDocuments({ q: appliedQ, categories: categoriesToSend, page, pageSize: SERVER_MAX_PAGE_SIZE });
        const mapped = (pageRes.items || []).map(mapItemToCatPath);

        setItems(mapped);
        setAllItems([]);
        setAllMode(false);
        setTotal(pageRes.total ?? mapped.length);

        if (catsMaster.length === 0) setCatsRaw(extractJoinedCats(pageRes, mapped));
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

  const mapItemToCatPath = (it) => {
   const catPath =
     it.catPath ||
     it.cat_path ||
     (it.parent_name && it.child_name
       ? `${it.parent_name}/${it.child_name}`
       : it.child_name || it.parent_name || null);

   // 필드 정규화
   const id =
     it.id ?? it.documentId ?? it.DOCUMENT_ID ?? null;
   const filename =
     it.title ??
     it.filename ??
     it.originalFilename ??
     it.ORIGINAL_FILENAME ??
     it.changed_filename ??
     it.CHANGED_FILENAME ??
     "";
   const createdAt =
     it.createdAt ?? it.CREATED_AT ?? it.created_at ?? null;
   const size =
     it.size ?? it.fileSize ?? it.FILE_SIZE ?? 0;
   const serverFileId =
     it.serverFileId ?? it.SERVER_FILE_ID ?? it.file_id ?? null;

   return { ...it, id, filename, createdAt, size, serverFileId, catPath };
  };

  // 최초/조건 변경 시 검색
  useEffect(() => setSearchTrigger((n) => n + 1), []);
  useEffect(() => {
    if (!searchTrigger) return;
    setUiPage(1);
    doSearch();
  }, [searchTrigger]);
  useEffect(() => {
    if (!searchTrigger || allMode) return; // 서버 페이징일 때만
    setUiPage(1);
    doSearch();
  }, [page, allMode, searchTrigger]);

  // ===== 댓글 로딩 함수 (중복 방지) =====
  const ensureComments = useCallback(
    async (docId) => {
      if (!docId) return;
      if (commentsByDoc[docId]) return; // 이미 있음
      if (loadingDocIdsRef.current.has(docId)) return; // 로딩 중

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

  // 현재 보이는 카드들의 댓글만 로드
  useEffect(() => {
    const ids = (pagedVisibleItems || [])
      .map((it) => it.id ?? it.documentId ?? it.DOCUMENT_ID ?? it.docId)
      .filter(Boolean);
    ids.forEach((id) => ensureComments(id));
  }, [pagedVisibleItems, ensureComments]);

  const submitComment = async (doc) => {
    const docId = doc.id ?? doc.DOCUMENT_ID;
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

  const onClickMain = (m) => {
    setMainSel((prev) => (prev === m ? "" : m));
    setSubSel(new Set());
    setPage(1);
    setSearchTrigger((n) => n + 1);
  };

  const onToggleSub = (s) => {
    setSubSel((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
    setPage(1);
    setSearchTrigger((n) => n + 1);
  };

  const clearFilters = () => {
    setQ("");
    setMainSel("");
    setSubSel(new Set());
    setPage(1);
    setItems([]);
    setAllItems([]);
    setTotal(0);
    setSearchTrigger((n) => n + 1);
  };

  return (
    <div className="flex">
      <Sidebar
        activeTab="mypage"
        setActiveTab={() => {}}
        categories={sidebarCategories}
        selectedCats={selectedCatsForSidebar}
        toggleCat={() => {}}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        isLoggedIn={isLoggedIn}
        userNickname={nickname || "사용자"}
        isAdmin={isAdmin}
        onLogout={handleLogout}
      />

      <main className="flex-1 min-h-screen bg-[#f8fafc] p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
          {/* LEFT: 프로필 + 내가 업로드한 문서 */}
          <section className="flex flex-col gap-4">
            {/* 프로필 카드 */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="flex flex-col">
                  <div className="text-[14px] font-semibold text-gray-900">
                    {user?.nickname || "닉네임"}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-3 leading-relaxed">
                    <div>
                      전화번호 :{" "}
                      <span className="text-gray-800">
                        {user?.phone ?? currentUser?.phone ?? "010-0000-0000"}
                      </span>
                    </div>
                    <div className="mt-1">
                      이메일 :{" "}
                      <span className="text-gray-800">
                        {user?.email ?? currentUser?.email ?? "email@abc.com"}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                >
                  프로필 편집
                </button>
              </div>
            </div>

            {/* 섹션 헤더 */}
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-gray-700">내가 업로드한 문서</div>
              <button
                className="px-2 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-300 text-[11px] font-medium text-gray-700"
                type="button"
              >
                전체 삭제
              </button>
            </div>

            {/* 업로드한 문서 리스트 */}
            <div className="flex flex-col gap-3">
              {pagedMyRecentDocs.length === 0 && (
                <div className="text-[12px] text-gray-400">업로드한 문서가 없습니다.</div>
              )}
              {pagedMyRecentDocs.map((doc) => (
                <div key={doc.id} className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-[32px] h-[32px] flex items-center justify-center rounded-lg border border-gray-300 bg-gray-50 text-lg leading-none select-none">📄</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">
                        {displayNameOf(doc)}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {prettyBytes(doc.size || 0)} · {new Date(doc.createdAt || Date.now()).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 text-[11px] shrink-0">
                      <button
                        className="px-2 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700"
                        onClick={() => {
                          if (!doc.serverFileId) return;
                          window.open(
                            joinUrl(`/download/${doc.serverFileId}/text`),
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                      >
                        다운로드
                      </button>
                      <button className="px-2 py-1 rounded-md bg-white border border-red-300 text-red-600 font-medium hover:bg-red-50">
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {myRecentPageCount > 1 && (
                <div className="flex items-center justify-between text-[11px] text-gray-600 mt-2">
                  <button
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                    disabled={myRecentDocsPage <= 1}
                    onClick={() => setMyRecentDocsPage((p) => Math.max(1, p - 1))}
                  >
                    이전
                  </button>
                  <span className="text-gray-500">{myRecentDocsPage} / {myRecentPageCount}</span>
                  <button
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                    disabled={myRecentDocsPage >= myRecentPageCount}
                    onClick={() => setMyRecentDocsPage((p) => Math.min(myRecentPageCount, p + 1))}
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 프로필 수정 모달 */}
          <ProfileEditModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            user={user}
            onSave={(updated) => setUser((prev) => ({ ...prev, ...updated }))}
          />

          {/* RIGHT: 문서 검색 */}
          <section className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm p-4">
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
                      setSearchTrigger((n) => n + 1);
                    }
                  }}
                  placeholder="제목 또는 카테고리로 검색…"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                />
                <button
                  onClick={() => {
                    setPage(1);
                    setSearchTrigger((n) => n + 1);
                  }}
                  className="rounded-lg border border-gray-300 bg-gray-900 text-white px-3 py-2 text-[12px] font-medium hover:bg-gray-800 whitespace-nowrap"
                >
                  검색
                </button>
                <button
                  onClick={clearFilters}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                >
                  필터 초기화
                </button>
              </div>

              {mainList.length > 0 && (
                <div className="flex flex-wrap items-start gap-2 text-[12px]">
                  <button
                    className={`px-2 py-1 rounded-md border ${
                      mainSel === ""
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                    }`}
                    onClick={() => onClickMain("")}
                  >
                    전체
                  </button>
                  {mainList.map((m) => (
                    <button
                      key={m}
                      className={`px-2 py-1 rounded-md border ${
                        mainSel === m
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                      }`}
                      onClick={() => onClickMain(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}

              {mainSel && subList.length > 0 && (
                <div className="flex flex-wrap items-start gap-2 text-[12px]">
                  {subList.map((s) => (
                    <button
                      key={s}
                      className={`px-2 py-1 rounded-md border ${
                        subSel.has(s)
                          ? "bg-purple-600 text-white border-purple-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                      onClick={() => onToggleSub(s)}
                      title={`${mainSel}/${s}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px] text-gray-600">
                <div className="flex flex-wrap items-center gap-2 leading-none">
                  <span className="w-[6px] h-[6px] rounded-full inline-block" />
                  <span className="text-gray-700 font-medium">
                    {loading ? "검색 중…" : `총 ${total}건`}
                  </span>
                  {mainSel && <span className="text-gray-500">· 주 {mainSel}</span>}
                  {subSel.size > 0 && (
                    <span className="text-gray-500">· 부 {Array.from(subSel).join(", ")}</span>
                  )}
                  {q && <span className="text-gray-500">· “{q}”</span>}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    disabled={uiPage <= 1 || loading}
                    onClick={() => setUiPage((p) => Math.max(1, p - 1))}
                  >
                    이전
                  </button>
                  <span className="text-gray-500">
                    {uiPage} / {uiPageCount}
                  </span>
                  <button
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    disabled={uiPage >= uiPageCount || loading}
                    onClick={() => setUiPage((p) => Math.min(uiPageCount, p + 1))}
                  >
                    다음
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-[12px] px-3 py-2">
                  ⚠ {error}
                </div>
              )}
            </div>

            {/* 검색 결과 리스트 */}
            <div className="flex flex-col gap-4 pt-4">
              {loading && (
                <div className="text-[13px] text-gray-400 text-center py-6">🔍 검색 중입니다...</div>
              )}
              {!loading && pagedVisibleItems.length === 0 && !error && (
                <div className="text-[13px] text-gray-400 text-center py-6">조건에 맞는 문서가 없습니다.</div>
              )}

              {pagedVisibleItems.map((it) => {
                const docId        = it.id ?? it.documentId ?? it.DOCUMENT_ID ?? null;
                const serverFileId = it.serverFileId ?? it.SERVER_FILE_ID ?? it.file_id ?? null;
                const fname        = displayNameOf(it);
                const ext          = extOf(fname);
                const sizeBytes    = it.size ?? it.fileSize ?? it.FILE_SIZE ?? 0;
                const createdAt    = it.createdAt ?? it.CREATED_AT ?? it.created_at ?? null;
                const cLoading = loadingDocIdsRef.current.has(docId);
                const comments = commentsByDoc?.[docId] ?? [];
                const myId = me?.USER_ID ?? me?.user_id ?? me?.id ?? null;

                return (
                  <div key={docId || fname} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
                    {/* 파일 메타 */}
                    <div className="flex items-start gap-3">
                      <div className="w-[32px] h-[32px] flex items-center justify-center rounded-lg border border-gray-300 bg-gray-50 text-lg leading-none select-none">
                        {iconByExt(ext)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-gray-900 truncate">
                          {fname}
                          {ext && (
                            <span className="ml-2 inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">
                              {ext.toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-500">
                          {prettyBytes(sizeBytes)} · {createdAt ? new Date(createdAt).toLocaleString() : ""}
                          {it.catPath && <> · <span className="text-gray-600">{it.catPath}</span></>}
                        </div>
                      </div>

                      {/* 다운로드 버튼 */}
                      <div className="flex flex-col gap-2 text-[11px] shrink-0">
                        <button
                          className="px-2 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40"
                          disabled={!serverFileId}
                          onClick={() =>
                            window.open(
                              joinUrl(`/download/${serverFileId}/text`),
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          요약 TXT
                        </button>
                        <button
                          className="px-2 py-1 rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                          disabled={!serverFileId}
                          onClick={() =>
                            window.open(
                              joinUrl(`/download/${serverFileId}/pdf`),
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          결과 PDF
                        </button>
                        <button
                          className="px-2 py-1 rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                          disabled={!serverFileId}
                          onClick={() =>
                            window.open(
                              joinUrl(`/download/${serverFileId}/original`),
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          원본
                        </button>
                      </div>
                    </div>

                    {/* 댓글 */}
                    <div className="mt-4 border-t border-gray-200 pt-3">
                      <div className="text-[12px] text-gray-700 font-medium mb-2">댓글</div>

                      <div className="flex flex-col gap-2 max-h-32 overflow-y-auto">
                        {cLoading && <div className="text-[11px] text-gray-400">댓글 불러오는 중…</div>}
                        {!cLoading && comments.length === 0 && (
                          <div className="text-[11px] text-gray-400">아직 댓글이 없습니다.</div>
                        )}
                        {comments.map((c) => {
                          const cid       = c.id ?? c.COMMENT_ID;
                          const body      = c.body ?? c.BODY ?? "";
                          const authorId  = c.userId ?? c.USER_ID ?? c.authorUserId ?? c.AUTHOR_USER_ID;
                          const createdAt = c.createdAt ?? c.CREATED_AT ?? "";
                          const isMineComment = authorId && myId && String(authorId) === String(myId);

                          return (
                            <div key={cid} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1">
                              <div className="text-[11px] text-gray-800 leading-snug break-words">{body}</div>
                              <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between gap-2">
                                <span>{c.authorNickname || "나"}</span>
                                <div className="flex items-center gap-2">
                                  <span>{createdAt ? String(createdAt) : ""}</span>
                                  {isMineComment && (
                                    <button
                                      className="px-1.5 py-0.5 rounded border border-red-300 text-red-600 bg-white hover:bg-red-50"
                                      onClick={() => removeComment(docId, c)}
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    
                      <div className="mt-2 flex items-start gap-2">
                        <input
                          type="text"
                          placeholder="댓글을 입력하세요…"
                          className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-800 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                          value={commentInput[docId] || ""}
                          onChange={(e) =>
                            setCommentInput((prev) => ({ ...prev, [docId]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitComment(it);
                          }}
                        />
                        <button
                          className="px-2 py-1 rounded-md bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800"
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
        </div>
      </main>
    </div>
  );
}
