package com.synregis.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms don't survive a reboot — re-arm the daily reminder. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            NotificationHelper.scheduleNext(context);
        }
    }
}
