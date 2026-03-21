// @name 嗷呜动漫
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com//Silent1566/OmniBox-Spider/raw/refs/heads/main/动漫/嗷呜动漫.js
/**
* ============================================================================
* 嗷呜动漫
* 刮削：支持
* 弹幕：支持
* 嗅探：支持
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

// 弹幕API配置
const DANMU_API = process.env.DANMU_API || "";  

const _http = axios.create({
  timeout: 15 * 1000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
});  

const PLAY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  "Referer": "https://www.aowu.tv/",
  "Origin": "https://www.aowu.tv"
};

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

const encodeMeta = (obj) => {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
};

const decodeMeta = (str) => {
  try {
    const raw = Buffer.from(str || "", "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

// ========== 弹幕相关函数 ==========  

/**
* 预处理标题,去掉常见干扰项
*/
function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}  

/**
* 将中文数字转换为阿拉伯数字
*/
function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (!isNaN(cn)) return parseInt(cn);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === '十') return 10 + map[cn[1]];
    if (cn[1] === '十') return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}  

/**
* 从标题中提取集数数字
*/
function extractEpisode(title) {
  if (!title) return "";  
  
  const processedTitle = preprocessTitle(title).trim();  
  
  // 1. 中文格式:第XX集/话
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));  
  
  // 2. S01E03 格式
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];  
  
  // 3. EP/E 格式
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];  
  
  // 4. 括号格式 [03]
  const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }  
  
  return "";
}  

/**
* 构建用于弹幕匹配的文件名
*/
function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";  
  
  if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
    return vodName;
  }  
  
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      if (epNum < 10) {
        return `${vodName} S01E0${epNum}`;
      } else {
        return `${vodName} S01E${epNum}`;
      }
    }
  }  
  
  return vodName;
}  

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  if (mapping.episodeName) {
    return mapping.episodeName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) {
      return `${hit.episodeNumber}.${hit.name}`;
    }
  }
  return originalName;
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

/**
* 匹配弹幕
*/
async function matchDanmu(fileName) {
  if (!DANMU_API || !fileName) {
    return [];
  }  
  
  try {
    logInfo(`匹配弹幕: ${fileName}`);  
    
    const matchUrl = `${DANMU_API}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ fileName: fileName }),
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
    if (matches.length === 0) {
      return [];
    }  
    
    const firstMatch = matches[0];
    const episodeId = firstMatch.episodeId;
    const animeTitle = firstMatch.animeTitle || "";
    const episodeTitle = firstMatch.episodeTitle || "";  
    
    if (!episodeId) {
      return [];
    }  
    
    let danmakuName = "弹幕";
    if (animeTitle && episodeTitle) {
      danmakuName = `${animeTitle} - ${episodeTitle}`;
    } else if (animeTitle) {
      danmakuName = animeTitle;
    } else if (episodeTitle) {
      danmakuName = episodeTitle;
    }  
    
    const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;  
    
    logInfo(`弹幕匹配成功: ${danmakuName}`);  
    
    return [
      {
        name: danmakuName,
        url: danmakuURL,
      },
    ];
  } catch (error) {
    logInfo(`弹幕匹配失败: ${error.message}`);
    return [];
  }
}  

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
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniffAowuPlay = async (playUrl) => {
  if (!playUrl) return null;
  try {
    logInfo("尝试嗅探播放页", playUrl);
    const sniffed = await OmniBox.sniffVideo(playUrl);
    if (sniffed && sniffed.url) {
      logInfo("嗅探成功", sniffed.url);
      return {
        urls: [{ name: "嗅探线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || { ...PLAY_HEADERS, "Referer": playUrl }
      };
    }
  } catch (error) {
    logInfo(`嗅探失败: ${error.message}`);
  }
  return null;
};

/**
* 核心:解析 CMS 字符串为结构化播放源（支持透传参数）
* 逻辑:将 "来源1$$$来源2" 和 "第1集$ID1#第2集$ID2" 转换为 UI 识别的数组
*/
const parsePlaySources = (fromStr, urlStr, vodName, videoId = "") => {
  logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
  const playSources = [];
  if (!fromStr || !urlStr) return playSources;  
  
  const froms = fromStr.split('$$$');
  const urls = urlStr.split('$$$');  
  
  for (let i = 0; i < froms.length; i++) {
    const sourceName = froms[i] || `线路${i + 1}`;
    const sourceItems = urls[i] ? urls[i].split('#') : [];  
    
    const episodes = sourceItems.map((item, epIndex) => {
      const parts = item.split('$');
      const episodeName = parts[0] || '正片';
      const actualUrl = parts[1] || parts[0];
      const fid = `${videoId}#${i}#${epIndex}`;
      const combinedId = `${actualUrl}|||${encodeMeta({ sid: videoId, fid, v: vodName || "", e: episodeName })}`;
      
      return {
        name: episodeName,
        playId: combinedId,
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
    
    // 转换为 OmniBox 格式的播放源（传入视频名）
    const videoIdForScrape = String(videoId || '');
    const playSources = parsePlaySources(vod_play_from, vod_play_url, vod_name, videoIdForScrape);

    // 刮削处理
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";
    const scrapeCandidates = [];
    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        if (!ep._fid) continue;
        scrapeCandidates.push({
          fid: ep._fid,
          file_id: ep._fid,
          file_name: ep._rawName || ep.name || "正片",
          name: ep._rawName || ep.name || "正片",
          format_type: "video",
        });
      }
    }

    if (scrapeCandidates.length > 0) {
      try {
        const scrapingResult = await OmniBox.processScraping(videoIdForScrape, vod_name || "", vod_name || "", scrapeCandidates);
        OmniBox.log("info", `[嗷呜动漫-DEBUG] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
      } catch (error) {
        logError("刮削处理失败", error);
      }
    }

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
        if (!mapping) continue;
        const oldName = ep.name;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
        if (newName && newName !== oldName) {
          ep.name = newName;
          OmniBox.log("info", `[嗷呜动漫-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
        }
        ep._seasonNumber = mapping.seasonNumber;
        ep._episodeNumber = mapping.episodeNumber;
      }

      const hasEpisodeNumber = (source.episodes || []).some(
        (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
      );
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

    const normalizedPlaySources = playSources.map((source) => ({
      name: source.name,
      episodes: (source.episodes || []).map((ep) => ({
        name: ep.name,
        playId: ep.playId,
      })),
    }));
    
    const detail = {
      vod_id: videoIdForScrape,
      vod_name: scrapeData?.title || vod_name,
      vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : fixPicUrl(vod_pic),
      vod_content: scrapeData?.overview || vod_content,
      vod_play_sources: normalizedPlaySources // OmniBox 格式
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
  let playId = params.playId;
  logInfo(`准备播放 ID: ${playId}`);  
  
  let vodName = "";
  let episodeName = "";  
  let playMeta = {};
  let originalVodName = "";
  let originalEpisodeName = "";
  
  // 解析透传参数
  if (playId && playId.includes('|||')) {
    const [mainPlayId, metaB64] = playId.split('|||');
    playId = mainPlayId;
    playMeta = decodeMeta(metaB64 || "");
    vodName = playMeta.v || "";
    episodeName = playMeta.e || "";
    logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
  } else if (playId && playId.includes('|')) {
    // 兼容旧格式
    const parts = playId.split('|');
    playId = parts[0];
    vodName = parts[1] || "";
    episodeName = parts[2] || "";
    logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
  }  

  originalVodName = vodName;
  originalEpisodeName = episodeName;

  let scrapedDanmuFileName = "";
  try {
    const videoIdFromParam = params.vodId ? String(params.vodId) : "";
    const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
    const videoIdForScrape = videoIdFromParam || videoIdFromMeta;
    if (videoIdForScrape) {
      const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
      if (metadata && metadata.scrapeData) {
        const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
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
  } catch (error) {
    logInfo(`读取刮削元数据失败: ${error.message}`);
  }
  
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
    
    let playResponse;
    
    if (isDirectPlayable) {
      logInfo('直接播放链接');
      playResponse = {
        urls: [{ name: "直接播放", url: playUrl }],
        parse: 0,
        header: PLAY_HEADERS
      };
    } else {
      logInfo('需要解析播放页');
      const realVideoUrl = await parseAowuPlayPage(playUrl);  
      
      if (realVideoUrl) {
        logInfo('解析成功,真实视频地址', realVideoUrl);
        playResponse = {
          urls: [{ name: "极速云", url: realVideoUrl }],
          parse: 0,
          header: { ...PLAY_HEADERS, "Referer": playUrl }
        };
      } else {
        const sniffResult = await sniffAowuPlay(playUrl);
        if (sniffResult) {
          playResponse = sniffResult;
        } else {
          logInfo('未解析出真实地址,返回原始链接');
          playResponse = {
            urls: [{ name: "默认", url: playUrl }],
            parse: 1,
            header: PLAY_HEADERS
          };
        }
      }
    }  
    
    // 弹幕匹配
    if (DANMU_API && (vodName || originalVodName)) {
      const fallbackVodName = originalVodName || vodName;
      const fallbackEpisodeName = originalEpisodeName || episodeName;
      const fileName = scrapedDanmuFileName || buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
      logInfo(`尝试匹配弹幕文件名: ${fileName}`);  
      
      if (fileName) {
        const danmakuList = await matchDanmu(fileName);
        if (danmakuList && danmakuList.length > 0) {
          playResponse.danmaku = danmakuList;
          logInfo(`弹幕已添加到播放响应`);
        }
      }
    }  
    
    return playResponse;
  } catch (error) {
    logError('播放处理错误', error);
    const fallbackSniff = await sniffAowuPlay(playId);
    if (fallbackSniff) {
      return fallbackSniff;
    }
    return {
      urls: [{ name: "默认", url: playId }],
      parse: 1,
      header: PLAY_HEADERS
    };
  }
}  

// ========== 导出模块 ==========
module.exports = { home, category, search, detail, play };  

const runner = require("spider_runner");
runner.run(module.exports);
