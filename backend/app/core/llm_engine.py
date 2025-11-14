import os, time, textwrap, httpx, logging, re, json

log = logging.getLogger(__name__)

# ---------------------------
# ENV & Timeout Helpers
# ---------------------------

def _env_host() -> str:
    return os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")

def _env_model() -> str:
    return os.getenv("OLLAMA_MODEL", "gemma3-summarizer:latest")

def _env_timeout_sec() -> int:
    # 초 단위 환경변수 (기본 300)
    try:
        return int(os.getenv("OLLAMA_TIMEOUT", "420"))
    except Exception:
        return 420

def _httpx_timeout():
    """
    connect=30s, read/write는 OLLAMA_TIMEOUT(초).
    httpx.Timeout을 명시적으로 구성해서 '응답까지 12초' 같은 외부 타임박스 이슈를 구분하기 쉽도록 함.
    """
    t = _env_timeout_sec()
    return httpx.Timeout(timeout=None, connect=30, read=t, write=t, pool=None)

# ---------------------------
# Two-line format (강제 형식)
# ---------------------------

_TWO_LINE_GUIDE = """\
아래 문서를 바탕으로 정확히 두 줄만 출력하라. 마크다운/코드블록/설명/빈 줄 금지.

형식:
요약 : <200자에 가까운 분량(최소 180자 이상 권장), 3~6문장, 한 단락. '무엇을/왜/어떻게' 바뀌는지 구체적으로 기술. 불릿/헤더/결론문 금지.>
카테고리 : <주카테고리/부카테고리>

카테고리 규칙:
- 반드시 딱 2개만 선택해 '/'로 연결한다(슬래시는 정확히 1개).
- 여러 범주에 걸쳐도 '가장 주된 것 1개' + '보조 1개'만 고른다.
- 허용 예시: 행정/국회, 사법/법률, 교육/정책 등. 3개 이상 쓰지 말 것.

요약 작성 기준:
- 법안/정책/행정 문서는 '개정 이유', '핵심 변경점', '기대 효과'를 모두 담을 것.
- 기관명, 절차명, 수치 등 구체 명사를 포함.
- 감정/수사는 배제하고 사실 중심으로 요약.
"""

def _build_user_prompt_for_two_lines(text: str, strong: bool = False) -> str:
    rules = [_TWO_LINE_GUIDE]
    if strong:
        rules.append("- 이전 응답이 형식을 위반했거나 너무 짧았다. 이번에는 반드시 형식과 분량(≥180자)을 지켜라.")
    rules.append("\n아래는 문서 본문이다.\n")
    body = _clip_for_prompt(text)
    return "\n".join(rules) + "\n" + body

_TWO_LINES_RE = re.compile(
    r"^요약\s*:\s*(?P<summary>.+?)\r?\n카테고리\s*:\s*(?P<category>.+?)\s*$",
    re.DOTALL
)

def _parse_two_line_output(s: str) -> dict:
    if not s:
        return {}
    m = _TWO_LINES_RE.match(s.strip())
    if not m:
        return {}
    summary = (m.group("summary") or "").strip()
    category_name = (m.group("category") or "").strip()

    # 공백/슬래시 정리
    category_name = re.sub(r"\s*/\s*", "/", category_name)
    category_name = re.sub(r"\s+", " ", category_name)

    # ---- 여기부터 추가: 2단계로 강제 ----
    parts = [p for p in category_name.split("/") if p]
    if len(parts) >= 2:
        category_name = f"{parts[0]}/{parts[1]}"
    elif len(parts) == 1:
        # 부카테고리가 없으면 보조를 '일반'으로 보정(원하는 기본값으로 교체 가능)
        category_name = f"{parts[0]}/일반"
    else:
        category_name = "기타/일반"
    # -----------------------------------

    return {"summary": summary, "category_name": category_name}

# ---------------------------
# Validation
# ---------------------------

def _is_valid_summary(s: str) -> bool:
    """
    우선 두 줄 포맷을 검사하고, 요약 길이(>=180자 권장) & 에러 토큰을 체크한다.
    백업으로 기존(20자) 규칙도 허용하되, 가급적 두 줄 포맷을 통과해야 True를 반환.
    """
    if not s:
        return False

    # 두 줄 포맷 우선
    obj = _parse_two_line_output(s)
    if obj:
        summ = (obj.get("summary") or "").strip()
        if len(summ) < 180:  # 필요시 200으로 상향 가능
            return False
        bad = ["error", "failed", "exception", "traceback"]
        return not any(b in summ.lower() for b in bad)

    # 백업: 두 줄 포맷이 아니면 거의 실패로 보지만,
    # 완전 막히는 상황 방지를 위해 기존 기준도 남긴다(재시도 유도).
    t = s.strip()
    if len(t) < 180:
        return False
    bad = ["error", "failed", "exception", "traceback"]
    return not any(b in t.lower() for b in bad)

# ---------------------------
# Utilities
# ---------------------------

def _clip_for_prompt(src: str, width: int = 8000) -> str:
    """프롬프트에 넣기 전 안전하게 자르기"""
    return textwrap.shorten(src, width=width, placeholder=" ...")

def _clip_for_heavy_input(src: str) -> str:
    """입력이 과도하게 긴 경우 앞/뒤만 남겨 LLM에 전달"""
    if len(src) <= 200_000:
        return src
    return src[:120_000] + "\n...[중략]...\n" + src[-60_000:]

def _extract_chat_content(json_obj: dict) -> str:
    """
    Ollama /api/chat 표준:
      {"message":{"role":"assistant","content":"..."}}
    혹시 모를 호환 포맷(OpenAI choices 유사)도 보정.
    """
    msg = (json_obj.get("message") or {})
    content = (msg.get("content") or "").strip()
    if content:
        return content
    # 호환: choices[0].message.content
    choices = json_obj.get("choices")
    if isinstance(choices, list) and choices:
        m = (choices[0].get("message") or {})
        return (m.get("content") or "").strip()
    return ""

# ---------------------------
# Ollama Calls (chat / generate)
# ---------------------------

def _call_ollama_chat(text: str, *, strong: bool = False) -> str:
    """
    Ollama /api/chat 호출 (단발, 스트림 X).
    - 성공 시 content 문자열
    - 실패/예외 시 빈 문자열
    - 상세 로깅 + 12초 고정 패턴 의심 신호 기록
    """
    host = _env_host()
    model = _env_model()
    timeout = _httpx_timeout()

    system_msg = {
        "role": "system",
        "content": "너는 공공문서/정책/법안 요약·분류 도우미다. 반드시 지정된 두 줄 형식을 준수한다."
    }
    user_msg = {"role": "user", "content": _build_user_prompt_for_two_lines(text, strong=strong)}

    data = {
        "model": model,
        "messages":[system_msg, user_msg],
        "stream": False,
        "options": {
            "temperature": float(os.getenv("OLLAMA_TEMPERATURE", "0.2")),
            "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "8192")),
        },
    }

    log.info("[ollama/chat] host=%s model=%s timeout(read)=%ss connect=30s",
             host, model, timeout.read)

    t0 = time.monotonic()
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(f"{host}/api/chat", json=data, headers={"Content-Type":"application/json"})
        elapsed = time.monotonic() - t0

        suspected = "timeboxed_~12s" if 9.0 <= elapsed <= 13.0 else None

        content = ""
        try:
            js = r.json()
            content = _extract_chat_content(js)
        except Exception as jex:
            # JSON 파싱 실패 시 text 그대로
            log.warning("[ollama/chat] JSON parse failed: %s", jex)
            content = (r.text or "").strip()

        log.info(
            "[ollama/chat] status=%s elapsed=%.3fs len=%s suspected=%s head=%r tail=%r",
            getattr(r, "status_code", "?"),
            elapsed,
            len(content) if content else 0,
            suspected,
            content[:160] if content else "",
            content[-160:] if content else "",
        )
        r.raise_for_status()  # HTTP 에러는 여기서 예외 발생
        return content or ""

    except httpx.TimeoutException as tex:
        elapsed = time.monotonic() - t0
        log.error("[ollama/chat] timeout after %.3fs: %s", elapsed, tex)
        return ""
    except httpx.HTTPStatusError as hse:
        elapsed = time.monotonic() - t0
        log.error("[ollama/chat] http status error after %.3fs: %s", elapsed, hse)
        return ""
    except httpx.RequestError as rex:
        elapsed = time.monotonic() - t0
        log.error("[ollama/chat] request error after %.3fs: %s", elapsed, rex)
        return ""

def _call_ollama_generate(text: str, *, strong: bool = False) -> str:
    """
    Ollama /api/generate 호출 (백업 경로).
    - 성공 시 response 문자열
    - 실패/예외 시 빈 문자열
    - 상세 로깅 + 12초 고정 패턴 의심 신호 기록
    """
    host = _env_host()
    model = _env_model()
    timeout = _httpx_timeout()

    system_plus_user = (
        "너는 공공문서/정책/법안 요약·분류 도우미다. 반드시 지정된 두 줄 형식을 준수한다.\n\n" +
        _build_user_prompt_for_two_lines(text, strong=strong)
    )
    data = {
        "model": model,
        "prompt": system_plus_user,
        "stream": False,
        "options": {
            "temperature": float(os.getenv("OLLAMA_TEMPERATURE", "0.2")),
            "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "8192")),
        },
    }

    log.info("[ollama/generate] host=%s model=%s timeout(read)=%ss connect=30s",
             host, model, timeout.read)

    t0 = time.monotonic()
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(f"{host}/api/generate", json=data, headers={"Content-Type":"application/json"})
        elapsed = time.monotonic() - t0

        suspected = "timeboxed_~12s" if 9.0 <= elapsed <= 13.0 else None

        content = ""
        try:
            js = r.json()
            content = (js.get("response","") or "").strip()
        except Exception as jex:
            log.warning("[ollama/generate] JSON parse failed: %s", jex)
            content = (r.text or "").strip()

        log.info(
            "[ollama/generate] status=%s elapsed=%.3fs len=%s suspected=%s head=%r tail=%r",
            getattr(r, "status_code", "?"),
            elapsed,
            len(content) if content else 0,
            suspected,
            content[:160] if content else "",
            content[-160:] if content else "",
        )
        r.raise_for_status()
        return content or ""

    except httpx.TimeoutException as tex:
        elapsed = time.monotonic() - t0
        log.error("[ollama/generate] timeout after %.3fs: %s", elapsed, tex)
        return ""
    except httpx.HTTPStatusError as hse:
        elapsed = time.monotonic() - t0
        log.error("[ollama/generate] http status error after %.3fs: %s", elapsed, hse)
        return ""
    except httpx.RequestError as rex:
        elapsed = time.monotonic() - t0
        log.error("[ollama/generate] request error after %.3fs: %s", elapsed, rex)
        return ""

# ---------------------------
# Summarize (public)
# ---------------------------

def summarize_with_ollama(text: str, retries: int = 2):
    """
    반환: (summary: str, ok: bool, meta: dict)
      meta 예시:
        {
          "perf": [{"name":"llm","ms": 12034}],
          "llm_meta": {"attempts": 2, "last_reason": "retry_too_short_or_error_token", "elapsed_sum": 12.1},
          "llm_data": {"summary":"...", "category_name":"주/부"},
          "error": "...(있을 경우)"
        }
    - 1차: /chat
    - 유효성 실패 시: /generate
    - 여전히 실패 시: 강한 지시로 재시도
    """
    t0 = time.monotonic()
    last_err = None
    attempts = 0
    elapsed_sum = 0.0
    last_reason = None

    # 입력 과다 시 앞/뒤만 남기기
    text = _clip_for_heavy_input(text)

    def _try_chat_then_generate(src: str, *, strong: bool) -> str:
        """chat 먼저, 실패하면 generate 백업 경로"""
        out = _call_ollama_chat(src, strong=strong)
        if not _is_valid_summary(out):
            out = _call_ollama_generate(src, strong=strong)
        return out or ""

    # 1차 시도 (기본 지시)
    t1 = time.monotonic()
    summary = _try_chat_then_generate(text, strong=False)
    elapsed_sum += (time.monotonic() - t1)
    attempts += 1

    if _is_valid_summary(summary):
        ms = int((time.monotonic() - t0) * 1000)
        return _finalize_ok(summary, attempts, elapsed_sum, ms)

    last_reason = "too_short_or_bad_format" if summary else "empty_or_transport_error"

    # 재시도 루프 (기본 2회 → 총 3번 기회)
    for i in range(retries):
        try:
            t2 = time.monotonic()
            summary2 = _try_chat_then_generate(text, strong=True)
            elapsed_sum += (time.monotonic() - t2)
            attempts += 1

            if _is_valid_summary(summary2):
                ms = int((time.monotonic() - t0) * 1000)
                return _finalize_ok(summary2, attempts, elapsed_sum, ms)

            last_reason = "retry_bad_format_or_short" if summary2 else "retry_empty_or_transport_error"
            summary = summary2  # 마지막 응답 유지
        except Exception as e:
            last_err = e
            attempts += 1
        # simple backoff
        time.sleep(2 * (i + 1))

    ms_total = int((time.monotonic() - t0) * 1000)
    meta = {
        "perf":[{"name":"llm", "ms": ms_total}],
        "llm_meta": {"attempts": attempts, "last_reason": last_reason, "elapsed_sum": round(elapsed_sum, 3)}
    }
    if last_err:
        meta["error"] = str(last_err)

    return "[LLM 오류: 요약 생성 실패]", False, meta

# ---------------------------
# Finalize helper
# ---------------------------

def _finalize_ok(output: str, attempts: int, elapsed_sum: float, ms: int):
    obj = _parse_two_line_output(output)

    if not obj:
        summary_text = output.strip()
        summary_text = re.sub(r"<\|file_separator\|>", "", summary_text).strip()
        meta = {
            "perf":[{"name":"llm", "ms": ms}],
            "llm_meta": {"attempts": attempts, "last_reason": None, "elapsed_sum": round(elapsed_sum, 3)},
            "llm_raw": output.strip(),   
        }
        return summary_text, True, meta

    summary_text = (obj.get("summary") or "").strip()
    summary_text = re.sub(r"<\|file_separator\|>", "", summary_text).strip()
    category_name = (obj.get("category_name") or "").strip()

    meta = {
        "perf":[{"name":"llm", "ms": ms}],
        "llm_meta": {"attempts": attempts, "last_reason": None, "elapsed_sum": round(elapsed_sum, 3)},
        "llm_data": {
            "summary": summary_text,
            "category_name": category_name
        },
        "llm_raw": output.strip(),      
    }
    return summary_text, True, meta