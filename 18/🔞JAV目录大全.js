// @name JAV目录大全
// @version 1.0.0
// @description JAVMENU 视频抓取源，支持双端自适应直链硬解与图片代理
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/JAVMENU.js


const OmniBox = require('omnibox_sdk');
const cheerio = require('cheerio');

const HOST = 'https://javmenu.com';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Referer': `${HOST}/`,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

/**
 * 统一网络请求包装，内置容错
 */
async function fetchPage(url) {
    try {
        const targetUrl = url.startsWith('http') ? url : `${HOST}${url}`;
        const res = await OmniBox.request(targetUrl, {
            method: 'GET',
            headers: HEADERS,
            timeout: 15000
        });
        return res.body || '';
    } catch (e) {
        OmniBox.log('error', `请求失败: ${url} | ${e.message}`);
        return '';
    }
}

/**
 * 清洗标题，去除无关引流广告词与DOM角标
 */
function cleanTitle(title) {
    if (!title) return '';
    let t = title;
    
    // 1. 强力正则：精准拦截尾部出现的引流广告词组 (兼容全半角、中英文长短连字符及无缝连接)
    t = t.replace(/[-\s_—–－]*(?:精品力荐|免费AV在线看)+.*$/g, '');
    
    // 2. 剔除列表元素提取时夹带的 "New" 角标文本
    t = t.replace(/\s+New$/i, '');
    
    // 3. 常规 " - " 切割兜底
    t = t.split(' - ')[0].trim();
    
    return t.trim();
}

/**
 * 补全图片绝对路径并智能附加防盗链策略
 */
function fixImageUrl(url, context) {
    if (!url) return '';
    let finalUrl = url;
    if (url.startsWith('//')) {
        finalUrl = `https:${url}`;
    } else if (!url.startsWith('http')) {
        finalUrl = `${HOST}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    const from = context?.from || 'web';

    if (from === 'web' && context?.baseURL) {
        // Web 端浏览器不支持 @ 语法，必须调用 OmniBox 官方代理接口以绕过防盗链
        try {
            const headerObj = {
                'Referer': `${HOST}/`,
                'User-Agent': HEADERS['User-Agent']
            };
            const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString('base64');
            finalUrl = `${context.baseURL}/api/spider-source/proxy-play?url=${encodeURIComponent(finalUrl)}&headers=${encodeURIComponent(headerB64)}`;
        } catch (e) {
            OmniBox.log('warn', `图片代理转换失败: ${e.message}`);
        }
    } else if (from !== 'web') {
        // TVBox / OK 等客户端端：使用 @ 语法原生绕过
        if (!finalUrl.includes('@Referer=')) {
            finalUrl += `@Referer=${HOST}/`;
        }
    }
    
    return finalUrl;
}

/**
 * 列表通用解析逻辑
 */
function parseList($, context) {
    const list = [];
    $('.video-list-item').each((_, el) => {
        const item = $(el);
        const a = item.find('a');
        let link = a.attr('href');
        
        if (!link || !link.includes('/zh/')) return;
        link = link.startsWith('http') ? link : `${HOST}${link}`;

        let name = item.find('.card-title').text().trim() || item.find('img').attr('alt') || '';
        name = cleanTitle(name); // 清洗列表标题
        if (!name) return;

        // 智能图片提取 (修复 cheero .attr() 只抓首个节点导致的 loading.gif 问题)
        let pic = '';
        item.find('img').each((_, imgEl) => {
            if (pic) return; // 找到就退出当前遍历
            let src = $(imgEl).attr('data-src') || $(imgEl).attr('src') || '';
            const badKeywords = ['button_logo', 'no_preview', 'loading', 'website_building'];
            
            if (src && !badKeywords.some(kw => src.includes(kw))) {
                pic = fixImageUrl(src, context); // 修复图片裂开及防盗链
            }
        });

        const remarks = item.find('.text-muted').text().trim();

        list.push({
            vod_id: link,
            vod_name: name,
            vod_pic: pic,
            vod_remarks: remarks
        });
    });
    return list;
}

// ==================== 接口实现 ====================

async function home(params, context) {
    const categories = [
        { type_name: "有码在线", type_id: "/zh/censored/online" },
        { type_name: "无码在线", type_id: "/zh/uncensored/online" },
        { type_name: "欧美在线", type_id: "/zh/western/online" },
        { type_name: "FC2在线", type_id: "/zh/fc2/online" },
        { type_name: "成人动画", type_id: "/zh/hanime/online" },
        { type_name: "国产在线", type_id: "/zh/chinese/online" },
        { type_name: "有码作品", type_id: "/zh/censored" },
        { type_name: "无码作品", type_id: "/zh/uncensored" },
        { type_name: "欧美作品", type_id: "/zh/western" },
        { type_name: "FC2作品", type_id: "/zh/fc2" }
    ];

    const html = await fetchPage('/zh');
    const $ = cheerio.load(html);
    const videos = parseList($, context); // 传入 context 处理防盗链代理

    return {
        class: categories,
        list: videos
    };
}

async function category(params, context) {
    const tid = params.categoryId;
    const pg = params.page || 1;
    const url = pg == 1 ? tid : `${tid}?page=${pg}`;
    
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    return {
        page: parseInt(pg),
        pagecount: 9999,
        limit: 90,
        total: 999999,
        list: parseList($, context)
    };
}

async function detail(params, context) {
    let url = params.videoId;
    if (!url.startsWith('http')) url = `${HOST}${url}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // 提取演员
    const actors = [];
    const h1Text = $('h1').text().trim();
    if (h1Text) {
        actors.push(...h1Text.split(/\s+/).slice(1));
    }
    $('a[href*="/actor/"]').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !actors.includes(text)) actors.push(text);
    });

    // 提取年份与标签
    const dateStr = $('.text-muted').text();
    const yearMatch = dateStr.match(/(\d{4})-\d{2}-\d{2}/);
    const year = yearMatch ? yearMatch[1] : '';

    const tags = [];
    $('.badge').each((_, el) => {
        const t = $(el).text().trim();
        if (t && !tags.includes(t)) tags.push(t);
    });

    // 提取高清封面
    let pic = '';
    $('img').each((_, el) => {
        if (pic) return;
        let src = $(el).attr('data-src') || $(el).attr('src') || '';
        const badKeywords = ['button_logo', 'no_preview', 'loading', 'website_building'];
        if (src && !badKeywords.some(kw => src.includes(kw))) {
            pic = fixImageUrl(src, context); // 处理绝对路径及代理防盗链
        }
    });
    
    let rawTitle = $('h1').text().trim() || $('title').text().trim();
    let finalTitle = cleanTitle(rawTitle); // 强制剔除引流广告词

    const vod = {
        vod_id: url,
        vod_name: finalTitle,
        vod_pic: pic,
        vod_content: $('.card-text').text().trim() || '',
        vod_actor: actors.join(',') || '未知',
        vod_area: '日本',
        vod_year: year,
        vod_remarks: tags.join(' '),
        vod_play_sources: [
            {
                name: '默认线路',
                episodes: [
                    { name: '正片', playId: url } 
                ]
            }
        ]
    };

    return { list: [vod] };
}

async function search(params, context) {
    const keyword = encodeURIComponent(params.keyword || '');
    const pg = params.page || 1;
    const url = `/zh/search?wd=${keyword}&page=${pg}`;
    
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    return {
        page: parseInt(pg),
        pagecount: $('.pagination').length > 0 ? parseInt(pg) + 1 : parseInt(pg),
        list: parseList($, context)
    };
}

async function play(params, context) {
    const playId = params.playId;
    const from = context?.from || 'web';

    if (from === 'ok') {
        return {
            urls: [{ name: '客户端播放', url: playId }],
            parse: 1
        };
    }

    const html = await fetchPage(playId);
    const $ = cheerio.load(html);
    let realM3u8Url = '';

    $('source').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('.m3u8')) realM3u8Url = src;
    });

    if (!realM3u8Url) {
        $('video').each((_, el) => {
            const src = $(el).attr('src');
            if (src && src.includes('.m3u8')) realM3u8Url = src;
        });
    }

    if (!realM3u8Url) {
        const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
        if (m3u8Match) {
            realM3u8Url = m3u8Match[0].replace(/\\/g, ''); 
        }
    }

    if (realM3u8Url) {
        return {
            urls: [{ name: '直连播放', url: realM3u8Url }],
            parse: 0,
            header: {
                'User-Agent': HEADERS['User-Agent'],
                'Referer': HEADERS['Referer']
            } 
        };
    }

    return {
        urls: [{ name: '解析播放', url: playId }],
        parse: 1
    };
}

module.exports = {
    home,
    category,
    detail,
    search,
    play
};

const runner = require("spider_runner");
runner.run(module.exports);
