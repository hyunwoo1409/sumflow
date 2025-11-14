import os
import shutil
import subprocess
from typing import Optional

def has_soffice(explicit_bin: Optional[str] = None) -> bool:
    """
    Check if LibreOffice (soffice) is available in PATH or via explicit binary.
    """
    bin_name = explicit_bin or os.environ.get("LOFFICE_BIN") or "soffice"
    return shutil.which(bin_name) is not None

def convert_to_pdf(src_path: str, out_dir: str, explicit_bin: Optional[str] = None, timeout: int = 300) -> bool:
    """
    Use LibreOffice headless to convert a given document to PDF.
    Returns True on success, False otherwise.
    """
    os.makedirs(out_dir, exist_ok=True)
    bin_name = explicit_bin or os.environ.get("LOFFICE_BIN") or "soffice"
    if shutil.which(bin_name) is None:
        return False

    try:
        # LibreOffice writes the PDF into out_dir with the same base filename
        cmd = [
            bin_name,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to", "pdf",
            "--outdir", out_dir,
            src_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return True
    except Exception:
        return False
