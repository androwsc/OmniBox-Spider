/**
 * ============================================================================
 * 嗷呜动漫 - OmniBox 爬虫脚本
 * ============================================================================
 */
const axios = require("axios");
const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const aowuConfig = {
    host: "https://www.aowu.tv",
    headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
        "Content-Type": "application/json",
        "Referer": "https://www.aowu.tv/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br"
    }
};

const PAGE_LIMIT = 20;

const _http = axios.create({
    timeout: 15 * 1000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true }),
});

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[嗷呜动漫-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[嗷呜动漫-DEBUG] ${message}: ${error.message || error}`);
};

/**
 * 图像地址修复
 */
const fixPicUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return url.startsWith('/') ? `${aowuConfig.host}${url}` : `${aowuConfig.host}/${url}`;
};

/**
 * 解析嗷呜动漫播放页,提取真实视频地址
 */
const parseAowuPlayPage = async (playUrl) => {
    try {
        logInfo('解析嗷呜动漫播放页', playUrl);

        const response = await _http.get(playUrl, {
            headers: {
                ...aowuConfig.headers,
                "Referer": aowuConfig.host + "/"
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // 方法1:查找m3u8地址(最常见)
        const m3u8Patterns = [
            /['"]((?:https?:)?\/\/[^'"]+\.m3u8[^'"]*)['"]/gi,
            /var\s+url\s*=\s*['"]([^'"]+)['"]/i,
            /player\.url\s*=\s*['"]([^'"]+)['"]/i,
            /source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
            /videoUrl\s*:\s*['"]([^'"]+)['"]/i,
            /url\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
        ];

        for (const pattern of m3u8Patterns) {
            const matches = html.match(pattern);
            if (matches) {
                for (const match of matches) {
                    const urlMatch = match.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
                    if (urlMatch && urlMatch[1]) {
                        let m3u8Url = urlMatch[1];
                        if (m3u8Url.startsWith('//')) {
                            m3u8Url = 'https:' + m3u8Url;
                        } else if (m3u8Url.startsWith('/')) {
                            m3u8Url = aowuConfig.host + m3u8Url;
                        }
                        logInfo('找到m3u8地址', m3u8Url);
                        return m3u8Url;
                    }
                }
            }
        }

        // 方法2:查找iframe中的播放地址
        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            logInfo('找到iframe', iframeSrc);
            let iframeUrl = iframeSrc;
            if (iframeUrl.startsWith('//')) {
                iframeUrl = 'https:' + iframeUrl;
            } else if (iframeUrl.startsWith('/')) {
                iframeUrl = aowuConfig.host + iframeUrl;
            }

            if (iframeUrl.includes('.m3u8') || iframeUrl.includes('.mp4')) {
                return iframeUrl;
            }

            return await parseAowuPlayPage(iframeUrl);
        }

        // 方法3:查找视频标签
        const videoSrc = $('video source').attr('src');
        if (videoSrc) {
            logInfo('找到video source', videoSrc);
            return videoSrc.startsWith('http') ? videoSrc : aowuConfig.host + videoSrc;
        }

        // 方法4:查找JavaScript变量中的视频地址
        const scriptContents = $('script:not([src])').html();
        if (scriptContents) {
            const jsPatterns = [
                /(?:url|src|source)\s*[=:]\s*['"]([^'"]+\.(?:m3u8|mp4|flv)[^'"]*)['"]/gi,
                /http[^'"]*\.(?:m3u8|mp4|flv)[^'"]*/gi
            ];

            for (const pattern of jsPatterns) {
                const matches = scriptContents.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        if (match.includes('://')) {
                            let videoUrl = match.replace(/['"]/g, '');
                            if (videoUrl.startsWith('//')) {
                                videoUrl = 'https:' + videoUrl;
                            }
                            logInfo('从JS中找到视频地址', videoUrl);
                            return videoUrl;
                        }
                    }
                }
            }
        }

        // 方法5:尝试API接口获取播放地址
        try {
            const videoIdMatch = playUrl.match(/\/(\d+)\.html/);
            if (videoIdMatch) {
                const apiUrl = `${aowuConfig.host}/index.php/ds_api/play`;
                const apiResponse = await _http.post(apiUrl, {
                    id: videoIdMatch[1],
                    from: 'web'
                }, {
                    headers: {
                        ...aowuConfig.headers,
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                });

                if (apiResponse.data && apiResponse.data.url) {
                    logInfo('API获取到播放地址', apiResponse.data.url);
                    return apiResponse.data.url;
                }
            }
        } catch (apiError) {
            logInfo('API获取失败,继续其他方法');
        }

        logInfo('未找到可播放的视频地址');
        return null;
    } catch (error) {
        logError('解析播放页错误', error);
        return null;
    }
};

/**
 * 核心:解析 CMS 字符串为结构化播放源
 * 逻辑:将 "来源1$$$来源2" 和 "第1集$ID1#第2集$ID2" 转换为 UI 识别的数组
 */
const parsePlaySources = (fromStr, urlStr) => {
    logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
    const playSources = [];
    if (!fromStr || !urlStr) return playSources;

    const froms = fromStr.split('$$$');
    const urls = urlStr.split('$$$');

    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];

        const episodes = sourceItems.map(item => {
            const parts = item.split('$');
            return {
                name: parts[0] || '正片',
                playId: parts[1] || parts[0]
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

// ========== 接口实现 ==========

/**
 * 首页
 */
async function home(params) {
    logInfo("进入首页");
    try {
        const url = aowuConfig.host + "/";
        const response = await _http.get(url, { headers: aowuConfig.headers });
        const html = response.data;

        const list = [];
        const $ = cheerio.load(html);

        $('.public-list-box').each((i, it) => {
            const $it = $(it);
            const title = $it.find('a').attr('title') || $it.find('a').text().trim();
            const pic = $it.find('.lazy').data('src') || $it.find('.lazy').attr('src') || $it.find('img').attr('src');
            const desc = $it.find('.ft2').text().trim();
            const href = $it.find('a').attr('href');

            let vodId = href;
            if (vodId && vodId.startsWith('/')) {
                vodId = vodId.substring(1);
            }

            if (title) {
                list.push({
                    vod_id: vodId || '',
                    vod_name: title,
                    vod_pic: fixPicUrl(pic),
                    vod_remarks: desc || ''
                });
            }
        });

        logInfo(`获取到 ${list.length} 个首页推荐`);

        return {
            class: [
                { 'type_id': '20', 'type_name': '当季新番' },
                { 'type_id': '21', 'type_name': '番剧' },
                { 'type_id': '22', 'type_name': '剧场' }
            ],
            list: list
        };
    } catch (error) {
        logError('首页推荐错误', error);
        return {
            class: [
                { 'type_id': '20', 'type_name': '当季新番' },
                { 'type_id': '21', 'type_name': '番剧' },
                { 'type_id': '22', 'type_name': '剧场' }
            ],
            list: []
        };
    }
}

/**
 * 分类列表
 */
async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);

    try {
        const data = {
            "type": categoryId || '',
            "by": "time",
            "page": pg
        };

        const url = aowuConfig.host + "/index.php/ds_api/vod";
        const response = await _http.post(url, data, {
            headers: {
                ...aowuConfig.headers,
                "Content-Type": "application/json"
            }
        });

        const result = response.data;

        const list = [];
        if (result && result.list && Array.isArray(result.list)) {
            result.list.forEach(vod => {
                let vodId = vod.url;
                if (vodId && vodId.startsWith('/')) {
                    vodId = vodId.substring(1);
                }

                list.push({
                    vod_id: vodId || '',
                    vod_name: vod.vod_name || '',
                    vod_pic: fixPicUrl(vod.vod_pic),
                    vod_remarks: vod.vod_remarks || ''
                });
            });
        }

        logInfo(`分类 ${categoryId} 第 ${pg} 页获取到 ${list.length} 个项目`);
        return {
            list: list,
            page: pg,
            pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (error) {
        logError('分类列表错误', error);
        return { list: [], page: pg, pagecount: 1 };
    }
}

/**
 * 搜索
 */
async function search(params) {
    const keyword = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${keyword}, 页码: ${pg}`);

    try {
        const searchPath = `/search/${encodeURIComponent(keyword)}----------${pg}---/`;
        const url = aowuConfig.host + searchPath;
        const response = await _http.get(url, { headers: aowuConfig.headers });
        const html = response.data;

        const list = [];
        const $ = cheerio.load(html);

        $('.row .vod-detail').each((i, it) => {
            const $it = $(it);
            const title = $it.find('h3').text().trim();
            const pic = $it.find('img').data('src') || $it.find('img').attr('src');
            const desc = $it.find('.pic_text').text().trim();
            const href = $it.find('a').attr('href');

            if (title && title.toLowerCase().includes(keyword.toLowerCase())) {
                let vodId = href;
                if (vodId && vodId.startsWith('/')) {
                    vodId = vodId.substring(1);
                }

                list.push({
                    vod_id: vodId || '',
                    vod_name: title,
                    vod_pic: fixPicUrl(pic),
                    vod_remarks: desc || ''
                });
            }
        });

        logInfo(`搜索 "${keyword}" 找到 ${list.length} 个结果`);
        return {
            list: list,
            page: pg,
            pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (error) {
        logError('搜索错误', error);
        return { list: [], page: pg, pagecount: 1 };
    }
}

/**
 * 详情
 */
async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        let detailUrl = videoId.startsWith('http') ? videoId : aowuConfig.host + '/' + videoId;
        logInfo('获取详情', detailUrl);

        const response = await _http.get(detailUrl, { headers: aowuConfig.headers });
        const html = response.data;
        const $ = cheerio.load(html);

        // 基本信息
        const vod_name = $('h3').text().trim() || $('title').text().replace(' - 嗷呜动漫', '').trim();
        const vod_content = $('.switch-box').text().trim() || $('.vod_content').text().trim();
        const vod_pic = $('.vodlist_thumb').data('original') || $('.vodlist_thumb').attr('src') || $('img.lazy').attr('src');

        // 播放列表提取
        const playmap = {};
        const playLines = [];

        // 处理播放选项卡
        $('.anthology-tab a').each((tabIndex, tabItem) => {
            const form = $(tabItem).text().trim();
            if (!form) return;

            const tabId = $(tabItem).attr('href') || `#tab${tabIndex + 1}`;
            const playlist = $(tabId).length > 0 ? $(tabId) : $('.anthology-list-play').eq(tabIndex);

            if (playlist.length > 0) {
                playmap[form] = [];
                playlist.find('a').each((i, playItem) => {
                    const title = $(playItem).attr('title') || $(playItem).text().trim();
                    let urls = $(playItem).attr('href');

                    if (title && urls) {
                        if (urls.startsWith('/')) {
                            urls = aowuConfig.host + urls;
                        } else if (!urls.startsWith('http')) {
                            urls = aowuConfig.host + '/' + urls;
                        }
                        playmap[form].push(title + "$" + urls);
                    }
                });

                if (playmap[form].length > 0) {
                    playLines.push(form);
                    logInfo(`播放线路 ${form} 找到 ${playmap[form].length} 个剧集`);
                } else {
                    delete playmap[form];
                }
            }
        });

        // 如果没有找到选项卡,尝试直接查找播放列表
        if (Object.keys(playmap).length === 0) {
            logInfo('未找到选项卡,尝试直接查找播放列表');
            $('.anthology-list-play a').each((i, playItem) => {
                const title = $(playItem).attr('title') || $(playItem).text().trim();
                let urls = $(playItem).attr('href');

                if (title && urls) {
                    if (urls.startsWith('/')) {
                        urls = aowuConfig.host + urls;
                    } else if (!urls.startsWith('http')) {
                        urls = aowuConfig.host + '/' + urls;
                    }
                    if (!playmap['播放列表']) {
                        playmap['播放列表'] = [];
                        playLines.push('播放列表');
                    }
                    playmap['播放列表'].push(title + "$" + urls);
                }
            });

            if (playmap['播放列表']) {
                logInfo(`直接查找找到 ${playmap['播放列表'].length} 个剧集`);
            }
        }

        // 如果还是没有找到,创建默认播放线路
        if (Object.keys(playmap).length === 0) {
            logInfo('未找到播放列表,创建默认线路');
            playmap['主线路'] = [`第1集$${detailUrl}`];
            playLines.push('主线路');
        }

        // 处理屏蔽逻辑:如果有3条线路,屏蔽第一条
        let vod_play_from, vod_play_url;

        if (playLines.length === 3) {
            logInfo(`检测到3条播放线路,屏蔽第一条: ${playLines[0]}`);
            delete playmap[playLines[0]];
            const filteredPlayLines = playLines.slice(1);
            vod_play_from = filteredPlayLines.join('$$$');
            const playUrls = filteredPlayLines.map(line => playmap[line].join("#"));
            vod_play_url = playUrls.join('$$$');
            logInfo(`屏蔽后剩余线路: ${vod_play_from}`);
        } else {
            vod_play_from = playLines.join('$$$');
            const playUrls = playLines.map(line => playmap[line].join("#"));
            vod_play_url = playUrls.join('$$$');
            logInfo(`线路数量 ${playLines.length} 条,不进行屏蔽`);
        }

        // 转换为 OmniBox 格式的播放源
        const playSources = parsePlaySources(vod_play_from, vod_play_url);

        const detail = {
            vod_id: videoId,
            vod_name: vod_name,
            vod_pic: fixPicUrl(vod_pic),
            vod_content: vod_content,
            vod_play_sources: playSources // OmniBox 格式
        };

        logInfo('详情获取成功');
        return { list: [detail] };
    } catch (error) {
        logError('详情获取错误', error);
        return { list: [] };
    }
}

/**
 * 播放
 */
async function play(params) {
    const playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);

    try {
        let playUrl = playId;

        // 确保URL格式正确
        if (playUrl && !playUrl.startsWith('http')) {
            playUrl = playUrl.startsWith('/') ?
                aowuConfig.host + playUrl :
                aowuConfig.host + '/' + playUrl;
        }

        logInfo('处理后的播放URL', playUrl);

        // 检查是否是直接播放链接
        const isDirectPlayable = playUrl.match(/\.(m3u8|mp4|flv|avi|mkv|ts)/i);

        if (isDirectPlayable) {
            logInfo('直接播放链接');
            return {
                urls: [{ name: "直接播放", url: playUrl }],
                parse: 0,
                header: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
                    "Referer": aowuConfig.host + "/",
                    "Origin": aowuConfig.host
                }
            };
        } else {
            logInfo('需要解析播放页');
            const realVideoUrl = await parseAowuPlayPage(playUrl);

            if (realVideoUrl) {
                logInfo('解析成功,真实视频地址', realVideoUrl);
                return {
                    urls: [{ name: "极速云", url: realVideoUrl }],
                    parse: 0,
                    header: {
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
                        "Referer": playUrl,
                        "Origin": aowuConfig.host
                    }
                };
            }

            logInfo('未解析出真实地址,返回原始链接');
            return {
                urls: [{ name: "默认", url: playUrl }],
                parse: 1,
                header: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
                    "Referer": aowuConfig.host + "/",
                    "Origin": aowuConfig.host
                }
            };
        }
    } catch (error) {
        logError('播放处理错误', error);
        return {
            urls: [{ name: "默认", url: playId }],
            parse: 1,
            header: aowuConfig.headers
        };
    }
}

// ========== 导出模块 ==========
module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);