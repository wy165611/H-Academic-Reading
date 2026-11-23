import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.auth import get_current_user
from app.config import settings

router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_CATEGORIES = {
    "pdfs": settings.pdfs_dir,
    "figures": settings.figures_dir,
    "thumbnails": settings.thumbnails_dir,
}


@router.get("/{category}/{filename}")
def serve_protected_file(
    category: str,
    filename: str,
    request: Request,
    _user: str = Depends(get_current_user),
):
    base_dir = ALLOWED_CATEGORIES.get(category)
    if not base_dir:
        raise HTTPException(status_code=404, detail="Invalid file category")

    # Prevent path traversal
    safe_name = Path(filename).name
    if safe_name != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = (base_dir / safe_name).resolve()
    if not file_path.is_relative_to(base_dir.resolve()) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    media_type = mime_type or ("application/pdf" if category == "pdfs" else "image/png")

    # Support HTTP Range requests for react-pdf / PDF streaming
    range_header = request.headers.get("range")
    if range_header and category == "pdfs":
        file_size = file_path.stat().st_size
        try:
            range_spec = range_header.replace("bytes=", "").strip()
            start_str, end_str = range_spec.split("-")
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            if start > end or start < 0:
                raise ValueError("Invalid range")
        except ValueError:
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")

        chunk_len = end - start + 1

        def iter_range():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = chunk_len
                while remaining > 0:
                    buf = f.read(min(65536, remaining))
                    if not buf:
                        break
                    remaining -= len(buf)
                    yield buf

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_len),
                "Cache-Control": "private, max-age=3600",
            },
        )

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
        },
    )
