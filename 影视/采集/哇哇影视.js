// @name 哇哇影视
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, crypto
// @version 1.0.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/哇哇影视.js

const crypto = require('crypto');
const axios = require('axios');
const OmniBox = require('omnibox_sdk');

// ========== 全局变量 ==========
let globalConfig = {
    HOST: '',
    APP_KEY: '',
    RSA_KEY: '',
    CONF: null
};

const DANMU_API = process.env.DANMU_API || "";

const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[哇哇影视] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[哇哇影视] ${message}: ${error?.message || error}`);
};

const PLAY_HEADERS = {
    'User-Agent': 'dart:io'
};

function encodeMeta(obj) {
    try {
        return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
    } catch {
        return '';
    }
}

function decodeMeta(str) {
    try {
        return JSON.parse(Buffer.from(str || '', 'base64').toString('utf8') || '{}');
    } catch {
        return {};
    }
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

// ========== 弹幕工具 ==========
function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
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
    if (!DANMU_API || !fileName) return [];

    try {
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
            OmniBox.log("info", `[哇哇影视] 弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) return [];

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

        return [{
            name: danmakuName,
            url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`,
        }];
    } catch (error) {
        OmniBox.log("info", `[哇哇影视] 弹幕匹配失败: ${error.message}`);
        return [];
    }
}

/**
 * 嗅探播放页，兜底提取真实视频地址
 */
async function sniffWawaPlay(playUrl) {
    if (!playUrl) return null;
    try {
        OmniBox.log('info', `[哇哇影视] 尝试嗅探播放页: ${playUrl}`);
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            OmniBox.log('info', `[哇哇影视] 嗅探成功: ${sniffed.url}`);
            return {
                parse: 0,
                url: sniffed.url,
                header: sniffed.header || { ...PLAY_HEADERS, Referer: playUrl }
            };
        }
    } catch (e) {
        OmniBox.log('info', `[哇哇影视] 嗅探失败: ${e.message}`);
    }
    return null;
}

// ========== 加密工具类 ==========
const WawaCrypto = {
    // 生成 UUID (32位 Hex)
    uuid: function () {
        const s = [];
        const hexDigits = "0123456789abcdef";
        for (let i = 0; i < 36; i++) {
            s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
        }
        s[14] = "4";
        s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);
        s[8] = s[13] = s[18] = s[23] = ""; // 移除连字符
        return s.join("");
    },

    // AES-128-ECB 解密
    decrypt: function (encryptedData) {
        try {
            const key = Buffer.from('Crm4FXWkk5JItpYirFDpqg==', 'base64');
            const hexStr = Buffer.from(encryptedData, 'base64').toString('utf8');
            const encryptedBuffer = Buffer.from(hexStr, 'hex');

            const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
            decipher.setAutoPadding(true);
            let decrypted = decipher.update(encryptedBuffer);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString('utf8');
        } catch (e) {
            OmniBox.log("error", "解密失败: " + e.message);
            return null;
        }
    },

    // RSA-SHA256 签名
    sign: function (message, privateKeyStr) {
        try {
            let pemKey = privateKeyStr;
            if (!pemKey.includes('-----BEGIN PRIVATE KEY-----')) {
                const chunks = privateKeyStr.match(/.{1,64}/g).join('\n');
                pemKey = `-----BEGIN PRIVATE KEY-----\n${chunks}\n-----END PRIVATE KEY-----`;
            }

            const sign = crypto.createSign('RSA-SHA256');
            sign.update(message);
            sign.end();
            const signature = sign.sign(pemKey);
            return signature.toString('base64');
        } catch (e) {
            OmniBox.log("error", "签名失败: " + e.message);
            return '';
        }
    },

    // MD5
    md5: function (str) {
        return crypto.createHash('md5').update(str).digest('hex');
    }
};

// ========== 网络请求封装 ==========

/**
 * 初始化配置 (获取 Gitee 上的加密配置)
 */
async function initConf() {
    if (globalConfig.HOST) return;

    try {
        const uid = WawaCrypto.uuid();
        const t = Date.now().toString();
        const signStr = `appKey=3bbf7348cf314874883a18d6b6fcf67a&uid=${uid}&time=${t}`;
        const sign = WawaCrypto.md5(signStr);

        const url = 'https://gitee.com/api/v5/repos/aycapp/openapi/contents/wawaconf.txt?access_token=74d5879931b9774be10dee3d8c51008e';
        const headers = {
            "User-Agent": "okhttp/4.9.3",
            "uid": uid,
            "time": t,
            "sign": sign
        };

        const res = await axios.get(url, { headers: headers, timeout: 5000 });

        if (res.data && res.data.content) {
            const decryptedJson = WawaCrypto.decrypt(res.data.content);
            if (decryptedJson) {
                const conf = JSON.parse(decryptedJson);
                globalConfig.CONF = conf;
                globalConfig.HOST = conf.baseUrl;
                globalConfig.APP_KEY = conf.appKey;
                globalConfig.RSA_KEY = conf.appSecret;
                OmniBox.log("info", "初始化成功: " + globalConfig.HOST);
            }
        }
    } catch (e) {
        OmniBox.log("error", "初始化失败: " + e.message);
    }
}

/**
 * 获取业务请求头 
 */
async function getWawaHeaders() {
    // 双重保障：确保配置已加载
    if (!globalConfig.HOST) await initConf();

    const uid = WawaCrypto.uuid();
    const t = Date.now().toString();
    const signStr = `appKey=${globalConfig.APP_KEY}&time=${t}&uid=${uid}`;
    const sign = WawaCrypto.sign(signStr, globalConfig.RSA_KEY);

    return {
        'User-Agent': 'okhttp/4.9.3',
        'uid': uid,
        'time': t,
        'appKey': globalConfig.APP_KEY,
        'sign': sign
    };
}

/**
 * 通用请求 
 */
async function fetch(url) {
    try {
        const headers = await getWawaHeaders();
        const res = await axios.get(url, { headers: headers, timeout: 20000 });
        return res.data;
    } catch (e) {
        OmniBox.log("error", "请求失败: " + url + " | " + e.message);
        return null;
    }
}

// ========== 核心业务逻辑 ==========

/**
 * 首页
 */
async function home(params) {
    await initConf(); // 必须先初始化

    // 并行请求分类和首页内容
    const [typeData, homeList] = await Promise.all([
        fetch(`${globalConfig.HOST}/api.php/zjv6.vod/types`),
        fetch(`${globalConfig.HOST}/api.php/zjv6.vod/vodPhbAll`)
    ]);

    let classes = [];
    let filters = {};
    const dy = { "class": "类型", "area": "地区", "lang": "语言", "year": "年份", "letter": "字母", "by": "排序" };
    const sl = { '按更新': 'time', '按播放': 'hits', '按评分': 'score', '按收藏': 'store_num' };

    if (typeData && typeData.data && typeData.data.list) {
        typeData.data.list.forEach(item => {
            classes.push({
                type_id: item.type_id.toString(),
                type_name: item.type_name
            });

            const tid = item.type_id.toString();
            filters[tid] = [];

            if (!item.type_extend) item.type_extend = {};
            item.type_extend.by = '按更新,按播放,按评分,按收藏';

            for (const key in dy) {
                if (item.type_extend[key]) {
                    const values = item.type_extend[key].split(',');
                    const valueArray = [];
                    values.forEach(v => {
                        if (v) {
                            valueArray.push({
                                name: v,
                                value: key === "by" ? (sl[v] || v) : v
                            });
                        }
                    });
                    filters[tid].push({
                        key: key,
                        name: dy[key],
                        init: valueArray[0] ? valueArray[0].value : "",
                        value: valueArray
                    });
                }
            }
        });
    }

    OmniBox.log("info", `homeList: ${JSON.stringify(homeList)}`)

    let list = [];
    if (homeList && homeList.data && homeList.data.list && homeList.data.list[0]) {
        list = homeList.data.list[0].vod_list || [];
        list = list.map((it) => ({
            vod_id: String(it.vod_id || ""),
            vod_name: it.vod_name || "",
            vod_pic: it.vod_pic || "",
            vod_remarks: it.vod_remarks || ""
        }));
    }

    const r = {
        class: classes,
        filters: filters,
        list: list
    };

    OmniBox.log("info", `首页响应：${JSON.stringify(r)}`)

    return r;
}

/**
 * 分类
 */
async function category(params) {
    await initConf(); // 修复点：必须先初始化，否则 globalConfig.HOST 为空

    OmniBox.log("info", `分类入参：${JSON.stringify(params)}`)

    const tid = params.categoryId;
    const pg = params.page || 1;
    const filterParams = params.filters || {};

    const queryParams = new URLSearchParams();
    queryParams.append('type', tid);
    queryParams.append('page', pg);
    queryParams.append('limit', '12');

    if (filterParams.class) queryParams.append('class', filterParams.class);
    if (filterParams.area) queryParams.append('area', filterParams.area);
    if (filterParams.year) queryParams.append('year', filterParams.year);
    if (filterParams.by) queryParams.append('by', filterParams.by);

    const url = `${globalConfig.HOST}/api.php/zjv6.vod?${queryParams.toString()}`;

    OmniBox.log("info", `分类查询：${url}`)

    const res = await fetch(url);
    const rawList = (res && res.data && res.data.list) ? res.data.list : [];
    const list = rawList.map((it) => ({
        vod_id: String(it.vod_id || ""),
        vod_name: it.vod_name || "",
        vod_pic: it.vod_pic || "",
        vod_remarks: it.vod_remarks || ""
    }));

    const r = {
        list: list,
        page: pg,
        pagecount: list.length === 12 ? parseInt(pg) + 1 : parseInt(pg)
    };

    OmniBox.log("info", `分类响应：${JSON.stringify(r)}`)

    return r;
}

/**
 * 搜索
 */
async function search(params) {
    await initConf(); // 修复点：必须先初始化

    const key = params.keyword;
    const pg = params.page || 1;

    const url = `${globalConfig.HOST}/api.php/zjv6.vod?page=${pg}&limit=20&wd=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const list = (res && res.data && res.data.list) ? res.data.list : [];

    return {
        list: list,
        page: pg,
        pagecount: list.length === 20 ? parseInt(pg) + 1 : parseInt(pg),
        total: list.length
    };
}

/**
 * 详情
 */
async function detail(params) {
    await initConf(); // 修复点：必须先初始化

    const id = params.videoId;
    const url = `${globalConfig.HOST}/api.php/zjv6.vod/detail?vod_id=${id}&rel_limit=10`;
    const res = await fetch(url);

    if (!res || !res.data) return { list: [] };

    const item = res.data;
    let vod_play_sources = [];

    if (item.vod_play_list) {
        item.vod_play_list.forEach((source, sourceIndex) => {
            let episodes = [];
            source.urls.forEach((u, epIndex) => {
                const fid = `${id}#${sourceIndex}#${epIndex}`;
                const playObj = {
                    name: u.name,
                    url: u.url,
                    from: u.from,
                    parse: source.player_info.parse2,
                    sid: String(id || ''),
                    fid: fid,
                    v: item.vod_name || '',
                    e: u.name || '',
                };

                const encodedId = encodeMeta(playObj);

                episodes.push({
                    name: u.name,
                    playId: encodedId,
                    _fid: fid,
                    _rawName: u.name || '正片',
                });
            });

            vod_play_sources.push({
                name: source.player_info.show || '默认线路',
                episodes: episodes
            });
        });
    }

    // 刮削处理
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = '';
    const scrapeCandidates = [];
    for (const source of vod_play_sources) {
        for (const ep of source.episodes || []) {
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
            const videoIdForScrape = String(id || '');
            const scrapingResult = await OmniBox.processScraping(videoIdForScrape, item.vod_name || '', item.vod_name || '', scrapeCandidates);
            OmniBox.log('info', `[哇哇影视] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            scrapeData = metadata?.scrapeData || null;
            videoMappings = metadata?.videoMappings || [];
            scrapeType = metadata?.scrapeType || '';
            OmniBox.log('info', `[哇哇影视] 刮削元数据读取完成: ${JSON.stringify({ hasScrapeData: !!scrapeData, mappingCount: videoMappings.length, scrapeType })}`);
        } catch (e) {
            OmniBox.log('warn', `[哇哇影视] 刮削处理失败: ${e.message}`);
        }
    }

    for (const source of vod_play_sources) {
        for (const ep of source.episodes || []) {
            const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
            if (!mapping) continue;
            const oldName = ep.name;
            const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
            if (newName && newName !== oldName) {
                ep.name = newName;
                OmniBox.log('info', `[哇哇影视] 应用刮削后源文件名: ${oldName} -> ${newName}`);
            }
            ep._seasonNumber = mapping.seasonNumber;
            ep._episodeNumber = mapping.episodeNumber;
        }
    }

    for (const source of vod_play_sources) {
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
        source.episodes = (source.episodes || []).map((ep) => ({
            name: ep.name,
            playId: ep.playId,
        }));
    }

    return {
        list: [{
            vod_id: item.vod_id.toString(),
            vod_name: scrapeData?.title || item.vod_name,
            vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : item.vod_pic,
            vod_remarks: item.vod_remarks,
            vod_content: scrapeData?.overview || item.vod_content || '',
            vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : (item.vod_year || ''),
            vod_area: item.vod_area || '',
            vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || item.vod_actor || '',
            vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || item.vod_director || '',
            vod_play_sources: vod_play_sources
        }]
    };
}

/**
 * 播放
 */
async function play(params) {
    // 播放通常不需要请求 HOST，但也建议加上以防万一
    // await initConf(); 

    const rawPlayId = params.playId;
    logInfo("[播放入口] 入参", {
        playId: rawPlayId,
        vodId: params.vodId || "",
        from: params.from || "",
    });

    const playId = rawPlayId;

    try {
        const playData = decodeMeta(playId);
        logInfo("[播放解析] 透传解码", {
            url: playData.url,
            from: playData.from,
            parse: playData.parse,
            vodName: playData.v,
            episode: playData.e,
            sid: playData.sid,
            fid: playData.fid,
        });

        let vodName = playData.v || "";
        let episodeName = playData.e || "";
        let scrapedDanmuFileName = "";

        try {
            const sourceVideoId = String(params.vodId || playData.sid || '');
            if (sourceVideoId) {
                const metadata = await OmniBox.getScrapeMetadata(sourceVideoId);
                logInfo("[播放解析] 刮削元数据加载", {
                    sourceId: sourceVideoId,
                    hasScrapeData: !!metadata?.scrapeData,
                    mappingCount: (metadata?.videoMappings || []).length,
                    scrapeType: metadata?.scrapeType || "",
                });
                if (metadata && metadata.scrapeData) {
                    const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playData.fid);
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
        } catch (e) {
            OmniBox.log('warn', `[哇哇影视] 读取刮削元数据失败: ${e.message}`);
        }

        const playUrl = playData.url;
        const isDirectPlayable = playUrl && /\.(m3u8|mp4|flv|avi|mkv|ts)/i.test(playUrl);
        let playResponse;

        if (isDirectPlayable) {
            playResponse = {
                parse: 0,
                url: playUrl,
                header: PLAY_HEADERS
            };
        } else {
            const sniffResult = await sniffWawaPlay(playUrl);
            playResponse = sniffResult || {
                parse: 0,
                url: playUrl,
                header: PLAY_HEADERS
            };
        }

        if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            logInfo("[弹幕] 预匹配文件名", { fileName, vodName, episodeName });
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo("[弹幕] 匹配成功并附加", { count: danmakuList.length });
                } else {
                    logInfo("[弹幕] 未匹配到弹幕", { fileName });
                }
            }
        }

        return playResponse;
    } catch (e) {
        logError("播放解析失败", e);
        const fallbackSniff = await sniffWawaPlay(playId);
        if (fallbackSniff) {
            return fallbackSniff;
        }
        return { parse: 0, url: '' };
    }
}

// ========== 导出模块 ==========
module.exports = {
    home: home,
    category: category,
    search: search,
    detail: detail,
    play: play
};

const runner = require("spider_runner");
runner.run(module.exports);
