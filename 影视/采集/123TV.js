// @name 123TV
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，广告：菠菜
// @dependencies: axios
// @version 1.0.4
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/123TV.js

/**
 * ============================================================================
 * 123TV
 * 刮削：支持
 * 弹幕：支持
 * 嗅探：支持
 * ============================================================================
 */
const axios = require("axios");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const host = 'https://a123tv.com';
const def_headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Accept': '*/*'
};

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 15000
});

// 弹幕API配置
const DANMU_API = process.env.DANMU_API || '';

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[123TV-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[123TV-DEBUG] ${message}: ${error.message || error}`);
};

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
    } catch (_) {
        return '';
    }
};

const decodeMeta = (str) => {
    try {
        return JSON.parse(Buffer.from(str || '', 'base64').toString('utf8'));
    } catch (_) {
        return null;
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
        const hit = scrapeData.episodes.find(
            (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
        );
        if (hit?.name) {
            return `${hit.episodeNumber}.${hit.name}`;
        }
    }
    return originalName;
};

// ========== 弹幕相关函数 ==========

/**
 * 预处理标题,去掉常见干扰项
 */
function preprocessTitle(title) {
    if (!title) return '';
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, ' ')
        .replace(/[hH]\.?26[45]/g, ' ')
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, ' ')
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, ' ');
}

/**
 * 将中文数字转换为阿拉伯数字
 */
function chineseToArabic(cn) {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn, 10);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

/**
 * 从标题中提取集数数字
 */
function extractEpisode(title) {
    if (!title) return '';
    const processedTitle = preprocessTitle(title).trim();

    // 1. 中文格式:第XX集/话
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    // 2. S01E03 格式
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    // 3. EP/E 格式
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    // 4. 括号格式 [03]
    const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!['720', '1080', '480'].includes(num)) return num;
    }

    return '';
}

/**
 * 构建用于弹幕匹配的文件名
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return '';
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
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
}

/**
 * 匹配弹幕
 */
async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) return [];
    try {
        logInfo(`匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            body: JSON.stringify({ fileName })
        });

        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body || '{}');
        if (!matchData.isMatched) {
            logInfo('弹幕未匹配到');
            return [];
        }

        const matches = matchData.matches || [];
        if (matches.length === 0) return [];

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || '';
        const episodeTitle = firstMatch.episodeTitle || '';
        if (!episodeId) return [];

        let danmakuName = '弹幕';
        if (animeTitle && episodeTitle) danmakuName = `${animeTitle} - ${episodeTitle}`;
        else if (animeTitle) danmakuName = animeTitle;
        else if (episodeTitle) danmakuName = episodeTitle;

        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;
        logInfo(`弹幕匹配成功: ${danmakuName}`);
        return [{ name: danmakuName, url: danmakuURL }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
}

/**
 * 图像地址修复
 */
const fixPicUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return url.startsWith('//') ? `https:${url}` : `https://${url}`;
};

/**
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniff123tvPlay = async (playUrl) => {
    if (!playUrl) return null;
    try {
        logInfo("尝试嗅探播放页", playUrl);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", sniffed.url);
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || { ...def_headers, Referer: playUrl }
            };
        }
    } catch (error) {
        logInfo(`嗅探失败: ${error.message}`);
    }
    return null;
};

/**
 * 核心:解析 CMS 字符串为结构化播放源 [1]
 * T3格式转T4格式的关键函数
 */
const parsePlaySources = (fromStr, urlStr, videoId = '', vodName = '') => {
    logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
    const playSources = [];
    if (!fromStr || !urlStr) return playSources;

    const froms = fromStr.split('$$$');
    const urls = urlStr.split('$$$');

    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];

        const episodes = sourceItems.map((item, episodeIndex) => {
            const parts = item.split('$');
            const episodeName = parts[0] || '正片';
            const rawPlayId = parts[1] || parts[0];
            const fid = `${videoId}#${i}#${episodeIndex}`;
            const playMeta = {
                sid: videoId,
                fid,
                v: vodName,
                e: episodeIndex + 1
            };
            return {
                name: episodeName,
                playId: `${rawPlayId}|||${encodeMeta(playMeta)}`,
                _fid: fid,
                _rawName: episodeName
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

const buildPosterUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `https://image.tmdb.org/t/p/w500${path}`;
};

/**
 * 首页接口 [2]
 */
async function home(params) {
    logInfo("进入首页");

    try {
        const res = await axiosInstance.get(host, { headers: def_headers });
        const html = res.data;

        // 解析视频列表
        const regex = /<a class="w4-item" href="([^"]+)".*?<img.*?data-src="([^"]+)".*?<div class="s">.*?<span>([^<]+)<\/span>.*?<div class="t"[^>]*title="([^"]+)">.*?<div class="i">([^<]+)<\/div>/gs;
        const videos = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            videos.push({
                vod_id: match[1],
                vod_name: match[4].trim(),
                vod_pic: fixPicUrl(match[2]),
                vod_remarks: match[3].trim()
            });
        }

        return {
            list: videos,

            class: [
                { 'type_id': '10', 'type_name': '电影' },
                { 'type_id': '11', 'type_name': '连续剧' },
                { 'type_id': '12', 'type_name': '综艺' },
                { 'type_id': '13', 'type_name': '动漫' },
                // { 'type_id': '15', 'type_name': '福利' }
            ],
            filters: {
                '10': [{
                    "key": "class", "name": "类型", "value": [
                        { "name": "全部", "value": "" }, { "name": "动作片", "value": "1001" }, { "name": "喜剧片", "value": "1002" },
                        { "name": "爱情片", "value": "1003" }, { "name": "科幻片", "value": "1004" }, { "name": "恐怖片", "value": "1005" },
                        { "name": "剧情片", "value": "1006" }, { "name": "战争片", "value": "1007" }, { "name": "纪录片", "value": "1008" },
                        { "name": "动漫电影", "value": "1010" }, { "name": "奇幻片", "value": "1011" }, { "name": "动画片", "value": "1013" },
                        { "name": "犯罪片", "value": "1014" }, { "name": "悬疑片", "value": "1016" }, { "name": "邵氏电影", "value": "1019" },
                        { "name": "歌舞片", "value": "1022" }, { "name": "家庭片", "value": "1024" }, { "name": "古装片", "value": "1025" },
                        { "name": "历史片", "value": "1026" }, { "name": "4K电影", "value": "1027" }
                    ]
                }],
                '11': [{
                    "key": "class", "name": "地区", "value": [
                        { "name": "全部", "value": "" }, { "name": "国产剧", "value": "1101" }, { "name": "香港剧", "value": "1102" },
                        { "name": "台湾剧", "value": "1105" }, { "name": "韩国剧", "value": "1103" }, { "name": "欧美剧", "value": "1104" },
                        { "name": "日本剧", "value": "1106" }, { "name": "泰国剧", "value": "1108" }, { "name": "港台剧", "value": "1110" },
                        { "name": "日韩剧", "value": "1111" }, { "name": "海外剧", "value": "1107" }
                    ]
                }],
                '12': [{
                    "key": "class", "name": "类型", "value": [
                        { "name": "全部", "value": "" }, { "name": "内地综艺", "value": "1201" }, { "name": "港台综艺", "value": "1202" },
                        { "name": "日韩综艺", "value": "1203" }, { "name": "欧美综艺", "value": "1204" }, { "name": "国外综艺", "value": "1205" }
                    ]
                }],
                '13': [{
                    "key": "class", "name": "类型", "value": [
                        { "name": "全部", "value": "" }, { "name": "国产动漫", "value": "1301" }, { "name": "日韩动漫", "value": "1302" },
                        { "name": "欧美动漫", "value": "1303" }, { "name": "海外动漫", "value": "1305" }, { "name": "里番", "value": "1307" }
                    ]
                }],
                '15': [{
                    "key": "class", "name": "分类", "value": [
                        { "name": "全部", "value": "" }, { "name": "韩国情色片", "value": "1551" }, { "name": "日本情色片", "value": "1552" },
                        { "name": "大陆情色片", "value": "1555" }, { "name": "香港情色片", "value": "1553" }, { "name": "台湾情色片", "value": "1554" },
                        { "name": "美国情色片", "value": "1556" }, { "name": "欧洲情色片", "value": "1557" }, { "name": "印度情色片", "value": "1558" },
                        { "name": "东南亚情色片", "value": "1559" }, { "name": "其它情色片", "value": "1550" }
                    ]
                }]
            }
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 分类接口 [2]
 */
async function category(params) {
    const { categoryId, page, filters } = params;
    const pg = parseInt(page) || 1;

    // 处理筛选参数
    let tid = categoryId;
    if (filters && filters.class) {
        tid = filters.class;
    }

    const url = pg === 1
        ? `${host}/t/${tid}.html`
        : `${host}/t/${tid}/p${pg}.html`;

    logInfo(`请求分类: ${tid}, 页码: ${pg}, URL: ${url}`);

    try {
        const res = await axiosInstance.get(url, { headers: def_headers });
        const html = res.data;

        // 解析视频列表
        const regex = /<a class="w4-item" href="([^"]+)".*?<img.*?data-src="([^"]+)".*?<div class="s">.*?<span>([^<]+)<\/span>.*?<div class="t"[^>]*title="([^"]+)">.*?<div class="i">([^<]+)<\/div>/gs;
        const videos = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            videos.push({
                vod_id: match[1],
                vod_name: match[4].trim(),
                vod_pic: fixPicUrl(match[2]),
                vod_remarks: match[3].trim()
            });
        }

        // 解析总页数
        const pageRegex = /\/p(\d+)\.html"[^>]*>(\d+)<\/a>/g;
        let maxPage = pg;
        let pageMatch;
        while ((pageMatch = pageRegex.exec(html)) !== null) {
            maxPage = Math.max(maxPage, parseInt(pageMatch[2]));
        }

        logInfo(`分类结果: ${videos.length}条, 总页数: ${maxPage}`);

        return {
            list: videos,
            page: pg,
            pagecount: maxPage
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 搜索接口 [2]
 */
async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;

    const encodedKw = encodeURIComponent(wd);
    const url = pg === 1
        ? `${host}/s/${encodedKw}.html`
        : `${host}/s/${encodedKw}/p${pg}.html`;

    logInfo(`搜索关键词: ${wd}, 页码: ${pg}, URL: ${url}`);

    try {
        const res = await axiosInstance.get(url, { headers: def_headers });
        const html = res.data;

        // 解析搜索结果
        const regex = /<a class="w4-item" href="([^"]+)".*?<img.*?data-src="([^"]+)".*?<div class="t"[^>]*>([^<]+)<\/div>.*?<div class="i">([^<]+)<\/div>/gs;
        const videos = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            videos.push({
                vod_id: match[1],
                vod_name: match[3].trim(),
                vod_pic: fixPicUrl(match[2]),
                vod_remarks: match[4].trim()
            });
        }

        logInfo(`搜索结果: ${videos.length}条`);

        return {
            list: videos,
            page: pg,
            pagecount: 10
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 详情接口 [1][2]
 * 关键：将T3的vod_play_from/vod_play_url转换为T4的vod_play_sources
 */
async function detail(params, context) {
    const videoId = params.videoId;
    const url = videoId.startsWith('http') ? videoId : `${host}${videoId}`;

    logInfo(`请求详情: ${videoId}, URL: ${url}`);

    try {
        const res = await axiosInstance.get(url, { headers: def_headers });
        const html = res.data;

        const vod = {
            vod_id: videoId,
            vod_name: '',
            vod_pic: '',
            vod_type: '',
            vod_year: '',
            vod_area: '',
            vod_remarks: '',
            vod_actor: '',
            vod_director: '',
            vod_content: ''
        };

        // 解析标题
        const titleMatch = html.match(/<li class="on"><h1>([^<]+)<\/h1><\/li>/);
        if (titleMatch) vod.vod_name = titleMatch[1];

        // 解析封面
        const picMatch = html.match(/data-poster="([^"]+)"/);
        if (picMatch) vod.vod_pic = fixPicUrl(picMatch[1]);

        // 解析描述和演员信息
        const descMatch = html.match(/name="description" content="(.*?)"/);
        if (descMatch) {
            const content = descMatch[1];
            vod.vod_content = content;

            const actorMatch = content.match(/演员:(.*?)(。|$)/);
            if (actorMatch) vod.vod_actor = actorMatch[1];

            const areaMatch = content.match(/地区:(.*?)(。|$)/);
            if (areaMatch) vod.vod_area = areaMatch[1];

            const directorMatch = content.match(/导演:(.*?)(。|$)/);
            if (directorMatch) vod.vod_director = directorMatch[1];
        }

        // 解析播放源数据 [2]
        const scriptMatch = html.match(/var pp=({.*?});/s);
        if (scriptMatch) {
            try {
                const ppData = JSON.parse(scriptMatch[1]);
                const vno = ppData.no;
                const playFromArr = [];
                const playUrlArr = [];

                for (const line of ppData.la || []) {
                    const [lineId, lineName, episodeCount] = line;
                    const episodes = [];

                    for (let i = 0; i < episodeCount; i++) {
                        episodes.push(`第${i + 1}集$/v/${vno}/${lineId}z${i}.html`);
                    }

                    if (episodes.length > 0) {
                        playFromArr.push(lineName);
                        playUrlArr.push(episodes.join('#'));
                    }
                }

                // T3格式数据
                const vodPlayFrom = playFromArr.join('$$$');
                const vodPlayUrl = playUrlArr.join('$$$');

                // 转换为T4格式 [1]
                vod.vod_play_sources = parsePlaySources(vodPlayFrom, vodPlayUrl, videoId, vod.vod_name);

                logInfo("播放源解析完成", {
                    fromCount: playFromArr.length,
                    sources: vod.vod_play_sources.length
                });

                const scrapeCandidates = [];
                for (const source of vod.vod_play_sources || []) {
                    for (const episode of source.episodes || []) {
                        if (!episode || !episode._fid) continue;
                        const name = episode._rawName || episode.name || '正片';
                        scrapeCandidates.push({
                            fid: episode._fid,
                            file_id: episode._fid,
                            file_name: name,
                            name,
                            format_type: 'video'
                        });
                    }
                }

                if (scrapeCandidates.length > 0 && vod.vod_name) {
                    const sourceId = `spider_source_${context.sourceId}_${videoId}`;
                    const scrapingResult = await OmniBox.processScraping(
                        sourceId,
                        vod.vod_name,
                        vod.vod_name,
                        scrapeCandidates
                    );
                    logInfo(`刮削处理完成,结果: ${JSON.stringify(scrapingResult).substring(0, 200)}`);

                    const metadata = await OmniBox.getScrapeMetadata(sourceId);
                    const scrapeData = metadata?.scrapeData || null;
                    const videoMappings = metadata?.videoMappings || [];

                    if (scrapeData) {
                        vod.vod_name = scrapeData.title || scrapeData.name || vod.vod_name;
                        const poster = scrapeData.posterPath || scrapeData.poster_path || scrapeData.poster || '';
                        vod.vod_pic = poster ? buildPosterUrl(poster) : vod.vod_pic;
                        const releaseDate = scrapeData.releaseDate || scrapeData.release_date || '';
                        vod.vod_year = releaseDate ? String(releaseDate).substring(0, 4) : vod.vod_year;
                        vod.vod_content = scrapeData.overview || vod.vod_content;
                        vod.vod_actor = scrapeData.actors || vod.vod_actor;
                        vod.vod_director = scrapeData.director || vod.vod_director;

                        if (scrapeData.credits?.cast) {
                            const actors = scrapeData.credits.cast
                                .slice(0, 5)
                                .map((c) => c?.name)
                                .filter(Boolean)
                                .join(',');
                            if (actors) vod.vod_actor = actors;
                        }
                        if (scrapeData.credits?.crew) {
                            const directors = scrapeData.credits.crew
                                .filter((c) => c?.job === 'Director' || c?.department === 'Directing')
                                .slice(0, 3)
                                .map((c) => c?.name)
                                .filter(Boolean)
                                .join(',');
                            if (directors) vod.vod_director = directors;
                        }

                        vod.vod_play_sources = (vod.vod_play_sources || []).map((source) => {
                            const episodes = (source.episodes || []).map((ep) => {
                                const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                                if (!mapping) return ep;
                                const oldName = ep.name || '';
                                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                                if (oldName !== newName) {
                                    logInfo(`应用刮削后源文件名: ${oldName} -> ${newName}`);
                                }
                                return {
                                    ...ep,
                                    name: newName,
                                    _sortSeason: mapping.seasonNumber || 0,
                                    _sortEpisode: mapping.episodeNumber || 0
                                };
                            }).sort((a, b) => {
                                if ((a._sortSeason || 0) !== (b._sortSeason || 0)) {
                                    return (a._sortSeason || 0) - (b._sortSeason || 0);
                                }
                                return (a._sortEpisode || 0) - (b._sortEpisode || 0);
                            }).map((ep) => ({
                                name: ep.name,
                                playId: ep.playId
                            }));

                            return {
                                ...source,
                                episodes
                            };
                        });
                    }
                }
            } catch (e) {
                logError("解析播放源数据失败", e);
            }
        }

        return { list: [vod] };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

/**
 * 播放接口 [2]
 */
async function play(params, context) {
    const rawInputPlayId = params.playId || '';
    const [rawPlayId, encodedMeta] = String(rawInputPlayId).split('|||');
    const meta = decodeMeta(encodedMeta || '') || {};
    const playId = rawPlayId || rawInputPlayId;
    const url = `${host}${playId}`;
    const vodId = params.vodId || meta.sid || '';

    let vodName = meta.v || '';
    const episodeName = meta.fid || '';
    let scrapedDanmuFileName = '';

    logInfo(`准备播放: ${playId}, URL: ${url}`);

    try {
        if (vodId) {
            const sourceId = `spider_source_${context.sourceId}_${vodId}`;
            const metadata = await OmniBox.getScrapeMetadata(sourceId);
            logInfo('播放阶段读取刮削元数据', {
                vodId,
                hit: !!(metadata && metadata.data),
                episode: meta.fid || ''
            });

            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === meta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(
                    metadata.scrapeData,
                    metadata.scrapeType || '',
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

        const res = await axiosInstance.get(url, { headers: def_headers });
        const html = res.data;

        // 解析真实播放地址
        const match = html.match(/data-src="([^"]+)"/);
        if (match) {
            const playUrl = match[1];
            logInfo(`解析到播放地址: ${playUrl}`);

            // 检查是否是直接播放链接
            if (playUrl.match(/\.(m3u8|mp4|flv|avi|mkv|ts)/i)) {
                const response = {
                    urls: [{ name: '默认', url: playUrl }],
                    parse: 0,
                    header: def_headers
                };

                if (DANMU_API && (vodName || meta.v)) {
                    const fallbackVodName = meta.v || vodName;
                    const fileName = scrapedDanmuFileName || buildFileNameForDanmu(fallbackVodName, episodeName);
                    logInfo(`尝试匹配弹幕文件名: ${fileName}`);
                    if (fileName) {
                        const danmakuList = await matchDanmu(fileName);
                        if (danmakuList && danmakuList.length > 0) {
                            response.danmaku = danmakuList;
                            logInfo('弹幕已添加到播放响应');
                        }
                    }
                }

                return response;

            }
        }

        const sniffResult = await sniff123tvPlay(url);
        if (sniffResult) {
            return sniffResult;
        }
    } catch (e) {
        logError("解析播放地址失败", e);
        const fallbackSniff = await sniff123tvPlay(url);
        if (fallbackSniff) {
            return fallbackSniff;
        }
    }

    return {
        urls: [{ name: "默认", url: "" }],
        parse: 0,
        header: def_headers
    };
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
