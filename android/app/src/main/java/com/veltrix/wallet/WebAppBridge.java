package com.veltrix.wallet;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.os.Build;
import android.util.AtomicFile;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * JavaScript bridge exposed to the bundled page as {@code window.VeltrixNative}.
 *
 * It offers storage, haptics, theming, clipboard/share, document saving, the
 * widget snapshot and device-credential app lock. It deliberately offers no
 * network, contacts, location, camera or payment capability.
 */
final class WebAppBridge {

    private static final Pattern KEY = Pattern.compile("^[a-z0-9._-]{1,64}$");
    private static final int MAX_VALUE_CHARS = 40_000_000;

    private final MainActivity activity;
    private final File storeDir;
    private final Object lock = new Object();

    WebAppBridge(MainActivity activity) {
        this.activity = activity;
        this.storeDir = new File(activity.getFilesDir(), "veltrix-store");
        //noinspection ResultOfMethodCallIgnored
        storeDir.mkdirs();
    }

    private AtomicFile fileFor(String key) {
        return new AtomicFile(new File(storeDir, key + ".json"));
    }

    /* ----------------------------- Platform ----------------------------- */

    @JavascriptInterface
    public String getPlatformInfo() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("sdk", Build.VERSION.SDK_INT);
            String version = "1.0.0";
            try {
                PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                if (pi.versionName != null) version = pi.versionName;
            } catch (Exception ignored) {
                // keep default
            }
            o.put("appVersion", version);
            String wv = "";
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo w = WebView.getCurrentWebViewPackage();
                if (w != null) wv = w.packageName + " " + w.versionName;
            }
            o.put("webView", wv);
        } catch (JSONException ignored) {
            // cannot happen with these value types
        }
        return o.toString();
    }

    /* ------------------------------ Storage ----------------------------- */

    @JavascriptInterface
    public String storageGet(String key) {
        if (key == null || !KEY.matcher(key).matches()) return null;
        synchronized (lock) {
            AtomicFile f = fileFor(key);
            if (!f.getBaseFile().exists()) return null;
            try {
                return new String(f.readFully(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return null;
            }
        }
    }

    /** Atomic write: a crash mid-write leaves the previous file intact. */
    @JavascriptInterface
    public boolean storageSet(String key, String value) {
        if (key == null || value == null || !KEY.matcher(key).matches() || value.length() > MAX_VALUE_CHARS) return false;
        synchronized (lock) {
            AtomicFile f = fileFor(key);
            FileOutputStream out = null;
            try {
                out = f.startWrite();
                out.write(value.getBytes(StandardCharsets.UTF_8));
                f.finishWrite(out);
                return true;
            } catch (IOException e) {
                if (out != null) f.failWrite(out);
                return false;
            }
        }
    }

    @JavascriptInterface
    public void storageRemove(String key) {
        if (key == null || !KEY.matcher(key).matches()) return;
        synchronized (lock) {
            fileFor(key).delete();
        }
    }

    /* -------------------------------- UI -------------------------------- */

    @JavascriptInterface
    public void haptic(final String kind) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.haptic(kind);
            }
        });
    }

    @JavascriptInterface
    public void setTheme(final String mode, final boolean dark, final String background) {
        int parsed;
        try {
            parsed = Color.parseColor(background == null ? "" : background.trim());
        } catch (IllegalArgumentException e) {
            parsed = dark ? 0xFF07090D : 0xFFF3F4F7;
        }
        final int bg = parsed | 0xFF000000;
        final String m = "light".equals(mode) || "dark".equals(mode) ? mode : "system";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.applyTheme(m, dark, bg);
            }
        });
    }

    @JavascriptInterface
    public String getInsets() {
        return activity.insetsJson();
    }

    @JavascriptInterface
    public boolean copyText(final String text) {
        if (text == null || text.length() > 10_000) return false;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.copy(text);
            }
        });
        return true;
    }

    @JavascriptInterface
    public void shareText(final String text, final String title) {
        if (text == null || text.length() > 10_000) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.share(text, title == null ? "VELTRIX" : title);
            }
        });
    }

    @JavascriptInterface
    public void saveDocument(final String requestId, final String filename, final String mime, final String content) {
        if (content == null || content.length() > MAX_VALUE_CHARS) return;
        final String safeName = filename == null ? "veltrix-export.txt" : filename.replaceAll("[^A-Za-z0-9._-]", "_");
        final String safeMime = "text/csv".equals(mime) || "application/json".equals(mime) ? mime : "text/plain";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.saveDocument(requestId, safeName, safeMime, content);
            }
        });
    }

    /* ------------------------------ Widget ------------------------------ */

    @JavascriptInterface
    public void updateWidget(String json) {
        CardWidgetProvider.save(activity.getApplicationContext(), json == null ? "{}" : json);
    }

    /* ------------------------------ Security ---------------------------- */

    @JavascriptInterface
    public boolean isDeviceSecure() {
        KeyguardManager km = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    @JavascriptInterface
    public void authenticate(final String requestId, final String title, final String subtitle) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.authenticate(requestId, title, subtitle);
            }
        });
    }

    /* ----------------------------- Navigation --------------------------- */

    @JavascriptInterface
    public void openExternal(final String url) {
        if (url == null || !url.startsWith("https://")) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openExternal(url);
            }
        });
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.finish();
            }
        });
    }
}
