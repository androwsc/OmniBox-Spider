// @name Porn87影视源
// @version 1.0.0
// @description Porn87 高性能解析脚本，支持硬解直链与双端分离逻辑
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/Porn87.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://porn87.com";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": `${HOST}/`
};

/**
 * 封装HTTP请求
 */
async function fetchHtml(url) {
    try {
        const res = await OmniBox.request(url, { method: "GET", headers: HEADERS });
        return res.body || "";
    } catch (e) {
        OmniBox.log("error", `请求失败: ${url} - ${e.message}`);
        return "";
    }
}

/**
 * 通用解析视频列表
 */
function parseVideoList($) {
    const videos = [];
    $('a[href^="/main/html?id="]').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        const idMatch = href.match(/id=(\d+)/);
        if (!idMatch) return;
        
        const id = idMatch[1];
        const pic = a.find('img').attr('src') || '';
        
        // 提取标题和时长
        let title = '';
        let duration = '';
        a.find('span').each((_, span) => {
            const text = $(span).text().trim();
            // 纯数字加冒号的视为时长，例如 12:34 或 01:23:45
            if (/^[0-9:]+$/.test(text)) {
                duration = text;
            } else if (text) {
                // 覆盖获取真实的纯文本标题
                title = text;
            }
        });

        if (id && title) {
            videos.push({
                vod_id: id,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: duration, // 仅在图片角标处显示时长
                style: { type: "rect", ratio: 1.33 }
            });
        }
    });
    return videos;
}

/**
 * 获取分页总数
 */
function getPageCount(html, currentPage) {
    const nextStr = `page=${parseInt(currentPage) + 1}`;
    return html.includes(nextStr) ? 99999 : parseInt(currentPage);
}

async function home(params, context) {
    let classes = [];
    let list = [];
    try {
        // 1. 获取所有分类标签
        const tagsHtml = await fetchHtml(`${HOST}/main/all_tags`);
        const $tags = cheerio.load(tagsHtml);
        
        classes.push({ type_name: '最新影片', type_id: '/main/tag?lineup=create_time' });
        classes.push({ type_name: '最热门', type_id: '/main/tag?lineup=recent_views' });

        $tags('a[href*="/main/tag?name="]').each((_, el) => {
            let name = $tags(el).text().trim();
            // 去除括号及括号内的英文 (例如 "高清日本AV (HD JAV)" -> "高清日本AV")
            name = name.replace(/\s*\([^)]+\)$/, '').trim();
            
            const href = $tags(el).attr('href');
            if (name && href) {
                const urlMatch = href.match(/(\/main\/tag\?name=[^&"'>]+)/);
                if (urlMatch) {
                    classes.push({
                        type_name: name,
                        type_id: urlMatch[1]
                    });
                }
            }
        });

        // 2. 抓取首页推荐视频 (取最新影片作为首页列表)
        const homeHtml = await fetchHtml(`${HOST}/main/tag?lineup=create_time&page=1`);
        list = parseVideoList(cheerio.load(homeHtml));

    } catch (e) {
        OmniBox.log("error", `home 异常: ${e.message}`);
    }

    return { class: classes, list: list };
}

async function category(params, context) {
    const { categoryId, page = 1 } = params;
    try {
        const urlObj = new URL(`${HOST}${categoryId}`);
        urlObj.searchParams.set("page", page);
        // 确保使用最新排序作为默认
        if (!urlObj.searchParams.has("lineup")) {
            urlObj.searchParams.set("lineup", "create_time");
        }

        const html = await fetchHtml(urlObj.toString());
        const $ = cheerio.load(html);
        const videos = parseVideoList($);
        const pagecount = getPageCount(html, page);

        return {
            page: parseInt(page),
            pagecount: pagecount,
            limit: 30,
            total: 999999,
            list: videos
        };
    } catch (e) {
        OmniBox.log("error", `category 异常: ${e.message}`);
        return { page: 1, pagecount: 1, list: [] };
    }
}

async function detail(params, context) {
    const { videoId } = params;
    try {
        const html = await fetchHtml(`${HOST}/main/html?id=${videoId}`);
        const $ = cheerio.load(html);

        // 获取标题并去除后面的冗长尾缀
        let title = $('title').text().split('- Porn87')[0].trim();
        let pic = $('meta[property="og:image"]').attr('content') || '';
        
        let tags = [];
        $('a[href*="/main/tag?name="]').each((_, el) => {
            const t = $(el).text().trim();
            if (t) tags.push(t);
        });

        // 构造选集与线路结构
        const playUrl = `${HOST}/main/embed?id=${videoId}`;
        const playSources = [{
            name: "默认直连",
            episodes: [{
                name: "正片",
                playId: playUrl // 传递播放页的完整链接给 play 接口
            }]
        }];

        return {
            list: [{
                vod_id: videoId,
                vod_name: title || `视频 ${videoId}`,
                vod_pic: pic,
                vod_class: tags.join(','),
                vod_play_sources: playSources
            }]
        };
    } catch (e) {
        OmniBox.log("error", `detail 异常: ${e.message}`);
        return { list: [] };
    }
}

async function search(params, context) {
    const { keyword, page = 1 } = params;
    try {
        const url = `${HOST}/main/search?name=${encodeURIComponent(keyword)}&page=${page}`;
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);
        
        const videos = parseVideoList($);
        const pagecount = getPageCount(html, page);

        return {
            page: parseInt(page),
            pagecount: pagecount,
            limit: 30,
            total: 999999,
            list: videos
        };
    } catch (e) {
        OmniBox.log("error", `search 异常: ${e.message}`);
        return { page: 1, pagecount: 1, list: [] };
    }
}

async function play(params, context) {
    const { playId } = params; // playId 此时是 https://porn87.com/main/embed?id=xxx
    const from = context?.from || 'web';

    try {
        // 严格遵守规范：只有 ok 影视接受 parse: 1 进行原生客户端嗅探
        if (from === 'ok') {
            return {
                urls: [{ name: "播放", url: playId }],
                parse: 1,
                header: HEADERS // 网页嗅探需要带上 header
            };
        }

        // TVBox, Web, UZ 等其他所有端：必须拦截请求硬解，获取真实 m3u8 / mp4 直链
        const html = await fetchHtml(playId);
        
        // 正则穿透匹配 HTML / JS 变量中的 m3u8 地址
        // 优先匹配 video 标签的 src，或直接查找包含 .m3u8 的绝对路径
        const m3u8Match = html.match(/src=["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) || 
                          html.match(/(https?:\/\/[^\s"<>]+\.m3u8[^\s"<>]*)/i);

        if (m3u8Match && m3u8Match[1]) {
            return {
                urls: [{ name: "播放", url: m3u8Match[1] }],
                parse: 0
                // 【核心优化】：此处移除了 header: HEADERS。
                // 因为目标 CDN 无防盗链限制，移除后客户端将直连 CDN，
                // 不再经过 OmniBox 服务端 proxy-play 代理，彻底告别 broken pipe 和服务器带宽跑满问题！
            };
        }

        // 容错：如果找不到直链，降级返回页面让支持 Webview 的壳子去兜底
        return {
            urls: [{ name: "播放", url: playId }],
            parse: 1,
            header: HEADERS
        };
    } catch (e) {
        OmniBox.log("error", `play 异常: ${e.message}`);
        return { urls: [{ name: "播放", url: playId }], parse: 1, header: HEADERS };
    }
}

module.exports = { home, category, detail, search, play };

const runner = require("spider_runner");
runner.run(module.exports);
