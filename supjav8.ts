const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const REFERER = "https://turbovidhls.com/";

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
  console.log(new Date().toISOString(), uri.pathname);

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  // Tangani permintaan M3U8 langsung
  if (uri.pathname.match(/^\/\d+\.m3u8$/)) {
    const id = uri.pathname.match(/\d+/)![0];
    const url = await getM3U8ById(id);
    if (url === null) return Empty;
    
    // Ambil konten M3U8 asli dari CDN
    const m3u8Response = await fetch(url, {
      headers: {
        "Referer": "https://supjav.com/",
        "User-Agent": UA,
      },
    });
    
    if (!m3u8Response.ok) return Empty;
    
    const m3u8Content = await m3u8Response.text();
    
    // Kembalikan konten M3U8 asli
    return new Response(m3u8Content, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Bagian untuk proxy penuh (stream video segments)
  if (uri.pathname.match(/^\/.*?\/stream\//)) {
    const i = uri.pathname.indexOf("/stream/");
    const cdnHost = uri.pathname.slice(1, i);
    const path = uri.pathname.slice(i);
    const u = new URL(path, `https://${cdnHost}`);
    const res = await fetch(u, { 
      headers: { 
        "Referer": u.origin,
        "User-Agent": UA
      } 
    });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Bagian untuk redirect ke URL proxy Worker
  if (uri.pathname.match(/^\/\d+(\.html)?$/)) {
    const id = uri.pathname.match(/\d+/)![0];
    const url = await getM3U8ById(id);
    if (url === null) return Empty;
    const urlobj = new URL(url);
    
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
    if (!list) return Empty;
    return new Response(makePlayList(list, uri.origin), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  if (uri.pathname.startsWith("/search/")) {
    const param = uri.pathname.slice(8);
    let p = "/";
    if (lang !== "en") p += lang + "/";
    const base = new URL(p, "https://supjav.com");
    base.searchParams.set("s", param);
    const list = await getList(base);
    if (!list) return Empty;
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
    const param = uri.pathname.slice(key.length + 2);
    const base = new URL(p + path + param, "https://supjav.com");
    const pages = parseInt(uri.searchParams.get("pages") || "3");
    const list = await getList(base, pages);
    if (!list) return Empty;
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
    const req1 = await fetch(`https://supjav.com/${id}.html`, {
      headers: {
        "Referer": REFERER,
        "User-Agent": UA,
      },
    });
    
    if (!req1.ok) return null;
    
    const data1 = await req1.text();
    const linkList = data1.match(/data-link\=".*?">.*?</mg);
    if (!linkList) return null;
    
    const serverMap = makeServerList(linkList);
    if (!serverMap.TV) return null;

    const tvid = serverMap.TV.split("").reverse().join("");
    const req2 = await fetch(
      `https://lk1.supremejav.com/supjav.php?c=${tvid}`,
      {
        headers: {
          "Referer": REFERER,
          "User-Agent": UA,
        },
      }
    );
    
    if (!req2.ok) return null;
    
    const data2 = await req2.text();
    const urlMatch = data2.match(/urlPlay.*?(https.*?\.m3u8)/m);
    if (urlMatch === null) return null;
    
    return urlMatch[1];
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
      /https:\/\/supjav\.com\/.*?\d+\.html.*?title=\".*?\".*?data-original=\".*?\"/gm
    );
    if (!list) return null;
    
    return list.map((item) => {
      const idMatch = item.match(/supjav\.com\/.*?(\d+)\.html/);
      const titleMatch = item.match(/title=\"(.*?)\"/);
      const thumbMatch = item.match(/data-original=\"(.*?)\"/);
      
      if (!idMatch || !titleMatch || !thumbMatch) return null;
      
      return {
        id: idMatch[1],
        title: titleMatch[1].replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec)),
        thumb: thumbMatch[1].split("!")[0],
      };
    }).filter((item): item is MediaItem => item !== null);
  } catch (error) {
    console.error("Error in extractMediaList:", error);
    return null;
  }
}

async function fetchBody(url: string | URL): Promise<string> {
  try {
    const req = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        "Referer": REFERER,
      },
    });
    
    if (!req.ok) throw new Error(`HTTP ${req.status}`);
    
    return await req.text();
  } catch (error) {
    console.error("Error in fetchBody:", error);
    throw error;
  }
}

async function getList(base: URL, pages: number = 3): Promise<MediaItem[]> {
  try {
    console.log("BASE:", base.href);
    const arr: Promise<string>[] = [fetchBody(base)];
    
    for (let i = 2; i <= pages; i++) {
      const u = new URL(base.href);
      if (!u.pathname.endsWith("/")) u.pathname += "/";
      u.pathname = u.pathname + "page/" + i;
      arr.push(fetchBody(u));
    }
    
    const list = await Promise.all(arr);
    const mediaLists = list.map(extractMediaList).filter((i): i is MediaItem[] => i !== null);
    
    return mediaLists.flat();
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
