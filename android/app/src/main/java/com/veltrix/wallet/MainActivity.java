package com.veltrix.wallet;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Hosts the VELTRIX simulator UI (bundled web assets) in a locked-down WebView.
 *
 * - Assets are served from the APK on https://appassets.androidplatform.net
 *   (see {@link AssetServer}); no other page can be loaded.
 * - The only remote host the page may contact is the optional, user-enabled
 *   indicative FX-rate source. Fictional transactions never use the network.
 * - No background services, no notifications, no extra permissions.
 */
public final class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final String RATES_HOST = "open.er-api.com";

    private static final int REQ_FILE_CHOOSER = 41;
    private static final int REQ_SAVE_DOCUMENT = 42;
    private static final int REQ_AUTH = 43;
    private static final String PREFS = "veltrix_ui";

    private FrameLayout root;
    private WebView webView;
    private AssetServer assets;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveId;
    private String pendingSaveContent;
    private String pendingAuthId;
    private OnBackInvokedCallback backCallback;
    private volatile String insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0,\"ime\":0}";
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean dark = resolveDark(prefs.getString("theme_mode", "system"));
        int bg = prefs.getInt("bg_color", dark ? 0xFF07090D : 0xFFF3F4F7);

        assets = new AssetServer(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        webView = new WebView(this);
        webView.setBackgroundColor(bg);
        configureWebView();
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupWindow(bg, dark);
        setupInsets();
        setupBack();
        webView.loadUrl(START_URL);
    }

    /* ------------------------------------------------------------------ */
    /* Window, theme, insets                                               */
    /* ------------------------------------------------------------------ */

    private boolean resolveDark(String mode) {
        if ("dark".equals(mode)) return true;
        if ("light".equals(mode)) return false;
        return systemDark();
    }

    private boolean systemDark() {
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night == Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressWarnings("deprecation")
    private void setupWindow(int bg, boolean dark) {
        Window w = getWindow();
        w.setBackgroundDrawable(new ColorDrawable(bg));
        View decor = w.getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else if (Build.VERSION.SDK_INT >= 26) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        } else {
            // API 24–25 cannot draw dark navigation-bar icons, so keep the navigation bar opaque there.
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 26) w.setNavigationBarColor(Color.TRANSPARENT);
        else w.setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        applyBarAppearance(dark);
    }

    @SuppressWarnings("deprecation")
    private void applyBarAppearance(boolean dark) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View d = w.getDecorView();
            int f = d.getSystemUiVisibility();
            f = dark ? (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            if (Build.VERSION.SDK_INT >= 26) {
                f = dark ? (f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            }
            d.setSystemUiVisibility(f);
        }
    }

    /** Called from the page whenever the in-app theme changes (persisted for the next launch). */
    void applyTheme(String mode, boolean dark, int bg) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("theme_mode", mode).putInt("bg_color", bg).apply();
        getWindow().setBackgroundDrawable(new ColorDrawable(bg));
        root.setBackgroundColor(bg);
        webView.setBackgroundColor(bg);
        applyBarAppearance(dark);
    }

    @SuppressWarnings("deprecation")
    private void setupInsets() {
        final float density = getResources().getDisplayMetrics().density;
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top;
                int right;
                int bottom;
                int left;
                int ime;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets sys = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets im = insets.getInsets(WindowInsets.Type.ime());
                    top = sys.top;
                    right = sys.right;
                    bottom = sys.bottom;
                    left = sys.left;
                    ime = im.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    left = insets.getSystemWindowInsetLeft();
                    bottom = insets.getStableInsetBottom();
                    ime = Math.max(0, insets.getSystemWindowInsetBottom() - bottom);
                    if (ime > 0) ime += bottom;
                }
                boolean imeVisible = ime > bottom;
                // Shrink the WebView above the keyboard (like adjustResize) so the focused field stays visible.
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) webView.getLayoutParams();
                int wanted = imeVisible ? ime : 0;
                if (lp.bottomMargin != wanted) {
                    lp.bottomMargin = wanted;
                    webView.setLayoutParams(lp);
                }
                insetsJson = String.format(Locale.US, "{\"top\":%.1f,\"right\":%.1f,\"bottom\":%.1f,\"left\":%.1f,\"ime\":0}",
                        top / density, right / density, (imeVisible ? 0 : bottom) / density, left / density);
                pushInsets();
                return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
            }
        });
        root.requestApplyInsets();
    }

    String insetsJson() {
        return insetsJson;
    }

    private void pushInsets() {
        if (pageReady) js("window.__veltrixInsets&&window.__veltrixInsets(" + insetsJson + ")");
    }

    private void js(String code) {
        if (webView != null) webView.evaluateJavascript(code, null);
    }

    /* ------------------------------------------------------------------ */
    /* WebView                                                             */
    /* ------------------------------------------------------------------ */

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        float scale = getResources().getConfiguration().fontScale;
        s.setTextZoom(Math.max(85, Math.min(130, Math.round(scale * 100))));
        s.setUserAgentString(s.getUserAgentString() + " VeltrixWallet/1.0.0");
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);
        else if (Build.VERSION.SDK_INT >= 29) s.setForceDark(WebSettings.FORCE_DARK_OFF);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.addJavascriptInterface(new WebAppBridge(this), "VeltrixNative");
        webView.setWebViewClient(new AppClient());
        webView.setWebChromeClient(new AppChrome());
    }

    private final class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return assets.open(u.getPath());
            // Optional indicative FX rates (only fetched after the user enables them).
            if ("https".equals(u.getScheme()) && RATES_HOST.equals(u.getHost())) return null;
            return AssetServer.blocked();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return !("https".equals(u.getScheme()) && HOST.equals(u.getHost()));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            pushInsets();
            js("window.__veltrixSystemTheme&&window.__veltrixSystemTheme(" + systemDark() + ")");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The renderer crashed or was killed: rebuild the activity; data is safe in storage.
            if (webView == view) {
                root.removeView(webView);
                webView.destroy();
                webView = null;
            }
            recreate();
            return true;
        }
    }

    private final class AppChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent i = params.createIntent();
                i.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(i, REQ_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            // Never forward page logs to logcat (they could contain user-entered text).
            return true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Bridge helpers (called on the UI thread)                            */
    /* ------------------------------------------------------------------ */

    void haptic(String kind) {
        if (webView == null) return;
        int c;
        if ("success".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
        else if ("error".equals(kind) || "warning".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
        else if ("select".equals(kind)) c = HapticFeedbackConstants.CLOCK_TICK;
        else c = HapticFeedbackConstants.KEYBOARD_TAP;
        webView.performHapticFeedback(c);
    }

    void copy(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("VELTRIX (simulated)", text));
    }

    void share(String text, String title) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        try {
            startActivity(Intent.createChooser(send, title));
        } catch (ActivityNotFoundException ignored) {
            // Nothing can share text on this device.
        }
    }

    void saveDocument(String requestId, String filename, String mime, String content) {
        if (pendingSaveId != null) resolve(pendingSaveId, false, "superseded");
        pendingSaveId = requestId;
        pendingSaveContent = content;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(i, REQ_SAVE_DOCUMENT);
        } catch (ActivityNotFoundException e) {
            resolve(requestId, false, "no-document-provider");
            pendingSaveId = null;
            pendingSaveContent = null;
        }
    }

    @SuppressWarnings("deprecation")
    void authenticate(String requestId, String title, String subtitle) {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent(title, subtitle);
        if (i == null) {
            // No screen lock configured: nothing to verify against.
            resolve(requestId, false, "not-secure");
            return;
        }
        pendingAuthId = requestId;
        try {
            startActivityForResult(i, REQ_AUTH);
        } catch (ActivityNotFoundException e) {
            pendingAuthId = null;
            resolve(requestId, false, "unavailable");
        }
    }

    void openExternal(String url) {
        Uri u = Uri.parse(url);
        if (!"https".equals(u.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed.
        }
    }

    private void resolve(String id, boolean ok, String message) {
        String safeId = id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", "");
        String safeMsg = message == null ? "" : message.replaceAll("[^A-Za-z0-9 _.:-]", "");
        js("window.__veltrixNativeResolve&&window.__veltrixNativeResolve('" + safeId + "'," + ok + ",'" + safeMsg + "')");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE_DOCUMENT) {
            final String id = pendingSaveId;
            final String content = pendingSaveContent;
            pendingSaveId = null;
            pendingSaveContent = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) {
                resolve(id, false, "canceled");
                return;
            }
            final Uri target = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    try (OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                        if (out != null) {
                            out.write(content.getBytes(StandardCharsets.UTF_8));
                            ok = true;
                        }
                    } catch (Exception ignored) {
                        ok = false;
                    }
                    final boolean result = ok;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            resolve(id, result, result ? "saved" : "write-failed");
                        }
                    });
                }
            }, "veltrix-save").start();
        } else if (requestCode == REQ_AUTH) {
            String id = pendingAuthId;
            pendingAuthId = null;
            resolve(id, resultCode == RESULT_OK, resultCode == RESULT_OK ? "verified" : "canceled");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Back, lifecycle, configuration                                      */
    /* ------------------------------------------------------------------ */

    private void setupBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    handleBack();
                }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    /** Lets the page handle back (close sheet, step back, pop screen); at the root the app goes to the background. */
    private void handleBack() {
        if (webView == null || !pageReady) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript("(function(){try{return !!(window.__veltrixBack&&window.__veltrixBack());}catch(e){return false;}})()", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) moveTaskToBack(true);
            }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onPause() {
        super.onPause();
        js("window.__veltrixLifecycle&&window.__veltrixLifecycle('pause')");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pageReady) js("window.__veltrixLifecycle&&window.__veltrixLifecycle('resume')");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        js("window.__veltrixSystemTheme&&window.__veltrixSystemTheme(" + systemDark() + ")");
        root.requestApplyInsets();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("VeltrixNative");
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
