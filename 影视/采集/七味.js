// @name 七味
// @author https://github.com/hjdhnx/drpy-node/blob/main/spider/js/%E4%B8%83%E5%91%B3%5B%E4%BC%98%5D.js
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/七味.js

/**
 * ============================================================================
 * 七味 (QW)
 * 站点族：pcmp4 / qwnull / qwmkv / qwfilm / qnmp4 / qnnull / qnhot
 *
 * 说明：
 * - 由旧版 drpy rule 脚本转换为 OmniBox 标准五接口格式
 * - 保留原站分类筛选 URL 规则与详情页播放线路解析逻辑
 * - 增强日志输出，便于排查线路、解析和故障切换问题
 * ============================================================================
 */

const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

const DANMU_API = process.env.DANMU_API || "";
const MAX_PAN_VALID_ROUTES = (() => {
    const raw = String(process.env.MAX_PAN_VALID_ROUTES || "3").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
})();
const PAN_ROUTE_NAMES = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连")
    .split(";")
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PAN_VALID_ROUTES);

// ==================== 全局配置 ====================
const HOSTS = [
    "https://www.pcmp4.com",
    "https://www.qwnull.com",
    "https://www.qwmkv.com",
    "https://www.qwfilm.com",
    "https://www.qnmp4.com",
    "https://www.qnnull.com",
    "https://www.qnhot.com",
];

let currentHostIndex = 0;

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
};

const CLASSES = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "剧集" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "30", type_name: "短剧" },
];

const FILTERS = {
    "1": [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: [
                { name: "按时间", value: "time" },
                { name: "按人气", value: "hits" },
                { name: "按评分", value: "score" },
            ],
        },
        {
            key: "year",
            name: "年份",
            init: "",
            value: [
                { name: "全部", value: "" },
                { name: "2026", value: "2026" },
                { name: "2025", value: "2025" },
                { name: "2024", value: "2024" },
                { name: "2023", value: "2023" },
                { name: "2022", value: "2022" },
            ],
        },
        {
            key: "area",
            name: "地区",
            init: "",
            value: [
                { name: "全部", value: "" },
                { name: "大陆", value: "大陆" },
                { name: "香港", value: "香港" },
                { name: "台湾", value: "台湾" },
                { name: "日本", value: "日本" },
                { name: "韩国", value: "韩国" },
                { name: "美国", value: "美国" },
            ],
        },
        {
            key: "lang",
            name: "语言",
            init: "",
            value: [
                { name: "全部", value: "" },
                { name: "国语", value: "国语" },
                { name: "粤语", value: "粤语" },
                { name: "英语", value: "英语" },
                { name: "日语", value: "日语" },
                { name: "韩语", value: "韩语" },
            ],
        },
        {
            key: "type",
            name: "类型",
            init: "",
            value: [
                { name: "全部", value: "" },
                { name: "剧情", value: "剧情" },
                { name: "动作", value: "动作" },
                { name: "喜剧", value: "喜剧" },
                { name: "爱情", value: "爱情" },
                { name: "科幻", value: "科幻" },
                { name: "悬疑", value: "悬疑" },
            ],
        },
    ],
    "2": [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: [
                { name: "按时间", value: "time" },
                { name: "按人气", value: "hits" },
                { name: "按评分", value: "score" },
            ],
        },
    ],
    "3": [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: [
                { name: "按时间", value: "time" },
                { name: "按人气", value: "hits" },
                { name: "按评分", value: "score" },
            ],
        },
    ],
    "4": [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: [
                { name: "按时间", value: "time" },
                { name: "按人气", value: "hits" },
                { name: "按评分", value: "score" },
            ],
        },
    ],
    "30": [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: [
                { name: "按时间", value: "time" },
                { name: "按人气", value: "hits" },
                { name: "按评分", value: "score" },
            ],
        },
    ],
};

const axiosInstance = axios.create({
    timeout: 15000,
    validateStatus: (status) => status >= 200 && status < 500,
    responseType: "text",
});

// ==================== 日志工具 ====================
function logInfo(message, data = null) {
    const suffix = data == null ? "" : `: ${JSON.stringify(data)}`;
    OmniBox.log("info", `[七味] ${message}${suffix}`);
}

function logWarn(message, data = null) {
    const suffix = data == null ? "" : `: ${JSON.stringify(data)}`;
    OmniBox.log("warn", `[七味] ${message}${suffix}`);
}

function logError(message, error) {
    OmniBox.log("error", `[七味] ${message}: ${error?.message || error}`);
}

function encodeMeta(obj) {
    try {
        return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
    } catch {
        return "";
    }
}

function decodeMeta(str) {
    try {
        const raw = Buffer.from(str || "", "base64").toString("utf8");
        return JSON.parse(raw || "{}");
    } catch {
        return {};
    }
}

function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = title.trim();
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
    if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") {
        return vodName;
    }
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            return `${vodName} S01E${String(epNum).padStart(2, "0")}`;
        }
    }
    return vodName;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
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
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
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
}

async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) {
        return [];
    }

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
            logWarn("弹幕匹配失败", { statusCode: response.statusCode });
            return [];
        }

        const data = JSON.parse(response.body || "{}");
        if (!data.isMatched) {
            return [];
        }

        const first = (data.matches || [])[0] || {};
        if (!first.episodeId) {
            return [];
        }

        const animeTitle = first.animeTitle || "";
        const episodeTitle = first.episodeTitle || "";
        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        return [{ name: danmakuName, url: `${DANMU_API}/api/v2/comment/${first.episodeId}?format=xml` }];
    } catch (error) {
        logWarn("弹幕匹配异常", { error: error.message || String(error) });
        return [];
    }
}

// ==================== 基础工具 ====================
function getCurrentHost() {
    return HOSTS[currentHostIndex] || HOSTS[0];
}

function rotateHost() {
    currentHostIndex = (currentHostIndex + 1) % HOSTS.length;
    return getCurrentHost();
}

function fixJsonWrappedHtml(html) {
    if (!html || typeof html !== "string") {
        return "";
    }
    const trimmed = html.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed.startsWith("<") || trimmed.startsWith("<!DOCTYPE")) {
        return trimmed;
    }
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === "string") {
                return parsed.trim();
            }
        } catch {
            return trimmed;
        }
    }
    return trimmed;
}

function isAbsoluteUrl(url) {
    return /^https?:\/\//i.test(String(url || ""));
}

function fixUrl(url, host = getCurrentHost()) {
    const value = String(url || "").trim();
    if (!value) {
        return "";
    }
    if (isAbsoluteUrl(value)) {
        return value;
    }
    if (value.startsWith("//")) {
        return `https:${value}`;
    }
    if (value.startsWith("/")) {
        return `${host}${value}`;
    }
    return `${host}/${value}`;
}

function normalizeImage(url, host = getCurrentHost()) {
    const normalized = fixUrl(url, host);
    return normalized || "";
}

function parsePage(value, fallback = 1) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFilters(params = {}) {
    const merged = {};
    const candidates = [params.filters, params.extend];
    for (const item of candidates) {
        if (!item) {
            continue;
        }
        if (typeof item === "object") {
            Object.assign(merged, item);
            continue;
        }
        if (typeof item === "string") {
            try {
                const parsed = JSON.parse(item);
                if (parsed && typeof parsed === "object") {
                    Object.assign(merged, parsed);
                }
            } catch {
                // ignore invalid filter json
            }
        }
    }
    return merged;
}

async function requestHtml(url, options = {}) {
    const response = await axiosInstance.get(url, {
        ...options,
        headers: {
            ...DEFAULT_HEADERS,
            Referer: `${getCurrentHost()}/`,
            Origin: getCurrentHost(),
            ...(options.headers || {}),
        },
    });
    return fixJsonWrappedHtml(response.data || "");
}

/**
 * 按 host 列表自动重试。
 * - 绝对 URL：直接请求一次
 * - 相对 URL：按当前 host 开始轮询，成功即返回
 */
async function requestHtmlWithFailover(pathOrUrl, options = {}) {
    if (isAbsoluteUrl(pathOrUrl)) {
        return requestHtml(pathOrUrl, options);
    }

    let lastError = null;
    const startIndex = currentHostIndex;

    for (let i = 0; i < HOSTS.length; i++) {
        const host = HOSTS[currentHostIndex];
        const url = fixUrl(pathOrUrl, host);
        try {
            logInfo("请求页面", { host, path: pathOrUrl });
            const html = await requestHtml(url, {
                ...options,
                headers: {
                    ...(options.headers || {}),
                    Referer: `${host}/`,
                    Origin: host,
                },
            });

            if (html && html.includes("<html")) {
                if (i > 0) {
                    logInfo("站点切换成功", { from: HOSTS[startIndex], to: host });
                }
                return { html, host };
            }

            lastError = new Error("empty or invalid html");
            logWarn("页面内容异常，切换下一个 host", { host });
        } catch (error) {
            lastError = error;
            logWarn("请求失败，切换下一个 host", { host, error: error.message || String(error) });
        }

        rotateHost();
    }

    throw lastError || new Error("all hosts failed");
}

// ==================== 列表解析 ====================
function pickFirstText($root, selectors = []) {
    for (const selector of selectors) {
        const value = $root.find(selector).first().text().trim();
        if (value) {
            return value;
        }
    }
    return "";
}

function pickFirstAttr($root, selectors = [], attrName = "href") {
    for (const selector of selectors) {
        const value = $root.find(selector).first().attr(attrName);
        if (value) {
            return String(value).trim();
        }
    }
    return "";
}

function parsePosterItem($, element, host) {
    const $item = $(element);

    const title =
        pickFirstAttr($item, ["h3 a", ".title a", ".li-img a", "a"], "title") ||
        pickFirstText($item, ["h3 a", ".title a", "a"]);

    if (!title) {
        return null;
    }

    const desc = pickFirstText($item, [".tag", ".label", ".remark"]);
    const img = pickFirstAttr($item, [".li-img img", "img"], "src");
    const href = pickFirstAttr($item, ["h3 a", ".title a", ".li-img a", "a"], "href");

    if (!href) {
        return null;
    }

    return {
        vod_id: fixUrl(href, host),
        vod_name: title,
        vod_pic: normalizeImage(img, host),
        vod_remarks: desc || "",
    };
}

function parseVideoList(html, host) {
    const $ = cheerio.load(html || "");
    const nodes = $(".content-list li");
    const list = [];
    nodes.each((_, element) => {
        const item = parsePosterItem($, element, host);
        if (item) {
            list.push(item);
        }
    });
    return list;
}

function buildCategoryPath(categoryId, page, filters = {}) {
    const area = String(filters.area || "").trim();
    const sort = String(filters.sort || "time").trim() || "time";
    const type = String(filters.type || "").trim();
    const lang = String(filters.lang || "").trim();
    const year = String(filters.year || "").trim();
    return `/ms/${categoryId}-${area}-${sort}-${type}-${lang}-------${year}.html?page=${page}`;
}

function parsePanType(url) {
    const source = String(url || "");
    if (!source) {
        return "其他";
    }
    const mapping = {
        "pan.baidu.com": "百度",
        "pan.baiduimg.com": "百度",
        "pan.quark.cn": "夸克",
        "drive.uc.cn": "UC",
        "cloud.189.cn": "天翼",
        "yun.139.com": "移动",
        "alipan.com": "阿里",
        "pan.aliyun.com": "阿里",
        "115.com": "115",
        "115cdn.com": "115",
    };

    for (const [key, name] of Object.entries(mapping)) {
        if (source.includes(key)) {
            return name;
        }
    }
    return "其他";
}

function isPanUrl(url) {
    const source = String(url || "");
    if (!source) {
        return false;
    }
    return [
        "pan.baidu.com",
        "pan.baiduimg.com",
        "pan.quark.cn",
        "drive.uc.cn",
        "cloud.189.cn",
        "yun.139.com",
        "alipan.com",
        "pan.aliyun.com",
        "115.com",
        "115cdn.com",
    ].some((key) => source.includes(key));
}

function isDirectVideoUrl(url) {
    if (!url) {
        return false;
    }
    return /\.(m3u8|mp4|flv|avi|mkv|ts|mov|webm)(\?|$)/i.test(String(url));
}

function normalizeShareUrl(url) {
    if (!url) {
        return "";
    }
    let value = String(url).trim();
    if (value.startsWith("push://")) {
        value = value.slice("push://".length);
    }
    if (value.startsWith("push:")) {
        value = value.slice("push:".length);
    }
    const dnIndex = value.toLowerCase().indexOf("&dn=");
    if (dnIndex !== -1) {
        value = value.slice(0, dnIndex);
    }
    return value.trim();
}

function isVideoFile(file) {
    if (!file || !file.file_name) {
        return false;
    }
    const fileName = String(file.file_name).toLowerCase();
    const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];
    for (const ext of videoExtensions) {
        if (fileName.endsWith(ext)) {
            return true;
        }
    }
    if (file.format_type) {
        const formatType = String(file.format_type).toLowerCase();
        if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) {
            return true;
        }
    }
    return false;
}

function getFileId(file) {
    return file?.fid || file?.file_id || "";
}

function getFileName(file) {
    return file?.file_name || file?.name || "";
}

async function getAllVideoFiles(shareURL, files) {
    const videoFiles = [];
    for (const file of files || []) {
        if (file.file && isVideoFile(file)) {
            videoFiles.push(file);
        } else if (file.dir) {
            try {
                const subFileId = getFileId(file);
                if (!subFileId) {
                    continue;
                }
                const subFileList = await OmniBox.getDriveFileList(shareURL, subFileId);
                if (subFileList && Array.isArray(subFileList.files)) {
                    const subVideos = await getAllVideoFiles(shareURL, subFileList.files);
                    videoFiles.push(...subVideos);
                }
            } catch (error) {
                logWarn("获取网盘子目录文件失败", { error: error.message || String(error) });
            }
        }
    }
    return videoFiles;
}

const panShareCache = new Map();
const panRouteCache = new Map();

async function loadPanFiles(shareURL) {
    if (!shareURL) {
        return null;
    }
    if (panShareCache.has(shareURL)) {
        return panShareCache.get(shareURL);
    }
    try {
        await OmniBox.getDriveInfoByShareURL(shareURL);
        const fileList = await OmniBox.getDriveFileList(shareURL, "0");
        const files = Array.isArray(fileList?.files) ? fileList.files : [];
        const videos = await getAllVideoFiles(shareURL, files);
        const result = { videos };
        panShareCache.set(shareURL, result);
        return result;
    } catch (error) {
        logWarn("读取网盘文件失败", { shareURL, error: error.message || String(error) });
        return null;
    }
}

function extractRouteTypeFromFlag(flag) {
    const value = String(flag || "").trim();
    if (!value) {
        return "";
    }
    if (value.includes("-")) {
        const last = value.split("-").pop();
        return String(last || "").trim();
    }
    return value;
}

function hasValidPlayUrls(playInfo) {
    return Array.isArray(playInfo?.url) && playInfo.url.some((item) => item?.url);
}

async function detectValidPanRoutes(shareURL, videos = [], maxNeeded = MAX_PAN_VALID_ROUTES) {
    const routeLimit = Math.max(1, Math.min(MAX_PAN_VALID_ROUTES, parseInt(maxNeeded, 10) || MAX_PAN_VALID_ROUTES));
    const cacheKey = `${shareURL}::${routeLimit}`;
    if (panRouteCache.has(cacheKey)) {
        return panRouteCache.get(cacheKey);
    }

    const sample = (videos || []).find((x) => getFileId(x));
    if (!sample) {
        const fallback = PAN_ROUTE_NAMES.length > 0 ? PAN_ROUTE_NAMES : ["直连"];
        const result = fallback.slice(0, routeLimit);
        panRouteCache.set(cacheKey, result);
        return result;
    }

    const sampleFileId = getFileId(sample);
    const validRoutes = [];
    const candidates = PAN_ROUTE_NAMES.length > 0 ? PAN_ROUTE_NAMES : ["直连"];

    for (const routeName of candidates.slice(0, routeLimit)) {
        try {
            const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, sampleFileId, routeName);
            if (hasValidPlayUrls(playInfo)) {
                validRoutes.push(routeName);
            }
        } catch (error) {
            logWarn("网盘线路有效性检测失败", { shareURL, routeName, error: error.message || String(error) });
        }
    }

    const result = validRoutes.length > 0 ? validRoutes.slice(0, routeLimit) : ["直连"];
    panRouteCache.set(cacheKey, result);
    return result;
}

function isBlockedLineName(name) {
    if (!name) {
        return false;
    }
    return String(name).includes("磁力");
}

// ==================== 标准接口 ====================
async function home(params) {
    try {
        const { html, host } = await requestHtmlWithFailover("/");
        const list = parseVideoList(html, host);
        logInfo("首页加载完成", { host, count: list.length });
        return {
            class: CLASSES,
            filters: FILTERS,
            list,
        };
    } catch (error) {
        logError("首页加载失败", error);
        return {
            class: CLASSES,
            filters: FILTERS,
            list: [],
        };
    }
}

async function category(params) {
    const categoryId = String(params.categoryId || "1");
    const page = parsePage(params.page, 1);
    const filters = parseFilters(params);

    try {
        const path = buildCategoryPath(categoryId, page, filters);
        const { html, host } = await requestHtmlWithFailover(path);
        const list = parseVideoList(html, host);
        logInfo("分类加载完成", { categoryId, page, host, count: list.length, filters });
        return {
            page,
            pagecount: list.length >= 20 ? page + 1 : page,
            total: list.length,
            list,
        };
    } catch (error) {
        logError("分类加载失败", error);
        return {
            page,
            pagecount: page,
            total: 0,
            list: [],
        };
    }
}

async function search(params) {
    const keyword = String(params.keyword || params.wd || "").trim();
    const page = parsePage(params.page, 1);

    if (!keyword) {
        logWarn("搜索关键词为空");
        return {
            page,
            pagecount: page,
            total: 0,
            list: [],
        };
    }

    try {
        const path = `/vs/-------------.html?wd=${encodeURIComponent(keyword)}&page=${page}`;
        const { html, host } = await requestHtmlWithFailover(path);
        const list = parseVideoList(html, host);
        logInfo("搜索完成", { keyword, page, host, count: list.length });
        return {
            page,
            pagecount: list.length >= 20 ? page + 1 : page,
            total: list.length,
            list,
        };
    } catch (error) {
        logError("搜索失败", error);
        return {
            page,
            pagecount: page,
            total: 0,
            list: [],
        };
    }
}

function parseDetailInfo(html, host) {
    const $ = cheerio.load(html || "");

    const title =
        $(".main-ui-meta h1").first().clone().children("span").remove().end().text().trim() ||
        $(".detail-title").first().text().trim() ||
        "";

    let typeName = "";
    const typeBox = html.match(/<div><span>类型：<\/span>[\s\S]*?<\/div>/);
    if (typeBox && typeBox[0]) {
        const names = [...typeBox[0].matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
        typeName = [...new Set(names)].join("/");
    }

    let area = "";
    const areaBox = html.match(/<div><span>地区：<\/span>[\s\S]*?<\/div>/);
    if (areaBox && areaBox[0]) {
        const names = [...areaBox[0].matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
        area = [...new Set(names)].join("/");
    }

    const showContent = $(".movie-introduce .zkjj_a").first().text().replace(/\s*\[展开全部\]/g, "").trim();
    const hideContent = $(".movie-introduce .sqjj_a").first().text().replace(/\s*\[收起部分\]/g, "").trim();

    const directorMatch = html.match(/<div>[\s\S]*?导演：[\s\S]*?<\/div>/);
    const director = directorMatch?.[0]?.match(/<a[^>]*>([^<]+)<\/a>/)?.[1] || "";

    return {
        vod_name: title,
        type_name: typeName || $(".main-ui-meta div:nth-child(9) a").first().text().trim(),
        vod_pic: normalizeImage($(".img img").first().attr("src"), host),
        vod_content: hideContent || showContent || $(".detail-content").first().text().trim() || "",
        vod_remarks: $(".otherbox").first().text().trim() || "",
        vod_year: ($(".main-ui-meta h1 span.year").first().text() || "").replace(/[()]/g, "").trim(),
        vod_area: area || $(".main-ui-meta div:nth-child(11) a").first().text().trim(),
        vod_actor: ($(".main-ui-meta div.text-overflow").first().text() || "").replace(/^主演：/, "").trim(),
        vod_director: director,
    };
}

async function parsePlaySources(html, videoId, host) {
    const $ = cheerio.load(html || "");
    const playSources = [];

    const tabItems = $(".py-tabs li").toArray();
    const episodeContainers = $(".bd ul.player").toArray();

    const lineCount = Math.min(tabItems.length, episodeContainers.length);
    for (let i = 0; i < lineCount; i++) {
        const lineNameRaw = $(tabItems[i]).text().replace(/\s+/g, "").trim();
        const lineName = lineNameRaw || `线路${i + 1}`;

        if (isBlockedLineName(lineName)) {
            continue;
        }

        const episodes = [];
        $(episodeContainers[i])
            .find("a")
            .each((idx, node) => {
                const name = $(node).text().trim() || `第${idx + 1}集`;
                const fid = `${videoId}#${i}#${idx}`;
                episodes.push({
                    name,
                    playId: `${videoId}|${i}|${idx}|||${encodeMeta({ sid: String(videoId || ""), fid, e: name })}`,
                    _fid: fid,
                    _rawName: name,
                });
            });

        if (episodes.length === 0) {
            const fid = `${videoId}#${i}#0`;
            episodes.push({
                name: "正片",
                playId: `${videoId}|${i}|0|||${encodeMeta({ sid: String(videoId || ""), fid, e: "正片" })}`,
                _fid: fid,
                _rawName: "正片",
            });
        }

        playSources.push({
            name: lineName,
            episodes,
        });
    }

    // 网盘链接
    const panRegex = /https?:\/\/(pan\.baidu\.com|pan\.quark\.cn|drive\.uc\.cn|cloud\.189\.cn|yun\.139\.com|alipan\.com|pan\.aliyun\.com|115\.com|115cdn\.com)\/[^"'\s>]+/g;
    const htmlPanLinks = html.match(panRegex) || [];
    const anchorPanLinks = $("a")
        .toArray()
        .flatMap((a) => {
            const links = [];
            const href = $(a).attr("href") || "";
            const clipboard = $(a).attr("data-clipboard-text") || "";
            if (isPanUrl(href)) {
                links.push(href);
            }
            if (isPanUrl(clipboard)) {
                links.push(clipboard);
            }
            return links;
        });

    const allPanLinks = [...new Set([...htmlPanLinks, ...anchorPanLinks])];
    const grouped = {};

    for (const link of allPanLinks) {
        const type = parsePanType(link);
        if (type === "其他") {
            continue;
        }
        if (!grouped[type]) {
            grouped[type] = [];
        }
        grouped[type].push(link);
    }

    for (const [type, links] of Object.entries(grouped)) {
        let builtLinesForPan = 0;
        const maxLinesPerPan = Math.max(1, MAX_PAN_VALID_ROUTES);

        for (let index = 0; index < links.length; index++) {
            if (builtLinesForPan >= maxLinesPerPan) {
                break;
            }

            const link = links[index];
            const shareURL = normalizeShareUrl(link);
            if (!isPanUrl(shareURL)) {
                continue;
            }

            const sourceName = `${type}网盘${index + 1}`;

            const panInfo = await loadPanFiles(shareURL);
            const files = panInfo?.videos || [];

            if (!files.length) {
                playSources.push({
                    name: sourceName,
                    episodes: [
                        {
                            name: sourceName,
                            playId: shareURL,
                            _rawName: sourceName,
                        },
                    ],
                });
                builtLinesForPan += 1;
                continue;
            }

            const panEpisodes = [];

            for (const file of files) {
                const fileId = getFileId(file);
                if (!fileId) {
                    continue;
                }
                const fileName = getFileName(file) || sourceName;
                const fid = `${videoId}#pan#${index}#${fileId}`;
                const combinedId = `${shareURL}|${fileId}|||${encodeMeta({ sid: String(videoId || ""), fid, e: fileName })}`;
                panEpisodes.push({
                    name: fileName,
                    playId: combinedId,
                    _fid: fid,
                    _rawName: fileName,
                });
            }

            if (panEpisodes.length > 0) {
                const remainSlots = maxLinesPerPan - builtLinesForPan;
                if (remainSlots <= 0) {
                    break;
                }

                const validRoutes = await detectValidPanRoutes(shareURL, files, remainSlots);
                for (const routeName of validRoutes.slice(0, remainSlots)) {
                    playSources.push({
                        name: `${sourceName}-${routeName}`,
                        episodes: panEpisodes.map((ep) => ({
                            name: ep.name,
                            playId: ep.playId,
                            _fid: ep._fid,
                            _rawName: ep._rawName,
                        })),
                    });
                    builtLinesForPan += 1;
                    if (builtLinesForPan >= maxLinesPerPan) {
                        break;
                    }
                }
            }
        }
    }

    if (playSources.length === 0) {
        playSources.push({
            name: "默认线路",
            episodes: [
                {
                    name: "正片",
                    playId: `${videoId}|0|0|||${encodeMeta({ sid: String(videoId || ""), fid: `${videoId}#0#0`, e: "正片" })}`,
                    _fid: `${videoId}#0#0`,
                    _rawName: "正片",
                },
            ],
        });
    }

    logInfo("解析播放线路完成", { host, lines: playSources.length });
    return playSources;
}

function extractVideoId(urlOrId) {
    const value = String(urlOrId || "");
    const match = value.match(/\/mv\/(\d+)\.html/);
    return match ? match[1] : value;
}

async function detail(params) {
    const inputId = params.videoId || "";
    const videoId = extractVideoId(inputId);

    if (!videoId) {
        logWarn("详情请求缺少有效 videoId", { inputId });
        return { list: [] };
    }

    const path = `/mv/${videoId}.html`;

    try {
        const { html, host } = await requestHtmlWithFailover(path);
        const info = parseDetailInfo(html, host);
        const playSources = await parsePlaySources(html, videoId, host);

        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";
        const scrapeCandidates = [];
        const seenFids = new Set();

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                if (!ep._fid) continue;
                if (seenFids.has(ep._fid)) continue;
                seenFids.add(ep._fid);
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
                const scrapingResult = await OmniBox.processScraping(String(videoId || ""), info.vod_name || "", info.vod_name || "", scrapeCandidates);
                logInfo("刮削处理完成", { length: JSON.stringify(scrapingResult || {}).length });
                const metadata = await OmniBox.getScrapeMetadata(String(videoId || ""));
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
            } catch (error) {
                logWarn("刮削处理失败", { error: error.message || String(error) });
            }
        }

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                if (!mapping) continue;
                const newName = buildScrapedEpisodeName(scrapeData, mapping, ep.name);
                if (newName && newName !== ep.name) {
                    logInfo("应用刮削后源文件名", { old: ep.name, new: newName });
                    ep.name = newName;
                }
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }

            const hasEpisodeNumber = (source.episodes || []).some((ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null);
            if (hasEpisodeNumber) {
                source.episodes.sort((a, b) => {
                    const sa = a._seasonNumber || 0;
                    const sb = b._seasonNumber || 0;
                    if (sa !== sb) return sa - sb;
                    const ea = a._episodeNumber || 0;
                    const eb = b._episodeNumber || 0;
                    return ea - eb;
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

        const vod = {
            vod_id: videoId,
            ...info,
            vod_play_sources: normalizedPlaySources,
        };

        if (scrapeData) {
            vod.vod_name = scrapeData.title || vod.vod_name;
            if (scrapeData.posterPath) {
                vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            }
            if (scrapeData.overview) {
                vod.vod_content = scrapeData.overview;
            }
            if (scrapeData.releaseDate) {
                vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year || "";
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

        return {
            list: [vod],
        };
    } catch (error) {
        logError("详情解析失败", error);
        return { list: [] };
    }
}

async function play(params) {
    let playId = String(params.playId || "").trim();
    const flag = String(params.flag || "").trim();
    let playMeta = {};

    logInfo("开始播放解析", { playId, flag });

    if (!playId) {
        return {
            urls: [{ name: "解析失败", url: "" }],
            parse: 1,
            header: {
                ...DEFAULT_HEADERS,
                Referer: `${getCurrentHost()}/`,
            },
        };
    }

    if (playId.includes("|||")) {
        const [mainPlayId, metaB64] = playId.split("|||");
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        logInfo("解析透传信息", { sid: playMeta.sid || "", fid: playMeta.fid || "", e: playMeta.e || "" });
    }

    if (playId && playId.includes("|")) {
        const [rawShareURL, fileId] = playId.split("|");
        const shareURL = normalizeShareUrl(rawShareURL);
        if (shareURL && fileId && isPanUrl(shareURL)) {
            try {
                const routeType = extractRouteTypeFromFlag(flag) || "直连";
                const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
                const urlList = Array.isArray(playInfo?.url) ? playInfo.url : [];
                const urlsResult = urlList.map((item) => ({
                    name: item.name || "播放",
                    url: item.url,
                }));
                if (urlsResult.length > 0) {
                    return {
                        urls: urlsResult,
                        flag: shareURL,
                        header: playInfo?.header || {},
                        parse: 0,
                        danmaku: playInfo?.danmaku || [],
                    };
                }
            } catch (error) {
                logWarn("网盘文件播放失败，回退 push", { error: error.message || String(error) });
                const pushUrl = shareURL.startsWith("push://") ? shareURL : `push://${shareURL}`;
                return {
                    urls: [{ name: "网盘资源", url: pushUrl }],
                    parse: 0,
                    header: {},
                };
            }
        }
    }

    // 磁力直出
    if (playId.startsWith("magnet:")) {
        return {
            urls: [{ name: "磁力资源", url: playId }],
            parse: 0,
            header: {
                ...DEFAULT_HEADERS,
                Referer: `${getCurrentHost()}/`,
            },
        };
    }

    // 网盘走 push
    if (isPanUrl(playId)) {
        const pushUrl = playId.startsWith("push://") ? playId : `push://${playId}`;
        return {
            urls: [{ name: "网盘资源", url: pushUrl }],
            parse: 0,
            header: {},
        };
    }

    // 常规剧集 ID: videoId|lineIndex|episodeIndex
    let resolvedPlayUrl = "";
    const parts = playId.split("|");
    if (parts.length === 3 && parts.every((x) => x !== "")) {
        const videoId = parts[0];
        const lineIndex = parseInt(parts[1], 10);
        const episodeIndex = parseInt(parts[2], 10);

        if (Number.isFinite(lineIndex) && Number.isFinite(episodeIndex)) {
            resolvedPlayUrl = `${getCurrentHost()}/py/${videoId}-${lineIndex + 1}-${episodeIndex + 1}.html`;
        }
    }

    if (!resolvedPlayUrl) {
        resolvedPlayUrl = fixUrl(playId, getCurrentHost());
    }

    const defaultHeader = {
        ...DEFAULT_HEADERS,
        Referer: `${getCurrentHost()}/`,
        Origin: getCurrentHost(),
    };

    // 直接视频地址不再二次嗅探
    if (isDirectVideoUrl(resolvedPlayUrl)) {
        logInfo("检测到直链视频，直接返回", { url: resolvedPlayUrl });
        return {
            urls: [{ name: "默认线路", url: resolvedPlayUrl }],
            parse: 0,
            header: defaultHeader,
        };
    }

    // 非视频后缀：走嗅探提取真实地址
    try {
        logInfo("检测到非视频格式，开始嗅探", { url: resolvedPlayUrl });
        const sniffed = await OmniBox.sniffVideo(resolvedPlayUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", { url: sniffed.url });

            let danmaku = [];
            if (DANMU_API) {
                let vodName = String(params.vodName || "").trim();
                let episodeName = String(params.episodeName || playMeta.e || "").trim();
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
                    logWarn("读取刮削元数据失败", { error: error.message || String(error) });
                }

                const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
                if (fileName) {
                    danmaku = await matchDanmu(fileName);
                    if (danmaku.length > 0) {
                        logInfo("弹幕匹配成功", { count: danmaku.length, fileName });
                    }
                }
            }

            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || defaultHeader,
                danmaku,
            };
        }
        logWarn("嗅探未返回有效直链，回退解析页", { url: resolvedPlayUrl });
    } catch (error) {
        logWarn("嗅探失败，回退解析页", { error: error.message || String(error) });
    }

    return {
        urls: [{ name: "默认线路", url: resolvedPlayUrl }],
        parse: 1,
        header: defaultHeader,
    };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
