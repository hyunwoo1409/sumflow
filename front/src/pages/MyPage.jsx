import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";

import ProfileEditModal from "../components/ProfileEditModal";

import {
  joinUrl,
  prettyBytes,
  saveText,
  savePdf,
} from "../utils/uploadHelpers";

import {
  getMyProfile,
  getMyDocuments,
  getMyCategories,
  updateMyProfile,
} from "../utils/mypageApi";

import { getExt } from "../utils/fileUtils";
import {
  mapItemToCatPath,
  extractJoinedCats,
} from "../utils/categoryUtils";

import {
  normalizeUser,
  normalizeMyDocList,
} from "../utils/normalizeApi";

const CLIENT_PAGING_THRESHOLD = 2000;     // 이 개수 이하이면 전부 받아서 프론트에서 페이징
const SERVER_MAX_PAGE_SIZE = 100;         // 서버에 요청할 때 최대 pageSize
const DEFAULT_PAGE_SIZE = 20;             // 프론트 페이지 사이즈

const MY_RECENT_PAGE_SIZE = 8;            // 왼쪽 '내가 업로드한 문서'에서 한 번에 보여줄 카드 수
const SEARCH_PAGE_VIEW_SIZE = 3;          // 오른쪽 검색 결과 영역 화면에 보여줄 카드 수 (UI 페이지네이션 용)

export default function MyPage({ currentUser, myItemsFromState = [] }) {
  // 프로필
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState(currentUser);

  // 왼쪽 카드: 내가 업로드한 문서(최근순)
  const [myRecentDocs, setMyRecentDocs] = useState([]);
  const [myRecentDocsPage, setMyRecentDocsPage] = useState(1);

  // 검색 입력어
  const [q, setQ] = useState("");

  // 오른쪽 검색 결과 & 페이징
  const [items, setItems] = useState([]);      // 서버페이징 모드에서 현재 페이지 아이템
  const [allItems, setAllItems] = useState([]); // 프론트페이징 모드에서 전체 아이템
  const [allMode, setAllMode] = useState(false); // true면 allItems 사용
  const [total, setTotal] = useState(0);

  // 서버 기준의 페이지(1-based). allMode=false일 때만 의미 있음
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);

  // 검색 로딩/에러
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0); // 검색 재실행 트리거

  // 카테고리 데이터
  const [catsMaster, setCatsMaster] = useState([]); // 서버의 /categories (내 문서에서 실제로 쓰인 카테고리)
  const [catsRaw, setCatsRaw] = useState([]);       // 검색 결과에서 fallback으로 모은 카테고리
  const [mainSel, setMainSel] = useState("");
  const [subSel, setSubSel] = useState(new Set());

  // ---------- 초기 프로필 로드 ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 최소 필드가 비어 있으면 서버에서 갱신
        const needFetch =
          !user?.phone || !user?.email || !user?.nickname;

        if (needFetch) {
          const { success, user: u } = await getMyProfile();
          if (success && alive) {
            setUser((prev) => normalizeUser(prev, u));
          }
        }
      } catch (e) {
        console.error("마이페이지 프로필 로드 실패:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  // ---------- "내가 업로드한 문서" 초기 로드 ----------
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

  // ---------- 카테고리 로드 (내 문서 기준) ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await getMyCategories();
        // 예: res.joined = ["농림축수산/인허가", "법률/행정", ...]
        setCatsMaster(res.joined || []);
      } catch (e) {
        console.warn("카테고리 로드 실패. 검색 결과 기반으로 대체 예정", e);
      }
    })();
  }, []);

  // ---------- 카테고리 트리 만들기 (main -> sub Set) ----------
  const catSource = catsMaster.length > 0 ? catsMaster : catsRaw;

  const catTree = useMemo(() => {
    const m = new Map();
    (catSource || []).forEach((joined) => {
      const [main, sub] = String(joined).split("/").map((s) => s?.trim());
      if (!main) return;
      if (!m.has(main)) m.set(main, new Set());
      if (sub) {
        m.get(main).add(sub);
      } else {
        m.get(main).add("전체");
      }
    });
    return m;
  }, [catSource]);

  const mainList = useMemo(
    () => Array.from(catTree.keys()).sort(),
    [catTree]
  );

  const subList = useMemo(() => {
    if (!mainSel) return [];
    return Array.from(catTree.get(mainSel) || []).sort();
  }, [catTree, mainSel]);

  // ---------- 서버에 보낼 카테고리 필터 ----------
  // - 부 카테고리 선택이 있으면 그 조합만
  // - 없으면 mainSel 기준으로 mainSel/하위 전체
  // - 아무 것도 없으면 []
  const categoriesToSend = useMemo(() => {
    if (subSel.size > 0 && mainSel) {
      return Array.from(subSel).map((s) =>
        s === "전체" || s === "(전체)" ? mainSel : `${mainSel}/${s}`
      );
    }

    if (mainSel) {
      const subs = catTree.get(mainSel);
      if (!subs || subs.size === 0) {
        return [mainSel];
      }
      return Array.from(subs).map((s) => `${mainSel}/${s}`);
    }

    return [];
  }, [mainSel, subSel, catTree]);

  // ---------- 프론트/서버 페이징 구분 후 아이템 정리 ----------
  // allMode=false: items만 사용
  // allMode=true : allItems에서 잘라서 사용
  const visibleItems = useMemo(() => {
    if (!allMode) return items;
    const start = (page - 1) * pageSize;
    return allItems.slice(start, start + pageSize);
  }, [allMode, items, allItems, page, pageSize]);

  // ---------- 오른쪽 검색 영역용 추가 UI 페이징 ----------
  // 화면 카드 6개씩만 보여주고 "이전/다음" 으로 넘김
  const [uiPage, setUiPage] = useState(1);

  const uiPageCount = useMemo(() => {
    return Math.max(
      1,
      Math.ceil(visibleItems.length / SEARCH_PAGE_VIEW_SIZE)
    );
  }, [visibleItems.length]);

  const pagedVisibleItems = useMemo(() => {
    const start = (uiPage - 1) * SEARCH_PAGE_VIEW_SIZE;
    return visibleItems.slice(start, start + SEARCH_PAGE_VIEW_SIZE);
  }, [visibleItems, uiPage]);

  // ---------- 왼쪽 "내가 업로드한 문서"도 자체 페이지네이션 ----------
  const pagedMyRecentDocs = useMemo(() => {
    const start = (myRecentDocsPage - 1) * MY_RECENT_PAGE_SIZE;
    return myRecentDocs.slice(start, start + MY_RECENT_PAGE_SIZE);
  }, [myRecentDocs, myRecentDocsPage]);

  const myRecentPageCount = useMemo(() => {
    return Math.max(
      1,
      Math.ceil(myRecentDocs.length / MY_RECENT_PAGE_SIZE)
    );
  }, [myRecentDocs]);

  // ---------- 검색 실행 ----------
  const doSearch = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      // 전체 개수만 확인
      const head = await getMyDocuments({
        q,
        categories: categoriesToSend,
        page: 1,
        pageSize: 1,
      });

      const totalCount = head?.total ?? 0;

      if (totalCount > 0 && totalCount <= CLIENT_PAGING_THRESHOLD) {
        // 프론트 페이징 모드 (전부 가져와서 allItems에 보관)
        const pages = Math.max(
          1,
          Math.ceil(totalCount / SERVER_MAX_PAGE_SIZE)
        );

        let acc = [];
        let catsSet = new Set();

        for (let p = 1; p <= pages; p++) {
          const chunk = await getMyDocuments({
            q,
            categories: categoriesToSend,
            page: p,
            pageSize: SERVER_MAX_PAGE_SIZE,
          });

          const mappedChunk = (chunk?.items || []).map(mapItemToCatPath);
          acc = acc.concat(mappedChunk);

          extractJoinedCats(chunk, mappedChunk).forEach((c) =>
            catsSet.add(c)
          );
        }

        // q로 한번 더 거르기(파일명/카테고리 안에 q가 있는지)
        const qTrim = q.trim().toLowerCase();
        const afterFilter = !qTrim
          ? acc
          : acc.filter((it) => {
              const name = (it.title || it.filename || "").toLowerCase();
              const cat = (it.catPath || "").toLowerCase();
              return name.includes(qTrim) || cat.includes(qTrim);
            });

        setAllItems(afterFilter);
        setItems([]);
        setAllMode(true);
        setTotal(afterFilter.length);

        // 마스터 카테고리 없으면 여기서라도 채워줌
        if (catsMaster.length === 0) {
          setCatsRaw(Array.from(catsSet).sort());
        }
      } else {
        // 서버 페이징 모드
        const pageRes = await getMyDocuments({
          q,
          categories: categoriesToSend,
          page,
          pageSize: SERVER_MAX_PAGE_SIZE,
        });

        const mapped = (pageRes.items || []).map(mapItemToCatPath);

        const qTrim = q.trim().toLowerCase();
        const afterFilter = !qTrim
          ? mapped
          : mapped.filter((it) => {
              const name = (it.title || it.filename || "").toLowerCase();
              const cat = (it.catPath || "").toLowerCase();
              return name.includes(qTrim) || cat.includes(qTrim);
            });

        setItems(afterFilter);
        setAllItems([]);
        setAllMode(false);
        setTotal(pageRes.total ?? afterFilter.length);

        if (catsMaster.length === 0) {
          setCatsRaw(extractJoinedCats(pageRes, mapped));
        }
      }
    } catch (e) {
      setError(e?.message || "검색 중 오류");
      setItems([]);
      setAllItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, categoriesToSend, page, catsMaster.length]);

  // 최초 1번 검색
  useEffect(() => {
    setSearchTrigger((n) => n + 1);
  }, []);

  // searchTrigger 바뀌면 검색
  useEffect(() => {
    if (searchTrigger) {
      setUiPage(1);
      doSearch();
    }
  }, [searchTrigger, doSearch]);

  // page 바뀔 때(서버 페이징 모드만 의미 있음) 다시 불러오기
  useEffect(() => {
    if (searchTrigger && !allMode) {
      setUiPage(1);
      doSearch();
    }
  }, [page, allMode, searchTrigger, doSearch]);

  // ---------- 이벤트 핸들러 ----------
  const handleSaveProfile = (updated) => {
    setUser((prev) => ({ ...prev, ...updated }));
  };

  const onKeyDownSearch = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setPage(1);
      setSearchTrigger((n) => n + 1);
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

  // 카테고리 뱃지 렌더
  const renderCatJoined = (pathOrMain, maybeChild) => {
    let main;
    let sub;

    if (maybeChild !== undefined) {
      main = pathOrMain;
      sub = maybeChild;
    } else {
      const parts = String(pathOrMain || "").split("/");
      main = parts[0] || "";
      sub = parts[1] || "";
    }

    if (!main && !sub) return null;

    if (!sub) {
      return (
        <span className="inline-flex items-center rounded-md bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-medium px-2 py-[2px]">
          <span>{main || "-"}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-md bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-medium px-2 py-[2px]">
        <span>{main || "-"}</span>
        <span className="mx-1 text-gray-400">·</span>
        <span>{sub || "-"}</span>
      </span>
    );
  };

  // ============================
  // RENDER
  // ============================
  return (
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
          <div className="text-[13px] font-semibold text-gray-700">
            내가 업로드한 문서
          </div>
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
            <div className="text-[12px] text-gray-400">
              업로드한 문서가 없습니다.
            </div>
          )}

          {pagedMyRecentDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm p-3"
            >
              <div className="flex items-start gap-3">
                {/* 아이콘 */}
                <div className="w-[32px] h-[32px] flex items-center justify-center rounded-lg border border-gray-300 bg-gray-50 text-lg leading-none select-none">
                  📄
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">
                    {doc.filename || "문서_001.pdf"}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {prettyBytes(doc.size || 0)} ·{" "}
                    {new Date(
                      doc.createdAt || Date.now()
                    ).toLocaleString()}
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

          {/* 왼쪽 리스트 페이지네이션 */}
          {myRecentPageCount > 1 && (
            <div className="flex items-center justify-between text-[11px] text-gray-600 mt-2">
              <button
                className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                disabled={myRecentDocsPage <= 1}
                onClick={() =>
                  setMyRecentDocsPage((p) => Math.max(1, p - 1))
                }
              >
                이전
              </button>

              <span className="text-gray-500">
                {myRecentDocsPage} / {myRecentPageCount}
              </span>

              <button
                className="rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                disabled={myRecentDocsPage >= myRecentPageCount}
                onClick={() =>
                  setMyRecentDocsPage((p) =>
                    Math.min(myRecentPageCount, p + 1)
                  )
                }
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
        onSave={handleSaveProfile}
      />

      {/* RIGHT: 문서 검색 */}
      <section className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm p-4">
        {/* 검색바 / 필터 */}
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-4">
          {/* 검색창 + 필터 초기화 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDownSearch}
              placeholder="제목 또는 카테고리로 검색…"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
            />

            <button
              onClick={clearFilters}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap"
            >
              필터 초기화
            </button>
          </div>

          {/* 주 카테고리 칩 */}
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

          {/* 부 카테고리 칩 */}
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

          {/* 상태정보 + 우측 작은 페이지네이션 (uiPage) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px] text-gray-600">
            {/* 상태 라인 */}
            <div className="flex flex-wrap items-center gap-2 leading-none">
              <span className="w-[6px] h-[6px] rounded-full bg-pink-500 inline-block" />
              <span className="text-gray-700 font-medium">
                {loading ? "검색 중…" : `총 ${total}건`}
              </span>
              {mainSel && (
                <span className="text-gray-500">· 주 {mainSel}</span>
              )}
              {subSel.size > 0 && (
                <span className="text-gray-500">
                  · 부 {Array.from(subSel).join(", ")}
                </span>
              )}
              {q && <span className="text-gray-500">· “{q}”</span>}
            </div>

            {/* 화면 전환용 페이지네이션 */}
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
                onClick={() =>
                  setUiPage((p) => Math.min(uiPageCount, p + 1))
                }
              >
                다음
              </button>
            </div>
          </div>

          {/* 에러 표시 */}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-[12px] px-3 py-2">
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

          {pagedVisibleItems.map((it) => (
            <div
              key={it.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm p-4"
            >
              {/* 상단: 파일 정보 */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <span className="text-[20px] leading-none select-none">
                      📄
                    </span>

                    <div className="min-w-0">
                      <div
                        className="text-[13px] font-semibold text-gray-900 truncate"
                        title={it.title || it.filename}
                      >
                        {it.title || it.filename}
                      </div>

                      <div className="text-[11px] text-gray-500">
                        {prettyBytes(it.size || 0)} ·{" "}
                        {new Date(
                          it.createdAt || Date.now()
                        ).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] font-medium">
                  <span className="inline-flex items-center rounded-md bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-[2px]">
                    {getExt(it.filename || it.title || "") || "file"}
                  </span>
                </div>
              </div>

              {/* 카테고리 뱃지 / 요약 다운로드 */}
              <div className="mt-3">
                <div className="mt-2 flex flex-wrap gap-2">
                  {it.catPath && renderCatJoined(it.catPath)}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                  <button
                    className="px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
                    onClick={() =>
                      saveText(
                        `${(it.filename || "summary").replace(
                          /\.[^.]+$/,
                          ""
                        )}_summary.txt`,
                        it.summary || ""
                      )
                    }
                  >
                    요약 .txt
                  </button>

                  <button
                    className="px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
                    onClick={() =>
                      savePdf(
                        `${(it.filename || "summary").replace(
                          /\.[^.]+$/,
                          ""
                        )}_summary.pdf`,
                        it.summary || ""
                      )
                    }
                  >
                    요약 .pdf
                  </button>
                </div>
              </div>

              {/* 원본 텍스트 / JSON 다운로드 */}
              {it.serverFileId && (
                <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                  <a
                    className="px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium inline-block"
                    href={joinUrl(`/download/${it.serverFileId}/text`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    텍스트 받기
                  </a>

                  <a
                    className="px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium inline-block"
                    href={joinUrl(`/download/${it.serverFileId}/json`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    JSON 받기
                  </a>
                </div>
              )}

              {/* 댓글 영역 */}
              <div className="mt-4 border-t border-gray-200 pt-3">
                <div className="text-[12px] text-gray-700 font-medium mb-2">
                  댓글
                </div>

                {/* 기존 댓글 */}
                <div className="flex flex-col gap-2 max-h-24 overflow-y-auto">
                  {(it.comments || []).length === 0 && (
                    <div className="text-[11px] text-gray-400">
                      아직 댓글이 없습니다.
                    </div>
                  )}

                  {(it.comments || []).map((c, idx) => (
                    <div
                      key={idx}
                      className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1"
                    >
                      <div className="text-[11px] text-gray-800 leading-snug break-words">
                        {c.body}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 flex justify-between">
                        <span>{c.authorNickname || "익명"}</span>
                        <span>{c.createdAt || ""}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 새 댓글 입력 */}
                <div className="mt-2 flex items-start gap-2">
                  <input
                    type="text"
                    placeholder="댓글을 입력하세요…"
                    className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[12px] text-gray-800 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                  />
                  <button
                    className="px-2 py-1 rounded-md bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800"
                  >
                    등록
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}