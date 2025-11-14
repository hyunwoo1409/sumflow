import os
import io
import hashlib
from dataclasses import dataclass
from typing import Optional, Literal, Dict

from .docx_extractor import extract_docx_to_text, render_docx_to_pdf_via_loffice
from .hwp_extractor import extract_hwp_to_text, render_hwp_to_pdf_via_loffice
from .loffice import has_soffice

IngestKind = Literal["pdf", "text"]

@dataclass
class IngestResult:
    kind: IngestKind                 # "pdf" -> use pdf_path; "text" -> use text_path
    src_ext: str                     # original extension without dot (pdf|docx|hwp)
    pdf_path: Optional[str] = None
    text_path: Optional[str] = None
    meta: Dict = None                # {"route": "...", "used": ["..."], "notes": "..."}

def _sha12(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()[:12]

def ingest_document(src_path: str, work_dir: str) -> IngestResult:
    """
    Normalize incoming file into either:
      - PDF   (kind="pdf": use existing OCR/pass-through pipeline), or
      - TEXT  (kind="text": skip OCR, go straight to LLM)
    Work products are written under work_dir.
    Behavior is controlled by env flags:
      ENABLE_LOFFICE=true|false  - allow soffice pdf rendering when possible
      ENABLE_HWP_TXT=true|false  - allow HWP text extraction via hwp5txt/pyhwp
    """
    os.makedirs(work_dir, exist_ok=True)
    _, ext = os.path.splitext(src_path)
    ext = (ext or "").lower().strip(".")  # ext without dot
    meta = {"used": [], "route": None}

    enable_loffice = os.environ.get("ENABLE_LOFFICE", "true").lower() == "true"
    enable_hwp_txt = os.environ.get("ENABLE_HWP_TXT", "true").lower() == "true"

    base = os.path.splitext(os.path.basename(src_path))[0]
    shs = _sha12(src_path)
    # deterministic output paths under work_dir
    out_pdf = os.path.join(work_dir, f"{base}.{shs}.pdf")
    out_txt = os.path.join(work_dir, f"{base}.{shs}.txt")

    # Case 1) Already PDF -> pass-through
    if ext == "pdf":
        meta["route"] = "pdf->pdf(pass-through)"
        return IngestResult(kind="pdf", src_ext="pdf", pdf_path=src_path, meta=meta)

    # Case 2) DOCX
    if ext == "docx":
        # Prefer direct text extraction as fast path
        try:
            extract_docx_to_text(src_path, out_txt)
            meta["used"].append("python-docx")
            meta["route"] = "docx->text"
            return IngestResult(kind="text", src_ext="docx", text_path=out_txt, meta=meta)
        except ImportError:
            # If python-docx missing and soffice is allowed, try render to PDF
            if enable_loffice and has_soffice():
                ok = render_docx_to_pdf_via_loffice(src_path, out_pdf)
                if ok:
                    meta["used"].append("soffice")
                    meta["route"] = "docx->pdf(soffice)"
                    return IngestResult(kind="pdf", src_ext="docx", pdf_path=out_pdf, meta=meta)
            raise  # re-raise to surface dependency error
        except Exception:
            # Fallback to PDF render if possible
            if enable_loffice and has_soffice():
                ok = render_docx_to_pdf_via_loffice(src_path, out_pdf)
                if ok:
                    meta["used"].append("soffice")
                    meta["route"] = "docx->pdf(soffice)"
                    return IngestResult(kind="pdf", src_ext="docx", pdf_path=out_pdf, meta=meta)
            # If no fallback, rethrow
            raise

    # Case 3) HWP
    if ext == "hwp":
        # Try text extraction first if allowed
        if enable_hwp_txt:
            ok = extract_hwp_to_text(src_path, out_txt)
            if ok:
                meta["used"].append("hwp5txt/pyhwp")
                meta["route"] = "hwp->text"
                return IngestResult(kind="text", src_ext="hwp", text_path=out_txt, meta=meta)
        # Else try rendering to PDF via LibreOffice (if available)
        if enable_loffice and has_soffice():
            ok = render_hwp_to_pdf_via_loffice(src_path, out_pdf)
            if ok:
                meta["used"].append("soffice")
                meta["route"] = "hwp->pdf(soffice)"
                return IngestResult(kind="pdf", src_ext="hwp", pdf_path=out_pdf, meta=meta)
        # Nothing worked
        raise RuntimeError("HWP ingestion failed: neither text extraction nor PDF rendering is available.")

    # Unknown extension
    raise ValueError(f"Unsupported extension: .{ext}. Allowed: .pdf, .docx, .hwp")
