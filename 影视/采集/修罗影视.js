// @name 修罗影视
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, crypto-js
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/修罗影视.js

/**
 * ============================================================================
 * 修罗影视 - OmniBox 爬虫脚本
 * 站点地址: https://www.xlys02.com
 * ============================================================================
 * 核心功能:
 *   - 首页分类: 电影/电视剧/综艺/短剧
 *   - 分类筛选: 类型/地区/年份/排序
 *   - 详情解析: 自动提取剧集列表
 *   - 播放解析: 直连优先，TOS线路，屏蔽下载线路
 *   - 搜索功能: OCR验证码识别，会话缓存(20分钟)
 * 修改时间: 2026-02-27
 */

const CryptoJS = require("crypto-js");
const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");
const https = require("https");

// ========== 全局配置 ==========
const HOST = "https://www.xlys02.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const DANMU_API = process.env.DANMU_API || "";

// 会话缓存(20分钟)
let SESSION_CACHE = {
    cookie: null,
    expire: 0
};
const SESSION_TTL = 20 * 60 * 1000;

/**
 * 创建 HTTPS Agent (忽略 SSL 证书验证)
 */
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    scheduling: 'lifo',
    rejectUnauthorized: false  // 忽略 SSL 证书验证
});

/**
 * 创建 Axios 实例
 */
const axiosInstance = axios.create({
    httpsAgent
});

// ========== 日志工具 ==========
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[修罗影视] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[修罗影视] ${message}: ${error.message || error}`);
};

// ========== 元数据编解码 ==========
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

// ========== 工具函数 ==========
const fixImg = (img) => {
    if (!img) return "";
    if (img.startsWith("http")) return img;
    if (img.startsWith("//")) return "https:" + img;
    return HOST + img;
};

const getId = (href) => {
    if (!href) return "";
    let id = href.split(".htm")[0];
    if (id.startsWith("/")) id = id.substring(1);
    return id;
};

const extractDetailVodName = ($, videoId = "") => {
    const invalidTitles = new Set(["观看历史", "简介", "剧集列表", "相关推荐", "热门推荐"]);
    const pickMainTitle = (text) => {
        if (!text) return "";
        const raw = text.replace(/\s+/g, " ").trim();
        // 优先提取《片名》
        const quoted = raw.match(/《\s*([^》]+?)\s*》/);
        if (quoted && quoted[1]) return quoted[1].trim();
        return raw;
    };
    const selectors = [
        "h1",
        ".video-title",
        ".detail-title",
        ".vod-title",
        ".card-title"
    ];

    for (const sel of selectors) {
        const txt = pickMainTitle($(sel).first().text());
        if (txt && !invalidTitles.has(txt)) {
            return txt;
        }
    }

    // 回退到页面 title
    const pageTitle = $("title").first().text().trim();
    if (pageTitle) {
        const cleanTitle = pickMainTitle(pageTitle
            .replace(/\s*[-|_｜]\s*修罗影视.*$/i, "")
            .replace(/\s*[-|_｜].*$/, "")
            .trim());
        if (cleanTitle && !invalidTitles.has(cleanTitle)) {
            return cleanTitle;
        }
    }

    return videoId || "未知视频";
};

const request = async (url, options = {}) => {
    try {
        logInfo("🌐 请求", url);
        const res = await axiosInstance.get(url, {
            headers: {
                "User-Agent": UA,
                "Referer": HOST,
                ...options.headers
            },
            timeout: 15000,
            ...options
        });
        return res.data;
    } catch (e) {
        logError("❌ 请求失败", e);
        return "";
    }
};

const requestPost = async (url, data, options = {}) => {
    try {
        logInfo("🌐 POST请求", url);
        const res = await axiosInstance.post(url, data, {
            headers: {
                "User-Agent": UA,
                "Referer": HOST,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                ...options.headers
            },
            timeout: 15000,
            ...options
        });
        return res.data;
    } catch (e) {
        logError("❌ POST请求失败", e);
        return null;
    }
};

/**
 * 通过API进行聚合搜索(验证码失败兜底)
 */
const aggregateApiSearch = async (keyword, pg) => {
    if (!keyword) return { list: [], page: pg, pagecount: pg };
    try {
        const searchUrl = `https://www.ymck.pro/API/v2.php?q=${encodeURIComponent(keyword)}&size=50`;
        const base64Data = await request(searchUrl);
        if (!base64Data) return { list: [], page: pg, pagecount: pg };

        let decodedStr = "";
        try {
            decodedStr = Buffer.from(String(base64Data).trim(), "base64").toString("utf8");
        } catch (e) {
            logError("聚合搜索Base64解码失败", e);
            return { list: [], page: pg, pagecount: pg };
        }

        let searchResults = [];
        try {
            searchResults = JSON.parse(decodedStr) || [];
        } catch (e) {
            logError("聚合搜索JSON解析失败", e);
            return { list: [], page: pg, pagecount: pg };
        }

        if (!Array.isArray(searchResults)) {
            logInfo("聚合搜索返回非数组");
            return { list: [], page: pg, pagecount: pg };
        }

        const targetSites = ["哔滴影视", "修罗", "修罗影视"];
        const list = [];

        for (const item of searchResults) {
            if (!item || typeof item !== "object") continue;
            const website = item.website || "";
            if (!targetSites.some((name) => website.includes(name))) continue;

            const url = item.url || "";
            if (!url) continue;

            let vodId = "";
            try {
                const u = new URL(url);
                vodId = getId(u.pathname);
            } catch {
                vodId = getId(url);
            }

            if (!vodId) continue;

            const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).join(" ") : "";
            list.push({
                vod_id: vodId,
                vod_name: item.text || keyword,
                vod_pic: fixImg(item.icon || ""),
                vod_remarks: tags
            });
        }

        logInfo(`🧩 聚合搜索命中: ${list.length}条`);
        return { list, page: 1, pagecount: list.length, total: list.length};
    } catch (e) {
        logError("聚合搜索异常", e);
        return { list: [], page: pg, pagecount: pg };
    }
};

// ========== 筛选配置 ==========
const filters = {
    movie: [
        { key: "genre", name: "类型", init: "all", value: [{ name: "不限", value: "all" }, { name: "动作", value: "dongzuo" }, { name: "爱情", value: "aiqing" }, { name: "喜剧", value: "xiju" }, { name: "科幻", value: "kehuan" }, { name: "恐怖", value: "kongbu" }, { name: "战争", value: "zhanzheng" }, { name: "武侠", value: "wuxia" }, { name: "魔幻", value: "mohuan" }, { name: "剧情", value: "juqing" }, { name: "动画", value: "donghua" }, { name: "惊悚", value: "jingsong" }, { name: "3D", value: "3D" }, { name: "灾难", value: "zainan" }, { name: "悬疑", value: "xuanyi" }, { name: "警匪", value: "jingfei" }, { name: "文艺", value: "wenyi" }, { name: "青春", value: "qingchun" }, { name: "冒险", value: "maoxian" }, { name: "犯罪", value: "fanzui" }, { name: "记录", value: "jilu" }, { name: "古装", value: "guzhuang" }, { name: "奇幻", value: "奇幻" }] },
        { key: "area", name: "地区", init: "", value: [{ name: "不限", value: "" }, { name: "中国大陆", value: "中国大陆" }, { name: "中国香港", value: "中国香港" }, { name: "美国", value: "美国" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "法国", value: "法国" }, { name: "印度", value: "印度" }, { name: "德国", value: "德国" }] },
        { key: "year", name: "年份", init: "", value: [{ name: "不限", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }, { name: "2023", value: "2023" }, { name: "2022", value: "2022" }] },
        { key: "order", name: "排序", init: "0", value: [{ name: "更新时间", value: "0" }, { name: "豆瓣评分", value: "1" }] }
    ],
    tv: [
        { key: "genre", name: "类型", init: "all", value: [{ name: "不限", value: "all" }, { name: "动作", value: "dongzuo" }, { name: "爱情", value: "aiqing" }, { name: "喜剧", value: "xiju" }, { name: "剧情", value: "juqing" }] },
        { key: "area", name: "地区", init: "", value: [{ name: "不限", value: "" }, { name: "中国大陆", value: "中国大陆" }, { name: "美国", value: "美国" }, { name: "韩国", value: "韩国" }] },
        { key: "year", name: "年份", init: "", value: [{ name: "不限", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }] },
        { key: "order", name: "排序", init: "0", value: [{ name: "更新时间", value: "0" }, { name: "豆瓣评分", value: "1" }] }
    ]
};

// ========== 验证码计算 ==========
const calcVerifyCode = (text) => {
    if (!text) return null;
    let exp = text.replace(/\s/g, "").replace("=", "");
    exp = exp.replace(/[xX×]/g, "*").replace(/-/g, "-");
    const match = exp.match(/^(\d+)([\+\-\*])(\d+)$/);
    if (!match) return null;
    const a = parseInt(match[1], 10);
    const op = match[2];
    const b = parseInt(match[3], 10);
    switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        default: return null;
    }
};

// ========== 弹幕工具函数 ==========
const preprocessTitle = (title) => {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
};

const chineseToArabic = (cn) => {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn, 10);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
};

const extractEpisode = (title) => {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();

    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    return "";
};

const buildFileNameForDanmu = (vodName, episodeTitle) => {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") {
        return vodName;
    }

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) return `${vodName} S01E0${epNum}`;
            return `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
};

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
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniffXluysPlay = async (playUrl) => {
    if (!playUrl) return null;
    try {
        logInfo("尝试嗅探播放页", playUrl);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", sniffed.url);
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || { "User-Agent": UA, "Referer": HOST }
            };
        }
    } catch (error) {
        logInfo(`嗅探失败: ${error.message}`);
    }
    return null;
};

const matchDanmu = async (fileName) => {
    if (!DANMU_API || !fileName) return [];

    try {
        logInfo(`💬 匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            body: JSON.stringify({ fileName })
        });

        if (response.statusCode !== 200) {
            logInfo(`⚠ 弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) {
            logInfo("⚠ 弹幕未匹配到");
            return [];
        }

        const matches = matchData.matches || [];
        if (matches.length === 0) return [];

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";
        if (!episodeId) return [];

        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;
        logInfo(`✅ 弹幕匹配成功: ${danmakuName}`);

        return [{
            name: danmakuName,
            url: danmakuURL
        }];
    } catch (e) {
        logError("⚠ 弹幕匹配异常", e);
        return [];
    }
};

// ========== 核心接口实现 ==========

async function home(params) {
    logInfo("🏠 进入首页");
    let list = [];

    try {
        const html = await request(HOST);
        if (!html) {
            logInfo("⚠ 首页HTML为空");
        } else {
            const $ = cheerio.load(html);
            $(".row-cards .card.card-link").each((_, el) => {
                const href = $(el).find("a").attr("href");
                if (href) {
                    list.push({
                        vod_id: getId(href),
                        vod_name: $(el).find(".card-title").text().trim(),
                        vod_pic: fixImg($(el).find("img").attr("data-src")),
                        vod_remarks: $(el).find(".text-muted").text().trim()
                    });
                }
            });
            logInfo(`✅ 首页解析到 ${list.length} 条数据`);
        }
    } catch (e) {
        logError("首页解析异常", e);
        list = [];
    }

    return {
        class: [
            { type_id: "movie", type_name: "电影" },
            { type_id: "tv", type_name: "电视剧" },
            { type_id: "zongyi", type_name: "综艺" },
            { type_id: "duanju", type_name: "短剧" }
        ],
        filters: filters,
        list
    };
}

async function category(params) {
    logInfo(`📂 请求参数: ${params}`);

    const { categoryId, page, filters: filterParams } = params;
    const pg = parseInt(page) || 1;
    var genre = filterParams?.genre || categoryId;
    if (genre == 'movie' || genre == 'tv') {
        genre = 'all';
    }

    logInfo(`📂 请求分类: ${categoryId}, 页码: ${pg}`);

    let url = `${HOST}/s/${genre}/${pg}`;
    const urlParams = [];

    if (categoryId !== "zongyi" && categoryId !== "duanju") {
        urlParams.push(`type=${categoryId === "tv" ? "1" : "0"}`);
    }
    if (filterParams?.area) urlParams.push(`area=${encodeURIComponent(filterParams.area)}`);
    if (filterParams?.year) urlParams.push(`year=${filterParams.year}`);
    if (filterParams?.order) urlParams.push(`order=${filterParams.order}`);
    if (urlParams.length > 0) url += `?${urlParams.join("&")}`;

    try {
        const html = await request(url);

        // 如果返回空，记录并返回空列表
        if (!html) {
            logInfo("⚠ 返回HTML为空");
            return { list: [], page: pg, pagecount: pg };
        }

        const $ = cheerio.load(html);
        const list = [];

        $(".row-cards .card.card-link").each((_, el) => {
            const href = $(el).find("a").attr("href");
            if (href) {
                list.push({
                    vod_id: getId(href),
                    vod_name: $(el).find(".card-title").text().trim(),
                    vod_pic: fixImg($(el).find("img").attr("src")),
                    vod_remarks: $(el).find(".text-muted").text().trim()
                });
            }
        });

        logInfo(`✅ 解析到 ${list.length} 条数据`);

        return {
            list,
            page: pg,
            pagecount: list.length >= 24 ? pg + 1 : pg
        };
    } catch (e) {
        logError("分类解析异常", e);
        return { list: [], page: pg, pagecount: pg };
    }
}

async function detail(params) {
    const videoId = params.videoId;
    logInfo(`📄 请求详情 ID: ${videoId}`);

    const detailUrl = `${HOST}/${videoId}.htm`;
    const html = await request(detailUrl);
    if (!html) return { list: [] };

    const $ = cheerio.load(html);
    const playUrls = [];
    const vodName = extractDetailVodName($, videoId);

    $("#play-list a").each((_, item) => {
        const name = $(item).text().trim();
        const href = $(item).attr("href");
        if (name && href) {
            const fullPlayId = getId(href);
            logInfo(`🔗 找到剧集: ${name} -> ID: ${fullPlayId}`);
            playUrls.push(`${name}$${fullPlayId}`);
        }
    });

    // 转换为 OmniBox 播放源格式
    const videoIdForScrape = String(videoId || "");
    const scrapeCandidates = [];
    
    playUrls.forEach((item, index) => {
        const parts = item.split('$');
        const episodeName = parts[0] || '正片';
        scrapeCandidates.push({
            fid: `${videoIdForScrape}#0#${index}`,
            file_id: `${videoIdForScrape}#0#${index}`,
            file_name: episodeName,
            name: episodeName,
            format_type: "video"
        });
    });

    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";

    if (scrapeCandidates.length > 0) {
        try {
            const scrapingResult = await OmniBox.processScraping(videoIdForScrape, vodName || "", vodName || "", scrapeCandidates);
            logInfo(`✅ 刮削处理完成`);

            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            scrapeData = metadata?.scrapeData || null;
            videoMappings = metadata?.videoMappings || [];
            scrapeType = metadata?.scrapeType || "";
            logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
        } catch (error) {
            logError("刮削处理失败", error);
        }
    }

    const playSources = [{
        name: "修罗直连",
        episodes: playUrls.map((item, index) => {
            const parts = item.split('$');
            const episodeName = parts[0] || '正片';
            const playIdValue = parts[1] || parts[0];
            const fid = `${videoIdForScrape}#0#${index}`;
            
            // 应用刮削后的集数名称
            let finalEpisodeName = episodeName;
            const mapping = videoMappings.find((m) => m?.fileId === fid);
            if (mapping) {
                finalEpisodeName = buildScrapedEpisodeName(scrapeData, mapping, episodeName);
            }

            const combinedId = `${playIdValue}|||${encodeMeta({ sid: videoIdForScrape, fid, v: vodName || "", e: episodeName })}`;
            return {
                name: finalEpisodeName,
                playId: combinedId,
                _fid: fid,
                _rawName: episodeName,
                _seasonNumber: mapping?.seasonNumber,
                _episodeNumber: mapping?.episodeNumber
            };
        })
    }];

    // 按季度和集数排序
    const hasEpisodeNumber = playSources[0].episodes.some(
        (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
    );
    if (hasEpisodeNumber) {
        playSources[0].episodes.sort((a, b) => {
            const seasonA = a._seasonNumber || 0;
            const seasonB = b._seasonNumber || 0;
            if (seasonA !== seasonB) return seasonA - seasonB;
            const episodeA = a._episodeNumber || 0;
            const episodeB = b._episodeNumber || 0;
            return episodeA - episodeB;
        });
    }

    const vod = {
        vod_id: videoId,
        vod_name: scrapeData?.title || vodName,
        vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : fixImg($("img.cover").attr("src")),
        vod_content: scrapeData?.overview || $("#synopsis").text().trim(),
        vod_play_sources: playSources.map((source) => ({
            name: source.name,
            episodes: source.episodes.map((ep) => ({
                name: ep.name,
                playId: ep.playId
            }))
        }))
    };

    if (scrapeData) {
        if (scrapeData.releaseDate) {
            vod.vod_year = String(scrapeData.releaseDate).substring(0, 4);
        }
        const actors = (scrapeData.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",");
        if (actors) {
            vod.vod_actor = actors;
        }
        const directors = (scrapeData.credits?.crew || [])
            .filter((c) => c?.job === "Director" || c?.department === "Directing")
            .slice(0, 3)
            .map((c) => c?.name)
            .filter(Boolean)
            .join(",");
        if (directors) {
            vod.vod_director = directors;
        }
    }

    return { list: [vod] };
}

async function search(params) {
    const keyword = (params.keyword || params.wd || "").trim();
    const pg = parseInt(params.page) || 1;

    if (!keyword) {
        logInfo("⚠ 搜索关键词为空");
        return { list: [] };
    }

    const now = Date.now();

    // 优先使用缓存
    if (SESSION_CACHE.cookie && now < SESSION_CACHE.expire) {
        logInfo("♻ 使用缓存会话");
        try {
            const fastUrl = `${HOST}/search/${encodeURIComponent(keyword)}/${pg}`;
            const fastRes = await axiosInstance.get(fastUrl, {
                headers: {
                    "User-Agent": MOBILE_UA,
                    "Cookie": SESSION_CACHE.cookie
                }
            });
            const result = await parseSearch(fastRes.data, pg, keyword);
            if (result.list.length > 0) {
                logInfo("✅ 缓存会话有效");
                return result;
            }
            logInfo("⚠ 缓存失效，重新验证");
        } catch (e) {
            logError("⚠ 缓存请求异常", e);
        }
    }

    logInfo(`🔍 开始搜索: ${keyword}`);
    const ocrApi = "https://api.nn.ci/ocr/b64/json";
    const MAX_FLOW_RETRY = 3;

    try {
        for (let flow = 1; flow <= MAX_FLOW_RETRY; flow++) {
            logInfo(`🔁 第 ${flow} 轮验证码流程`);

            // 初始化会话
            const searchUrl = `${HOST}/search/${encodeURIComponent(keyword)}/${pg}`;
            const initRes = await axiosInstance.get(searchUrl, {
                headers: { "User-Agent": MOBILE_UA }
            });
            const rawCookies = initRes.headers["set-cookie"] || [];
            const cookieStr = rawCookies.map(c => c.split(";")[0]).join("; ");
            const finalCookie = `gg_iscookie=1; ${cookieStr}`;
            logInfo("🍪 新会话Cookie");

            // 获取验证码 + OCR
            let verifyCode = null;
            for (let i = 1; i <= 3; i++) {
                try {
                    logInfo(`🖼 获取验证码 第${i}次`);
                    const imgRes = await axiosInstance.get(
                        `${HOST}/search/verifyCode?t=${Date.now()}`,
                        {
                            headers: {
                                "User-Agent": MOBILE_UA,
                                "Cookie": finalCookie,
                                "Referer": searchUrl
                            },
                            responseType: "arraybuffer"
                        }
                    );
                    const b64 = Buffer.from(imgRes.data).toString("base64");
                    const ocrRes = await axiosInstance.post(ocrApi, b64, {
                        headers: { "User-Agent": MOBILE_UA },
                        timeout: 8000
                    });
                    const raw = ocrRes.data?.result?.trim();
                    logInfo(`🧾 OCR识别: ${raw}`);
                    verifyCode = calcVerifyCode(raw);
                    if (verifyCode !== null) {
                        logInfo(`✅ 验证码计算结果: ${verifyCode}`);
                        break;
                    }
                } catch (e) {
                    logError("⚠ OCR异常", e);
                }
            }

            if (!verifyCode) {
                logInfo("❌ OCR失败，重新整轮流程");
                continue;
            }

            // 提交验证码
            const submitUrl = `${HOST}/search/${encodeURIComponent(keyword)}?code=${verifyCode}`;
            logInfo("📡 提交搜索");
            const htmlRes = await axiosInstance.get(submitUrl, {
                headers: {
                    "User-Agent": MOBILE_UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Cookie": finalCookie,
                    "Referer": submitUrl
                }
            });

            const html = htmlRes.data || "";
            if (html.includes("verifyCode") || html.includes("验证码")) {
                logInfo("⚠ 仍是验证码页，重试");
                continue;
            }

            const result = await parseSearch(html, pg, keyword);
            if (result.list.length > 0) {
                SESSION_CACHE.cookie = finalCookie;
                SESSION_CACHE.expire = Date.now() + SESSION_TTL;
                logInfo("💾 会话缓存成功(20分钟)");
                logInfo(`🎯 搜索成功: ${result.list.length}条`);
                return result;
            }
            logInfo("⚠ 无结果，重新整轮流程");
        }

        // 聚合搜索兜底
        try {
            const aggregateResult = await aggregateApiSearch(keyword, pg);
            if (aggregateResult.list.length > 0) {
                logInfo("✅ 聚合搜索命中");
                return aggregateResult;
            }
        } catch (e) {
            logError("聚合搜索异常", e);
        }

        logInfo("❌ 所有流程失败");
        return { list: [] };
    } catch (e) {
        logError("❌ 搜索异常", e);
        return { list: [] };
    }
}

async function parseSearch(html, pg, keyword = "") {
    if (!html) {
        logInfo("❌ 解析HTML为空");
        return { list: [] };
    }

    const $ = cheerio.load(html);
    const list = [];
    keyword = (keyword || "").trim();

    $(".row-cards .col-12").each((_, el) => {
        const titleNode = $(el).find(".search-movie-title").first();
        if (!titleNode.length) return;
        const href = titleNode.attr("href");
        if (!href) return;
        const rawTitle = titleNode.text().replace(/\s+/g, " ").trim();
        const match = rawTitle.match(/《([^》]+)》/);
        if (!match) {
            logInfo(`⏭ 无书名号跳过: ${rawTitle}`);
            return;
        }
        const pureTitle = match[1];
        if (keyword && !pureTitle.includes(keyword)) {
            logInfo(`🚫 过滤: ${pureTitle}`);
            return;
        }
        const vod_id = getId(href);
        const vod_pic = fixImg($(el).find("a img").first().attr("src"));
        logInfo(`✅ 命中结果: ${pureTitle}`);
        list.push({
            vod_id,
            vod_name: pureTitle,
            vod_pic,
            vod_remarks: ""
        });
    });

    let pagecount = pg;
    const pages = $(".pagination li a")
        .map((_, a) => $(a).text().trim())
        .get()
        .filter(t => /^\d+$/.test(t));
    if (pages.length > 0) {
        pagecount = parseInt(pages[pages.length - 1]);
    }

    logInfo(`📄 分页识别: 当前=${pg} 最大=${pagecount}`);
    return { list, page: pg, pagecount, total: pagecount };
}

async function play(params) {
    let playId = params.playId;
    logInfo(`🎬 准备解析: ${playId}`);

    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    // 解析透传参数
    if (playId && playId.includes('|||')) {
        const [mainPlayId, metaB64] = playId.split('|||');
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
        logInfo(`📌 透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    } else if (playId && playId.includes('|')) {
        // 兼容旧格式
        const parts = playId.split('|');
        playId = parts.shift() || "";
        vodName = parts.shift() || "";
        episodeName = parts.join('|') || "";
        logInfo(`📌 透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
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
                if (metadata.scrapeData.title) {
                    vodName = metadata.scrapeData.title;
                }
                if (mapping?.episodeName) {
                    episodeName = mapping.episodeName;
                }
            }
        }
    } catch (error) {
        logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    try {
        const playPageUrl = `${HOST}/${playId}.htm`;
        const playPageHtml = await request(playPageUrl);
        const pidMatch = playPageHtml.match(/var pid = (\d+);/);
        let playResponse;

        if (!pidMatch) {
            logInfo("❌ 无法提取 pid，尝试嗅探");
            const sniffResult = await sniffXluysPlay(playPageUrl);
            if (sniffResult) {
                playResponse = sniffResult;
            } else {
                playResponse = {
                    urls: [{ name: "嗅探", url: playPageUrl }],
                    parse: 1
                };
            }
        } else {
            const pid = pidMatch[1];
            const t = new Date().getTime();
            const keyStr = CryptoJS.MD5(pid + '-' + t).toString().substring(0, 16);
            const key = CryptoJS.enc.Utf8.parse(keyStr);
            const encrypted = CryptoJS.AES.encrypt(pid + '-' + t, key, {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.Pkcs7
            });
            const sg = encrypted.ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();
            const linesUrl = `${HOST}/lines?t=${t}&sg=${sg}&pid=${pid}`;

            logInfo("📡 请求线路接口");
            const res = await axiosInstance.get(linesUrl, {
                headers: {
                    "User-Agent": UA,
                    "Referer": playPageUrl,
                    "X-Requested-With": "XMLHttpRequest"
                }
            });

            if (!res.data || res.data.code !== 0 || !res.data.data) {
                logInfo("❌ 接口返回异常，尝试嗅探");
                const sniffResult = await sniffXluysPlay(playPageUrl);
                if (sniffResult) {
                    playResponse = sniffResult;
                } else {
                    playResponse = {
                        urls: [{ name: "嗅探", url: playPageUrl }],
                        parse: 1
                    };
                }
            } else {
                const d = res.data.data;
                const playUrls = [];

                // 直连优先
                if (d.url3) {
                    const urls = d.url3.split(',');
                    for (let i = 0; i < urls.length; i++) {
                        const u = urls[i].trim();
                        if (!u || u.includes(".m3u8") || u.includes("p3-tt.byteimg.com")) {
                            logInfo(`🚫 屏蔽线路: ${u}`);
                            continue;
                        }
                        playUrls.push({ name: `直链${i + 1}`, url: u });
                        logInfo(`✅ 直链${i + 1}: ${u}`);
                    }
                }

                // TOS 线路
                if (d.tos) {
                    try {
                        const tosUrl = `${HOST}/god/${pid}?type=1`;
                        const tosRes = await requestPost(tosUrl, `t=${t}&sg=${sg}&verifyCode=888`);
                        if (tosRes && tosRes.url && !tosRes.url.includes(".m3u8") && !tosRes.url.includes("byteimg")) {
                            playUrls.push({ name: "TOS", url: tosRes.url });
                            logInfo(`✅ TOS线路: ${tosRes.url}`);
                        }
                    } catch (e) {
                        logError("❌ TOS处理失败", e);
                    }
                }

                if (playUrls.length > 0) {
                    logInfo(`🎉 最终可播放线路数量: ${playUrls.length}`);
                    playResponse = {
                        urls: playUrls,
                        parse: 0,
                        header: {
                            "User-Agent": UA,
                            "Referer": HOST
                        }
                    };
                } else {
                    logInfo("⚠ 无可用线路，尝试嗅探");
                    const sniffResult = await sniffXluysPlay(playPageUrl);
                    if (sniffResult) {
                        playResponse = sniffResult;
                    } else {
                        playResponse = {
                            urls: [{ name: "嗅探", url: playPageUrl }],
                            parse: 1
                        };
                    }
                }
            }
        }

        // 弹幕匹配
        if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            logInfo(`💬 尝试匹配弹幕文件名: ${fileName}`);
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo("✅ 已注入弹幕数据");
                }
            }
        } else if (!DANMU_API) {
            logInfo("ℹ DANMU_API 未配置，跳过弹幕匹配");
        }

        return playResponse;
    } catch (e) {
        logError("🔥 播放异常", e);
        const fallbackSniff = await sniffXluysPlay(`${HOST}/${playId}.htm`);
        if (fallbackSniff) {
            return fallbackSniff;
        }
        return {
            urls: [{ name: "嗅探", url: `${HOST}/${playId}.htm` }],
            parse: 1
        };
    }
}

// ========== 导出模块 ==========
module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
