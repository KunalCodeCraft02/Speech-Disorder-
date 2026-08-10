package com.speechbiofeedback.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * getUserMedia() inside a Capacitor Android WebView needs three separate
 * grants working together, or mic capture silently fails:
 *  1. The RECORD_AUDIO entry in AndroidManifest.xml (declared, not enough alone).
 *  2. The RUNTIME permission grant below (Android 6+, requested from the user).
 *  3. The WebView's own internal permission handshake, answered here by
 *     overriding onPermissionRequest — the page's getUserMedia() call
 *     stays pending forever without this, even if (1) and (2) are both
 *     already granted.
 *
 * Replacing the WebChromeClient loses Capacitor's default file-chooser
 * handling (open file picker), which this app never uses (no file
 * inputs), so that trade-off is acceptable here.
 */
public class MainActivity extends BridgeActivity {
  private static final int RECORD_AUDIO_REQUEST_CODE = 7001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.RECORD_AUDIO }, RECORD_AUDIO_REQUEST_CODE);
    }

    getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(() -> {
          for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
              request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
              return;
            }
          }
          request.deny();
        });
      }
    });
  }
}
