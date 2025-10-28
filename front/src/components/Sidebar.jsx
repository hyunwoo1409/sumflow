import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home,
  FolderOpen,
  Settings,
  LogIn,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

/**
 * props
 * - activeTab: 'home' | 'mypage' | 'admin'
 * - setActiveTab(tab)
 * - categories: string[]
 * - selectedCats: Set<string>
 * - toggleCat(cat)
 * - collapsed: boolean
 * - setCollapsed(fn)
 * - isLoggedIn: boolean
 * - userNickname: string
 * - isAdmin: boolean | number | string   // 관리자면 1도 올 수 있음
 * - onLogout(): void                     // 부모 쪽에서 실제 로그아웃 처리+alert
 */
export default function Sidebar({
  activeTab,
  setActiveTab,
  categories = [],
  selectedCats,
  toggleCat,
  collapsed,
  setCollapsed,
  isLoggedIn = false,
  userNickname = "사용자",
  isAdmin = false,
  onLogout,
}) {
  const navigate = useNavigate();

  // DB에서 1, "1", true, "true" 등으로 와도 전부 true로 인식
  const isAdminBool =
    isAdmin === 1 ||
    isAdmin === "1" ||
    isAdmin === true ||
    isAdmin === "true";

  // 카테고리 정제 로직
  const pureCats = useMemo(() => {
    const isCategoryLike = (s) => {
      if (!s || typeof s !== "string") return false;
      const t = s.trim();

      // 괄호/브라켓 들어간 태그 제거 (ex. "경제(요약)")
      if (/[[(\]]/.test(t)) return false;

      // 년도같은 숫자 덩어리만 있는 문자열 제거 (ex. "20241027")
      if (/\d{4,}/.test(t)) return false;

      // 파일명처럼 보이면 제거
      if (/\.(pdf|hwp|hwpx|docx?)$/i.test(t)) return false;

      // URL류 제거
      if (/https?:\/\//i.test(t)) return false;

      // 너무 긴 건 제거
      if (t.length > 24) return false;

      return true;
    };

    // 중복 제거 후 최대 30개
    return Array.from(new Set(categories.filter(isCategoryLike))).slice(
      0,
      30
    );
  }, [categories]);

  // 로그아웃 버튼 눌렀을 때: 여기서는 부모 콜백만 호출
  const handleLogoutClick = () => {
    onLogout?.();
  };

  const navBtnBase =
    "grid grid-cols-[28px_1fr] items-center gap-2 w-full text-left rounded-xl border border-transparent px-3 py-2 text-[14px] font-medium cursor-pointer transition-colors";
  const navBtnActive =
    "bg-[rgba(110,168,254,0.15)] border-[rgba(110,168,254,0.4)] text-gray-900";
  const navBtnHover =
    "hover:bg-gray-100 hover:text-gray-900 text-gray-700";

  return (
    <aside
      aria-label="사이드바"
      className={`
        flex flex-col bg-white text-gray-900 border-r border-gray-200
        h-screen sticky top-0 overflow-hidden
        transition-[width,padding] duration-200
        ${collapsed ? "w-[72px] px-4 py-4" : "w-[240px] px-4 py-4"}
      `}
    >
      {/* 상단: 로고 / 토글 */}
      <div
        className={`flex items-center justify-between mb-4 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <>
            {/* 로고 클릭 => 홈으로 */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => {
                setActiveTab("home");
                navigate("/");
              }}
            >
              <img
                src="/image/main로고.png"
                alt="SumFlow"
                className="object-contain w-[150px] h-[80px]"
              />
            </div>

            {/* 접기 버튼 */}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="w-9 h-9 rounded-lg border border-gray-300 bg-white text-gray-700 grid place-items-center hover:bg-gray-100"
              aria-label="사이드바 접기"
              title="접기"
            >
              <ChevronLeft size={18} />
            </button>
          </>
        )}

        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="w-10 h-10 rounded-lg border border-gray-300 bg-white text-gray-700 grid place-items-center hover:bg-gray-100 shadow-sm"
            aria-label="사이드바 펼치기"
            title="펼치기"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {/* 네비게이션 */}
      <nav className="grid gap-2">
        {/* 홈 */}
        <button
          onClick={() => {
            setActiveTab("home");
            navigate("/");
          }}
          className={`${navBtnBase} ${
            activeTab === "home" ? navBtnActive : navBtnHover
          }`}
          title="홈"
        >
          <Home size={20} />
          {!collapsed && <span>홈</span>}
        </button>

        {/* 마이페이지 */}
        <button
          onClick={() => {
            setActiveTab("mypage");
            navigate("/");
          }}
          className={`${navBtnBase} ${
            activeTab === "mypage" ? navBtnActive : navBtnHover
          }`}
          title="마이페이지"
        >
          <FolderOpen size={20} />
          {!collapsed && <span>마이페이지</span>}
        </button>

        {/* 관리자 페이지 (관리자한테만 노출) */}
        {isAdminBool && (
          <button
            onClick={() => {
              setActiveTab("admin");
              navigate("/admin");
            }}
            className={`${navBtnBase} ${
              activeTab === "admin" ? navBtnActive : navBtnHover
            }`}
            title="관리자 페이지"
          >
            <Settings size={20} />
            {!collapsed && <span>관리자 페이지</span>}
          </button>
        )}
      </nav>

      {/* 최근 카테고리 */}
      {pureCats.length > 0 && (
        <div className="mt-4">
          {!collapsed && (
            <div className="text-[12px] text-gray-500 mb-2">
              최근 카테고리
            </div>
          )}

          <div
            className={`flex flex-wrap gap-1.5 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {pureCats.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setActiveTab("mypage");
                  toggleCat(c);
                  navigate("/");
                }}
                title={c}
                className={`rounded-lg border text-[11px] font-medium leading-none px-2 py-1
                  ${
                    selectedCats.has(c)
                      ? "bg-blue-100 border-blue-300 text-blue-700"
                      : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                  }
                  ${
                    collapsed
                      ? "w-8 h-8 flex items-center justify-center px-0"
                      : ""
                  }
                `}
              >
                {collapsed ? c.slice(0, 2) : c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 하단 로그인 / 프로필 / 로그아웃 */}
      <div className="mt-auto pt-4">
        {!isLoggedIn ? (
          // 로그인 버튼
          <button
            onClick={() => navigate("/member/login")}
            title="로그인"
            className="w-full flex items-center justify-center gap-2 text-white font-semibold text-[14px] rounded-lg px-3 py-2 bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 transition"
          >
            <LogIn size={18} />
            {!collapsed && <span>로그인</span>}
          </button>
        ) : (
          // 프로필 + 로그아웃
          <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-[13px] text-gray-900 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              {/* 프로필 아바타 (이니셜) */}
              <div className="w-9 h-9 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center text-sm font-bold">
                {userNickname?.slice(0, 2) || "유저"}
              </div>

              {!collapsed && (
                <div>
                  <div className="font-semibold truncate text-[13px] text-gray-900">
                    {userNickname}
                  </div>
                  <div className="text-[11px] text-gray-500 leading-tight">
                    {isAdminBool ? "관리자" : "일반 사용자"}
                  </div>
                </div>
              )}
            </div>

            {!collapsed && (
              <button
                onClick={handleLogoutClick}
                className="px-3 py-2 rounded-lg text-white text-sm font-semibold bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 flex items-center justify-center gap-1"
              >
                <LogOut size={15} />
                로그아웃
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}