package com.speechbiofeedback.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Item 7: keeps recording (mic capture + DSP + classification + Haptics,
 * all of which run in this app's WebView JS -- see useLiveSession.ts) alive
 * when the user switches to another app, backgrounds the WebView, or locks
 * the screen. Two separate things make that actually work, only one of
 * which is this service's job:
 *
 *  1. Capacitor's Bridge.onPause() only calls WebView.pauseTimers() (which
 *     freezes ALL JS execution) when the "KeepRunning" preference is
 *     explicitly disabled -- this app never disables it (see
 *     capacitor.config.ts), so JS keeps running in the background already,
 *     with no native code needed for that part.
 *  2. What Android WILL do without this service is revoke microphone
 *     access and eventually kill the whole process once the Activity is
 *     backgrounded (background mic access requires an active, declared
 *     foreground service since Android 9, and a MISSING
 *     FOREGROUND_SERVICE_MICROPHONE-typed service throws outright on
 *     Android 14+/targetSdk 34+ if a foreground service without that type
 *     tries to hold the mic). This service exists purely to keep that
 *     grant alive, with the required persistent low-priority notification.
 */
public class RecordingForegroundService extends Service {
  public static final String ACTION_START = "com.speechbiofeedback.app.action.START_RECORDING";
  public static final String ACTION_STOP = "com.speechbiofeedback.app.action.STOP_RECORDING";

  private static final String CHANNEL_ID = "recording_status";
  private static final int NOTIFICATION_ID = 4200;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;

    if (ACTION_STOP.equals(action)) {
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    createChannelIfNeeded();
    Notification notification = buildNotification();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }

    // START_STICKY, not START_REDELIVER_INTENT: if the OS kills and
    // restarts this service, JS still owns the actual recording state
    // (SessionPipeline/useLiveSession) -- there is nothing meaningful to
    // "redeliver," this just keeps the notification/foreground grant alive
    // until JS explicitly stops it.
    return START_STICKY;
  }

  private void createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;

    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Recording status", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Shown while Speech Biofeedback is monitoring your speech, including in the background.");
    channel.setShowBadge(false);
    manager.createNotificationChannel(channel);
  }

  private Notification buildNotification() {
    Intent openApp = new Intent(this, MainActivity.class);
    openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
    PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openApp, pendingIntentFlags);

    return new NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Speech Biofeedback")
      .setContentText("Monitoring your speech in the background")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(contentIntent)
      .build();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
