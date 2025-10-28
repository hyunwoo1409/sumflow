import React, { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

import { getAdminStatsSummary } from "../utils/api"; // 백엔드 통계 요약 API

export default function AdminDashboardMain() {
  // 로딩 / 에러
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  // 상단 카드용 지표
  const [totalUsers, setTotalUsers] = useState(0);
  const [newUsers30d, setNewUsers30d] = useState(0);
  const [withdraw30d, setWithdraw30d] = useState(0);

  // 그래프 데이터
  const [uploadStats, setUploadStats] = useState([]); // [{ day:"10/22", uploads:54 }, ...]
  const [visitStats, setVisitStats] = useState([]);   // [{ day:"10/22", visits:190 }, ...]

  // 초기 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErrMsg("");

        // expected response:
        // {
        //   totalUsers: number,
        //   newUsers30d: number,
        //   withdraw30d: number,
        //   dailyUploads7d: [{ day:"10/22", uploads:54 }, ...],
        //   dailyVisits7d: [{ day:"10/22", visits:190 }, ...]
        // }
        const data = await getAdminStatsSummary();

        setTotalUsers(data.totalUsers ?? 0);
        setNewUsers30d(data.newUsers30d ?? 0);
        setWithdraw30d(data.withdraw30d ?? 0);
        setUploadStats(Array.isArray(data.dailyUploads7d) ? data.dailyUploads7d : []);
        setVisitStats(Array.isArray(data.dailyVisits7d) ? data.dailyVisits7d : []);
      } catch (e) {
        console.error(e);
        setErrMsg("통계 데이터를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 도넛 차트 데이터 계산
  const pieData = useMemo(() => {
    const baseUsers = Math.max(totalUsers - newUsers30d - withdraw30d, 0);
    return [
      { name: "기존 회원", value: baseUsers },
      { name: "신규 회원", value: newUsers30d },
      { name: "탈퇴 회원", value: withdraw30d },
    ];
  }, [totalUsers, newUsers30d, withdraw30d]);

  // 도넛 색상 팔레트
  const PIE_COLORS = ["#C8C8C8", "#FF54A1", "#2d2385ff"];

  // 로딩 상태
  if (loading) {
    return (
      <div className="text-[13px] text-gray-700 text-center py-10">
        대시보드 데이터를 불러오는 중입니다...
      </div>
    );
  }

  // 에러 상태
  if (errMsg) {
    return (
      <div className="text-center py-10">
        <div className="text-[14px] font-medium text-red-600">{errMsg}</div>
        <div className="text-[12px] text-gray-500 mt-2 leading-relaxed">
          ※ 관리자 권한이 없거나 서버와의 통신에 실패했을 수 있습니다.
        </div>
      </div>
    );
  }

  // 본문 (정상)
  return (
    <div className="text-[13px] text-gray-900">
      {/* 1행: 회원 요약(도넛) + 업로드 차트 */}
      <div className="flex flex-wrap gap-4">
        {/* 회원 통계 카드 */}
        <section className="w-full sm:w-[320px] flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-4">
          {/* 타이틀 */}
          <div className="text-[12px] mb-3 font-medium text-gray-800">
            총 회원수 / 신규 가입 / 탈퇴 (최근 30일)
          </div>

          {/* 숫자 영역 */}
          <div className="flex justify-between mb-4 text-[12px]">
            <div>
              <div className="text-gray-600">총 회원수</div>
              <div className="text-[20px] font-semibold text-gray-900 leading-tight">
                {totalUsers.toLocaleString()}
              </div>
            </div>

            <div className="text-right">
              <div className="text-gray-600">신규 가입</div>
              <div className="text-[16px] font-semibold text-pink-600 leading-tight">
                +{newUsers30d}
              </div>

              <div className="text-gray-600 mt-2">탈퇴</div>
              <div className="text-[13px] font-semibold text-gray-700 leading-tight">
                {withdraw30d}
              </div>
            </div>
          </div>

          {/* 도넛 차트 */}
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={3}
                >
                  {pieData.map((entry, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={PIE_COLORS[idx % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v /* value */) => [`${v}명`, ""]} // 커스텀 라벨
                />
                <Legend
                  verticalAlign="bottom"
                  height={30}
                  wrapperStyle={{ fontSize: "11px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* 업로드 수 차트 카드 */}
        <section className="flex-1 min-w-[280px] rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="font-medium text-gray-800">업로드 수</span>
            <span className="text-[11px] text-gray-700">최근 7일</span>
          </div>

          <div className="h-[280px] rounded-md border border-gray-300 bg-white p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={uploadStats}
                margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <defs>
                  <linearGradient id="colorUploads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF54A1" />
                    <stop offset="100%" stopColor="#B862FF" />
                  </linearGradient>
                </defs>
                <Bar
                  dataKey="uploads"
                  radius={[4, 4, 0, 0]}
                  fill="url(#colorUploads)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 2행: 방문(접속자 수) 라인차트 */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 mt-4">
        <div className="flex justify-between text-[12px] mb-2">
          <span className="font-medium text-gray-800">접속자 수</span>
          <span className="text-[11px] text-gray-700">최근 7일</span>
        </div>

        <div className="h-[220px] rounded-md border border-gray-300 bg-white p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visitStats}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="visits"
                stroke="#FF54A1"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 하단 안내 */}
      <p className="text-[11px] text-gray-500 mt-6 text-center leading-relaxed">
        ※ 이 대시보드는 관리자 전용입니다.
        <br />
        Oracle DB 기준으로 최근 7일 업로드 / 방문 수, 최근 30일 신규 가입 / 탈퇴
        현황을 요약해 보여줍니다.
      </p>
    </div>
  );
}