const API_BASE =
  import.meta.env?.VITE_API_BASE || "http://127.0.0.1:4000";

/**
 * 공통 요청 헬퍼
 * @param {string} path - "/admin/stats/summary" 이런 식의 경로 또는 전체 URL
 * @param {object} options - fetch 옵션 (method, headers, body 등)
 */
export async function request(path, options = {}) {
  const isAbsolute = /^https?:\/\//i.test(path);
  const url = isAbsolute ? path : API_BASE + path;

  const headers = { ...(options.headers || {}) };

  // JWT 토큰 자동 부착
  const token = localStorage.getItem("token");
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  // body가 일반 객체면 JSON으로 자동 변환
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      body,
    });

    // 상태 코드 확인
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("❌ HTTP 오류 응답:", res.status, text);

      // 401이나 403이면 (토큰 만료/권한 없음) 자동으로 로그인 페이지로 보내고 싶으면 여기서 navigate 못하니까
      // front 컴포넌트 쪽에서 잡아서 처리하면 됨. 여기선 일단 throw만 한다.
      throw new Error(`HTTP ${res.status}: ${text || "요청 실패"}`);
    }

    // JSON 먼저 시도
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }

    // JSON 아니면 text
    return await res.text();
  } catch (err) {
    console.error("❌ 서버 요청 중 오류 발생:", err.message);
    alert(
      "서버 요청 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요."
    );
    throw err;
  }
}