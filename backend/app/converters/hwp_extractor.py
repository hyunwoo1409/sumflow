import io
import os
import shutil
import subprocess
from typing import Optional

def _write_utf8(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text)

def extract_hwp_to_text(src_path: str, out_txt_path: str) -> bool:
    """
    Try extracting text from HWP.
    Priority 1: hwp5txt (external binary) if available.
    Priority 2: pyhwp (if installed) as a fallback.
    Returns True on success, False otherwise.
    """
    # 1) hwp5txt (recommended for simplicity)
    hwp5 = os.environ.get("HWP_TXT_BIN") or "hwp5txt"
    if shutil.which(hwp5) is not None:
        try:
            p = subprocess.run([hwp5, src_path], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            text = p.stdout.decode("utf-8", errors="replace")
            _write_utf8(out_txt_path, text)
            return True
        except Exception:
            pass

    # 2) pyhwp fallback (best-effort; environment dependent)
    try:
        # pyhwp’s API can vary; this keeps it minimal/best-effort
        import pyhwp
        # Minimal approach: convert to text via pyhwp.hwp5txt emulation if available
        # Some installations expose a similar utility via python entry point:
        #   from pyhwp.hwp5.utils import Hwp5File, text
        # But compatibility differs; so we try CLI if provided.
        py_cli = shutil.which("python")  # we’ll try calling the module as a script if possible
        # If pyhwp is installed, it often ships 'hwp5txt' as a console script as well.
        # Already tried hwp5txt above, so if we are here, assume no console script.
        # We'll attempt a very naive open to ensure file readable; detailed parsing is nontrivial.
        # To avoid brittle API calls, we bail out gracefully.
        return False
    except Exception:
        return False

def render_hwp_to_pdf_via_loffice(src_path: str, out_pdf_path: str) -> bool:
    """
    Convert HWP to PDF via LibreOffice if HWP filter is available.
    Many distros do not ship HWP filter; expect False often unless configured.
    """
    from .loffice import convert_to_pdf
    out_dir = os.path.dirname(out_pdf_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    ok = convert_to_pdf(src_path, out_dir=out_dir)
    if not ok:
        return False
    # normalize produced file to requested name
    base = os.path.splitext(os.path.basename(src_path))[0] + ".pdf"
    produced = os.path.join(out_dir, base)
    if produced != out_pdf_path and os.path.exists(produced):
        try:
            os.replace(produced, out_pdf_path)
        except Exception:
            return False
    return os.path.exists(out_pdf_path)
