// @name 盘搜分组
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，只支持tvbox接口
// @version 1.0.6
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/盘搜分组.js

/**
* OmniBox 网盘爬虫脚本 - 分组版本
*
* 此脚本在原有盘搜模板基础上，增加了网盘分组功能
* 搜索时先展示各个网盘的分类，点击后再展示该网盘的具体搜索结果
*
* 配置说明:
* 1. 配置盘搜API地址到环境变量 PANSOU_API 中,或直接修改下面的 PANSOU_API 常量
* 2. (可选)配置盘搜频道到环境变量 PANSOU_CHANNELS 中
* 3. (可选)配置盘搜插件到环境变量 PANSOU_PLUGINS 中
* 4. (可选)配置网盘类型过滤到环境变量 PANSOU_CLOUD_TYPES 中(如:baidu,aliyun,quark)
* 5. (可选)配置 PanCheck API 地址到环境变量 PANCHECK_API 中,用于过滤无效链接
* 6. (可选)配置 PanCheck 是否启用到环境变量 PANCHECK_ENABLED 中(true/false,默认:如果配置了 PANCHECK_API 则启用)
* 7. (可选)配置 PanCheck 选择的平台到环境变量 PANCHECK_PLATFORMS 中(如:baidu,aliyun,quark)
* 8. (可选)配置 PANSOU_FILTER 中(如:{"include":["合集","全集"],"exclude":["预告"]})
*/

const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const PANSOU_API = process.env.PANSOU_API || "";
const PANSOU_CHANNELS = process.env.PANSOU_CHANNELS || "";
const PANSOU_PLUGINS = process.env.PANSOU_PLUGINS || "";
const PANSOU_CLOUD_TYPES = process.env.PANSOU_CLOUD_TYPES || "";
const PANSOU_FILTER = process.env.PANSOU_FILTER || { "include": [""], "exclude": [] };
const PANCHECK_API = process.env.PANCHECK_API || "";
const PANCHECK_ENABLED = true;
const PANCHECK_PLATFORMS = process.env.PANCHECK_PLATFORMS || "";

// 网盘类型匹配配置: 使用分号分隔，例如 quark;uc
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc").split(';').map((t) => t.trim()).filter(Boolean);
// 线路名称配置: 使用分号分隔，例如 本地代理;服务端代理;直连
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连").split(';').map((s) => s.trim()).filter(Boolean);
// ==================== 配置区域结束 ====================  

// 网盘类型映射
const PAN_TYPES = {
    quark: "quark",
    uc: "uc",
    pikpak: "pikpak",
    tianyi: "tianyi",
    mobile: "mobile",
    "115": "115",
    baidu: "baidu",
    aliyun: "aliyun",
    xunlei: "xunlei",
    "123": "123"
};

// 网盘图标
const PAN_PICS = {
    aliyun: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/ali.jpg",
    quark: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/quark.png",
    uc: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/uc.png",
    pikpak: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/pikpak.jpg",
    xunlei: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/thunder.png",
    "123": "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/123.png",
    tianyi: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/189.png",
    mobile: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/139.jpg",
    "115": "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/115.jpg",
    baidu: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/baidu.jpg"
};

// 网盘名称
const PAN_NAMES = {
    quark: "夸克网盘",
    uc: "UC网盘",
    pikpak: "PikPak",
    tianyi: "天翼网盘",
    mobile: "移动云盘",
    "115": "115网盘",
    baidu: "百度网盘",
    aliyun: "阿里云盘",
    xunlei: "迅雷网盘",
    "123": "123网盘"
};

// 画质关键词（按优先级排序）
const QUALITY_KEYWORDS = [
    'HDR', '杜比视界', 'DV',
    'REMUX', 'HQ', "臻彩", '高码', '高画质',
    '60FPS', '60帧', '高帧率', '60HZ',
    "4K", "2160P",
    "SDR", "1080P", "HD", "高清",
    "720P", "标清"
];

// 完结关键词
const COMPLETED_KEYWORDS = ["完结", "全集", "已完成", "全"];

/**
* 发送 HTTP 请求到盘搜API
*/
async function requestPansouAPI(params = {}) {
    if (!PANSOU_API) {
        throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
    }

    const url = new URL(`${PANSOU_API}/api/search`);
    const body = {};
    body.kw = params.keyword || "";
    body.refresh = false;
    body.res = "merge";
    body.src = "all";

    if (PANSOU_CHANNELS) {
        body.channels = PANSOU_CHANNELS.split(',');
    }
    if (PANSOU_PLUGINS) {
        body.plugins = PANSOU_PLUGINS.split(',');
    }
    if (params.cloud_types) {
        body.cloud_types = params.cloud_types;
    } else if (PANSOU_CLOUD_TYPES) {
        body.cloud_types = PANSOU_CLOUD_TYPES.split(',');
    }
    if (PANSOU_FILTER) {
        body.filter = PANSOU_FILTER;
    }

    OmniBox.log("info", `请求盘搜API: ${JSON.stringify(body)}`);

    try {
        const response = await OmniBox.request(url.toString(), {
            method: "POST",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: body
        });

        if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}: ${response.body?.substring(0, 200) || ""}`);
        }

        if (!response.body) {
            throw new Error("盘搜API返回空响应");
        }

        const data = JSON.parse(response.body);
        return data;
    } catch (error) {
        OmniBox.log("error", `请求盘搜API失败: ${error.message}`);
        throw error;
    }
}

/**
* 调用 PanCheck API 检测链接有效性
*/
async function checkLinksWithPanCheck(links) {
    if (!PANCHECK_ENABLED || !PANCHECK_API || links.length === 0) {
        return new Set();
    }

    try {
        OmniBox.log("info", `开始调用 PanCheck 检测链接,链接数量: ${links.length}`);

        const requestBody = { links: links };

        if (PANCHECK_PLATFORMS) {
            const platforms = PANCHECK_PLATFORMS.split(",")
                .map((p) => p.trim())
                .filter((p) => p);
            if (platforms.length > 0) {
                requestBody.selected_platforms = platforms;
            }
        }

        const apiUrl = PANCHECK_API.replace(/\/$/, "");
        const checkURL = `${apiUrl}/api/v1/links/check`;

        const response = await OmniBox.request(checkURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify(requestBody),
        });

        if (response.statusCode !== 200) {
            OmniBox.log("warn", `PanCheck API 响应错误: ${response.statusCode}`);
            return new Set();
        }

        const data = JSON.parse(response.body);
        const invalidLinks = data.invalid_links || [];
        const validLinks = data.valid_links || [];

        OmniBox.log("info", `PanCheck 检测完成,有效链接: ${validLinks.length}, 无效链接: ${invalidLinks.length}`);

        return new Set(invalidLinks);
    } catch (error) {
        OmniBox.log("warn", `PanCheck 链接检测失败: ${error.message}`);
        return new Set();
    }
}

/**
* 从盘搜结果中提取所有链接
*/
function extractLinksFromSearchData(data) {
    const links = [];

    if (!data || !data.data) {
        return links;
    }

    const mergedByType = data.data.merged_by_type || {};

    for (const [driveType, driveResults] of Object.entries(mergedByType)) {
        if (!Array.isArray(driveResults)) {
            continue;
        }

        for (const item of driveResults) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const shareURL = String(item.url || item.URL || "");
            if (shareURL) {
                links.push(shareURL);
            }
        }
    }

    return links;
}

/**
* 计算画质得分
*/
function getQualityScore(name) {
    const upper = name.toUpperCase();
    let score = 0, cnt = 0;
    for (let i = 0; i < QUALITY_KEYWORDS.length; i++) {
        if (upper.includes(QUALITY_KEYWORDS[i].toUpperCase())) {
            score += QUALITY_KEYWORDS.length - i;
            cnt++;
        }
    }
    return score + cnt;
}

/**
* 计算关键词数量
*/
function getCount(name, arr) {
    const upper = name.toUpperCase();
    let c = 0;
    for (const kw of arr) {
        if (upper.includes(kw.toUpperCase())) c++;
    }
    return c;
}

/**
* 格式化盘搜结果（分组模式）
*/
async function formatDriveSearchResultsGrouped(data, keyword, validLinksSet) {
    OmniBox.log("info", `开始格式化盘搜结果（分组模式）`);

    if (!data || !data.data) {
        return [];
    }

    const mergedByType = data.data.merged_by_type || {};
    const panCounts = {};

    // 统计每个网盘的有效结果数量
    for (const [driveType, driveResults] of Object.entries(mergedByType)) {
        if (!Array.isArray(driveResults)) {
            continue;
        }

        const count = driveResults.filter(item =>
            validLinksSet.has(String(item.url || item.URL || ""))
        ).length;

        if (count > 0) {
            panCounts[driveType] = count;
        }
    }

    const results = [];

    // 生成网盘分类列表
    for (const [driveType, count] of Object.entries(panCounts)) {
        const pic = PAN_PICS[driveType] || "";
        const name = PAN_NAMES[driveType] || driveType;

        results.push({
            vod_id: `${driveType}|${keyword}`,
            vod_name: name,
            vod_pic: pic,
            type_id: "pan_category",
            type_name: "网盘分类",
            vod_remarks: `${count}条结果`,
            vod_tag: "folder",
        });
    }

    OmniBox.log("info", `格式化完成（分组模式）,分类数量: ${results.length}`);
    return results;
}

/**
* 格式化盘搜结果（具体网盘）
*/
async function formatDriveSearchResultsSpecific(data, keyword, targetPanType, validLinksSet) {
    OmniBox.log("info", `开始格式化盘搜结果（具体网盘: ${targetPanType}）`);

    if (!data || !data.data) {
        return [];
    }

    const mergedByType = data.data.merged_by_type || {};
    const driveResults = mergedByType[targetPanType] || [];

    if (!Array.isArray(driveResults)) {
        return [];
    }

    const results = [];
    const pic = PAN_PICS[targetPanType] || "";

    for (const item of driveResults) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const shareURL = String(item.url || item.URL || "");
        const note = String(item.note || item.Note || "");
        const datetime = String(item.datetime || item.Datetime || "");
        const source = item.source ? String(item.source).replace(/plugin:/gi, "plg:") : "";

        if (!shareURL) {
            continue;
        }

        // 只保留有效链接
        if (!validLinksSet.has(shareURL)) {
            continue;
        }

        const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);

        // 构建时间显示
        let timeDisplay = "";
        if (datetime) {
            try {
                const date = new Date(datetime);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = String(date.getFullYear()).slice(-2);
                timeDisplay = `${month}${day}${year}`;
            } catch (e) {
                timeDisplay = "";
            }
        }

        const vodId = `${shareURL}|${keyword || ""}|${note}`;
        const vodName = note || shareURL;
        const remarks = source ? `${source} | ${timeDisplay}` : timeDisplay;

        results.push({
            vod_id: vodId,
            vod_name: vodName,
            vod_pic: pic || driveInfo.iconUrl,
            type_id: targetPanType,
            type_name: driveInfo.displayName,
            vod_remarks: remarks,
            vod_time: datetime,
            _datetime: datetime, // 用于排序
        });
    }

    // 排序逻辑
    results.sort((a, b) => {
        // 1. 按画质得分排序
        const qa = getQualityScore(a.vod_name);
        const qb = getQualityScore(b.vod_name);
        if (qa !== qb) return qb - qa;

        // 2. 按完结关键词排序
        const ca = getCount(a.vod_name, COMPLETED_KEYWORDS);
        const cb = getCount(b.vod_name, COMPLETED_KEYWORDS);
        if (ca !== cb) return cb - ca;

        // 3. 按画质关键词数量排序
        const qa2 = getCount(a.vod_name, QUALITY_KEYWORDS);
        const qb2 = getCount(b.vod_name, QUALITY_KEYWORDS);
        if (qa2 !== qb2) return qb2 - qa2;

        // 4. 按时间排序
        const timeA = a._datetime ? new Date(a._datetime).getTime() : 0;
        const timeB = b._datetime ? new Date(b._datetime).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;

        return 0;
    });

    // 移除临时排序字段
    results.forEach(item => delete item._datetime);

    OmniBox.log("info", `格式化完成（具体网盘）,结果数量: ${results.length}`);
    return results;
}

/**
* 判断是否为视频文件
*/
function isVideoFile(file) {
    if (!file || !file.file_name) {
        return false;
    }

    const fileName = file.file_name.toLowerCase();
    const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];

    for (const ext of videoExtensions) {
        if (fileName.endsWith(ext)) {
            return true;
        }
    }

    if (file.format_type) {
        const formatType = String(file.format_type).toLowerCase();
        if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) {
            return true;
        }
    }

    return false;
}

/**
* 递归获取所有视频文件
*/
async function getAllVideoFiles(shareURL, files, pdirFid) {
    const videoFiles = [];

    for (const file of files) {
        if (file.file && isVideoFile(file)) {
            videoFiles.push(file);
        } else if (file.dir) {
            try {
                const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
                if (subFileList && subFileList.files && Array.isArray(subFileList.files)) {
                    const subVideoFiles = await getAllVideoFiles(shareURL, subFileList.files, file.fid);
                    videoFiles.push(...subVideoFiles);
                }
            } catch (error) {
                OmniBox.log("warn", `获取子目录文件失败: ${error.message}`);
            }
        }
    }

    return videoFiles;
}

/**
* 构建刮削后的文件名
*/
function buildScrapedFileName(scrapeData, mapping, originalFileName) {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalFileName;
    }

    if (scrapeData && scrapeData.episodes && Array.isArray(scrapeData.episodes)) {
        for (const episode of scrapeData.episodes) {
            if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
                if (episode.name) {
                    return `${episode.episodeNumber}.${episode.name}`;
                }
                break;
            }
        }
    }

    return originalFileName;
}

/**
* 首页
*/
async function home(params) {
    try {
        const classes = [
            {
                type_id: "history",
                type_name: "最近观看",
            },
            {
                type_id: "favorite",
                type_name: "我的收藏",
            },
        ];

        try {
            const tags = await OmniBox.getSourceFavoriteTags();
            for (const tag of tags) {
                if (tag) {
                    classes.push({
                        type_id: tag,
                        type_name: tag,
                    });
                }
            }
        } catch (error) {
            OmniBox.log("warn", `获取收藏标签失败: ${error.message}`);
        }

        let list = [];
        try {
            const categoryData = await OmniBox.getSourceCategoryData("favorite", 1, 20);
            if (categoryData && categoryData.list && Array.isArray(categoryData.list)) {
                list = categoryData.list.map((item) => ({
                    vod_id: item.vod_id || item.VodID || "",
                    vod_name: item.vod_name || item.VodName || "",
                    vod_pic: item.vod_pic || item.VodPic || "",
                    type_id: item.type_id || item.TypeID || "",
                    type_name: item.type_name || item.TypeName || "",
                    vod_year: item.vod_year || item.VodYear || "",
                    vod_remarks: item.vod_remarks || item.VodRemarks || "",
                    vod_time: item.vod_time || item.VodTime || "",
                    vod_play_from: item.vod_play_from || item.VodPlayFrom || "",
                    vod_play_url: item.vod_play_url || item.VodPlayURL || "",
                    vod_douban_score: item.vod_douban_score || item.VodDoubanScore || "",
                }));
            }
        } catch (error) {
            OmniBox.log("warn", `获取收藏数据失败: ${error.message}`);
        }

        return {
            class: classes,
            list: list,
        };
    } catch (error) {
        OmniBox.log("error", `首页接口失败: ${error.message}`);
        return {
            class: [],
            list: [],
        };
    }
}

/**
* 分类
*/
async function category(params) {
    try {
        const categoryType = params.categoryId || params.type_id || "";
        const page = parseInt(params.page || "1", 10);
        const pageSize = 20;

        OmniBox.log("info", `分类接口调用,categoryType: ${categoryType}, page: ${page}`);

        // 检查是否是网盘分类的ID (格式: panType|keyword)
        if (categoryType.includes('|')) {
            const [panType, keyword] = categoryType.split('|');
            OmniBox.log("info", `检测到网盘分类跳转: panType=${panType}, keyword=${keyword}`);

            // 调用搜索接口，但指定特定网盘类型
            return await searchSpecificPan(keyword, page, panType);
        }

        if (!categoryType) {
            OmniBox.log("warn", "分类类型为空");
            return {
                list: [],
                page: 1,
                pagecount: 0,
                total: 0,
            };
        }

        const categoryData = await OmniBox.getSourceCategoryData(categoryType, page, pageSize);

        if (!categoryData || !categoryData.list || !Array.isArray(categoryData.list)) {
            return {
                list: [],
                page: page,
                pagecount: categoryData?.pageCount || 0,
                total: categoryData?.total || 0,
            };
        }

        const list = categoryData.list.map((item) => {
            const vodId = item.vod_id || "";
            const shareURL = vodId;
            const playFrom = shareURL;
            const playURL = "";

            return {
                vod_id: vodId,
                vod_name: item.vod_name || "",
                vod_pic: item.vod_pic || "",
                type_id: categoryType,
                type_name: item.type_name || "网盘资源",
                vod_year: item.vod_year || "",
                vod_remarks: item.vod_remarks || "",
                vod_play_from: playFrom,
                vod_play_url: playURL,
            };
        });

        return {
            list: list,
            page: page,
            pagecount: categoryData.pageCount || 0,
            total: categoryData.total || 0,
        };
    } catch (error) {
        OmniBox.log("error", `分类接口失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 搜索特定网盘
*/
async function searchSpecificPan(keyword, page, panType) {
    try {
        if (!PANSOU_API) {
            throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
        }

        // 只在第一页时进行搜索，其他页返回空列表
        if (page > 1) {
            return {
                list: [],
                page: page,
                pagecount: 1,
                total: 0,
            };
        }

        OmniBox.log("info", `搜索特定网盘: panType=${panType}, keyword=${keyword}`);

        // 调用盘搜API，指定网盘类型
        const response = await requestPansouAPI({
            keyword: keyword,
            cloud_types: [panType]
        });

        // 提取链接并进行检测
        const links = extractLinksFromSearchData(response);
        OmniBox.log("info", `提取到链接数量: ${links.length}`);

        let validLinksSet = new Set(links);
        if (PANCHECK_ENABLED && PANCHECK_API && links.length > 0) {
            try {
                const invalidLinksSet = await checkLinksWithPanCheck(links);
                validLinksSet = new Set(links.filter(link => !invalidLinksSet.has(link)));
                OmniBox.log("info", `链接检测完成,有效链接: ${validLinksSet.size}, 无效链接: ${invalidLinksSet.size}`);
            } catch (error) {
                OmniBox.log("warn", `PanCheck 处理失败: ${error.message}`);
            }
        }

        // 格式化结果（具体网盘模式）
        const list = await formatDriveSearchResultsSpecific(response, keyword, panType, validLinksSet);

        return {
            list: list,
            page: page,
            pagecount: 1,
            total: list.length,
        };
    } catch (error) {
        OmniBox.log("error", `搜索特定网盘失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 搜索
*/
async function search(params) {
    try {
        OmniBox.log("info", `搜索接口调用,参数: ${JSON.stringify(params)}`);

        const keyword = params.keyword || "";
        const page = parseInt(params.page || "1", 10);

        // 只在第一页时进行搜索，其他页返回空列表
        if (page > 1) {
            return {
                list: [],
                page: page,
                pagecount: 1,
                total: 0,
            };
        }

        if (!keyword) {
            return {
                list: [],
                page: page,
                pagecount: 0,
                total: 0,
            };
        }

        if (!PANSOU_API) {
            throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
        }

        // 调用盘搜API
        const response = await requestPansouAPI({ keyword });

        // 提取链接并进行检测
        const links = extractLinksFromSearchData(response);
        OmniBox.log("info", `提取到链接数量: ${links.length}`);

        let validLinksSet = new Set(links);
        if (PANCHECK_ENABLED && PANCHECK_API && links.length > 0) {
            try {
                const invalidLinksSet = await checkLinksWithPanCheck(links);
                validLinksSet = new Set(links.filter(link => !invalidLinksSet.has(link)));
                OmniBox.log("info", `链接检测完成,有效链接: ${validLinksSet.size}, 无效链接: ${invalidLinksSet.size}`);
            } catch (error) {
                OmniBox.log("warn", `PanCheck 处理失败: ${error.message}`);
            }
        }

        // 格式化结果（分组模式 - 显示网盘分类列表）
        const list = await formatDriveSearchResultsGrouped(response, keyword, validLinksSet);

        return {
            list: list,
            page: page,
            pagecount: 1,
            total: list.length,
        };
    } catch (error) {
        OmniBox.log("error", `搜索接口失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 详情
*/
async function detail(params) {
    try {
        OmniBox.log("info", `详情接口调用,参数: ${JSON.stringify(params)}`);

        const videoId = params.videoId || "";
        if (!videoId) {
            throw new Error("视频ID不能为空");
        }

        const source = params.source || "";

        const parts = videoId.split("|");
        const shareURL = parts[0] || "";
        const keyword = parts[1] || "";
        const note = parts[2] || "";

        if (!shareURL) {
            throw new Error("分享链接不能为空");
        }

        OmniBox.log("info", `解析参数: shareURL=${shareURL}, keyword=${keyword}, note=${note}`);

        const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
        const displayName = driveInfo.displayName;

        const fileList = await OmniBox.getDriveFileList(shareURL, "0");

        if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
            throw new Error("获取文件列表失败");
        }

        const allVideoFiles = await getAllVideoFiles(shareURL, fileList.files, "0");

        if (allVideoFiles.length === 0) {
            throw new Error("未找到视频文件");
        }

        OmniBox.log("info", `递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

        let scrapingSuccess = false;

        try {
            const videoFilesForScraping = allVideoFiles.map((file) => {
                const fileId = file.fid || file.file_id || "";
                const formattedFileId = fileId ? `${shareURL}|${fileId}` : fileId;
                return {
                    ...file,
                    fid: formattedFileId,
                    file_id: formattedFileId,
                };
            });

            const scrapingResult = await OmniBox.processScraping(shareURL, keyword, note, videoFilesForScraping);
            scrapingSuccess = true;
        } catch (error) {
            OmniBox.log("error", `刮削处理失败: ${error.message}`);
        }

        let scrapeData = null;
        let videoMappings = [];
        try {
            const metadata = await OmniBox.getScrapeMetadata(shareURL);

            scrapeData = metadata.scrapeData || null;
            videoMappings = metadata.videoMappings || [];
            const scrapeType = metadata.scrapeType || "";

            if (scrapeData) {
                OmniBox.log("info", `获取到刮削数据,标题: ${scrapeData.title || "未知"}, 类型: ${scrapeType || "未知"}`);
            }
        } catch (error) {
            OmniBox.log("error", `获取元数据失败: ${error.message}`);
        }

        const playSources = [];

        // 确定播放源列表
        let sourceNames = ["直连"];
        const targetDriveTypes = DRIVE_TYPE_CONFIG;
        const configSourceNames = SOURCE_NAMES_CONFIG;

        if (targetDriveTypes.includes(driveInfo.driveType)) {
            sourceNames = [...configSourceNames];
            OmniBox.log("info", `${displayName} 匹配 DRIVE_TYPE_CONFIG，线路设置为: ${sourceNames.join(", ")}`);

            if (source === "web") {
                sourceNames = sourceNames.filter((name) => name !== "本地代理");
                OmniBox.log("info", "来源为网页端，已过滤掉\"本地代理\"线路");
            }
        }

        for (const sourceName of sourceNames) {
            const episodes = [];

            for (const file of allVideoFiles) {
                let fileName = file.file_name || "";
                const fileId = file.fid || "";
                const fileSize = file.size || file.file_size || 0;

                const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

                let matchedMapping = null;
                if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
                    for (const mapping of videoMappings) {
                        if (mapping && mapping.fileId === formattedFileId) {
                            matchedMapping = mapping;
                            const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
                            if (newFileName && newFileName !== fileName) {
                                fileName = newFileName;
                            }
                            break;
                        }
                    }
                }

                const episode = {
                    name: fileName,
                    playId: fileId ? `${shareURL}|${fileId}` : "",
                    size: fileSize > 0 ? fileSize : undefined,
                };

                if (matchedMapping) {
                    if (matchedMapping.seasonNumber !== undefined && matchedMapping.seasonNumber !== null) {
                        episode._seasonNumber = matchedMapping.seasonNumber;
                    }
                    if (matchedMapping.episodeNumber !== undefined && matchedMapping.episodeNumber !== null) {
                        episode._episodeNumber = matchedMapping.episodeNumber;
                    }

                    if (matchedMapping.episodeName) episode.episodeName = matchedMapping.episodeName;
                    if (matchedMapping.episodeOverview) episode.episodeOverview = matchedMapping.episodeOverview;
                    if (matchedMapping.episodeAirDate) episode.episodeAirDate = matchedMapping.episodeAirDate;
                    if (matchedMapping.episodeStillPath) episode.episodeStillPath = matchedMapping.episodeStillPath;
                    if (matchedMapping.episodeVoteAverage !== undefined) episode.episodeVoteAverage = matchedMapping.episodeVoteAverage;
                    if (matchedMapping.episodeRuntime !== undefined) episode.episodeRuntime = matchedMapping.episodeRuntime;
                }

                if (episode.name && episode.playId) {
                    episodes.push(episode);
                }
            }

            if (scrapeData && episodes.length > 0) {
                const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
                if (hasEpisodeNumber) {
                    episodes.sort((a, b) => {
                        const seasonA = a._seasonNumber !== undefined ? a._seasonNumber : 0;
                        const seasonB = b._seasonNumber !== undefined ? b._seasonNumber : 0;
                        if (seasonA !== seasonB) {
                            return seasonA - seasonB;
                        }
                        const episodeA = a._episodeNumber !== undefined ? a._episodeNumber : 0;
                        const episodeB = b._episodeNumber !== undefined ? b._episodeNumber : 0;
                        return episodeA - episodeB;
                    });
                }
            }

            if (episodes.length > 0) {
                let finalSourceName = sourceName;
                if (DRIVE_TYPE_CONFIG.includes(driveInfo.driveType)) {
                    finalSourceName = `${displayName}-${sourceName}`;
                }

                playSources.push({
                    name: finalSourceName,
                    episodes: episodes,
                });
            }
        }

        const displayNameFromFileList = fileList.displayName || fileList.display_name || "";
        let vodName = displayNameFromFileList || note || keyword || shareURL;
        let vodPic = "";
        let vodYear = "";
        let vodArea = "";
        let vodActor = "";
        let vodDirector = "";
        let vodContent = `网盘资源,共${allVideoFiles.length}个视频文件`;
        let vodDoubanScore = "";

        if (scrapeData) {
            if (scrapeData.title) vodName = scrapeData.title;
            if (scrapeData.posterPath) vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            if (scrapeData.releaseDate) vodYear = scrapeData.releaseDate.substring(0, 4) || "";
            if (scrapeData.overview) vodContent = scrapeData.overview;
            if (scrapeData.voteAverage) vodDoubanScore = scrapeData.voteAverage.toFixed(1);

            if (scrapeData.credits) {
                if (scrapeData.credits.cast && Array.isArray(scrapeData.credits.cast)) {
                    vodActor = scrapeData.credits.cast
                        .slice(0, 5)
                        .map((cast) => cast.name || cast.character || "")
                        .filter((name) => name)
                        .join(",");
                }
                if (scrapeData.credits.crew && Array.isArray(scrapeData.credits.crew)) {
                    const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing");
                    if (directors.length > 0) {
                        vodDirector = directors
                            .slice(0, 3)
                            .map((director) => director.name || "")
                            .filter((name) => name)
                            .join(",");
                    }
                }
            }
        }

        return {
            list: [
                {
                    vod_id: videoId,
                    vod_name: vodName,
                    vod_pic: vodPic,
                    type_name: displayName,
                    vod_year: vodYear,
                    vod_area: vodArea,
                    vod_remarks: displayName,
                    vod_actor: vodActor,
                    vod_director: vodDirector,
                    vod_content: vodContent,
                    vod_play_sources: playSources,
                    vod_douban_score: vodDoubanScore,
                },
            ],
        };
    } catch (error) {
        OmniBox.log("error", `详情接口失败: ${error.message}`);
        return {
            list: [],
        };
    }
}

/**
* 播放
*/
async function play(params) {
    try {
        let flag = params.flag || "";
        const playId = params.playId || "";
        const source = params.source || "";

        if (!playId) {
            throw new Error("播放参数不能为空");
        }

        const parts = playId.split("|");
        if (parts.length < 2) {
            throw new Error("播放参数格式错误,应为:分享链接|文件ID");
        }
        const shareURL = parts[0] || "";
        const fileId = parts[1] || "";

        if (!shareURL || !fileId) {
            throw new Error("分享链接或文件ID不能为空");
        }

        let danmakuList = [];
        let scrapeTitle = "";
        let scrapePic = "";
        let episodeNumber = null;
        let episodeName = params.episodeName || "";
        try {
            const metadata = await OmniBox.getScrapeMetadata(shareURL);
            if (metadata && metadata.scrapeData && metadata.videoMappings) {
                const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

                let matchedMapping = null;
                for (const mapping of metadata.videoMappings) {
                    if (mapping.fileId === formattedFileId) {
                        matchedMapping = mapping;
                        break;
                    }
                }

                if (matchedMapping && metadata.scrapeData) {
                    const scrapeData = metadata.scrapeData;

                    scrapeTitle = scrapeData.title || "";
                    if (scrapeData.posterPath) {
                        scrapePic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
                    }

                    if (matchedMapping.episodeNumber) {
                        episodeNumber = matchedMapping.episodeNumber;
                    }
                    if (matchedMapping.episodeName && !episodeName) {
                        episodeName = matchedMapping.episodeName;
                    }

                    let fileName = "";
                    const scrapeType = metadata.scrapeType || "";
                    if (scrapeType === "movie") {
                        fileName = scrapeData.title || "";
                    } else {
                        const title = scrapeData.title || "";
                        const seasonAirYear = scrapeData.seasonAirYear || "";
                        const seasonNumber = matchedMapping.seasonNumber || 1;
                        const epNum = matchedMapping.episodeNumber || 1;
                        fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
                    }

                    if (fileName) {
                        danmakuList = await OmniBox.getDanmakuByFileName(fileName);
                    }
                }
            }
        } catch (error) {
            OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
        }

        // 线路解析: 默认网页端走服务端代理，其它直连；若 flag 含前缀，取最后一段
        let routeType = source === "web" ? "服务端代理" : "直连";
        if (flag) {
            if (flag.includes("-")) {
                const parts = flag.split("-");
                routeType = parts[parts.length - 1];
            } else {
                routeType = flag;
            }
        }

        const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);

        OmniBox.log("info", `使用线路: ${routeType}`);

        if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
            throw new Error("无法获取播放地址");
        }

        try {
            const vodId = params.vodId || shareURL;
            if (vodId) {
                const title = params.title || scrapeTitle || shareURL;
                const pic = params.pic || scrapePic || "";

                const added = await OmniBox.addPlayHistory({
                    vodId: vodId,
                    title: title,
                    pic: pic,
                    episode: playId,
                    sourceId: shareURL,
                    episodeNumber: episodeNumber,
                    episodeName: episodeName,
                });

                if (added) {
                    OmniBox.log("info", `已添加观看记录: ${title}`);
                }
            }
        } catch (error) {
            OmniBox.log("warn", `添加观看记录失败: ${error.message}`);
        }

        const urlList = playInfo.url || [];

        let urlsResult = [];
        for (const item of urlList) {
            urlsResult.push({
                name: item.name || "播放",
                url: item.url,
            });
        }

        let header = playInfo.header || {};

        let finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

        return {
            urls: urlsResult,
            flag: shareURL,
            header: header,
            parse: 0,
            danmaku: finalDanmakuList,
        };
    } catch (error) {
        OmniBox.log("error", `播放接口失败: ${error.message}`);
        return {
            urls: [],
            flag: params.flag || "",
            header: {},
            danmaku: [],
        };
    }
}

// 导出接口
module.exports = {
    home,
    category,
    search,
    detail,
    play,
};

// 使用公共 runner 处理标准输入/输出
const runner = require("spider_runner");
runner.run(module.exports);
