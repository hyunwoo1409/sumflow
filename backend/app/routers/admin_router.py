from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import get_current_admin
from ..schemas.admin_schema import AdminStatsSummary
from ..services.admin_service import get_admin_stats_summary

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
)

@router.get("/stats/summary", response_model=AdminStatsSummary)
def stats_summary(
    db: Session = Depends(get_db),
    admin_user=Depends(get_current_admin),  # 인증 + 관리자 체크
):
    return get_admin_stats_summary(db)