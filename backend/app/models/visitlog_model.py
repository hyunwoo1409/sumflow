from sqlalchemy import (
    Column,
    BigInteger,
    Integer,
    String,
    ForeignKey,
    func,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.mysql import DATETIME
from ..core.db import Base


class VisitLog(Base):
    """
    VISIT_LOG 테이블 매핑
    """

    __tablename__ = "VISIT_LOG"

    VISIT_ID = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
        comment="방문 로그 ID",
    )

    USER_ID = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("APP_USER.USER_ID", ondelete="SET NULL"),
        nullable=True,
        comment="사용자 ID (NULL 가능)",
    )

    SOURCE_IP = Column(String(64), nullable=True, comment="접속 IP 주소")
    USER_AGENT = Column(String(400), nullable=True, comment="브라우저 정보")

    VISITED_AT = Column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=func.current_timestamp(),
        comment="방문 일시",
    )

    user = relationship(
        "AppUser",
        back_populates="visit_logs",
        foreign_keys=[USER_ID],
        passive_deletes=True,
    )

    def __repr__(self):
        return f"<VisitLog VISIT_ID={self.VISIT_ID} USER_ID={self.USER_ID} VISITED_AT={self.VISITED_AT}>"