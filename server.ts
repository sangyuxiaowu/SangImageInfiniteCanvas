import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { base64ToBlob, getImageApiConfiguration, normalizeImageCount, normalizeImageResponse, sanitizeForLog } from "./server/imageApi";

// Load environment variables
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase the payload size limits for transferring base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // CORS Proxy for images (to allow drawing on canvas for masking/edits without tainting)
  app.get("/api/proxy-image", async (req: express.Request, res: express.Response) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        res.status(400).send("URL parameter is required.");
        return;
      }

      console.log(`[Proxy Image] Fetching: ${imageUrl}`);
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        res.status(response.status).send(`Failed to fetch image: ${response.statusText}`);
        return;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24h

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      console.error("[Proxy Image Error]:", err);
      res.status(500).send(`Error proxying image: ${err.message}`);
    }
  });

  // 1. Text to Image (Generations) Endpoint
  app.post("/api/generate", async (req: express.Request, res: express.Response) => {
    // Explicitly set very long timeouts
    req.setTimeout(600000); // 10 minutes
    res.setTimeout(600000);

    try {
      const { image, prompt, size = "1024x1024", model = "gpt-image-2", quality, n = 1 } = req.body;

      const { apiKey, baseUrl } = getImageApiConfiguration(req.headers);

      if (!apiKey) {
        res.status(401).json({
          error: "API Key is required. Please provide it in the settings panel or set GPT_IMAGE_API_KEY in the environment.",
        });
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 580000); // 580 seconds timeout
      const abortOnClientDisconnect = () => controller.abort();
      req.once("aborted", abortOnClientDisconnect);

      const requestBody: any = {
        model,
        prompt,
        size,
        n: normalizeImageCount(n),
        output_format: "png",
      };

      if (quality) requestBody.quality = quality;

  const targetUrl = `${baseUrl}/images/${image ? "edits" : "generations"}`;
      const maskedKey = apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : "None";

      console.log("=========================================");
      console.log(`[Generate Outgoing API Request Details${image ? " (reference image)" : ""}]`);
      console.log(`- Request URL: POST ${targetUrl}`);
      console.log(`- Reference Image Supplied: ${Boolean(image)}`);
      console.log(`- Request Headers:`, JSON.stringify({
        "Authorization": `Bearer ${maskedKey}`
      }, null, 2));
      console.log(`- Request Parameters:`, JSON.stringify(sanitizeForLog({ ...requestBody, image: image || undefined }), null, 2));
      console.log("=========================================");

      let body: BodyInit;
      let headers: Record<string, string> = { "Authorization": `Bearer ${apiKey}` };
      if (image) {
        const formData = new FormData();
        formData.append("image", base64ToBlob(image), "reference.png");
        Object.entries(requestBody).forEach(([key, value]) => formData.append(key, String(value)));
        body = formData;
      } else {
        headers = { ...headers, "Content-Type": "application/json" };
        body = JSON.stringify(requestBody);
      }

      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      req.off("aborted", abortOnClientDisconnect);

      console.log("=========================================");
      console.log("[Generate Upstream API Response Received]");
      console.log(`- Response Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`- Response Error Body:`, errorText);
        console.log("=========================================");
        res.status(response.status).json({
          error: `API responded with error code ${response.status}`,
          details: errorText,
        });
        return;
      }

      const data = normalizeImageResponse(await response.json());
      console.log(`- Response Data (Sanitized):`, JSON.stringify(sanitizeForLog(data), null, 2));
      console.log("=========================================");

      res.json(data);
    } catch (err: any) {
      console.error("=========================================");
      console.error("[Generate Exception]:", err);
      if (err.cause) {
        console.error("[Generate Exception Cause]:", err.cause);
      }
      console.error("=========================================");
      if (err.name === "AbortError") {
        res.status(504).json({ error: "Request timed out on the upstream server. The image generation is taking too long." });
      } else {
        res.status(500).json({ error: "Internal server error during image generation.", details: err.message, cause: err.cause });
      }
    }
  });

  // 2. Image Editing / Inpainting (Edits) Endpoint
  app.post("/api/edit", async (req: express.Request, res: express.Response) => {
    // Explicitly set very long timeouts
    req.setTimeout(600000); // 10 minutes
    res.setTimeout(600000);

    try {
      const { image, mask, prompt, size = "1024x1024", model = "gpt-image-2", n = 1 } = req.body;

      if (!image) {
        res.status(400).json({ error: "Original image (base64) is required for image editing." });
        return;
      }

      const { apiKey, baseUrl } = getImageApiConfiguration(req.headers);

      if (!apiKey) {
        res.status(401).json({
          error: "API Key is required. Please provide it in the settings panel or set GPT_IMAGE_API_KEY in the environment.",
        });
        return;
      }

      const targetUrl = `${baseUrl}/images/edits`;
      const maskedKey = apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : "None";

      const requestParamsLog = {
        prompt,
        model,
        size,
        n: normalizeImageCount(n),
        output_format: "png",
        image: image,
        mask: mask || undefined,
      };

      console.log("=========================================");
      console.log("[Edit Outgoing API Request Details]");
      console.log(`- Request URL: POST ${targetUrl}`);
      console.log(`- Request Headers:`, JSON.stringify({
        "Authorization": `Bearer ${maskedKey}`
      }, null, 2));
      console.log(`- Request Parameters:`, JSON.stringify(sanitizeForLog(requestParamsLog), null, 2));
      console.log(`- Mask Supplied: ${Boolean(mask)}`);
      console.log("=========================================");

      // Convert images to Blobs
      const imageBlob = base64ToBlob(image);
      let maskBlob: Blob | null = null;
      if (mask) {
        maskBlob = base64ToBlob(mask);
      }

      // Build multipart/form-data using standard Node.js FormData
      const formData = new FormData();
      formData.append("image", imageBlob, "image.png");
      if (maskBlob) {
        formData.append("mask", maskBlob, "mask.png");
      }
      formData.append("prompt", prompt);
      formData.append("model", model);
      formData.append("size", size);
      formData.append("n", normalizeImageCount(n).toString());
      formData.append("output_format", "png");
      console.log(`- Multipart Files: image.png (${imageBlob.type}, ${imageBlob.size} bytes)${maskBlob ? `, mask.png (${maskBlob.type}, ${maskBlob.size} bytes)` : ""}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 580000); // 580 seconds timeout
      const abortOnClientDisconnect = () => controller.abort();
      req.once("aborted", abortOnClientDisconnect);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      req.off("aborted", abortOnClientDisconnect);

      console.log("=========================================");
      console.log("[Edit Upstream API Response Received]");
      console.log(`- Response Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`- Response Error Body:`, errorText);
        console.log("=========================================");
        res.status(response.status).json({
          error: `API responded with error code ${response.status}`,
          details: errorText,
        });
        return;
      }

      const data = normalizeImageResponse(await response.json());
      console.log(`- Response Data (Sanitized):`, JSON.stringify(sanitizeForLog(data), null, 2));
      console.log("=========================================");

      res.json(data);
    } catch (err: any) {
      console.error("=========================================");
      console.error("[Edit Exception]:", err);
      if (err.cause) {
        console.error("[Edit Exception Cause]:", err.cause);
      }
      console.error("=========================================");
      if (err.name === "AbortError") {
        res.status(504).json({ error: "Request timed out on the upstream server. The image editing is taking too long." });
      } else {
        res.status(500).json({ error: "Internal server error during image editing.", details: err.message, cause: err.cause });
      }
    }
  });

  // 3. Mount Vite Dev Server / Static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Set timeout limits on the HTTP server itself to ensure it won't kill long-lived requests
  server.timeout = 600000; // 10 minutes
}

startServer();
