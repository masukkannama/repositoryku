const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://supjav.com/";

// Empty response helper
function createEmptyResponse(message: string = "Not found", status: number = 404): Response {
  return new Response(JSON.stringify({ error: message }), { 
    status, 
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    } 
  });
}

// JSON response helper
function createJsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  
  console.log(`Request: ${pathname}`);
  
  // Enable CORS for all requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
  
  // Only allow GET requests
  if (req.method !== "GET") {
    return createEmptyResponse("Method not allowed", 405);
  }
  
  // Root endpoint - show available endpoints
  if (pathname === "/") {
    return createJsonResponse({
      message: "SupJav API Worker",
      endpoints: {
        single_video: "/video/367025",
        popular: "/popular/week",
        search: "/search/query",
        categories: "/category/name"
      }
    });
  }
  
  // Single video info
  if (pathname.startsWith("/video/")) {
    const videoId = pathname.split("/").pop();
    if (!videoId || !videoId.match(/^\d+$/)) {
      return createEmptyResponse("Invalid video ID", 400);
    }
    
    const videoInfo = await getVideoInfo(videoId);
    if (!videoInfo) return createEmptyResponse("Video not found");
    
    return createJsonResponse(videoInfo);
  }
  
  // Popular videos
  if (pathname.startsWith("/popular/")) {
    const period = pathname.split("/").pop();
    if (!period || !["day", "week", "month"].includes(period)) {
      return createEmptyResponse("Invalid period. Use: day, week, month", 400);
    }
    
    const videos = await getPopularVideos(period);
    return createJsonResponse({ period, videos });
  }
  
  // Search videos
  if (pathname.startsWith("/search/")) {
    const query = decodeURIComponent(pathname.split("/").slice(2).join("/"));
    if (!query) {
      return createEmptyResponse("Search query required", 400);
    }
    
    const videos = await searchVideos(query);
    return createJsonResponse({ query, videos });
  }
  
  return createEmptyResponse();
}

// Get detailed video information
async function getVideoInfo(videoId: string): Promise<{id: string, title: string, thumb: string, m3u8_url: string} | null> {
  try {
    console.log(`Fetching video info for ID: ${videoId}`);
    
    const response = await fetch(`https://supjav.com/${videoId}.html`, {
      headers: {
        "User-Agent": UA,
        "Referer": REFERER
      }
    });
    
    if (!response.ok) {
      console.log(`Failed to fetch video page: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    console.log(`HTML length: ${html.length} characters`);
    
    // Extract title - multiple methods
    let title = `Video ${videoId}`;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      title = titleMatch[1]
        .replace(/ - Supjav|&#\d+;/g, '')
        .replace(/&amp;/g, '&')
        .trim();
    }
    
    // Extract thumbnail - multiple methods
    let thumb = '';
    const thumbMatch1 = html.match(/<meta property="og:image" content="([^"]+)"/);
    const thumbMatch2 = html.match(/data-original="([^"]+)"/);
    const thumbMatch3 = html.match(/<img[^>]+src="([^"]+\.jpg[^"]*)"/);
    
    if (thumbMatch1) thumb = thumbMatch1[1];
    else if (thumbMatch2) thumb = thumbMatch2[1];
    else if (thumbMatch3) thumb = thumbMatch3[1];
    
    // Clean up thumbnail URL
    if (thumb.includes('!')) {
      thumb = thumb.split('!')[0];
    }
    if (thumb.startsWith('//')) {
      thumb = 'https:' + thumb;
    }
    
    // Extract M3U8 URL - multiple methods with better regex
    let m3u8Url = null;
    
    // Method 1: Look for m3u8 in script tags
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch;
    
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const scriptContent = scriptMatch[1];
      const urlMatch = scriptContent.match(/(https?:\/\/[^\s'"]+\.m3u8)/);
      if (urlMatch) {
        m3u8Url = urlMatch[1];
        console.log("Found M3U8 in script:", m3u8Url);
        break;
      }
    }
    
    // Method 2: Look for player data
    if (!m3u8Url) {
      const playerDataMatch = html.match(/playerData\s*=\s*({[^}]+})/);
      if (playerDataMatch) {
        try {
          // Clean the JSON string
          const jsonStr = playerDataMatch[1]
            .replace(/(\w+):/g, '"$1":')
            .replace(/'/g, '"');
          
          const playerData = JSON.parse(jsonStr);
          if (playerData.url && playerData.url.includes('.m3u8')) {
            m3u8Url = playerData.url;
            console.log("Found M3U8 in playerData:", m3u8Url);
          }
        } catch (e) {
          console.log("Error parsing playerData:", e);
        }
      }
    }
    
    // Method 3: Look for iframe embeds
    if (!m3u8Url) {
      const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/);
      if (iframeMatch) {
        const iframeUrl = iframeMatch[1];
        console.log("Found iframe URL:", iframeUrl);
        
        try {
          const iframeResponse = await fetch(iframeUrl, {
            headers: {
              "User-Agent": UA,
              "Referer": REFERER
            }
          });
          
          if (iframeResponse.ok) {
            const iframeHtml = await iframeResponse.text();
            const iframeM3u8Match = iframeHtml.match(/(https?:\/\/[^\s"']+\.m3u8)/);
            if (iframeM3u8Match) {
              m3u8Url = iframeM3u8Match[1];
              console.log("Found M3U8 in iframe:", m3u8Url);
            }
          }
        } catch (error) {
          console.log("Error fetching iframe:", error);
        }
      }
    }
    
    // Method 4: Look for data-link attributes (common in jav sites)
    if (!m3u8Url) {
      const dataLinkMatch = html.match(/data-link="([^"]+)"/);
      if (dataLinkMatch) {
        const dataLink = dataLinkMatch[1];
        console.log("Found data-link:", dataLink);
        
        // Sometimes data-link contains the actual URL or a coded URL
        if (dataLink.includes('.m3u8')) {
          m3u8Url = dataLink;
        } else {
          // Try to decode or process the data-link
          try {
            // Common pattern: reverse the string and decode
            const reversed = dataLink.split('').reverse().join('');
            const decoded = atob(reversed);
            if (decoded.includes('.m3u8')) {
              m3u8Url = decoded;
              console.log("Decoded M3U8 from data-link:", m3u8Url);
            }
          } catch (e) {
            console.log("Could not decode data-link");
          }
        }
      }
    }
    
    if (!m3u8Url) {
      console.log("No M3U8 URL found after trying all methods");
      console.log("Sample HTML (first 1000 chars):", html.substring(0, 1000));
      return null;
    }
    
    return {
      id: videoId,
      title: title,
      thumb: thumb,
      m3u8_url: m3u8Url
    };
    
  } catch (error) {
    console.log("Error in getVideoInfo:", error);
    return null;
  }
}

// Get popular videos list
async function getPopularVideos(period: string): Promise<Array<{id: string, title: string, thumb: string}>> {
  try {
    const response = await fetch(`https://supjav.com/popular?sort=${period}`, {
      headers: {
        "User-Agent": UA,
        "Referer": REFERER
      }
    });
    
    if (!response.ok) {
      console.log("Failed to fetch popular videos");
      return [];
    }
    
    const html = await response.text();
    const videos: Array<{id: string, title: string, thumb: string}> = [];
    
    // Find video entries using more flexible regex
    const videoRegex = /<a\s+href="https:\/\/supjav\.com\/(\d+)\.html"[^>]*title="([^"]*)"[^>]*data-original="([^"]*)"/g;
    let match;
    
    while ((match = videoRegex.exec(html)) !== null) {
      let thumb = match[3];
      
      // Clean up thumbnail URL
      if (thumb.includes('!')) {
        thumb = thumb.split('!')[0];
      }
      if (thumb.startsWith('//')) {
        thumb = 'https:' + thumb;
      }
      
      videos.push({
        id: match[1],
        title: match[2]
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
          .replace(/&amp;/g, '&'),
        thumb: thumb
      });
      
      if (videos.length >= 10) break; // Limit to 10 videos
    }
    
    console.log(`Found ${videos.length} popular videos for ${period}`);
    return videos;
    
  } catch (error) {
    console.log("Error in getPopularVideos:", error);
    return [];
  }
}

// Search videos
async function searchVideos(query: string): Promise<Array<{id: string, title: string, thumb: string}>> {
  try {
    const response = await fetch(`https://supjav.com/?s=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": UA,
        "Referer": REFERER
      }
    });
    
    if (!response.ok) {
      console.log("Failed to search videos");
      return [];
    }
    
    const html = await response.text();
    const videos: Array<{id: string, title: string, thumb: string}> = [];
    
    // Find video entries in search results
    const videoRegex = /<a\s+href="https:\/\/supjav\.com\/(\d+)\.html"[^>]*title="([^"]*)"[^>]*data-original="([^"]*)"/g;
    let match;
    
    while ((match = videoRegex.exec(html)) !== null) {
      let thumb = match[3];
      
      // Clean up thumbnail URL
      if (thumb.includes('!')) {
        thumb = thumb.split('!')[0];
      }
      if (thumb.startsWith('//')) {
        thumb = 'https:' + thumb;
      }
      
      videos.push({
        id: match[1],
        title: match[2]
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
          .replace(/&amp;/g, '&'),
        thumb: thumb
      });
      
      if (videos.length >= 10) break; // Limit to 10 videos
    }
    
    console.log(`Found ${videos.length} videos for search: ${query}`);
    return videos;
    
  } catch (error) {
    console.log("Error in searchVideos:", error);
    return [];
  }
}

// Export handler correctly for Cloudflare Workers
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handler(request);
    } catch (error) {
      console.error("Unhandled error:", error);
      return createEmptyResponse("Internal server error", 500);
    }
  }
};
