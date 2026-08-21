package com.speechbiofeedback.app;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS entry point (item 7) for RecordingForegroundService.java's start/stop -- called from useLiveSession.ts's startRecording/stopRecording so the foreground grant's lifetime exactly matches the actual recording session's. */
@CapacitorPlugin(name = "RecordingService")
public class RecordingServicePlugin extends Plugin {
  @PluginMethod
  public void start(PluginCall call) {
    Intent intent = new Intent(getContext(), RecordingForegroundService.class);
    intent.setAction(RecordingForegroundService.ACTION_START);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(intent);
    } else {
      getContext().startService(intent);
    }
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    Intent intent = new Intent(getContext(), RecordingForegroundService.class);
    intent.setAction(RecordingForegroundService.ACTION_STOP);
    getContext().startService(intent);
    call.resolve();
  }
}
