import React, { useState, useMemo } from "react";

export default function AdminUserManage() {
  // 검색 상태
  const [searchType, setSearchType] = useState("nickname"); // 'nickname' | 'email'
  const [keyword, setKeyword] = useState("");
  const [searchTerm, setSearchTerm] = useState(""); // 실제로 적용된 검색어

  // 가입 상태 필터
  const [userFilter, setUserFilter] = useState("all"); // 'all' | 'active' | 'withdrawn'

  // 페이지네이션
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20; // 한 페이지 최대 20명 (왼10 + 오른10)

  // 나중에 실제로는 백엔드에서 받아올 목록
  const allUsers = [
    { id: 1, nickname: "김현우", email: "makim9@kh.or.kr", status: "가입" },
    { id: 2, nickname: "최나연", email: "nkoim@kh.or.kr", status: "탈퇴" },
    { id: 3, nickname: "황민지", email: "kingmin@kh.or.kr", status: "가입" },
    { id: 4, nickname: "박수현", email: "psuh@kh.or.kr", status: "가입" },
    { id: 5, nickname: "정호연", email: "jhy@kh.or.kr", status: "가입" },
    { id: 6, nickname: "이가영", email: "gy_lee@kh.or.kr", status: "탈퇴" },
    { id: 7, nickname: "오지민", email: "jm_oh@kh.or.kr", status: "가입" },
    { id: 8, nickname: "홍길동", email: "hong@kh.or.kr", status: "가입" },
    { id: 9, nickname: "송지훈", email: "song@kh.or.kr", status: "가입" },
    { id: 10, nickname: "류가온", email: "gaon@kh.or.kr", status: "가입" },
    { id: 11, nickname: "유세연", email: "seyeon@kh.or.kr", status: "가입" },
    { id: 12, nickname: "강주호", email: "juho@kh.or.kr", status: "가입" },
    { id: 13, nickname: "이다연", email: "dy_lee@kh.or.kr", status: "탈퇴" },
    { id: 14, nickname: "박지수", email: "jisoo@kh.or.kr", status: "가입" },
    { id: 15, nickname: "채다원", email: "dawon@kh.or.kr", status: "가입" },
    { id: 16, nickname: "전하람", email: "hr_j@kh.or.kr", status: "가입" },
    { id: 17, nickname: "이유리", email: "yuri@kh.or.kr", status: "가입" },
    { id: 18, nickname: "임지우", email: "jiwoo@kh.or.kr", status: "가입" },
    { id: 19, nickname: "최수현", email: "shchoi@kh.or.kr", status: "탈퇴" },
    { id: 20, nickname: "한나율", email: "nayul@kh.or.kr", status: "가입" },
    { id: 21, nickname: "한나율", email: "nayul@kh.or.kr", status: "가입" },
    { id: 22, nickname: "한나율", email: "nayul@kh.or.kr", status: "가입" },
    { id: 23, nickname: "한나율", email: "nayul@kh.or.kr", status: "가입" },
    { id: 24, nickname: "한나율", email: "nayul@kh.or.kr", status: "가입" },
  ];

  // 1) 가입 상태 필터 적용
  const filteredByStatus = useMemo(() => {
    return allUsers.filter((u) => {
      if (userFilter === "active") return u.status === "가입";
      if (userFilter === "withdrawn") return u.status === "탈퇴";
      return true; // all
    });
  }, [allUsers, userFilter]);

  // 2) 검색어 적용 (닉네임 / 이메일)
  const filtered = useMemo(() => {
    const kw = searchTerm.trim().toLowerCase();
    if (!kw) return filteredByStatus;

    return filteredByStatus.filter((u) => {
      if (searchType === "nickname") {
        return u.nickname.toLowerCase().includes(kw);
      }
      return u.email.toLowerCase().includes(kw);
    });
  }, [filteredByStatus, searchTerm, searchType]);

  // 페이지네이션 계산
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const startIdx = (page - 1) * PAGE_SIZE;
  const currentPageSlice = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const leftCol = currentPageSlice.slice(0, 10);
  const rightCol = currentPageSlice.slice(10, 20);

  // 검색 실행 (버튼/Enter)
  const handleSearch = () => {
    setSearchTerm(keyword);
    setPage(1);
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // 가입상태 필터 탭 클릭
  const handleStatusChange = (mode) => {
    setUserFilter(mode);
    setPage(1);
  };

  return (
    <div className="text-[13px] text-gray-900">
      {/* 검색 영역 */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
        <div className="text-[14px] font-semibold text-gray-800 mb-4">
          회원 관리
        </div>

        <div className="rounded-lg border border-gray-300 bg-white p-3 flex flex-col gap-3 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            {/* 검색 기준 */}
            <div className="flex flex-col min-w-[120px]">
              <label className="text-[12px] text-gray-600 mb-1">
                검색 기준
              </label>
              <select
                className="border border-gray-400 rounded px-2 py-1 text-[12px] outline-none bg-white"
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
              >
                <option value="nickname">닉네임</option>
                <option value="email">이메일</option>
              </select>
            </div>

            {/* 검색어 입력 */}
            <div className="flex-1 flex flex-col">
              <label className="text-[12px] text-gray-600 mb-1">
                검색어
              </label>
              <input
                className="border border-gray-400 rounded px-2 py-1 text-[12px] outline-none"
                placeholder={
                  searchType === "nickname"
                    ? "닉네임을 입력하세요"
                    : "이메일을 입력하세요"
                }
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* 검색 버튼 */}
            <div className="flex flex-col">
              <label className="text-[12px] text-gray-600 mb-1 opacity-0 select-none">
                검색
              </label>
              <button
                onClick={handleSearch}
                className="
                  inline-flex items-center justify-center
                  rounded-md border border-[#B862FF]
                  bg-gradient-to-r from-[#FF54A1] to-[#B862FF]
                  text-white text-[12px] font-semibold
                  px-3 py-2
                  hover:opacity-90
                  shadow-[0_4px_10px_rgba(184,98,255,0.3)]
                "
              >
                검색
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 현황 + 리스트 */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        {/* 상단: 필터/현황 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="text-[14px] font-semibold text-gray-800">
            회원 현황 / 필터
          </div>

          <div className="flex flex-wrap gap-2 text-[12px] font-medium">
            <button
              onClick={() => handleStatusChange("all")}
              className={`
                rounded-md border px-3 py-1.5 transition
                ${
                  userFilter === "all"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }
              `}
            >
              전체
            </button>

            <button
              onClick={() => handleStatusChange("active")}
              className={`
                rounded-md border px-3 py-1.5 transition
                ${
                  userFilter === "active"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }
              `}
            >
              가입
            </button>

            <button
              onClick={() => handleStatusChange("withdrawn")}
              className={`
                rounded-md border px-3 py-1.5 transition
                ${
                  userFilter === "withdrawn"
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }
              `}
            >
              탈퇴
            </button>
          </div>
        </div>

        {/* 요약 수치 카드들 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-[12px] text-gray-800">
          <div className="rounded-md border border-gray-300 bg-white p-3 flex flex-col shadow-sm">
            <div className="text-[12px] text-gray-600">총 회원 수</div>
            <div className="text-[20px] font-bold text-gray-900 leading-none">
              {allUsers.length}
            </div>
          </div>

          <div className="rounded-md border border-gray-300 bg-white p-3 flex flex-col shadow-sm">
            <div className="text-[12px] text-gray-600">현재 회원 수</div>
            <div className="text-[20px] font-bold text-gray-900 leading-none">
              {allUsers.filter((u) => u.status === "가입").length}
            </div>
          </div>

          <div className="rounded-md border border-gray-300 bg-white p-3 flex flex-col shadow-sm">
            <div className="text-[12px] text-gray-600">탈퇴 회원 수</div>
            <div className="text-[20px] font-bold text-gray-900 leading-none">
              {allUsers.filter((u) => u.status === "탈퇴").length}
            </div>
          </div>

          <div className="rounded-md border border-gray-300 bg-white p-3 flex flex-col shadow-sm">
            <div className="text-[12px] text-gray-600">신규 가입 수</div>
            <div className="text-[20px] font-bold text-gray-900 leading-none">
              3
            </div>
          </div>
        </div>

        {/* 회원 리스트 (좌/우 테이블) */}
        <div className="text-[12px] text-gray-800">
          <div className="font-medium mb-2 text-[13px] text-gray-900">
            회원 리스트 (최신등록순)
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 왼쪽 테이블 */}
            <div className="overflow-x-auto border border-gray-400 rounded-md bg-white shadow-sm">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[#efefef] border-b border-gray-400">
                  <tr>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      회원 번호
                    </th>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      닉네임
                    </th>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      이메일
                    </th>
                    <th className="px-2 py-1 whitespace-nowrap">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {leftCol.map((u) => (
                    <tr
                      key={`left-${u.id}`}
                      className="border-t border-gray-300 hover:bg-gray-50"
                    >
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.id}
                      </td>
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.nickname}
                      </td>
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.email}
                      </td>
                      <td
                        className={`px-2 py-1 font-semibold ${
                          u.status === "가입"
                            ? "text-green-700"
                            : "text-red-600"
                        }`}
                      >
                        {u.status}
                      </td>
                    </tr>
                  ))}

                  {leftCol.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center text-gray-500 py-6 text-[12px]"
                      >
                        결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 오른쪽 테이블 */}
            <div className="overflow-x-auto border border-gray-400 rounded-md bg-white shadow-sm">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[#efefef] border-b border-gray-400">
                  <tr>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      회원 번호
                    </th>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      닉네임
                    </th>
                    <th className="border-r border-gray-400 px-2 py-1 whitespace-nowrap">
                      이메일
                    </th>
                    <th className="px-2 py-1 whitespace-nowrap">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rightCol.map((u) => (
                    <tr
                      key={`right-${u.id}`}
                      className="border-t border-gray-300 hover:bg-gray-50"
                    >
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.id}
                      </td>
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.nickname}
                      </td>
                      <td className="border-r border-gray-300 px-2 py-1">
                        {u.email}
                      </td>
                      <td
                        className={`px-2 py-1 font-semibold ${
                          u.status === "가입"
                            ? "text-green-700"
                            : "text-red-600"
                        }`}
                      >
                        {u.status}
                      </td>
                    </tr>
                  ))}

                  {rightCol.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center text-gray-500 py-6 text-[12px]"
                      >
                        결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 페이지네이션 */}
          <div className="flex items-center justify-center gap-2 text-[12px] text-gray-700 mt-4">
            <button
              className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </button>

            <span className="text-[11px] text-gray-600">
              {page} / {pageCount}
            </span>

            <button
              className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              다음
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}