// @name 独播库
// @author @caipeibin
// @description 
// @dependencies: axios
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/独播库.js


/** 
 * OmniBox 爬虫脚本 - 独播库
 * 
 * 说明：
 * 1. 基于原始 TVBox T4 脚本逻辑转换为 OmniBox 标准 JS 模板。
 * 2. 实现了 `home` / `category` / `search` / `detail` / `play` 五个标准接口。
 * 3. 保留了原脚本的签名 (`sign`, `token`, `ssid`) 和 Base64 解码逻辑。
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const HOST = "https://api.dbokutv.com";
const REFERER_HOST = "https://www.duboku.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    "Referer": `${REFERER_HOST}/`,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive"
};

const DANMU_API = process.env.DANMU_API || "";

const axiosInstance = axios.create({
    timeout: 15 * 1000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true }),
});

// ==================== 日志工具 ====================
function logInfo(message, data = null) {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[独播库] ${output}`);
}
function logError(message, error) {
    OmniBox.log("error", `[独播库] ${message}: ${error?.message || error}`);
}

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

// ==================== 辅助函数 ====================
const decodeDubokuData = (data) => {
    if (!data || typeof data !== 'string') return '';
    const strippedStr = data.trim().replace(/['"]/g, '');
    if (!strippedStr) return '';
    const segmentLength = 10;
    try {
        let processedBase64 = '';
        for (let i = 0; i < strippedStr.length; i += segmentLength) {
            const segment = strippedStr.slice(i, i + segmentLength);
            processedBase64 += segment.split('').reverse().join('');
        }
        processedBase64 = processedBase64.replace(/\./g, '=');
        const paddingNeeded = 4 - (processedBase64.length % 4);
        if (paddingNeeded !== 4) {
            processedBase64 += '='.repeat(paddingNeeded);
        }
        const decodedBytes = Buffer.from(processedBase64, 'base64');
        return decodedBytes.toString('utf-8');
    } catch (error) {
        logError('解码错误', error);
        return '';
    }
};

const generateRandomString = (length) => {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
};

const interleaveStrings = (str1, str2) => {
    const result = [];
    const minLength = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLength; i++) {
        result.push(str1[i]);
        result.push(str2[i]);
    }
    result.push(str1.slice(minLength));
    result.push(str2.slice(minLength));
    return result.join('');
};

const generateSignature = (url) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const randomNumber = Math.floor(Math.random() * 800000000);
    const valueA = randomNumber + 100000000;
    const valueB = 900000000 - randomNumber;
    const interleaved = interleaveStrings(`${valueA}${valueB}`, timestamp.toString());
    const ssid = Buffer.from(interleaved).toString('base64').replace(/=/g, '.');
    const sign = generateRandomString(60);
    const token = generateRandomString(38);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}sign=${sign}&token=${token}&ssid=${ssid}`;
};

const isDirectVideoUrl = (url) => {
    if (!url) return false;
    return /\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i.test(url);
};

const sniffDubokuPlay = async (playUrl) => {
    if (!playUrl) return null;
    try {
        logInfo("尝试嗅探播放页", playUrl);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", sniffed.url);
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || {
                    "User-Agent": UA,
                    "Referer": playUrl
                }
            };
        }
    } catch (error) {
        logInfo(`嗅探失败: ${error.message || error}`);
    }
    return null;
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

function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function chineseToArabic(cn) {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];
    const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }
    const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
    if (standaloneMatches) {
        const candidates = standaloneMatches
            .map(m => m.match(/\d+/)[0])
            .filter(num => {
                const n = parseInt(num);
                return n > 0 && n < 300 && !["720", "480", "264", "265"].includes(num);
            });
        if (candidates.length > 0) {
            const normalEp = candidates.find(n => parseInt(n) < 100);
            return normalEp || candidates[0];
        }
    }
    return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) {
                return `${vodName} S01E0${epNum}`;
            }
            return `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
}

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
                "User-Agent": UA
            },
            body: JSON.stringify({ fileName: fileName })
        });
        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }
        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
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
        logInfo(`弹幕匹配成功: ${danmakuName}`);
        return [{ name: danmakuName, url: danmakuURL }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message || error}`);
        return [];
    }
}

// ==================== OmniBox 标准接口实现 ====================
async function home(params) {
    const classes = [
        { type_id: "2", type_name: "连续剧" },
        { type_id: "3", type_name: "综艺" },
        { type_id: "1", type_name: "电影" },
        { type_id: "4", type_name: "动漫" }
    ];
    const filters = {}; // 独播库无筛选

    try {
        const url = generateSignature(`${HOST}/home`);
        logInfo("获取首页推荐", { url });
        const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
        const data = response.data;
        const list = [];
        if (Array.isArray(data)) {
            data.forEach(category => {
                const vodList = category.VodList || [];
                vodList.forEach(vod => {
                    const vodId = vod.DId || vod.DuId || '';
                    const vodPic = vod.TnId || '';
                    list.push({
                        vod_id: decodeDubokuData(vodId),
                        vod_name: vod.Name || '',
                        vod_pic: decodeDubokuData(vodPic),
                        vod_remarks: vod.Tag || ''
                    });
                });
            });
        }
        logInfo(`获取到 ${list.length} 个首页推荐`);
        return { class: classes, filters, list: list.slice(0, 20) };
    } catch (error) {
        logError("获取首页数据失败", error);
        return { class: classes, filters, list: [] };
    }
}

async function category(params) {
    const categoryId = params.categoryId;
    const page = parseInt(params.page, 10) || 1;

    try {
        const pageStr = page === 1 ? '' : page.toString();
        const path = `/vodshow/${categoryId}--------${pageStr}---`;
        const url = generateSignature(HOST + path);
        logInfo(`获取分类列表: ${categoryId} 第 ${page} 页`, { url });
        const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
        const data = response.data;
        const list = [];

        if (data && data.VodList && Array.isArray(data.VodList)) {
            data.VodList.forEach(vod => {
                const vodId = vod.DId || vod.DuId || '';
                const vodPic = vod.TnId || '';
                list.push({
                    vod_id: decodeDubokuData(vodId),
                    vod_name: vod.Name || '',
                    vod_pic: decodeDubokuData(vodPic),
                    vod_remarks: vod.Tag || ''
                });
            });
        }

        // 简化分页，假设总页数很大
        return { list, page, pagecount: 9999, limit: 20, total: 999999 };
    } catch (error) {
        logError("获取分类数据失败", error);
        return { list: [], page: 1, pagecount: 0, limit: 0, total: 0 };
    }
}

async function search(params) {
    const keyword = params.keyword || "";
    const page = parseInt(params.page, 10) || 1;

    try {
        const baseUrl = generateSignature(`${HOST}/vodsearch`);
        const url = `${baseUrl}&wd=${encodeURIComponent(keyword)}`;
        logInfo(`搜索 "${keyword}"`, { url });
        const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
        const data = response.data;
        const list = [];
        if (Array.isArray(data)) {
            data.forEach(vod => {
                const vodId = vod.DId || vod.DuId || '';
                const vodPic = vod.TnId || '';
                list.push({
                    vod_id: decodeDubokuData(vodId),
                    vod_name: vod.Name || '',
                    vod_pic: decodeDubokuData(vodPic),
                    vod_remarks: vod.Tag || '',
                    vod_actor: vod.Actor || '',
                    vod_score: vod.Rating || ''
                });
            });
        }
        logInfo(`搜索 "${keyword}" 找到 ${list.length} 个结果`);
        return { list, page, pagecount: 1, limit: list.length, total: list.length };
    } catch (error) {
        logError("搜索失败", error);
        return { list: [], page: 1, pagecount: 0, limit: 0, total: 0 };
    }
}

async function detail(params) {
    const vodId = params.videoId;

    try {
        let detailPath = vodId.startsWith('/') ? vodId : '/' + vodId;
        const url = generateSignature(HOST + detailPath);
        logInfo("获取详情", { url });
        const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
        const data = response.data;
        if (!data) return { list: [] };

        let vod_play_url = '';
        const playList = [];
        let vod_play_sources = [];
        if (data.Playlist && Array.isArray(data.Playlist)) {
            data.Playlist.forEach(episode => {
                const episodeName = episode.EpisodeName || `第${playList.length + 1}集`;
                const videoId = decodeDubokuData(episode.VId || '');
                if (videoId) {
                    playList.push(`${episodeName}$${videoId}`);
                }
            });
            vod_play_url = playList.join('#');
            const videoIdForScrape = String(vodId || vod_id || "");
            vod_play_sources = [
                {
                    name: '独播库',
                    episodes: playList.map((item, epIndex) => {
                        const parts = item.split('$');
                        const episodeName = parts[0] || '播放';
                        const actualUrl = parts[1] || parts[0];
                        const fid = `${videoIdForScrape}#0#${epIndex}`;
                        const combinedId = `${actualUrl}|||${encodeMeta({ sid: String(videoIdForScrape || ""), fid, v: data.Name || "", e: episodeName })}`;
                        return {
                            name: episodeName,
                            playId: combinedId,
                            _fid: fid,
                            _rawName: episodeName
                        };
                    }).filter(ep => ep.playId)
                }
            ];
        }

        const vod_pic = decodeDubokuData(data.TnId || '');
        const vod_id = decodeDubokuData(data.DId || data.DuId || '') || vodId;
        const detail = {
            vod_id: vod_id,
            vod_name: data.Name || '',
            vod_pic: vod_pic || '',
            vod_remarks: data.Tag ? `评分：${data.Rating || '暂无'}` : '',
            vod_year: data.ReleaseYear || '',
            vod_area: data.Region || '',
            vod_actor: Array.isArray(data.Actor) ? data.Actor.join(',') : data.Actor || '',
            vod_director: data.Director || '',
            vod_content: data.Description || '',
            vod_play_from: '独播库',
            vod_play_url: vod_play_url,
            vod_play_sources: vod_play_sources,
            type_name: `${data.Genre || ''},${data.Scenario || ''},${data.Language || ''}`
        };

        if (vod_play_sources.length > 0) {
            const scrapeCandidates = [];
            for (const source of vod_play_sources) {
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

            if (scrapeCandidates.length > 0) {
                try {
                    const videoIdForScrape = String(vod_id || "");
                    await OmniBox.processScraping(videoIdForScrape, detail.vod_name || "", detail.vod_name || "", scrapeCandidates);
                    const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                    const scrapeData = metadata?.scrapeData || null;
                    const videoMappings = metadata?.videoMappings || [];
                    const scrapeType = metadata?.scrapeType || "";
                    logInfo("刮削元数据读取完成", { hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType });

                    for (const source of vod_play_sources) {
                        for (const ep of source.episodes || []) {
                            const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                            if (!mapping) continue;
                            const oldName = ep.name;
                            const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                            if (newName && newName !== oldName) {
                                ep.name = newName;
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

                    detail.vod_play_sources = vod_play_sources.map((source) => ({
                        name: source.name,
                        episodes: (source.episodes || []).map((ep) => ({
                            name: ep.name,
                            playId: ep.playId
                        }))
                    }));

                    if (scrapeData) {
                        detail.vod_name = scrapeData.title || detail.vod_name;
                        if (scrapeData.posterPath) {
                            detail.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
                        }
                        if (scrapeData.overview) {
                            detail.vod_content = scrapeData.overview;
                        }
                        if (scrapeData.releaseDate) {
                            detail.vod_year = String(scrapeData.releaseDate).substring(0, 4) || detail.vod_year;
                        }
                        const actors = (scrapeData.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",");
                        if (actors) {
                            detail.vod_actor = actors;
                        }
                        const directors = (scrapeData.credits?.crew || [])
                            .filter((c) => c?.job === "Director" || c?.department === "Directing")
                            .slice(0, 3)
                            .map((c) => c?.name)
                            .filter(Boolean)
                            .join(",");
                        if (directors) {
                            detail.vod_director = directors;
                        }
                    }
                } catch (error) {
                    logError("刮削处理失败", error);
                }
            }
        }

        logInfo(`详情获取成功，找到 ${playList.length} 个剧集`);
        return { list: [detail] };
    } catch (error) {
        logError("获取详情失败", error);
        return { list: [] };
    }
}

async function play(params) {
    let playUrl = params.playId;
    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    try {
        if (playUrl && playUrl.includes("|||")) {
            const [mainPlayId, metaB64] = playUrl.split("|||");
            playUrl = mainPlayId;
            playMeta = decodeMeta(metaB64 || "");
            vodName = playMeta.v || "";
            episodeName = playMeta.e || "";
        }
        logInfo('处理播放URL', { playUrl });
        let finalUrl = playUrl;
        if (!playUrl.startsWith('http')) {
            if (playUrl.startsWith('/')) {
                finalUrl = HOST + playUrl;
            } else {
                finalUrl = HOST + '/' + playUrl;
            }
        }
        const signedUrl = generateSignature(finalUrl);
        logInfo('签名后的播放URL', { signedUrl });

        const response = await axiosInstance.get(signedUrl, { headers: DEFAULT_HEADERS });
        const data = response.data;
        if (!data || !data.HId) {
            logInfo('未找到播放地址，回退 parse=1');
            return {
                urls: [{ name: "回退", url: playUrl }],
                parse: 1,
                header: {
                    "User-Agent": UA,
                    "Referer": REFERER_HOST + "/",
                    "Origin": REFERER_HOST
                }
            };
        }

        const videoUrl = decodeDubokuData(data.HId);
        if (!videoUrl) {
            logInfo('视频地址解码失败，回退 parse=1');
            return {
                urls: [{ name: "回退", url: playUrl }],
                parse: 1,
                header: {
                    "User-Agent": UA,
                    "Referer": REFERER_HOST + "/",
                    "Origin": REFERER_HOST
                }
            };
        }

        logInfo('解码后的视频地址', { videoUrl });
        let playResponse = {
            urls: [{ name: "播放", url: videoUrl }],
            parse: isDirectVideoUrl(videoUrl) ? 0 : 1,
            header: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept-Encoding": "gzip, deflate",
                "origin": "https://w.duboku.io",
                "referer": "https://w.duboku.io/",
                "priority": "u=1, i"
            }
        };

        if (playResponse.parse === 1 && playResponse.urls[0]?.url) {
            const sniffResult = await sniffDubokuPlay(playResponse.urls[0].url);
            if (sniffResult) {
                playResponse = sniffResult;
            }
        }

        if (DANMU_API && (vodName || params.vodName)) {
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
                            vodName || params.vodName,
                            episodeName || params.episodeName
                        );
                    }
                }
            } catch (error) {
                logInfo(`读取刮削元数据失败: ${error.message || error}`);
            }

            const finalVodName = vodName || params.vodName;
            const finalEpisodeName = episodeName || params.episodeName || '';
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(finalVodName, finalEpisodeName);
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList && danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                }
            }
        }

        return playResponse;
    } catch (error) {
        logError("播放解析失败", error);
        const fallbackSniff = await sniffDubokuPlay(playUrl);
        if (fallbackSniff) {
            return fallbackSniff;
        }
        return {
            urls: [{ name: "回退", url: playUrl }],
            parse: 1,
            header: {
                "User-Agent": UA,
                "Referer": REFERER_HOST + "/",
                "Origin": REFERER_HOST
            }
        };
    }
}

module.exports = { home, category, search, detail, play };
const runner = require("spider_runner");
runner.run(module.exports);
