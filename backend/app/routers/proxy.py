from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, FileResponse
import httpx
from urllib.parse import unquote, urlparse
import re
import os

router = APIRouter()

IMAGE_EXT_RE = re.compile(r"^(.*?\.(?:jpg|jpeg|png|gif|webp|svg))(?:[\?#].*)?$", re.IGNORECASE)

# allow typical local hostnames to be served from backend static folder
LOCAL_HOSTNAMES = {"localhost", "127.0.0.1"}

@router.get('/proxy-image')
async def proxy_image(url: str = Query(...)):
    # Basic sanitation: URL-decode and trim common trailing junk like '---' or extra suffixes
    try:
        raw = unquote(url)
    except Exception:
        raw = url

    # Trim whitespace
    raw = raw.strip()

    # If the client appended markdown anchors or extra suffix like '---', try to trim after known image extension
    m = IMAGE_EXT_RE.match(raw)
    if m:
        clean_url = m.group(1)
    else:
        # fallback: remove trailing runs of dashes and non-url characters
        clean_url = re.sub(r"[-]{3,}.*$", "", raw)

    parsed = urlparse(clean_url)

    # If URL is relative (no scheme), reject; but if it's a localhost path like '/static/..', attempt to serve from backend static folder
    if not parsed.scheme:
        # treat as local path
        path = clean_url
        if path.startswith('/'):
            # Map to backend project working directory
            local_path = os.path.abspath(path.lstrip('/'))
        else:
            local_path = os.path.abspath(path)
        if os.path.exists(local_path) and os.path.isfile(local_path):
            return FileResponse(local_path, media_type=None, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})
        raise HTTPException(status_code=400, detail="Invalid URL or local file not found")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")

    # If the request targets localhost static and we can map it to backend static directory, serve directly.
    hostname = parsed.hostname or ''
    if hostname in LOCAL_HOSTNAMES and parsed.path.startswith('/static/'):
        # Map to backend's static directory (assumes working directory contains 'static' folder)
        candidate = os.path.abspath(os.path.join(os.getcwd(), parsed.path.lstrip('/')))
        if os.path.exists(candidate) and os.path.isfile(candidate):
            return FileResponse(candidate, media_type=None, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})

    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": "BiliNote-Proxy/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(clean_url, headers=headers)
            resp.raise_for_status()

            content_type = resp.headers.get('Content-Type', 'application/octet-stream')
            # allow browser to cache
            response_headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"}
            return Response(content=resp.content, media_type=content_type, headers=response_headers)
    except httpx.HTTPStatusError as e:
        # upstream returned non-2xx
        raise HTTPException(status_code=502, detail=f"Upstream status {e.response.status_code}")
    except Exception as e:
        # network error, DNS, invalid URL, timeout, etc.
        raise HTTPException(status_code=502, detail=str(e))
