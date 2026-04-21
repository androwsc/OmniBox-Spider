# -*- coding: utf-8 -*-
# @name 人人电影
# @author 梦
# @description 影视站：https://www.rrdynb.com/ ，支持首页、分类、搜索、详情与网盘线路提取（Python版）
# @version 1.1.7
# @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/人人电影.py

import json
import html
import os
import re
from urllib.parse import quote
from spider_runner import OmniBox, run

BASE_URL = "https://www.rrdynb.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
RRDYNB_FLARESOLVERR_URL = str(os.environ.get("RRDYNB_FLARESOLVERR_URL") or "http://192.168.50.50:8191/v1").strip()
RRDYNB_FLARESOLVERR_SESSION = str(os.environ.get("RRDYNB_FLARESOLVERR_SESSION") or "rrdynb-search").strip()
RRDYNB_FLARESOLVERR_TIMEOUT_MS = max(10000, int(os.environ.get("RRDYNB_FLARESOLVERR_TIMEOUT_MS", "60000") or 60000))
RRDYNB_SEARCH_USE_FLARESOLVERR = str(os.environ.get("RRDYNB_SEARCH_USE_FLARESOLVERR", "true")).lower() == "true"

CATEGORY_MAP = {
    "movie": {"type_id": "2", "type_name": "电影", "path": "/movie/"},
    "tv": {"type_id": "6", "type_name": "电视剧", "path": "/dianshiju/"},
    "variety": {"type_id": "10", "type_name": "综艺", "path": "/zongyi/"},
    "anime": {"type_id": "13", "type_name": "动漫", "path": "/dongman/"},
}
TYPEID_TO_KEY = {v["type_id"]: k for k, v in CATEGORY_MAP.items()}
VIDEO_EXTS = (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v", ".ts", ".m2ts", ".webm", ".mpg", ".mpeg")
CACHE_EX_SECONDS = 3600


def split_config_list(value: str):
    return [item.strip() for item in str(value or "").replace(",", ";").split(";") if item.strip()]


DRIVE_TYPE_CONFIG = [item.lower() for item in split_config_list(os.environ.get("DRIVE_TYPE_CONFIG", "quark;uc"))]
SOURCE_NAMES_CONFIG = split_config_list(os.environ.get("SOURCE_NAMES_CONFIG", "本地代理;服务端代理;直连"))
EXTERNAL_SERVER_PROXY_ENABLED = str(os.environ.get("EXTERNAL_SERVER_PROXY_ENABLED", "false")).lower() == "true"
DRIVE_ORDER = [item.lower() for item in split_config_list(os.environ.get("DRIVE_ORDER", "baidu;tianyi;quark;uc;115;xunlei;ali;123pan"))]


def abs_url(url: str) -> str:
    url = str(url or "").strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("/"):
        return f"{BASE_URL}{url}"
    return f"{BASE_URL}/{url.lstrip('./')}"


def normalize_share_url(share_url: str) -> str:
    raw = str(share_url or "").strip()
    if not raw:
        return ""
    try:
        from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
        u = urlparse(raw)
        if "pan.baidu.com" in u.netloc:
            qs = parse_qs(u.query)
            pwd = qs.get("pwd", [""])[0] or qs.get("password", [""])[0] or qs.get("passwd", [""])[0] or ""
            path = u.path.strip()
            m = re.search(r"/s/([^/?#]+)", path)
            if m:
                base = f"https://pan.baidu.com/s/{m.group(1)}"
                return f"{base}?pwd={pwd}" if pwd else base
        return raw
    except Exception:
        return raw


def clean_html(text: str) -> str:
    value = str(text or "")
    value = value.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def clean_multiline_html(text: str) -> str:
    value = str(text or "")
    value = value.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")
    value = re.sub(r"<img[^>]*>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n\s*\n+", "\n", value)
    return value.strip()


def normalize_vod_title(text: str) -> str:
    value = str(text or "")
    value = html.unescape(value)
    value = re.sub(r"</?font[^>]*>", "", value, flags=re.I)
    value = re.sub(r"</?fontcolor[^>]*>", "", value, flags=re.I)
    value = re.sub(r"</?[^>]+>", "", value, flags=re.I)
    value = clean_html(value)
    value = re.split(r"(?:百度云|百度网盘|夸克|阿里云盘|阿里网盘|网盘下载|下载|中字)", value, maxsplit=1)[0].strip()
    value = value.strip("《》[]【】()（） ")
    return value or clean_html(html.unescape(text))


def uniq(seq):
    out = []
    seen = set()
    for item in seq:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


async def log(level: str, message: str):
    try:
        await OmniBox.log(level, message)
    except Exception:
        pass


async def request_text(url: str, referer: str = None) -> str:
    res = await OmniBox.request(url, {
        "method": "GET",
        "headers": {
            "User-Agent": UA,
            "Referer": referer or f"{BASE_URL}/",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    })
    status = int(res.get("statusCode") or 0)
    body = res.get("body", "")
    text = body.decode("utf-8", "ignore") if isinstance(body, (bytes, bytearray)) else str(body or "")
    if status != 200:
        raise RuntimeError(f"HTTP {status} @ {url}")
    return text


async def request_text_via_flaresolverr(url: str, referer: str = None) -> str:
    if not RRDYNB_FLARESOLVERR_URL:
        raise RuntimeError("FlareSolverr URL not configured")

    payload = {
        "cmd": "request.get",
        "url": url,
        "maxTimeout": RRDYNB_FLARESOLVERR_TIMEOUT_MS,
        "session": RRDYNB_FLARESOLVERR_SESSION,
        "headers": {
            "User-Agent": UA,
            "Referer": referer or f"{BASE_URL}/",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    }
    await log("info", f"[rrdynb][flaresolverr] url={url} session={RRDYNB_FLARESOLVERR_SESSION}")
    res = await OmniBox.request(RRDYNB_FLARESOLVERR_URL, {
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        "body": json.dumps(payload, ensure_ascii=False),
    })
    status = int(res.get("statusCode") or 0)
    body = res.get("body", "")
    text = body.decode("utf-8", "ignore") if isinstance(body, (bytes, bytearray)) else str(body or "")
    if status != 200:
        raise RuntimeError(f"FlareSolverr HTTP {status}")

    data = json.loads(text or "{}")
    if str(data.get("status") or "").lower() != "ok":
        raise RuntimeError(f"FlareSolverr status={data.get('status')} message={data.get('message')}")

    solution = data.get("solution") or {}
    solution_status = int(solution.get("status") or 0)
    response_text = str(solution.get("response") or "")
    if solution_status != 200:
        raise RuntimeError(f"FlareSolverr solution HTTP {solution_status} @ {url}")
    if not response_text:
        raise RuntimeError(f"FlareSolverr empty response @ {url}")
    return response_text


async def get_cached_json(key: str):
    try:
        value = await OmniBox.getCache(key)
        if not value:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value
    except Exception:
        return None


async def set_cached_json(key: str, value, ex_seconds: int = CACHE_EX_SECONDS):
    try:
        await OmniBox.setCache(key, json.dumps(value, ensure_ascii=False), ex_seconds)
    except Exception:
        pass


async def get_drive_info(share_url: str):
    share_url = normalize_share_url(share_url)
    cache_key = f"rrdynb:driveInfo:{share_url}"
    cached = await get_cached_json(cache_key)
    if cached:
        return cached
    value = await OmniBox.getDriveInfoByShareURL(share_url)
    await set_cached_json(cache_key, value)
    return value


async def get_drive_file_list(share_url: str, fid: str = "0"):
    share_url = normalize_share_url(share_url)
    cache_key = f"rrdynb:driveFiles:{share_url}:{fid}"
    cached = await get_cached_json(cache_key)
    if cached:
        return cached
    value = await OmniBox.getDriveFileList(share_url, fid)
    await set_cached_json(cache_key, value)
    return value


async def get_drive_video_play_info(share_url: str, fid: str, route_type: str = "直连"):
    return await OmniBox.getDriveVideoPlayInfo(share_url, fid, route_type)


def normalize_items(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        candidates = [
            data.get("items"),
            data.get("list"),
            data.get("files"),
            data.get("data"),
            data.get("data", {}).get("items") if isinstance(data.get("data"), dict) else None,
            data.get("data", {}).get("list") if isinstance(data.get("data"), dict) else None,
            data.get("data", {}).get("files") if isinstance(data.get("data"), dict) else None,
            data.get("result"),
            data.get("result", {}).get("items") if isinstance(data.get("result"), dict) else None,
            data.get("result", {}).get("list") if isinstance(data.get("result"), dict) else None,
            data.get("result", {}).get("files") if isinstance(data.get("result"), dict) else None,
        ]
        for val in candidates:
            if isinstance(val, list):
                return val
    return []


def get_list_field(data, *names):
    if isinstance(data, dict):
        for name in names:
            val = data.get(name)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                nested = get_list_field(val, "items", "list", "files", "data", "result")
                if nested:
                    return nested
    return []


def infer_drive_type(value: str) -> str:
    raw = str(value or "").lower().strip()
    if not raw:
        return ""
    if "百度" in value or "pan.baidu.com" in raw or raw == "baidu" or raw == "baiduyun":
        return "baidu"
    if "天翼" in value or "cloud.189.cn" in raw or raw == "tianyi":
        return "tianyi"
    if "夸克" in value or "pan.quark.cn" in raw or raw == "quark":
        return "quark"
    if raw == "uc" or "drive.uc.cn" in raw:
        return "uc"
    if "115" in raw:
        return "115"
    if "迅雷" in value or "xunlei" in raw:
        return "xunlei"
    if "阿里" in value or "aliyundrive" in raw or "alipan" in raw or raw in ("ali", "aliyun"):
        return "ali"
    if "123" in raw:
        return "123pan"
    return raw


def drive_type_to_display_name(drive_type: str) -> str:
    mapping = {
        "baidu": "百度",
        "tianyi": "天翼",
        "quark": "夸克",
        "uc": "UC",
        "115": "115",
        "xunlei": "迅雷",
        "ali": "阿里",
        "123pan": "123网盘",
    }
    return mapping.get(str(drive_type or "").lower(), "资源")


def infer_drive_label(url: str, drive_info=None) -> str:
    text = str(url or "")
    drive_type = ""
    display = ""
    if isinstance(drive_info, dict):
        drive_type = infer_drive_type(str(drive_info.get("driveType") or drive_info.get("type") or ""))
        display = str(drive_info.get("displayName") or drive_info.get("name") or "")
    inferred = infer_drive_type(text)
    if inferred:
        return drive_type_to_display_name(inferred)
    if drive_type:
        return drive_type_to_display_name(drive_type)
    if display:
        return display.strip()
    if text.startswith("magnet:"):
        return "磁力"
    if text.startswith("ed2k://"):
        return "电驴"
    return "资源"


def infer_drive_type_from_source_name(name: str = "") -> str:
    return infer_drive_type(name)


def sort_play_sources_by_drive_order(play_sources):
    if not isinstance(play_sources, list) or len(play_sources) <= 1 or not DRIVE_ORDER:
        return play_sources
    order_map = {name: index for index, name in enumerate(DRIVE_ORDER)}
    return sorted(
        play_sources,
        key=lambda item: order_map.get(infer_drive_type_from_source_name(item.get("name", "")), 10**9),
    )


def get_base_url_host(context=None) -> str:
    ctx = context or {}
    base_url = str(ctx.get("baseURL") or "").strip()
    if not base_url:
        return ""
    try:
        from urllib.parse import urlparse
        return (urlparse(base_url).hostname or "").lower()
    except Exception:
        return base_url.lower()


def is_private_host(hostname: str = "") -> bool:
    host = str(hostname or "").lower()
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return True
    if re.match(r"^(10\.|192\.168\.|169\.254\.)", host):
        return True
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", host):
        return True
    if host.endswith(".local") or host.endswith(".lan") or host.endswith(".internal") or host.endswith(".intra"):
        return True
    if ":" in host:
        return host.startswith("fc") or host.startswith("fd") or host.startswith("fe80")
    return False


def can_use_server_proxy(context=None) -> bool:
    if EXTERNAL_SERVER_PROXY_ENABLED:
        return True
    return is_private_host(get_base_url_host(context or {}))


def filter_source_names_for_caller(source_names=None, caller_source: str = "", context=None):
    filtered = list(source_names or [])
    source = str(caller_source or "").lower()
    allow_server_proxy = can_use_server_proxy(context or {})

    if source == "web":
        filtered = [name for name in filtered if name != "本地代理"]
    elif source == "emby":
        if allow_server_proxy:
            filtered = [name for name in filtered if name == "服务端代理"]
        else:
            filtered = [name for name in filtered if name != "服务端代理"]
    elif source == "uz":
        filtered = [name for name in filtered if name != "本地代理"]

    if not allow_server_proxy:
        filtered = [name for name in filtered if name != "服务端代理"]

    return filtered or ["直连"]


def resolve_caller_source(params=None, context=None) -> str:
    return str((context or {}).get("from") or (params or {}).get("source") or "").lower()


def resolve_route_type(flag: str = "", caller_source: str = "", context=None) -> str:
    allow_server_proxy = can_use_server_proxy(context or {})
    valid_route_types = {"本地代理", "服务端代理", "直连"}
    route_type = "直连"

    if caller_source in ("web", "emby"):
        route_type = "服务端代理" if allow_server_proxy else "直连"

    if flag:
        route_type = flag.split("-")[-1] if "-" in flag else flag

    if route_type not in valid_route_types:
        route_type = "直连"
    if not allow_server_proxy and route_type == "服务端代理":
        route_type = "直连"
    if caller_source == "uz" and route_type == "本地代理":
        route_type = "直连"
    return route_type


def get_route_types(context=None, drive_type: str = ""):
    normalized = infer_drive_type(drive_type)
    if normalized in DRIVE_TYPE_CONFIG:
        source = resolve_caller_source({}, context or {})
        return filter_source_names_for_caller(SOURCE_NAMES_CONFIG, source, context or {})
    return ["直连"]


def file_name_of(item: dict) -> str:
    return str(item.get("file_name") or item.get("name") or item.get("title") or item.get("filename") or "").strip()


def file_id_of(item: dict) -> str:
    return str(item.get("fid") or item.get("file_id") or item.get("id") or item.get("fileId") or "").strip()


def is_folder(item: dict) -> bool:
    if item.get("is_dir") is True or item.get("is_folder") is True:
        return True
    if str(item.get("dir") or "") in ("1", "true", "True"):
        return True
    if str(item.get("type") or "").lower() in ("folder", "dir", "directory"):
        return True
    if str(item.get("category") or "").lower() in ("folder", "dir", "directory"):
        return True
    if str(item.get("file_category") or "").lower() in ("folder", "dir", "directory"):
        return True
    if str(item.get("kind") or "").lower() in ("folder", "dir", "directory"):
        return True
    if str(item.get("file_type") or "") in ("0",):
        return True
    return False


def looks_like_video(item: dict) -> bool:
    name = file_name_of(item).lower()
    if any(name.endswith(ext) for ext in VIDEO_EXTS):
        return True
    mime = str(item.get("mime_type") or item.get("mime") or item.get("mimetype") or "").lower()
    if mime.startswith("video/"):
        return True
    category = str(item.get("category") or item.get("file_category") or item.get("type") or item.get("kind") or "").lower()
    if category == "video":
        return True
    if str(item.get("file_type") or "") in ("1",):
        return True
    return False


def build_drive_play_meta(share_url: str, file: dict, route_type: str = "直连"):
    return {
        "kind": "drive-file",
        "shareURL": share_url,
        "fid": file.get("fid"),
        "name": file.get("name") or "播放",
        "routeType": route_type,
    }


async def collect_drive_videos(share_url: str, folder_id: str = "0", depth: int = 0, limit: int = 80):
    if depth > 2:
        return []

    share_url = normalize_share_url(share_url)
    raw = None
    tried_ids = [str(folder_id or "0")]
    if depth == 0:
        for extra in ("0", "root", ""):
            if extra not in tried_ids:
                tried_ids.append(extra)
    last_err = None
    for current_fid in tried_ids:
        try:
            raw = await get_drive_file_list(share_url, current_fid)
            items = normalize_items(raw)
            if not items:
                items = get_list_field(raw, "items", "list", "files")
            if items:
                folder_id = current_fid
                break
        except Exception as e:
            last_err = e
            await log("warn", f"[rrdynb][drive-list] share={share_url} fid={current_fid} err={e}")
            raw = None
    items = normalize_items(raw) or get_list_field(raw, "items", "list", "files")
    if not items:
        if last_err and depth > 0:
            await log("warn", f"[rrdynb][drive-list] share={share_url} depth={depth} no-items err={last_err}")
        return []
    videos = []
    seen_file_ids = set()
    for item in items:
        if len(videos) >= limit:
            break
        if not isinstance(item, dict):
            continue
        fid = file_id_of(item)
        if is_folder(item) and fid:
            sub = await collect_drive_videos(share_url, fid, depth + 1, max(0, limit - len(videos)))
            videos.extend(sub)
            continue
        if looks_like_video(item) and fid:
            if fid in seen_file_ids:
                continue
            seen_file_ids.add(fid)
            videos.append({
                "fid": fid,
                "name": file_name_of(item) or f"文件{len(videos) + 1}",
                "size": item.get("size") or item.get("file_size") or item.get("obj_size") or 0,
            })
    return videos[:limit]


CARD_RE = re.compile(r'<li\s+class="pure-g\s+shadow"[^>]*>(.*?)</li>', re.S | re.I)


def extract_cards(text: str, type_id: str, type_name: str):
    cards = []
    for block in CARD_RE.findall(text):
        href_m = re.search(r'<a[^>]+class="movie-thumbnails"[^>]+href="([^"]+)"', block, re.I)
        title_m = re.search(r'<h2>\s*<a[^>]+title="([^"]+)"', block, re.S | re.I)
        title_html_m = re.search(r'<h2>\s*<a[^>]*>(.*?)</a>', block, re.S | re.I)
        img_m = re.search(r'<img[^>]+(?:data-original|src)="([^"]+)"', block, re.I)
        brief_m = re.search(r'<div\s+class="brief"[^>]*>(.*?)</div>', block, re.S | re.I)
        date_m = re.search(r'<div\s+class="tags"[^>]*>\s*([^<\n\r]+)', block, re.S | re.I)
        douban_m = re.search(r'豆瓣：<b>([^<]+)</b>', block, re.I)
        imdb_m = re.search(r'IMDB：<b>([^<]+)</b>', block, re.I)
        href = abs_url(href_m.group(1)) if href_m else ""
        if not href:
            continue
        raw_title = title_m.group(1) if title_m else ""
        if not raw_title and title_html_m:
            raw_title = title_html_m.group(1)
        title = normalize_vod_title(raw_title)
        brief = clean_html(brief_m.group(1) if brief_m else "")
        date = clean_html(date_m.group(1) if date_m else "")
        remarks = " | ".join([x for x in [date, f"豆瓣{clean_html(douban_m.group(1))}" if douban_m else "", f"IMDB{clean_html(imdb_m.group(1))}" if imdb_m else ""] if x])
        cards.append({
            "vod_id": href,
            "vod_name": title or href.rsplit("/", 1)[-1],
            "vod_pic": abs_url(img_m.group(1)) if img_m else "",
            "vod_remarks": remarks,
            "vod_content": brief,
            "type_id": type_id,
            "type_name": type_name,
        })
    return cards


FIELD_LABELS = {
    "导演": "vod_director",
    "主演": "vod_actor",
    "类型": "type_name",
    "制片国家/地区": "vod_area",
    "地区": "vod_area",
    "语言": "vod_lang",
    "上映日期": "vod_pubdate",
    "年份": "vod_year",
    "片长": "vod_remarks",
    "更新日期": "update_date",
    "又名": "vod_subtitle",
    "编剧": "vod_writer",
    "IMDb": "vod_imdb",
}


def parse_detail_fields(text: str):
    data = {}
    movie_txt_m = re.search(r'<div\s+class="movie-txt"[^>]*>(.*?)</div>\s*<div\s+class="(?:clear|more-link|xgxg|stui-pannel)"', text, re.S | re.I)
    block = movie_txt_m.group(1) if movie_txt_m else text

    img_m = re.search(r'<img[^>]+src="([^"]+)"[^>]*>', block, re.I)
    if img_m:
        data["vod_pic"] = abs_url(img_m.group(1))

    for label, key in FIELD_LABELS.items():
        m = re.search(rf'{re.escape(label)}\s*[:：]\s*(.*?)</span>', block, re.S | re.I)
        if m:
            data[key] = clean_html(m.group(1))

    intro_m = re.search(r'剧情简介[：:]?</strong></span></span></div>\s*<div>\s*<span[^>]*>(.*?)资源：</span>', text, re.S | re.I)
    if not intro_m:
        intro_m = re.search(r'剧情简介[：:]?</strong></span></span></div>\s*<div>\s*<span[^>]*>(.*?)</span>\s*</div>', text, re.S | re.I)
    if intro_m:
        data["vod_content"] = clean_multiline_html(intro_m.group(1))

    return data


def extract_share_links(text: str):
    patterns = [
        r'https?://(?:www\.)?(?:aliyundrive\.com|www\.aliyundrive\.com|alipan\.com|www\.alipan\.com|pan\.quark\.cn|pan\.baidu\.com|115\.com|www\.115\.com|pan\.115\.com|xunlei\.com|pan\.xunlei\.com)[^"\'<>\s]+',
        r'magnet:\?xt=urn:[^"\'<>\s]+',
        r'ed2k://[^"\'<>\s]+',
    ]
    out = []
    for pat in patterns:
        out.extend(re.findall(pat, text, re.I))
    cleaned = []
    for url in out:
        url = html.unescape(url).strip().rstrip('.,;]>)')
        if url.startswith("https://pan.baidu.com/download"):
            continue
        cleaned.append(url)
    return uniq(cleaned)


def build_filters():
    genre_values = [
        {"name": "全部", "value": ""},
        {"name": "剧情", "value": "剧情"},
        {"name": "喜剧", "value": "喜剧"},
        {"name": "惊悚", "value": "惊悚"},
        {"name": "动作", "value": "动作"},
        {"name": "爱情", "value": "爱情"},
        {"name": "犯罪", "value": "犯罪"},
        {"name": "恐怖", "value": "恐怖"},
        {"name": "冒险", "value": "冒险"},
        {"name": "悬疑", "value": "悬疑"},
        {"name": "科幻", "value": "科幻"},
        {"name": "奇幻", "value": "奇幻"},
        {"name": "家庭", "value": "家庭"},
        {"name": "动画", "value": "动画"},
        {"name": "纪录片", "value": "纪录片"},
        {"name": "战争", "value": "战争"},
        {"name": "历史", "value": "历史"},
        {"name": "传记", "value": "传记"},
    ]
    return {
        cfg["type_id"]: [{"key": "splxa", "name": "类型", "init": "", "value": genre_values}]
        for cfg in CATEGORY_MAP.values()
    }


def build_category_url(category_id: str, page: int, filters: dict):
    key = TYPEID_TO_KEY.get(str(category_id), "movie")
    cfg = CATEGORY_MAP[key]
    genre = str((filters or {}).get("splxa") or "").strip()
    if genre:
        return f"{BASE_URL}/plus/list.php?tid={cfg['type_id']}&splxa={quote(genre)}&page={page}"
    if page and int(page) > 1:
        return f"{BASE_URL}/plus/list.php?tid={cfg['type_id']}&page={page}"
    return f"{BASE_URL}{cfg['path']}"


async def home(params, context):
    try:
        await log("info", "[rrdynb][home] start")
        classes = [
            {"type_id": cfg["type_id"], "type_name": cfg["type_name"]}
            for cfg in CATEGORY_MAP.values()
        ]
        text = await request_text(f"{BASE_URL}/")
        cards = extract_cards(text, CATEGORY_MAP["movie"]["type_id"], CATEGORY_MAP["movie"]["type_name"])
        if not cards:
            text = await request_text(f"{BASE_URL}/movie/")
            cards = extract_cards(text, CATEGORY_MAP["movie"]["type_id"], CATEGORY_MAP["movie"]["type_name"])
        return {"class": classes, "filters": build_filters(), "list": cards[:20]}
    except Exception as e:
        await log("error", f"[rrdynb][home] {e}")
        return {"class": [], "filters": {}, "list": []}


async def category(params, context):
    try:
        category_id = str(params.get("categoryId") or "2")
        page = int(params.get("page") or 1)
        filters = params.get("filters") or {}
        url = build_category_url(category_id, page, filters)
        await log("info", f"[rrdynb][category] cid={category_id} page={page} filters={filters} url={url}")
        text = await request_text(url)
        cfg = CATEGORY_MAP[TYPEID_TO_KEY.get(category_id, "movie")]
        cards = extract_cards(text, cfg["type_id"], cfg["type_name"])
        has_more = len(cards) >= 10
        return {
            "page": page,
            "pagecount": page + 1 if has_more else page,
            "total": page * len(cards) + (1 if has_more else 0),
            "list": cards,
        }
    except Exception as e:
        await log("error", f"[rrdynb][category] {e}")
        return {"page": 1, "pagecount": 1, "total": 0, "list": []}


async def search(params, context):
    try:
        keyword = str(params.get("keyword") or params.get("wd") or "").strip()
        page = int(params.get("page") or 1)
        if not keyword:
            return {"page": 1, "pagecount": 1, "total": 0, "list": []}
        await log("info", f"[rrdynb][search] keyword={keyword} page={page}")
        if page > 1:
            return {"page": page, "pagecount": 1, "total": 0, "list": []}
        url = f"{BASE_URL}/plus/search.php?q={quote(keyword)}&pagesize=10"
        if RRDYNB_SEARCH_USE_FLARESOLVERR:
            try:
                text = await request_text_via_flaresolverr(url, referer=f"{BASE_URL}/")
                await log("info", f"[rrdynb][search] flaresolverr hit len={len(text)}")
            except Exception as fs_err:
                await log("warn", f"[rrdynb][search] flaresolverr failed: {fs_err}")
                text = await request_text(url, referer=f"{BASE_URL}/")
        else:
            text = await request_text(url, referer=f"{BASE_URL}/")
        merged = []
        for cfg in CATEGORY_MAP.values():
            merged.extend(extract_cards(text, cfg["type_id"], cfg["type_name"]))
        seen = set()
        results = []
        for item in merged:
            vid = item.get("vod_id")
            if vid in seen:
                continue
            seen.add(vid)
            results.append(item)
        return {"page": 1, "pagecount": 1, "total": len(results), "list": results}
    except Exception as e:
        await log("error", f"[rrdynb][search] {e}")
        return {"page": 1, "pagecount": 1, "total": 0, "list": []}


async def detail(params, context):
    try:
        video_id = str(params.get("videoId") or "").strip()
        if not video_id:
            return {"list": []}
        url = abs_url(video_id)
        await log("info", f"[rrdynb][detail] url={url}")
        text = await request_text(url, referer=f"{BASE_URL}/")
        title_m = re.search(r'<title>(.*?)</title>', text, re.S | re.I)
        raw_title = clean_html(title_m.group(1) if title_m else "")
        vod_name = raw_title.split("_")[0].strip() if raw_title else url.rsplit("/", 1)[-1]
        info = parse_detail_fields(text)
        share_links = extract_share_links(text)
        await log("info", f"[rrdynb][detail] share_count={len(share_links)}")

        sources = []
        source_name_count = {}
        caller_source = resolve_caller_source(params, context)
        for idx, share_url in enumerate(share_links, start=1):
            share_url = normalize_share_url(share_url)
            drive_info = None
            drive_label = ""
            drive_type = ""
            try:
                if share_url.startswith("http"):
                    drive_info = await get_drive_info(share_url)
                    drive_label = infer_drive_label(share_url, drive_info)
                    drive_type = infer_drive_type(str((drive_info or {}).get("driveType") or (drive_info or {}).get("type") or "")) or infer_drive_type(share_url)
            except Exception as e:
                await log("warn", f"[rrdynb][drive-info] share={share_url} err={e}")
                drive_label = infer_drive_label(share_url)
                drive_type = infer_drive_type(share_url)
            source_name = drive_label or infer_drive_label(share_url)

            episodes = []
            if share_url.startswith("http"):
                videos = await collect_drive_videos(share_url, "0")
                await log("info", f"[rrdynb][detail] share={source_name} videos={len(videos)}")
                route_types = get_route_types(context, drive_type)
                for route_type in route_types:
                    route_episodes = []
                    for i, file in enumerate(videos, start=1):
                        play_meta = build_drive_play_meta(share_url, file, route_type)
                        route_episodes.append({
                            "name": file.get("name") or f"文件{i}",
                            "playId": json.dumps(play_meta, ensure_ascii=False),
                            "size": int(file.get("size") or 0),
                        })
                    if route_episodes:
                        display_name = source_name
                        if len(route_types) > 1:
                            display_name = f"{source_name}-{route_type}"
                        source_name_count[display_name] = source_name_count.get(display_name, 0) + 1
                        final_source_name = display_name if source_name_count[display_name] == 1 else f"{display_name}{source_name_count[display_name]}"
                        sources.append({"name": final_source_name, "episodes": route_episodes})
                if not videos:
                    await log("warn", f"[rrdynb][detail] skip empty drive source: {source_name} share={share_url}")
                    continue
            else:
                kind = "link"
                if share_url.startswith("magnet:"):
                    kind = "magnet"
                elif share_url.startswith("ed2k://"):
                    kind = "ed2k"
                fallback_name = f"资源{idx}"
                episodes = [{
                    "name": fallback_name,
                    "playId": json.dumps({"kind": kind, "url": share_url, "name": fallback_name}, ensure_ascii=False),
                }]
                source_name_count[source_name] = source_name_count.get(source_name, 0) + 1
                final_source_name = source_name if source_name_count[source_name] == 1 else f"{source_name}{source_name_count[source_name]}"
                sources.append({"name": final_source_name, "episodes": episodes})

        sources = sort_play_sources_by_drive_order(sources)
        if len(sources) > 1 and DRIVE_ORDER:
            await log("info", f"[rrdynb][detail] sorted sources: {' | '.join([item.get('name', '') for item in sources])}")

        item = {
            "vod_id": url,
            "vod_name": vod_name,
            "vod_pic": info.get("vod_pic", ""),
            "vod_content": info.get("vod_content", ""),
            "vod_director": info.get("vod_director", ""),
            "vod_actor": info.get("vod_actor", ""),
            "vod_area": info.get("vod_area", ""),
            "vod_year": info.get("vod_year", ""),
            "vod_remarks": info.get("vod_remarks", info.get("update_date", "")),
            "type_name": info.get("type_name", ""),
            "vod_play_sources": sources,
        }
        return {"list": [item]}
    except Exception as e:
        await log("error", f"[rrdynb][detail] {e}")
        return {"list": []}


async def play(params, context):
    try:
        raw_play_id = params.get("playId")
        flag = str(params.get("flag") or "")
        caller_source = resolve_caller_source(params, context)
        await log("info", f"[rrdynb][play] flag={flag} rawPlayId={raw_play_id}")
        meta = raw_play_id if isinstance(raw_play_id, dict) else json.loads(str(raw_play_id or "{}"))
        kind = str(meta.get("kind") or "")

        if kind in ("magnet", "ed2k", "link"):
            url = str(meta.get("url") or "").strip()
            return {"urls": [{"name": meta.get("name") or "原始链接", "url": url}], "flag": flag, "parse": 0}

        if kind == "drive-file":
            share_url = str(meta.get("shareURL") or "").strip()
            fid = str(meta.get("fid") or "").strip()
            route_type = resolve_route_type(str(meta.get("routeType") or flag or "直连"), caller_source, context)
            await log("info", f"[rrdynb][play] request sdk share={share_url} fid={fid} route={route_type}")
            play_info = await get_drive_video_play_info(share_url, fid, route_type)
            await log("info", f"[rrdynb][play] sdk type={type(play_info).__name__} has_urls={isinstance((play_info or {}).get('urls'), list) if isinstance(play_info, dict) else False} has_url={bool((play_info or {}).get('url')) if isinstance(play_info, dict) else False}")
            if isinstance(play_info, dict):
                urls = []
                urls_raw = play_info.get("urls")
                if isinstance(urls_raw, list):
                    for item in urls_raw:
                        if isinstance(item, dict):
                            item_url = str(item.get("url") or "").strip()
                            if item_url:
                                urls.append({"name": str(item.get("name") or meta.get("name") or "播放"), "url": item_url})
                        elif isinstance(item, str) and item.strip():
                            urls.append({"name": meta.get("name") or "播放", "url": item.strip()})
                url_raw = play_info.get("url")
                if isinstance(url_raw, list):
                    for item in url_raw:
                        if isinstance(item, dict):
                            item_url = str(item.get("url") or "").strip()
                            if item_url:
                                urls.append({"name": str(item.get("name") or meta.get("name") or "播放"), "url": item_url})
                        elif isinstance(item, str) and item.strip():
                            urls.append({"name": meta.get("name") or "播放", "url": item.strip()})
                elif isinstance(url_raw, str) and url_raw.strip():
                    urls.append({"name": meta.get("name") or "播放", "url": url_raw.strip()})

                deduped = []
                seen = set()
                for item in urls:
                    key = item.get("url")
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    deduped.append(item)

                if deduped:
                    return {
                        "urls": deduped,
                        "flag": flag or play_info.get("flag") or infer_drive_label(share_url),
                        "header": play_info.get("header") or play_info.get("headers") or {},
                        "parse": int(play_info.get("parse") or 0),
                        "danmaku": play_info.get("danmaku") or [],
                    }
            await log("warn", f"[rrdynb][play] sdk returned no playable url, fallback share={share_url} fid={fid}")
            return {"urls": [{"name": meta.get("name") or "原始分享", "url": share_url}], "flag": flag or infer_drive_label(share_url), "parse": 0}

        return {"urls": [], "flag": flag, "parse": 0}
    except Exception as e:
        await log("error", f"[rrdynb][play] {e}")
        return {"urls": [], "flag": str(params.get('flag') or ''), "parse": 0}


if __name__ == "__main__":
    run({"home": home, "category": category, "detail": detail, "search": search, "play": play})
