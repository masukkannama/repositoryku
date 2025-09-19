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
    
    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    let title = titleMatch ? titleMatch[1].replace(/ - Supjav|&#\d+;/g, '').trim() : `Video ${videoId}`;
    
    // Extract thumbnail
    const thumbMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    let thumb = thumbMatch ? thumbMatch[1] : '';
    
    // Clean up thumbnail URL (remove resize parameters)
    if (thumb.includes('!')) {
      thumb = thumb.split('!')[0];
    }
    
    // Extract M3U8 URL - try multiple methods
    let m3u8Url = null;
    
    // Method 1: Direct M3U8 link in HTML
    const m3u8Match = html.match(/(https?:\/\/[^\s"']+\.m3u8)/);
    if (m3u8Match) {
      m3u8Url = m3u8Match[1];
      console.log("Found M3U8 in HTML:", m3u8Url);
    }
    
    // Method 2: Player data
    if (!m3u8Url) {
      const playerDataMatch = html.match(/var playerData\s*=\s*({[^}]+})/);
      if (playerDataMatch) {
        try {
          const playerData = JSON.parse(playerDataMatch[1]);
          if (playerData.url && playerData.url.includes('.m3u8')) {
            m3u8Url = playerData.url;
            console.log("Found M3U8 in playerData:", m3u8Url);
          }
        } catch (e) {
          console.log("Error parsing playerData");
        }
      }
    }
    
    // Method 3: Iframe source
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
    
    if (!m3u8Url) {
      console.log("No M3U8 URL found");
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
    
    // Find video entries
    const videoRegex = /<a href="https:\/\/supjav\.com\/(\d+)\.html"[^>]*title="([^"]*)"[^>]*data-original="([^"]*)"/g;
    let match;
    
    while ((match = videoRegex.exec(html)) !== null) {
      const thumb = match[3].includes('!') ? match[3].split('!')[0] : match[3];
      
      videos.push({
        id: match[1],
        title: match[2].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code))),
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
    const videoRegex = /<a href="https:\/\/supjav\.com\/(\d+)\.html"[^>]*title="([^"]*)"[^>]*data-original="([^"]*)"/g;
    let match;
    
    while ((match = videoRegex.exec(html)) !== null) {
      const thumb = match[3].includes('!') ? match[3].split('!')[0] : match[3];
      
      videos.push({
        id: match[1],
        title: match[2].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code))),
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
