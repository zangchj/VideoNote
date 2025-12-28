from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response, FileResponse
import httpx
from urllib.parse import unquote, urlparse
import re
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

IMAGE_EXT_RE = re.compile(r"^(.*?\.(?:jpg|jpeg|png|gif|webp|svg))(?:[\?#].*)?$", re.IGNORECASE)

# allow typical local hostnames to be served from backend static folder
LOCAL_HOSTNAMES = {"localhost", "127.0.0.1"}

# base directory for safely serving local static files (project root)
PROJECT_ROOT = os.path.abspath(os.getcwd())
STATIC_DIR = os.path.join(PROJECT_ROOT, 'static')

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
        # fallback: remove trailing runs of dashes, asterisks and URL-encoded sequences
        clean_url = re.sub(r"(?:%2A|%2a|\*|\s)+[-]{2,}.*$", "", raw)
        clean_url = re.sub(r"[-*_]{2,}.*$", "", clean_url)

    clean_url = clean_url.strip()
    logger.debug("proxy-image received raw=%s clean=%s", raw, clean_url)

    # attempt to parse
    parsed = urlparse(clean_url)

    # If URL is relative (no scheme), attempt to serve as a local static file path
    if not parsed.scheme:
        path = clean_url
        # normalize leading slash
        if path.startswith('/'):
            # map to project static folder if path begins with /static/
            if path.startswith('/static/'):
                candidate = os.path.normpath(os.path.join(PROJECT_ROOT, path.lstrip('/')))
            else:
                candidate = os.path.normpath(os.path.join(PROJECT_ROOT, path.lstrip('/')))
        else:
            candidate = os.path.normpath(os.path.join(PROJECT_ROOT, path))

        # security: ensure candidate is inside project root
        if not candidate.startswith(PROJECT_ROOT):
            raise HTTPException(status_code=400, detail="Invalid local path")

        if os.path.exists(candidate) and os.path.isfile(candidate):
            return FileResponse(candidate, media_type=None, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})
        raise HTTPException(status_code=404, detail="Local file not found")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")

    # If the request targets localhost static and we can map it to backend static directory, serve directly.
    hostname = parsed.hostname or ''
    if hostname in LOCAL_HOSTNAMES and parsed.path.startswith('/static/'):
        candidate = os.path.normpath(os.path.join(PROJECT_ROOT, parsed.path.lstrip('/')))
        if candidate.startswith(STATIC_DIR) and os.path.exists(candidate) and os.path.isfile(candidate):
            return FileResponse(candidate, media_type=None, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"})

    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": "BiliNote-Proxy/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(clean_url, headers=headers)
            resp.raise_for_status()

            content_type = resp.headers.get('Content-Type', 'application/octet-stream')
            # allow browser to cache
            response_headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400"}
            return Response(content=resp.content, media_type=content_type, headers=response_headers)
    except httpx.HTTPStatusError as e:
        logger.exception('Upstream status error fetching %s', clean_url)
        # upstream returned non-2xx
        raise HTTPException(status_code=502, detail=f"Upstream status {e.response.status_code}")
    except Exception as e:
        logger.exception('Network or other error fetching %s', clean_url)
        # network error, DNS, invalid URL, timeout, etc.
        raise HTTPException(status_code=502, detail=str(e))
