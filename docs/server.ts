const port = 8080;

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  let filepath = decodeURIComponent(url.pathname);

  // Prevent directory traversal attacks
  if (filepath.includes("..")) {
    return new Response("403 Forbidden", { status: 403 });
  }

  // Ensure the path starts with a slash
  if (!filepath.startsWith("/")) {
    filepath = "/" + filepath;
  }

  // Default to index.html if the root is accessed
  if (filepath === "/") {
    filepath = "/index.html";
  }

  try {
    const file = await Deno.open("." + filepath, { read: true });
    console.info(`Serving file: ${filepath}`);

    // Determine the content type based on the file extension
    let contentType;
    if (filepath.endsWith(".html")) {
      contentType = "text/html";
    } else if (filepath.endsWith(".js")) {
      contentType = "application/javascript";
    } else if (filepath.endsWith(".css")) {
      contentType = "text/css";
    } else if (filepath.endsWith(".json")) {
      contentType = "application/json";
    } else if (filepath.endsWith(".png")) {
      contentType = "image/png";
    } else if (filepath.endsWith(".jpg") || filepath.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (filepath.endsWith(".gif")) {
      contentType = "image/gif";
    } else {
      contentType = "application/octet-stream";
    }

    return new Response(file.readable, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    console.error(`File not found: ${filepath}`);

    return new Response(`404 Not Found: ${filepath}`, { status: 404 });
  }
};

console.log(`HTTP server running. Access it at: http://localhost:${port}/`);
Deno.serve({ port }, handler);
