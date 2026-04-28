J片天// @name J片天堂
// @version 1.0.1
// @description 
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/twmov.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

// 更新为最新可用域名，避免图片跨域拦截和重定向丢失
const HOST = "https://jpttavmovtv7.cc";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Referer": `${HOST}/`,
};

async function home(params, context) {
    const categories = [
        { type_name: "今日熱門", type_id: "sort-3" },
        { type_name: "本周熱門", type_id: "sort-4" },
        { type_name: "本月熱門", type_id: "sort-5" },
    ];
    
    const tagDict = {
        "中文": "278", "巨乳": "15", "熟女": "95", "騎乘位": "74", "口交": "34", "癡女": "75", 
        "潮吹": "32", "企劃片": "84", "美尻": "156", "打手槍": "98", "戲劇、連續劇": "58", 
        "制服": "19", "美腿": "157", "舔鮑": "122", "美乳": "166", "搭訕": "12", "妄想族": "184", 
        "第一人稱視點": "167", "媽媽系": "193", "人妻・主婦": "26", "多種職業": "84", 
        "羞辱": "163", "女教師": "131", "淫語": "151", "肉感": "136", "愛美臀": "111", 
        "背後位": "178", "調教": "395", "處男": "23", "護士": "283", "修長": "147", 
        "露內褲": "169", "絲襪": "115", "愛巨乳": "200", "眼鏡": "290", "超乳": "211", 
        "顏面騎乘": "263", "惡作劇": "145", "義母": "144", "淫亂・過激系": "63", "愛美腿": "11", 
        "爆乳": "483", "女上司": "137", "正太": "415", "穿衣幹砲": "179", "緊身皮衣": "304", 
        "學園": "421", "空姐": "132", "粉絲感謝祭": "190", "背面騎乗位": "646", "秘書": "363", 
        "女主播": "106", "反向搭訕": "305", "健身教練": "233", "部下・同僚": "150", 
        "舞蹈": "130", "緊身衣激凸": "321", "3D影片": "508", "早洩": "403"
    };

    for (const key in tagDict) {
        categories.push({ type_name: key, type_id: `tag-${tagDict[key]}` });
    }

    return { class: categories, list: [] };
}

async function category(params, context) {
    try {
        const categoryId = params.categoryId;
        const page = params.page || 1;
        let url = "";

        if (categoryId.startsWith("sort-")) {
            url = `${HOST}/list?sort=${categoryId.replace('sort-', '')}&page=${page}`;
        } else {
            url = `${HOST}/tag_list?tid=${categoryId.replace('tag-', '')}&idx=${page}`;
        }

        const html = (await OmniBox.request(url, { headers: HEADERS })).body;
        const list = parseVideoList(html);

        return {
            page: parseInt(page),
            pagecount: list.length > 0 ? parseInt(page) + 1 : parseInt(page),
            total: 9999,
            list: list
        };
    } catch (e) {
        OmniBox.log("error", `category error: ${e.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

async function detail(params, context) {
    try {
        const videoId = params.videoId;
        const url = videoId.startsWith('http') ? videoId : HOST + (videoId.startsWith('/') ? '' : '/') + videoId;
        
        const html = (await OmniBox.request(url, { headers: HEADERS })).body;
        const $ = cheerio.load(html);
        
        const name = $('h1.h1_title').text().trim() || "未知标题";
        
        // 详情页封面图多重提取机制
        let pic = $('video').attr('poster') || $('meta[property="og:image"]').attr('content') || '';
        if (!pic) {
            const $cover = $('.index_video_cover');
            pic = $cover.attr('data-src') || $cover.attr('src') || '';
            // 背景图提取
            if (!pic) {
                const style = $cover.attr('style') || '';
                const bgMatch = style.match(/url\(['"]?([^'"()]+)['"]?\)/i);
                if (bgMatch) pic = bgMatch[1];
            }
        }
        
        if (pic) {
            if (pic.startsWith('//')) {
                pic = 'https:' + pic;
            } else if (!pic.startsWith('http')) {
                pic = HOST + (pic.startsWith('/') ? '' : '/') + pic;
            }
        }
        
        const remark = $('.info_original p').first().text().trim() || name;

        let m3u8Url = "";
        const sourceMatch = html.match(/<source\s+src="([^"]+\.m3u8[^"]*)"/i);
        if (sourceMatch) {
            m3u8Url = sourceMatch[1];
        } else {
            const hlsMatch = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
            if (hlsMatch) m3u8Url = hlsMatch[1];
        }

        if (m3u8Url && m3u8Url.startsWith('//')) {
            m3u8Url = 'https:' + m3u8Url;
        } else if (m3u8Url && m3u8Url.startsWith('/')) {
            m3u8Url = HOST + m3u8Url;
        }

        const combinedPlayId = `${url}|||${m3u8Url}`;

        const vod = {
            vod_id: videoId,
            vod_name: name,
            vod_pic: pic,
            vod_content: remark,
            vod_play_sources: [
                {
                    name: "直连播放",
                    episodes: [
                        {
                            name: "正片",
                            playId: combinedPlayId
                        }
                    ]
                }
            ]
        };

        return { list: [vod] };
    } catch (e) {
        OmniBox.log("error", `detail error: ${e.message}`);
        return { list: [] };
    }
}

async function search(params, context) {
    try {
        const keyword = params.keyword || "";
        const page = params.page || 1;
        if (!keyword) return { list: [] };

        const url = `${HOST}/search?kw=${encodeURIComponent(keyword)}&idx=${page}&sort=2`;
        const html = (await OmniBox.request(url, { headers: HEADERS })).body;
        const list = parseVideoList(html);

        return {
            page: parseInt(page),
            pagecount: list.length > 0 ? parseInt(page) + 1 : parseInt(page),
            total: 9999,
            list: list
        };
    } catch (e) {
        OmniBox.log("error", `search error: ${e.message}`);
        return { page: 1, pagecount: 0, total: 0, list: [] };
    }
}

async function play(params, context) {
    try {
        const { playId } = params;
        const from = context?.from || 'web';
        
        let pageUrl = playId;
        let m3u8Url = playId;

        if (playId.includes('|||')) {
            const parts = playId.split('|||');
            pageUrl = parts[0];
            m3u8Url = parts[1] || pageUrl; 
        }

        if (from === 'ok') {
            return {
                parse: 1,
                urls: [{ name: "播放", url: pageUrl }],
                header: HEADERS
            };
        } else {
            return {
                parse: 0,
                urls: [{ name: "播放", url: m3u8Url }],
                header: HEADERS
            };
        }
    } catch (e) {
        OmniBox.log("error", `play error: ${e.message}`);
        return { parse: 0, urls: [], header: HEADERS };
    }
}

function parseVideoList(html) {
    const $ = cheerio.load(html);
    const list = [];
    $('.oneVideo').each((_, el) => {
        const $el = $(el);
        const name = $el.find('h3').text().trim() || $el.find('a').attr('title') || '未知';
        
        let pic = '';
        const $cover = $el.find('.index_video_cover');
        const $img = $el.find('img');
        
        // 1. 常规图片与懒加载提取
        pic = $cover.attr('data-src') || $cover.attr('data-original') || $cover.attr('src') ||
              $img.attr('data-src') || $img.attr('data-original') || $img.attr('src') || '';
              
        // 2. 尝试从 style="background-image: url(...)" 中提取
        if (!pic) {
            const style = $cover.attr('style') || $el.find('[style*="background"]').attr('style') || '';
            const bgMatch = style.match(/url\(['"]?([^'"()]+)['"]?\)/i);
            if (bgMatch) pic = bgMatch[1];
        }

        // 3. 终极正则提取 (穿透DOM直接匹配存储路径)
        if (!pic) {
            const htmlStr = $el.html();
            const pathMatch = htmlStr.match(/\/storage\/cover\/[^"')]+/i);
            if (pathMatch) pic = pathMatch[0];
        }

        // 4. 路径补全(使用新域名 HOST)
        if (pic) {
            if (pic.startsWith('//')) {
                pic = 'https:' + pic;
            } else if (!pic.startsWith('http')) {
                pic = HOST + (pic.startsWith('/') ? '' : '/') + pic;
            }
        }
        
        const remark = $el.find('.p_duration').text().trim();
        const id = $el.find('a').attr('href');
        
        if (name && id) {
            list.push({
                vod_id: id,
                vod_name: name,
                vod_pic: pic,
                vod_remarks: remark
            });
        }
    });
    return list;
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
