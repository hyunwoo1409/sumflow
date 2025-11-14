import React, { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home,
  Files,
  Search as SearchIcon,
  Settings,
  LogIn,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import ProfileEditModal from "./ProfileEditModal";

export default function Sidebar({
  userNickname = "사용자",
  isAdmin = false,
  collapsed,
  setCollapsed,
}) {
  const navigate = useNavigate();

  // --- 키/스토리지 유틸 ---
  const TOKEN_KEY = "token";
  const USER_KEY = "user";
  const REMEMBER_KEY = "remember_me";

  const readJson = (raw) => {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const readAuth = () => {
    const token =
      localStorage.getItem(TOKEN_KEY) ||
      sessionStorage.getItem(TOKEN_KEY) ||
      "";
    const user =
      readJson(localStorage.getItem(USER_KEY)) ||
      readJson(sessionStorage.getItem(USER_KEY)) ||
      null;
    return { token, user };
  };
  const readRemember = () =>
    (localStorage.getItem(REMEMBER_KEY) ||
      sessionStorage.getItem(REMEMBER_KEY) ||
      "0") === "1";

  const writeUserToStorage = (userObj) => {
    const remember = readRemember();
    const str = JSON.stringify(userObj || {});
    if (remember) localStorage.setItem(USER_KEY, str);
    else sessionStorage.setItem(USER_KEY, str);
    // 양쪽에 흔적 있을 수 있으니 동기화 차원에서 한번 더
    localStorage.setItem(USER_KEY, str);
    sessionStorage.setItem(USER_KEY, str);
    window.dispatchEvent(new Event("auth:updated"));
  };

  const deriveNickname = (u) =>
    u?.nickname || u?.NICKNAME || u?.name || u?.NAME || "사용자";
  const deriveIsAdmin = (u) => {
    const v =
      u?.is_admin ?? u?.IS_ADMIN ?? u?.admin ?? u?.ADMIN ?? u?.role ?? u?.ROLE;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string")
      return (
        v === "1" ||
        v.toLowerCase() === "true" ||
        v.toLowerCase() === "admin"
      );
    return false;
  };

  // --- 상태 ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [nickname, setNickname] = useState(userNickname);
  const [isAdminBool, setIsAdminBool] = useState(!!isAdmin);
  const [profileOpen, setProfileOpen] = useState(false);

  // 토큰/닉/권한/원본 user 스냅샷
  const snapRef = useRef({
    token: "",
    nick: nickname,
    admin: isAdminBool,
    user: null,
  });

  const applyAuthSnapshot = () => {
    const { token, user } = readAuth();
    const logged = !!token && !!user;
    const nick = deriveNickname(user) || "사용자";
    const admin = deriveIsAdmin(user);

    if (
      snapRef.current.token === token &&
      snapRef.current.nick === nick &&
      snapRef.current.admin === admin
    ) {
      // user 객체는 갱신될 수 있어 보관
      snapRef.current.user = user || null;
      return;
    }

    snapRef.current = { token, nick, admin, user: user || null };
    setIsLoggedIn(logged);
    setNickname(nick);
    setIsAdminBool(admin);
  };

  useEffect(() => {
    applyAuthSnapshot();
    const onStorage = (e) => {
      if ([TOKEN_KEY, USER_KEY, REMEMBER_KEY].includes(e.key)) applyAuthSnapshot();
    };
    const onFocus = () => applyAuthSnapshot();

    window.addEventListener("storage", onStorage);
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener("auth:updated", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("auth:updated", onFocus);
    };
  }, []);

  const handleLogoutClick = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(USER_KEY);
      localStorage.setItem(REMEMBER_KEY, "0");
    } finally {
      setIsLoggedIn(false);
      setNickname("사용자");
      setIsAdminBool(false);
      alert("로그아웃 되었습니다.");
      setTimeout(() => navigate("/member/login", { replace: true }), 100);
    }
  };

  const navBtnBase =
    "grid grid-cols-[28px_1fr] items-center gap-2 w-full text-left rounded-xl border border-transparent px-3 py-2 text-[14px] font-medium cursor-pointer transition-colors";
  const navBtnActive =
    "bg-[rgba(110,168,254,0.15)] border-[rgba(110,168,254,0.4)] text-gray-900";
  const navBtnHover = "hover:bg-gray-100 hover:text-gray-900 text-gray-700";

  return (
    <aside
      aria-label="사이드바"
      className={`flex flex-col bg-white text-gray-900 border-r border-gray-200
        h-screen sticky top-0 overflow-hidden
        transition-[width,padding] duration-200
        ${collapsed ? "w-[72px] px-4 py-4" : "w-[240px] px-4 py-4"}`}
    >
      {/* 상단: 로고 / 접기 */}
      <div
        className={`flex items-center justify-between mb-4 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <>
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => navigate("/")}
              title="홈으로"
            >
              <img
                src="/image/main로고.png"
                alt="SumFlow"
                className="object-contain w-[150px] h-[80px]"
              />
            </button>

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

      {/* 메뉴 */}
      <nav className="grid gap-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${navBtnBase} ${isActive ? navBtnActive : navBtnHover}`
          }
          title="홈"
        >
          <Home size={20} />
          {!collapsed && <span>홈</span>}
        </NavLink>

        <NavLink
          to="/files"
          className={({ isActive }) =>
            `${navBtnBase} ${isActive ? navBtnActive : navBtnHover}`
          }
          title="업로드 파일"
        >
          <Files size={20} />
          {!collapsed && <span>업로드 파일</span>}
        </NavLink>

        <NavLink
          to="/search"
          className={({ isActive }) =>
            `${navBtnBase} ${isActive ? navBtnActive : navBtnHover}`
          }
          title="검색"
        >
          <SearchIcon size={20} />
          {!collapsed && <span>검색</span>}
        </NavLink>

        {isAdminBool && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `${navBtnBase} ${isActive ? navBtnActive : navBtnHover}`
            }
            title="관리자 페이지"
          >
            <Settings size={20} />
            {!collapsed && <span>관리자 페이지</span>}
          </NavLink>
        )}
      </nav>

      {/* 하단 로그인 / 로그아웃 */}
      <div className="mt-auto pt-4">
        {!isLoggedIn ? (
          <button
            onClick={() => navigate("/member/login")}
            title="로그인"
            className="w-full flex items-center justify-center gap-2 text-white font-semibold text-[14px] rounded-lg px-3 py-2 
                      bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 
                      transition duration-150 ease-out 
                      active:scale-[0.98] active:brightness-95 active:shadow-sm 
                      focus:outline-none focus:ring-2 focus:ring-indigo-200 select-none
                      cursor-pointer"
          >
            <LogIn size={18} />
            {!collapsed && <span>로그인</span>}
          </button>
        ) : (
          <>
            {collapsed ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setProfileOpen(true); }}
                  aria-label="프로필 보기/수정"
                  className="inline-flex flex-none items-center justify-center
                            w-9 h-9 min-w-9 min-h-9 max-w-9 max-h-9 aspect-square
                            rounded-lg bg-gray-200 text-gray-800 text-sm font-bold
                            leading-none whitespace-nowrap overflow-hidden
                            hover:ring-2 hover:ring-indigo-200
                            transition duration-150 ease-out
                            active:scale-95 active:shadow-sm
                            focus:outline-none focus:ring-2 focus:ring-indigo-200
                            cursor-pointer"
                >
                  {(nickname?.slice(0, 1) || "유")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-[13px] text-gray-900 shadow-sm">
                <div className="flex flex-row items-center gap-2 mb-2 flex-nowrap">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setProfileOpen(true); }}
                    title="프로필 보기/수정"
                    className="inline-flex flex-none items-center justify-center
                              w-9 h-9 min-w-9 min-h-9 max-w-9 max-h-9 aspect-square
                              rounded-lg bg-gray-200 text-gray-800 text-sm font-bold
                              leading-none whitespace-nowrap overflow-hidden
                              hover:ring-2 hover:ring-indigo-200
                              transition duration-150 ease-out
                              active:scale-95 active:shadow-sm
                              focus:outline-none focus:ring-2 focus:ring-indigo-200
                              cursor-pointer"
                  >
                    {(nickname?.slice(0, 2) || "유저")}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setProfileOpen(true); }}
                    title="프로필 보기/수정"
                    className="font-semibold truncate text-[13px] text-gray-900 
                              hover:text-indigo-600 underline-offset-2 hover:underline
                              transition duration-150 ease-out 
                              active:scale-[0.99]
                              focus:outline-none focus:ring-2 focus:ring-indigo-200
                              cursor-pointer"
                  >
                    {nickname}
                  </button>
                </div>

                <button
                  onClick={handleLogoutClick}
                  className="px-3 py-2 rounded-lg text-white text-sm font-semibold 
                            bg-gradient-to-r from-[#FF54A1] to-[#B862FF] hover:opacity-90 
                            flex items-center justify-center gap-1
                            transition duration-150 ease-out 
                            active:scale-[0.98] active:brightness-95 active:shadow-sm
                            focus:outline-none focus:ring-2 focus:ring-indigo-200 select-none
                            cursor-pointer"
                >
                  <LogOut size={15} />
                  로그아웃
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 프로필 편집 모달 */}
      <ProfileEditModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={{
          nickname:
            snapRef.current.user?.nickname ??
            snapRef.current.user?.NICKNAME ??
            nickname ??
            "",
          phone:
            snapRef.current.user?.phone ??
            snapRef.current.user?.PHONE_NUMBER ??
            "",
          email:
            snapRef.current.user?.email ??
            snapRef.current.user?.EMAIL ??
            "",
        }}
        onSave={(updated) => {
          // 저장 성공 후 user 병합
          const cur =
            readJson(localStorage.getItem(USER_KEY)) ||
            readJson(sessionStorage.getItem(USER_KEY)) ||
            {};

          const merged = {
            ...cur,
            nickname: updated.nickname ?? cur.nickname ?? cur.NICKNAME,
            NICKNAME: updated.nickname ?? cur.NICKNAME ?? cur.nickname,
            phone: updated.phone ?? cur.phone ?? cur.PHONE_NUMBER,
            PHONE_NUMBER: updated.phone ?? cur.PHONE_NUMBER ?? cur.phone,
            email: updated.email ?? cur.email ?? cur.EMAIL,
            EMAIL: updated.email ?? cur.EMAIL ?? cur.email,
          };

          writeUserToStorage(merged);

          setNickname(merged.nickname || merged.NICKNAME || "사용자");
          snapRef.current.user = merged;
        }}
      />
    </aside>
  );
}