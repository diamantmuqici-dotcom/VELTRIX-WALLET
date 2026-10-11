package com.veltrix.wallet;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home-screen widget showing the default demo card. It is a static snapshot
 * pushed by the app whenever the card or balance changes — there is no
 * periodic update, no background service and no network access.
 * The card is always marked "DEMO CARD"; the balance is only shown when the
 * user enables it (Settings → Preferences) and is masked otherwise.
 */
public final class CardWidgetProvider extends AppWidgetProvider {

    private static final String PREFS = "veltrix_widget";
    private static final String KEY = "payload";

    static void save(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        refresh(context);
    }

    static void refresh(Context context) {
        AppWidgetManager m = AppWidgetManager.getInstance(context);
        if (m == null) return;
        int[] ids = m.getAppWidgetIds(new ComponentName(context, CardWidgetProvider.class));
        for (int id : ids) m.updateAppWidget(id, build(context, m, id));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, build(context, manager, id));
    }

    private static RemoteViews build(Context c, AppWidgetManager m, int id) {
        SharedPreferences prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject p;
        try {
            p = new JSONObject(prefs.getString(KEY, "{}"));
        } catch (Exception e) {
            p = new JSONObject();
        }
        float density = c.getResources().getDisplayMetrics().density;
        Bundle opts = m.getAppWidgetOptions(id);
        int wDp = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0) : 0;
        if (wDp <= 0) wDp = 300;
        int w = Math.min(820, Math.max(320, Math.round(wDp * density)));
        int h = Math.round(w / 1.586f);

        RemoteViews views = new RemoteViews(c.getPackageName(), R.layout.widget_card);
        views.setImageViewBitmap(R.id.widget_card_image, render(p, w, h));
        String desc = p.has("title") ? p.optString("title") + ". " + c.getString(R.string.widget_description) : c.getString(R.string.widget_description);
        views.setContentDescription(R.id.widget_card_image, desc);
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);
        return views;
    }

    private static int parse(String hex, int fallback) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean isLight(int color) {
        double l = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0;
        return l > 0.62;
    }

    static Bitmap render(JSONObject p, int w, int h) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        boolean empty = !p.has("title");
        int from = parse(p.optString("colorFrom", "#1b1d22"), 0xFF1B1D22);
        int to = parse(p.optString("colorTo", "#0a0b0d"), 0xFF0A0B0D);
        int mid = Color.rgb((Color.red(from) + Color.red(to)) / 2, (Color.green(from) + Color.green(to)) / 2, (Color.blue(from) + Color.blue(to)) / 2);
        boolean light = isLight(mid);
        int ink = light ? 0xFF14161A : 0xFFF6F7F9;
        int ink2 = light ? 0x9914161A : 0xA6F6F7F9;
        float r = w * 0.055f;
        RectF card = new RectF(0, 0, w, h);

        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setShader(new LinearGradient(0, 0, w, h, from, to, Shader.TileMode.CLAMP));
        cv.drawRoundRect(card, r, r, bg);

        Paint sheen = new Paint(Paint.ANTI_ALIAS_FLAG);
        sheen.setShader(new LinearGradient(0, 0, w * 0.6f, h, 0x26FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
        cv.drawRoundRect(card, r, r, sheen);

        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(Math.max(1f, w / 400f));
        stroke.setColor(light ? 0x33000000 : 0x26FFFFFF);
        cv.drawRoundRect(new RectF(1, 1, w - 1, h - 1), r, r, stroke);

        float pad = w * 0.065f;
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));

        // Title (card nickname) and the permanent DEMO CARD label.
        t.setColor(ink);
        t.setTextSize(h * 0.085f);
        t.setLetterSpacing(0.08f);
        String title = empty ? "VELTRIX" : p.optString("title", "VELTRIX · DEMO");
        cv.drawText(ellipsize(title, t, w * 0.55f), pad, pad + h * 0.07f, t);

        Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
        pill.setColor(light ? 0x1F000000 : 0x26FFFFFF);
        t.setTextSize(h * 0.062f);
        t.setLetterSpacing(0.12f);
        String demo = "DEMO CARD";
        float tw = t.measureText(demo);
        float pillH = h * 0.12f;
        RectF pr = new RectF(w - pad - tw - pillH * 0.9f, pad - pillH * 0.05f, w - pad, pad + pillH * 0.95f);
        cv.drawRoundRect(pr, pillH / 2, pillH / 2, pill);
        Paint pillStroke = new Paint(stroke);
        pillStroke.setColor(light ? 0x66000000 : 0x8CFFFFFF);
        cv.drawRoundRect(pr, pillH / 2, pillH / 2, pillStroke);
        cv.drawText(demo, pr.centerX() - tw / 2, pr.centerY() + h * 0.022f, t);

        // Amount (masked unless the user opted in) and display digits.
        t.setLetterSpacing(0f);
        t.setTextSize(h * 0.17f);
        t.setColor(ink);
        String amount = empty ? "Open VELTRIX" : p.optString("amount", "••••");
        cv.drawText(ellipsize(amount, t, w - pad * 2), pad, h * 0.6f, t);

        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
        t.setTextSize(h * 0.075f);
        t.setColor(ink2);
        String sub = empty ? "Set up your simulator to show a demo card" : p.optString("subtitle", "Simulator — not a real card");
        cv.drawText(ellipsize(sub, t, w - pad * 2), pad, h * 0.6f + h * 0.12f, t);

        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        t.setTextSize(h * 0.09f);
        t.setLetterSpacing(0.1f);
        t.setColor(ink);
        if (!empty) cv.drawText("•••• " + p.optString("digits", "0000"), pad, h - pad, t);

        if (p.optBoolean("frozen", false)) {
            Paint frost = new Paint(Paint.ANTI_ALIAS_FLAG);
            frost.setColor(light ? 0x99FFFFFF : 0x990A0E16);
            cv.drawRoundRect(card, r, r, frost);
            t.setTextSize(h * 0.11f);
            t.setLetterSpacing(0.2f);
            t.setColor(light ? 0xFF0A0E16 : 0xFFFFFFFF);
            String fz = "FROZEN";
            cv.drawText(fz, (w - t.measureText(fz)) / 2, h / 2f + h * 0.04f, t);
        }
        return bmp;
    }

    private static String ellipsize(String s, Paint p, float max) {
        if (p.measureText(s) <= max) return s;
        String out = s;
        while (out.length() > 1 && p.measureText(out + "…") > max) out = out.substring(0, out.length() - 1);
        return out + "…";
    }
}
