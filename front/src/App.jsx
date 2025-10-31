import React, { createContext, useContext, useEffect, useState } from "react";
import { HashRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import AdminPage from "./pages/AdminPage";
import MyPage from "./pages/MyPage";
import { getMyProfile } from "./utils/mypageApi"; 

// ------------------------------
// Auth Bootstrap (초기 인증 부트스트랩)
// ------------------------------
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false); 

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          if (!cancelled) setUser(null);
        } else {
          // 서버에 프로필 확인(유효 토큰인지)
          const me = await getMyProfile().catch(() => null);
          if (!cancelled) setUser(me ?? null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthCtx.Provider value={{ user, setUser, ready }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ------------------------------
// 보호 라우트: ready 전엔 대기, 이후에만 판단
// ------------------------------
function ProtectedRoute() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="w-full h-[40vh] flex items-center justify-center text-sm text-gray-600">
        로딩 중...
      </div>
    );
  }

  if (!user) {
    // 로그인 안 된 경우에만 리다이렉트
    return <Navigate to="/member/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* 로그인 & 회원가입 */}
          <Route path="/member/login" element={<LoginPage />} />
          <Route path="/member/signup" element={<SignupPage />} />

          {/* 보호 구역 래퍼 */}
          <Route element={<ProtectedRoute />}>
            {/* 메인 업로드 페이지 (로그인 필요) */}
            <Route path="/" element={<UploadPage />} />

            <Route path="/mypage" element={<MyPage />} />

            {/* 관리자 페이지 (로그인 필요) */}
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          {/* 예외 라우트 → 홈으로 */}
          <Route path="*" element={<div style={{padding: 24}}>404 - 페이지가 없습니다</div>} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}