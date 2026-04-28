// @name 634tv
// @version 1.2.0
// @description  MacCMS v10
// @changelog
// 1.2.0 适配官方文档：添加link字段、修正filters格式、添加官方缓存
// 1.1.0 修正分类结构，支持子分类筛选，play()支持双端直链
// 1.0.0 初始版本 - 支持home/category/detail/search/play
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/634TV.js

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://634.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://634.tv/";

// 缓存配置（秒）
const CACHE_TTL_HOME = 300;   // 首页 5 分钟
const CACHE_TTL_CAT = 600;    // 分类 10 分钟
const CACHE_TTL_DETAIL = 600; // 详情 10 分钟
const CACHE_TTL_SEARCH = 60;  // 搜索 1 分钟

// ═══ 分类配置 ═══
const MAIN_CATS = [
    { type_id: "1", type_name: "麻豆视频" },
    { type_id: "2", type_name: "日本视频" },
    { type_id: "3", type_name: "欧美视频" },
    { type_id: "4", type_name: "动漫视频" },
    { type_id: "5", type_name: "国产视频" }
];

// 子分类映射
const SUB_CATS_MAP = {
    "1": [
        { type_id: "6", type_name: "麻豆原创" },
        { type_id: "7", type_name: "91制片厂" },
        { type_id: "8", type_name: "天美传媒" },
        { type_id: "9", type_name: "蜜桃影像" },
        { type_id: "10", type_name: "星空传媒" },
        { type_id: "11", type_name: "皇家华人" },
        { type_id: "12", type_name: "精东影业" },
        { type_id: "13", type_name: "乐播传媒" },
        { type_id: "14", type_name: "成人头条" },
        { type_id: "15", type_name: "兔子先生" },
        { type_id: "16", type_name: "杏吧原创" },
        { type_id: "17", type_name: "玩偶姐姐" },
        { type_id: "18", type_name: "糖心Vlog" },
        { type_id: "20", type_name: "萝莉社" },
        { type_id: "21", type_name: "色控传媒" },
        { type_id: "22", type_name: "华语原创" }
    ],
    "2": [
        { type_id: "23", type_name: "中文字幕" },
        { type_id: "24", type_name: "日本无码" },
        { type_id: "25", type_name: "日本有码" },
        { type_id: "26", type_name: "丝袜美腿" },
        { type_id: "27", type_name: "强奸乱伦" },
        { type_id: "31", type_name: "巨乳美乳" },
        { type_id: "32", type_name: "美女萝莉" },
        { type_id: "33", type_name: "熟女人妻" },
        { type_id: "34", type_name: "口爆颜射" },
        { type_id: "38", type_name: "岛国群交" }
    ],
    "5": [
        { type_id: "39", type_name: "国产精品" },
        { type_id: "43", type_name: "女神学生" },
        { type_id: "46", type_name: "空姐模特" },
        { type_id: "47", type_name: "国产乱伦" },
        { type_id: "50", type_name: "职场同事" },
        { type_id: "51", type_name: "国产名人" }
    ],
    "3": [],
    "4": []
};

// 排序选项
const SORT_OPTIONS = [
    { name: "按时间", value: "time" },
    { name: "按人气", value: "hits" },
    { name: "按评分", value: "score" }
];

// ═══ 筛选器配置（借鉴豆瓣推荐.js格式）═══
const FILTERS = {
    "1": [ // 麻豆视频
        {
            key: "type_id",
            name: "类型",
            init: "1",
            value: [
                { name: "全部", value: "1" },
                { name: "麻豆原创", value: "6" },
                { name: "91制片厂", value: "7" },
                { name: "天美传媒", value: "8" },
                { name: "蜜桃影像", value: "9" },
                { name: "星空传媒", value: "10" },
                { name: "皇家华人", value: "11" },
                { name: "精东影业", value: "12" },
                { name: "乐播传媒", value: "13" },
                { name: "成人头条", value: "14" },
                { name: "兔子先生", value: "15" },
                { name: "杏吧原创", value: "16" },
                { name: "玩偶姐姐", value: "17" },
                { name: "糖心Vlog", value: "18" },
                { name: "萝莉社", value: "20" },
                { name: "色控传媒", value: "21" },
                { name: "华语原创", value: "22" }
            ]
        },
        {
            key: "by",
            name: "排序",
            init: "time",
            value: SORT_OPTIONS
        }
    ],
    "2": [ // 日本视频
        {
            key: "type_id",
            name: "类型",
            init: "2",
            value: [
                { name: "全部", value: "2" },
                { name: "中文字幕", value: "23" },
                { name: "日本无码", value: "24" },
                { name: "日本有码", value: "25" },
                { name: "丝袜美腿", value: "26" },
                { name: "强奸乱伦", value: "27" },
                { name: "巨乳美乳", value: "31" },
                { name: "美女萝莉", value: "32" },
                { name: "熟女人妻", value: "33" },
                { name: "口爆颜射", value: "34" },
                { name: "岛国群交", value: "38" }
            ]
        },
        {
            key: "by",
            name: "排序",
            init: "time",
            value: SORT_OPTIONS
        }
    ],
    "3": [ // 欧美视频
        {
            key: "by",
            name: "排序",
            init: "time",
            value: SORT_OPTIONS
        }
    ],
    "4": [ // 动漫视频
        {
            key: "by",
            name: "排序",
            init: "time",
            value: SORT_OPTIONS
        }
    ],
    "5": [ // 国产视频
        {
            key: "type_id",
            name: "类型",
            init: "5",
            value: [
                { name: "全部", value: "5" },
                { name: "国产精品", value: "39" },
                { name: "女神学生", value: "43" },
                { name: "空姐模特", value: "46" },
                { name: "国产乱伦", value: "47" },
                { name: "职场同事", value: "50" },
                { name: "国产名人", value: "51" }
            ]
        },
        {
            key: "by",
            name: "排序",
            init: "time",
            value: SORT_OPTIONS
        }
    ]
};

// ═══ 工具函数 ═══
function log(level, msg) {
    OmniBox.log(level, "[634tv] " + msg);
}

function cleanText(t) {
    return (t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatPic(pic) {
    if (!pic) return "";
    if (pic.startsWith("//")) return "https:" + pic;
    if (pic.startsWith("http")) return pic;
    return HOST + (pic.startsWith("/") ? "" : "/") + pic;
}

function parsePageCount($) {
    let maxPage = 1;
    $(".mac_page_go a, .page-pagination a, .stui-page a").each(function () {
        const href = $(this).attr("href") || "";
        const m = href.match(/\/page\/(\d+)/);
        if (m) {
            const p = parseInt(m[1]) || 1;
            if (p > maxPage) maxPage = p;
        }
    });
    return maxPage;
}

// ═══ HTTP请求 ═══
async function httpGet(url) {
    try {
        console.log("[634tv] httpGet: 请求 " + url);
        const res = await OmniBox.request(url, {
            method: "GET",
            headers: {
                "User-Agent": UA,
                "Referer": REFERER,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Connection": "keep-alive"
            },
            timeout: 15000
        });
        console.log("[634tv] httpGet: 响应状态 " + res.statusCode + ", 长度 " + (res.body?.length || 0));
        return res.body || "";
    } catch (e) {
        console.log("[634tv] httpGet失败: " + url + " - " + e.message);
        return "";
    }
}

// ═══ 视频列表解析 ═══
function parseVideoList($, typeId = "1") {
    const list = [];
    const seenIds = new Set();
    
    $('[class*="stui-vodlist__box"]').each(function () {
        const $el = $(this);
        const $a = $el.find("a[href*='/vod/play/']").first();
        const href = $a.attr("href") || "";
        const m = href.match(/\/vod\/play\/id\/(\d+)/);
        if (!m) return;
        
        const id = m[1];
        if (seenIds.has(id)) return;
        seenIds.add(id);
        
        const title = cleanText($a.attr("title") || $el.find("h4.title a").attr("title") || "");
        const pic = formatPic($a.attr("data-original") || "");
        const remarks = cleanText($el.find(".stui-vodlist__detail p").first().text()) || "";

        list.push({
            vod_id: id,
            link: `https://movie.douban.com/subject/${id}/`,  // 必填字段
            vod_name: title,
            vod_pic: pic,
            type_id: typeId,
            type_name: "视频",
            vod_remarks: remarks
        });
    });
    return list;
}

// ═══ home ═══
async function home(params, context) {
    const cacheKey = "634tv:home";
    
    try {
        // 尝试读取缓存
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) {
            try { return JSON.parse(cached); } catch (_) {}
        }
        
        log("info", "home: 返回分类列表");
        
        const result = {
            class: MAIN_CATS,
            list: [],  // 空list，去掉"推荐"分类
            filters: FILTERS  // 筛选器配置
        };
        
        // 写入缓存
        await OmniBox.setCache(cacheKey, JSON.stringify(result), CACHE_TTL_HOME);
        
        return result;
    } catch (e) {
        log("error", "home异常: " + e.message);
        return { class: MAIN_CATS, list: [], filters: FILTERS };
    }
}

// ═══ category ═══
async function category(params, context) {
    try {
        const categoryId = params.categoryId || params.t || params.id || "1";
        const page = parseInt(params.page || params.pg || 1) || 1;
        const filters = params.filters || {};
        
        // 获取筛选参数
        const typeId = filters.type_id || categoryId;  // 子分类筛选
        const by = filters.by || "";
        
        // 缓存key
        const cacheKey = `634tv:cat:${categoryId}:p${page}:${JSON.stringify(filters)}`;
        
        // 尝试读取缓存
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) {
            try { return JSON.parse(cached); } catch (_) {}
        }

        // 构建URL（使用typeId作为实际分类ID）
        let url = HOST + "/index.php/vod/show/id/" + typeId;
        if (by && ["time", "hits", "score"].includes(by)) {
            url = HOST + "/index.php/vod/show/by/" + by + "/id/" + typeId;
        }
        if (page > 1) {
            url += "/page/" + page;
        }
        url += ".html";

        console.log("[634tv] category: 请求URL " + url);
        const html = await httpGet(url);
        console.log("[634tv] category: 获取HTML长度 " + html.length);
        
        const $ = cheerio.load(html);
        console.log("[634tv] category: cheerio加载完成");

        const list = parseVideoList($, categoryId);
        console.log("[634tv] category: 解析到 " + list.length + " 条视频");
        
        const pagecount = parsePageCount($);

        const result = {
            page: page,
            pagecount: Number(pagecount) || 1,
            list: list
        };
        
        // 写入缓存
        await OmniBox.setCache(cacheKey, JSON.stringify(result), CACHE_TTL_CAT);

        return result;
    } catch (e) {
        log("error", "category异常: " + e.message);
        return { page: 1, pagecount: 1, list: [] };
    }
}

// ═══ detail ═══
async function detail(params, context) {
    try {
        const videoId = params.videoId || params.id || "";
        if (!videoId) return { list: [] };

        // 缓存key
        const cacheKey = `634tv:detail:${videoId}`;
        
        // 尝试读取缓存
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) {
            try { return JSON.parse(cached); } catch (_) {}
        }

        const url = HOST + "/index.php/vod/detail/id/" + videoId + ".html";
        const html = await httpGet(url);
        const $ = cheerio.load(html);

        // 元数据提取
        const title = cleanText($("h1.title").first().text() || $("title").text()) || "";
        const score = cleanText($("h1.title span.score").text()) || "";
        const type = cleanText($("p.data a[href*='/vod/search/class/']").first().text()) || "";
        const region = cleanText($("p.data span:contains('地区')").next().text()) || "";
        const year = cleanText($("p.data span:contains('年份')").next().text()) || "";
        const actor = cleanText($("p.data span:contains('主演')").parent().text()).replace("主演：", "") || "";
        const director = cleanText($("p.data span:contains('导演')").parent().text()).replace("导演：", "") || "";
        const description = cleanText($("#desc p.col-pd").first().text()) || "";
        const pic = formatPic($("img.lazyload").attr("data-original") || $("img.lazyload").attr("src") || "");

        // 播放线路解析
        const playSources = [];
        $(".stui-pannel-box.playlist").each(function (lineIdx) {
            const $panel = $(this);
            const lineName = cleanText($panel.find(".stui-pannel_hd h3.title").text()) || ("线路" + (lineIdx + 1));
            const episodes = [];

            $panel.find(".stui-content__playlist li a[href*='/vod/play/']").each(function () {
                const $a = $(this);
                const href = $a.attr("href") || "";
                const epName = cleanText($a.text()) || "";
                const m = href.match(/\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)/);
                if (m) {
                    episodes.push({
                        name: epName,
                        playId: m[1] + "|" + m[2] + "|" + m[3]
                    });
                }
            });

            if (episodes.length > 0) {
                playSources.push({
                    name: lineName,
                    episodes: episodes
                });
            }
        });

        log("info", `detail(${videoId}): ${title}, ${playSources.length}条线路`);

        const result = {
            list: [{
                vod_id: videoId,
                link: `https://movie.douban.com/subject/${videoId}/`,  // 必填字段
                vod_name: title,
                vod_pic: pic,
                vod_content: description,
                vod_director: director,
                vod_actor: actor,
                vod_area: region,
                vod_year: year,
                vod_remarks: score ? (score + "分") : "",
                vod_douban_score: score,
                type_name: type || "视频",
                vod_play_sources: playSources
            }]
        };
        
        // 写入缓存
        await OmniBox.setCache(cacheKey, JSON.stringify(result), CACHE_TTL_DETAIL);

        return result;
    } catch (e) {
        log("error", "detail异常: " + e.message);
        return { list: [] };
    }
}

// ═══ search ═══
async function search(params, context) {
    try {
        const keyword = (params.keyword || params.wd || "").trim();
        if (!keyword) return { page: 1, pagecount: 0, list: [] };

        const page = parseInt(params.page || params.pg || 1) || 1;
        const quick = params.quick || false;

        // 缓存key
        const cacheKey = `634tv:search:${keyword}:p${page}`;
        
        // 尝试读取缓存
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) {
            try { return JSON.parse(cached); } catch (_) {}
        }

        let url = HOST + "/index.php/vod/search.html?wd=" + encodeURIComponent(keyword);
        if (page > 1) {
            url += "&page=" + page;
        }

        const html = await httpGet(url);
        const $ = cheerio.load(html);

        let list = [];
        const seenIds = new Set();
        
        $(".stui-vodlist__media li").each(function () {
            const $el = $(this);
            const $a = $el.find("a[href*='/vod/play/']").first();
            const href = $a.attr("href") || "";
            const m = href.match(/\/vod\/play\/id\/(\d+)/);
            if (!m) return;
            
            const id = m[1];
            if (seenIds.has(id)) return;
            seenIds.add(id);
            
            const title = cleanText($a.attr("title") || $el.find("h3.title a").text() || "");
            const pic = formatPic($a.attr("data-original") || "");
            const remarks = cleanText($el.find(".pic-text").first().text()) || "";

            list.push({
                vod_id: id,
                link: `https://movie.douban.com/subject/${id}/`,  // 必填字段
                vod_name: title,
                vod_pic: pic,
                type_id: "1",
                type_name: "视频",
                vod_remarks: remarks
            });
        });
        
        const pagecount = parsePageCount($);

        if (quick) {
            list = list.slice(0, 10);
        }

        log("info", `search("${keyword}",p${page}): ${list.length}条结果`);

        const result = {
            page: page,
            pagecount: Number(pagecount) || 1,
            list: list
        };
        
        // 写入缓存
        await OmniBox.setCache(cacheKey, JSON.stringify(result), CACHE_TTL_SEARCH);

        return result;
    } catch (e) {
        log("error", "search异常: " + e.message);
        return { page: 1, pagecount: 0, list: [] };
    }
}

// ═══ play ═══
async function play(params, context) {
    try {
        const playId = params.playId || params.url || "";
        if (!playId) return { urls: [], parse: 0, flag: "play" };

        // 直链模式
        if (/\.(m3u8|mp4|flv)/i.test(playId)) {
            log("info", "play: 直链模式");
            return {
                urls: [{ name: "高清", url: playId }],
                parse: 0,
                flag: "play",
                header: { "User-Agent": UA, "Referer": REFERER }
            };
        }

        // URL嗅探模式（OK影视端兜底）
        if (playId.indexOf("http") === 0) {
            log("info", "play: URL嗅探模式 (OK影视端parse:1兜底)");
            return {
                urls: [{ name: "播放", url: playId }],
                parse: 1,
                flag: "play",
                header: { "User-Agent": UA, "Referer": REFERER }
            };
        }

        // 解析playId: id|sid|nid
        const parts = playId.split("|");
        if (parts.length !== 3) {
            log("error", "play: 无效playId格式: " + playId);
            return { urls: [], parse: 0, flag: "play" };
        }

        const [vid, sid, nid] = parts;
        const playUrl = HOST + "/index.php/vod/play/id/" + vid + "/sid/" + sid + "/nid/" + nid + ".html";

        log("info", `play: 请求播放页 ${playUrl}`);
        const html = await httpGet(playUrl);

        // 正则提取 player_aaaa.url
        const urlMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*[;<\/]/);
        if (!urlMatch) {
            log("error", "play: 未找到player_aaaa变量");
            // 直链提取失败，返回播放页URL让客户端parse:1兜底
            return {
                urls: [{ name: "播放", url: playUrl }],
                parse: 1,
                flag: "play",
                header: { "User-Agent": UA, "Referer": REFERER }
            };
        }

        try {
            const playerData = JSON.parse(urlMatch[1]);
            const m3u8Url = playerData.url || "";

            if (!m3u8Url) {
                log("error", "play: player_aaaa.url为空");
                return {
                    urls: [{ name: "播放", url: playUrl }],
                    parse: 1,
                    flag: "play",
                    header: { "User-Agent": UA, "Referer": REFERER }
                };
            }

            log("info", "play: 成功提取m3u8直链 " + m3u8Url.substring(0, 60) + "...");

            return {
                urls: [{ name: playerData.from || "高清", url: m3u8Url }],
                parse: 0,
                flag: "play",
                header: { "User-Agent": UA, "Referer": REFERER }
            };
        } catch (jsonErr) {
            log("error", "play: 解析player_aaaa JSON失败: " + jsonErr.message);
            return {
                urls: [{ name: "播放", url: playUrl }],
                parse: 1,
                flag: "play",
                header: { "User-Agent": UA, "Referer": REFERER }
            };
        }
    } catch (e) {
        log("error", "play异常: " + e.message);
        return { urls: [], parse: 0, flag: "play" };
    }
}

// ═══ 模块导出 ═══
console.log("[634tv] 模块导出开始");
console.log("[634tv] home函数:", typeof home);
console.log("[634tv] category函数:", typeof category);
console.log("[634tv] search函数:", typeof search);
console.log("[634tv] detail函数:", typeof detail);
console.log("[634tv] play函数:", typeof play);

module.exports = { home, category, search, detail, play };
console.log("[634tv] 模块导出完成，开始运行spider_runner");
require("spider_runner").run(module.exports);
console.log("[634tv] spider_runner运行完成");
