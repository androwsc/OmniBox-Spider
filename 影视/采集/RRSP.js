// @name RRSP
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/RRSP.js


/**
 * ============================================================================
 * RRSP资源 - OmniBox 爬虫脚本 (增强日志调试版)
 * ============================================================================
 */
const axios = require("axios");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 [1] ==========
const host = 'https://rrsp-api.kejiqianxian.com:60425';
const DANMU_API = process.env.DANMU_API || '';
const def_headers = {
    'User-Agent': 'rrsp.wang',
    'origin': '*',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
};

const headers = {
    ...def_headers,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'accept-language': 'zh-CN'
};

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

/**
 * 日志工具函数 [2]
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[RRSP-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[RRSP-DEBUG] ${message}: ${error.message || error}`);
};

/**
 * 图像地址修复 [1]
 */
const fixPicUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return url.startsWith('/') ? `${host}${url}` : `${host}/${url}`;
};

const proxyImageDomains = new Set([
    'img1.doubanio.com',
    'img2.doubanio.com',
    'img3.doubanio.com'
]);

const processImageUrl = (imageUrl, baseURL = '') => {
    if (!imageUrl) return '';
    const url = fixPicUrl(imageUrl);
    if (!baseURL || !url.startsWith('http')) return url;

    try {
        const urlObj = new URL(url);
        if (!proxyImageDomains.has(urlObj.hostname)) return url;
        const referer = `${urlObj.protocol}//${urlObj.host}`;
        const urlWithHeaders = `${url}@Referer=${referer}`;
        const encodedUrl = encodeURIComponent(urlWithHeaders);
        return `${baseURL}/api/proxy/image?url=${encodedUrl}`;
    } catch (error) {
        logError("处理图片 URL 失败", error);
        return url;
    }
};

// ========== 弹幕工具函数 ==========
const preprocessTitle = (title) => {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
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
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;

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

const matchDanmu = async (fileName) => {
    if (!DANMU_API || !fileName) return [];

    try {
        logInfo(`匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName }),
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

        return [{
            name: danmakuName,
            url: danmakuURL,
        }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
};

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
    } catch {
        return '';
    }
};

const decodeMeta = (str) => {
    try {
        return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
    } catch {
        return {};
    }
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
        const hit = scrapeData.episodes.find((ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber);
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
    if (scrapeType === 'movie') {
        return scrapeData.title || fallbackVodName;
    }
    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || '';
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
};

/**
 * 核心：解析 CMS 字符串为结构化播放源 [1][2]
 * 逻辑：将 "来源1$$$来源2" 和 "第1集$ID1#第2集$ID2" 转换为 UI 识别的数组
 */
const parsePlaySources = (fromStr, urlStr, vodName = '', videoId = '') => {
    logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
    const playSources = [];
    if (!fromStr || !urlStr) return playSources;

    const froms = fromStr.split('$$$');
    const urls = urlStr.split('$$$');

    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];

        const episodes = sourceItems.map((item, epIndex) => {
            const parts = item.split('$');
            const episodeName = parts[0] || '正片';
            const actualPlayId = parts[1] || parts[0];
            const fid = `${videoId}#${i}#${epIndex}`;
            return {
                name: episodeName,
                playId: `${actualPlayId}|||${encodeMeta({ v: vodName || '', e: episodeName, sid: videoId, fid })}`,
                _fid: fid,
                _rawName: episodeName,
            };
        }).filter(e => e.playId);

        if (episodes.length > 0) {
            playSources.push({
                name: sourceName,
                episodes: episodes
            });
        }
    }
    logInfo("播放源解析结果", playSources);
    return playSources;
};

const arr2vods = (arr, baseURL = '') => {
    const videos = [];
    if (!arr) return videos;
    for (const i of arr) {
        let remarks;
        if (i.vod_serial === '1') {
            remarks = `${i.vod_serial}集`;
        } else {
            remarks = `评分:${i.vod_score || i.vod_douban_score || ''}`;
        }
        videos.push({
            vod_id: i.vod_id + "",
            vod_name: i.vod_name,
            vod_pic: processImageUrl(i.vod_pic, baseURL),
            vod_remarks: remarks
        });
    }
    return videos;
};

// ========== 接口实现 ==========

async function home(params, context) {
    logInfo("进入首页");
    const baseURL = context?.baseURL || '';
    let list = [];
    try {
        const res = await axiosInstance.post(`${host}/api.php/main_program/moviesAll/`, {
            type: '0',
            sort: 'vod_time',
            page: 1,
            limit: '100'
        }, { headers: headers });

        logInfo("首页接口返回原始数据", res.data);
        list = arr2vods(res.data?.data?.list || [], baseURL);
    } catch (e) {
        logError("首页请求失败", e);
    }

    return {
        class: [
            { 'type_id': '1', 'type_name': '电影' },
            { 'type_id': '2', 'type_name': '电视剧' },
            { 'type_id': '3', 'type_name': '综艺' },
            { 'type_id': '5', 'type_name': '动漫' },
            { 'type_id': '4', 'type_name': '纪录片' },
            { 'type_id': '6', 'type_name': '短剧' }
        ],
        list:list
    };
}

async function category(params, context) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    const baseURL = context?.baseURL || '';
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/main_program/moviesAll/`, {
            type: categoryId || '',
            sort: 'vod_time',
            page: pg,
            limit: '60'
        }, { headers: headers });

        logInfo("分类接口返回原始数据", res.data);

        const r = {
            list: arr2vods(res.data.data.list, baseURL),
            page: parseInt(res.data.data.page) || pg,
            pagecount: parseInt(res.data.data.pagecount) || 100
        };

        OmniBox.log("info", `category r：${JSON.stringify(r)}`)

        return r;
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function detail(params, context) {
    const videoId = params.videoId;
    const baseURL = context?.baseURL || '';
    logInfo(`请求详情 ID: ${videoId}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/player/details/`, { id: videoId }, { headers: headers });
        const data = res.data.detailData;

        logInfo("详情接口返回原始数据", data);

        // 修复：补全图片并解析播放源 [1][2]
        const videoIdForScrape = String(videoId || data.vod_id || '');
        const playSources = parsePlaySources(data.vod_play_from, data.vod_play_url, data.vod_name, videoIdForScrape);

        // 刮削处理
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = '';
        const scrapeCandidates = [];
        for (const source of playSources) {
            for (const ep of (source.episodes || [])) {
                if (!ep._fid) continue;
                scrapeCandidates.push({
                    fid: ep._fid,
                    file_id: ep._fid,
                    file_name: ep._rawName || ep.name || '正片',
                    name: ep._rawName || ep.name || '正片',
                    format_type: 'video',
                });
            }
        }

        if (scrapeCandidates.length > 0) {
            try {
                const scrapingResult = await OmniBox.processScraping(videoIdForScrape, data.vod_name || '', data.vod_name || '', scrapeCandidates);
                OmniBox.log('info', `[RRSP-DEBUG] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);

                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || '';
                logInfo('刮削元数据读取完成', { mappingCount: videoMappings.length, hasScrapeData: !!scrapeData, scrapeType });
            } catch (e) {
                logError('刮削处理失败', e);
            }
        }

        if (videoMappings.length > 0) {
            for (const source of playSources) {
                for (const ep of (source.episodes || [])) {
                    const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                    if (!mapping) continue;
                    const oldName = ep.name;
                    const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                    if (newName && newName !== oldName) {
                        ep.name = newName;
                        OmniBox.log('info', `[RRSP-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
                    }
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
        }

        const normalizedPlaySources = playSources.map((source) => ({
            name: source.name,
            episodes: (source.episodes || []).map((ep) => ({
                name: ep.name,
                playId: ep.playId,
            })),
        }));

        return {
            list: [{
                vod_id: videoIdForScrape,
                vod_name: scrapeData?.title || data.vod_name,
                vod_pic: processImageUrl(scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : fixPicUrl(data.vod_pic), baseURL),
                vod_content: scrapeData?.overview || data.vod_content,
                vod_play_sources: normalizedPlaySources, // 关键：荐片架构必须返回此数组
                vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : data.vod_year,
                vod_area: data.vod_area,
                vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || data.vod_actor,
                vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || '',
                type_name: data.vod_class
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

async function search(params, context) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    const baseURL = context?.baseURL || '';
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);
    try {
        const res = await axiosInstance.post(`${host}/api.php/search/syntheticalSearch/`, {
            keyword: wd,
            page: pg,
            limit: '20'
        }, { headers: headers });

        const data = res.data.data;
        const videos = [...arr2vods(data.chasingFanCorrelation, baseURL), ...arr2vods(data.moviesCorrelation, baseURL)];

        const r = {
            list: videos,
            page: pg,
            pagecount: data.pagecount || 10,
            total: videos.length
        };

        OmniBox.log('info', `搜索响应：${JSON.stringify(r)}`)

        return r;
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function play(params) {
    let playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);
    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    if (playId && playId.includes('|||')) {
        const [mainPlayId, metaB64] = playId.split('|||');
        playId = mainPlayId || '';
        playMeta = decodeMeta(metaB64 || '');
        vodName = playMeta.v || '';
        episodeName = playMeta.e || '';
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    } else if (playId && playId.includes('|')) {
        // 兼容旧格式
        const parts = playId.split('|');
        playId = parts.shift() || '';
        vodName = parts.shift() || '';
        episodeName = parts.join('|') || '';
        logInfo(`解析旧透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    let scrapedDanmuFileName = '';
    try {
        const videoIdFromParam = params.vodId ? String(params.vodId) : '';
        const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : '';
        const videoIdForScrape = videoIdFromParam || videoIdFromMeta;

        if (videoIdForScrape) {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(metadata.scrapeData, metadata.scrapeType || '', mapping, vodName, episodeName);
                if (metadata.scrapeData.title) vodName = metadata.scrapeData.title;
                if (mapping?.episodeName) episodeName = mapping.episodeName;
            }
        }
    } catch (e) {
        logInfo(`读取刮削元数据失败: ${e.message}`);
    }

    let url = '';

    try {
        const res = await axiosInstance.post(`${host}/api.php/player/payVideoUrl/`, { url: playId }, { headers: def_headers });
        logInfo("解析接口返回", res.data);
        url = res.data.data.url;
    } catch (e) {
        logError("解析播放地址失败", e);
    }

    const finalUrl = (url && url.startsWith('http')) ? url : playId;
    logInfo(`最终播放地址: ${finalUrl}`);

    const playResponse = {
        urls: [{ name: "极速云", url: finalUrl }],
        parse: 0,
        header: { ...def_headers, 'referer': 'https://docs.qq.com/' }
    };

    if (DANMU_API && vodName) {
        const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
        logInfo(`尝试匹配弹幕文件名: ${fileName}`);
        if (fileName) {
            const danmakuList = await matchDanmu(fileName);
            if (danmakuList && danmakuList.length > 0) {
                playResponse.danmaku = danmakuList;
                logInfo(`弹幕已添加到播放响应`);
            }
        }
    } else if (!DANMU_API) {
        logInfo("DANMU_API 未配置，跳过弹幕匹配");
    }

    return playResponse;
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
