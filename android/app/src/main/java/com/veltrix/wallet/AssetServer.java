package com.veltrix.wallet;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the bundled web app from {@code assets/www} for
 * https://appassets.androidplatform.net/… with correct MIME types.
 * A secure (https) origin gives the page a normal, isolated web storage
 * origin without enabling file:// access.
 */
final class AssetServer {

    private final AssetManager assets;

    AssetServer(Context context) {
        this.assets = context.getAssets();
    }

    WebResourceResponse open(String rawPath) {
        String path = rawPath == null ? "/" : Uri.decode(rawPath);
        if (path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..") || path.contains("\\") || path.contains("\0")) return status(400, "Bad Request");
        try {
            InputStream in = assets.open("www" + path);
            String mime = mimeFor(path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Referrer-Policy", "no-referrer");
            boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") || mime.endsWith("svg+xml");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            return status(404, "Not Found");
        }
    }

    static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Response for every request outside the allow-list. */
    static WebResourceResponse blocked() {
        return status(403, "Forbidden");
    }
}
