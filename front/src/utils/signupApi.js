// 회원가입, 중복확인, 이메일 인증 관련 API 모음

const BASE = import.meta.env.VITE_API_URL;

/**
 * 아이디 중복 체크
 * 백엔드: GET /api/v1/user/check-id?login_id=xxx
 * 응답: "1" (중복) / "0" (사용 가능)
 */
export async function checkDuplicateId(loginId) {
  const res = await fetch(
    `${BASE}/api/v1/user/check-id?login_id=${encodeURIComponent(loginId)}`,
    {
      method: "GET",
    }
  );

  if (!res.ok) {
    throw new Error("아이디 중복 확인 실패");
  }

  return res.text(); // "0" or "1"
}

/**
 * 이메일 중복 체크
 * 백엔드: GET /api/v1/user/check-email?email=xxx@yyy.com
 * 응답: "1" (중복) / "0" (사용 가능)
 */
export async function checkDuplicateEmail(email) {
  const res = await fetch(
    `${BASE}/api/v1/user/check-email?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
    }
  );

  if (!res.ok) {
    throw new Error("이메일 중복 확인 실패");
  }

  return res.text(); // "0" or "1"
}

/**
 * 이메일 인증번호 전송
 * 백엔드: POST /api/v1/user/email/send-code
 * body: { email, purpose: "REGISTER" }
 * 응답: { success: true }
 */
export async function sendEmailCode(email) {
  const res = await fetch(`${BASE}/api/v1/user/email/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      purpose: "REGISTER",
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || "인증번호 전송 실패");
  }

  return data;
}

/**
 * 이메일 인증번호 확인
 * 백엔드: POST /api/v1/user/email/verify-code
 * body: { email, code, purpose: "REGISTER" }
 * 응답: { success: true }
 */
export async function verifyEmailCode({ inputKey, email }) {
  const res = await fetch(`${BASE}/api/v1/user/email/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      code: inputKey,
      purpose: "REGISTER",
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || "인증번호 확인 실패");
  }

  return data; // { success: true }
}

/**
 * 회원가입 요청
 * 백엔드: POST /api/v1/user/signup
 * body: {
 *   login_id, password, name, email,
 *   phone, nickname,
 *   postal_code, addr1, addr2,
 *   birth,
 *   is_admin,
 *   captcha_id, captcha_text
 * }
 * 응답: { success: true, ... }
 */
export async function signup(payload) {
  const res = await fetch(`${BASE}/api/v1/user/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || "회원가입 실패");
  }

  return data;
}