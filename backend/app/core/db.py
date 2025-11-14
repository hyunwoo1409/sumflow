# backend/user/db.py
import os
from urllib.parse import quote_plus
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv, find_dotenv
from pathlib import Path

ENV_PATH = find_dotenv(filename=".env") or str(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(ENV_PATH, override=True)

def _mask(s: str) -> str:
    return s[:2] + "****" if s else ""

# DB_USER = os.getenv("DB_USER", "mainuser")
# DB_PASS = os.getenv("DB_PASS", "main1234")
# DB_HOST = os.getenv("DB_HOST", "192.168.0.42")
# DB_PORT = os.getenv("DB_PORT", "3306")
# DB_NAME = os.getenv("DB_NAME", "sumflow")


DB_PASS_RAW = os.getenv("DB_PASS", "MySql@123") 
DB_PASS = quote_plus(DB_PASS_RAW)
DB_USER = os.getenv("DB_USER", "root")
# DB_PASS_RAW = os.getenv("DB_PASS", "root1234")
# DB_PASS = quote_plus(DB_PASS_RAW)  
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")  
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "sumflow")

# 드라이버 선택: mysql-connector or pymysql 둘 다 테스트 가능
DRIVER = os.getenv("DB_DRIVER", "mysqlconnector")  # "mysqlconnector" 또는 "pymysql"

DATABASE_URL = f"mysql+{DRIVER}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=3600,
    future=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

try:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
        print(f"[DB OK] {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME} driver={DRIVER}")
except Exception as e:
    print(f"[DB FAIL] {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME} driver={DRIVER} err={e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
