const port = 8080;

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const filepath = decodeURIComponent(url.pathname);

  try {
    const file = await Deno.open("." + filepath, { read: true });
    console.info(`Serving file: ${filepath}`);
    return new Response(file.readable);
  } catch {
    console.error(`File not found: ${filepath}`);
    // If the file cannot be opened, return a "404 Not Found" response
    return new Response(`404 Not Found: ${filepath}`, { status: 404 });
  }
};

console.log(`HTTP server running. Access it at: http://localhost:${port}/`);
Deno.serve({ port }, handler);
