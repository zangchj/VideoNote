import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from dotenv import load_dotenv
from fastapi.responses import FileResponse

from app.db.init_db import init_db
from app.db.provider_dao import seed_default_providers
from app.exceptions.exception_handlers import register_exception_handlers
# from app.db.model_dao import init_model_table
# from app.db.provider_dao import init_provider_table
from app.utils.logger import get_logger
from app import create_app
from app.transcriber.transcriber_provider import get_transcriber
from events import register_handler
from ffmpeg_helper import ensure_ffmpeg_or_raise

logger = get_logger(__name__)
load_dotenv()

# 读取 .env 中的路径
static_path = os.getenv('STATIC', '/static')
out_dir = os.getenv('OUT_DIR', './static/screenshots')

# 自动创建本地目录（static 和 static/screenshots）
static_dir = "static"
uploads_dir = "uploads"
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
if not os.path.exists(uploads_dir):
    os.makedirs(uploads_dir)

if not os.path.exists(out_dir):
    os.makedirs(out_dir)

@asynccontextmanager
async def lifespan(app: FastAPI):
    register_handler()
    init_db()
    get_transcriber(transcriber_type=os.getenv("TRANSCRIBER_TYPE", "fast-whisper"))
    seed_default_providers()
    yield

app = create_app(lifespan=lifespan)
origins = [
    "http://localhost",
    "http://127.0.0.1",
    "http://tauri.localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  #  加上 Tauri 的 origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)

# Middleware to sanitize incoming path to avoid Windows invalid filename errors before routing
@app.middleware("http")
async def sanitize_path_middleware(request, call_next):
    from urllib.parse import unquote
    import re
    path = request.scope.get("path", "")
    # Only sanitize when path begins with configured static prefix
    prefix = static_path.rstrip('/') + '/'
    if path.startswith(prefix):
        # decode only the portion after the prefix
        p = path[len(prefix):]
        try:
            p = unquote(p)
        except Exception:
            pass
        # strip common junk suffixes like '*---' and any appended markdown anchors after image names
        if p.endswith('*---'):
            p = p[:-4]
        # strip repeated trailing dashes '---' or appended fragments starting with '---'
        p = re.sub(r'---.*$', '', p)
        # Remove stray asterisks
        p = p.rstrip('*')
        # Normalize path
        norm = os.path.normpath(p).lstrip(os.sep)
        parts = []
        for part in norm.split(os.sep):
            clean = re.sub(r'[<>:\\"/\|\?\*]', '', part)
            clean = re.sub(r'[\.\s]+$', '', clean)
            if clean:
                parts.append(clean)
        new_norm = "/".join(parts)
        new_path = static_path.rstrip('/') + '/' + new_norm
        logger.debug(f"Sanitized static request path from '{path}' to '{new_path}'")
        # update scope.path and raw_path (raw_path must be bytes)
        request.scope['path'] = new_path
        request.scope['raw_path'] = new_path.encode('utf-8')
    response = await call_next(request)
    return response

# Safe static route: sanitize incoming path to remove invalid trailing suffixes (e.g. '*---')
# This prevents WinError 123 when requests include characters invalid in Windows filenames.
@app.get(f"{static_path}/{{full_path:path}}")
async def safe_static(full_path: str):
    import urllib.parse
    import re
    # URL-decode
    p = urllib.parse.unquote(full_path)
    # Strip common trailing junk that some clients append (like '*---' seen in logs)
    if p.endswith('*---'):
        p = p[:-4]
    # Trim any markdown anchor or trailing '---' fragments
    p = re.sub(r'---.*$', '', p)
    # Remove stray asterisks
    p = p.rstrip('*')
    # Normalize path to prevent path traversal
    norm = os.path.normpath(p).lstrip(os.sep)
    # Sanitize each path segment to remove characters invalid on Windows
    parts = []
    for part in norm.split(os.sep):
        # remove characters <>:"/\\|?* and control chars
        clean = re.sub(r'[<>:\\"/\|\?\*]', '', part)
        # trim trailing dots and spaces which are invalid on Windows filenames
        clean = re.sub(r'[\.\s]+$', '', clean)
        if clean:
            parts.append(clean)
    norm = os.sep.join(parts)
    target = os.path.join(static_dir, norm)
    # Ensure target is still within static_dir
    abs_static = os.path.abspath(static_dir)
    abs_target = os.path.abspath(target)
    if not abs_target.startswith(abs_static):
        raise HTTPException(status_code=404)
    if not os.path.exists(abs_target) or not os.path.isfile(abs_target):
        raise HTTPException(status_code=404)
    return FileResponse(abs_target)

# Mount uploads normally, but avoid mounting the same static_path to prevent duplicate handling.
# We already expose a safe_static route for static files; only mount uploads here.
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")






if __name__ == "__main__":
    port = int(os.getenv("BACKEND_PORT", 8483))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=False)