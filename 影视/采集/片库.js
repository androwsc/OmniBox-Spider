// @name 片库
// @author OpenClaw Taizi
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/片库.js

/**
 * ============================================================================
 * 片库 (PIANKU)
 * https://pianku.pro
 *
 * 功能特性：
 * - 刮削：支持（集成 OmniBox 刮削元数据）
 * - 弹幕：支持（通过弹幕 API 匹配）
 * - 嗅探：支持（优先直取 player_aaaa.url，失败则嗅探）
 * - 搜索：站点存在验证码时支持 OCR 识别、会话缓存与 API 聚合搜索兜底
 * ============================================================================
 */
const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

const host = "https://pianku.pro";
const DANMU_API = process.env.DANMU_API || "";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const OCR_API = "https://api.nn.ci/ocr/b64/json";
const CATEGORY_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "连续剧" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
  { type_id: "30", type_name: "短剧" },
  { type_id: "23", type_name: "情色" }
];
const DEFAULT_BLOCKED_CATEGORIES = ["情色"];
const ENV_BLOCKED_CATEGORIES = String(process.env.CATEGORY_BLOCKLIST || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const BLOCKED_CATEGORIES = new Set([
  ...DEFAULT_BLOCKED_CATEGORIES.map((s) => String(s).trim().toLowerCase()),
  ...ENV_BLOCKED_CATEGORIES
]);
let SESSION_CACHE = {
  cookie: null,
  expire: 0
};
const SESSION_TTL = 20 * 60 * 1000;

const baseHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Referer": host + "/",
  "Origin": host,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
};

const axiosInstance = axios.create({
  timeout: 15000,
  headers: baseHeaders,
  validateStatus: () => true
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isCategoryBlocked = (typeId = "", typeName = "") => {
  const id = String(typeId || "").trim().toLowerCase();
  const name = String(typeName || "").trim().toLowerCase();
  if (!id && !name) return false;
  return BLOCKED_CATEGORIES.has(id) || BLOCKED_CATEGORIES.has(name);
};

const filterCategories = (categories = []) => {
  return (categories || []).filter((item) => !isCategoryBlocked(item?.type_id, item?.type_name));
};

const getCategoryNameById = (categoryId = "") => {
  const hit = CATEGORY_LIST.find((item) => String(item.type_id) === String(categoryId));
  return hit?.type_name || "";
};

const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[PIANKU-DEBUG] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[PIANKU-DEBUG] ${message}: ${error?.message || error}`);
};

const encodeMeta = (obj) => {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
};

const decodeMeta = (str) => {
  try {
    const raw = Buffer.from(str || "", "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

const fixUrl = (url) => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  return url.startsWith("/") ? `${host}${url}` : `${host}/${url}`;
};

const requestHtml = async (url, options = {}) => {
  try {
    const res = await axiosInstance.get(url, {
      headers: {
        ...baseHeaders,
        ...(options.headers || {})
      },
      responseType: "text",
      ...options
    });
    return typeof res.data === "string" ? res.data : "";
  } catch (e) {
    logError("请求失败", e);
    return "";
  }
};

const processImageUrl = (imageUrl, baseURL = "") => {
  if (!imageUrl) return "";
  let url = fixUrl(imageUrl);
  const isExternalUrl = !url.includes("pianku.pro") && url.startsWith("http");
  if (isExternalUrl && baseURL) {
    try {
      const referer = url.includes("pianku.info") ? "https://pianku.info" : host;
      const urlWithHeaders = `${url}@Referer=${referer}`;
      return `${baseURL}/api/proxy/image?url=${encodeURIComponent(urlWithHeaders)}`;
    } catch {
      return url;
    }
  }
  return url;
};

const parseVideoList = ($, baseURL = "") => {
  const list = [];
  $("ul.content-list li, ul.content-list2 li, .indexShowBox li").each((_, element) => {
    const $item = $(element);
    const $link = $item.find(".li-img a, a.pic_link, h3 a").first();
    const href = $link.attr("href");
    const title = $link.attr("title") || $item.find("h3 a").attr("title") || $item.find("h3 a").text().trim();
    const pic = $item.find("img").attr("data-original") || $item.find("img").attr("data-src") || $item.find("img").attr("src") || "";
    const remarks = $item.find(".bottom2").text().trim() || $item.find(".tag").first().text().trim() || "";

    if (title && href) {
      list.push({
        vod_id: href,
        vod_name: title,
        vod_pic: pic,
        vod_remarks: remarks
      });
    }
  });
  return list;
};

function extractEpisode(title) {
  if (!title) return "";
  const processedTitle = String(title).trim();
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];
  const cnMatch = processedTitle.match(/第\s*([0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return cnMatch[1];
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];
  const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }
  return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") return vodName;
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) return `${vodName} S01E${String(epNum).padStart(2, "0")}`;
  }
  return vodName;
}

const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) return originalName;
  if (mapping.episodeName) {
    const epName = mapping.episodeNumber + "." + mapping.episodeName;
    return epName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) return `${hit.episodeNumber}.${hit.name}`;
  }
  return originalName;
};

const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
  if (!scrapeData) return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  if (scrapeType === "movie") return scrapeData.title || fallbackVodName;
  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
};

async function matchDanmu(fileName) {
  if (!DANMU_API || !fileName) return [];
  try {
    logInfo(`匹配弹幕: ${fileName}`);
    const matchUrl = `${DANMU_API}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify({ fileName })
    });

    if (response.statusCode !== 200) return [];
    const matchData = JSON.parse(response.body || "{}");
    if (!matchData.isMatched || !Array.isArray(matchData.matches) || matchData.matches.length === 0) return [];

    const firstMatch = matchData.matches[0];
    const episodeId = firstMatch.episodeId;
    if (!episodeId) return [];

    let danmakuName = "弹幕";
    if (firstMatch.animeTitle && firstMatch.episodeTitle) {
      danmakuName = `${firstMatch.animeTitle} - ${firstMatch.episodeTitle}`;
    } else if (firstMatch.animeTitle) {
      danmakuName = firstMatch.animeTitle;
    } else if (firstMatch.episodeTitle) {
      danmakuName = firstMatch.episodeTitle;
    }

    return [{
      name: danmakuName,
      url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`
    }];
  } catch (e) {
    logInfo(`弹幕匹配失败: ${e.message}`);
    return [];
  }
}

async function sniffPlay(playUrl) {
  if (!playUrl) return null;
  try {
    const sniffed = await OmniBox.sniffVideo(playUrl);
    if (sniffed && sniffed.url) {
      return {
        urls: [{ name: "嗅探线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || baseHeaders
      };
    }
  } catch (e) {
    logInfo(`嗅探失败: ${e.message}`);
  }
  return null;
}

async function home(params, context) {
  const baseURL = context?.baseURL || "";
  const html = await requestHtml(host + "/");
  const $ = cheerio.load(html || "");
  const list = parseVideoList($, baseURL).slice(0, 60);
  return {
    list,
    class: filterCategories(CATEGORY_LIST)
  };
}

async function category(params, context) {
  const { categoryId, page } = params;
  const pg = parseInt(page) || 1;
  const baseURL = context?.baseURL || "";

  if (isCategoryBlocked(categoryId, getCategoryNameById(categoryId))) {
    logInfo(`分类已屏蔽: ${categoryId}`);
    return { list: [], page: pg, pagecount: pg };
  }

  const url = pg <= 1 ? `${host}/vodtype/${categoryId}.html` : `${host}/vodtype/${categoryId}-${pg}.html`;

  try {
    const html = await requestHtml(url);
    const $ = cheerio.load(html || "");
    const list = parseVideoList($, baseURL);
    return { list, page: pg, pagecount: list.length >= 20 ? pg + 1 : pg };
  } catch (e) {
    logError("分类获取失败", e);
    return { list: [], page: pg, pagecount: 0 };
  }
}

function calcVerifyCode(text) {
  if (!text) return null;
  let exp = String(text).replace(/\s/g, "").replace(/=/g, "");
  exp = exp.replace(/[xX×]/g, "*").replace(/－/g, "-").replace(/—/g, "-");
  const match = exp.match(/^(\d+)([+\-*])(\d+)$/);
  if (!match) return null;
  const a = parseInt(match[1], 10);
  const op = match[2];
  const b = parseInt(match[3], 10);
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  return null;
}

function parseSearchResults(html, baseURL, pg, keyword = "") {
  if (!html) return { list: [], page: pg, pagecount: pg, total: 0 };
  const $ = cheerio.load(html || "");
  const list = [];
  const seen = new Set();
  const kw = String(keyword || "").trim();

  const pushItem = (href, title, pic, remarks = "") => {
    const vod_id = href || "";
    const vod_name = String(title || "").replace(/\s+/g, " ").trim();
    if (!vod_id || !vod_name || seen.has(vod_id)) return;
    if (kw && !vod_name.includes(kw)) return;
    seen.add(vod_id);
    list.push({
      vod_id,
      vod_name,
      vod_pic: pic,
      vod_remarks: remarks || ""
    });
  };

  $("a[href*='/video/']").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const title = $a.attr("title") || $a.text().trim() || $a.find("img").attr("alt") || "";
    const $item = $a.closest("li, .public-list-box, .content-list li, .search-list li, .module-card-item, .result-item, .video-item, .list-item, .col");
    const pic = $item.find("img").first().attr("data-original") || $item.find("img").first().attr("data-src") || $item.find("img").first().attr("src") || $a.find("img").attr("src") || "";
    const remarks = $item.find(".bottom2, .tag, .remarks, .pic-text, .public-list-prb").first().text().trim() || "";
    pushItem(href, title, pic, remarks);
  });

  let pagecount = pg;
  const pages = $(".pagination li a, .page a, .stui-page a")
    .map((_, a) => $(a).text().trim())
    .get()
    .filter((t) => /^\d+$/.test(t));
  if (pages.length > 0) pagecount = parseInt(pages[pages.length - 1], 10) || pg;
  else if (list.length > 0) pagecount = pg + 1;

  return { list, page: pg, pagecount, total: list.length };
}


async function aggregateApiSearch(keyword, baseURL, pg) {
  if (!keyword) return { list: [], page: pg, pagecount: pg, total: 0 };
  try {
    const searchUrl = `https://www.ymck.pro/API/v2.php?q=${encodeURIComponent(keyword)}&size=50`;
    const base64Data = await requestHtml(searchUrl, {
      headers: {
        ...baseHeaders,
        "Referer": host + "/"
      }
    });
    if (!base64Data) return { list: [], page: pg, pagecount: pg, total: 0 };

    let decodedStr = "";
    try {
      decodedStr = Buffer.from(String(base64Data).trim(), "base64").toString("utf8");
    } catch (e) {
      logError("聚合搜索Base64解码失败", e);
      return { list: [], page: pg, pagecount: pg, total: 0 };
    }

    let searchResults = [];
    try {
      searchResults = JSON.parse(decodedStr) || [];
    } catch (e) {
      logError("聚合搜索JSON解析失败", e);
      return { list: [], page: pg, pagecount: pg, total: 0 };
    }

    if (!Array.isArray(searchResults)) {
      logInfo("聚合搜索返回非数组");
      return { list: [], page: pg, pagecount: pg, total: 0 };
    }

    const targetSites = ["片库", "pianku", "片库网"];
    const list = [];
    const seen = new Set();

    for (const item of searchResults) {
      if (!item || typeof item !== 'object') continue;
      const website = String(item.website || '');
      const url = String(item.url || '');
      if (!url) continue;
      if (!targetSites.some(name => website.toLowerCase().includes(String(name).toLowerCase()))) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).join(' ') : '';
      list.push({
        vod_id: url,
        vod_name: item.text || keyword,
        vod_pic: item.icon,
        vod_remarks: tags
      });
    }

    logInfo(`聚合搜索命中: ${list.length}条`);
    return { list, page: 1, pagecount: list.length, total: list.length };
  } catch (e) {
    logError("聚合搜索异常", e);
    return { list: [], page: pg, pagecount: pg, total: 0 };
  }
}

async function getVerifyCode(cookie, refererUrl) {
  for (let i = 1; i <= 3; i++) {
    try {
      logInfo(`获取验证码第${i}次`);
      const imgRes = await axiosInstance.get(`${host}/index.php/verify/index.html?type=search&t=${Date.now()}`, {
        headers: {
          "User-Agent": MOBILE_UA,
          "Cookie": cookie,
          "Referer": refererUrl
        },
        responseType: "arraybuffer"
      });
      if (!imgRes.data) continue;
      const b64 = Buffer.from(imgRes.data).toString("base64");
      const ocrRes = await axios.post(OCR_API, b64, {
        headers: { "User-Agent": MOBILE_UA },
        timeout: 8000,
        validateStatus: () => true
      });
      const raw = String(ocrRes.data?.result || "").trim();
      logInfo(`OCR识别: ${raw}`);
      return raw;
    } catch (e) {
      logInfo(`OCR异常: ${e.message}`);
    }
  }
  return null;
}

async function search(params, context) {
  const wd = params.keyword || params.wd || "";
  const pg = parseInt(params.page) || 1;
  const baseURL = context?.baseURL || "";
  const keyword = String(wd || "").trim();
  if (!keyword) return { list: [], page: pg, pagecount: pg, total: 0 };

  const url = `${host}/vs/-------------.html?wd=${encodeURIComponent(keyword)}`;
  const now = Date.now();

  if (SESSION_CACHE.cookie && now < SESSION_CACHE.expire) {
    try {
      logInfo("使用缓存会话搜索");
      const fastRes = await axiosInstance.get(url, {
        headers: {
          ...baseHeaders,
          "User-Agent": MOBILE_UA,
          "Cookie": SESSION_CACHE.cookie
        }
      });
      const fastHtml = typeof fastRes.data === "string" ? fastRes.data : "";
      const result = parseSearchResults(fastHtml, baseURL, pg, keyword);
      if (result.list.length > 0) return result;
      if (fastHtml && !fastHtml.includes("系统安全验证") && !fastHtml.includes("请输入验证码")) {
        logInfo("缓存会话搜索无结果，直接返回空列表");
        return result;
      }
      logInfo("缓存会话失效，重新走验证码流程");
    } catch (e) {
      logError("缓存搜索失败", e);
    }
  }

  for (let flow = 1; flow <= 5; flow++) {
    try {
      logInfo(`第${flow}轮验证码流程`);
      const initRes = await axiosInstance.get(url, {
        headers: {
          ...baseHeaders,
          "User-Agent": MOBILE_UA
        }
      });
      const initHtml = typeof initRes.data === "string" ? initRes.data : "";
      const rawCookies = initRes.headers["set-cookie"] || [];
      const cookieStr = rawCookies.map((c) => c.split(";")[0]).join("; ");
      const finalCookie = ["gg_iscookie=1", cookieStr].filter(Boolean).join("; ");

      if (initHtml && !initHtml.includes("系统安全验证") && !initHtml.includes("请输入验证码")) {
        const directResult = parseSearchResults(initHtml, baseURL, pg, keyword);
        if (directResult.list.length > 0) {
          SESSION_CACHE.cookie = finalCookie || SESSION_CACHE.cookie;
          SESSION_CACHE.expire = Date.now() + SESSION_TTL;
          return directResult;
        }
      }

      const verifyCode = await getVerifyCode(finalCookie, url);
      if (verifyCode === null) continue;

      const verifyUrl = `${host}/index.php/ajax/verify_check?type=search&verify=${encodeURIComponent(verifyCode)}`;
      const verifyRes = await axiosInstance.post(verifyUrl, "", {
        headers: {
          ...baseHeaders,
          "User-Agent": MOBILE_UA,
          "Cookie": finalCookie,
          "Referer": url,
          "X-Requested-With": "XMLHttpRequest"
        }
      });

      const verifyData = typeof verifyRes.data === "string"
        ? (() => { try { return JSON.parse(verifyRes.data); } catch { return {}; } })()
        : (verifyRes.data || {});

      logInfo(`验证码响应: ${JSON.stringify(verifyData)}`);

      if (verifyData.code !== 1) {
        logInfo(`验证码校验失败: ${verifyData.msg || verifyRes.status}`);
        continue;
      }

      await sleep(1000);

      const searchRes = await axiosInstance.get(url, {
        headers: {
          ...baseHeaders,
          "User-Agent": MOBILE_UA,
          "Cookie": finalCookie,
          "Referer": url
        }
      });

      const searchHtml = typeof searchRes.data === "string" ? searchRes.data : "";
      const result = parseSearchResults(searchHtml, baseURL, pg, keyword);

      logInfo(`搜索响应: ${JSON.stringify(result)}`);

      if (result.list.length > 0) {
        SESSION_CACHE.cookie = finalCookie;
        SESSION_CACHE.expire = Date.now() + SESSION_TTL;
        return result;
      }

      if (searchHtml && !searchHtml.includes("系统安全验证") && !searchHtml.includes("请输入验证码")) {
        SESSION_CACHE.cookie = finalCookie;
        SESSION_CACHE.expire = Date.now() + SESSION_TTL;
        logInfo("验证码通过且已进入搜索页，当前关键词无结果，停止重试");
        return result;
      }
    } catch (e) {
      logError("搜索流程异常", e);
    }
  }

  logInfo("搜索未命中，返回空结果");
  return { list: [], page: pg, pagecount: pg, total: 0 };
}

async function detail(params, context) {
  const videoId = params.videoId;
  const url = fixUrl(videoId);
  const baseURL = context?.baseURL || "";

  try {
    const html = await requestHtml(url);
    const $ = cheerio.load(html || "");

    const title = $(".main-ui-meta h1").clone().children().remove().end().text().trim() || $("title").text().split("线上看")[0].trim();
    let pic = $(".main-left-1 .img img").attr("src") || "";
    const desc = $(".movie-introduce .zkjj_a").text().replace("[展开全部]", "").trim() || $("meta[name='description']").attr("content") || "";
    const year = $(".main-ui-meta .year").text().replace(/[()]/g, "").trim();

    const director = $(".main-ui-meta div")
      .filter((_, el) => $(el).text().includes("导演："))
      .find("a")
      .map((_, a) => $(a).text().trim())
      .get()
      .join(",");

    const actor = $(".main-ui-meta div.text-overflow a")
      .map((_, a) => $(a).text().trim())
      .get()
      .join(",");

    const typeName = $(".main-ui-meta div")
      .filter((_, el) => $(el).text().includes("类型："))
      .find("a")
      .map((_, a) => $(a).text().trim())
      .get()
      .join(",");

    const area = $(".main-ui-meta div")
      .filter((_, el) => $(el).text().includes("地区："))
      .find("a")
      .map((_, a) => $(a).text().trim())
      .get()
      .join(",");

    pic = pic;

    const playSources = [];
    const $tabs = $(".py-tabs li");
    const $playlists = $("#url .bd ul.player");

    if ($playlists.length) {
      $playlists.each((idx, ul) => {
        const sourceName = $tabs.eq(idx).clone().children().remove().end().text().trim() || `线路${idx + 1}`;
        const episodes = [];
        $(ul).find("li a").each((i, a) => {
          const name = $(a).text().trim() || `第${i + 1}集`;
          const href = $(a).attr("href") || "";
          const fid = `${videoId}#${idx}#${i}`;
          const combinedId = `${href}|||${encodeMeta({ sid: String(videoId || ""), fid, v: title || "", e: name })}`;
          episodes.push({ name, playId: combinedId, _fid: fid, _rawName: name });
        });
        if (episodes.length) playSources.push({ name: sourceName, episodes });
      });
    }

    const scrapeCandidates = [];
    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        if (!ep._fid) continue;
        scrapeCandidates.push({
          fid: ep._fid,
          file_id: ep._fid,
          file_name: ep._rawName || ep.name || "正片",
          name: ep._rawName || ep.name || "正片",
          format_type: "video"
        });
      }
    }

    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";

    if (scrapeCandidates.length > 0) {
      try {
        const videoIdForScrape = String(videoId || "");
        await OmniBox.processScraping(videoIdForScrape, title || "", title || "", scrapeCandidates);
        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
        logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
      } catch (error) {
        logError("刮削处理失败", error);
      }
    }

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
        if (!mapping) continue;
        const oldName = ep.name;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
        if (newName && newName !== oldName) ep.name = newName;
        ep._seasonNumber = mapping.seasonNumber;
        ep._episodeNumber = mapping.episodeNumber;
      }

      const hasEpisodeNumber = (source.episodes || []).some((ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null);
      if (hasEpisodeNumber) {
        source.episodes.sort((a, b) => {
          const seasonA = a._seasonNumber || 0;
          const seasonB = b._seasonNumber || 0;
          if (seasonA !== seasonB) return seasonA - seasonB;
          const episodeA = a._episodeNumber || 0;
          const episodeB = b._episodeNumber || 0;
          return episodeA - episodeB;
        });
      }
    }

    const vod = {
      vod_id: videoId,
      vod_name: title,
      vod_pic: pic,
      vod_content: desc,
      vod_year: year,
      vod_director: director,
      vod_actor: actor,
      vod_area: area,
      vod_class: typeName,
      vod_play_sources: playSources.map((source) => ({
        name: source.name,
        episodes: (source.episodes || []).map((ep) => ({
          name: ep.name,
          playId: ep.playId
        }))
      }))
    };

    if (scrapeData) {
      vod.vod_name = scrapeData.title || vod.vod_name;
      if (scrapeData.posterPath) {
        vod.vod_pic = processImageUrl(`https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`, baseURL);
      }
      if (scrapeData.overview) vod.vod_content = scrapeData.overview;
      if (scrapeData.releaseDate) vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year;

      const actors = (scrapeData.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",");
      if (actors) vod.vod_actor = actors;

      const directors = (scrapeData.credits?.crew || [])
        .filter((c) => c?.job === "Director" || c?.department === "Directing")
        .slice(0, 3)
        .map((c) => c?.name)
        .filter(Boolean)
        .join(",");
      if (directors) vod.vod_director = directors;

      if (scrapeData.genres?.length) {
        vod.vod_class = scrapeData.genres.map((g) => g?.name).filter(Boolean).join(",");
      }
    }

    return { list: [vod] };
  } catch (e) {
    logError("详情获取失败", e);
    return { list: [] };
  }
}

async function play(params) {
  let playId = params.playId;
  const flag = params.flag || "";
  let vodName = params.vodName || "";
  let episodeName = params.episodeName || "";
  let playMeta = {};

  if (playId && playId.includes("|||")) {
    const [mainPlayId, metaB64] = playId.split("|||");
    playId = mainPlayId;
    playMeta = decodeMeta(metaB64 || "");
    vodName = playMeta.v || vodName;
    episodeName = playMeta.e || episodeName;
  }

  let scrapedDanmuFileName = "";
  try {
    const videoIdFromParam = params.vodId ? String(params.vodId) : "";
    const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
    const videoIdForScrape = videoIdFromParam || videoIdFromMeta;
    if (videoIdForScrape) {
      const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
      if (metadata && metadata.scrapeData) {
        const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
        scrapedDanmuFileName = buildScrapedDanmuFileName(
          metadata.scrapeData,
          metadata.scrapeType || "",
          mapping,
          vodName,
          episodeName
        );
        if (metadata.scrapeData.title) vodName = metadata.scrapeData.title;
        if (mapping?.episodeName) episodeName = mapping.episodeName;
      }
    }
  } catch (error) {
    logInfo(`读取刮削元数据失败: ${error.message}`);
  }

  try {
    const playPageUrl = fixUrl(playId);
    const html = await requestHtml(playPageUrl);
    if (!html) {
      return {
        urls: [{ name: "解析失败", url: playPageUrl }],
        parse: 1,
        header: baseHeaders
      };
    }

    const playerMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
    if (playerMatch && playerMatch[1]) {
      const clean = playerMatch[1].replace(/<\/script>$/i, "");
      const playerData = JSON.parse(clean);
      const realUrl = playerData.url || "";
      if (realUrl && /^https?:\/\//.test(realUrl)) {
        const result = {
          urls: [{ name: flag || playerData.from || "直连", url: realUrl.replace(/\\\//g, "/") }],
          parse: 0,
          header: {
            Referer: host + "/",
            "User-Agent": baseHeaders["User-Agent"]
          }
        };
        if (DANMU_API && vodName) {
          const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
          const danmaku = await matchDanmu(fileName);
          if (danmaku.length) result.danmaku = danmaku;
        }
        return result;
      }
    }

    const urlMatch = html.match(/"url"\s*:\s*"(https?:\\\/\\\/[^"]+?\.m3u8[^"]*)"/i);
    if (urlMatch && urlMatch[1]) {
      const result = {
        urls: [{ name: flag || "直连", url: urlMatch[1].replace(/\\\//g, "/") }],
        parse: 0,
        header: {
          Referer: host + "/",
          "User-Agent": baseHeaders["User-Agent"]
        }
      };
      if (DANMU_API && vodName) {
        const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
        const danmaku = await matchDanmu(fileName);
        if (danmaku.length) result.danmaku = danmaku;
      }
      return result;
    }

    const sniffed = await sniffPlay(playPageUrl);
    if (sniffed) {
      if (DANMU_API && vodName) {
        const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
        const danmaku = await matchDanmu(fileName);
        if (danmaku.length) sniffed.danmaku = danmaku;
      }
      return sniffed;
    }
  } catch (e) {
    logError("播放解析失败", e);
  }

  return {
    urls: [{ name: "解析失败", url: fixUrl(playId) }],
    parse: 1,
    header: baseHeaders
  };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
