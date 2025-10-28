from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from ..models.user_model import AppUser
from ..models.document_model import Document
from ..models.visitlog_model import VisitLog
from ..schemas.admin_schema import AdminStatsSummary, DailyUploadStat, DailyVisitStat

def get_admin_stats_summary(db: Session) -> AdminStatsSummary:
    now = datetime.now()
    since_7d = now - timedelta(days=6)   # 오늘 포함 최근 7일
    since_30d = now - timedelta(days=30) # 최근 30일

    # -------------------------
    # 총 회원수
    # -------------------------
    total_users = db.query(func.count(AppUser.id)).scalar() or 0

    # -------------------------
    # 최근 30일 신규 가입
    # -------------------------
    new_users_30d = (
        db.query(func.count(AppUser.id))
        .filter(AppUser.created_at >= since_30d)
        .filter(AppUser.status == "ACTIVE")  # 가입한 상태가 ACTIVE
        .scalar()
        or 0
    )

    # -------------------------
    # 최근 30일 탈퇴
    # -------------------------
    withdraw_30d = (
        db.query(func.count(AppUser.id))
        .filter(AppUser.updated_at >= since_30d)
        .filter(AppUser.status == "WITHDRAWN")
        .scalar()
        or 0
    )

    # -------------------------
    # 최근 7일 업로드 수 (문서 등록 수)
    # group by day (MM/DD)
    # -------------------------
    upload_rows = (
        db.query(
            func.to_char(Document.created_at, "MM/DD").label("day"),
            func.count(Document.id).label("uploads"),
        )
        .filter(Document.created_at >= since_7d)
        .group_by(func.to_char(Document.created_at, "MM/DD"))
        .order_by(func.min(Document.created_at))
        .all()
    )
    # upload_rows = [("10/22", 54), ...]
    day_to_uploads = {row.day: row.uploads for row in upload_rows}

    # -------------------------
    # 최근 7일 방문수 (visit log)
    # -------------------------
    visit_rows = (
        db.query(
            func.to_char(VisitLog.created_at, "MM/DD").label("day"),
            func.count(VisitLog.id).label("visits"),
        )
        .filter(VisitLog.created_at >= since_7d)
        .group_by(func.to_char(VisitLog.created_at, "MM/DD"))
        .order_by(func.min(VisitLog.created_at))
        .all()
    )
    # visit_rows = [("10/22", 190), ...]
    day_to_visits = {row.day: row.visits for row in visit_rows}

    # -------------------------
    # 7일치 라벨을 무조건 만들어서 비어 있는 날도 0으로 채워주자
    # ex: ["10/22","10/23",...,"10/28"]
    # -------------------------
    days_7 = []
    for i in range(7):
        d = since_7d + timedelta(days=i)
        days_7.append(d.strftime("%m/%d"))

    daily_uploads7d = [
        DailyUploadStat(day=day, uploads=int(day_to_uploads.get(day, 0)))
        for day in days_7
    ]
    daily_visits7d = [
        DailyVisitStat(day=day, visits=int(day_to_visits.get(day, 0)))
        for day in days_7
    ]

    return AdminStatsSummary(
        totalUsers=int(total_users),
        newUsers30d=int(new_users_30d),
        withdraw30d=int(withdraw_30d),
        dailyUploads7d=daily_uploads7d,
        dailyVisits7d=daily_visits7d,
    )