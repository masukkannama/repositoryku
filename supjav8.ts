const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const REFERER = "https://supjav.com/"; // Ganti ke referer supjav sendiri

const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

async function handler(req: Request): Promise<Response> {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  console.log(new Date().toISOString(), 'Request:', uri.pathname);

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  // Tangani permintaan M3U8 langsung
  if (uri.pathname.match(/^\/\d+\.m3u8$/)) {
    const id = uri.pathname.match(/\d+/)![0];
    console.log('Fetching M3U8 for ID:', id);
    
    const url = await getM3U8ById(id);
    console.log('Got M3U8 URL:', url);
    
    if (url === null) {
      console.log('Failed to get M3U8 URL');
      return Empty;
    }
    
    // Ambil konten M3U8 asli dari CDN
    try {
      const m3u8Response = await fetch(url, {
        headers: {
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
          "Origin": "https://supjav.com"
        },
      });
      
      if (!m3u8Response.ok) {
        console.log('M3U8 fetch failed:', m3u8Response.status, m3u8Response.statusText);
        return Empty;
      }
      
      let m3u8Content = await m3u8Response.text();
      console.log('Original M3U8 content length:', m3u8Content.length);
      
      // Rewrite relative URLs to absolute URLs
      const cdnBase = new URL(url);
      cdnBase.pathname = cdnBase.pathname.split('/').slice(0, -1).join('/') + '/';
      
      m3u8Content = m3u8Content.replace(/(\n[^#][^\n]*\.ts)/g, (match) => {
        if (match.startsWith('http')) return match;
        return '\n' + new URL(match.trim(), cdnBase).href;
      });
      
      // Kembalikan konten M3U8 asli
      return new Response(m3u8Content, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      console.log('Error fetching M3U8:', error);
      return Empty;
    }
  }

  // Bagian untuk proxy penuh (stream video segments)
  if (uri.pathname.match(/^\/.*?\/stream\//)) {
    const i = uri.pathname.indexOf("/stream/");
    const cdnHost = uri.pathname.slice(1, i);
    const path = uri.pathname.slice(i);
    const u = new URL(path, `https://${cdnHost}`);
    
    console.log('Proxying segment:', u.href);
    
    const res = await fetch(u, { 
      headers: { 
        "Referer": "https://supjav.com/",
        "User-Agent": UA,
        "Origin": "https://supjav.com"
      } 
    });
    
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "video/MP2T",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Bagian untuk redirect ke URL proxy Worker
  if (uri.pathname.match(/^\/\d+(\.html)?$/)) {
    const id = uri.pathname.match(/\d+/)![0];
    console.log('Redirecting for ID:', id);
    
    const url = await getM3U8ById(id);
    if (url === null) return Empty;
    
    const urlobj = new URL(url);
    console.log('Redirecting to:', `/${urlobj.hostname}/stream${urlobj.pathname}`);
    
    // Alihkan ke URL proxy Worker
    return new Response(null, {
      status: 307,
      headers: { 
        "Location": `/${urlobj.hostname}/stream${urlobj.pathname}`,
        "Access-Control-Allow-Origin": "*"
      },
    });
  }

  // Bagian untuk membuat playlist M3U
  if (uri.pathname.match(/^\/popular\/(day|week|month)$/)) {
    const type = uri.pathname.split("/").pop();
    if (!type) return Empty;
    
    let p = "/";
    if (lang !== "en") p += lang + "/";
    const base = new URL(p + "popular", "https://supjav.com");
    base.searchParams.set("sort", type);
    
    const list = await getList(base);
    if (!list || list.length === 0) return Empty;
    
    return new Response(makePlayList(list, uri.origin), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  if (uri.pathname.startsWith("/search/")) {
    const param = decodeURIComponent(uri.pathname.slice(8));
    let p = "/";
    if (lang !== "en") p += lang + "/";
    const base = new URL(p, "https://supjav.com");
    base.searchParams.set("s", param);
    
    const list = await getList(base);
    if (!list || list.length === 0) return Empty;
    
    return new Response(makePlayList(list, uri.origin), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  for (const [key, path] of Object.entries(GroupMap)) {
    if (!uri.pathname.startsWith(`/${key}/`)) continue;

    let p = "/";
    if (lang !== "en") p += lang + "/";
    const param = decodeURIComponent(uri.pathname.slice(key.length + 2));
    const base = new URL(p + path + param, "https://supjav.com");
    const pages = parseInt(uri.searchParams.get("pages") || "3");
    
    const list = await getList(base, pages);
    if (!list || list.length === 0) return Empty;
    
    return new Response(makePlayList(list, uri.origin), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  return Empty;
}

export async function getM3U8ById(id: string): Promise<string | null> {
  try {
    console.log('Fetching HTML for ID:', id);
    const req1 = await fetch(`https://supjav.com/${id}.html`, {
      headers: {
        "Referer": REFERER,
        "User-Agent": UA,
      },
    });
    
    if (!req1.ok) {
      console.log('HTML fetch failed:', req1.status);
      return null;
    }
    
    const data1 = await req1.text();
    const linkList = data1.match(/data-link\=".*?">.*?</mg);
    
    if (!linkList || linkList.length === 0) {
      console.log('No data-link found in HTML');
      return null;
    }
    
    const serverMap = makeServerList(linkList);
    console.log('Server map:', serverMap);
    
    if (!serverMap.TV) {
      console.log('No TV server found');
      return null;
    }

    const tvid = serverMap.TV.split("").reverse().join("");
    console.log('TV ID:', tvid);
    
    const apiUrl = `https://lk1.supremejav.com/supjav.php?c=${tvid}`;
    console.log('API URL:', apiUrl);
    
    const req2 = await fetch(apiUrl, {
      headers: {
        "Referer": REFERER,
        "User-Agent": UA,
      },
    });
    
    if (!req2.ok) {
      console.log('API fetch failed:', req2.status);
      return null;
    }
    
    const data2 = await req2.text();
    console.log('API response:', data2.substring(0, 200) + '...');
    
    const urlMatch = data2.match(/urlPlay.*?(https?:\/\/[^\s\"']+\.m3u8)/);
    if (urlMatch === null) {
      console.log('No M3U8 URL found in API response');
      return null;
    }
    
    const m3u8Url = urlMatch[1];
    console.log('Found M3U8 URL:', m3u8Url);
    
    return m3u8Url;
  } catch (error) {
    console.error("Error in getM3U8ById:", error);
    return null;
  }
}

type MediaItem = {
  id: string;
  title: string;
  thumb: string;
};

export function extractMediaList(body: string): MediaItem[] | null {
  try {
    const list = body.match(
      /<a href="https:\/\/supjav\.com\/.*?\d+\.html".*?title=".*?".*?data-original=".*?"/gms
    );
    
    if (!list) {
      console.log('No media items found in page');
      return null;
    }
    
    const results = list.map((item) => {
      const idMatch = item.match(/supjav\.com\/.*?(\d+)\.html/);
      const titleMatch = item.match(/title="(.*?)"/);
      const thumbMatch = item.match(/data-original="(.*?)"/);
      
      if (!idMatch || !titleMatch || !thumbMatch) return null;
      
      return {
        id: idMatch[1],
        title: titleMatch[1].replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec)),
        thumb: thumbMatch[1].split("!")[0],
      };
    }).filter((item): item is MediaItem => item !== null);
    
    console.log('Extracted', results.length, 'media items');
    return results;
  } catch (error) {
    console.error("Error in extractMediaList:", error);
    return null;
  }
}

async function fetchBody(url: string | URL): Promise<string> {
  try {
    console.log('Fetching page:', url.toString());
    const req = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        "Referer": REFERER,
      },
    });
    
    if (!req.ok) {
      console.log('Page fetch failed:', req.status, req.statusText);
      throw new Error(`HTTP ${req.status}`);
    }
    
    return await req.text();
  } catch (error) {
    console.error("Error in fetchBody:", error);
    throw error;
  }
}

async function getList(base: URL, pages: number = 3): Promise<MediaItem[]> {
  try {
    console.log("Getting list from:", base.href);
    const arr: Promise<string>[] = [fetchBody(base)];
    
    for (let i = 2; i <= pages; i++) {
      const u = new URL(base.href);
      if (!u.pathname.endsWith("/")) u.pathname += "/";
      u.pathname = u.pathname + "page/" + i;
      arr.push(fetchBody(u));
    }
    
    const list = await Promise.all(arr);
    const mediaLists = list.map(extractMediaList).filter((i): i is MediaItem[] => i !== null);
    
    const result = mediaLists.flat();
    console.log('Total items found:', result.length);
    return result;
  } catch (error) {
    console.error("Error in getList:", error);
    return [];
  }
}

function makePlayList(list: MediaItem[], host: string): string {
  let str = "#EXTM3U\n";
  for (const item of list) {
    str += '#EXTINF:-1 tvg-logo="' + item.thumb + '",' + item.title + "\n";
    str += host + "/" + item.id + ".m3u8\n";
  }
  return str;
}

function makeServerList(arr: RegExpMatchArray): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of arr) {
    const i = item.indexOf(">");
    if (i === -1) continue;
    
    const key = item.slice(i + 1, -1);
    const val = item.slice(11, i - 1);
    result[key] = val;
  }
  return result;
}

export default {
  fetch: handler
};
