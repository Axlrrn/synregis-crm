package com.synregis.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationHelper.showDueNotification(context);
        NotificationHelper.scheduleNext(context); // arm tomorrow's alarm
    }
}
