// @name 河马短剧
// @author
// @description
// @dependencies: axios
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/短剧/河马短剧.js

/**
 * ==========================================================================
 * 河马短剧 - OmniBox 爬虫脚本（新格式）
 * ==========================================================================
 * 数据来源: https://www.kuaikaw.cn
 * 核心功能:
 *   - 首页/分类列表
 *   - 搜索
 *   - 详情/剧集
 *   - 播放直链解析（优先直链，fallback 解析）
 * 注意事项:
 *   - 页面为 Next.js，需要解析 __NEXT_DATA__
 *   - 部分章节无直链时，通过二级页面解析
 * 更新时间: 2026-03-17
 * ==========================================================================
 */

const axios = require("axios");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const hemaConfig = {
    siteUrl: "https://www.kuaikaw.cn",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Referer": "https://www.kuaikaw.cn",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    },
    timeout: 12000
};

// 分类映射（站点固定分类）
const classMapping = {
    "462": "甜宠",
    "1102": "古装仙侠",
    "1145": "现代言情",
    "1170": "青春",
    "585": "豪门恩怨",
    "417-464": "逆袭",
    "439-465": "重生",
    "1159": "系统",
    "1147": "总裁",
    "943": "职场商战"
};

// ========== 请求实例 ==========
const axiosInstance = axios.create({
    timeout: hemaConfig.timeout,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

// ========== 日志工具 ==========
const logInfo = (message, data) => {
    if (data !== undefined && data !== null) {
        OmniBox.log("info", `[河马短剧] ${message}: ${JSON.stringify(data)}`);
    } else {
        OmniBox.log("info", `[河马短剧] ${message}`);
    }
};

const logError = (message, error) => {
    OmniBox.log("error", `[河马短剧] ${message}: ${error.message || error}`);
};

// ========== 工具函数 ==========

/**
 * 发送 GET 请求
 * @param {string} url
 * @returns {Promise<string>} HTML 文本
 */
const requestHtml = async (url) => {
    try {
        const res = await axiosInstance.get(url, { headers: hemaConfig.headers });
        return res.data;
    } catch (error) {
        logError("请求失败", error);
        throw error;
    }
};

/**
 * 解析 Next.js 数据
 * @param {string} html
 * @returns {Object|null}
 */
const parseNextData = (html) => {
    try {
        const pattern = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
        const match = html.match(pattern);
        if (match && match[1]) {
            return JSON.parse(match[1]);
        }
    } catch (e) {
        logError("解析 __NEXT_DATA__ 失败", e);
    }
    return null;
};

/**
 * 生成分类列表
 */
const buildClasses = () => {
    return Object.keys(classMapping).map((key) => ({
        type_id: key,
        type_name: classMapping[key]
    }));
};

/**
 * 判断是否直链
 */
const isDirectPlayable = (url) => {
    return !!(url && url.match(/\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i));
};

/**
 * 安全转换页码
 */
const toPage = (value, def) => {
    const p = parseInt(value, 10);
    return Number.isNaN(p) ? def : p;
};

// ========== 核心逻辑 ==========

/**
 * 首页：返回分类 + 推荐列表
 */
async function home(params) {
    logInfo("进入首页", params);

    try {
        const classes = buildClasses();
        const homeResult = await getCategoryList(null, 1);
        return {
            class: classes,
            list: homeResult.list,
            page: 1,
            pagecount: homeResult.pagecount,
            limit: homeResult.limit,
            total: homeResult.total
        };
    } catch (e) {
        logError("首页获取失败", e);
        return { class: [], list: [] };
    }
}

/**
 * 分类列表
 */
async function category(params) {
    const categoryId = params.categoryId;
    const page = toPage(params.page, 1);

    logInfo("请求分类", { categoryId, page });

    if (!categoryId) {
        return { list: [], page: 1, pagecount: 1 };
    }

    return await getCategoryList(categoryId, page);
}

/**
 * 搜索
 */
async function search(params) {
    const keyword = params.keyword || params.wd || "";
    const page = toPage(params.page, 1);

    if (!keyword) {
        return { list: [], page: 1, pagecount: 0 };
    }

    logInfo("搜索", { keyword, page });
    return await searchContent(keyword, page);
}

/**
 * 详情
 */
async function detail(params) {
    const videoId = params.videoId;
    if (!videoId) {
        return { list: [] };
    }

    logInfo("请求详情", { videoId });
    const item = await getDetail(videoId);
    return { list: item ? [item] : [] };
}

/**
 * 播放解析
 */
async function play(params) {
    const playId = params.playId;
    if (!playId) {
        return { urls: [], parse: 0 };
    }

    logInfo("播放解析", { playId });
    return await getPlayUrl(playId);
}

// ========== 数据解析实现 ==========

/**
 * 获取首页/分类列表
 * @param {string|null} tid 分类ID，为 null 表示首页
 * @param {number} page 页码
 */
const getCategoryList = async (tid, page = 1) => {
    try {
        let url;
        const isHome = !tid;

        if (isHome) {
            url = hemaConfig.siteUrl;
        } else {
            url = `${hemaConfig.siteUrl}/browse/${tid}/${page}`;
        }

        const html = await requestHtml(url);
        const json = parseNextData(html);
        if (!json) return { list: [], page: 1, pagecount: 1 };

        const pageProps = json.props && json.props.pageProps ? json.props.pageProps : {};
        let videos = [];

        if (isHome) {
            // 首页：Banner + SEO Columns
            if (pageProps.bannerList) {
                pageProps.bannerList.forEach((banner) => {
                    if (banner.bookId) {
                        videos.push({
                            vod_id: `/drama/${banner.bookId}`,
                            vod_name: banner.bookName,
                            vod_pic: banner.coverWap,
                            vod_remarks: `${banner.statusDesc || ""} ${banner.totalChapterNum || ""}集`.trim()
                        });
                    }
                });
            }

            if (pageProps.seoColumnVos) {
                pageProps.seoColumnVos.forEach((column) => {
                    if (column.bookInfos) {
                        column.bookInfos.forEach((book) => {
                            if (book.bookId) {
                                videos.push({
                                    vod_id: `/drama/${book.bookId}`,
                                    vod_name: book.bookName,
                                    vod_pic: book.coverWap,
                                    vod_remarks: `${book.statusDesc || ""} ${book.totalChapterNum || ""}集`.trim()
                                });
                            }
                        });
                    }
                });
            }

            // 去重
            const seen = new Set();
            videos = videos.filter((v) => {
                const duplicate = seen.has(v.vod_id);
                seen.add(v.vod_id);
                return !duplicate;
            });
        } else {
            // 分类页
            const bookList = pageProps.bookList || [];
            bookList.forEach((book) => {
                if (book.bookId) {
                    videos.push({
                        vod_id: `/drama/${book.bookId}`,
                        vod_name: book.bookName,
                        vod_pic: book.coverWap,
                        vod_remarks: `${book.statusDesc || ""} ${book.totalChapterNum || ""}集`.trim()
                    });
                }
            });
        }

        return {
            list: videos,
            page: toPage(page, 1),
            pagecount: pageProps.pages || 1,
            limit: 20,
            total: 999
        };
    } catch (error) {
        logError("分类获取失败", error);
        return { list: [], page: 1, pagecount: 1 };
    }
};

/**
 * 搜索
 */
const searchContent = async (key, page = 1) => {
    try {
        const url = `${hemaConfig.siteUrl}/search?searchValue=${encodeURIComponent(key)}&page=${page}`;
        const html = await requestHtml(url);
        const json = parseNextData(html);
        if (!json) return { list: [], page: 1, pagecount: 1 };

        const pageProps = json.props && json.props.pageProps ? json.props.pageProps : {};
        const bookList = pageProps.bookList || [];
        const list = [];

        bookList.forEach((book) => {
            if (book.bookId) {
                list.push({
                    vod_id: `/drama/${book.bookId}`,
                    vod_name: book.bookName,
                    vod_pic: book.coverWap,
                    vod_remarks: `${book.statusDesc || ""} ${book.totalChapterNum || ""}集`.trim()
                });
            }
        });

        return {
            list,
            page: toPage(page, 1),
            pagecount: pageProps.pages || 1,
            limit: 20,
            total: 999
        };
    } catch (error) {
        logError("搜索失败", error);
        return { list: [], page: 1, pagecount: 1 };
    }
};

/**
 * 获取详情和剧集
 */
const getDetail = async (id) => {
    try {
        let pathId = id;
        if (!pathId.startsWith("/drama/")) {
            pathId = `/drama/${pathId}`;
        }

        const url = `${hemaConfig.siteUrl}${pathId}`;
        const html = await requestHtml(url);
        const json = parseNextData(html);
        if (!json) return null;

        const pageProps = json.props && json.props.pageProps ? json.props.pageProps : {};
        const bookInfo = pageProps.bookInfoVo || {};
        const chapterList = pageProps.chapterList || [];

        if (!bookInfo.bookId) return null;

        // 构建播放列表: 标题$播放地址
        const playList = [];
        const episodes = [];
        chapterList.forEach((chapter) => {
            const chapterId = chapter.chapterId;
            const chapterName = chapter.chapterName;

            // 尝试获取直链
            let videoUrl = null;
            if (chapter.chapterVideoVo) {
                const v = chapter.chapterVideoVo;
                if (v.mp4) videoUrl = v.mp4;
                else if (v.mp4720p) videoUrl = v.mp4720p;
                else if (v.vodMp4Url) videoUrl = v.vodMp4Url;
            }

            if (videoUrl && isDirectPlayable(videoUrl)) {
                playList.push(`${chapterName}$${videoUrl}`);
                episodes.push({ name: chapterName, playId: videoUrl });
            } else {
                // fallback：dramaId+chapterId
                const dramaId = pathId.replace("/drama/", "");
                const fallbackId = `${dramaId}+${chapterId}`;
                playList.push(`${chapterName}$${fallbackId}`);
                episodes.push({ name: chapterName, playId: fallbackId });
            }
        });

        return {
            vod_id: pathId,
            vod_name: bookInfo.title || bookInfo.bookName,
            type_name: (bookInfo.categoryList || []).map((c) => c.name).join(","),
            vod_pic: bookInfo.coverWap,
            vod_area: bookInfo.countryName,
            vod_remarks: `${bookInfo.statusDesc || ""} ${bookInfo.totalChapterNum || ""}集`.trim(),
            vod_actor: (bookInfo.performerList || []).map((p) => p.name).join(", "),
            vod_content: bookInfo.introduction,
            vod_play_from: "河马剧场",
            vod_play_url: playList.join("#"),
            vod_play_sources: [
                {
                    name: "河马剧场",
                    episodes: episodes
                }
            ]
        };
    } catch (error) {
        logError("详情解析失败", error);
        return null;
    }
};

/**
 * 获取播放链接
 * - 直链直接返回
 * - 否则解析 episode 页面获取直链
 */
const getPlayUrl = async (id) => {
    try {
        // 直链直接返回
        if (isDirectPlayable(id)) {
            return { parse: 0, urls: [{ name: "播放", url: id }], header: hemaConfig.headers };
        }

        // 解析参数: dramaId+chapterId
        const parts = id.split("+");
        if (parts.length < 2) {
            return { parse: 0, urls: [] };
        }

        const dramaId = parts[0];
        const chapterId = parts[1];
        const url = `${hemaConfig.siteUrl}/episode/${dramaId}/${chapterId}`;
        const html = await requestHtml(url);

        // 方法1: 解析 __NEXT_DATA__
        const json = parseNextData(html);
        if (json) {
            const videoInfo = json.props && json.props.pageProps && json.props.pageProps.chapterInfo
                ? json.props.pageProps.chapterInfo.chapterVideoVo || {}
                : {};
            const videoUrl = videoInfo.mp4 || videoInfo.mp4720p || videoInfo.vodMp4Url;
            if (videoUrl) {
                return { parse: 0, urls: [{ name: "播放", url: videoUrl }], header: hemaConfig.headers };
            }
        }

        // 方法2: 正则兜底
        const mp4Matches = html.match(/(https?:\/\/[^"']+\.mp4)/);
        if (mp4Matches && mp4Matches[1]) {
            return { parse: 0, urls: [{ name: "播放", url: mp4Matches[1] }], header: hemaConfig.headers };
        }

        return { parse: 0, urls: [] };
    } catch (error) {
        logError("播放解析失败", error);
        return { parse: 0, urls: [] };
    }
};

// ========== 导出模块 ==========
module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
