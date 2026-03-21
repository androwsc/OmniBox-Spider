// @name 星辰影院
// @author https://github.com/hjdhnx/drpy-node/blob/main/spider/js/%E6%98%9F%E8%BE%B0%E5%BD%B1%E9%99%A2%5B%E4%BC%98%5D.js
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/星辰影院.js

/**
 * ============================================================================
 * 星辰影院 - OmniBox 爬虫脚本（新格式）
 *
 * 说明：
 * 1. 本脚本由旧版 rule 格式转换为 OmniBox 标准接口：
 *    - home / category / search / detail / play
 * 2. 详情播放列表已转换为 `vod_play_sources`。
 * 3. 集成刮削：会对分集进行命名优化与排序。
 * 4. 嗅探兜底：当播放地址非直链时自动调用 sniffVideo。
 * ============================================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const host = "https://www.xcyycn.com";
const PAGE_LIMIT = 24;
const DANMU_API = process.env.DANMU_API || "";

const defHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: `${host}/`,
};

const playHeaders = {
  "User-Agent": defHeaders["User-Agent"],
  Referer: `${host}/`,
  Origin: host,
};

const axiosInstance = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
  validateStatus: (status) => status >= 200 && status < 500,
});

const classList = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "电视剧" },
  { type_id: "4", type_name: "动漫" },
  { type_id: "3", type_name: "综艺" },
];

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[星辰影院-DEBUG] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[星辰影院-DEBUG] ${message}: ${error?.message || error}`);
};

/**
 * 工具：编解码透传元数据
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
 * 工具：刮削后分集名称处理
 */
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

/**
 * 弹幕辅助：预处理标题
 */
const preprocessTitle = (title) => {
  if (!title) return "";
  return String(title)
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * 弹幕辅助：中文数字转阿拉伯数字
 */
const chineseToArabic = (cn) => {
  const map = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (!isNaN(cn)) return parseInt(cn, 10);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === "十") return 10 + map[cn[1]];
    if (cn[1] === "十") return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
};

/**
 * 弹幕辅助：提取集数
 */
const extractEpisode = (title) => {
  if (!title) return "";
  const processed = preprocessTitle(title);

  const cnMatch = processed.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));

  const seMatch = processed.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];

  const epMatch = processed.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];

  const bracketMatch = processed.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }

  return "";
};

/**
 * 弹幕辅助：构建匹配文件名
 */
const buildFileNameForDanmu = (vodName, episodeTitle) => {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") return vodName;

  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
    }
  }
  return vodName;
};

/**
 * 弹幕辅助：结合刮削元数据构建文件名
 */
const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
  if (!scrapeData) {
    return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  }
  if (scrapeType === "movie") {
    return scrapeData.title || fallbackVodName;
  }

  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
};

/**
 * 弹幕匹配
 */
const matchDanmu = async (fileName) => {
  if (!DANMU_API || !fileName) return [];

  try {
    logInfo("匹配弹幕", { fileName });
    const response = await OmniBox.request(`${DANMU_API}/api/v2/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ fileName }),
    });

    if (response.statusCode !== 200) {
      logInfo("弹幕匹配失败", { statusCode: response.statusCode });
      return [];
    }

    const matchData = JSON.parse(response.body || "{}");
    if (!matchData.isMatched) {
      logInfo("弹幕未匹配到", { fileName });
      return [];
    }

    const first = (matchData.matches || [])[0];
    if (!first?.episodeId) return [];

    const animeTitle = first.animeTitle || "";
    const episodeTitle = first.episodeTitle || "";
    let danmakuName = "弹幕";
    if (animeTitle && episodeTitle) danmakuName = `${animeTitle} - ${episodeTitle}`;
    else if (animeTitle) danmakuName = animeTitle;
    else if (episodeTitle) danmakuName = episodeTitle;

    return [{
      name: danmakuName,
      url: `${DANMU_API}/api/v2/comment/${first.episodeId}?format=xml`,
    }];
  } catch (error) {
    logInfo("弹幕匹配异常", { error: error?.message || String(error) });
    return [];
  }
};

/**
 * 统一附加弹幕
 */
const appendDanmakuToPlayResponse = async (playResponse, params, playMeta, scrapeMeta = {}) => {
  if (!playResponse || !DANMU_API) return playResponse;

  try {
    const fallbackVodName = String(params.vodName || params.videoName || playMeta?.v || "");
    const fallbackEpisodeName = String(playMeta?.e || params.episodeName || "播放");
    const mapping = (scrapeMeta.videoMappings || []).find((item) => item?.fileId === playMeta?.fid);

    const fileName = buildScrapedDanmuFileName(
      scrapeMeta.scrapeData || null,
      scrapeMeta.scrapeType || "",
      mapping,
      fallbackVodName,
      fallbackEpisodeName
    );

    logInfo("尝试弹幕匹配", { fileName, fallbackVodName, fallbackEpisodeName, hasMapping: !!mapping });
    const danmakuList = await matchDanmu(fileName);
    if (danmakuList.length > 0) {
      playResponse.danmaku = danmakuList;
      logInfo("弹幕附加成功", { count: danmakuList.length });
    }
  } catch (e) {
    logInfo("附加弹幕失败", { error: e?.message || String(e) });
  }

  return playResponse;
};

/**
 * URL 规范化
 */
const toAbsUrl = (url) => {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return u.startsWith("/") ? `${host}${u}` : `${host}/${u}`;
};

/**
 * 请求 HTML 文本
 */
const requestHtml = async (url, headers = {}) => {
  try {
    const res = await axiosInstance.get(url, {
      headers: {
        ...defHeaders,
        ...headers,
      },
      responseType: "text",
    });
    return String(res.data || "");
  } catch (e) {
    logError(`请求失败: ${url}`, e);
    return "";
  }
};

/**
 * 构建分类页 URL（兼容旧模板 fyfilter）
 */
const buildCategoryUrl = (categoryId, page = 1, extend = {}) => {
  const cateId = String(extend.cateId || categoryId || "1");
  const area = String(extend.area || "");
  const by = String(extend.by || "");
  const cls = String(extend.class || "");
  const year = String(extend.year || "");
  const pg = Number(page) > 0 ? Number(page) : 1;
  const filterPart = `${cateId}-${area}-${by}-${cls}-----${pg}---${year}.html`;
  return `${host}/vs/${filterPart}`;
};

/**
 * 解析列表卡片
 */
const extractVideoList = ($, listSelector) => {
  const list = [];
  const seen = new Set();

  $(listSelector).each((_, element) => {
    const $el = $(element);
    const $a = $el.find("a").first();

    const href = $a.attr("href") || "";
    const vodId = href.trim();
    const title = ($a.attr("title") || $a.text() || "").trim();
    const pic = $el.find(".hl-lazy").attr("data-original") || $el.find("img").attr("src") || "";
    const remark = ($el.find(".hl-pic-text").text() || "").trim();

    OmniBox.log("info", pic)

    if (!vodId || !title || seen.has(vodId)) return;
    seen.add(vodId);

    list.push({
      vod_id: vodId,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remark,
    });
  });

  return list;
};

/**
 * 将详情页播放信息转换为 OmniBox 播放源结构
 */
const parsePlaySources = ($, videoId) => {
  const playSources = [];
  const tabs = $(".hl-plays-from.hl-tabs a");
  const playLists = $(".hl-plays-list");

  tabs.each((tabIndex, tabEl) => {
    const sourceName = ($(tabEl).text() || "").trim() || `线路${tabIndex + 1}`;
    const listEl = playLists.eq(tabIndex);
    const episodes = [];

    listEl.find("a").each((epIndex, epEl) => {
      const epText = ($(epEl).text() || "").trim();
      if (!epText.includes("展开")) {
        const href = $(epEl).attr("href") || "";
        const playPath = href.trim();
        if (!playPath) return;

        const fid = `${videoId}#${tabIndex}#${epIndex}`;
        episodes.push({
          name: epText || `第${epIndex + 1}集`,
          playId: `${toAbsUrl(playPath)}|||${encodeMeta({ sid: String(videoId || ""), fid, e: epText || `第${epIndex + 1}集` })}`,
          _fid: fid,
          _rawName: epText || `第${epIndex + 1}集`,
        });
      }
    });

    if (episodes.length > 0) {
      playSources.push({
        name: sourceName,
        episodes,
      });
    }
  });

  if (playSources.length === 0) {
    playSources.push({
      name: "默认播放",
      episodes: [
        {
          name: "播放",
          playId: `${toAbsUrl(`/v/${videoId || ""}.html`)}|||${encodeMeta({ sid: String(videoId || ""), fid: `${videoId}#0#0`, e: "播放" })}`,
          _fid: `${videoId}#0#0`,
          _rawName: "播放",
        },
      ],
    });
  }

  return playSources;
};

/**
 * 从播放页提取 player JSON
 */
const extractPlayerJson = (html) => {
  if (!html) return null;

  const patterns = [
    /r\s*player_\w+\s*=\s*(\{[\s\S]*?\})\s*</i,
    /var\s+player_\w+\s*=\s*(\{[\s\S]*?\})\s*;/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (!match || !match[1]) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      // ignore and continue
    }
  }
  return null;
};

/**
 * 处理播放器加密字段
 */
const decodeEncryptedPlayUrl = (playerData) => {
  if (!playerData || !playerData.url) return "";
  let url = String(playerData.url || "");
  const encryptType = String(playerData.encrypt || "0");

  if (encryptType === "2") {
    try {
      url = unescape(Buffer.from(url, "base64").toString("utf8"));
    } catch {
      // ignore
    }
  } else if (encryptType === "1") {
    try {
      url = unescape(url);
    } catch {
      // ignore
    }
  }

  return url;
};

/**
 * 详情标题提取（多选择器兜底）
 */
const extractDetailTitle = ($) => {
  const selectors = [
    ".hl-dc-title&&Text",
    ".hl-vod-title&&Text",
    ".hl-detail-title&&Text",
    ".content .title&&Text",
    "h1&&Text",
    "h2&&Text",
    "title&&Text",
  ];

  for (const selector of selectors) {
    const [css] = selector.split("&&");
    const text = ($(css).first().text() || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (css === "title") {
      const cleaned = text
        .replace(/[-_｜|].*?(星辰影院|在线观看|免费高清|全集|完整版).*/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) return cleaned;
    } else {
      return text;
    }
  }

  const metaTitle = $("meta[property='og:title']").attr("content") || $("meta[name='title']").attr("content") || "";
  return String(metaTitle).trim();
};

// ========== 接口实现 ==========

async function home() {
  logInfo("进入首页");
  const result = {
    class: classList,
    list: [],
  };

  try {
    const html = await requestHtml(`${host}/`);
    const $ = cheerio.load(html || "");
    const list = extractVideoList($, ".hl-vod-list li");
    logInfo("首页解析完成", { count: list.length });
    result.list = list;
  } catch (e) {
    logError("首页处理失败", e);
  }

  return result;
}

async function category(params) {
  const categoryId = String(params.categoryId || "1");
  const pg = Number(params.page) > 0 ? Number(params.page) : 1;
  const extend = params.extend || {};

  try {
    const url = buildCategoryUrl(categoryId, pg, extend);
    logInfo("请求分类", { categoryId, page: pg, url, extend });

    const html = await requestHtml(url);
    const $ = cheerio.load(html || "");
    const list = extractVideoList($, ".hl-vod-list li");

    return {
      list,
      page: pg,
      pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg,
    };
  } catch (e) {
    logError("分类接口失败", e);
    return {
      list: [],
      page: pg,
      pagecount: 0,
    };
  }
}

async function search(params) {
  const wd = String(params.keyword || params.wd || "").trim();
  const pg = Number(params.page) > 0 ? Number(params.page) : 1;

  if (!wd) {
    return { list: [], page: pg, pagecount: 0 };
  }

  try {
    let url = `${host}/s.html?wd=${encodeURIComponent(wd)}&submit=`;
    if (pg > 1) {
      url = `${host}/s/${encodeURIComponent(wd)}----------${pg}---.html`;
    }
    logInfo("请求搜索", { keyword: wd, page: pg, url });

    const html = await requestHtml(url);
    const $ = cheerio.load(html || "");
    const list = extractVideoList($, ".hl-one-list li");

    return {
      list,
      page: pg,
      pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg,
    };
  } catch (e) {
    logError("搜索接口失败", e);
    return { list: [], page: pg, pagecount: 0 };
  }
}

async function detail(params) {
  const videoId = String(params.videoId || "").trim();
  const detailUrl = toAbsUrl(videoId);
  logInfo("请求详情", { videoId, detailUrl });

  try {
    const html = await requestHtml(detailUrl);
    const $ = cheerio.load(html || "");

    const title = extractDetailTitle($);
    const pic = $(".hl-dc-pic .hl-lazy").attr("data-original") || $(".hl-dc-pic img").attr("src") || "";
    const content = ($(".hl-dc-content .blurb").text() || $(".hl-dc-content").text() || "").trim();
    logInfo("详情基础信息", { title, hasPic: !!pic, hasContent: !!content });

    let playSources = parsePlaySources($, videoId || detailUrl);
    logInfo("详情播放源解析完成", { sourceCount: playSources.length });

    // 刮削处理：构造候选分集并应用命名映射
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";
    const scrapeCandidates = [];

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        if (!ep._fid) continue;
        scrapeCandidates.push({
          fid: ep._fid,
          file_id: ep._fid,
          file_name: ep._rawName || ep.name || "正片",
          name: ep._rawName || ep.name || "正片",
          format_type: "video",
        });
      }
    }

    if (scrapeCandidates.length > 0) {
      try {
        const scrapeVideoId = String(videoId || detailUrl);
        const scrapingResult = await OmniBox.processScraping(scrapeVideoId, title || "", title || "", scrapeCandidates);
        logInfo("刮削处理完成", { hasResult: !!scrapingResult, candidateCount: scrapeCandidates.length });

        const metadata = await OmniBox.getScrapeMetadata(scrapeVideoId);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
        logInfo("刮削元数据读取完成", {
          hasScrapeData: !!scrapeData,
          mappingCount: videoMappings.length,
          scrapeType,
        });
      } catch (e) {
        logError("刮削处理失败", e);
      }
    }

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
        if (!mapping) continue;
        const oldName = ep.name;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
        if (newName && newName !== oldName) {
          ep.name = newName;
          logInfo("应用刮削命名", { oldName, newName });
        }
        ep._seasonNumber = mapping.seasonNumber;
        ep._episodeNumber = mapping.episodeNumber;
      }

      const hasEpisodeNumber = (source.episodes || []).some(
        (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
      );
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
          vod_id: videoId || detailUrl,
          vod_name: scrapeData?.title || title || "未知标题",
          vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : toAbsUrl(pic),
          vod_content: scrapeData?.overview || content || "",
          vod_play_sources: normalizedPlaySources,
          vod_year: "",
          vod_area: "",
          vod_actor: (scrapeData?.credits?.cast || []).slice(0, 8).map((c) => c?.name).filter(Boolean).join(","),
          vod_director: (scrapeData?.credits?.crew || [])
            .filter((c) => c?.job === "Director" || c?.department === "Directing")
            .slice(0, 3)
            .map((c) => c?.name)
            .filter(Boolean)
            .join(","),
          type_name: "",
        },
      ],
    };
  } catch (e) {
    logError("详情接口失败", e);
    return { list: [] };
  }
}

async function play(params) {
  const rawPlayId = String(params.playId || "").trim();
  logInfo("请求播放", { rawPlayId: rawPlayId.slice(0, 120) });

  try {
    let playPageUrl = rawPlayId;
    let playMeta = {};
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";

    // 解析透传元数据
    if (rawPlayId.includes("|||")) {
      const splitIndex = rawPlayId.indexOf("|||");
      playPageUrl = rawPlayId.slice(0, splitIndex);
      playMeta = decodeMeta(rawPlayId.slice(splitIndex + 3));
    }

    playPageUrl = toAbsUrl(playPageUrl);
    logInfo("播放页地址", { playPageUrl, playMeta });

    // 预热刮削元数据（便于播放器阶段复用）
    try {
      const videoIdForScrape = String(params.vodId || playMeta.sid || "");
      if (videoIdForScrape) {
        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
      }
    } catch (e) {
      logInfo(`读取刮削元数据失败: ${e.message}`);
    }

    const html = await requestHtml(playPageUrl, {
      Referer: `${host}/`,
    });
    const playerData = extractPlayerJson(html);
    const resolved = decodeEncryptedPlayUrl(playerData);
    const resolvedUrl = toAbsUrl(resolved || "");
    logInfo("播放器数据解析结果", {
      hasPlayerData: !!playerData,
      resolvedUrl: resolvedUrl.slice(0, 160),
      encrypt: playerData?.encrypt,
    });

    const directPlayable = /\.(m3u8|mp4|flv|avi|mkv|mov|ts)(\?|$)/i.test(resolvedUrl);
    if (directPlayable) {
      const playResponse = {
        urls: [{ name: "默认线路", url: resolvedUrl }],
        parse: 0,
        header: {
          ...playHeaders,
          Referer: playPageUrl,
        },
      };
      return appendDanmakuToPlayResponse(playResponse, params, playMeta, {
        scrapeData,
        videoMappings,
        scrapeType,
      });
    }

    // 非直链，尝试嗅探
    const sniffTarget = resolvedUrl || playPageUrl;
    const sniffed = await OmniBox.sniffVideo(sniffTarget);
    if (sniffed?.url) {
      logInfo("嗅探成功", { sniffUrl: sniffed.url.slice(0, 160) });
      const playResponse = {
        urls: [{ name: "默认线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || {
          ...playHeaders,
          Referer: playPageUrl,
        },
      };
      return appendDanmakuToPlayResponse(playResponse, params, playMeta, {
        scrapeData,
        videoMappings,
        scrapeType,
      });
    }

    logInfo("嗅探未命中，返回解析模式", { fallback: playPageUrl });
    const playResponse = {
      urls: [{ name: "默认线路", url: sniffTarget }],
      parse: 1,
      header: {
        ...playHeaders,
        Referer: playPageUrl,
      },
    };
    return appendDanmakuToPlayResponse(playResponse, params, playMeta, {
      scrapeData,
      videoMappings,
      scrapeType,
    });
  } catch (e) {
    logError("播放解析失败", e);
    const fallback = rawPlayId.includes("|||") ? toAbsUrl(rawPlayId.split("|||")[0]) : toAbsUrl(rawPlayId);
    const playResponse = {
      urls: [{ name: "默认线路", url: fallback }],
      parse: 1,
      header: {
        ...playHeaders,
        Referer: `${host}/`,
      },
    };
    return appendDanmakuToPlayResponse(playResponse, params, playMeta, {
      scrapeData,
      videoMappings,
      scrapeType,
    });
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
