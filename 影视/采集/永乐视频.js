// @name 永乐视频
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/永乐视频.js

/**
 * ============================================================================
 * 永乐视频 - OmniBox 爬虫脚本 (增强版)
 * ============================================================================
 */
// @version 1.0.1
const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");
const http = require("http");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const config = {
    host: "https://www.ylys.tv"
};
const DANMU_API = process.env.DANMU_API || "";

// 配置请求实例,禁用SSL验证
const _http = axios.create({
    timeout: 15000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true }),
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://www.ylys.tv/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
});

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[永乐视频-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[永乐视频-DEBUG] ${message}: ${error.message || error}`);
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
        const raw = Buffer.from(str, 'base64').toString('utf8');
        return JSON.parse(raw);
    } catch {
        return {};
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

        return [{
            name: danmakuName,
            url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`,
        }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
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

// ========== 工具函数 ==========

// 增强的图片修复函数
const fixImageUrl = (url) => {
    if (!url || url.trim() === '') {
        return '';
    }
    url = url.trim();
    url = url.replace(/^['"]+|['"]+$/g, '');
    if (url.startsWith('/')) {
        return config.host + url;
    }
    if (url.startsWith('//')) {
        return 'https:' + url;
    }
    if (url.startsWith('http://')) {
        return url.replace('http://', 'https://');
    }
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
        if (url.includes('doubanio.com') ||
            url.includes('tmdb.org') ||
            url.includes('themoviedb.org') ||
            url.includes('image.tmdb')) {
            return 'https://' + url;
        }
    }
    return url;
};

// 从HTML元素中提取图片URL
const extractImageFromElement = ($, element) => {
    const $el = $(element);
    let imgUrl = '';
    const imgAttrs = ['data-original', 'data-src', 'src', 'data-url', 'data-srcset', 'data-lazy-src', 'original'];
    for (const attr of imgAttrs) {
        const attrValue = $el.find('img').attr(attr);
        if (attrValue && attrValue.trim()) {
            imgUrl = attrValue.trim();
            if (attr === 'data-srcset' && imgUrl.includes(',')) {
                imgUrl = imgUrl.split(',')[0].trim().split(' ')[0];
            }
            if (imgUrl) break;
        }
    }
    if (!imgUrl) {
        $el.find('img').each((i, img) => {
            if (!imgUrl) {
                const src = $(img).attr('src');
                const dataSrc = $(img).attr('data-src');
                const dataOriginal = $(img).attr('data-original');
                if (dataOriginal && dataOriginal.trim()) {
                    imgUrl = dataOriginal.trim();
                } else if (dataSrc && dataSrc.trim()) {
                    imgUrl = dataSrc.trim();
                } else if (src && src.trim()) {
                    imgUrl = src.trim();
                }
            }
        });
    }
    if (!imgUrl) {
        const elementsWithBg = $el.find('[style*="background"], [style*="url"]');
        elementsWithBg.each((i, elem) => {
            if (!imgUrl) {
                const style = $(elem).attr('style') || '';
                if (style) {
                    const bgMatch = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (bgMatch && bgMatch[1]) {
                        imgUrl = bgMatch[1];
                    }
                }
            }
        });
    }
    if (!imgUrl) {
        const parentStyle = $el.parent().attr('style') || '';
        if (parentStyle) {
            const bgMatch = parentStyle.match(/url\(['"]?(.*?)['"]?\)/);
            if (bgMatch && bgMatch[1]) {
                imgUrl = bgMatch[1];
            }
        }
    }
    return imgUrl;
};

// 增强的分类列表解析
const parseCategoryList = (html) => {
    const $ = cheerio.load(html);
    const list = [];
    logInfo('开始解析分类列表');
    
    $('.module-item, .module-card-item, .video-item, .vod-item, .col-md-2, .col-lg-2, .col-md-3, .col-lg-3').each((i, el) => {
        try {
            const $el = $(el);
            let link = $el.find('a[href*="/voddetail/"]').first();
            if (!link.length) {
                link = $el.find('a').filter((i, a) => {
                    const href = $(a).attr('href') || '';
                    return href.includes('/voddetail/');
                }).first();
            }
            if (!link.length) return;
            const href = link.attr('href');
            if (!href) return;
            const match = href.match(/\/voddetail\/(\d+)\//);
            if (!match) return;
            const vid = match[1];
            let title = link.attr('title') ||
                $el.find('.module-item-name, .module-card-name, .video-name, .vod-name, .name, .title, h3, h4').text().trim() ||
                link.text().trim() ||
                '';
            title = title.replace(/\s+/g, ' ').trim();
            if (!title || title.length < 2) return;
            let pic = '';
            pic = extractImageFromElement($, link);
            if (!pic) pic = extractImageFromElement($, el);
            if (!pic) {
                const parent = $el.parent();
                if (parent.length) pic = extractImageFromElement($, parent[0]);
            }
            if (!pic) {
                const siblings = $el.siblings('.pic, .poster, .thumb, .img, .image, .lazyload');
                if (siblings.length) pic = extractImageFromElement($, siblings[0]);
            }
            pic = fixImageUrl(pic);
            const remark = $el.find('.module-item-note, .module-card-note, .video-note, .vod-note, .note, .remarks, .update, .year').text().trim() ||
                $el.siblings('.note, .remarks, .update').text().trim() ||
                '';
            if (!pic) {
                pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
            }
            const exists = list.some(item => item.vod_id === vid);
            if (!exists) {
                list.push({
                    vod_id: vid,
                    vod_name: title,
                    vod_pic: pic,
                    vod_remarks: remark
                });
            }
        } catch (err) {
            logError('解析单个项目时出错', err);
        }
    });

    if (list.length === 0) {
        logInfo('方法1未找到,尝试通用选择器');
        $('a[href*="/voddetail/"]').each((i, el) => {
            try {
                const $el = $(el);
                const href = $el.attr('href');
                if (!href) return;
                const match = href.match(/\/voddetail\/(\d+)\//);
                if (!match) return;
                const vid = match[1];
                if ($el.parents('nav, .nav, header, .header, footer, .footer, .breadcrumb, .pagination').length > 0) return;
                let title = $el.attr('title') ||
                    $el.find('.name, .title, h3, h4, strong, b').text().trim() ||
                    $el.text().trim();
                title = title.replace(/\s+/g, ' ').trim();
                if (!title || title.length < 2 || title.length > 100) return;
                if (title === '详情' || title === '观看' || title === '播放' ||
                    title === '点击观看' || title.includes('http') || title.includes('www.')) return;
                let pic = extractImageFromElement($, el);
                pic = fixImageUrl(pic);
                const remark = $el.find('.note, .remarks, .update, .time, .year, .score, .rating').text().trim() ||
                    $el.siblings('.note, .remarks, .update, .time, .year').text().trim() ||
                    '';
                const exists = list.some(item => item.vod_id === vid);
                if (!exists) {
                    if (!pic) pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
                    list.push({
                        vod_id: vid,
                        vod_name: title,
                        vod_pic: pic,
                        vod_remarks: remark
                    });
                }
            } catch (err) {
                logError('通用选择器解析出错', err);
            }
        });
    }

    if (list.length === 0) {
        logInfo('尝试从列表容器查找');
        $('.module, .video-list, .vod-list, .list-container, .row').each((i, container) => {
            $(container).find('a').each((j, el) => {
                try {
                    const $el = $(el);
                    const href = $el.attr('href');
                    if (!href || !href.includes('/voddetail/')) return;
                    const match = href.match(/\/voddetail\/(\d+)\//);
                    if (!match) return;
                    const vid = match[1];
                    let title = $el.attr('title') ||
                        $el.find('h3, h4, .title, .name').text().trim() ||
                        $el.text().trim();
                    title = title.replace(/\s+/g, ' ').trim();
                    if (!title || title.length < 2) return;
                    let pic = extractImageFromElement($, el);
                    if (!pic) {
                        const parent = $el.parent();
                        if (parent.length) pic = extractImageFromElement($, parent[0]);
                    }
                    pic = fixImageUrl(pic);
                    const exists = list.some(item => item.vod_id === vid);
                    if (!exists) {
                        if (!pic) pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
                        list.push({
                            vod_id: vid,
                            vod_name: title,
                            vod_pic: pic,
                            vod_remarks: ''
                        });
                    }
                } catch (err) {
                    logError('列表容器解析出错', err);
                }
            });
        });
    }
    
    logInfo(`解析完成,共找到 ${list.length} 个视频`);
    const uniqueList = [];
    const seenIds = new Set();
    for (const item of list) {
        if (item.vod_id && !seenIds.has(item.vod_id)) {
            seenIds.add(item.vod_id);
            uniqueList.push(item);
        }
    }
    return uniqueList;
};

// 首页专用的解析函数
const parseHomePage = (html) => {
    const $ = cheerio.load(html);
    const list = [];
    logInfo('开始解析首页');
    
    $('.swiper-slide, .carousel-item, .slider-item, .banner-item, .index-module, .recommend-module, .recommend-item, .hot-item').each((i, el) => {
        try {
            const $el = $(el);
            const link = $el.find('a[href*="/voddetail/"]').first();
            if (!link.length) return;
            const href = link.attr('href');
            if (!href) return;
            const match = href.match(/\/voddetail\/(\d+)\//);
            if (!match) return;
            const vid = match[1];
            let title = link.attr('title') ||
                $el.find('.title, .name, h2, h3, h4, .video-title, .vod-title').text().trim() ||
                link.text().trim();
            title = title.replace(/\s+/g, ' ').trim();
            if (!title || title.length < 2) return;
            let pic = '';
            const style = $el.attr('style') || '';
            const bgMatch = style.match(/url\(['"]?(.*?)['"]?\)/);
            if (bgMatch && bgMatch[1]) pic = bgMatch[1];
            if (!pic) pic = extractImageFromElement($, $el);
            if (!pic) pic = extractImageFromElement($, link[0]);
            pic = fixImageUrl(pic);
            const remark = $el.find('.year, .update, .note, .remarks, .score, .rating').text().trim();
            if (!pic) pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
            const exists = list.some(item => item.vod_id === vid);
            if (!exists) {
                list.push({
                    vod_id: vid,
                    vod_name: title,
                    vod_pic: pic,
                    vod_remarks: remark
                });
            }
        } catch (err) {
            logError('首页解析出错', err);
        }
    });

    $('.module-items, .video-list, .vod-list, .list, .grid, .flex, .recommend-list').each((i, container) => {
        $(container).find('a[href*="/voddetail/"]').each((j, el) => {
            try {
                const $el = $(el);
                const href = $el.attr('href');
                if (!href) return;
                const match = href.match(/\/voddetail\/(\d+)\//);
                if (!match) return;
                const vid = match[1];
                if (list.some(item => item.vod_id === vid)) return;
                let title = $el.attr('title') ||
                    $el.find('.title, .name, h3, h4').text().trim() ||
                    $el.text().trim();
                title = title.replace(/\s+/g, ' ').trim();
                if (!title || title.length < 2 || title.length > 100) return;
                if (title === '详情' || title === '观看' || title === '播放' ||
                    title === '点击观看' || title.includes('http') || title.includes('www.')) return;
                let pic = extractImageFromElement($, el);
                pic = fixImageUrl(pic);
                const remark = $el.siblings('.note, .remarks, .update, .year').text().trim() ||
                    $el.parent().find('.note, .remarks, .update, .year').text().trim() ||
                    '';
                if (!pic) pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
                list.push({
                    vod_id: vid,
                    vod_name: title,
                    vod_pic: pic,
                    vod_remarks: remark
                });
            } catch (err) {
                logError('首页推荐列表解析出错', err);
            }
        });
    });

    if (list.length < 5) {
        logInfo(`首页特有解析只找到 ${list.length} 个项目,尝试通用解析`);
        const genericList = parseCategoryList(html);
        genericList.forEach(item => {
            if (!list.some(existing => existing.vod_id === item.vod_id)) {
                list.push(item);
            }
        });
    }
    
    logInfo(`首页解析完成,找到 ${list.length} 个视频`);
    const uniqueList = [];
    const seenIds = new Set();
    for (const item of list) {
        if (item.vod_id && !seenIds.has(item.vod_id)) {
            seenIds.add(item.vod_id);
            uniqueList.push(item);
        }
    }
    return uniqueList;
};

/**
 * 核心:解析播放源为OmniBox格式
 */
const parsePlaySources = (playFrom, playUrl, videoId = '', vodName = '') => {
    logInfo("开始解析播放源字符串", { from: playFrom, url: playUrl });
    const playSources = [];
    if (!playFrom || !playUrl) return playSources;

    const froms = playFrom.split('$$$');
    const urls = playUrl.split('$$$');

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
                playId: `${actualPlayId}|||${encodeMeta({ sid: videoId, fid, v: vodName || '', e: episodeName })}`,
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

const sniffYlysPlay = async (playUrl) => {
    try {
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': playUrl
                }
            };
        }
    } catch (error) {
        logError("嗅探失败", error);
    }
    return null;
};

// ========== 接口实现 ==========

async function home(params) {
    logInfo("进入首页");
    try {
        const res = await _http.get(config.host);
        const list = parseHomePage(res.data);
        
        if (list.length === 0) {
            logInfo('首页专用解析未获取到数据,使用备用解析');
            const backupList = parseCategoryList(res.data);
            backupList.forEach(item => {
                if (!list.some(existing => existing.vod_id === item.vod_id)) {
                    list.push(item);
                }
            });
        }
        
        const listWithFixedImages = list.map(item => {
            if (!item.vod_pic || item.vod_pic === '' || item.vod_pic.includes('undefined')) {
                item.vod_pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(item.vod_name.substring(0, 10));
            }
            return item;
        });
        
        logInfo(`首页获取到 ${listWithFixedImages.length} 个视频`);
        const maxItems = Math.min(listWithFixedImages.length, 20);
        const resultList = listWithFixedImages.slice(0, maxItems);
        
        return {
            class: [
                { 'type_id': '1', 'type_name': '电影' },
                { 'type_id': '2', 'type_name': '剧集' },
                { 'type_id': '3', 'type_name': '综艺' },
                { 'type_id': '4', 'type_name': '动漫' }
            ],
            list: resultList
        };
    } catch (e) {
        logError("首页获取失败", e);
        return {
            class: [
                { 'type_id': '1', 'type_name': '电影' },
                { 'type_id': '2', 'type_name': '剧集' },
                { 'type_id': '3', 'type_name': '综艺' },
                { 'type_id': '4', 'type_name': '动漫' }
            ],
            list: []
        };
    }
}

async function category(params) {
    const { categoryId, page, ext } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);
    
    try {
        let baseUrl = `${config.host}/vodtype/${categoryId}/`;
        let queryParams = [];
        
        if (ext && ext.class && ext.class !== '') {
            queryParams.push(`vod_class=${ext.class}`);
        }
        
        let url = baseUrl;
        if (pg > 1) queryParams.push(`page=${pg}`);
        if (queryParams.length > 0) url = `${baseUrl}?${queryParams.join('&')}`;
        
        logInfo(`分类请求URL: ${url}`);
        const res = await _http.get(url);
        const list = parseCategoryList(res.data);
        
        logInfo(`分类 ${categoryId} 获取到 ${list.length} 个视频`);
        
        const fixedList = list.map(item => {
            if (!item.vod_pic || item.vod_pic === '' || item.vod_pic.includes('undefined')) {
                item.vod_pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(item.vod_name.substring(0, 10));
            }
            return item;
        });
        
        return {
            list: fixedList,
            page: pg,
            pagecount: 999
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);
    
    try {
        const url = `${config.host}/voddetail/${videoId}/`;
        logInfo(`详情页请求: ${url}`);
        const res = await _http.get(url);
        const html = res.data;
        const $ = cheerio.load(html);

        // 移除干扰元素
        $('style, script, iframe, link[rel="stylesheet"]').remove();
        $('[style*="display: none"], [style*="display:none"]').remove();

        // 提取基础信息
        const title = $('meta[property="og:title"]').attr('content')?.split('-')[0]?.trim() ||
            $('title').text().split('-')[0]?.trim() ||
            $('.module-info-heading h1').text().trim() ||
            $('.video-title').text().trim() ||
            "未知";

        // 提取图片
        let pic = $('meta[property="og:image"]').attr('content') || '';
        if (!pic) {
            const imgSelectors = [
                '.module-item-pic img', '.video-cover img', '.vod-pic img',
                '.poster img', '.cover img', '.thumb img',
                '.module-info-pic img', '.video-info-pic img',
                'img[src*="poster"]', 'img[src*="cover"]', 'img[src*="vod"]'
            ];
            for (const selector of imgSelectors) {
                const img = $(selector).first();
                if (img.length) {
                    pic = img.attr('data-original') || img.attr('data-src') || img.attr('src') || '';
                    if (pic) break;
                }
            }
        }
        if (!pic) {
            const bgSelectors = [
                '.module-item-pic', '.video-cover', '.vod-pic',
                '.poster', '.cover', '.module-info-pic', '.video-info-pic',
                '[style*="background-image"]'
            ];
            for (const selector of bgSelectors) {
                const element = $(selector).first();
                if (element.length) {
                    const style = element.attr('style') || '';
                    const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) {
                        pic = match[1];
                        break;
                    }
                }
            }
        }
        pic = fixImageUrl(pic);
        if (!pic || pic.includes('undefined')) {
            pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(title.substring(0, 10));
        }

        // 提取简介
        const desc = $('meta[property="og:description"]').attr('content') ||
            $('.module-info-introduction-content').text().trim() ||
            $('.vod_content, .content, .description, .intro, .summary, .synopsis').text().trim() ||
            $('.module-info-introduction').text().replace('简介', '').trim() ||
            "暂无简介";

        // 增强的元数据提取
        let year = "";
        let area = "";
        let type = "";
        let director = "";
        let actor = "";

        const infoSelectors = [
            '.module-info-content', '.video-info-content', '.vod-info-content',
            '.info', '.details', '.vod-details', '.video-details',
            '.module-info-items', '.video-info-items', '.vod-info-items',
            '.module-detail-info', '.detail-info'
        ];

        let infoHtml = "";
        for (const selector of infoSelectors) {
            const container = $(selector);
            if (container.length) {
                infoHtml = container.html() || "";
                if (infoHtml.includes("导演") || infoHtml.includes("主演") || infoHtml.includes("年份")) {
                    break;
                }
            }
        }

        if (!infoHtml) {
            infoHtml = $('.module-info-introduction, .vod-intro, .video-intro').html() || "";
        }

        if (!infoHtml) {
            infoHtml = $('.module-info, .vod-info, .video-info').html() || "";
        }

        // 清理HTML标签
        const cleanText = infoHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        // 从信息容器中提取
        if (cleanText) {
            const yearMatch = cleanText.match(/(\d{4})\s*(年|年份)/) ||
                cleanText.match(/上映.*?(\d{4})/) ||
                cleanText.match(/时间.*?[::]\s*(\d{4})/) ||
                /(19\d{2}|20\d{2})/.exec(cleanText);
            if (yearMatch) year = yearMatch[1];

            const areaMatch = cleanText.match(/地区[::]\s*([^,\s<]+)/) ||
                cleanText.match(/产地[::]\s*([^,\s<]+)/) ||
                cleanText.match(/国家\/地区[::]\s*([^,\s<]+)/) ||
                cleanText.match(/(中国大陆|中国香港|中国台湾|香港|台湾|美国|日本|韩国|英国|法国|德国|泰国|印度)/);
            if (areaMatch) area = areaMatch[1].replace(/^\s*[::]\s*/, '');

            const typeMatch = cleanText.match(/类型[::]\s*([^,\s<]+)/) ||
                cleanText.match(/分类[::]\s*([^,\s<]+)/) ||
                cleanText.match(/类别[::]\s*([^,\s<]+)/) ||
                cleanText.match(/(电影|电视剧|综艺|动漫|动画|纪录片)/);
            if (typeMatch) type = typeMatch[1].replace(/^\s*[::]\s*/, '');

            const directorMatch = cleanText.match(/导演[::]\s*([^,\n<]+)/) ||
                cleanText.match(/导演[::][^,<]+/);
            if (directorMatch) {
                director = directorMatch[1]?.trim() || directorMatch[0]?.replace(/导演[::]\s*/, '').trim();
            }

            const actorMatch = cleanText.match(/主演[::]\s*([^,\n<]+)/) ||
                cleanText.match(/演员[::]\s*([^,\n<]+)/) ||
                cleanText.match(/主演[::][^,<]+/) ||
                cleanText.match(/演员[::][^,<]+/);
            if (actorMatch) {
                actor = actorMatch[1]?.trim() || actorMatch[0]?.replace(/(主演|演员)[::]\s*/, '').trim();
            }
        }

        // 从DOM结构中直接查找
        if (!director || !actor) {
            $('.module-info-item, .vod-info-item, .video-info-item, .info-item').each((i, el) => {
                const $el = $(el);
                const label = $el.find('.module-info-item-label, .vod-info-label, .video-info-label, .info-label, strong, b').text().trim();
                const value = $el.text().replace(label, '').trim();

                if (!director && (label.includes('导演') || label.includes('Director'))) {
                    director = value.replace(/[::]/, '').trim();
                }
                if (!actor && (label.includes('主演') || label.includes('演员') || label.includes('Actor') || label.includes('Cast'))) {
                    actor = value.replace(/[::]/, '').trim();
                }
                if (!year && (label.includes('年份') || label.includes('年代') || label.includes('时间') || label.includes('Year') || label.includes('Release'))) {
                    const yearMatch = value.match(/(\d{4})/);
                    if (yearMatch) year = yearMatch[1];
                }
                if (!area && (label.includes('地区') || label.includes('国家') || label.includes('地区') || label.includes('Country') || label.includes('Region'))) {
                    area = value.replace(/[::]/, '').trim();
                }
                if (!type && (label.includes('类型') || label.includes('分类') || label.includes('Genre'))) {
                    type = value.replace(/[::]/, '').trim();
                }
            });
        }

        // 设置默认值
        if (!year || year.length !== 4 || !/^\d{4}$/.test(year)) {
            year = "2023";
        }
        if (!area || area.trim() === '') {
            area = "中国大陆";
        }
        if (!type || type.trim() === '') {
            if (url.includes('/movie/')) type = "电影";
            else if (url.includes('/tv/') || url.includes('/drama/')) type = "电视剧";
            else if (url.includes('/anime/') || url.includes('/cartoon/')) type = "动漫";
            else if (url.includes('/variety/')) type = "综艺";
            else type = "电影";
        }
        if (!director || director.trim() === '') {
            director = "未知";
        }
        if (!actor || actor.trim() === '') {
            actor = "未知";
        }

        // 清理导演和主演信息
        director = director.replace(/^[::]\s*/, '').trim();
        actor = actor.replace(/^[::]\s*/, '').trim();

        // 屏蔽"收藏"字符及其相关组合
        const unwantedStrings = [
            '收藏', '收藏 ', ' 收藏', '收藏+', '收藏-', '收藏/', '收藏&', '收藏|',
            '收藏立即播放', '收藏 立即播放', '立即播放收藏', '立即播放 收藏',
            '收藏立即观看', '收藏 立即观看', '立即观看收藏', '立即观看 收藏',
            '收藏播放', '收藏 播放', '播放收藏', '播放 收藏',
            '收藏观看', '收藏 观看', '立即播放', '观看 收藏'
        ];

        for (const unwanted of unwantedStrings) {
            if (director.includes(unwanted)) {
                director = director.replace(new RegExp(unwanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
            }
            if (actor.includes(unwanted)) {
                actor = actor.replace(new RegExp(unwanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
            }
        }

        if (director.length > 50) {
            director = director.split(/[,,;;]/)[0]?.trim() || "未知";
        }
        if (actor.length > 100) {
            actor = actor.split(/[,,;;]/).slice(0, 3).join(',').trim();
        }

        director = director.replace(/\s{2,}/g, ' ').trim().replace(/[,,;;]+$/, '');
        actor = actor.replace(/\s{2,}/g, ' ').trim().replace(/[,,;;]+$/, '');

        if (!director || director.trim() === '') {
            director = "未知";
        }
        if (!actor || actor.trim() === '') {
            actor = "未知";
        }

        logInfo(`详情信息提取结果: 年份=${year}, 地区=${area}, 类型=${type}, 导演=${director}, 主演=${actor}`);

        // 提取播放列表
        let playFrom = [];
        let playUrl = [];
        const tabs = $('.module-tab-item, .tab-item, .play-tab-item, .tab-link, .line-item, .play-source-item');
        const contents = $('.module-play-list, .play-list, .playlist, .tab-content, .play-source-content');

        if (tabs.length > 0) {
            tabs.each((i, tab) => {
                try {
                    let fromName = $(tab).text().trim();
                    fromName = fromName.replace(/\s+/g, "").replace(/线路/g, "").replace(/播放/g, "").replace(/源/g, "").trim();
                    if (!fromName || fromName.length === 0 || fromName === "全部") fromName = `线路${i + 1}`;

                    let contentDiv = null;
                    const target = $(tab).attr('data-target') || $(tab).attr('href');
                    if (target && target.startsWith('#')) contentDiv = $(target);
                    if (!contentDiv || !contentDiv.length) contentDiv = contents.eq(i);
                    if (!contentDiv || !contentDiv.length) {
                        const tabId = $(tab).attr('id');
                        if (tabId) contentDiv = $(`[aria-labelledby="${tabId}"]`);
                    }

                    if (!contentDiv || !contentDiv.length) return;

                    let urls = [];
                    contentDiv.find('a').each((j, link) => {
                        let epName = $(link).find('span').text().trim() || $(link).text().trim() || `第${j + 1}集`;
                        epName = epName.replace(/\s+/g, ' ').trim();
                        const href = $(link).attr('href');
                        if (href) {
                            const match = href.match(/\/play\/(\d+-\d+-\d+)\//);
                            if (match) urls.push(`${epName}$${match[1]}`);
                        }
                    });

                    if (urls.length > 0) {
                        urls.sort((a, b) => {
                            const aNum = parseInt(a.match(/第?(\d+)/)?.[1] || "0");
                            const bNum = parseInt(b.match(/第?(\d+)/)?.[1] || "0");
                            return aNum - bNum;
                        });
                        playFrom.push(fromName);
                        playUrl.push(urls.join('#'));
                    }
                } catch (err) {
                    logError(`解析线路 ${i} 出错`, err);
                }
            });
        }

        // 备用播放列表解析
        if (playFrom.length === 0) {
            const playContainers = $('.module-play-list-content, .play-list-content, .play-items, .episode-list');
            playContainers.each((i, container) => {
                const fromName = `线路${i + 1}`;
                let urls = [];
                $(container).find('a').each((j, link) => {
                    let epName = $(link).text().trim() || `第${j + 1}集`;
                    const href = $(link).attr('href');
                    if (href) {
                        const match = href.match(/\/play\/(\d+-\d+-\d+)\//);
                        if (match) urls.push(`${epName}$${match[1]}`);
                    }
                });
                if (urls.length > 0) {
                    playFrom.push(fromName);
                    playUrl.push(urls.join('#'));
                }
            });
        }

        // 最终通用播放列表解析
        if (playFrom.length === 0) {
            $('a[href*="/play/"]').each((i, link) => {
                const href = $(link).attr('href');
                if (href) {
                    const match = href.match(/\/play\/(\d+-\d+-\d+)\//);
                    if (match) {
                        const epName = $(link).text().trim() || `第${i + 1}集`;
                        if (!playFrom.includes('默认线路')) {
                            playFrom.push('默认线路');
                            playUrl.push('');
                        }
                        const currentIndex = playFrom.indexOf('默认线路');
                        if (playUrl[currentIndex]) playUrl[currentIndex] += '#';
                        playUrl[currentIndex] += `${epName}$${match[1]}`;
                    }
                }
            });
        }

        // 转换为OmniBox格式
        const videoIdForScrape = String(videoId || '');
        const playSources = parsePlaySources(playFrom.join('$$$'), playUrl.join('$$$'), videoIdForScrape, title);

        // 刮削处理
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = '';
        const scrapeCandidates = [];

        for (const source of playSources) {
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
                const scrapingResult = await OmniBox.processScraping(videoIdForScrape, title || '', title || '', scrapeCandidates);
                OmniBox.log('info', `[永乐视频-DEBUG] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);

                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || '';
                logInfo('刮削元数据读取完成', { mappingCount: videoMappings.length, hasScrapeData: !!scrapeData, scrapeType });
            } catch (error) {
                logError('刮削处理失败', error);
            }
        }

        if (videoMappings.length > 0) {
            for (const source of playSources) {
                for (const ep of source.episodes || []) {
                    const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                    if (!mapping) continue;
                    const oldName = ep.name;
                    const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                    if (newName && newName !== oldName) {
                        ep.name = newName;
                        OmniBox.log('info', `[永乐视频-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
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
                vod_name: scrapeData?.title || title,
                vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : pic,
                vod_content: scrapeData?.overview || desc,
                vod_play_sources: normalizedPlaySources,
                vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : year,
                vod_area: area,
                vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || actor,
                vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || director,
                type_name: type
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);
    
    try {
        const searchKey = encodeURIComponent(wd);
        const url = pg > 1
            ? `${config.host}/vodsearch/${searchKey}-------------/page/${pg}/`
            : `${config.host}/vodsearch/${searchKey}-------------/`;
        
        logInfo(`搜索请求: ${wd}, 页码: ${pg}, URL: ${url}`);
        const res = await _http.get(url);
        const list = parseCategoryList(res.data);
        
        const fixedList = list.map(item => {
            item.vod_pic = fixImageUrl(item.vod_pic);
            if (!item.vod_pic || item.vod_pic === '' || item.vod_pic.includes('undefined')) {
                item.vod_pic = 'https://placehold.co/300x450/2c3e50/ecf0f1?text=' + encodeURIComponent(item.vod_name.substring(0, 10));
            }
            return item;
        });
        
        logInfo(`搜索 "${wd}" 获取到 ${fixedList.length} 个结果`);
        
        return {
            list: fixedList,
            page: pg,
            pagecount: fixedList.length > 0 ? pg + 1 : pg
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

async function play(params) {
    let playId = params.playId || '';
    logInfo(`准备播放 ID: ${playId}`);
    let url = '';
    let playMeta = {};
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = '';

    if (playId.includes('|||')) {
        const [mainPlayId, metaB64] = playId.split('|||');
        playId = mainPlayId || '';
        playMeta = decodeMeta(metaB64 || '');
    }

    try {
        if (!playId.includes('-')) {
            return {
                urls: [{ name: "默认", url: playId }],
                parse: 0,
                header: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': config.host + '/'
                }
            };
        }

        try {
            const videoIdFromParam = params.vodId ? String(params.vodId) : '';
            const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : '';
            const videoIdForScrape = videoIdFromParam || videoIdFromMeta;
            if (videoIdForScrape) {
                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || '';
            }
        } catch (error) {
            logInfo(`读取刮削元数据失败: ${error.message}`);
        }

        const playPageUrl = `${config.host}/play/${playId}/`;
        logInfo(`播放地址请求: ${playPageUrl}`);
        const res = await _http.get(playPageUrl);

        let match = res.data.match(/var player_aaaa=.*?"url":"([^"]+\.m3u8)"/);
        if (!match) match = res.data.match(/var player_data=.*?"url":"([^"]+\.m3u8)"/);

        if (!match) {
            match = res.data.match(/player_data\s*=\s*({[^}]+})/);
            if (match) {
                try {
                    const playerData = JSON.parse(match[1].replace(/\\/g, ''));
                    if (playerData.url && playerData.url.includes('.m3u8')) {
                        match = { 1: playerData.url };
                    }
                } catch (e) {}
            }
        }

        if (!match) {
            const scriptMatch = res.data.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
            if (scriptMatch) {
                for (const script of scriptMatch) {
                    const m3u8Match = script.match(/"url"\s*:\s*"([^"]+\.m3u8)"/);
                    if (m3u8Match) {
                        match = m3u8Match;
                        break;
                    }
                }
            }
        }

        if (!match) {
            const iframeMatch = res.data.match(/<iframe[^>]+src="([^"]+)"/);
            if (iframeMatch) {
                const iframeUrl = iframeMatch[1];
                if (iframeUrl.includes('.m3u8')) {
                    match = { 1: iframeUrl };
                } else if (!iframeUrl.startsWith('http')) {
                    match = { 1: config.host + iframeUrl };
                }
            }
        }

        if (match) {
            let m3u8 = match[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
            if (m3u8.startsWith('//')) {
                m3u8 = 'https:' + m3u8;
            } else if (m3u8.startsWith('/')) {
                m3u8 = config.host + m3u8;
            }
            logInfo(`找到m3u8地址: ${m3u8}`);
            url = m3u8;
        }
    } catch (e) {
        logError("解析播放地址失败", e);
    }

    const finalUrl = (url && url.startsWith('http')) ? url : playId;
    logInfo(`最终播放地址: ${finalUrl}`);

    let playResponse = {
        urls: [{ name: "极速云", url: finalUrl }],
        parse: 0,
        header: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': config.host + '/'
        }
    };

    const isDirectPlayable = finalUrl.match(/\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i);
    if (!isDirectPlayable) {
        const sniffResult = await sniffYlysPlay(`${config.host}/play/${playId}/`);
        if (sniffResult) {
            playResponse = sniffResult;
        }
    }

    if (DANMU_API) {
        try {
            const mapping = playMeta?.fid ? videoMappings.find((m) => m?.fileId === playMeta.fid) : null;
            const fallbackVodName = playMeta?.v || params.vodName || '';
            const fallbackEpisodeName = playMeta?.e || '';
            const scrapedDanmuFileName = buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName);
            const danmuFileName = scrapedDanmuFileName || buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
            logInfo(`尝试匹配弹幕文件名: ${danmuFileName}`);
            const danmakuList = await matchDanmu(danmuFileName);
            if (danmakuList.length > 0) {
                playResponse.danmaku = danmakuList;
                logInfo("弹幕已添加到播放响应");
            }
        } catch (error) {
            logInfo(`弹幕匹配异常: ${error.message}`);
        }
    } else {
        logInfo("DANMU_API 未配置，跳过弹幕匹配");
    }

    return playResponse;
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
