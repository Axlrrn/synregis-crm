package com.synregis.crm;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Daily follow-up reminder: payload stored by the web app via the JS bridge,
 *  fired by AlarmReceiver at the configured time, fully offline. */
public class NotificationHelper {

    static final String PREFS = "synregis";
    static final String CHANNEL_ID = "reminders";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void ensureChannel(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    "Rappels de suivi", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Rappel quotidien des relances dues");
            nm.createNotificationChannel(ch);
        }
    }

    /** Schedule (or cancel) the next daily alarm based on stored settings. */
    static void scheduleNext(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        Intent intent = new Intent(ctx, AlarmReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1,
                intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!prefs(ctx).getBoolean("notif_enabled", false)) return;

        String time = prefs(ctx).getString("notif_time", "09:00");
        int h = 9, m = 0;
        try {
            String[] parts = time.split(":");
            h = Integer.parseInt(parts[0]);
            m = Integer.parseInt(parts[1]);
        } catch (Exception ignored) {}

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, m);
        cal.set(Calendar.SECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
    }

    /** Called by AlarmReceiver at notification time. */
    static void showDueNotification(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean("notif_enabled", false)) return;
        try {
            JSONObject payload = new JSONObject(p.getString("notif_payload", "{}"));
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());

            JSONArray followUps = payload.optJSONArray("followUps");
            ArrayList<String> due = new ArrayList<>();
            if (followUps != null) {
                for (int i = 0; i < followUps.length(); i++) {
                    JSONObject f = followUps.getJSONObject(i);
                    String date = f.optString("date", "");
                    if (!date.isEmpty() && date.compareTo(today) <= 0) {
                        due.add(f.optString("name", "?"));
                    }
                }
            }
            JSONArray stale = payload.optJSONArray("staleNames");
            boolean includeStale = payload.optBoolean("includeStale", false);
            int staleCount = (includeStale && stale != null) ? stale.length() : 0;

            if (due.isEmpty() && staleCount == 0) return; // nothing to say today

            String title;
            StringBuilder text = new StringBuilder();
            if (!due.isEmpty()) {
                title = due.size() + (due.size() > 1 ? " relances dues" : " relance due");
                for (int i = 0; i < Math.min(3, due.size()); i++) {
                    if (i > 0) text.append(", ");
                    text.append(due.get(i));
                }
                if (due.size() > 3) text.append("…");
                if (staleCount > 0) text.append(" • ").append(staleCount).append(" leads silencieux");
            } else {
                title = staleCount + " leads sans activité";
                text.append("Pensez à relancer vos prospects silencieux");
            }

            ensureChannel(ctx);
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent contentPi = PendingIntent.getActivity(ctx, 2, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification n = new Notification.Builder(ctx, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(text.toString())
                    .setStyle(new Notification.BigTextStyle().bigText(text.toString()))
                    .setContentIntent(contentPi)
                    .setAutoCancel(true)
                    .build();
            ctx.getSystemService(NotificationManager.class).notify(1, n);
        } catch (Exception ignored) {}
    }
}
