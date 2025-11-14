import re
from collections import defaultdict

TAXONOMY = {
    "법률": {"공정거래": ["하도급", "공정위"], "노동": ["노조", "임금"]},
    "행정": {"국회": ["개정안", "의안"], "지자체": ["조례", "시의회"]},
    "산업": {"IT/데이터": ["AI", "데이터", "플랫폼"]},
}

# --- 두 줄 포맷 파싱용: 요약/카테고리 모두 캡처 ---
# - 요약은 여러 줄 허용 (DOTALL + 비탐욕)
# - "요약 :" / "카테고리 :" 사이 공백/한글 콜론/윈도우 개행 모두 허용
# - 앞뒤에 코드펜스 ```가 붙는 경우도 대비 (사전 스트립)
_TWO_LINES_RE = re.compile(
    r"""
    ^\s*요약\s*[:：]\s*(?P<summary>.+?)      # 요약 본문 (비탐욕, 여러 줄)
    \r?\n+\s*카테고리\s*[:：]\s*(?P<category>[^\r\n]+)\s*$  # 카테고리 한 줄
    """,
    re.DOTALL | re.VERBOSE
)

# 코드펜스(```lang ... ```)로 감싼 응답을 안전하게 벗겨내기
_CODEFENCE_START_RE = re.compile(r"^\s*```[^\n]*\n", re.DOTALL)
_CODEFENCE_END_RE   = re.compile(r"\n```[\s]*$", re.DOTALL)

def _strip_codefence(s: str) -> str:
    if not s:
        return s
    s = _CODEFENCE_START_RE.sub("", s, count=1)
    s = _CODEFENCE_END_RE.sub("", s, count=1)
    return s.strip()

def normalize_to_two_levels(raw: str | None) -> str:
    """
    - 슬래시 주변 공백 정리
    - 최소 2레벨 강제 (단일 레벨이면 '/일반')
    - idempotent 보장
    """
    if not raw:
        return "기타/일반"
    s = re.sub(r"\s*/\s*", "/", str(raw).strip())
    s = re.sub(r"\s+", " ", s)
    parts = [p for p in s.split("/") if p]
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    elif len(parts) == 1:
        return f"{parts[0]}/일반"
    return "기타/일반"

def extract_llm_category(two_line_output: str) -> str | None:
    """
    LLM이 돌려준 '두 줄 형식'에서 카테고리만 뽑아 2레벨로 정규화.
    - 코드펜스 제거
    - 메인 정규식 매치 실패 시 느슨한 백업 패턴으로 재시도
    """
    if not two_line_output:
        return None

    s = _strip_codefence(two_line_output)

    m = _TWO_LINES_RE.search(s)
    if m:
        raw_cat = (m.group("category") or "").strip()
        return normalize_to_two_levels(raw_cat) if raw_cat else None

    # 백업: 본문 어디든 "카테고리 :" 라인이 있으면 그 줄만 뽑기
    m2 = re.search(r"카테고리\s*[:：]\s*(?P<cat>[^\r\n]+)", s)
    if m2:
        raw_cat = (m2.group("cat") or "").strip()
        return normalize_to_two_levels(raw_cat) if raw_cat else None

    return None

def parse_category_by_keywords(text: str) -> str:
    """
    키워드 백업 분류.
    """
    text_low = (text or "").lower()
    score = defaultdict(int)
    for big, subs in TAXONOMY.items():
        for small, kws in subs.items():
            for kw in kws:
                if kw.lower() in text_low:
                    score[(big, small)] += 1
    if not score:
        return "기타/일반"
    (big, small), _ = max(score.items(), key=lambda x: x[1])
    return normalize_to_two_levels(f"{big}/{small}")