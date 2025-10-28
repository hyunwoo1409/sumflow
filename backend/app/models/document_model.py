from sqlalchemy import (
    Column,
    BigInteger,
    Integer,
    String,
    Text,
    Enum,
    ForeignKey,
    BigInteger as BigIntCol,
    func,
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.mysql import DATETIME
from ..core.db import Base


class Document(Base):
    """
    DOCUMENT 테이블 매핑
    """

    __tablename__ = "DOCUMENT"

    DOCUMENT_ID = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
        comment="문서 고유 ID",
    )

    OWNER_USER_ID = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("APP_USER.USER_ID", ondelete="RESTRICT"),
        nullable=False,
        comment="문서 소유자 ID",
    )

    ORIGINAL_FILENAME = Column(String(255), nullable=False, comment="원본 파일명")
    CHANGED_FILENAME = Column(String(255), nullable=True, comment="변경된 파일명")

    CATEGORY_NAME = Column(String(100), nullable=True, comment="문서 카테고리")
    TITLE = Column(String(500), nullable=True, comment="문서 제목")
    LLM_SUMMARY_TEXT = Column(Text, nullable=True, comment="요약 텍스트 (LLM 결과)")

    OCR_JSON_DIR_RELPATH = Column(String(1024), nullable=True, comment="OCR JSON 경로")
    OCR_TEXT_DIR_RELPATH = Column(String(1024), nullable=True, comment="OCR 텍스트 경로")
    SUMMARY_DIR_RELPATH = Column(String(1024), nullable=True, comment="요약 결과 경로")
    METADATA_JSON_RELPATH = Column(String(1024), nullable=True, comment="메타데이터 JSON 경로")
    MERGED_PDF_RELPATH = Column(String(1024), nullable=True, comment="병합 PDF 경로")
    RESULT_FOLDER_ID = Column(String(100), nullable=True, comment="결과 폴더 ID")

    FILE_SIZE_BYTES = Column(BigIntCol, nullable=False, comment="파일 크기 (bytes)")

    PROC_STATUS = Column(
        Enum(
            "UPLOADED",
            "OCR_DONE",
            "SUMMARY_DONE",
            "FAILED",
            "DELETED",
            name="proc_status_enum",
        ),
        nullable=False,
        server_default="UPLOADED",
        comment="문서 처리 상태",
    )

    LAST_ERROR_MSG = Column(String(1000), nullable=True, comment="마지막 오류 메시지")

    CREATED_AT = Column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=func.current_timestamp(),
        comment="생성 일시",
    )
    UPDATED_AT = Column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        comment="수정 일시",
    )
    DELETED_AT = Column(
        DATETIME(fsp=6),
        nullable=True,
        comment="삭제 일시",
    )

    # --------- 관계 ---------
    user = relationship(
        "AppUser",
        back_populates="documents",
        foreign_keys=[OWNER_USER_ID],
        passive_deletes=True,
    )

    def __repr__(self):
        return f"<Document DOCUMENT_ID={self.DOCUMENT_ID} OWNER={self.OWNER_USER_ID} STATUS={self.PROC_STATUS}>"