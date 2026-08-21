package com.speechbiofeedback.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.SoundPool;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native playback for the tone (loudness) alert's beep -- useToneAlert.ts fires this
 * alongside toneAlertHaptic() every time the "Lower your tone" alert fires, same trigger
 * condition and cooldown. Kept as its own tiny native plugin (same pattern as
 * HeadsetAudioPlugin/RecordingServicePlugin) rather than a third-party npm audio plugin,
 * since the only thing needed here -- play a short bundled local asset, and skip playback
 * when the device is silenced -- is a handful of lines against Android's own SDK.
 *
 * SoundPool (not MediaPlayer) because this is exactly what it's built for: a short (<1s),
 * pre-loaded local sound effect played with minimal trigger latency. The asset itself
 * (res/raw/tone_alert_beep.wav, ~180ms soft 880Hz tone -- see
 * scripts/generate-tone-alert-beep.cjs) is bundled in the APK, so playback never touches
 * the network and works fully offline.
 *
 * Silent-mode handling: AudioManager.getRingerMode() != RINGER_MODE_NORMAL means the user
 * has silenced the device (silent or vibrate-only) -- skip playback in that case. This is
 * independent of STREAM_MUSIC's own volume level, which SoundPool plays through and which
 * does NOT automatically mute when the ringer is silenced (a well-known Android quirk), so
 * without this explicit check the beep would ignore the silent switch entirely. This check
 * only gates the beep -- the caller fires the vibration (toneAlertHaptic) as a fully
 * separate call, so vibration is never affected by this and always fires regardless.
 */
@CapacitorPlugin(name = "ToneAlertBeep")
public class ToneAlertBeepPlugin extends Plugin {
  private SoundPool soundPool;
  private int soundId = -1;
  private boolean soundLoaded = false;

  @Override
  public void load() {
    AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
    soundPool = new SoundPool.Builder().setMaxStreams(1).setAudioAttributes(attributes).build();
    soundPool.setOnLoadCompleteListener((pool, sampleId, status) -> {
      if (status == 0) soundLoaded = true;
    });

    int resId = getContext().getResources().getIdentifier("tone_alert_beep", "raw", getContext().getPackageName());
    if (resId != 0) {
      soundId = soundPool.load(getContext(), resId, 1);
    }
  }

  private boolean isDeviceSilenced() {
    AudioManager audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    return audioManager != null && audioManager.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
  }

  @PluginMethod
  public void play(PluginCall call) {
    if (soundPool != null && soundLoaded && soundId != -1 && !isDeviceSilenced()) {
      soundPool.play(soundId, 0.6f, 0.6f, 1, 0, 1.0f);
    }
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    if (soundPool != null) {
      soundPool.release();
      soundPool = null;
    }
  }
}
