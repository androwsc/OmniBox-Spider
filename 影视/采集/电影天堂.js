// @name 电影天堂
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @version 1.0.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/电影天堂.js
const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
// 采集站 API 地址（优先使用环境变量，如果没有则使用默认值）
// 例如：https://example.com/api.php/provide/vod/
const SITE_API = process.env.SITE_API || "https://caiji.dyttzyapi.com/api.php/provide/vod";
// 弹幕 API 地址（优先使用环境变量，如果没有则使用默认值）
// 例如：https://danmu.example.com
// 如果为空，则不启用弹幕功能
const DANMU_API = process.env.DANMU_API || "";

// EXCLUDE_CLASS_NAMES 环境变量（分类屏蔽关键词）
// 支持 3 种写法：
// 1) JSON 数组（推荐）：["伦理片","情色"]
// 2) 逗号分隔：伦理片,情色
// 3) 竖线分隔：伦理片|情色
// 行为说明：
// - 未设置该环境变量：使用 DEFAULT_EXCLUDE_CLASS_NAMES
// - 显式设置为空字符串：不屏蔽任何分类（返回 []）
const EXCLUDE_CLASS_NAMES_ENV = process.env.EXCLUDE_CLASS_NAMES || "伦理片";
// ==================== 配置区域结束 ====================

function parseExcludeClassNamesFromEnv() {
    const raw = EXCLUDE_CLASS_NAMES_ENV;

    const text = raw.trim();
    // 环境变量显式留空时，表示不屏蔽任何分类
    if (!text) {
        return [];
    }

    let values = [];

    // 优先支持 JSON 数组格式: ["伦理片","其他"]
    if (text.startsWith("[") && text.endsWith("]")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                values = parsed;
            }
        } catch (error) {
            OmniBox.log("warn", `EXCLUDE_CLASS_NAMES 环境变量 JSON 解析失败: ${error.message}`);
        }
    }

    // 兼容逗号/竖线分隔格式: 伦理片,情色片 或 伦理片|情色片
    if (values.length === 0) {
        values = text.split(/[,，|]/g);
    }

    const normalized = Array.from(
        new Set(
            values
                .map((item) => String(item || "").trim())
                .filter(Boolean)
        )
    );

    return normalized;
}

const EXCLUDE_CLASS_NAMES = parseExcludeClassNamesFromEnv();

function shouldExcludeClassName(name) {
    const className = String(name || "").trim();
    if (!className || EXCLUDE_CLASS_NAMES.length === 0) {
        return false;
    }
    return EXCLUDE_CLASS_NAMES.some((keyword) => className.includes(keyword));
}

function getEffectiveCategoryGroup(group) {
    const allIds = Array.isArray(group?.allIds) ? group.allIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const types = Array.isArray(group?.types) ? group.types : [];

    if (types.length === 0) {
        return {
            ...group,
            allIds,
            types,
        };
    }

    const excludedTypeIds = new Set();
    const filteredTypes = types.filter((item) => {
        if (!item || typeof item !== "object") {
            return false;
        }
        const value = String(item.value || "").trim();
        const name = String(item.name || "").trim();
        if (value && value !== "all" && shouldExcludeClassName(name)) {
            excludedTypeIds.add(value);
            return false;
        }
        return true;
    });

    const filteredAllIds = allIds.filter((id) => !excludedTypeIds.has(id));

    return {
        ...group,
        allIds: filteredAllIds,
        types: filteredTypes,
    };
}

// 自定义分类配置
// 格式: { "顶层分类ID": { name: "显示名称", allIds: ["子分类ID1", "子分类ID2", ...], types: [筛选项] } }
const CATEGORY_CONFIG = {
    "1": {
        name: "电影",
        allIds: ["6", "7", "8", "9", "10", "11", "12", "20", "37", "34"],
        types: [
            { name: "全部", value: "all" },
            { name: "动作片", value: "6" },
            { name: "喜剧片", value: "7" },
            { name: "爱情片", value: "8" },
            { name: "科幻片", value: "9" },
            { name: "恐怖片", value: "10" },
            { name: "剧情片", value: "11" },
            { name: "战争片", value: "12" },
            { name: "记录片", value: "20" },
            { name: "动画片", value: "37" },
            { name: "伦理片", value: "34" },
        ],
    },
    "2": {
        name: "电视剧",
        allIds: ["13", "16", "15", "22", "24", "14", "21", "23"],
        types: [
            { name: "全部", value: "all" },
            { name: "国产剧", value: "13" },
            { name: "欧美剧", value: "16" },
            { name: "韩剧", value: "15" },
            { name: "日剧", value: "22" },
            { name: "泰剧", value: "24" },
            { name: "港剧", value: "14" },
            { name: "台剧", value: "21" },
            { name: "海外剧", value: "23" },
        ],
    },
    "3": {
        name: "动漫",
        allIds: ["29", "30", "31", "32", "33"],
        types: [
            { name: "全部", value: "all" },
            { name: "国产动漫", value: "29" },
            { name: "日韩动漫", value: "30" },
            { name: "欧美动漫", value: "31" },
            { name: "欧美动漫", value: "31" },
            { name: "港台动漫", value: "32" },
            { name: "海外动漫", value: "33" },
        ],
    },
    "4": {
        name: "综艺",
        allIds: ["25", "26", "27", "28"],
        types: [
            { name: "全部", value: "all" },
            { name: "大陆综艺", value: "25" },
            { name: "港台综艺", value: "26" },
            { name: "日韩综艺", value: "27" },
            { name: "欧美综艺", value: "28" },
        ],
    },
    "5": {
        name: "短剧",
        allIds: ["36"],
        types: [],
    },
};

function buildHomeFiltersFromCategoryConfig() {
    const filters = {};
    for (const [typeId, config] of Object.entries(CATEGORY_CONFIG)) {
        const effectiveGroup = getEffectiveCategoryGroup(config);
        const types = Array.isArray(effectiveGroup?.types) ? effectiveGroup.types : [];
        if (types.length === 0) {
            continue;
        }
        const values = types
            .map((item) => {
                if (!item || typeof item !== "object") {
                    return null;
                }
                const name = String(item.name || "").trim();
                const value = String(item.value || "").trim();
                if (!name && !value) {
                    return null;
                }
                return {
                    name: name || value,
                    value: value,
                };
            })
            .filter(Boolean);

        if (values.length > 0) {
            filters[typeId] = [
                {
                    key: "cate",
                    name: "类型",
                    init: "all",
                    value: values,
                },
            ];
        }
    }
    return filters;
}

function parseCategoryFilterParams(params = {}) {
    const result = {};

    if (params.filters && typeof params.filters === "object") {
        Object.assign(result, params.filters);
    } else if (typeof params.filters === "string" && params.filters.trim()) {
        try {
            const parsed = JSON.parse(params.filters);
            if (parsed && typeof parsed === "object") {
                Object.assign(result, parsed);
            }
        } catch (error) {
            OmniBox.log("warn", `解析 filters 参数失败: ${error.message}`);
        }
    }

    if (params.extend) {
        try {
            const decodedStr = Buffer.from(String(params.extend), "base64").toString("utf-8");
            const extObj = JSON.parse(decodedStr);
            if (extObj && typeof extObj === "object") {
                Object.assign(result, extObj);
            }
        } catch (error) {
            OmniBox.log("warn", `解析 extend 参数失败: ${error.message}`);
        }
    }

    return result;
}

// 全局参数
const PAGE_LIMIT = 20; // 每页数量
const PER_TYPE_PAGE = 3; // 合并时每个子分类抓取的页数

// ==================== 配置区域结束 ====================

/**
 * 发送 HTTP 请求到采集站
 * @param {Object} params - 查询参数对象
 * @returns {Promise<Object>} API 响应数据
 */
async function requestSiteAPI(params = {}) {
    if (!SITE_API) {
        throw new Error("请配置采集站 API 地址（SITE_API 环境变量）");
    }
    const url = new URL(SITE_API);
    // 添加全局分页限制
    if (!params.pagesize) {
        params.pagesize = PAGE_LIMIT;
    }
    if (!params.limit) {
        params.limit = PAGE_LIMIT;
    }
    Object.keys(params).forEach((key) => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
            url.searchParams.append(key, params[key]);
        }
    });
    OmniBox.log("info", `请求采集站: ${url.toString()}`);
    try {
        const response = await OmniBox.request(url.toString(), {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        });
        if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
        }
        const data = JSON.parse(response.body);
        return data;
    } catch (error) {
        OmniBox.log("error", `请求采集站失败: ${error.message}`);
        throw error;
    }
}

/**
 * 安全转换为整数
 * @param {*} value - 要转换的值
 * @returns {number} 整数
 */
function toInt(value) {
    if (typeof value === "number") {
        return Math.floor(value);
    }
    if (typeof value === "string") {
        const num = parseInt(value, 10);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}

/**
 * 格式化视频数据
 * @param {Array} list - 原始视频列表
 * @returns {Array} 格式化后的视频列表
 */
function formatVideos(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item) => {
            if (typeof item !== "object" || item === null) {
                return null;
            }
            const vodId = String(item.vod_id || item.VodID || "");
            let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");
            // 处理多线路播放源
            if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
                const lines = vodPlayFrom.split("$$$");
                const processedLines = lines
                    .map((line) => {
                        const trimmedLine = line.trim();
                        if (trimmedLine) {
                            return `${trimmedLine}-${vodId}`;
                        }
                        return trimmedLine;
                    })
                    .filter((line) => line);
                vodPlayFrom = processedLines.join("$$$");
            } else if (vodPlayFrom && vodId) {
                vodPlayFrom = `${vodPlayFrom}-${vodId}`;
            }
            return {
                vod_id: vodId,
                vod_name: String(item.vod_name || item.VodName || ""),
                vod_pic: String(item.vod_pic || item.VodPic || ""),
                type_id: String(item.type_id || item.TypeID || ""),
                type_name: String(item.type_name || item.TypeName || ""),
                vod_year: String(item.vod_year || item.VodYear || ""),
                vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
                vod_time: String(item.vod_time || item.VodTime || ""),
                vod_play_from: vodPlayFrom,
                vod_play_url: String(item.vod_play_url || item.VodPlayURL || ""),
                vod_douban_score: String(item.vod_douban_score || item.VodDoubanScore || ""),
            };
        })
        .filter((item) => item !== null && item.vod_id);
}

/**
 * 将旧格式的播放源转换为新格式（vod_play_sources）
 * ... (此处省略 convertToPlaySources, formatDetailVideos, formatClasses, enrichVideosWithDetails 函数，它们与原文件相同) ...
 */
function convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId, detailVodName = "") {
    const playSources = [];
    if (!vodPlayFrom || !vodPlayUrl) {
        return playSources;
    }
    const sourceNames = vodPlayFrom
        .split("$$$")
        .map((name) => name.trim())
        .filter((name) => name);
    const sourceUrls = vodPlayUrl
        .split("$$$")
        .map((url) => url.trim())
        .filter((url) => url);
    const maxLength = Math.max(sourceNames.length, sourceUrls.length);
    for (let i = 0; i < maxLength; i++) {
        const sourceName = sourceNames[i] || `线路${i + 1}`;
        const sourceUrl = sourceUrls[i] || "";
        let cleanSourceName = sourceName;
        if (vodId && sourceName.endsWith(`-${vodId}`)) {
            cleanSourceName = sourceName.substring(0, sourceName.length - `-${vodId}`.length);
        }
        const episodes = [];
        if (sourceUrl) {
            const episodeSegments = sourceUrl
                .split("#")
                .map((seg) => seg.trim())
                .filter((seg) => seg);
            for (let epIndex = 0; epIndex < episodeSegments.length; epIndex++) {
                const segment = episodeSegments[epIndex];
                const parts = segment.split("$");
                const fid = `${vodId}#${i}#${epIndex}`;
                if (parts.length >= 2) {
                    const episodeName = parts[0].trim();
                    const playId = parts.slice(1).join("$").trim();
                    if (episodeName && playId) {
                        episodes.push({
                            name: episodeName,
                            playId: `${playId}|||${encodeMeta({ value: detailVodName, e: episodeName, sid: vodId, fid: fid })}`,
                            _fid: fid,
                            _rawName: episodeName,
                        });
                    }
                } else if (parts.length === 1 && parts[0]) {
                    const episodeName = `第${episodes.length + 1}集`;
                    episodes.push({
                        name: episodeName,
                        playId: `${parts[0].trim()}|||${encodeMeta({ value: detailVodName, e: episodeName, sid: vodId, fid: fid })}`,
                        _fid: fid,
                        _rawName: episodeName,
                    });
                }
            }
        }
        if (episodes.length > 0) {
            playSources.push({
                name: cleanSourceName,
                episodes: episodes,
            });
        }
    }
    return playSources;
}

function formatDetailVideos(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item) => {
            if (typeof item !== "object" || item === null) {
                return null;
            }
            const content = String(item.vod_content || item.VodContent || "").trim();
            const vodId = String(item.vod_id || item.VodID || "");
            let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");
            if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
                const lines = vodPlayFrom.split("$$$");
                const processedLines = lines
                    .map((line) => {
                        const trimmedLine = line.trim();
                        if (trimmedLine) {
                            return `${trimmedLine}-${vodId}`;
                        }
                        return trimmedLine;
                    })
                    .filter((line) => line);
                vodPlayFrom = processedLines.join("$$$");
            } else if (vodPlayFrom && vodId) {
                vodPlayFrom = `${vodPlayFrom}-${vodId}`;
            }
            const vodPlayUrl = String(item.vod_play_url || item.VodPlayURL || "");
            const detailVodName = String(item.vod_name || item.VodName || "");
            const vodPlaySources = convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId, detailVodName);
            return {
                vod_id: vodId,
                vod_name: detailVodName,
                vod_pic: String(item.vod_pic || item.VodPic || ""),
                type_name: String(item.type_name || item.TypeName || ""),
                vod_year: String(item.vod_year || item.VodYear || ""),
                vod_area: String(item.vod_area || item.VodArea || ""),
                vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
                vod_actor: String(item.vod_actor || item.VodActor || ""),
                vod_director: String(item.vod_director || item.VodDirector || ""),
                vod_content: content,
                vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined,
                vod_douban_score: String(item.vod_douban_score || item.VodDoubanScore || ""),
            };
        })
        .filter((item) => item !== null && item.vod_id);
}

function encodeMeta(obj) {
    try {
        return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
    } catch (error) {
        return "";
    }
}

function decodeMeta(str) {
    try {
        const raw = Buffer.from(str || "", "base64").toString("utf8");
        return JSON.parse(raw || "{}");
    } catch (error) {
        return {};
    }
}

function preprocessTitle(title) {
    if (!title) return "";
    return String(title)
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ")
        .trim();
}

function chineseToArabic(cn) {
    const map = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (!isNaN(cn)) return parseInt(cn, 10);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === "十") return 10 + map[cn[1]];
        if (cn[1] === "十") return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = preprocessTitle(title);

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
}

function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") return vodName;

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) return `${vodName} S01E0${epNum}`;
            return `${vodName} S01E${epNum}`;
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
        const hit = scrapeData.episodes.find((ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber);
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

function formatClasses(classes) {
    if (!Array.isArray(classes)) {
        return [];
    }
    const seen = new Set();
    const result = [];
    for (const cls of classes) {
        if (typeof cls !== "object" || cls === null) {
            continue;
        }
        const typeId = String(cls.type_id || cls.TypeID || "");
        const typePid = String(cls.type_pid || cls.TypePID || "");
        const typeName = String(cls.type_name || cls.TypeName || "").trim();
        if (!typeId || seen.has(typeId)) {
            continue;
        }
        seen.add(typeId);
        result.push({
            type_id: typeId,
            type_pid: typePid,
            type_name: typeName,
        });
    }
    return result;
}

async function enrichVideosWithDetails(videos) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return videos;
    }
    const videoIDs = [];
    const videoMap = new Map();
    for (const video of videos) {
        if (!video.vod_pic || video.vod_pic === "<nil>" || !video.vod_year || video.vod_year === "<nil>" || !video.vod_douban_score || video.vod_douban_score === "<nil>") {
            videoIDs.push(video.vod_id);
            videoMap.set(video.vod_id, video);
        }
    }
    if (videoIDs.length === 0) {
        return videos;
    }
    const batchSize = 20;
    for (let i = 0; i < videoIDs.length; i += batchSize) {
        const end = Math.min(i + batchSize, videoIDs.length);
        const batchIDs = videoIDs.slice(i, end);
        try {
            const response = await requestSiteAPI({
                ac: "detail",
                ids: batchIDs.join(","),
            });
            if (Array.isArray(response.list)) {
                for (const item of response.list) {
                    if (typeof item !== "object" || item === null) {
                        continue;
                    }
                    const vodId = String(item.vod_id || item.VodID || "");
                    const originalVod = videoMap.get(vodId);
                    if (originalVod) {
                        const pic = String(item.vod_pic || item.VodPic || "");
                        if (pic && pic !== "<nil>") {
                            originalVod.vod_pic = pic;
                        }
                        const year = String(item.vod_year || item.VodYear || "");
                        if (year && year !== "<nil>") {
                            originalVod.vod_year = year;
                        }
                        const score = String(item.vod_douban_score || item.VodDoubanScore || "");
                        if (score && score !== "<nil>") {
                            originalVod.vod_douban_score = score;
                        }
                        const en = String(item.vod_en || item.VodEn || "");
                        if (en && en !== "<nil>") {
                            originalVod.vod_en = en;
                        }
                        const time = String(item.vod_time || item.VodTime || "");
                        if (time && time !== "<nil>") {
                            originalVod.vod_time = time;
                        }
                        const playFrom = String(item.vod_play_from || item.VodPlayFrom || "");
                        if (playFrom && playFrom !== "<nil>") {
                            originalVod.vod_play_from = playFrom;
                        }
                    }
                }
            }
        } catch (error) {
            OmniBox.log("warn", `批量获取详情失败: ${error.message}`);
        }
    }
    return videos;
}

// ==================== 新增：合并分页与数据处理函数 ====================
/**
 * 获取单个子分类的多页数据
 * @param {string} typeId - 子分类ID
 * @param {number} maxPage - 最大页数
 * @returns {Promise<Array>} 视频列表
 */
async function fetchTypePages(typeId, maxPage) {
    const tasks = [];
    for (let pg = 1; pg <= maxPage; pg++) {
        tasks.push(
            requestSiteAPI({
                ac: "videolist",
                t: typeId,
                pg: String(pg),
            })
                .then((r) => r.list || [])
                .catch(() => [])
        );
    }
    return (await Promise.all(tasks)).flat();
}

/**
 * 获取并合并一个顶层分类下的所有子分类数据
 * @param {Object} group - 分类配置对象
 * @param {number} page - 请求的页码
 * @returns {Promise<Object>} 格式化的响应对象
 */
async function fetchAllMerged(group, page) {
    // 并行获取所有子分类的数据
    const raw = (
        await Promise.all(
            group.allIds.map((id) => fetchTypePages(id, PER_TYPE_PAGE))
        )
    ).flat();

    // 屏蔽不需要的分类
    const filtered = raw.filter(
        (item) =>
            item &&
            !shouldExcludeClassName(item.type_name)
    );

    // 按时间倒序排序
    filtered.sort((a, b) => {
        const timeA = new Date(a.vod_time || a.vod_addtime || a.vod_pubdate || "").getTime();
        const timeB = new Date(b.vod_time || b.vod_addtime || b.vod_pubdate || "").getTime();
        return isNaN(timeB) ? -1 : isNaN(timeA) ? 1 : timeB - timeA;
    });

    // 分页切片
    const startIndex = (page - 1) * PAGE_LIMIT;
    const endIndex = page * PAGE_LIMIT;
    const slice = filtered.slice(startIndex, endIndex);

    // 格式化返回
    const formattedList = formatVideos(slice);
    const total = filtered.length;
    const pagecount = Math.ceil(total / PAGE_LIMIT);

    return {
        page: page,
        pagecount: pagecount,
        total: total,
        list: formattedList,
    };
}

// ==================== 重写 home 和 category 函数 ====================
/**
 * 获取首页数据 (重写)
 * 现在返回自定义的分类列表，并且首页视频列表留空或按需实现
 * @param {Object} params - 参数对象
 * @returns {Object} 返回分类列表
 */
async function home(params) {
    try {
        OmniBox.log("info", "获取首页数据 (使用自定义分类)");
        // 构建自定义分类
        const classes = Object.entries(CATEGORY_CONFIG).map(([type_id, config]) => ({
            type_id: type_id,
            type_name: config.name,
        }));

        const response = await requestSiteAPI({
            ac: "videolist",
            pg: "1",
            pagesize: 100,
            limit: 100,
        });
        const videos = formatVideos(response.list || []);
        const filters = buildHomeFiltersFromCategoryConfig();
        return {
            class: classes,
            list: videos,
            filters: filters,
        };
    } catch (error) {
        OmniBox.log("error", `获取首页数据失败: ${error.message}`);
        return { class: [], list: [], filters: {} };
    }
}

/**
 * 获取分类数据 (重写)
 * 支持自定义分类、筛选和数据合并
 * @param {Object} params - 参数对象
 * - categoryId: 顶层分类ID（必填）
 * - page: 页码（必填，默认1）
 * - extend: 筛选项（JSON字符串，Base64编码）
 * @returns {Object} 返回视频列表
 */
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page = toInt(params.page) || 1;

        if (!categoryId) {
            throw new Error("分类ID不能为空");
        }

        const group = CATEGORY_CONFIG[categoryId];
        if (!group) {
            // 如果不是自定义分类，回退到原始逻辑
            OmniBox.log("info", `分类 ${categoryId} 未在自定义配置中，使用原始API`);
            const response = await requestSiteAPI({
                ac: "videolist",
                t: categoryId,
                pg: String(page),
            });
            const videos = formatVideos(response.list || []);
            return {
                page: toInt(response.page),
                pagecount: toInt(response.pagecount),
                total: toInt(response.total),
                list: videos,
            };
        }

        const effectiveGroup = getEffectiveCategoryGroup(group);

        OmniBox.log("info", `获取自定义分类数据: categoryId=${categoryId}, page=${page}`);

        const extObj = parseCategoryFilterParams(params);
        const selectedSubType = String(extObj.cate || extObj.class || "").trim();
        if (selectedSubType && selectedSubType !== "all" && effectiveGroup.allIds.includes(selectedSubType)) {
            // 如果有子分类筛选，直接请求该子分类
            const response = await requestSiteAPI({
                ac: "videolist",
                t: selectedSubType,
                pg: String(page),
            });
            const videos = formatVideos(response.list || []);
            return {
                page: toInt(response.page),
                pagecount: toInt(response.pagecount),
                total: toInt(response.total),
                list: videos,
            };
        } else {
            // 否则，合并所有子分类数据
            return await fetchAllMerged(effectiveGroup, page);
        }
    } catch (error) {
        OmniBox.log("error", `获取分类数据失败: ${error.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

// 导出接口（用于模块化引用）
module.exports = {
    home,
    category,
    search,
    detail,
    play,
};

// 使用公共 runner 处理标准输入/输出
const runner = require("spider_runner");
runner.run(module.exports);

// ==================== 保留原有的其他函数 ====================
/**
 * 获取视频详情
 * ... (search, detail, play, matchDanmu, inferFileNameFromURL, extractDigits, extractVideoIdFromFlag 函数保持不变) ...
 */
async function detail(params) {
    try {
        const videoId = params.videoId;
        if (!videoId) {
            throw new Error("视频ID不能为空");
        }
        OmniBox.log("info", `获取视频详情: videoId=${videoId}`);
        const response = await requestSiteAPI({ ac: "detail", ids: videoId });
        const videos = formatDetailVideos(response.list || []);

        for (const vod of videos) {
            const sourceCandidates = [];
            const playSources = Array.isArray(vod.vod_play_sources) ? vod.vod_play_sources : [];
            for (const source of playSources) {
                for (const ep of source.episodes || []) {
                    const meta = ep.playId && ep.playId.includes("|||") ? decodeMeta(ep.playId.split("|||")[1]) : {};
                    const fid = ep._fid || meta.fid;
                    const rawName = ep._rawName || ep.name || "正片";
                    if (!fid) continue;
                    sourceCandidates.push({
                        fid: fid,
                        file_id: fid,
                        file_name: rawName,
                        name: rawName,
                        format_type: "video",
                    });
                }
            }

            if (sourceCandidates.length > 0) {
                try {
                    const videoIdForScrape = String(vod.vod_id || videoId);
                    const scrapingResult = await OmniBox.processScraping(videoIdForScrape, vod.vod_name || "", vod.vod_name || "", sourceCandidates);
                    OmniBox.log("info", `刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);

                    const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                    const scrapeData = metadata?.scrapeData || null;
                    const videoMappings = metadata?.videoMappings || [];

                    if (scrapeData) {
                        vod.vod_name = scrapeData.title || vod.vod_name;
                        if (scrapeData.posterPath) {
                            vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
                        }
                        if (scrapeData.releaseDate) {
                            vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year;
                        }
                        if (scrapeData.overview) {
                            vod.vod_content = scrapeData.overview;
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

                    for (const source of playSources) {
                        for (const ep of source.episodes || []) {
                            const meta = ep.playId && ep.playId.includes("|||") ? decodeMeta(ep.playId.split("|||")[1]) : {};
                            const fid = ep._fid || meta.fid;
                            const mapping = videoMappings.find((m) => m?.fileId === fid);
                            if (!mapping) continue;
                            const oldName = ep.name;
                            const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                            if (newName && newName !== oldName) {
                                ep.name = newName;
                                OmniBox.log("info", `应用刮削后源文件名: ${oldName} -> ${newName}`);
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

                    // 清理内部字段
                    for (const source of playSources) {
                        source.episodes = (source.episodes || []).map((ep) => ({
                            name: ep.name,
                            playId: ep.playId,
                        }));
                    }
                    vod.vod_play_sources = playSources;
                } catch (error) {
                    OmniBox.log("warn", `刮削处理失败: ${error.message}`);
                }
            }
        }

        return { list: videos };
    } catch (error) {
        OmniBox.log("error", `获取视频详情失败: ${error.message}`);
        return { list: [] };
    }
}

async function search(params) {
    try {
        const keyword = params.keyword || params.wd || "";
        const page = params.page || 1;
        if (!keyword) {
            return { page: 1, pagecount: 0, total: 0, list: [] };
        }
        OmniBox.log("info", `搜索视频: keyword=${keyword}, page=${page}`);
        const response = await requestSiteAPI({ ac: "list", wd: keyword, pg: String(page) });
        let videos = formatVideos(response.list || []);
        if (videos.length > 0 && (!videos[0].vod_pic || videos[0].vod_pic === "")) {
            try {
                const videoIDs = videos.map((v) => v.vod_id);
                const detailResponse = await requestSiteAPI({ ac: "detail", ids: videoIDs.join(",") });
                videos = formatVideos(detailResponse.list || []);
            } catch (error) {
                OmniBox.log("warn", `获取搜索结果详情失败: ${error.message}`);
            }
        }
        return {
            page: toInt(response.page),
            pagecount: toInt(response.pagecount),
            total: toInt(response.total),
            list: videos,
        };
    } catch (error) {
        OmniBox.log("error", `搜索视频失败: ${error.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) {
        return [];
    }
    try {
        OmniBox.log("info", `匹配弹幕: fileName=${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName: fileName }),
        });
        if (response.statusCode !== 200) {
            OmniBox.log("warn", `弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }
        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) {
            OmniBox.log("info", "弹幕未匹配到");
            return [];
        }
        const matches = matchData.matches || [];
        if (matches.length === 0) {
            return [];
        }
        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";
        if (!episodeId) {
            return [];
        }
        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }
        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;
        OmniBox.log("info", `弹幕匹配成功: ${danmakuName} (episodeId: ${episodeId})`);
        return [{ name: danmakuName, url: danmakuURL }];
    } catch (error) {
        OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
        return [];
    }
}

function inferFileNameFromURL(url) {
    try {
        const urlObj = new URL(url);
        let base = urlObj.pathname.split("/").pop() || "";
        const dotIndex = base.lastIndexOf(".");
        if (dotIndex > 0) {
            base = base.substring(0, dotIndex);
        }
        base = base.replace(/[_-]/g, " ").replace(/\./g, " ").trim();
        return base || url;
    } catch (error) {
        return url;
    }
}

function extractDigits(str) {
    if (typeof str !== "string") {
        return "";
    }
    return str.replace(/\D/g, "");
}

function extractVideoIdFromFlag(flag) {
    if (!flag) {
        return "";
    }
    if (flag.includes("-")) {
        const parts = flag.split("-");
        const videoId = parts[parts.length - 1];
        if (/^\d+$/.test(videoId)) {
            return videoId;
        }
    }
    if (/^\d+$/.test(flag)) {
        return flag;
    }
    return "";
}

async function play(params) {
    try {
        const rawPlayId = params.playId;
        const flag = params.flag || "";
        if (!rawPlayId) {
            throw new Error("播放地址ID不能为空");
        }
        let playId = rawPlayId;
        let vodName = "";
        let episodeName = "";
        if (rawPlayId.includes("|||")) {
            const [mainPlayId, metaB64] = rawPlayId.split("|||");
            playId = mainPlayId;
            const meta = decodeMeta(metaB64 || "");
            vodName = meta.v || "";
            episodeName = meta.e || "";
        }
        const videoId = extractVideoIdFromFlag(flag);
        OmniBox.log("info", `获取播放地址: playId=${playId}, flag=${flag}, videoId=${videoId}`);

        let scrapedDanmuFileName = "";
        try {
            const sourceVideoId = params.vodId || videoId || (rawPlayId.includes("|||") ? (decodeMeta(rawPlayId.split("|||")[1] || "").sid || "") : "");
            if (sourceVideoId) {
                const metadata = await OmniBox.getScrapeMetadata(String(sourceVideoId));
                if (metadata && metadata.scrapeData) {
                    const meta = rawPlayId.includes("|||") ? decodeMeta(rawPlayId.split("|||")[1] || "") : {};
                    const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === meta.fid);
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
            OmniBox.log("warn", `读取刮削元数据失败: ${error.message}`);
        }

        // 参考两个BT，增加播放地址嗅探逻辑：
        // 1) 直链资源直接播放
        // 2) 非直链尝试 OmniBox.sniffVideo 嗅探真实媒体地址
        let resolvedUrl = playId;
        let resolvedHeader = {};
        let parse = 1;

        const isDirectPlayable = /\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(playId || "");
        if (isDirectPlayable) {
            parse = 0;
        } else if (/^https?:\/\//i.test(playId || "")) {
            try {
                const sniffResult = await OmniBox.sniffVideo(playId);
                if (sniffResult && sniffResult.url) {
                    resolvedUrl = sniffResult.url;
                    resolvedHeader = sniffResult.header || {};
                    parse = 0;
                    OmniBox.log("info", `嗅探成功: ${resolvedUrl}`);
                }
            } catch (sniffError) {
                OmniBox.log("warn", `嗅探失败，回退原始地址: ${sniffError.message}`);
            }
        }

        let urlsResult = [{ name: "播放", url: resolvedUrl }];
        let playResponse = { urls: urlsResult, flag: flag, header: resolvedHeader, parse: parse };
        if (DANMU_API) {
            let fileName = "";
            if (vodName) {
                fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            } else if (videoId) {
                try {
                    const detailResponse = await requestSiteAPI({ ac: "detail", ids: videoId });
                    if (detailResponse.list && detailResponse.list.length > 0) {
                        const video = detailResponse.list[0];
                        const videoName = video.vod_name || video.VodName || "";
                        const playURL = video.vod_play_url || video.VodPlayURL || "";
                        if (videoName && playURL) {
                            const segments = playURL.split("#").filter((s) => s.trim());
                            if (segments.length === 1) {
                                fileName = videoName;
                            } else {
                                let epNum = 0;
                                for (let idx = 0; idx < segments.length; idx++) {
                                    const seg = segments[idx];
                                    const parts = seg.split("$");
                                    if (parts.length >= 2) {
                                        const epLabel = parts[0].trim();
                                        const epURL = parts[1].trim();
                                        if (epURL === playId || epURL.includes(playId) || playId.includes(epURL)) {
                                            const digits = extractEpisode(epLabel);
                                            if (digits) {
                                                epNum = parseInt(digits, 10);
                                            } else {
                                                epNum = idx + 1;
                                            }
                                            break;
                                        }
                                    }
                                }
                                if (epNum > 0) {
                                    fileName = epNum < 10 ? `${videoName} S01E0${epNum}` : `${videoName} S01E${epNum}`;
                                } else {
                                    fileName = videoName;
                                }
                            }
                        }
                    }
                } catch (error) {
                    OmniBox.log("warn", `获取详情失败，无法推断集数: ${error.message}`);
                }
            }
            if (!fileName) {
                fileName = inferFileNameFromURL(playId);
            }
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                }
            }
        }
        return playResponse;
    } catch (error) {
        OmniBox.log("error", `获取播放地址失败: ${error.message}`);
        return { urls: [], flag: params.flag || "", header: {} };
    }
}
