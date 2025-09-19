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
    
    const masterUrl = await getM3U8ById(id);
    console.log('Got master M3U8 URL:', masterUrl);
    
    if (masterUrl === null) {
      console.log('Failed to get M3U8 URL');
      return Empty;
    }
    
    // Ambil master playlist
    try {
      const masterResponse = await fetch(masterUrl, {
        headers: {
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
          "Origin": "https://supjav.com"
        },
      });
      
      if (!masterResponse.ok) {
        console.log('Master M3U8 fetch failed:', masterResponse.status);
        return Empty;
      }
      
      let masterContent = await masterResponse.text();
      console.log('Master playlist content:\n', masterContent);
      
      // Pilih stream quality (biasanya yang pertama adalah yang terendah)
      const streamMatch = masterContent.match(/^https?:\/\/[^\s]+\.m3u8$/m);
      if (!streamMatch) {
        console.log('No variant streams found in master playlist');
        return Empty;
      }
      
      const variantUrl = streamMatch[0];
      console.log('Selected variant URL:', variantUrl);
      
      // Ambil variant playlist
      const variantResponse = await fetch(variantUrl, {
        headers: {
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
          "Origin": "https://supjav.com"
        },
      });
      
      if (!variantResponse.ok) {
        console.log('Variant M3U8 fetch failed:', variantResponse.status);
        return Empty;
      }
      
      let variantContent = await variantResponse.text();
      console.log('Variant playlist content length:', variantContent.length);
      
      // Rewrite URLs untuk proxy melalui worker
      const variantUrlObj = new URL(variantUrl);
      const basePath = variantUrlObj.pathname.split('/').slice(0, -1).join('/');
      
      variantContent = variantContent.replace(/(\n[^#][^\n]*\.ts)/g, (match, p1) => {
        const segmentUrl = p1.trim();
        if (segmentUrl.startsWith('http')) return match;
        
        const absoluteUrl = new URL(segmentUrl, `https://${variantUrlObj.hostname}${basePath}/`).href;
        return '\n' + absoluteUrl;
      });
      
      // Ganti semua URL segment dengan proxy URL melalui worker
      variantContent = variantContent.replace(/https?:\/\/[^\/]+\/([^\s]+\.ts)/g, (match, segmentPath) => {
        return `${uri.origin}/${variantUrlObj.hostname}/stream/${segmentPath}`;
      });
      
      // Kembalikan variant playlist yang sudah dimodifikasi
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

  // Bagian untuk proxy penuh (stream video segments .ts files)
  if (uri.pathname.match(/^\/.*?\/stream\//)) {
    const pathParts = uri.pathname.split('/');
    const cdnHost = pathParts[1];
    const segmentPath = '/' + pathParts.slice(3).join('/');
    
    const segmentUrl = new URL(segmentPath, `https://${cdnHost}`);
    console.log('Proxying segment:', segmentUrl.href);
    
    try {
      const res = await fetch(segmentUrl, { 
        headers: { 
          "Referer": "https://supjav.com/",
          "User-Agent": UA,
          "Origin": "https://supjav.com"
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

  // ... (Bagian lainnya tetap sama - popular, search, category) ...
  // Bagian untuk redirect ke URL proxy Worker
  if (uri.pathname.match(/^\/\d+(\.html)?$/)) {
    const id = uri.pathname.match(/\d+/)![0];
    console.log('Redirecting for ID:', id);
    
    const url = await getM3U8ById(id);
    if (url === null) return Empty;
    
    const urlobj = new URL(url);
    console.log('Redirecting to M3U8:', `/${id}.m3u8`);
    
    // Alihkan langsung ke endpoint M3U8 worker
    return new Response(null, {
      status: 307,
      headers: { 
        "Location": `/${id}.m3u8`,
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

  // ... (search dan category handlers tetap sama) ...

  return Empty;
}

// ... (Fungsi getM3U8ById, extractMediaList, fetchBody, getList, makePlayList, makeServerList tetap sama) ...

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

// ... (Fungsi-fungsi lainnya tetap sama) ...

export default {
  fetch: handler
};
