import io
import os
from typing import Optional

def _write_utf8(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text)

def extract_docx_to_text(src_path: str, out_txt_path: str) -> None:
    """
    Extracts plain text from DOCX using python-docx.
    Raises ImportError if python-docx is not installed.
    """
    try:
        import docx  # python-docx
    except Exception as e:
        raise ImportError("python-docx is required for DOCX text extraction. pip install python-docx") from e

    doc = docx.Document(src_path)
    # Join paragraphs with newlines; avoids losing structure but stays simple
    text = "\n".join([p.text for p in doc.paragraphs])
    _write_utf8(out_txt_path, text)

def render_docx_to_pdf_via_loffice(src_path: str, out_pdf_path: str) -> bool:
    """
    Convert DOCX to PDF using LibreOffice if available.
    Returns True on success and ensures out_pdf_path exists.
    """
    from .loffice import convert_to_pdf
    out_dir = os.path.dirname(out_pdf_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    ok = convert_to_pdf(src_path, out_dir=out_dir)
    if not ok:
        return False
    # LibreOffice names the output as <basename>.pdf
    base = os.path.splitext(os.path.basename(src_path))[0] + ".pdf"
    produced = os.path.join(out_dir, base)
    if produced != out_pdf_path and os.path.exists(produced):
        # normalize name to requested out_pdf_path
        try:
            os.replace(produced, out_pdf_path)
        except Exception:
            return False
    return os.path.exists(out_pdf_path)
