// @name 在线之家
// @author @PFR001, @lucky_TJQ
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.2.4
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/在线之家.js

/**
 * ============================================================================
 * 在线之家 (ZXZJ)
 * https://www.zxzjhd.com
 * 
 * 功能特性：
 * - 刮削：支持 (集成 TMDB 元数据)
 * - 弹幕：支持 (通过弹幕 API 匹配)
 * - 嗅探：支持 (智能视频地址提取)
 * ============================================================================
 */
const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const host = 'https://www.zxzjhd.com';

// 弹幕 API 地址 (优先使用环境变量)
const DANMU_API = process.env.DANMU_API || "";

// 基础 Headers (用于列表页等普通请求)
const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': host + '/',
    'Origin': host,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const axiosInstance = axios.create({
    timeout: 15000,
    headers: baseHeaders,
    validateStatus: status => true
});

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[ZXZJ-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[ZXZJ-DEBUG] ${message}: ${error.message || error}`);
};

/**
 * 修复 HTML 被 JSON 包裹的反爬响应
 */
const fixJsonWrappedHtml = (html) => {
    if (!html || typeof html !== "string") return html;
    const trimmed = html.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("<!DOCTYPE")) return trimmed;
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === "string" && parsed.trim().startsWith("<")) {
                return parsed.trim();
            }
        } catch { }
    }
    return trimmed;
};

/**
 * 元数据编解码 (用于透传参数)
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
 * 标准化 URL
 */
const fixUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return url.startsWith('/') ? `${host}${url}` : `${host}/${url}`;
};

/**
 * 处理图片 URL，如果是外部 URL 则通过代理
 * @param {string} imageUrl - 原始图片 URL
 * @param {string} baseURL - 代理服务器基础 URL
 * @param {string} referer - 图片来源的 Referer (默认取 imageUrl 的域名)
 * @returns {string} 处理后的图片 URL
 */
const processImageUrl = (imageUrl, baseURL = "", referer = "") => {
    if (!imageUrl) return '';

    // 标准化 URL
    let url = fixUrl(imageUrl);

    // 检查是否是外部 URL（不是当前 host 的 URL）
    const isExternalUrl = !url.includes(host) && url.startsWith('http');

    // 如果是外部 URL 且有 baseURL，则通过代理
    if (isExternalUrl && baseURL) {
        try {
            // 如果没有指定 referer，从 imageUrl 的域名提取
            let finalReferer = referer;
            if (!finalReferer) {
                try {
                    const urlObj = new URL(url);
                    finalReferer = `${urlObj.protocol}//${urlObj.host}`;
                } catch (e) {
                    finalReferer = host;
                }
            }

            // 构建带 headers 的 URL 格式: url@Referer=value
            const urlWithHeaders = `${url}@Referer=${finalReferer}`;
            // 编码 URL 参数
            const encodedUrl = encodeURIComponent(urlWithHeaders);
            // 返回代理 URL
            return `${baseURL}/api/proxy/image?url=${encodedUrl}`;
        } catch (error) {
            logError("处理图片 URL 失败", error);
            return url;
        }
    }

    return url;
};

/**
 * 统一请求 HTML
 */
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
        return fixJsonWrappedHtml(res.data);
    } catch (e) {
        logError("请求失败", e);
        return "";
    }
};

// ========== 解密算法 ==========
const DecryptTools = {
    decrypt: function (encryptedData) {
        try {
            // 1. 翻转字符串
            const reversed = encryptedData.split('').reverse().join('');
            // 2. Hex 转 String
            let hexDecoded = '';
            for (let i = 0; i < reversed.length; i += 2) {
                hexDecoded += String.fromCharCode(parseInt(reversed.substr(i, 2), 16));
            }
            // 3. 移除中间混淆字符 (7位)
            const len = hexDecoded.length;
            const splitLen = Math.floor((len - 7) / 2);
            return hexDecoded.substring(0, splitLen) + hexDecoded.substring(splitLen + 7);
        } catch (e) {
            logError("解密失败", e);
            return null;
        }
    }
};

/**
 * 判断网盘线路名称
 */
const isPanLineName = (name) => {
    if (!name) return false;
    const n = String(name);
    return n.includes("网盘") || n.includes("百度") || n.includes("夸克") || n.includes("UC") || n.includes("阿里") || n.includes("迅雷") || n.includes("天翼") || n.includes("115") || n.includes("123");
};

/**
 * 判断是否为网盘分享链接
 */
const isPanUrl = (url) => {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes("pan.baidu.com") || u.includes("quark.cn") || u.includes("pan.quark.cn") || u.includes("drive.uc.cn") || u.includes("aliyundrive.com") || u.includes("alipan.com") || u.includes("xunlei.com") || u.includes("cloud.189.cn") || u.includes("115.com") || u.includes("123pan.com");
};

const normalizeShareUrl = (url) => {
    if (!url) return "";
    let u = String(url).trim();
    if (u.startsWith("push://")) {
        u = u.slice("push://".length);
    }
    if (u.startsWith("push:")) {
        u = u.slice("push:".length);
    }
    return u.trim();
};

/**
 * 从播放页提取网盘链接
 */
const extractPanUrlFromPage = async (playPageUrl) => {
    const html = await requestHtml(playPageUrl, {});
    if (!html) return "";

    const playerMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
    if (!playerMatch) return "";

    try {
        const cleanStr = playerMatch[1]
            .replace(/\\"/g, "\u0001")
            .replace(/\"/g, "\"")
            .replace(/\u0001/g, "\"")
            .replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)))
            .replace(/\\\//g, "/");

        const playerData = JSON.parse(cleanStr);
        return playerData.url || "";
    } catch (e) {
        logInfo(`解析 player_aaaa 失败: ${e.message}`);
        return "";
    }
};

/**
 * 判断是否为视频文件
 */
const isVideoFile = (file) => {
    if (!file || !file.file_name) return false;
    const fileName = String(file.file_name).toLowerCase();
    const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];
    for (const ext of videoExtensions) {
        if (fileName.endsWith(ext)) return true;
    }
    if (file.format_type) {
        const formatType = String(file.format_type).toLowerCase();
        if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) return true;
    }
    return false;
};

const getFileId = (file) => file?.fid || file?.file_id || "";
const getFileName = (file) => file?.file_name || file?.name || "";

/**
 * 递归获取所有视频文件
 */
const getAllVideoFiles = async (shareURL, files) => {
    const videoFiles = [];
    for (const file of files || []) {
        if (file.file && isVideoFile(file)) {
            videoFiles.push(file);
        } else if (file.dir) {
            try {
                const subFileId = getFileId(file);
                if (!subFileId) continue;
                const subFileList = await OmniBox.getDriveFileList(shareURL, subFileId);
                if (subFileList && Array.isArray(subFileList.files)) {
                    const subVideoFiles = await getAllVideoFiles(shareURL, subFileList.files);
                    videoFiles.push(...subVideoFiles);
                }
            } catch (error) {
                logInfo(`获取子目录文件失败: ${error.message}`);
            }
        }
    }
    return videoFiles;
};

/**
 * 获取网盘分享的文件列表（带缓存）
 */
const panShareCache = new Map();

const loadPanFiles = async (shareURL) => {
    if (!shareURL) return null;
    if (panShareCache.has(shareURL)) return panShareCache.get(shareURL);
    try {
        const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
        const fileList = await OmniBox.getDriveFileList(shareURL, "0");
        const files = Array.isArray(fileList?.files) ? fileList.files : [];
        const videos = await getAllVideoFiles(shareURL, files);
        const result = { driveInfo, videos };
        panShareCache.set(shareURL, result);
        return result;
    } catch (error) {
        logInfo(`读取网盘文件失败: ${error.message}`);
        return null;
    }
};

/**
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniffZxzjPlay = async (playUrl) => {
    if (!playUrl) return null;
    try {
        logInfo("尝试嗅探播放页", playUrl);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", sniffed.url);
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || baseHeaders
            };
        }
    } catch (error) {
        logInfo(`嗅探失败: ${error.message}`);
    }
    return null;
};

/**
 * 从标题中提取集数
 */
function extractEpisode(title) {
    if (!title) return "";

    const processedTitle = title.trim();

    // 1. S01E03 格式
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    // 2. 中文格式：第XX集/话
    const cnMatch = processedTitle.match(/第\s*([0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return cnMatch[1];

    // 3. EP/E 格式
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    // 4. 括号格式 [03]
    const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    return "";
}

/**
 * 构建用于弹幕匹配的文件名
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";

    // 如果没有集数信息，直接返回视频名（电影）
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }

    // 提取集数
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            // 构建标准格式：视频名 S01E01
            if (epNum < 10) {
                return `${vodName} S01E0${epNum}`;
            } else {
                return `${vodName} S01E${epNum}`;
            }
        }
    }

    // 无法提取集数，返回视频名
    return vodName;
}

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
 * 匹配弹幕
 */
async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) {
        return [];
    }

    try {
        logInfo(`匹配弹幕: ${fileName}`);

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
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);

        // 检查是否匹配成功
        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

        // 获取matches数组
        const matches = matchData.matches || [];
        if (matches.length === 0) {
            return [];
        }

        // 取第一个匹配项
        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";

        if (!episodeId) {
            return [];
        }

        // 构建弹幕名称
        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        // 构建弹幕URL
        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;

        logInfo(`弹幕匹配成功: ${danmakuName}`);

        return [
            {
                name: danmakuName,
                url: danmakuURL,
            },
        ];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
}

// ========== 列表解析逻辑 ==========
/**
 * 解析视频列表
 * @param {Object} $ - cheerio 实例
 * @param {string} baseURL - 代理服务器基础 URL
 * @returns {Array} 视频列表
 */
const parseVideoList = ($, baseURL = "") => {
    const list = [];
    const items = $('.stui-vodlist__item, .stui-vodlist li, .v-item, .public-list-box');
    items.each((_, element) => {
        const $item = $(element);
        const $link = $item.find('a.stui-vodlist__thumb, a.v-thumb, a.public-list-exp');
        if ($link.length === 0) return;

        const title = $link.attr('title') || $item.find('.title a').text().trim();
        const href = $link.attr('href');
        let pic = $link.attr('data-original') || $link.attr('data-src') || $link.attr('src');

        // 处理背景图样式
        if (!pic) {
            const style = $link.attr('style') || '';
            const match = style.match(/url\((['"]?)(.*?)\1\)/);
            if (match) pic = match[2];
        }

        const remarks = $item.find('.pic-text, .v-remarks, .public-list-prb').text().trim();

        if (title && href) {
            list.push({
                vod_id: href,
                vod_name: title,
                vod_pic: processImageUrl(pic, baseURL),
                vod_remarks: remarks || ''
            });
        }
    });
    return list;
};

// ========== 核心功能函数 ==========

/**
 * 首页
 */
async function home(params, context) {
    logInfo("进入首页");

    const baseURL = context?.baseURL || "";
    const url = `${host}`;
    const html = await requestHtml(url);
    const $ = cheerio.load(html || "");
    const list = parseVideoList($, baseURL);

    logInfo(`获取到 ${list.length} 个视频`);
    return {
        list: list, class: [
            { type_id: '1', type_name: '电影' },
            { type_id: '2', type_name: '美剧' },
            { type_id: '3', type_name: '韩剧' },
            { type_id: '4', type_name: '日剧' },
            { type_id: '5', type_name: '泰剧' },
            { type_id: '6', type_name: '动漫' }
        ]
    };
}

/**
 * 分类
 */
async function category(params, context) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    const baseURL = context?.baseURL || "";
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);

    try {
        const url = `${host}/vodshow/${categoryId}--------${pg}---.html`;
        const html = await requestHtml(url);
        const $ = cheerio.load(html || "");
        const list = parseVideoList($, baseURL);

        logInfo(`获取到 ${list.length} 个视频`);
        return { list: list, page: pg, pagecount: list.length >= 12 ? pg + 1 : pg };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 搜索
 */
async function search(params, context) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    const baseURL = context?.baseURL || "";
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);

    try {
        const url = `${host}/vodsearch/${encodeURIComponent(wd)}----------${pg}---.html`;
        const html = await requestHtml(url);
        const $ = cheerio.load(html || "");
        const list = parseVideoList($, baseURL);

        logInfo(`搜索到 ${list.length} 个结果`);
        return { list: list, page: pg, pagecount: list.length >= 20 ? pg + 1 : pg };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 详情
 */
async function detail(params, context) {
    const videoId = params.videoId;
    const url = fixUrl(videoId);
    const baseURL = context?.baseURL || "";
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        const html = await requestHtml(url);
        const $ = cheerio.load(html);

        // 兼容多种详情页布局
        const title = $('h1.title').text().trim() || $('.stui-content__detail .title').text().trim() || $('title').text().split('-')[0].trim();
        let pic = $('.stui-content__thumb img').attr('data-original') || $('.stui-content__thumb img').attr('src') || '';
        const desc = $('.stui-content__detail .desc').text().trim() || $('meta[name="description"]').attr('content') || '';

        // 处理图片 URL
        pic = processImageUrl(pic, baseURL);

        const playSources = [];
        const $playlists = $(".stui-content__playlist, .stui-pannel__data ul, .playlist");

        const playlistTasks = [];
        const playlistResults = [];

        $playlists.each((index, listElem) => {
            let sourceName = "默认线路";
            const $prevHead = $(listElem).prev(".stui-vodlist__head, .stui-pannel__head");
            if ($prevHead.length > 0) {
                sourceName = $prevHead.find("h3").text().trim() || sourceName;
            }

            const isPanLine = isPanLineName(sourceName);
            const $links = $(listElem).find("li a");

            playlistTasks.push(
                (async () => {
                    const episodes = [];

                    if (isPanLine) {
                        const panTasks = [];
                        $links.each((idx, a) => {
                            const $a = $(a);
                            const episodeName = $a.text().trim() || `第${idx + 1}集`;
                            const href = $a.attr("href") || "";
                            const playPageUrl = fixUrl(href);
                            panTasks.push(
                                (async () => {
                                    const panUrl = await extractPanUrlFromPage(playPageUrl);
                                    if (!panUrl) return null;

                                    const shareURL = normalizeShareUrl(panUrl);
                                    if (!isPanUrl(shareURL)) {
                                        return null;
                                    }

                                    const panInfo = await loadPanFiles(shareURL);
                                    const files = panInfo?.videos || [];

                                    if (!files.length) {
                                        const pushUrl = shareURL.startsWith("push://") ? shareURL : `push://${shareURL}`;
                                        const fid = `${videoId}#pan#${idx}`;
                                        const combinedId = `${pushUrl}|||${encodeMeta({ sid: String(videoId || ""), fid, v: title || "", e: episodeName })}`;
                                        return [{
                                            name: episodeName,
                                            playId: combinedId,
                                            _fid: fid,
                                            _rawName: episodeName
                                        }];
                                    }

                                    const seriesEpisodes = [];
                                    for (const file of files) {
                                        const fileId = getFileId(file);
                                        if (!fileId) continue;
                                        const fileName = getFileName(file) || episodeName;
                                        const filePlayId = `${shareURL}|${fileId}`;
                                        const fid = `${videoId}#pan#${fileId}`;
                                        const combinedId = `${filePlayId}|||${encodeMeta({ sid: String(videoId || ""), fid, v: title || "", e: fileName })}`;
                                        seriesEpisodes.push({
                                            name: fileName,
                                            playId: combinedId,
                                            _fid: fid,
                                            _rawName: fileName
                                        });
                                    }

                                    return seriesEpisodes.length ? seriesEpisodes : null;
                                })()
                            );
                        });

                        const panEpisodes = await Promise.all(panTasks);
                        panEpisodes.filter(Boolean).forEach((batch) => {
                            if (Array.isArray(batch)) {
                                batch.forEach((ep) => episodes.push(ep));
                            } else if (batch) {
                                episodes.push(batch);
                            }
                        });
                    } else {
                        $links.each((idx, a) => {
                            const $a = $(a);
                            const episodeName = $a.text().trim() || `第${idx + 1}集`;
                            const playId = $a.attr("href") || "";
                            const fid = `${videoId}#0#${episodes.length}`;
                            const combinedId = `${playId}|||${encodeMeta({ sid: String(videoId || ""), fid, v: title || "", e: episodeName })}`;
                            episodes.push({
                                name: episodeName,
                                playId: combinedId,
                                _fid: fid,
                                _rawName: episodeName
                            });
                        });
                    }

                    if (episodes.length > 0) {
                        playlistResults[index] = { name: sourceName, episodes: episodes };
                    }
                })()
            );
        });

        if (playlistTasks.length > 0) {
            await Promise.all(playlistTasks);
            for (const item of playlistResults) {
                if (item && item.episodes && item.episodes.length > 0) {
                    playSources.push(item);
                }
            }
        }

        logInfo(`视频标题: ${title}, 播放链接数: ${playSources.length}`);

        // 准备刮削候选项
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

        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";

        // 执行刮削
        if (scrapeCandidates.length > 0) {
            try {
                const videoIdForScrape = String(videoId || "");
                const scrapingResult = await OmniBox.processScraping(videoIdForScrape, title || "", title || "", scrapeCandidates);
                logInfo(`刮削处理完成`, { resultLength: JSON.stringify(scrapingResult || {}).length });

                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });
            } catch (error) {
                logError("刮削处理失败", error);
            }
        }

        // 应用刮削结果
        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                if (!mapping) continue;
                const oldName = ep.name;
                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                if (newName && newName !== oldName) {
                    ep.name = newName;
                    logInfo(`应用刮削后源文件名: ${oldName} -> ${newName}`);
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

        const vod = {
            vod_id: videoId,
            vod_name: title,
            vod_pic: pic,
            vod_content: desc,
            vod_play_sources: playSources.map((source) => ({
                name: source.name,
                episodes: (source.episodes || []).map((ep) => ({
                    name: ep.name,
                    playId: ep.playId,
                })),
            }))
        };

        // 应用刮削元数据
        if (scrapeData) {
            vod.vod_name = scrapeData.title || vod.vod_name;
            if (scrapeData.posterPath) {
                // 处理 TMDB 图片 URL (referer 自动从 URL 域名提取)
                vod.vod_pic = processImageUrl(`https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`, baseURL);
            }
            if (scrapeData.overview) {
                vod.vod_content = scrapeData.overview;
            }
            if (scrapeData.releaseDate) {
                vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || "";
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
            list: [vod]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

// ========== 播放解析 (核心) ==========
/**
 * 播放解析
 * 支持：直接解密、嗅探、弹幕匹配
 */
async function play(params) {
    let playId = params.playId;
    const flag = params.flag || "";
    logInfo(`准备播放 ID: ${playId}, flag: ${flag}`);

    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    // 解析透传参数
    if (playId && playId.includes("|||")) {
        const [mainPlayId, metaB64] = playId.split("|||");
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    let scrapedDanmuFileName = "";
    let scrapeType = "";
    try {
        const videoIdFromParam = params.vodId ? String(params.vodId) : "";
        const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
        const videoIdForScrape = videoIdFromParam || videoIdFromMeta;

        if (videoIdForScrape) {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapeType = metadata.scrapeType || "";
                scrapedDanmuFileName = buildScrapedDanmuFileName(
                    metadata.scrapeData,
                    scrapeType,
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
        if (playId && playId.includes("|")) {
            const [rawShareURL, fileId] = playId.split("|");
            const shareURL = normalizeShareUrl(rawShareURL);
            if (shareURL && fileId) {
                try {
                    const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, flag || "");
                    const urlList = Array.isArray(playInfo?.url) ? playInfo.url : [];
                    const urlsResult = urlList.map((item) => ({
                        name: item.name || "播放",
                        url: item.url
                    }));
                    return {
                        urls: urlsResult,
                        flag: shareURL,
                        header: playInfo?.header || {},
                        parse: 0,
                        danmaku: playInfo?.danmaku || []
                    };
                } catch (error) {
                    logInfo(`网盘播放失败: ${error.message}`);
                }
            }
        }

        if (playId && playId.startsWith("push://")) {
            return {
                urls: [{ name: "网盘资源", url: playId }],
                parse: 0,
                header: {}
            };
        }

        if (isPanUrl(playId)) {
            const shareURL = normalizeShareUrl(playId);
            const pushUrl = shareURL.startsWith("push://") ? shareURL : `push://${shareURL}`;
            return {
                urls: [{ name: "网盘资源", url: pushUrl }],
                parse: 0,
                header: {}
            };
        }

        if (flag && isPanLineName(flag) && playId) {
            const shareURL = normalizeShareUrl(playId);
            const pushUrl = shareURL.startsWith("push://") ? shareURL : `push://${shareURL}`;
            return {
                urls: [{ name: "网盘资源", url: pushUrl }],
                parse: 0,
                header: {}
            };
        }

        const playPageUrl = fixUrl(playId);

        // 1. 请求播放页
        const html = await requestHtml(playPageUrl);

        // 2. 提取中间页 URL
        const urlMatch = html.match(/"url"\s*:\s*"(https:[^"]*?jx\.zxzj[^"]*?)"/);

        if (urlMatch && urlMatch[1]) {
            const targetUrl = urlMatch[1].replace(/\\/g, '');
            logInfo(`提取中间页 URL: ${targetUrl}`);

            // 3. 构造严格匹配的 Headers (关键!)
            const sniffHeaders = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Referer": host + "/",
                "Sec-Fetch-Dest": "iframe",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-site",
                "Upgrade-Insecure-Requests": "1"
            };

            // 4. 请求中间页获取源码
            try {
                const iframeHtml = await requestHtml(targetUrl, { headers: sniffHeaders });

                // 5. 提取 result_v2 并解密
                const v2Match = iframeHtml.match(/var\s+result_v2\s*=\s*(\{[\s\S]*?\});/);
                if (v2Match && v2Match[1]) {
                    const v2Json = JSON.parse(v2Match[1]);
                    const encryptedData = v2Json.data || v2Json.url;

                    if (encryptedData) {
                        const decrypted = DecryptTools.decrypt(encryptedData);
                        if (decrypted && decrypted.startsWith("http")) {
                            logInfo(`解密成功: ${decrypted.substring(0, 50)}...`);

                            // 弹幕匹配
                            let danmakuList = [];
                            if (DANMU_API && (vodName || params.vodName)) {
                                const finalVodName = vodName || params.vodName;
                                const finalEpisodeName = episodeName || params.episodeName || '';
                                const fileName = scrapedDanmuFileName || buildFileNameForDanmu(finalVodName, finalEpisodeName);

                                logInfo(`尝试匹配弹幕文件名: ${fileName}`);
                                if (fileName) {
                                    danmakuList = await matchDanmu(fileName);
                                }
                            }

                            const result = {
                                urls: [{ name: "极速直连", url: decrypted }],
                                parse: 0,
                                header: sniffHeaders
                            };

                            if (danmakuList && danmakuList.length > 0) {
                                result.danmaku = danmakuList;
                            }

                            return result;
                        }
                    }
                }
            } catch (innerErr) {
                logInfo(`中间页解析失败: ${innerErr.message}`);
            }

            // 6. 兜底方案：智能嗅探
            logInfo("尝试智能嗅探");
            const sniffRes = await sniffZxzjPlay(targetUrl);
            if (sniffRes) {
                // 弹幕匹配
                if (DANMU_API && (vodName || params.vodName)) {
                    const finalVodName = vodName || params.vodName;
                    const finalEpisodeName = episodeName || params.episodeName || '';
                    const fileName = scrapedDanmuFileName || buildFileNameForDanmu(finalVodName, finalEpisodeName);

                    logInfo(`尝试匹配弹幕文件名: ${fileName}`);
                    if (fileName) {
                        const danmakuList = await matchDanmu(fileName);
                        if (danmakuList && danmakuList.length > 0) {
                            sniffRes.danmaku = danmakuList;
                        }
                    }
                }
                return sniffRes;
            }
        }

    } catch (e) {
        logError("播放解析失败", e);
    }

    // 7. 最后的失败回退
    logInfo("使用回退方案");
    return {
        urls: [{ name: "解析失败", url: fixUrl(playId) }],
        parse: 1,
        header: baseHeaders
    };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
