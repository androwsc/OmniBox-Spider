// @name 博看听书
// @author 
// @description 
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/听书/博看听书.js

/**
 * OmniBox 听书源脚本：博看听书
 *
 * 说明：
 * 1. 本脚本将原 T4 路由式写法改造为 OmniBox 标准 5 方法：home/category/search/detail/play
 * 2. 数据来源为博看官方接口，主要包含分类浏览、关键词搜索、专辑详情与章节直链播放
 * 3. 风格与注释结构参照采集站模板，便于后续复用和维护
 */

const OmniBox = require("omnibox_sdk");

// ==================== 站点配置区域 ====================
// 主 API（分类列表、专辑章节等）
const API_HOST = "https://api.bookan.com.cn";

// 搜索 API（ES 检索服务）
const SEARCH_HOST = "https://es.bookan.com.cn";

// 博看实例 ID（当前脚本固定使用该实例）
const INSTANCE_ID = "25304";

// 默认请求头
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
  "Accept": "application/json, text/plain, */*",
};

// 固定分类（按你原脚本配置保留）
const CATEGORY_CONFIG = {
  class: [
    { type_id: "1305", type_name: "少年读物" },
    { type_id: "1304", type_name: "儿童文学" },
    { type_id: "1320", type_name: "国学经典" },
    { type_id: "1306", type_name: "文艺少年" },
    { type_id: "1309", type_name: "育儿心经" },
    { type_id: "1310", type_name: "心理哲学" },
    { type_id: "1307", type_name: "青春励志" },
    { type_id: "1312", type_name: "历史小说" },
    { type_id: "1303", type_name: "故事会" },
    { type_id: "1317", type_name: "音乐戏剧" },
    { type_id: "1319", type_name: "相声评书" },
  ],
  // 首页分类排序（仅影响 class 展示顺序）
  forceOrder: [
    "相声评书",
    "国学经典",
    "故事会",
    "历史小说",
    "音乐戏剧",
    "青春励志",
    "少年读物",
    "儿童文学",
    "文艺少年",
    "育儿心经",
    "心理哲学",
  ],
};
// ==================== 配置区域结束 ====================

/**
 * 输出 info 日志
 * @param {string} message 日志文本
 * @param {Object|null} data 附带数据
 */
function logInfo(message, data = null) {
  const text = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[博看听书] ${text}`);
}

/**
 * 输出 error 日志
 * @param {string} message 日志文本
 * @param {any} error 错误对象
 */
function logError(message, error) {
  OmniBox.log("error", `[博看听书] ${message}: ${error?.message || String(error)}`);
}

/**
 * 安全转换为整数
 * @param {any} value 输入值
 * @param {number} defaultValue 默认值
 * @returns {number}
 */
function toInt(value, defaultValue = 0) {
  const num = parseInt(String(value ?? ""), 10);
  return Number.isNaN(num) ? defaultValue : num;
}

/**
 * 构建 URL 查询串
 * @param {string} baseURL 基础地址
 * @param {Object} params 查询参数
 * @returns {string}
 */
function buildURL(baseURL, params = {}) {
  const url = new URL(baseURL);
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.append(key, String(value));
    }
  });
  return url.toString();
}

/**
 * 通用 GET 请求（返回 JSON）
 * @param {string} url 完整请求地址
 * @returns {Promise<Object|null>}
 */
async function requestJSON(url) {
  try {
    const response = await OmniBox.request(url, {
      method: "GET",
      headers: DEFAULT_HEADERS,
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }

    return JSON.parse(response.body || "{}");
  } catch (error) {
    logError(`请求失败 ${url}`, error);
    return null;
  }
}

/**
 * 将博看列表项格式化为 OmniBox 通用视频结构
 * @param {Object} item 博看原始条目
 * @param {string} fallbackRemark 备注回退值
 * @returns {Object|null}
 */
function formatBookItem(item, fallbackRemark = "") {
  if (!item || typeof item !== "object") {
    return null;
  }

  const vodId = String(item.id || "");
  if (!vodId) {
    return null;
  }

  return {
    vod_id: vodId,
    vod_name: String(item.name || item.title || ""),
    vod_pic: String(item.cover || ""),
    vod_remarks: String(item.author || fallbackRemark || ""),
  };
}

/**
 * 获取某分类下的专辑列表
 * @param {string} categoryId 分类 ID
 * @param {number} page 页码
 * @param {number} limit 每页条数
 * @returns {Promise<Array>}
 */
async function fetchCategoryBooks(categoryId, page = 1, limit = 24) {
  const url = buildURL(`${API_HOST}/voice/book/list`, {
    instance_id: INSTANCE_ID,
    page,
    category_id: categoryId,
    num: limit,
  });

  const data = await requestJSON(url);
  const rawList = data?.data?.list;
  return Array.isArray(rawList) ? rawList : [];
}

/**
 * 获取某专辑全部章节（自动分页）
 * @param {string} albumId 专辑 ID
 * @returns {Promise<Array>}
 */
async function fetchAllAlbumUnits(albumId) {
  const perPage = 200;
  const firstURL = buildURL(`${API_HOST}/voice/album/units`, {
    album_id: albumId,
    page: 1,
    num: perPage,
    order: 1,
  });

  const firstData = await requestJSON(firstURL);
  const firstList = Array.isArray(firstData?.data?.list) ? firstData.data.list : [];
  const total = toInt(firstData?.data?.total, firstList.length);

  if (total <= perPage) {
    return firstList;
  }

  const pageCount = Math.ceil(total / perPage);
  const allUnits = [...firstList];

  for (let page = 2; page <= pageCount; page += 1) {
    const pageURL = buildURL(`${API_HOST}/voice/album/units`, {
      album_id: albumId,
      page,
      num: perPage,
      order: 1,
    });

    const pageData = await requestJSON(pageURL);
    const pageList = Array.isArray(pageData?.data?.list) ? pageData.data.list : [];
    allUnits.push(...pageList);
  }

  return allUnits;
}

/**
 * 获取专辑详情信息
 * @param {string} albumId 专辑 ID
 * @returns {Promise<{success:boolean,data:Object|null}>}
 */
async function fetchAlbumInfo(albumId) {
  try {
    const url = buildURL(`${API_HOST}/voice/album/get`, {
      album_id: albumId,
    });
    const data = await requestJSON(url);
    const album = data?.data;
    if (!album || typeof album !== "object") {
      return { success: false, data: null };
    }

    return {
      success: true,
      data: {
        vod_name: String(album.title || album.name || "未知标题"),
        vod_pic: String(album.cover || ""),
        vod_author: String(album.author || ""),
        vod_desc: String(album.description || "暂无简介"),
        created_at: String(album.created_at || ""),
        updated_at: String(album.updated_at || ""),
      },
    };
  } catch (error) {
    logError(`获取专辑信息失败 ${albumId}`, error);
    return { success: false, data: null };
  }
}

/**
 * 从分类列表中定位专辑信息（用于修正详情标题）
 * @param {string} albumId 专辑 ID
 * @returns {Promise<{vod_name:string,vod_pic:string,vod_author:string,found:boolean}>}
 */
async function findAlbumFromCategories(albumId) {
  const classes = Array.isArray(CATEGORY_CONFIG.class) ? CATEGORY_CONFIG.class : [];
  const maxPages = 5;
  const perPage = 24;

  const result = {
    vod_name: "",
    vod_pic: "",
    vod_author: "",
    found: false,
  };

  for (const cls of classes) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages && !result.found) {
      const books = await fetchCategoryBooks(cls.type_id, page, perPage);
      if (!Array.isArray(books) || books.length === 0) {
        break;
      }

      const hit = books.find((item) => String(item?.id || "") === albumId);
      if (hit) {
        result.vod_name = String(hit.name || hit.title || "");
        result.vod_pic = String(hit.cover || "");
        result.vod_author = String(hit.author || "");
        result.found = true;
        break;
      }

      if (books.length < perPage) {
        hasMore = false;
      }
      page += 1;
    }

    if (result.found) {
      break;
    }
  }

  return result;
}

/**
 * 对分类数组按 forceOrder 排序
 * @param {Array} classes 分类数组
 * @returns {Array}
 */
function sortClassesByForceOrder(classes) {
  const order = CATEGORY_CONFIG.forceOrder || [];
  if (!Array.isArray(order) || order.length === 0) {
    return classes;
  }

  const orderMap = new Map();
  order.forEach((name, index) => orderMap.set(name, index));

  return [...classes].sort((a, b) => {
    const aIndex = orderMap.has(a.type_name) ? orderMap.get(a.type_name) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderMap.has(b.type_name) ? orderMap.get(b.type_name) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

/**
 * 首页
 *
 * 返回：
 * 1. class 分类列表（按 forceOrder 排序）
 * 2. list  首页推荐（从所有分类抓取并合并）
 */
async function home(params) {
  try {
    const page = toInt(params?.page, 1);
    const classes = sortClassesByForceOrder(CATEGORY_CONFIG.class || []);
    const allBooks = [];

    for (const cls of classes) {
      const books = await fetchCategoryBooks(cls.type_id, page, 24);
      for (const item of books) {
        const formatted = formatBookItem(item, cls.type_name);
        if (formatted) {
          // 首页保留“作者 + 分类”的备注可读性
          const author = String(item?.author || "").trim();
          formatted.vod_remarks = `${author} ${cls.type_name}`.trim();
          allBooks.push(formatted);
        }
      }
    }

    logInfo("首页数据获取成功", { classCount: classes.length, itemCount: allBooks.length });
    return {
      class: classes,
      list: allBooks,
    };
  } catch (error) {
    logError("首页数据获取失败", error);
    return {
      class: sortClassesByForceOrder(CATEGORY_CONFIG.class || []),
      list: [],
    };
  }
}

/**
 * 分类列表
 * @param {Object} params
 * @param {string} params.categoryId 分类 ID
 * @param {number|string} params.page 页码
 */
async function category(params) {
  const categoryId = String(params?.categoryId || "");
  const page = toInt(params?.page, 1);

  try {
    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }

    const categoryObj = (CATEGORY_CONFIG.class || []).find((c) => c.type_id === categoryId);
    const books = await fetchCategoryBooks(categoryId, page, 24);
    const list = books
      .map((item) => formatBookItem(item, categoryObj?.type_name || ""))
      .filter(Boolean);

    logInfo("分类数据获取成功", { categoryId, page, count: list.length });
    return {
      page,
      pagecount: 9999,
      total: 999999,
      list,
    };
  } catch (error) {
    logError("分类数据获取失败", error);
    return {
      page,
      pagecount: 1,
      total: 0,
      list: [],
    };
  }
}

/**
 * 搜索
 * @param {Object} params
 * @param {string} params.keyword 关键词
 * @param {string} params.wd 兼容字段
 * @param {number|string} params.page 页码
 */
async function search(params) {
  const keyword = String(params?.keyword || params?.wd || "").trim();
  const page = toInt(params?.page, 1);
  const limit = 20;

  try {
    if (!keyword) {
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    const url = buildURL(`${SEARCH_HOST}/api/v3/voice/book`, {
      instanceId: INSTANCE_ID,
      keyword,
      pageNum: page,
      limitNum: limit,
    });

    const data = await requestJSON(url);
    const rawList = Array.isArray(data?.data?.list) ? data.data.list : [];
    const total = toInt(data?.data?.total, rawList.length);
    const list = rawList.map((item) => formatBookItem(item)).filter(Boolean);

    logInfo("搜索成功", { keyword, page, count: list.length, total });
    return {
      page,
      pagecount: Math.max(1, Math.ceil(total / limit)),
      total,
      list,
    };
  } catch (error) {
    logError("搜索失败", error);
    return {
      page,
      pagecount: 1,
      total: 0,
      list: [],
    };
  }
}

/**
 * 详情
 *
 * 说明：
 * - 将章节转换为 vod_play_sources 格式
 * - 每个章节的音频 file 作为 playId
 */
async function detail(params) {
  const videoId = String(params?.videoId || "").trim();

  try {
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    const categoryInfo = await findAlbumFromCategories(videoId);
    const albumInfo = await fetchAlbumInfo(videoId);
    const units = await fetchAllAlbumUnits(videoId);
    if (!Array.isArray(units) || units.length === 0) {
      return { list: [] };
    }

    const first = units[0] || {};
    const episodes = [];

    units.forEach((chapter, index) => {
      const playId = String(chapter?.file || "").trim();
      if (!playId) {
        return;
      }

      const title = String(chapter?.title || `第${index + 1}集`).trim();
      episodes.push({
        name: `${index + 1}.${title}`,
        playId,
      });
    });

    const playSources = episodes.length
      ? [
          {
            name: "博看听书",
            episodes,
          },
        ]
      : [];

    let vodName = "未知标题";
    if (categoryInfo.found && categoryInfo.vod_name) {
      vodName = categoryInfo.vod_name;
    } else if (albumInfo.success && albumInfo.data?.vod_name) {
      vodName = albumInfo.data.vod_name;
    } else if (first?.album_title) {
      vodName = String(first.album_title);
    } else if (first?.title) {
      vodName = String(first.title);
    }

    let vodPic = "";
    if (categoryInfo.found && categoryInfo.vod_pic) {
      vodPic = categoryInfo.vod_pic;
    } else if (albumInfo.success && albumInfo.data?.vod_pic) {
      vodPic = albumInfo.data.vod_pic;
    } else if (first?.cover) {
      vodPic = String(first.cover);
    }

    let vodAuthor = "";
    if (categoryInfo.found && categoryInfo.vod_author) {
      vodAuthor = categoryInfo.vod_author;
    } else if (albumInfo.success && albumInfo.data?.vod_author) {
      vodAuthor = albumInfo.data.vod_author;
    }

    const createdAt = albumInfo.success
      ? String(albumInfo.data?.created_at || "")
      : String(first?.created_at || "");
    const updatedAt = albumInfo.success
      ? String(albumInfo.data?.updated_at || "")
      : String(first?.updated_at || "");
    const albumDesc = albumInfo.success
      ? String(albumInfo.data?.vod_desc || "暂无简介")
      : String(first?.description || "暂无简介");

    const detailItem = {
      vod_id: videoId,
      vod_name: vodName,
      vod_pic: vodPic,
      vod_remarks: `${vodAuthor ? `${vodAuthor} ` : ""}共${episodes.length}集`,
      vod_content: albumDesc,
      vod_actor: createdAt ? `▶️创建于 ${createdAt}` : "",
      vod_director: updatedAt ? `▶️更新于 ${updatedAt}` : "",
      vod_year: createdAt ? `${createdAt.split("-")[0]}年` : "",
      vod_play_sources: playSources,
    };

    logInfo("详情获取成功", { videoId, episodeCount: episodes.length });
    return { list: [detailItem] };
  } catch (error) {
    logError("详情获取失败", error);
    return { list: [] };
  }
}

/**
 * 播放
 *
 * 博看听书章节即音频直链：
 * - parse 固定为 0
 * - 直接返回 playId
 */
async function play(params) {
  try {
    const playId = String(params?.playId || "").trim();
    if (!playId) {
      throw new Error("播放ID不能为空");
    }

    return {
      urls: [{ name: "博看听书", url: playId }],
      parse: 0,
      header: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
      },
    };
  } catch (error) {
    logError("播放地址获取失败", error);
    return {
      urls: [],
      parse: 0,
      header: {},
    };
  }
}

// 导出标准方法
module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

// 交给公共 runner 托管标准输入输出
const runner = require("spider_runner");
runner.run(module.exports);
