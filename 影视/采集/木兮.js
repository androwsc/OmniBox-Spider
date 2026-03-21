// @name 木兮
// @author https://github.com/hjdhnx/drpy-node/blob/main/spider/js_dr2/%E6%9C%A8%E5%85%AE%5B%E4%BC%98%5D.js
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, crypto
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/木兮.js

/**
 * ============================================================================
 * 木兮资源 - OmniBox 爬虫脚本
 * 来源：dr2 规则转换（木兮[优].js）
 *
 * 特性：
 * - 接入系统动态鉴权（cookie + reportId/session/traceId）
 * - 支持分类、搜索、详情、播放
 * - 支持刮削元数据回填剧集标题
 * - 支持弹幕预热 + 播放地址嗅探
 * ============================================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const HOST = "https://film.symx.club";
const API_BASE = `${HOST}/api`;
const PAGE_SIZE = 15;
const SEARCH_PAGE_SIZE = 10;
const AUTH_REFRESH_MS = 20 * 60 * 1000;

const BASE_HEADERS = {
  "User-Agent": "SYMX_ANDROID",
  "x-platform": "android",
  Accept: "application/json, text/plain, */*",
};

const CLASS_LIST = [
  { type_id: "1", type_name: "电视剧" },
  { type_id: "2", type_name: "电影" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
  { type_id: "5", type_name: "短剧" },
];

const TYPE_MAP = {
  1: "电视剧",
  2: "电影",
  3: "综艺",
  4: "动漫",
  5: "短剧",
};

const httpClient = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
});

const authState = {
  cookie: "",
  reportId: "",
  session: "",
  traceId: "",
  updatedAt: 0,
};

/**
 * 日志工具
 */
const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[木兮] ${output}`);
};

const logWarn = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("warn", `[木兮] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[木兮] ${message}: ${error?.message || error}`);
};

/**
 * 编码/解码元数据（用于 playId 透传）
 */
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

/**
 * 对接口返回的十六进制字符串做异或解密
 */
const decryptHexXor = (hexData) => {
  const key = "0x1A2B3C4D5E6F7A8B9C";
  let output = "";
  const src = String(hexData || "");

  for (let i = 0; i < src.length; i += 2) {
    const hexChar = src.slice(i, i + 2);
    const intVal = parseInt(hexChar, 16);
    if (Number.isNaN(intVal)) {
      continue;
    }
    const charCode = intVal ^ key.charCodeAt((i / 2) % key.length);
    output += String.fromCharCode(charCode);
  }
  return output;
};

/**
 * 生成 13 位校验时间戳（兼容旧规则 gettime）
 */
const getChecksumTimestamp = (ts) => {
  const raw = String(ts || Date.now());
  const prefix = raw.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    const n = parseInt(prefix.charAt(i), 10);
    sum += Number.isNaN(n) ? 0 : n;
  }
  const checkDigit = sum % 10;
  return `${prefix}${checkDigit}`;
};

/**
 * 生成动态签名（兼容旧规则 i4e）
 */
const buildSign = (url, timestamp, session, traceId) => {
  const cleanUrl = String(url || "").split("?")[0];
  const path = cleanUrl.replace(`${API_BASE}`, "");
  const salt = `symx_${session}`;
  const mapObj = { p: path, t: String(timestamp), s: salt };

  let payload = String(traceId || "")
    .split("")
    .map((char) => mapObj[char] || "")
    .join("");

  payload = payload.replaceAll("1", "i").replaceAll("0", "o").replaceAll("5", "s");
  return crypto.createHmac("sha256", String(session || "")).update(payload).digest("hex");
};

const mergeCookie = (oldCookie, setCookieHeaders) => {
  const store = {};

  const appendCookiePair = (pairStr) => {
    const pair = String(pairStr || "").split(";")[0].trim();
    const index = pair.indexOf("=");
    if (index <= 0) return;
    const key = pair.slice(0, index).trim();
    const val = pair.slice(index + 1).trim();
    if (!key) return;
    store[key] = val;
  };

  String(oldCookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach(appendCookiePair);

  const cookieList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [];
  cookieList.forEach(appendCookiePair);

  return Object.entries(store)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
};

const buildHeaders = (extra = {}) => ({
  ...BASE_HEADERS,
  ...(authState.cookie ? { cookie: authState.cookie } : {}),
  ...extra,
});

/**
 * 初始化/刷新鉴权状态：
 * 1) /api/stats/track 获取 cookie
 * 2) /api/system/config 解密 reportId/session/traceId
 */
const ensureAuth = async (force = false) => {
  const hasAuth = authState.cookie && authState.reportId && authState.session && authState.traceId;
  const fresh = Date.now() - authState.updatedAt < AUTH_REFRESH_MS;
  if (!force && hasAuth && fresh) {
    return;
  }

  logInfo("刷新鉴权信息");

  const trackUrl = `${API_BASE}/stats/track`;
  const trackResp = await httpClient.get(trackUrl, {
    headers: buildHeaders({ referer: `${HOST}/m/index` }),
    validateStatus: (s) => s >= 200 && s < 500,
  });

  authState.cookie = mergeCookie(authState.cookie, trackResp?.headers?.["set-cookie"] || []);

  const configUrl = `${API_BASE}/system/config`;
  const configResp = await httpClient.get(configUrl, {
    headers: buildHeaders({ referer: `${HOST}/` }),
  });

  const data = configResp?.data?.data || {};
  authState.reportId = decryptHexXor(data.reportId || "");
  authState.session = decryptHexXor(data.session || "");
  authState.traceId = decryptHexXor(data.traceId || "");
  authState.updatedAt = Date.now();

  if (!authState.reportId || !authState.session || !authState.traceId) {
    throw new Error("鉴权参数初始化失败");
  }

  logInfo("鉴权刷新完成", {
    cookieReady: Boolean(authState.cookie),
    reportIdLen: authState.reportId.length,
    sessionLen: authState.session.length,
    traceIdLen: authState.traceId.length,
  });
};

/**
 * 带签名 GET 请求
 */
const signedGet = async (url, options = {}) => {
  const { timestampMode = "raw", referer = HOST } = options;
  await ensureAuth();

  const now = Date.now();
  const timestamp = timestampMode === "checksum" ? getChecksumTimestamp(now) : String(now);
  const sign = buildSign(url, timestamp, authState.session, authState.traceId);

  const headers = buildHeaders({
    [authState.reportId]: sign,
    "x-timestamp": timestamp,
    referer,
  });

  logInfo("签名请求", { url, timestampMode, referer });
  return httpClient.get(url, { headers });
};

const normalizePic = (url) => {
  const pic = String(url || "").trim();
  if (!pic) return "";
  if (pic.startsWith("http://") || pic.startsWith("https://")) return pic;
  if (pic.startsWith("//")) return `https:${pic}`;
  if (pic.startsWith("/")) return `${HOST}${pic}`;
  return `${HOST}/${pic}`;
};

const parseFilmItem = (item) => ({
  vod_id: String(item?.id || ""),
  vod_name: String(item?.name || ""),
  vod_pic: normalizePic(item?.cover),
  vod_remarks: String(item?.updateStatus || ""),
  vod_content: String(item?.blurb || ""),
});

const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  if (mapping.episodeName) {
    const epName = mapping.episodeNumber + "." + mapping.episodeName;
    return epName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) {
      return `${hit.episodeNumber}.${hit.name}`;
    }
  }
  return originalName;
};

// ========== 接口实现 ==========

async function home() {
  logInfo("进入首页");
  const result = { class: CLASS_LIST, list: [] };

  try {
    await ensureAuth();
    const url = `${API_BASE}/film/category`;
    const resp = await httpClient.get(url, { headers: buildHeaders({ referer: `${HOST}/` }) });
    const categories = Array.isArray(resp?.data?.data) ? resp.data.data : [];

    const dedupe = new Map();
    categories.forEach((category) => {
      (category?.filmList || []).forEach((item) => {
        const id = String(item?.id || "");
        if (!id || dedupe.has(id)) return;
        dedupe.set(id, parseFilmItem(item));
      });
    });

    result.list = Array.from(dedupe.values());
    logInfo("首页获取完成", { count: result.list.length });
  } catch (error) {
    logError("首页获取失败", error);
  }

  return result;
}

async function category(params) {
  const categoryId = String(params?.categoryId || "1");
  const page = Math.max(1, parseInt(params?.page, 10) || 1);
  const ext = params?.extend || params?.filters || {};

  logInfo("请求分类", { categoryId, page, ext });

  try {
    await ensureAuth();

    const query = new URLSearchParams({
      categoryId,
      language: String(ext?.lang || ""),
      pageNum: String(page),
      pageSize: String(PAGE_SIZE),
      sort: String(ext?.by || "updateTime"),
      year: String(ext?.year || ""),
    });

    const url = `${API_BASE}/film/category/list?${query.toString()}`;
    const resp = await httpClient.get(url, {
      headers: buildHeaders({ referer: `${HOST}/m/category?categoryId=${encodeURIComponent(categoryId)}` }),
    });

    const list = (resp?.data?.data?.list || []).map(parseFilmItem);
    const hasMore = list.length >= PAGE_SIZE;

    logInfo("分类获取完成", { categoryId, page, count: list.length });
    return {
      list,
      page,
      pagecount: hasMore ? page + 1 : page,
    };
  } catch (error) {
    logError("分类获取失败", error);
    return { list: [], page, pagecount: 0 };
  }
}

async function search(params) {
  const keyword = String(params?.keyword || params?.wd || "").trim();
  const page = Math.max(1, parseInt(params?.page, 10) || 1);
  logInfo("执行搜索", { keyword, page });

  if (!keyword) {
    return { list: [], page, pagecount: 0 };
  }

  try {
    const query = new URLSearchParams({
      keyword,
      pageNum: String(page),
      pageSize: String(SEARCH_PAGE_SIZE),
    });
    const url = `${API_BASE}/film/search?${query.toString()}`;
    const referer = `${HOST}/m/search?keyword=${encodeURIComponent(keyword)}`;

    const resp = await signedGet(url, { timestampMode: "checksum", referer });
    const list = (resp?.data?.data?.list || []).map(parseFilmItem);
    const hasMore = list.length >= SEARCH_PAGE_SIZE;

    logInfo("搜索完成", { keyword, page, count: list.length });
    return {
      list,
      page,
      pagecount: hasMore ? page + 1 : page,
    };
  } catch (error) {
    logError("搜索失败", error);
    return { list: [], page, pagecount: 0 };
  }
}

async function detail(params) {
  const videoId = String(params?.videoId || "").trim();
  logInfo("请求详情", { videoId });

  if (!videoId) {
    return { list: [] };
  }

  try {
    const url = `${API_BASE}/film/detail/play?filmId=${encodeURIComponent(videoId)}`;
    const resp = await signedGet(url, { timestampMode: "raw", referer: HOST });
    const data = resp?.data?.data;

    if (!data) {
      logWarn("详情数据为空", { videoId });
      return { list: [] };
    }

    const playSources = [];
    const scrapeCandidates = [];

    (data.playLineList || []).forEach((line, lineIndex) => {
      const sourceName = String(line?.playerName || `线路${lineIndex + 1}`);
      const episodes = [];

      (line?.lines || []).forEach((ep, epIndex) => {
        const episodeName = String(ep?.name || `第${epIndex + 1}集`);
        const lineId = String(ep?.id || "");
        if (!lineId) return;

        const fid = `${videoId}#${lineIndex}#${epIndex}`;
        const meta = encodeMeta({
          sid: videoId,
          cid: String(data?.categoryId || ""),
          fid,
          e: episodeName,
          lineId,
        });

        episodes.push({
          name: episodeName,
          playId: `${lineId}|||${meta}`,
          _fid: fid,
          _rawName: episodeName,
        });

        scrapeCandidates.push({
          fid,
          file_id: fid,
          file_name: episodeName,
          name: episodeName,
          format_type: "video",
        });
      });

      if (episodes.length > 0) {
        playSources.push({ name: sourceName, episodes });
      }
    });

    let scrapeData = null;
    let videoMappings = [];

    if (scrapeCandidates.length > 0) {
      try {
        await OmniBox.processScraping(videoId, data?.name || "", data?.name || "", scrapeCandidates);
        const metadata = await OmniBox.getScrapeMetadata(videoId);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        logInfo("刮削元数据获取完成", { mappingCount: videoMappings.length, hasScrapeData: Boolean(scrapeData) });
      } catch (error) {
        logWarn("刮削流程失败，降级使用站内数据", { message: error?.message || String(error) });
      }
    }

    playSources.forEach((source) => {
      (source.episodes || []).forEach((ep) => {
        const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
        if (!mapping) return;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, ep.name);
        if (newName && newName !== ep.name) {
          logInfo("应用刮削剧集名", { oldName: ep.name, newName });
          ep.name = newName;
        }
      });
    });

    const normalizedPlaySources = playSources.map((source) => ({
      name: source.name,
      episodes: (source.episodes || []).map((ep) => ({
        name: ep.name,
        playId: ep.playId,
      })),
    }));

    return {
      list: [
        {
          vod_id: String(data?.id || videoId),
          vod_name: scrapeData?.title || String(data?.name || ""),
          type_name: TYPE_MAP[data?.categoryId] || "",
          vod_pic: scrapeData?.posterPath
            ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`
            : normalizePic(data?.cover),
          vod_remarks: String(data?.updateStatus || ""),
          vod_content: scrapeData?.overview || String(data?.blurb || ""),
          vod_actor:
            (scrapeData?.credits?.cast || [])
              .slice(0, 8)
              .map((c) => c?.name)
              .filter(Boolean)
              .join(",") || "",
          vod_director:
            (scrapeData?.credits?.crew || [])
              .filter((c) => c?.job === "Director" || c?.department === "Directing")
              .slice(0, 4)
              .map((c) => c?.name)
              .filter(Boolean)
              .join(",") || "",
          vod_play_sources: normalizedPlaySources,
        },
      ],
    };
  } catch (error) {
    logError("详情获取失败", error);
    return { list: [] };
  }
}

async function play(params) {
  const rawPlayId = String(params?.playId || "");
  logInfo("请求播放", { rawPlayId: rawPlayId.slice(0, 80) });

  try {
    let lineId = rawPlayId;
    let meta = {};
    if (rawPlayId.includes("|||")) {
      const [mainPlayId, b64] = rawPlayId.split("|||");
      lineId = String(mainPlayId || "");
      meta = decodeMeta(b64 || "");
    }

    if (!lineId) {
      throw new Error("lineId 为空");
    }

    // 已经是可播放链接时直接返回
    if (/^https?:\/\//i.test(lineId) && /\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(lineId)) {
      logInfo("检测到直接可播地址");
      return {
        urls: [{ name: "默认线路", url: lineId }],
        parse: 0,
        header: {
          "User-Agent": BASE_HEADERS["User-Agent"],
          Referer: `${HOST}/`,
          Origin: HOST,
        },
      };
    }

    const filmId = String(meta?.sid || params?.vodId || "");
    const cid = String(meta?.cid || "");

    // 先请求弹幕接口做会话预热，不阻塞主流程
    if (filmId && cid) {
      const danmakuUrl = `${API_BASE}/danmaku?filmId=${encodeURIComponent(filmId)}&index=${encodeURIComponent(
        cid
      )}&lineId=${encodeURIComponent(lineId)}`;

      try {
        await signedGet(danmakuUrl, {
          timestampMode: "checksum",
          referer: `${HOST}/m/player?cid=${encodeURIComponent(cid)}&film_id=${encodeURIComponent(
            filmId
          )}&line_id=${encodeURIComponent(lineId)}`,
        });
        logInfo("弹幕接口预热完成", { filmId, cid, lineId });
      } catch (error) {
        logWarn("弹幕接口预热失败（不影响播放）", { message: error?.message || String(error) });
      }
    }

    const parseUrl = `${API_BASE}/line/play/parse?lineId=${encodeURIComponent(lineId)}`;
    const parseResp = await signedGet(parseUrl, {
      timestampMode: "checksum",
      referer:
        filmId && cid
          ? `${HOST}/m/player?cid=${encodeURIComponent(cid)}&film_id=${encodeURIComponent(filmId)}&line_id=${encodeURIComponent(
              lineId
            )}`
          : `${HOST}/m/player`,
    });

    let realUrl = String(parseResp?.data?.data || "").trim();
    if (!realUrl) {
      throw new Error("解析接口未返回播放地址");
    }

    if (/^https?:\/\//i.test(realUrl) && !/\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(realUrl)) {
      try {
        const sniffed = await OmniBox.sniffVideo(realUrl);
        if (sniffed?.url) {
          logInfo("嗅探成功，使用嗅探结果");
          return {
            urls: [{ name: "默认线路", url: sniffed.url }],
            parse: 0,
            header: sniffed.header || {},
          };
        }
      } catch (error) {
        logWarn("嗅探失败，返回原始地址", { message: error?.message || String(error) });
      }
    }

    return {
      urls: [{ name: "默认线路", url: realUrl }],
      parse: 0,
      header: {
        "User-Agent": BASE_HEADERS["User-Agent"],
        Referer: `${HOST}/`,
        Origin: HOST,
      },
    };
  } catch (error) {
    logError("播放解析失败", error);
    return { urls: [], parse: 1, header: {} };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
