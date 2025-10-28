from pydantic import BaseModel
from typing import List

class DailyUploadStat(BaseModel):
    day: str       # "10/24"
    uploads: int   # 63

class DailyVisitStat(BaseModel):
    day: str       # "10/24"
    visits: int    # 171

class AdminStatsSummary(BaseModel):
    totalUsers: int
    newUsers30d: int
    withdraw30d: int
    dailyUploads7d: List[DailyUploadStat]
    dailyVisits7d: List[DailyVisitStat]