const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const REFERER = "https://supjav.com/";

const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

async function handler(req: Request): Promise<Response> {
  const uri = new URL(req.url);
  const pathname = uri.pathname;
  let lang = uri.searchParams.get("lang") || "en";
  
  console.log(new Date().toISOString(), 'Request:', pathname);

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  // Handler untuk root path
  if (pathname === "/" || pathname === "") {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SupJav Proxy</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          ul { list-style: none; padding: 0; }
          li { margin: 10px 0; }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>SupJav Proxy Worker</h1>
        <p>Available endpoints:</p>
        <ul>
          <li><a href="/popular/week">Popular This Week</a></li>
          <li><a href="/popular/month">Popular This Month</a></li>
          <li><a href="/category/uncensored">Uncensored Category</a></li>
          <li><a href="/search/japanese">Search "japanese"</a></li>
        </ul>
        <p>Use direct video ID: <code>/367025.m3u8</code></p>
      </body>
      </html>
    `, {
      headers: {
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  // Tangani permintaan M3U8 langsung
  if (pathname.match(/^\/\d+\.m3u8$/)) {
    const id = pathname.match(/\d+/)![0];
    console.log('Fetching M3U8 for ID:', id);
    
    const masterUrl = await getM3U8ById(id);
    console.log('Got master M3U8 URL:', masterUrl);
    
    if (masterUrl === null) {
      console.log('Failed to get M3U8 URL');
      return Empty;
    }
    
    try {
      const masterResponse = await fetch(masterUrl, {
        headers: {
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
        },
      });
      
      if (!masterResponse.ok) {
        console.log('Master M3U8 fetch failed:', masterResponse.status);
        return Empty;
      }
      
      let masterContent = await masterResponse.text();
      console.log('Master playlist received');
      
      // Pilih stream quality (ambil yang pertama)
      const streamLines = masterContent.split('\n').filter(line => 
        line.startsWith('https://') && line.includes('.m3u8')
      );
      
      if (streamLines.length === 0) {
        console.log('No variant streams found');
        return Empty;
      }
      
      const variantUrl = streamLines[0];
      console.log('Selected variant URL:', variantUrl);
      
      // Ambil variant playlist
      const variantResponse = await fetch(variantUrl, {
        headers: {
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
        },
      });
      
      if (!variantResponse.ok) {
        console.log('Variant M3U8 fetch failed:', variantResponse.status);
        return Empty;
      }
      
      let variantContent = await variantResponse.text();
      console.log('Variant playlist received');
      
      // Rewrite URLs untuk proxy melalui worker
      const variantUrlObj = new URL(variantUrl);
      const basePath = variantUrlObj.pathname.split('/').slice(0, -1).join('/');
      
      variantContent = variantContent.split('\n').map(line => {
        if (line.startsWith('https://') && line.includes('.ts')) {
          const segmentUrl = new URL(line);
          return `${uri.origin}/${variantUrlObj.hostname}/stream${segmentUrl.pathname}`;
        }
        return line;
      }).join('\n');
      
      return new Response(variantContent, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      console.log('Error processing M3U8:', error);
      return Empty;
    }
  }

  // Bagian untuk proxy segment .ts files
  if (pathname.match(/^\/[^\/]+\/stream\//)) {
    const match = pathname.match(/^\/([^\/]+)\/stream\/(.+)$/);
    if (!match) return Empty;
    
    const cdnHost = match[1];
    const segmentPath = match[2];
    
    const segmentUrl = new URL(`https://${cdnHost}/${segmentPath}`);
    console.log('Proxying segment:', segmentUrl.href);
    
    try {
      const res = await fetch(segmentUrl, { 
        headers: { 
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
        } 
      });
      
      if (!res.ok) {
        console.log('Segment fetch failed:', res.status);
        return Empty;
      }
      
      return new Response(res.body, {
        headers: {
          "Content-Type": "video/MP2T",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (error) {
      console.log('Error proxying segment:', error);
      return Empty;
    }
  }

  // Redirect dari .html ke .m3u8
  if (pathname.match(/^\/\d+(\.html)?$/)) {
    const id = pathname.match(/\d+/)![0];
    console.log('Redirecting for ID:', id);
    
    return new Response(null, {
      status: 307,
      headers: { 
        "Location": `/${id}.m3u8`,
        "Access-Control-Allow-Origin": "*"
      },
    });
  }

  // Popular videos
  if (pathname.match(/^\/popular\/(day|week|month)$/)) {
    const type = pathname.split("/").pop();
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

  // Search
  if (pathname.startsWith("/search/")) {
    const param = decodeURIComponent(pathname.slice(8));
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

  // Categories
  for (const [key, path] of Object.entries(GroupMap)) {
    if (!pathname.startsWith(`/${key}/`)) continue;

    let p = "/";
    if (lang !== "en") p += lang + "/";
    const param = decodeURIComponent(pathname.slice(key.length + 2));
    const base = new URL(p + path + param, "https://supjav.com");
    const pages = parseInt(uri.searchParams.get("pages") || "1");
    
    const list = await getList(base, pages);
    if (!list || list.length === 0) return Empty;
    
    return new Response(makePlayList(list, uri.origin), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }

  // 404 untuk path yang tidak dikenal
  return new Response("Page not found", { 
    status: 404,
    headers: {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// ... (Fungsi getM3U8ById, extractMediaList, fetchBody, getList, makePlayList, makeServerList tetap sama seperti sebelumnya) ...

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
    console.log('API response received');
    
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

async function getList(base: URL, pages: number = 1): Promise<MediaItem[]> {
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
