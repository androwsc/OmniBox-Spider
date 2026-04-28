// @name hsex
// @author 
// @version 1.6.0
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/hao.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");
const crypto = require("crypto");

const HOST = "https://hsex.tv";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

// 固定分类（带去重Key，用于合并多区数据时的去重标志）
const STATIC_CLASSES = [
  { type_id: "top7_list", type_name: "周榜热门" },
  { type_id: "top_list",  type_name: "月榜热门" },
  { type_id: "5min_list",type_name: "5分钟+"    },
  { type_id: "long_list", type_name: "10分钟+"   }
];

// 搜索词分类（按关键词搜索，返回分页结果）
const SEARCH_CLASSES = [
  { type_id: "search_熟女", type_name: "熟女" },
  { type_id: "search_足疗", type_name: "足疗" }
];

const ALL_CLASSES = [...STATIC_CLASSES, ...SEARCH_CLASSES];

function getSafeCacheKey(prefix, key) {
  const fullKey = `${prefix}_${key}`;
  return fullKey.length > 64 ? crypto.createHash('md5').update(fullKey).digest('hex') : fullKey;
}

async function httpGet(path) {
  try {
    const url = path.startsWith("http") ? path : `${HOST}${path}`;
    const resp = await OmniBox.request(url, {
      headers: { "User-Agent": UA, "Referer": `${HOST}/` },
      timeout: 8000
    });
    return resp?.body || "";
  } catch (e) {
    return "";
  }
}

// 核心列表解析：自动去重 + 兼容style背景图
function parseList(html, seenIds = new Set()) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const list = [];

  $(".thumbnail").each((_, el) => {
    const $el = $(el);
    const $a = $el.find("a[href*='video-']").first();
    const href = $a.attr("href") || "";
    const idMatch = href.match(/video-(\d+)\.htm/);
    if (!idMatch) return;

    const id = idMatch[1];
    if (seenIds.has(id)) return;   // ← 关键：同区去重
    seenIds.add(id);

    let pic = "";
    const $img = $el.find("img");
    if ($img.attr("data-src")) {
      pic = $img.attr("data-src");
    } else {
      const style = $el.find(".image").attr("style") || "";
      const m = style.match(/url\(['"]?([^'")]+)['"]?\)/);
      if (m) pic = m[1];
    }

    list.push({
      vod_id: id,
      vod_name: $el.find(".caption h5 a").text().trim() || id,
      vod_pic: pic,
      vod_remarks: $el.find(".duration").text().trim() || ""
    });
  });

  return list;
}

async function home() {
  // 首页只取周榜、月榜、5分钟+、10分钟+ 各第一页
  // 不合并，只返回分类入口
  // 注意：页面"最热"+"最新"两个区域各有24个thumb，存在大量重复ID，
  // home()返回空list避免重复，由各分类入口提供干净数据
  return { class: ALL_CLASSES, list: [] };
}

// 静态分类（top7/top/5min/long）
const STATIC_PAGECOUNT = {
  top7_list: 10,
  top_list: 20,
  "5min_list": 3489,
  long_list: 3950
};

async function categoryStatic(tid, pg) {
  const cacheKey = getSafeCacheKey("hs_cat", `${tid}_${pg}`);
  const cached = await OmniBox.getCache(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const path = `/${tid}-${pg}.htm`;
  const html = await httpGet(path);
  const list = parseList(html);

  const pagecount = STATIC_PAGECOUNT[tid] || 10;
  const result = { list, page: pg, pagecount };

  if (list.length > 0) {
    await OmniBox.setCache(cacheKey, JSON.stringify(result), 600);
  }
  return result;
}

// 搜索词分类（熟女、足疗）
async function categorySearch(tid, pg) {
  // tid 格式: search_熟女 → 提取关键词
  const keyword = decodeURIComponent(tid.replace("search_", ""));
  const cacheKey = getSafeCacheKey("hs_tag", `${keyword}_${pg}`);
  const cached = await OmniBox.getCache(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  // 搜索结果页 URL 格式: /search-N.htm?search=...&sort=new&page=1
  const path = `/search-${pg}.htm?search=${encodeURIComponent(keyword)}&sort=new&page=1`;
  const html = await httpGet(path);
  const list = parseList(html);

  // 从分页导航中解析总页数（最后一页链接如 search-1354.htm）
  let pagecount = pg + 1;
  const allMatches = [...html.matchAll(/search-(\d+)\.htm\?search=/g)];
  if (allMatches.length > 0) {
    const nums = allMatches.map(m => parseInt(m[1], 10));
    pagecount = Math.max(...nums);
  }

  const result = { list, page: pg, pagecount };

  if (list.length > 0) {
    await OmniBox.setCache(cacheKey, JSON.stringify(result), 300);
  }
  return result;
}

async function category(params) {
  const tid = (params.tid || params.t || params.categoryId || params.id || "list").toString();
  const pg = Math.max(1, parseInt(params.pg || params.page || 1));

  if (/^\d+$/.test(tid)) return detail({ id: tid });

  if (tid.startsWith("search_")) {
    return categorySearch(tid, pg);
  }
  return categoryStatic(tid, pg);
}

async function detail(params) {
  let id = params.videoId || params.id || params.ids || "";
  if (typeof id === "string" && id.includes(",")) id = id.split(",")[0];
  if (Array.isArray(id)) id = id[0];
  if (!id) return { list: [] };

  const cacheKey = getSafeCacheKey("hs_det", id);
  const cached = await OmniBox.getCache(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const pageUrl = `${HOST}/video-${id}.htm`;
  const html = await httpGet(pageUrl);
  if (!html) return { list: [] };

  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr("content") || $("title").text().split("-")[0].trim();
  const pic = $("meta[property='og:image']").attr("content") || "";

  let m3u8Url = "";
  const m = html.match(/(https:\/\/(?:cdn|cdn1|shark)\.hdcdn\.online\/[^\s"'<>]+\/hls\/[^\/]+\/index\.m3u8)/);
  if (m) m3u8Url = m[1];

  if (!m3u8Url) {
    try {
      const sniff = await OmniBox.sniffVideo(pageUrl, {
        "User-Agent": UA,
        "Referer": `${HOST}/`
      });
      if (sniff?.url) {
        m3u8Url = sniff.url;
        OmniBox.log("info", `嗅探: ${m3u8Url.substring(0, 80)}`);
      }
    } catch (e) {
      OmniBox.log("warn", `嗅探: ${e.message}`);
    }
  }

  const result = {
    list: [{
      vod_id: id,
      vod_name: title || id,
      vod_pic: pic,
      vod_content: $("meta[property='og:description']").attr("content") || "",
      vod_play_sources: [{
        name: "HSex云播",
        episodes: [{ name: "高清播放", playId: m3u8Url || pageUrl }]
      }]
    }]
  };

  if (m3u8Url || title) {
    await OmniBox.setCache(cacheKey, JSON.stringify(result), 3600);
  }
  return result;
}

async function search(params) {
  const wd = (params.keyword || params.wd || "").trim();
  if (!wd) return { list: [] };

  const cacheKey = getSafeCacheKey("hs_sch", wd);
  const cached = await OmniBox.getCache(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const html = await httpGet(`/search.htm?search=${encodeURIComponent(wd)}&sort=new`);
  const result = { list: parseList(html) };

  if (result.list.length > 0) {
    await OmniBox.setCache(cacheKey, JSON.stringify(result), 300);
  }
  return result;
}

async function play(params) {
  const input = params.playId || params.url || "";
  const header = {
    "User-Agent": UA,
    "Referer": `${HOST}/`,
    "Accept": "*/*"
  };

  if (input.includes(".m3u8") || input.includes(".mp4")) {
    return { urls: [{ name: "极速直链", url: input }], parse: 0, header };
  }
  return { urls: [{ name: "兼容解析", url: input }], parse: 1, header };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
